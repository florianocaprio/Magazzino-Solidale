/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../src/lib/inventoryDecimal";
import { normalizeInventoryLotCode } from "../src/lib/inventoryLedger";
import { resolveInventoryQuantityDimensions } from "../src/lib/inventoryQuantityDimensions";

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
    expect(() => InventoryDecimal.parse(1.1234567)).toThrow(
      InventoryDecimalError,
    );
    expect(() => InventoryDecimal.parse(1e-7)).toThrow(InventoryDecimalError);
  });

  it("somma ripetutamente micro-quantità senza perdita di precisione", () => {
    let total = InventoryDecimal.zero();
    for (let index = 0; index < 100_000; index += 1) {
      total = total.add(InventoryDecimal.parse("0.000001"));
    }
    expect(total.toDb()).toBe("0.100000");
  });

  it("risolve Pezzi, Kg/Lt e fattore con HALF_UP senza floating point", () => {
    expect(
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "160",
        unitaMisura: "pz",
        fattoreKgLtPezzo: "0.334957000",
      }),
    ).toEqual({
      quantitaOperativa: "160.000000",
      quantitaPezzi: "160.000000",
      quantitaKgLt: "53.593120",
      fattoreKgLtPezzo: "0.334957000",
    });
    expect(
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "80",
        unitaMisura: "pz",
        fattorePartita: "0.334957000",
      }).quantitaKgLt,
    ).toBe("26.796560");
  });

  it("rifiuta dimensioni o fattori incoerenti", () => {
    expect(() =>
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "10",
        unitaMisura: "pz",
        quantitaKgLt: "4.999999",
        fattoreKgLtPezzo: "0.500000000",
      }),
    ).toThrow("quantitaKgLt non coerente");
    expect(() =>
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "10",
        unitaMisura: "pz",
        fattoreKgLtPezzo: "0.4",
        fattorePartita: "0.5",
      }),
    ).toThrow("incompatibile con la Partita");
  });

  it("calcola le dimensioni esatte di uno storno parziale", () => {
    expect(
      resolveInventoryQuantityDimensions({
        quantitaOperativa: "4",
        unitaMisura: "pz",
        fattorePartita: "0.500000000",
      }),
    ).toEqual({
      quantitaOperativa: "4.000000",
      quantitaPezzi: "4.000000",
      quantitaKgLt: "2.000000",
      fattoreKgLtPezzo: "0.500000000",
    });
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
