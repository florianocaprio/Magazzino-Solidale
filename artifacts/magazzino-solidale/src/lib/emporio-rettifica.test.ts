import { describe, expect, it } from "vitest";
import { creditoInteroInput, previewRimborso } from "./emporio-rettifica";
const rows = [
  {
    id: 1,
    sessioneCassaRigaId: 8,
    quantita: 0.5,
    quantitaStornabile: 0.5,
    creditoTotale: 1,
  },
  {
    id: 2,
    sessioneCassaRigaId: 8,
    quantita: 0.5,
    quantitaStornabile: 0.5,
    creditoTotale: 2,
  },
];
describe("M6.2-C preview rettifica", () => {
  it.each(["0.5", "1,5", "2.25", "NaN", "Infinity", "100000000"])(
    "C29 rifiuta credito %s",
    (value) => expect(creditoInteroInput(value)).toBeNull(),
  );
  it("C29 accetta credito intero e zero, non inventa centesimi", () => {
    expect(creditoInteroInput("5,00")).toBe(5);
    expect(creditoInteroInput("0")).toBe(0);
  });
  it("C06/C10 stesso diritto economico indipendente dal lotto", () => {
    expect(previewRimborso(rows, { 1: 0.5 }, 3)).toBeNull();
    expect(previewRimborso(rows, { 2: 0.5 }, 3)).toBeNull();
    expect(previewRimborso(rows, { 1: 0.5, 2: 0.5 }, 3)).toBe(3);
  });
  it("C08 totale riconcilia il residuo dopo credito-only", () => {
    expect(previewRimborso(rows, { 1: 0.5, 2: 0.5 }, 2)).toBe(2);
  });
  it("C09/C24 proporzione esatta a sei decimali", () => {
    expect(
      previewRimborso(
        [
          {
            ...rows[0],
            quantita: 1,
            quantitaStornabile: 1,
            creditoTotale: 1_000_000,
          },
        ],
        { 1: 0.000001 },
        1_000_000,
      ),
    ).toBe(1);
  });
  it("C27 storico frazionario e over-reso non generano preview valida", () => {
    expect(previewRimborso(rows, { 1: 1 }, 3)).toBeNull();
    expect(previewRimborso(rows, {}, 1.5)).toBeNull();
  });
});
