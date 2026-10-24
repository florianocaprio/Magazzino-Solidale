import { normalizeAgeaKey } from "./ageaSifeadParser";
import type { ParsedFseStockRow } from "./fseImportParser";
import { InventoryDecimal } from "./inventoryDecimal";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";

export const FSE_STOCK_FUNDS = [
  "FSE_PLUS",
  "FONDO_NAZIONALE",
  "FONDO_NAZIONALE_COFINANZIATO",
];

type Product = { id: number; nome: string; unitaMisura: string };
type LocalStock = {
  prodottoId: number;
  fondoOrigine: string;
  codiceLotto: string | null;
  dataScadenza: string | null;
  quantitaResidua: string;
  fattoreKgLtPezzo: string | null;
};
export type StockDifference = {
  prodotto: string;
  lotto: string | null;
  fondo: string | null;
  quantitaFile: string | null;
  quantitaLocale: string | null;
  unita: string;
  motivo: string;
};

/** Compare physical balances, not availability after reservations. Never infer loads from a delta. */
export function compareFseStock(
  rows: ParsedFseStockRow[],
  mappings: Map<string, number>,
  products: Product[],
  localStock: LocalStock[],
) {
  const catalog = new Map(products.map((product) => [product.id, product]));
  const key = (id: number, fund: string | null, lot: string | null) =>
    JSON.stringify([id, fund, normalizeAgeaKey(lot)]);
  const local = new Map<string, LocalStock[]>();
  for (const stock of localStock) {
    if (!InventoryDecimal.parse(stock.quantitaResidua).isPositive()) continue;
    const k = key(stock.prodottoId, stock.fondoOrigine, stock.codiceLotto);
    local.set(k, [...(local.get(k) ?? []), stock]);
  }
  const differences: StockDifference[] = [];
  const seen = new Set<string>();
  let matched = 0;
  for (const row of rows) {
    const id = mappings.get(row.prodottoNormalizzato);
    const product = id == null ? undefined : catalog.get(id);
    const unit =
      product?.unitaMisura.trim().toLowerCase().replace(/^lt$/, "l") ?? "";
    const quantity = unit === "pz" ? row.giacenzaPezzi : row.giacenzaPesoVolume;
    const difference: StockDifference = {
      prodotto: product?.nome ?? row.prodottoRaw,
      lotto: row.lottoRaw,
      fondo: row.fondoNormalizzato,
      quantitaFile: quantity,
      quantitaLocale: null,
      unita: unit,
      motivo: "",
    };
    if (row.blocking || !product) {
      difference.motivo = row.blocking
        ? `Riga ${row.numeroRiga}: ${row.errorCodes.join(", ")}`
        : "Prodotto non associato: completa l’associazione nell’importazione.";
      differences.push(difference);
      continue;
    }
    const k = key(product.id, row.fondoNormalizzato, row.lottoRaw);
    const stocks = local.get(k) ?? [];
    const total = stocks.reduce(
      (sum, stock) => sum.add(InventoryDecimal.parse(stock.quantitaResidua)),
      InventoryDecimal.zero(),
    );
    difference.quantitaLocale = total.toCanonical();
    const reasons: string[] = [];
    if (seen.has(k))
      reasons.push(
        "Più righe del file corrispondono allo stesso prodotto, fondo e lotto: verifica i duplicati.",
      );
    seen.add(k);
    if (
      quantity == null ||
      !["pz", "kg", "l"].includes(unit) ||
      (unit !== "pz" && unit !== row.unitaMisuraPeso)
    ) {
      reasons.push(
        "Quantità o unità del file non compatibile con il prodotto associato.",
      );
    } else if (total.compare(InventoryDecimal.parse(quantity)) !== 0) {
      reasons.push(
        "La quantità del file differisce dalla giacenza fisica locale.",
      );
    }
    if (
      row.dataScadenza &&
      stocks.some((stock) => stock.dataScadenza !== row.dataScadenza)
    ) {
      reasons.push("La scadenza del file differisce da quella locale.");
    }
    // Also check the second physical dimension when supplied; a missing conversion is not equality.
    const second = unit === "pz" ? row.giacenzaPesoVolume : row.giacenzaPezzi;
    if (second != null && ["pz", "kg", "l"].includes(unit)) {
      try {
        const physical = stocks.reduce((sum, stock) => {
          const dimensions = resolveInventoryQuantityDimensions({
            quantitaOperativa: stock.quantitaResidua,
            unitaMisura: unit,
            fattoreKgLtPezzo: stock.fattoreKgLtPezzo,
          });
          const value =
            unit === "pz" ? dimensions.quantitaKgLt : dimensions.quantitaPezzi;
          if (value == null) throw new Error("Conversione assente");
          return sum.add(InventoryDecimal.parse(value));
        }, InventoryDecimal.zero());
        if (physical.compare(InventoryDecimal.parse(second)) !== 0)
          reasons.push(
            "Anche la quantità in pezzi/peso del file va verificata.",
          );
      } catch {
        reasons.push(
          "Fattore pezzi/peso locale mancante o non valido: confronto incompleto.",
        );
      }
    }
    if (reasons.length)
      differences.push({ ...difference, motivo: reasons.join(" ") });
    else matched += 1;
  }
  for (const [k, stocks] of local) {
    if (seen.has(k)) continue;
    const first = stocks[0];
    differences.push({
      prodotto:
        catalog.get(first.prodottoId)?.nome ?? `Prodotto #${first.prodottoId}`,
      lotto: first.codiceLotto,
      fondo: first.fondoOrigine,
      quantitaFile: "0",
      quantitaLocale: stocks
        .reduce(
          (sum, stock) =>
            sum.add(InventoryDecimal.parse(stock.quantitaResidua)),
          InventoryDecimal.zero(),
        )
        .toCanonical(),
      unita: catalog.get(first.prodottoId)?.unitaMisura ?? "",
      motivo: "Giacenza locale assente dal file.",
    });
  }
  return {
    allineato: rows.length > 0 && differences.length === 0,
    righeFile: rows.length,
    righeCoincidenti: matched,
    differenze: differences,
  };
}
