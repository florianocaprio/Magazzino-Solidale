import { describe, expect, it } from "vitest";
import {
  mergeVolontarioNextState,
  normalizeVolontarioPatch,
  validateVolontarioState,
} from "../src/lib/volontariValidation";

const valid = {
  nome: "Ada",
  cognome: "Rossi",
  codiceFiscale: "RSSMRA80A01H501U",
  codiceFiscaleNonDisponibile: false,
  dataNascita: "1980-01-01",
  luogoNascita: "Roma",
  indirizzoResidenza: "Via Roma 1",
  indirizzoDomicilio: null,
  email: "ada@example.test",
  centroAscoltoId: 1,
  ruoloVolontarioId: 2,
  maxConsegneTurno: 5,
  tipoVolontario: "PERMANENTE",
};

describe("Volontari — validazione salvataggio atomica", () => {
  it("accetta uno stato anagrafico completo", () => {
    expect(validateVolontarioState(valid)).toEqual({});
  });

  it.each([
    ["nome", null],
    ["cognome", "  "],
    ["luogoNascita", null],
    ["dataNascita", "2026-02-31"],
    ["indirizzoResidenza", ""],
    ["ruoloVolontarioId", 0],
    ["maxConsegneTurno", -1],
  ] as const)("segnala il campo obbligatorio %s", (field, value) => {
    expect(
      validateVolontarioState({ ...valid, [field]: value }),
    ).toHaveProperty(field);
  });

  it("restituisce tutti gli errori senza fermarsi al primo", () => {
    const errors = validateVolontarioState({
      ...valid,
      nome: "",
      cognome: "",
      luogoNascita: null,
      dataNascita: null,
      indirizzoResidenza: null,
      ruoloVolontarioId: null,
    });
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining([
        "nome",
        "cognome",
        "luogoNascita",
        "dataNascita",
        "indirizzoResidenza",
        "ruoloVolontarioId",
      ]),
    );
  });

  it("accetta CF assente quando l'indisponibilità è esplicita", () => {
    expect(
      validateVolontarioState({
        ...valid,
        codiceFiscale: null,
        codiceFiscaleNonDisponibile: true,
        codiceFiscaleNota: null,
      }),
    ).toEqual({});
  });

  it.each([
    [null, false],
    ["RSSMRA80A01H501U", true],
    ["ABC", false],
  ] as const)(
    "rifiuta la combinazione CF %s / indisponibile %s",
    (cf, unavailable) => {
      expect(
        validateVolontarioState({
          ...valid,
          codiceFiscale: cf,
          codiceFiscaleNonDisponibile: unavailable,
        }),
      ).toHaveProperty("codiceFiscale");
    },
  );

  it("valida formato email e limiti testuali", () => {
    const errors = validateVolontarioState({
      ...valid,
      nome: "x".repeat(81),
      email: "non-valida",
    });
    expect(errors).toMatchObject({
      nome: expect.stringMatching(/80/),
      email: expect.stringMatching(/non valido/i),
    });
  });

  it("normalizza spazi, CF, email, telefoni e stringhe vuote", () => {
    expect(
      normalizeVolontarioPatch({
        nome: "  Ada  ",
        codiceFiscale: " rss mra 80a01 h501u ",
        email: " ADA@EXAMPLE.TEST ",
        telefono: "+39 333-123",
        note: "   ",
      }),
    ).toMatchObject({
      nome: "Ada",
      codiceFiscale: "RSSMRA80A01H501U",
      codiceFiscaleNormalizzato: "RSSMRA80A01H501U",
      email: "ada@example.test",
      telefono: "+39333123",
      note: null,
    });
  });

  it("preserva gli assenti e applica null come cancellazione esplicita", () => {
    const next = mergeVolontarioNextState(
      valid,
      normalizeVolontarioPatch({ email: null }),
    );
    expect(next.nome).toBe(valid.nome);
    expect(next.email).toBeNull();
  });

  it("richiede centro e giornata solo nei profili che lo prevedono", () => {
    expect(
      validateVolontarioState({ ...valid, centroAscoltoId: null }),
    ).toEqual({});
    expect(
      validateVolontarioState(
        { ...valid, centroAscoltoId: null },
        { requireCenter: true },
      ),
    ).toHaveProperty("centroAscoltoId");
    expect(
      validateVolontarioState(
        { ...valid, tipoVolontario: "TEMPORANEO", dataServizio: null },
        { validateTemporaryServiceDate: true },
      ),
    ).toHaveProperty("dataServizio");
  });
});
