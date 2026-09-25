import type {
  CaricoPraticaRiga,
  Magazzino,
  Prodotto,
} from "@workspace/api-client-react";

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

export type CaricoRowField =
  | "quantita"
  | "fondoOrigine"
  | "codiceLottoProduttore"
  | "dataScadenza"
  | "fattoreKgLtPezzo";
export type CaricoRowIssue =
  | "missing"
  | "format"
  | "positive"
  | "integer"
  | "precision"
  | "required";
export type CaricoRowErrors = Partial<Record<CaricoRowField, CaricoRowIssue>>;

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

export function validateCaricoRow(
  row: Pick<
    CaricoPraticaRiga,
    "quantitaFrazionabile" | "lottoFisicoObbligatorio" | "gestioneScadenza"
  >,
  draft: CaricoRowDraft,
): CaricoRowErrors {
  const errors: CaricoRowErrors = {};
  const quantity = normalizeUiQuantity(draft.quantita);
  if (!quantity) errors.quantita = "missing";
  else if (!/^[+-]?\d+(?:\.\d+)?$/.test(quantity)) errors.quantita = "format";
  else if ((quantity.split(".")[1]?.length ?? 0) > 6)
    errors.quantita = "precision";
  else if (Number(quantity) <= 0) errors.quantita = "positive";
  else if (!row.quantitaFrazionabile && !/^\+?\d+(?:\.0+)?$/.test(quantity))
    errors.quantita = "integer";

  if (
    ![
      "NESSUN_FONDO",
      "FSE_PLUS",
      "FONDO_NAZIONALE",
      "FONDO_NAZIONALE_COFINANZIATO",
    ].includes(draft.fondoOrigine)
  )
    errors.fondoOrigine = "required";
  if (row.lottoFisicoObbligatorio && !draft.codiceLottoProduttore.trim())
    errors.codiceLottoProduttore = "required";
  if (row.gestioneScadenza && !draft.dataScadenza)
    errors.dataScadenza = "required";
  else if (draft.dataScadenza && !validDateOnly(draft.dataScadenza))
    errors.dataScadenza = "format";

  const factor = normalizeUiQuantity(draft.fattoreKgLtPezzo);
  if (factor) {
    if (!/^\d+(?:\.\d{1,9})?$/.test(factor)) errors.fattoreKgLtPezzo = "format";
    else if (Number(factor) <= 0) errors.fattoreKgLtPezzo = "positive";
  }
  return errors;
}

export function blocksCaricoDraftSave(errors: CaricoRowErrors): boolean {
  return Object.entries(errors).some(
    ([field, issue]) =>
      !(
        issue === "missing" ||
        (issue === "required" && field !== "fondoOrigine")
      ),
  );
}

export function reconcileCaricoDrafts(
  previousRows: CaricoPraticaRiga[],
  nextRows: CaricoPraticaRiga[],
  drafts: Record<number, CaricoRowDraft>,
  savedRowId?: number,
): { drafts: Record<number, CaricoRowDraft>; conflicts: number[] } {
  const oldRows = new Map(previousRows.map((row) => [row.id, row]));
  const result: Record<number, CaricoRowDraft> = {};
  const conflicts: number[] = [];
  for (const row of nextRows) {
    if (row.registrata) continue;
    const old = oldRows.get(row.id);
    const local = drafts[row.id];
    const oldDraft = old && caricoDraftFromRow(old);
    const serverDraft = caricoDraftFromRow(row);
    if (
      row.id !== savedRowId &&
      oldDraft &&
      local &&
      isCaricoRowDraftDirty(local, oldDraft)
    ) {
      result[row.id] = local;
      if (isCaricoRowDraftDirty(serverDraft, oldDraft)) conflicts.push(row.id);
    } else result[row.id] = serverDraft;
  }
  return { drafts: result, conflicts };
}

export function caricoDraftFromRow(row: CaricoPraticaRiga): CaricoRowDraft {
  return {
    quantita: row.quantita?.toString() ?? "",
    fondoOrigine: row.fondoOrigine,
    codiceLottoProduttore: row.codiceLottoProduttore ?? "",
    dataScadenza: row.dataScadenza ?? "",
    fattoreKgLtPezzo: row.fattoreKgLtPezzo?.toString() ?? "",
    note: row.note ?? "",
  };
}

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
