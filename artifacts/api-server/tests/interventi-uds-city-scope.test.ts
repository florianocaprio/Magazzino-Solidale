import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
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
const cittaIds: number[] = [];
let operatorUserId: number;
let cittaOperatore: number;
let cittaEsterna: number;
let centroOperatore: number;
let zonaOperatore: number;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as {
      user: {
        id: number;
        centroAscoltoId: number;
        cittaId: number;
        zonaUdsId: number;
        aree: string[];
      };
    }).user = {
      id: operatorUserId,
      centroAscoltoId: centroOperatore,
      cittaId: cittaOperatore,
      zonaUdsId: zonaOperatore,
      aree: ["uds"],
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

async function createCitta(nome: string): Promise<number> {
  const [citta] = await db.insert(cittaTable).values({ nome }).returning({ id: cittaTable.id });
  cittaIds.push(citta.id);
  return citta.id;
}

async function createCentro(cittaId: number): Promise<number> {
  const [centro] = await db
    .insert(centriAscoltoTable)
    .values({ nome: `Centro ${rnd()}`, cittaId })
    .returning({ id: centriAscoltoTable.id });
  centroIds.push(centro.id);
  return centro.id;
}

async function createZona(cittaId: number): Promise<number> {
  const [zona] = await db
    .insert(zoneUdsTable)
    .values({ nome: `Zona ${rnd()}`, cittaId })
    .returning({ id: zoneUdsTable.id });
  zonaIds.push(zona.id);
  return zona.id;
}

async function createBeneficiario(
  cittaId: number | null,
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
      cittaId,
      centroAscoltoId,
      zonaUdsId,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(beneficiario.id);
  return beneficiario.id;
}

beforeAll(async () => {
  cittaOperatore = await createCitta(`Roma ${rnd()}`);
  cittaEsterna = await createCitta(`Milano ${rnd()}`);
  centroOperatore = await createCentro(cittaOperatore);
  zonaOperatore = await createZona(cittaOperatore);
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `uds_int_scope_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore UDS",
      attivo: true,
      centroAscoltoId: centroOperatore,
      cittaId: cittaOperatore,
      zonaUdsId: zonaOperatore,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  if (zonaIds.length > 0) await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (cittaIds.length > 0) await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds));
  await pool.end();
});

describe("Interventi UDS con confine città", () => {
  it("consente storico e inserimento per una persona UDS della stessa città anche in altro centro e zona", async () => {
    const altroCentro = await createCentro(cittaOperatore);
    const altraZona = await createZona(cittaOperatore);
    const beneficiarioId = await createBeneficiario(cittaOperatore, altroCentro, altraZona);
    const [storico] = await db
      .insert(interventiTable)
      .values({ beneficiarioId, dataIntervento: "2026-08-14", tipoIntervento: "ascolto" })
      .returning({ id: interventiTable.id });
    interventoIds.push(storico.id);

    const list = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId) });
    expect(list.status).toBe(200);
    expect(list.body.map((row: { id: number }) => row.id)).toContain(storico.id);

    const created = await request(makeApp())
      .post("/interventi")
      .send({ beneficiarioId, dataIntervento: "2026-08-14", tipoIntervento: "ascolto" });
    expect(created.status).toBe(201);
    interventoIds.push(created.body.id);
  });

  it.each([
    ["un'altra città", () => createBeneficiario(cittaEsterna, null, null)],
    ["città NULL", () => createBeneficiario(null, null, null)],
  ])("non espone né consente interventi UDS per %s", async (_label, createPerson) => {
    const beneficiarioId = await createPerson();
    const list = await request(makeApp())
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId) });
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);

    const created = await request(makeApp())
      .post("/interventi")
      .send({ beneficiarioId, dataIntervento: "2026-08-14", tipoIntervento: "ascolto" });
    expect(created.status).toBe(403);
  });
});
