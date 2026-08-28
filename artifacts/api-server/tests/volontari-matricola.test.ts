/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, matricoleVolontariTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import volontariRouter from "../src/routes/volontari";
import turniRouter from "../src/routes/turni";
import {
  cleanup,
  createAreaOperativa,
  createCentroRec,
  createRuoloVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";
import {
  TEMPORARY_IDENTIFIER_ALPHABET,
  generateTemporaryVolunteerIdentifier,
} from "../src/lib/volontariMatricola";
import { pianificaNormalizzazioneMatricoleVolontari } from "../../../scripts/src/normalizzaMatricoleVolontari";

let scope: SeedScope;
let ruoloVolontarioId: number;
let centroAscoltoId: number;
let sequence = 0;

const appVolontari = () =>
  makeScopedApp(volontariRouter, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
  });
const appTurni = () =>
  makeScopedApp(turniRouter, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
  });

function volunteerPayload(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  sequence += 1;
  const payload: Record<string, unknown> = {
    nome: `Nome ${sequence}`,
    cognome: `Cognome ${sequence}`,
    tipoVolontario: "PERMANENTE",
    ruoloVolontarioId,
    centroAscoltoId,
    luogoNascita: "Roma",
    dataNascita: "1990-01-02",
    indirizzoResidenza: `Via Test ${sequence}`,
    codiceFiscaleNonDisponibile: true,
    codiceFiscaleNota: "Non disponibile nel test automatico",
    ...overrides,
  };
  if (payload.tipoVolontario === "TEMPORANEO" && payload.dataServizio == null)
    payload.dataServizio = "2026-01-01";
  return payload;
}

async function createVolunteer(overrides: Record<string, unknown> = {}) {
  const response = await request(appVolontari())
    .post("/volontari")
    .send(volunteerPayload(overrides));
  expect(response.status, response.text).toBe(201);
  scope.volontarioIds.push(response.body.id);
  return response.body as {
    id: number;
    versione: number;
    matricola: string;
    tipoVolontario: "PERMANENTE" | "TEMPORANEO";
  };
}

