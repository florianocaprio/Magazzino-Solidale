import { describe, expect, it } from "vitest";
import {
  transferLotIsAvailable,
  transferRowsForPayload,
  transferRowsHaveRequiredLots,
  trasferimentoDraftIsDirty,
} from "./trasferimento-draft";

const initial = {
  note: "Consegna mattutina",
  righe: [
    { prodottoId: "11", lottoId: "42", quantita: "5", unitaMisura: "pz" },
    { prodottoId: "12", lottoId: "", quantita: "2.5", unitaMisura: "kg" },
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

  it("include il lotto nel dirty guard e nei payload create/update, lasciando FEFO facoltativo", () => {
    expect(
      trasferimentoDraftIsDirty(initial, {
        ...initial,
        righe: [{ ...initial.righe[0], lottoId: "43" }, initial.righe[1]],
      }),
    ).toBe(true);
    expect(transferRowsForPayload(initial.righe)).toEqual([
      { prodottoId: 11, lottoId: 42, quantita: "5", unitaMisura: "pz" },
      {
        prodottoId: 12,
        lottoId: undefined,
        quantita: "2.5",
        unitaMisura: "kg",
      },
    ]);
  });

  it("richiede il lotto solo per il prodotto obbligatorio e filtra contesto, scadenza e disponibilità", () => {
    const products = [
      { id: 11, lottoFisicoObbligatorio: true },
      { id: 12, lottoFisicoObbligatorio: false },
    ];
    expect(transferRowsHaveRequiredLots(initial.righe, products)).toBe(true);
    expect(
      transferRowsHaveRequiredLots(
        [{ ...initial.righe[0], lottoId: "" }],
        products,
      ),
    ).toBe(false);
    expect(transferRowsHaveRequiredLots([initial.righe[1]], products)).toBe(
      true,
    );
    expect(transferRowsHaveRequiredLots([initial.righe[0]], [])).toBe(false);
    const lotto = {
      prodottoId: 11,
      magazzinoId: 3,
      disponibileReale: 5,
      dataScadenza: "2027-01-01",
    };
    expect(transferLotIsAvailable(lotto, 11, 3, "2026-09-23")).toBe(true);
    expect(transferLotIsAvailable(lotto, 12, 3, "2026-09-23")).toBe(false);
    expect(transferLotIsAvailable(lotto, 11, 4, "2026-09-23")).toBe(false);
    expect(
      transferLotIsAvailable(
        { ...lotto, disponibileReale: 0 },
        11,
        3,
        "2026-09-23",
      ),
    ).toBe(false);
    expect(
      transferLotIsAvailable(
        { ...lotto, dataScadenza: "2020-01-01" },
        11,
        3,
        "2026-09-23",
      ),
    ).toBe(false);
  });
});
