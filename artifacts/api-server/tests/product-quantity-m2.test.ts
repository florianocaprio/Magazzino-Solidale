/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import {
  defaultProductFractionalQuantity,
  validateProductOperationalQuantity,
} from "../src/lib/productQuantity";

describe("quantità operative del catalogo M2", () => {
  it.each(["kg", "KG", "l", "lt", " LT "])(
    "rende frazionabile per default %s",
    (unit) => expect(defaultProductFractionalQuantity(unit)).toBe(true),
  );

  it.each(["pz", "cf", "conf", "altro", ""])(
    "non rende frazionabile per default %s",
    (unit) => expect(defaultProductFractionalQuantity(unit)).toBe(false),
  );

  it.each(["1", "2", "10", "2.000000"])(
    "accetta l'intero semantico %s per un prodotto non frazionabile",
    (quantity) =>
      expect(
        validateProductOperationalQuantity({
          quantita: quantity,
          quantitaFrazionabile: false,
        }).toCanonical(),
      ).toBe(String(Number(quantity))),
  );

  it.each(["1.5", "0.1", "2.000001"])(
    "rifiuta la frazione %s per un prodotto non frazionabile",
    (quantity) =>
      expect(() =>
        validateProductOperationalQuantity({
          quantita: quantity,
          quantitaFrazionabile: false,
        }),
      ).toThrow("deve essere un numero intero"),
  );

  it.each([
    ["0.1", "0.1"],
    ["1,25", "1.25"],
    ["0.000001", "0.000001"],
  ])("accetta %s entro la precisione inventariale", (quantity, expected) => {
    expect(
      validateProductOperationalQuantity({
        quantita: quantity,
        quantitaFrazionabile: true,
      }).toCanonical(),
    ).toBe(expected);
  });

  it("rifiuta una precisione superiore a quella inventariale", () => {
    expect(() =>
      validateProductOperationalQuantity({
        quantita: "0.0000001",
        quantitaFrazionabile: true,
      }),
    ).toThrow("al massimo 6 decimali");
  });
});
