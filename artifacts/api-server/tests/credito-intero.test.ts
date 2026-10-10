import { describe, expect, it } from "vitest";
import {
  creditoIntero,
  creditoPerQuantita,
  quotaTecnicaCredito,
} from "../src/lib/creditoIntero";
import { InventoryDecimal as Q } from "../src/lib/inventoryDecimal";

describe("M6.2-C Credito Intero", () => {
  it.each([0, 1, "5.00", "3,00", 99_999_999])(
    "C01/C26 accetta %s senza arrotondamenti",
    (value) => {
      expect(creditoIntero(value)).toBe(
        Number(String(value).replace(",", ".")),
      );
    },
  );
  it.each([
    "0.5",
    "1,5",
    "2.25",
    "5.25",
    "3.000000000000001",
    "1e2",
    NaN,
    Infinity,
    null,
    undefined,
    "",
    "100000000",
    "9007199254740993",
  ])("C02/C03/C27 rifiuta %s", (value) => {
    expect(() => creditoIntero(value)).toThrow();
  });
  it("C01 distingue zero, segno e importo positivo", () => {
    expect(() => creditoIntero(0, { positive: true })).toThrow();
    expect(() => creditoIntero(-1)).toThrow();
    expect(creditoIntero("-5.00", { signed: true })).toBe(-5);
  });
  it("C04/C05/C24 quantità frazionarie, credito esatto", () => {
    expect(creditoPerQuantita(4, "0.5")).toBe(2);
    expect(creditoPerQuantita(1_000_000, "0.000001")).toBe(1);
    expect(() => creditoPerQuantita(3, "0.5")).toThrow(/frazione/);
    expect(() => creditoPerQuantita(99_999_999, "2")).toThrow();
  });
  it("C06 riparto FEFO tecnico intero conserva addebito 3", () => {
    const first = quotaTecnicaCredito(
      3,
      Q.parse("0.5"),
      Q.zero(),
      Q.parse("1"),
    );
    const second = quotaTecnicaCredito(
      3,
      Q.parse("1"),
      Q.parse("0.5"),
      Q.parse("1"),
    );
    expect([first, second]).toEqual([1, 2]);
    expect(first + second).toBe(3);
  });
});
