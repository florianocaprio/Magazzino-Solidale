type StockUnitRow = {
  prodottoEsterno: string;
  unitaMisuraPeso?: string | null;
  giacenzaPezzi?: string | null;
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

/** Prefer the explicit file unit. KgLt alone cannot distinguish mass from volume. */
export function suggestFseUnit(
  description: string,
  stockRows: StockUnitRow[],
  registryRows: RegistryUnitRow[],
): { unit: FseUnit | null; source: "file" | "pieces" | "unknown" } {
  const stock = stockRows.filter(
    (row) => key(row.prodottoEsterno) === key(description),
  );
  const units = new Set(
    stock.map((row) => row.unitaMisuraPeso?.toLowerCase()).filter(Boolean),
  );
  if (
    stock.some((row) => row.errorCodes.includes("UNITA_PESO_NON_RICONOSCIUTA"))
  )
    return { unit: null, source: "unknown" };
  if (units.size === 1) {
    const [unit] = units;
    if (unit === "kg" || unit === "l") return { unit, source: "file" };
  }
  if (units.size) return { unit: null, source: "unknown" };
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
    quantities.every((quantity) => quantity != null && Number(quantity) > 0)
    ? { unit: "pz", source: "pieces" }
    : { unit: null, source: "unknown" };
}
