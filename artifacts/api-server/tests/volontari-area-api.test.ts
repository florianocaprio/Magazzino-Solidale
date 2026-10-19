import { readFileSync } from "node:fs";
import { Router } from "express";
import request from "supertest";
import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import {
  db,
  pool,
  volontariTable,
  mezziTable,
  copertureAssicurativeVolontariTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import volontari from "../src/routes/volontari";
import approvazioni from "../src/routes/approvazioni-logistica";
import turni from "../src/routes/turni";
import operazioni from "../src/routes/volontari-operazioni";
import exportsRouter from "../src/routes/volontari-export";
import mezzi from "../src/routes/mezzi";
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

const router = Router().use(
  volontari,
  approvazioni,
  turni,
  operazioni,
  mezzi,
  exportsRouter,
);
const app = (areaOperativaId: number | null = null) =>
  makeScopedApp(router, { id: 0, centroAscoltoId: null, areaOperativaId });
let scope: SeedScope;
let area: number,
  otherArea: number,
  centreA: number,
  centreB: number,
  foreignCentre: number,
  role: number;
beforeEach(async () => {
  scope = newScope();
  area = await createAreaOperativa(scope);
  otherArea = await createAreaOperativa(scope);
  centreA = (await createCentroRec(scope, { areaOperativaId: area })).id;
  centreB = (await createCentroRec(scope, { areaOperativaId: area })).id;
  foreignCentre = (await createCentroRec(scope, { areaOperativaId: otherArea }))
    .id;
  role = await createRuoloVolontario(scope);
});
afterEach(async () => cleanup(scope));
afterAll(async () => pool.end());

async function create(reference: number | null = null, temporary = false) {
  const response = await request(app(area))
    .post("/volontari")
    .send({
      nome: "Volontario",
      cognome: "Area",
      areaOperativaId: area,
      centroAscoltoId: reference,
      ruoloVolontarioId: role,
      tipoVolontario: temporary ? "TEMPORANEO" : "PERMANENTE",
      ...(temporary ? { dataServizio: todayRome() } : {}),
      codiceFiscaleNonDisponibile: true,
      luogoNascita: "Roma",
      dataNascita: "1990-01-01",
      indirizzoResidenza: "Via Test 1",
    });
  expect(response.status, response.text).toBe(201);
  scope.volontarioIds.push(response.body.id);
  expect(response.body).toMatchObject({
    areaOperativaId: area,
    centroAscoltoId: reference,
  });
  expect(
    (
      await request(app(area))
        .post(`/approvazioni-logistica/volontari/${response.body.id}/approva`)
        .send({ versione: response.body.versione })
    ).status,
  ).toBe(200);
  await db
    .insert(copertureAssicurativeVolontariTable)
    .values({
      volontarioId: response.body.id,
      dataInizio: "2000-01-01",
      dataFine: "2099-12-31",
      tipoOperazione: "NUOVA_COPERTURA",
    });
  return response.body.id as number;
}

it("Area obbligatoria, Centro facoltativo: visibilità, matricola e turni su tutta l’Area", async () => {
  for (const reference of [null, centreA]) {
    const id = await create(reference);
    const available = await request(app(area))
      .get("/volontari")
      .query({
        centroAscoltoId: centreB,
        stato: "attivi",
        dataRiferimento: todayRome(),
      });
    expect(available.body.map((v: { id: number }) => v.id)).toContain(id);
    const planned = await request(app(area))
      .put("/turni")
      .send({
        centroAscoltoId: centreB,
        data: todayRome(),
        fascia: reference == null ? "09-13" : "14-18",
        volontari: [{ volontarioId: id }],
      });
    expect(planned.status, planned.text).toBe(200);
    scope.turnoIds.push(planned.body.id);
    expect((await request(app(otherArea)).get(`/volontari/${id}`)).status).toBe(
      403,
    );
    expect(
      (await request(app(area)).get("/volontari/registro/eventi")).body.some(
        (e: { volontarioId: number }) => e.volontarioId === id,
      ),
    ).toBe(true);
    expect(
      (
        await request(app(otherArea)).get("/volontari/registro/eventi")
      ).body.some((e: { volontarioId: number }) => e.volontarioId === id),
    ).toBe(false);
    expect(
      (await request(app(otherArea)).get("/volontari")).body.map(
        (v: { id: number }) => v.id,
      ),
    ).not.toContain(id);
    expect(
      (
        await request(app(otherArea))
          .put("/turni")
          .send({
            centroAscoltoId: foreignCentre,
            data: todayRome(),
            fascia: "18-20",
            volontari: [{ volontarioId: id }],
          })
      ).status,
    ).toBe(403);
  }
});

it("temporaneo: la giornata nell’Area non vincola al Centro di riferimento", async () => {
  const id = await create(centreA, true);
  const available = await request(app(area))
    .get("/volontari")
    .query({
      centroAscoltoId: centreB,
      stato: "attivi",
      dataRiferimento: todayRome(),
    });
  expect(available.body.map((v: { id: number }) => v.id)).toContain(id);
  expect(
    (
      await request(app())
        .post(`/volontari/${id}/giornate`)
        .send({ dataServizio: "2026-11-01", centroAscoltoId: foreignCentre })
    ).status,
  ).toBe(403);
});

it("il mezzo personale senza Centro eredita l’Area: disponibile all’interno, protetto dall’esterno", async () => {
  const id = await create();
  const [vehicle] = await db
    .insert(mezziTable)
    .values({
      codice: `AREA-${id}`,
      tipo: "Auto",
      proprieta: "volontario",
      volontarioId: id,
      stato: "disponibile",
      statoApprovazione: "approvato",
    })
    .returning();
  scope.mezzoIds.push(vehicle.id);
  expect(
    (await request(app(area)).get("/mezzi")).body.map(
      (m: { id: number }) => m.id,
    ),
  ).toContain(vehicle.id);
  expect(
    (await request(app(otherArea)).get("/mezzi")).body.map(
      (m: { id: number }) => m.id,
    ),
  ).not.toContain(vehicle.id);
  expect(
    (await request(app(otherArea)).get(`/mezzi/${vehicle.id}`)).status,
  ).toBe(403);
  expect(
    (
      await request(app(otherArea))
        .patch(`/mezzi/${vehicle.id}`)
        .send({ versione: vehicle.versione, descrizione: "Fuori Area" })
    ).status,
  ).toBe(403);
  const planned = await request(app(area))
    .put("/turni")
    .send({
      centroAscoltoId: centreB,
      data: todayRome(),
      fascia: "09-13",
      mezzoId: vehicle.id,
      volontari: [{ volontarioId: id }],
    });
  expect(planned.status, planned.text).toBe(200);
  scope.turnoIds.push(planned.body.id);
});

it("rifiuta Area/Centro incoerenti e conserva i legacy senza Area senza renderli globalmente operativi", async () => {
  const id = await create();
  const current = (await request(app(area)).get(`/volontari/${id}`)).body;
  const mismatch = await request(app(area))
    .patch(`/volontari/${id}`)
    .send({ versione: current.versione, centroAscoltoId: foreignCentre });
  expect(mismatch.status).toBe(422);
  expect(
    (
      await request(app(area))
        .patch(`/volontari/${id}`)
        .send({ versione: current.versione, areaOperativaId: otherArea })
    ).status,
  ).toBe(403);
  await db
    .update(volontariTable)
    .set({ areaOperativaId: null })
    .where(eq(volontariTable.id, id));
  const legacy = (await request(app()).get(`/volontari/${id}`)).body;
  expect(legacy).toMatchObject({
    operativo: false,
    motivoNonOperativo: "AREA_OPERATIVA_MANCANTE",
  });
  expect((await request(app(area)).get(`/volontari/${id}`)).status).toBe(403);
});

it("upgrade 58→59: deriva soltanto le Aree certe, mantiene ID/storico e protegge la coerenza", async () => {
  const client = await pool.connect();
  const schema = `vol_area_${process.pid}`;
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema}, public`,
    );
    await client.query(
      "CREATE TABLE aree_operative(id integer PRIMARY KEY); CREATE TABLE centri_di_ascolto(id integer PRIMARY KEY, area_operativa_id integer); CREATE TABLE volontari(id integer PRIMARY KEY, centro_ascolto_id integer, storico text); INSERT INTO aree_operative VALUES (1),(2); INSERT INTO centri_di_ascolto VALUES (10,1),(20,2); INSERT INTO volontari VALUES (100,10,'protetto'),(101,NULL,'sconosciuto')",
    );
    await client.query(
      readFileSync(
        new URL(
          "../../../lib/db/updates/20261019_volontari_area_operativa.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(
      (await client.query("SELECT * FROM volontari ORDER BY id")).rows,
    ).toEqual([
      {
        id: 100,
        centro_ascolto_id: 10,
        storico: "protetto",
        area_operativa_id: 1,
      },
      {
        id: 101,
        centro_ascolto_id: null,
        storico: "sconosciuto",
        area_operativa_id: null,
      },
    ]);
    await client.query(
      "INSERT INTO volontari VALUES (102,NULL,'area senza centro',2)",
    );
    await expect(
      client.query("INSERT INTO volontari VALUES (103,10,'incoerente',2)"),
    ).rejects.toMatchObject({ code: "23514" });
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
