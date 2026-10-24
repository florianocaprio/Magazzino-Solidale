import { describe, expect, it } from "vitest";
import { suggestFseUnit } from "./fse-unit-suggestion";

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
    "preferisce l'unità esplicita %s anche quando sono presenti i pezzi",
    (unit) => {
      expect(
        suggestFseUnit("olio", [{ ...stock, unitaMisuraPeso: unit }], [row]),
      ).toEqual({ unit, source: "file" });
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
  it("chiede una scelta in presenza di unità discordanti o non riconosciute", () => {
    expect(
      suggestFseUnit(
        "Olio",
        [stock, { ...stock, unitaMisuraPeso: "kg" }],
        [row],
      ).unit,
    ).toBeNull();
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
    ).toBeNull();
  });
  it("non utilizza l'unità di un prodotto diverso", () => {
    expect(
      suggestFseUnit("Pasta", [stock], [{ ...row, prodottoEsterno: "Pasta" }]),
    ).toEqual({ unit: "pz", source: "pieces" });
  });
});
