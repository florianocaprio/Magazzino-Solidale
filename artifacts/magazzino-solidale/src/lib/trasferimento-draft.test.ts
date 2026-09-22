import { describe, expect, it } from "vitest";
import { trasferimentoDraftIsDirty } from "./trasferimento-draft";

const initial = {
  note: "Consegna mattutina",
  righe: [
    { prodottoId: "11", quantita: "5", unitaMisura: "pz" },
    { prodottoId: "12", quantita: "2.5", unitaMisura: "kg" },
  ],
};

describe("draft modifica Trasferimento", () => {
  it("resta pulito finché note e righe non cambiano", () => {
    expect(
      trasferimentoDraftIsDirty(initial, {
        note: initial.note,
        righe: initial.righe.map((riga) => ({ ...riga })),
      }),
    ).toBe(false);
  });

  it("rileva modifiche a note, quantità e ordine delle righe", () => {
    expect(
      trasferimentoDraftIsDirty(initial, { ...initial, note: "Nuova nota" }),
    ).toBe(true);
    expect(
      trasferimentoDraftIsDirty(initial, {
        ...initial,
        righe: [{ ...initial.righe[0], quantita: "4" }, initial.righe[1]],
      }),
    ).toBe(true);
    expect(
      trasferimentoDraftIsDirty(initial, {
        ...initial,
        righe: [...initial.righe].reverse(),
      }),
    ).toBe(true);
  });
});
