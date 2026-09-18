import type { Magazzino, Prodotto } from "@workspace/api-client-react";

export type CaricoRowDraft = {
  quantita: string;
  fondoOrigine:
    | "NESSUN_FONDO"
    | "FSE_PLUS"
    | "FONDO_NAZIONALE"
    | "FONDO_NAZIONALE_COFINANZIATO";
  codiceLottoProduttore: string;
  dataScadenza: string;
  fattoreKgLtPezzo: string;
  note: string;
};

export function operationalWarehousesForArea(
  warehouses: Magazzino[] | undefined,
  areaOperativaId: number | null,
) {
  if (areaOperativaId == null) return [];
  return (warehouses ?? []).filter(
    (warehouse) =>
      warehouse.areaOperativaId === areaOperativaId &&
      warehouse.stato === "attivo",
  );
}

export function normalizeUiQuantity(value: string): string {
  return value.trim().replace(",", ".");
}

function normalizeComparableQuantity(value: string): string {
  const normalized = normalizeUiQuantity(value);
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(normalized);
  if (!match) return normalized;

  const integer = match[2].replace(/^0+(?=\d)/, "");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  const sign = integer === "0" && !fraction ? "" : match[1];
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function comparableRowDraft(draft: CaricoRowDraft): CaricoRowDraft {
  return {
    quantita: normalizeComparableQuantity(draft.quantita),
    fondoOrigine: draft.fondoOrigine,
    codiceLottoProduttore: draft.codiceLottoProduttore.trim(),
    dataScadenza: draft.dataScadenza.trim(),
    fattoreKgLtPezzo: normalizeComparableQuantity(draft.fattoreKgLtPezzo),
    note: draft.note.trim(),
  };
}

export function isCaricoRowDraftDirty(
  draft: CaricoRowDraft,
  persisted: CaricoRowDraft,
): boolean {
  const current = comparableRowDraft(draft);
  const saved = comparableRowDraft(persisted);
  return (Object.keys(current) as Array<keyof CaricoRowDraft>).some(
    (key) => current[key] !== saved[key],
  );
}

export function productForBarcode(
  products: Prodotto[] | undefined,
  barcode: string,
) {
  const normalized = barcode.trim();
  if (!normalized) return undefined;
  return (products ?? []).find(
    (product) => product.attivo && product.codiceBarre === normalized,
  );
}

export function visibleProducts(
  products: Prodotto[] | undefined,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  return (products ?? [])
    .filter((product) => product.attivo)
    .filter(
      (product) =>
        !normalized ||
        product.nome.toLocaleLowerCase().includes(normalized) ||
        product.codice.toLocaleLowerCase().includes(normalized) ||
        product.codiceBarre?.toLocaleLowerCase().includes(normalized),
    );
}

export function newCommandKey(prefix = "carico-pratica") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function shouldAcceptBarcodeScan(
  previous: { value: string; at: number } | null,
  value: string,
  now: number,
) {
  return previous?.value !== value || now - previous.at >= 2500;
}
