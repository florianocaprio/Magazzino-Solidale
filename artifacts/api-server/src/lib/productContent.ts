import { canonicalInventoryFactor } from "./inventoryQuantityDimensions";

/** Catalog defaults never overwrite physical quantities already recorded on lots. */
export function parseProductContent(input: {
  fattoreKgLtPezzo?: unknown;
  unitaMisuraPeso?: unknown;
}):
  | { fattoreKgLtPezzo: string | null; unitaMisuraPeso: "kg" | "l" | null }
  | { error: string } {
  const factor = input.fattoreKgLtPezzo;
  const unit = input.unitaMisuraPeso;
  if ((factor == null || factor === "") && (unit == null || unit === ""))
    return { fattoreKgLtPezzo: null, unitaMisuraPeso: null };
  if (
    (unit !== "kg" && unit !== "l") ||
    (typeof factor !== "number" && typeof factor !== "string")
  )
    return { error: "Indica il contenuto per pezzo e la sua unità (kg o l)." };
  try {
    if (!Number.isFinite(Number(factor)) || Number(factor) >= 1_000_000_000)
      throw new Error("range");
    const decimal = typeof factor === "number" ? factor.toFixed(9) : factor;
    if (Number(decimal) !== Number(factor)) throw new Error("precision");
    const value = canonicalInventoryFactor(decimal);
    if (value == null) throw new Error("missing factor");
    return { fattoreKgLtPezzo: value, unitaMisuraPeso: unit };
  } catch {
    return {
      error:
        "Il contenuto per pezzo deve essere positivo, con massimo 9 decimali.",
    };
  }
}
