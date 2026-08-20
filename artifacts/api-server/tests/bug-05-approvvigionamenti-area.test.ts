import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import {
  db,
  pool,
  approvvigionamentiTable,
  approvvigionamentoRigheTable,
  areeOperativeTable,
  fornitoriTable,
  magazziniTable,
  prodottiTable,
} from "@workspace/db";
import { inArray } from "drizzle-orm";
import approvvigionamentiRouter from "../src/routes/approvvigionamenti";

const ids = { ordini: [] as number[], fornitori: [] as number[], magazzini: [] as number[], prodotti: [] as number[], areaOperativa: [] as number[] };
let areaA: number; let areaB: number; let fornitoreA: number; let fornitoreB: number; let inattivoA: number;
let magazzinoA: number; let magazzinoB: number; let prodottoId: number;

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 800001, isAdmin: true, isSuperAdmin: false, areaOperativaId: null, centroAscoltoId: null } as NonNullable<typeof req.user>;
  next();
});
app.use(approvvigionamentiRouter);

beforeEach(async () => {
  const suffix = Math.random().toString(36).slice(2, 8);
  const [a, b] = await db.insert(areeOperativeTable).values([{ nome: `Area ordine A ${suffix}` }, { nome: `Area ordine B ${suffix}` }]).returning({ id: areeOperativeTable.id });
  areaA = a.id; areaB = b.id; ids.areaOperativa.push(areaA, areaB);
  const [fa, fb, fi] = await db.insert(fornitoriTable).values([
    { nome: `Fornitore A ${suffix}`, tipo: "azienda", areaOperativaId: areaA, attivo: true },
    { nome: `Fornitore B ${suffix}`, tipo: "azienda", areaOperativaId: areaB, attivo: true },
    { nome: `Fornitore inattivo ${suffix}`, tipo: "azienda", areaOperativaId: areaA, attivo: false },
  ]).returning({ id: fornitoriTable.id });
  fornitoreA = fa.id; fornitoreB = fb.id; inattivoA = fi.id; ids.fornitori.push(fornitoreA, fornitoreB, inattivoA);
  const [ma, mb] = await db.insert(magazziniTable).values([
    { codice: `MAG-A-${suffix}`, nome: `Magazzino A ${suffix}`, areaOperativaId: areaA, stato: "attivo" },
    { codice: `MAG-B-${suffix}`, nome: `Magazzino B ${suffix}`, areaOperativaId: areaB, stato: "attivo" },
  ]).returning({ id: magazziniTable.id });
  magazzinoA = ma.id; magazzinoB = mb.id; ids.magazzini.push(magazzinoA, magazzinoB);
  const [prodotto] = await db.insert(prodottiTable).values({
    codice: `PROD-${suffix}`,
    nome: `Prodotto ${suffix}`,
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    attivo: true,
  }).returning({ id: prodottiTable.id });
  prodottoId = prodotto.id; ids.prodotti.push(prodottoId);
});

afterEach(async () => {
  if (ids.ordini.length) await db.delete(approvvigionamentoRigheTable).where(inArray(approvvigionamentoRigheTable.approvvigionamentoId, ids.ordini));
  if (ids.ordini.length) await db.delete(approvvigionamentiTable).where(inArray(approvvigionamentiTable.id, ids.ordini.splice(0)));
  if (ids.prodotti.length) await db.delete(prodottiTable).where(inArray(prodottiTable.id, ids.prodotti.splice(0)));
  if (ids.magazzini.length) await db.delete(magazziniTable).where(inArray(magazziniTable.id, ids.magazzini.splice(0)));
  if (ids.fornitori.length) await db.delete(fornitoriTable).where(inArray(fornitoriTable.id, ids.fornitori.splice(0)));
  if (ids.areaOperativa.length) await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, ids.areaOperativa.splice(0)));
});
afterAll(async () => { await pool.end(); });

async function create(areaOperativaId: number, fornitoreId: number) {
  const response = await request(app).post("/approvvigionamenti").send({
    areaOperativaId,
    fornitoreId,
    magazzinoId: areaOperativaId === areaA ? magazzinoA : magazzinoB,
    dataRichiesta: "2026-07-16",
    righe: [{ prodottoId, quantitaRichiesta: 1, unitaMisura: "pz" }],
  });
  if (response.body.id) ids.ordini.push(response.body.id);
  return response;
}

describe("Area territoriale e fornitori negli ordini", () => {
  it("esegue rollback di testata e righe quando una FK Prodotto fallisce", async () => {
    const before = await db.select({ id: approvvigionamentiTable.id }).from(approvvigionamentiTable);
    const failed = await request(app).post("/approvvigionamenti").send({
      areaOperativaId: areaA,
      fornitoreId: fornitoreA,
      magazzinoId: magazzinoA,
      dataRichiesta: "2026-07-16",
      righe: [{ prodottoId: 2_000_000_000, quantitaRichiesta: 1, unitaMisura: "pz" }],
    });
    expect(failed.status).toBe(400);
    expect(await db.select({ id: approvvigionamentiTable.id }).from(approvvigionamentiTable)).toEqual(before);

    const created = await create(areaA, fornitoreA);
    const replaceFailed = await request(app).patch(`/approvvigionamenti/${created.body.id}`).send({
      versione: created.body.versione,
      note: "non deve restare",
      righe: [{ prodottoId: 2_000_000_000, quantitaRichiesta: 2, unitaMisura: "pz" }],
    });
    expect(replaceFailed.status).toBe(400);
    const unchanged = await request(app).get(`/approvvigionamenti/${created.body.id}`);
    expect(unchanged.body.versione).toBe(created.body.versione);
    expect(unchanged.body.note).toBe(created.body.note);
    expect(unchanged.body.righe).toMatchObject([{ prodottoId, quantitaRichiesta: 1 }]);
  });

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
    expect((await request(app).patch(`/approvvigionamenti/${created.body.id}`).send({ versione: 1, areaOperativaId: areaB, fornitoreId: fornitoreA, magazzinoId: magazzinoB })).status).toBe(400);
    const valid = await request(app).patch(`/approvvigionamenti/${created.body.id}`).send({ versione: 1, areaOperativaId: areaB, fornitoreId: fornitoreB, magazzinoId: magazzinoB });
    expect(valid.status).toBe(200);
    expect(valid.body.areaOperativaId).toBe(areaB);
  });

  it("mantiene leggibile un ordine storico privo di fornitore", async () => {
    const [historical] = await db.insert(approvvigionamentiTable).values({ codice: `STOR-${Date.now()}`, dataRichiesta: "2025-01-01" }).returning({ id: approvvigionamentiTable.id });
    ids.ordini.push(historical.id);
    const response = await request(app).get(`/approvvigionamenti/${historical.id}`);
    expect(response.status).toBe(200);
    expect(response.body.fornitoreId).toBeNull();
    expect(response.body.areaOperativaId).toBeNull();
  });
});
