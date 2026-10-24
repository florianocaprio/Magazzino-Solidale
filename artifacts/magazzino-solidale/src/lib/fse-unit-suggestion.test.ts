import { describe, expect, it } from "vitest";
import { suggestFseContent, suggestFseUnit } from "./fse-unit-suggestion";

const stock = {
  prodottoEsterno: "Olio",
  unitaMisuraPeso: "l",
  giacenzaPezzi: "60",
  errorCodes: [],
};
const row = {
  prodottoEsterno: "Olio",
  tipoMovimento: "CARICO",
  quantitaPezzi: "60",
};
describe("unità proposta dai dati FSE", () => {
  it.each(["kg", "l"])(
    "propone pezzi conservando separatamente il contenuto in %s",
    (unit) => {
      expect(
        suggestFseUnit("olio", [{ ...stock, unitaMisuraPeso: unit }], [row]),
      ).toEqual({ unit: "pz", source: "pieces" });
    },
  );
  it("non deduce kg/l dal nome e usa pz quando è la quantità disponibile", () => {
    expect(suggestFseUnit("Olio", [], [row])).toEqual({
      unit: "pz",
      source: "pieces",
    });
    expect(
      suggestFseUnit(
        "Olio da 1 L",
        [],
        [{ ...row, prodottoEsterno: "Olio da 1 L", quantitaPezzi: null }],
      ),
    ).toEqual({ unit: null, source: "unknown" });
  });
  it("mantiene pezzi anche se il peso richiede una verifica separata", () => {
    expect(
      suggestFseUnit(
        "Olio",
        [stock, { ...stock, unitaMisuraPeso: "kg" }],
        [row],
      ).unit,
    ).toBe("pz");
    expect(
      suggestFseUnit(
        "Olio",
        [
          {
            ...stock,
            unitaMisuraPeso: null,
            errorCodes: ["UNITA_PESO_NON_RICONOSCIUTA"],
          },
        ],
        [row],
      ).unit,
    ).toBe("pz");
  });
  it("non utilizza l'unità di un prodotto diverso", () => {
    expect(
      suggestFseUnit("Pasta", [stock], [{ ...row, prodottoEsterno: "Pasta" }]),
    ).toEqual({ unit: "pz", source: "pieces" });
  });
});

it("propone il contenuto per pezzo solo quando è univoco", () => {
  expect(suggestFseContent("Olio", [{ ...stock, pesoUnita: "0.5" }])).toEqual({ fattoreKgLtPezzo: 0.5, unitaMisuraPeso: "l" });
  expect(suggestFseContent("Olio", [{ ...stock, pesoUnita: "0.5" }, { ...stock, pesoUnita: "1" }]).fattoreKgLtPezzo).toBeNull();
  expect(suggestFseContent("Olio", [{ ...stock, pesoUnita: "0.5", unitaMisuraPeso: "?" }]).fattoreKgLtPezzo).toBeNull();
});
