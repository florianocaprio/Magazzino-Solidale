type StockUnitRow = {
  prodottoEsterno: string;
  unitaMisuraPeso?: string | null;
  giacenzaPezzi?: string | null;
  pesoUnita?: string | null;
  errorCodes: string[];
};
type RegistryUnitRow = {
  prodottoEsterno: string;
  tipoMovimento: string;
  quantitaPezzi?: string | null;
};
export type FseUnit = "pz" | "kg" | "l";
const key = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();

/** Packaged inventory is managed in pieces. Physical content is a separate dimension. */
export function suggestFseUnit(
  description: string,
  stockRows: StockUnitRow[],
  registryRows: RegistryUnitRow[],
): { unit: FseUnit | null; source: "file" | "pieces" | "unknown" } {
  const stock = stockRows.filter(
    (row) => key(row.prodottoEsterno) === key(description),
  );
  const quantities = stock.length
    ? stock.map((row) => row.giacenzaPezzi)
    : registryRows
        .filter(
          (row) =>
            row.tipoMovimento === "CARICO" &&
            key(row.prodottoEsterno) === key(description),
        )
        .map((row) => row.quantitaPezzi);
  return quantities.length &&
    quantities.every(
      (quantity) =>
        quantity != null &&
        Number.isFinite(Number(quantity)) &&
        Number(quantity) >= 0,
    )
    ? { unit: "pz", source: "pieces" }
    : { unit: null, source: "unknown" };
}

/** Only propose a catalog default when every stock row agrees on unit and pack size. */
export function suggestFseContent(
  description: string,
  rows: StockUnitRow[],
): { unitaMisuraPeso: "kg" | "l" | null; fattoreKgLtPezzo: number | null } {
  const matches = rows.filter(
    (row) => key(row.prodottoEsterno) === key(description),
  );
  const units = new Set(matches.map((row) => row.unitaMisuraPeso));
  const factors = new Set(matches.map((row) => Number(row.pesoUnita)));
  const unit = units.size === 1 ? [...units][0] : null;
  const factor = factors.size === 1 ? [...factors][0] : null;
  return {
    unitaMisuraPeso: unit === "kg" || unit === "l" ? unit : null,
    fattoreKgLtPezzo:
      (unit === "kg" || unit === "l") &&
      factor != null &&
      Number.isFinite(factor) &&
      factor > 0
        ? factor
        : null,
  };
}
