/* @vitest-environment node */

import { Router } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  matricoleVolontariTable,
  pool,
  registroVolontariEventiTable,
  volontariTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import volontariRouter from "../src/routes/volontari";
import { todayRome } from "../src/lib/volontariDomain";
import {
  cleanup,
  createAreaOperativa,
  createCentroRec,
  createRuoloVolontario,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

const routers = Router();
routers.use(volontariRouter);
const app = () =>
  makeScopedApp(routers, {
    id: 0,
    centroAscoltoId: null,
    areaOperativaId: null,
  });

let scope: SeedScope;
let centroId: number;
let ruoloId: number;
let ruoloNome: string;
let sequence = 0;
const unique = (prefix: string) =>
  `${prefix}-${process.pid}-${Date.now()}-${++sequence}`;

beforeEach(async () => {
  scope = newScope();
  const areaOperativaId = await createAreaOperativa(scope);
  centroId = (
    await createCentroRec(scope, {
      areaOperativaId,
      nome: unique("Centro validation"),
    })
  ).id;
  ruoloNome = unique("Ruolo validation");
  ruoloId = await createRuoloVolontario(scope, { nome: ruoloNome });
});

afterEach(async () => cleanup(scope));
afterAll(async () => pool.end());

function completePayload(overrides: Record<string, unknown> = {}) {
  return {
    nome: "Ada",
    cognome: unique("Rossi"),
    tipoVolontario: "PERMANENTE",
    centroAscoltoId: centroId,
    ruoloVolontarioId: ruoloId,
    codiceFiscaleNonDisponibile: true,
    luogoNascita: "Roma",
    dataNascita: "1980-01-01",
    indirizzoResidenza: "Via Roma 1",
    maxConsegneTurno: 5,
    ...overrides,
  };
}

async function insertLegacy(
  overrides: Partial<typeof volontariTable.$inferInsert> = {},
) {
  const [row] = await db
    .insert(volontariTable)
    .values({
      nome: "Legacy",
      cognome: unique("Volontario"),
      matricola: unique("LEG"),
      tipoVolontario: "PERMANENTE",
      centroAscoltoId: centroId,
      ruolo: ruoloNome,
      ruoloVolontarioId: ruoloId,
      luogoNascita: "Roma",
      dataNascita: "1980-01-01",
      indirizzoResidenza: "Via Legacy 1",
      codiceFiscale: null,
      codiceFiscaleNormalizzato: null,
      codiceFiscaleNonDisponibile: false,
      ...overrides,
    })
    .returning();
  scope.volontarioIds.push(row.id);
  return row;
}

describe("Volontari — API salvataggio e conversione", () => {
  it("restituisce tutti i fieldErrors e non scrive su creazione invalida", async () => {
    const before = await db
      .select({ id: volontariTable.id })
      .from(volontariTable);
    const response = await request(app()).post("/volontari").send({
      nome: "",
      cognome: "",
      codiceFiscaleNonDisponibile: false,
      ruoloVolontarioId: 0,
      maxConsegneTurno: -1,
    });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "VOLONTARIO_VALIDATION_ERROR",
      message: expect.any(String),
      correlationId: expect.any(String),
      fieldErrors: {
        nome: expect.any(String),
        cognome: expect.any(String),
        codiceFiscale: expect.any(String),
        dataNascita: expect.any(String),
        luogoNascita: expect.any(String),
        indirizzoResidenza: expect.any(String),
        ruoloVolontarioId: expect.any(String),
        maxConsegneTurno: expect.any(String),
      },
    });
    const after = await db
      .select({ id: volontariTable.id })
      .from(volontariTable);
    expect(after).toHaveLength(before.length);
  });

  it("mappa il codice fiscale duplicato a 409 strutturato su create e PATCH", async () => {
    const codiceFiscale = "RSSMRA80A01H501U";
    const first = await request(app())
      .post("/volontari")
      .send(
        completePayload({
          codiceFiscale,
          codiceFiscaleNonDisponibile: false,
        }),
      );
    expect(first.status, first.text).toBe(201);
    scope.volontarioIds.push(first.body.id);

    const duplicateCreate = await request(app())
      .post("/volontari")
      .send(
        completePayload({
          codiceFiscale,
          codiceFiscaleNonDisponibile: false,
        }),
      );
    expect(duplicateCreate.status).toBe(409);
    expect(duplicateCreate.body).toMatchObject({
      code: "CODICE_FISCALE_DUPLICATO",
      correlationId: expect.any(String),
      fieldErrors: { codiceFiscale: expect.any(String) },
    });

    const second = await request(app())
      .post("/volontari")
      .send(completePayload());
    expect(second.status, second.text).toBe(201);
    scope.volontarioIds.push(second.body.id);
    const duplicateUpdate = await request(app())
      .patch(`/volontari/${second.body.id}`)
      .send({
        versione: second.body.versione,
        codiceFiscale,
        codiceFiscaleNonDisponibile: false,
      });
    expect(duplicateUpdate.status).toBe(409);
    expect(duplicateUpdate.body).toMatchObject({
      code: "CODICE_FISCALE_DUPLICATO",
      fieldErrors: { codiceFiscale: expect.any(String) },
    });
  });

  it("completa un legacy senza CF con indisponibilità esplicita e nota nulla", async () => {
    const legacy = await insertLegacy();
    const response = await request(app())
      .patch(`/volontari/${legacy.id}`)
      .send({
        versione: legacy.versione,
        codiceFiscale: null,
        codiceFiscaleNonDisponibile: true,
        codiceFiscaleNota: null,
      });
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      id: legacy.id,
      codiceFiscale: null,
      codiceFiscaleNonDisponibile: true,
      codiceFiscaleNota: null,
      versione: legacy.versione + 1,
    });
  });

  it("valida il nextState legacy in modo atomico e preserva la riga", async () => {
    const legacy = await insertLegacy({
      luogoNascita: null,
      dataNascita: null,
      indirizzoResidenza: null,
    });
    const response = await request(app())
      .patch(`/volontari/${legacy.id}`)
      .send({ versione: legacy.versione, nome: "Corretto" });
    expect(response.status).toBe(422);
    expect(response.body.fieldErrors).toMatchObject({
      codiceFiscale: expect.any(String),
      luogoNascita: expect.any(String),
      dataNascita: expect.any(String),
      indirizzoResidenza: expect.any(String),
    });
    const [unchanged] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.id, legacy.id));
    expect(unchanged).toMatchObject({
      nome: legacy.nome,
      versione: legacy.versione,
      luogoNascita: null,
      dataNascita: null,
      indirizzoResidenza: null,
    });
  });

  it("rifiuta tipo e stato nel normale PATCH senza alterare la versione", async () => {
    const created = await request(app())
      .post("/volontari")
      .send(completePayload());
    expect(created.status, created.text).toBe(201);
    scope.volontarioIds.push(created.body.id);
    const typeChange = await request(app())
      .patch(`/volontari/${created.body.id}`)
      .send({ versione: created.body.versione, tipoVolontario: "TEMPORANEO" });
    expect(typeChange.status).toBe(409);
    expect(typeChange.body.code).toBe("CONVERSIONE_RICHIESTA");
    const statusChange = await request(app())
      .patch(`/volontari/${created.body.id}`)
      .send({ versione: created.body.versione, attivo: true });
    expect(statusChange.status).toBe(409);
    expect(statusChange.body.code).toBe("STATO_VOLONTARIO_NON_MODIFICABILE");
    const [unchanged] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.id, created.body.id));
    expect(unchanged.versione).toBe(created.body.versione);
  });

  it("blocca il preview di conversione incompleto senza matricole o ledger", async () => {
    const legacy = await insertLegacy({
      tipoVolontario: "TEMPORANEO",
      luogoNascita: null,
      dataNascita: null,
      indirizzoResidenza: null,
      centroAscoltoId: null,
      ruoloVolontarioId: null,
      codiceFiscaleNonDisponibile: false,
    });
    const beforeIdentifiers = await db
      .select()
      .from(matricoleVolontariTable)
      .where(eq(matricoleVolontariTable.volontarioId, legacy.id));
    const beforeLedger = await db
      .select()
      .from(registroVolontariEventiTable)
      .where(eq(registroVolontariEventiTable.volontarioId, legacy.id));
    const response = await request(app()).get(
      `/volontari/${legacy.id}/conversione-permanente/preview`,
    );
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "VOLONTARIO_CONVERSIONE_DATI_INCOMPLETI",
      fieldErrors: {
        codiceFiscale: expect.any(String),
        luogoNascita: expect.any(String),
        dataNascita: expect.any(String),
        indirizzoResidenza: expect.any(String),
        centroAscoltoId: expect.any(String),
        ruoloVolontarioId: expect.any(String),
      },
    });
    expect(
      await db
        .select()
        .from(matricoleVolontariTable)
        .where(eq(matricoleVolontariTable.volontarioId, legacy.id)),
    ).toEqual(beforeIdentifiers);
    expect(
      await db
        .select()
        .from(registroVolontariEventiTable)
        .where(eq(registroVolontariEventiTable.volontarioId, legacy.id)),
    ).toEqual(beforeLedger);
  });

  it("espone TEMPORANEA senza polizza annuale e usa la giornata come requisito", async () => {
    const today = todayRome();
    const created = await request(app())
      .post("/volontari")
      .send(
        completePayload({
          tipoVolontario: "TEMPORANEO",
          dataServizio: today,
        }),
      );
    expect(created.status, created.text).toBe(201);
    scope.volontarioIds.push(created.body.id);
    expect(created.body.statoAssicurazione).toBe("TEMPORANEA");
    await db
      .update(volontariTable)
      .set({ statoApprovazione: "approvato", attivo: true })
      .where(eq(volontariTable.id, created.body.id));
    const sameDay = await request(app()).get(
      `/volontari/${created.body.id}?dataRiferimento=${today}`,
    );
    expect(sameDay.body).toMatchObject({
      statoAssicurazione: "TEMPORANEA",
      operativo: true,
      motivoNonOperativo: null,
    });
    const outsideDay = await request(app()).get(
      `/volontari/${created.body.id}?dataRiferimento=2099-12-31`,
    );
    expect(outsideDay.body).toMatchObject({
      statoAssicurazione: "TEMPORANEA",
      operativo: false,
      motivoNonOperativo: "GIORNATA_TEMPORANEA_MANCANTE",
    });
  });
});
