import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { db, pool, approvvigionamentiTable, cittaTable, fornitoriTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import approvvigionamentiRouter from "../src/routes/approvvigionamenti";

const ids = { ordini: [] as number[], fornitori: [] as number[], citta: [] as number[] };
let areaA: number; let areaB: number; let fornitoreA: number; let fornitoreB: number; let inattivoA: number;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 800001, isAdmin: true, isSuperAdmin: false, cittaId: null, centroAscoltoId: null } as NonNullable<typeof req.user>;
  next();
});
app.use(approvvigionamentiRouter);

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [a, b] = await db.insert(cittaTable).values([{ nome: `Area ordine A ${suffix}` }, { nome: `Area ordine B ${suffix}` }]).returning({ id: cittaTable.id });
  areaA = a.id; areaB = b.id; ids.citta.push(areaA, areaB);
  const [fa, fb, fi] = await db.insert(fornitoriTable).values([
    { nome: `Fornitore A ${suffix}`, tipo: "azienda", cittaId: areaA, attivo: true },
    { nome: `Fornitore B ${suffix}`, tipo: "azienda", cittaId: areaB, attivo: true },
    { nome: `Fornitore inattivo ${suffix}`, tipo: "azienda", cittaId: areaA, attivo: false },
  ]).returning({ id: fornitoriTable.id });
  fornitoreA = fa.id; fornitoreB = fb.id; inattivoA = fi.id; ids.fornitori.push(fornitoreA, fornitoreB, inattivoA);
});

afterEach(async () => {
  if (ids.ordini.length) await db.delete(approvvigionamentiTable).where(inArray(approvvigionamentiTable.id, ids.ordini.splice(0)));
  if (ids.fornitori.length) await db.delete(fornitoriTable).where(inArray(fornitoriTable.id, ids.fornitori.splice(0)));
  if (ids.citta.length) await db.delete(cittaTable).where(inArray(cittaTable.id, ids.citta.splice(0)));
});
afterAll(async () => { await pool.end(); });

async function create(cittaId: number, fornitoreId: number) {
  const response = await request(app).post("/approvvigionamenti").send({ cittaId, fornitoreId, dataRichiesta: "2026-07-16", righe: [] });
  if (response.body.id) ids.ordini.push(response.body.id);
  return response;
}

describe("Area territoriale e fornitori negli ordini", () => {
  it("accetta Area A con fornitore A e Area B con fornitore B", async () => {
    expect((await create(areaA, fornitoreA)).status).toBe(201);
    expect((await create(areaB, fornitoreB)).status).toBe(201);
  });

  it("rifiuta Area A con fornitore B e il fornitore inattivo", async () => {
    expect((await create(areaA, fornitoreB)).status).toBe(400);
    expect((await create(areaA, inattivoA)).status).toBe(400);
  });

  it("consente il cambio Area soltanto insieme a un fornitore coerente", async () => {
    const created = await create(areaA, fornitoreA);
    expect((await request(app).patch(`/approvvigionamenti/${created.body.id}`).send({ cittaId: areaB, fornitoreId: fornitoreA })).status).toBe(400);
    const valid = await request(app).patch(`/approvvigionamenti/${created.body.id}`).send({ cittaId: areaB, fornitoreId: fornitoreB });
    expect(valid.status).toBe(200);
    expect(valid.body.cittaId).toBe(areaB);
  });

  it("mantiene leggibile un ordine storico privo di fornitore", async () => {
    const [historical] = await db.insert(approvvigionamentiTable).values({ codice: `STOR-${Date.now()}`, dataRichiesta: "2025-01-01" }).returning({ id: approvvigionamentiTable.id });
    ids.ordini.push(historical.id);
    const response = await request(app).get(`/approvvigionamenti/${historical.id}`);
    expect(response.status).toBe(200);
    expect(response.body.fornitoreId).toBeNull();
    expect(response.body.cittaId).toBeNull();
  });
});
