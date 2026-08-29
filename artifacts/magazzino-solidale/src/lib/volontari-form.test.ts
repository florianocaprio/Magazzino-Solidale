import { describe, expect, it } from "vitest";
import {
  buildVolunteerCreatePayload,
  buildVolunteerUpdatePayload,
  normalizeVolunteerFiscalCode,
  validateVolunteerDraft,
  volunteerApiErrorData,
  type VolunteerDraft,
} from "./volontari-form";

const validDraft = (): VolunteerDraft => ({
  nome: "Ada",
  cognome: "Rossi",
  tipoVolontario: "PERMANENTE",
  centroAscoltoId: 1,
  ruoloVolontarioId: 2,
  telefono: "",
  telefonoSecondario: "",
  email: "ada@example.test",
  luogoNascita: "Roma",
  dataNascita: "1980-01-01",
  indirizzoResidenza: "Via Roma 1",
  indirizzoDomicilio: "",
  domicilioCoincideResidenza: true,
  codiceFiscale: "RSS MRA 80A01 H501 U",
  codiceFiscaleNonDisponibile: false,
  codiceFiscaleNota: "",
  patente: false,
  mezzoPersonale: false,
  maxConsegneTurno: 5,
  note: "",
  dataServizio: "",
});

describe("form volontari — validazione e payload", () => {
  it("accetta il form completo", () => {
    expect(validateVolunteerDraft(validDraft(), { editing: false })).toEqual(
      {},
    );
  });

  it.each([
    ["nome", ""],
    ["cognome", ""],
    ["luogoNascita", ""],
    ["dataNascita", ""],
    ["indirizzoResidenza", ""],
    ["ruoloVolontarioId", 0],
    ["maxConsegneTurno", -1],
  ] as const)("evidenzia %s prima della chiamata API", (field, value) => {
    expect(
      validateVolunteerDraft(
        { ...validDraft(), [field]: value },
        { editing: false },
      ),
    ).toHaveProperty(field);
  });

  it("mostra insieme tutti i campi mancanti", () => {
    const errors = validateVolunteerDraft(
      {
        ...validDraft(),
        nome: "",
        cognome: "",
        luogoNascita: "",
        dataNascita: "",
        indirizzoResidenza: "",
        ruoloVolontarioId: 0,
      },
      { editing: true },
    );
    expect(Object.keys(errors)).toHaveLength(6);
  });

  it("richiede il domicilio quando non coincide", () => {
    expect(
      validateVolunteerDraft(
        { ...validDraft(), domicilioCoincideResidenza: false },
        { editing: true },
      ),
    ).toHaveProperty("indirizzoDomicilio");
  });

  it("accetta CF indisponibile senza nota", () => {
    expect(
      validateVolunteerDraft(
        {
          ...validDraft(),
          codiceFiscale: "",
          codiceFiscaleNonDisponibile: true,
        },
        { editing: true },
      ),
    ).toEqual({});
  });

  it.each([
    ["", false],
    ["RSSMRA80A01H501U", true],
    ["ABC", false],
  ] as const)("rifiuta CF %s con indisponibile=%s", (cf, unavailable) => {
    expect(
      validateVolunteerDraft(
        {
          ...validDraft(),
          codiceFiscale: cf,
          codiceFiscaleNonDisponibile: unavailable,
        },
        { editing: true },
      ),
    ).toHaveProperty("codiceFiscale");
  });

  it("valida email e giornata del temporaneo in creazione", () => {
    const errors = validateVolunteerDraft(
      { ...validDraft(), email: "non-valida", tipoVolontario: "TEMPORANEO" },
      { editing: false },
    );
    expect(errors).toMatchObject({
      email: expect.any(String),
      dataServizio: expect.any(String),
    });
  });

  it("non richiede la giornata temporanea durante la modifica", () => {
    expect(
      validateVolunteerDraft(
        { ...validDraft(), tipoVolontario: "TEMPORANEO" },
        { editing: true },
      ),
    ).toEqual({});
  });

  it("normalizza il codice fiscale", () => {
    expect(normalizeVolunteerFiscalCode(" rss mra-80a01 h501u ")).toBe(
      "RSSMRA80A01H501U",
    );
  });

  it("costruisce la creazione completa con null espliciti", () => {
    expect(buildVolunteerCreatePayload(validDraft(), null)).toMatchObject({
      tipoVolontario: "PERMANENTE",
      codiceFiscale: "RSSMRA80A01H501U",
      telefono: null,
      indirizzoDomicilio: null,
      note: null,
    });
  });

  it("include la giornata solo per la creazione temporanea", () => {
    expect(
      buildVolunteerCreatePayload(
        {
          ...validDraft(),
          tipoVolontario: "TEMPORANEO",
          dataServizio: "2026-08-28",
        },
        null,
      ),
    ).toHaveProperty("dataServizio", "2026-08-28");
  });

  it("costruisce una PATCH a delta senza tipo o stato", () => {
    const initial = validDraft();
    const payload = buildVolunteerUpdatePayload(
      { ...initial, nome: "Ada Maria" },
      initial,
      null,
      7,
    );
    expect(payload).toEqual({ nome: "Ada Maria", versione: 7 });
    expect(payload).not.toHaveProperty("tipoVolontario");
    expect(payload).not.toHaveProperty("attivo");
  });

  it("invia null quando un opzionale viene cancellato", () => {
    const initial = { ...validDraft(), email: "ada@example.test" };
    expect(
      buildVolunteerUpdatePayload({ ...initial, email: "" }, initial, null, 2),
    ).toEqual({ email: null, versione: 2 });
  });

  it("usa il centro bloccato senza produrre falsi delta", () => {
    const initial = { ...validDraft(), centroAscoltoId: 5 };
    expect(buildVolunteerUpdatePayload(initial, initial, 5, 3)).toEqual({
      versione: 3,
    });
  });

  it("mappa fieldErrors top-level e fallback details", () => {
    expect(
      volunteerApiErrorData({
        data: { fieldErrors: { nome: "Obbligatorio" } },
      }),
    ).toMatchObject({ fieldErrors: { nome: "Obbligatorio" } });
    expect(
      volunteerApiErrorData({
        data: { details: { fieldErrors: { cognome: "Obbligatorio" } } },
      }),
    ).toMatchObject({ fieldErrors: { cognome: "Obbligatorio" } });
  });

  it("preserva codice, messaggio e correlationId del server", () => {
    expect(
      volunteerApiErrorData({
        data: {
          code: "API_INTERNAL_ERROR",
          message: "Errore interno",
          correlationId: "corr-123",
        },
      }),
    ).toMatchObject({
      code: "API_INTERNAL_ERROR",
      message: "Errore interno",
      correlationId: "corr-123",
    });
  });
});
