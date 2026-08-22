/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../src/lib/inventoryDecimal";
import { normalizeInventoryLotCode } from "../src/lib/inventoryLedger";

describe("Magazzino 2.0A — decimali contabili", () => {
  it("conserva 5/6 decimali in somma, sottrazione e serializzazione", () => {
    const carico = InventoryDecimal.parse("53.59312");
    const scarico = InventoryDecimal.parse("26.79656");
    const frazione = InventoryDecimal.parse("0.334957");

    expect(carico.toDb()).toBe("53.593120");
    expect(carico.add(scarico).toDb()).toBe("80.389680");
    expect(carico.subtract(scarico).toDb()).toBe("26.796560");
    expect(frazione.toDb()).toBe("0.334957");
    expect(frazione.toCanonical()).toBe("0.334957");
  });

  it("rifiuta arrotondamenti impliciti e quantità non positive", () => {
    expect(() => InventoryDecimal.parse("1.1234567")).toThrow(
      InventoryDecimalError,
    );
    expect(() => positiveInventoryDecimal("0.000000")).toThrow(
      InventoryDecimalError,
    );
    expect(() => positiveInventoryDecimal("-1")).toThrow(InventoryDecimalError);
  });

  it("normalizza il codice lotto in modo conservativo conservando l'originale", () => {
    expect(normalizeInventoryLotCode(" xyz   01 ")).toEqual({
      original: "xyz   01",
      normalized: "XYZ 01",
    });
    expect(normalizeInventoryLotCode("   ")).toEqual({
      original: null,
      normalized: null,
    });
  });
});
