import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  interventiTable,
  pool,
  utentiTable,
  zoneUdsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";

const rnd = () => Math.random().toString(36).slice(2, 8);
const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];
const areaOperativaIds: number[] = [];
let operatorUserId: number;
let areaOperativaOperatore: number;
let areaOperativaEsterna: number;
let centroOperatore: number;
let zonaOperatore: number;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          centroAscoltoId: number;
          areaOperativaId: number;
          zonaUdsId: number;
          aree: string[];
          permessi: string[];
        };
      }
    ).user = {
      id: operatorUserId,
      centroAscoltoId: centroOperatore,
      areaOperativaId: areaOperativaOperatore,
      zonaUdsId: zonaOperatore,
      aree: ["uds"],
      permessi: ["uds.interventi.view", "uds.interventi.create"],
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createAreaOperativa(nome: string): Promise<number> {
  const [areaOperativa] = await db
    .insert(areeOperativeTable)
    .values({ nome })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(areaOperativa.id);
  return areaOperativa.id;
}

async function createCentro(areaOperativaId: number): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, areaOperativaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createZona(areaOperativaId: number): Promise<number> {
  const [zona] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona ${rnd()}`, areaOperativaId })
    .returning({ id: zoneUdsTable.id });
  zonaIds.push(zona.id);
  return zona.id;
}

async function createBeneficiario(
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
  zonaUdsId: number | null,
): Promise<number> {
  const [beneficiario] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: "Persona",
      cognome: rnd(),
      sesso: "M",
      uds: true,
      areaOperativaId,
      centroAscoltoId,
      zonaUdsId,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

beforeAll(async () => {
  areaOperativaOperatore = await createAreaOperativa(`Roma ${rnd()}`);
  areaOperativaEsterna = await createAreaOperativa(`Milano ${rnd()}`);
  centroOperatore = await createCentro(areaOperativaOperatore);
  zonaOperatore = await createZona(areaOperativaOperatore);
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `uds_int_scope_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore UDS",
      attivo: true,
      centroAscoltoId: centroOperatore,
      areaOperativaId: areaOperativaOperatore,
      zonaUdsId: zonaOperatore,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    await db
      .delete(interventiTable)
      .where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db
      .delete(beneficiariTable)
      .where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  if (zonaIds.length > 0)
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  if (centroIds.length > 0) {
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (areaOperativaIds.length > 0)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areaOperativaIds));
  await pool.end();
});

describe("Interventi UDS con confine area operativa", () => {
  it("consente storico e inserimento per una persona UDS della stessa area operativa anche in altro centro e zona", async () => {
    const altroCentro = await createCentro(areaOperativaOperatore);
    const altraZona = await createZona(areaOperativaOperatore);
    const beneficiarioId = await createBeneficiario(
      areaOperativaOperatore,
      altroCentro,
      altraZona,
    );
    const [storico] = await db
      .insert(interventiTable)
      .values({
        beneficiarioId,
        dataIntervento: "2026-08-14",
        tipoIntervento: "ascolto",
        ambito: "uds",
        areaOperativaIdSnapshot: areaOperativaOperatore,
        zonaUdsIdSnapshot: altraZona,
      })
      .returning({ id: interventiTable.id });
    interventoIds.push(storico.id);

    const list = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: number }) => row.id)).toContain(
      storico.id,
    );

    const created = await request(makeApp()).post("/interventi").send({
      beneficiarioId,
      dataIntervento: "2026-08-14",
      tipoIntervento: "ascolto",
      ambito: "uds",
    });
    expect(created.status).toBe(201);
    interventoIds.push(created.body.id);
  });

  it.each([
    [
      "un'altra area operativa",
      () => createBeneficiario(areaOperativaEsterna, null, null),
    ],
    ["area operativa NULL", () => createBeneficiario(null, null, null)],
  ])(
    "non espone né consente interventi UDS per %s",
    async (_label, createPerson) => {
      const beneficiarioId = await createPerson();
      const list = await request(makeApp())
        .get("/interventi")
        .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
      expect(list.status).toBe(200);
      expect(list.body).toEqual([]);

      const created = await request(makeApp()).post("/interventi").send({
        beneficiarioId,
        dataIntervento: "2026-08-14",
        tipoIntervento: "ascolto",
        ambito: "uds",
      });
      expect(created.status).toBe(403);
    },
  );
});