beforeEach(async () => {
  scope = newScope();
  const areaOperativaId = await createAreaOperativa(scope);
  centroAscoltoId = (
    await createCentroRec(scope, {
      areaOperativaId,
      nome: `Centro matricole ${Date.now()}-${sequence}`,
    })
  ).id;
  ruoloVolontarioId = await createRuoloVolontario(scope, {
    nome: `Ruolo matricola ${Date.now()}-${sequence}`,
  });
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

describe("Volontari — matricole automatiche e conversione", () => {
  it("rifiuta qualsiasi matricola manuale nel flusso ordinario", async () => {
    const response = await request(appVolontari())
      .post("/volontari")
      .send(volunteerPayload({ matricola: "MANUALE-001" }));

    expect(response.status).toBe(422);
    expect(response.body.fieldErrors.matricola).toMatch(
      /generata automaticamente/i,
    );
  });

  it("alloca progressivi permanenti distinti anche con richieste concorrenti", async () => {
    const responses = await Promise.all([
      request(appVolontari()).post("/volontari").send(volunteerPayload()),
      request(appVolontari()).post("/volontari").send(volunteerPayload()),
    ]);

    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    for (const response of responses)
      scope.volontarioIds.push(response.body.id);
    const identifiers = responses.map(
      (response) => response.body.matricola as string,
    );
    expect(new Set(identifiers).size).toBe(2);
    for (const identifier of identifiers) {
      expect(identifier).toMatch(/^[A-Z0-9]{6}-V-\d{3}$/);
    }
  });

  it("genera codici temporanei crittografici senza caratteri ambigui", async () => {
    const first = await createVolunteer({ tipoVolontario: "TEMPORANEO" });
    const second = await createVolunteer({ tipoVolontario: "TEMPORANEO" });
    const pattern = new RegExp(
      `^[${TEMPORARY_IDENTIFIER_ALPHABET}]{3}-[${TEMPORARY_IDENTIFIER_ALPHABET}]{3}$`,
    );

    expect(first.matricola).toMatch(pattern);
    expect(second.matricola).toMatch(pattern);
    expect(first.matricola).not.toBe(second.matricola);
    expect(generateTemporaryVolunteerIdentifier(() => 0)).toBe("AAA-AAA");
  });

  it("converte un temporaneo preservando lo storico e invalida preview concorrenti", async () => {
    const first = await createVolunteer({ tipoVolontario: "TEMPORANEO" });
    const second = await createVolunteer({ tipoVolontario: "TEMPORANEO" });
    const [firstPreview, secondPreview] = await Promise.all([
      request(appVolontari()).get(
        `/volontari/${first.id}/conversione-permanente/preview`,
      ),
      request(appVolontari()).get(
        `/volontari/${second.id}/conversione-permanente/preview`,
      ),
    ]);
    expect(firstPreview.status).toBe(200);
    expect(secondPreview.status).toBe(200);
    expect(firstPreview.body.preview.matricola).toBe(
      secondPreview.body.preview.matricola,
    );

    const converted = await request(appVolontari())
      .post(`/volontari/${first.id}/conversione-permanente`)
      .send({
        versioneVolontario: first.versione,
        preview: firstPreview.body.preview,
      });
    expect(converted.status, converted.text).toBe(200);
    expect(converted.body.tipoVolontario).toBe("PERMANENTE");
    expect(converted.body.matricola).not.toBe(first.matricola);
    expect(converted.body.statoAssicurazione).toBe("MANCANTE");

    const stale = await request(appVolontari())
      .post(`/volontari/${second.id}/conversione-permanente`)
      .send({
        versioneVolontario: second.versione,
        preview: secondPreview.body.preview,
      });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("PREVIEW_CONVERSIONE_SCADUTA");

    const history = await request(appVolontari()).get(
      `/volontari/${first.id}/matricole`,
    );
    expect(history.status).toBe(200);
    expect(history.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matricola: first.matricola,
          tipoIdentificativo: "TEMPORANEA",
          stato: "STORICA",
        }),
        expect.objectContaining({
          matricola: converted.body.matricola,
          tipoIdentificativo: "PERMANENTE",
          stato: "ATTIVA",
        }),
      ]),
    );
    const historicalIdentifier = history.body.find(
      (item: { stato: string }) => item.stato === "STORICA",
    );
    await expect(
      db
        .update(matricoleVolontariTable)
        .set({ noteTecniche: "Alterazione non ammessa" })
        .where(eq(matricoleVolontariTable.id, historicalIdentifier.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/non consente modifiche/i),
      }),
    });
    await expect(
      db
        .delete(matricoleVolontariTable)
        .where(eq(matricoleVolontariTable.id, historicalIdentifier.id)),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/non consente cancellazioni/i),
      }),
    });
  });

  it("traduce la concorrenza sul codice fiscale in un solo 201 e un 422", async () => {
    const codiceFiscale =
      `CF${process.pid}${Date.now().toString(36)}${sequence}`
        .replace(/[^A-Z0-9]/gi, "")
        .padEnd(16, "X")
        .slice(0, 16)
        .toUpperCase();
    const responses = await Promise.all([
      request(appVolontari())
        .post("/volontari")
        .send(
          volunteerPayload({
            codiceFiscale,
            codiceFiscaleNonDisponibile: false,
            codiceFiscaleNota: null,
          }),
        ),
      request(appVolontari())
        .post("/volontari")
        .send(
          volunteerPayload({
            codiceFiscale: `${codiceFiscale.slice(0, 2)} ${codiceFiscale.slice(2)}`,
            codiceFiscaleNonDisponibile: false,
            codiceFiscaleNota: null,
          }),
        ),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 422,
    ]);
    const created = responses.find((response) => response.status === 201);
    if (created) scope.volontarioIds.push(created.body.id);
  });

  it("genera la matricola anche nell'inserimento rapido da turni", async () => {
    const manual = await request(appTurni())
      .post("/turni/volontari-pending")
      .send({
        centroAscoltoId,
        nome: "Rapido",
        cognome: "Manuale",
        matricola: "NON-AMMESSA",
        ruoloVolontarioId,
      });
    expect(manual.status).toBe(400);

    const automatic = await request(appTurni())
      .post("/turni/volontari-pending")
      .send({
        centroAscoltoId,
        nome: "Rapido",
        cognome: "Automatico",
        ruoloVolontarioId,
      });
    expect(automatic.status, automatic.text).toBe(201);
    expect(automatic.body.matricola).toMatch(/^[A-Z0-9]{6}-V-\d{3}$/);
    scope.volontarioIds.push(automatic.body.id);
  });
});

describe("Normalizzazione matricole volontari storiche", () => {
  it("mantiene la prima matricola e suffissa i duplicati con il primo progressivo libero", () => {
    const updates = pianificaNormalizzazioneMatricoleVolontari([
      { id: 1, matricola: "V001" },
      { id: 2, matricola: "V001-01" },
      { id: 3, matricola: "V001" },
      { id: 4, matricola: null },
      { id: 5, matricola: "" },
      { id: 6, matricola: "V001" },
    ]);

    expect(updates).toEqual([
      { id: 3, matricola: "V001-02" },
      { id: 6, matricola: "V001-03" },
    ]);
  });
});
