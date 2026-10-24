import { describe, expect, it } from "vitest";
import { inferFseUnitFactor } from "../src/lib/fseImportQuantity";
import { resolveInventoryQuantityDimensions } from "../src/lib/inventoryQuantityDimensions";

describe("FSE: conversioni ricavate dai valori dichiarati", () => {
  it.each([
    ["150", "75", "0.500000000"],
    ["1152", "92.16", "0.080000000"],
    ["60", "60", "1.000000000"],
  ])(
    "conserva %s pezzi e %s kg/l senza perdere quantità",
    (pieces, weight, expected) => {
      const factor = inferFseUnitFactor(pieces, weight);
      expect(factor).toBe(expected);
      const dimensions = resolveInventoryQuantityDimensions({
        quantitaOperativa: pieces,
        unitaMisura: "pz",
        quantitaPezzi: pieces,
        quantitaKgLt: weight,
        fattoreKgLtPezzo: factor,
      });
      expect(Number(dimensions.quantitaKgLt)).toBe(Number(weight));
      expect(Number(dimensions.quantitaPezzi)).toBe(Number(pieces));
    },
  );
  it("non inventa dimensioni mancanti né accetta un fattore incoerente", () => {
    expect(inferFseUnitFactor(null, "12")).toBeNull();
    expect(inferFseUnitFactor("12", null)).toBeNull();
    expect(inferFseUnitFactor("0", "12")).toBeNull();
    expect(() =>
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "150",
        unitaMisura: "pz",
        quantitaPezzi: "150",
        quantitaKgLt: "75",
        fattoreKgLtPezzo: "0.4",
      }),
    ).toThrow(/non coerente/);
  });
});
