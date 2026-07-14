import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, cittaTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";
import { initDbExtensions } from "../src/lib/dbInit";

/**
 * Fuzzy anti-duplicate search (GET /beneficiari/cerca-simili). pg_trgm-backed
 * similarity over name/soprannome/telefono/dataNascita, città-HARD-scoped: a
 * scoped caller only matches their own città (or NULL/legacy rows), a global
 * caller may narrow with ?cittaId. Threshold 0.2, ordered by score.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(user: { id: number; centroAscoltoId: number | null; cittaId: number | null }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof user }).user = user;
    next();
  });
  app.use(beneficiariRouter);
  return app;
}

const beneficiarioIds: number[] = [];
const cittaIds: number[] = [];

async function createCitta(nome = `Citta ${rnd()}`): Promise<number> {
  const [c] = await db.insert(cittaTable).values({ nome }).returning({ id: cittaTable.id });
  cittaIds.push(c.id);
  return c.id;
}

async function createBeneficiario(opts: {
  nome: string;
  cognome: string;
  cittaId: number | null;
  soprannome?: string | null;
  telefono?: string | null;
  dataNascita?: string | null;
  sesso?: string;
}): Promise<number> {
  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: opts.nome,
      cognome: opts.cognome,
      sesso: opts.sesso ?? "M",
      cittaId: opts.cittaId,
      soprannome: opts.soprannome ?? null,
      telefono: opts.telefono ?? null,
      dataNascita: opts.dataNascita ?? null,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(b.id);
  return b.id;
}

let cittaA: number;
let cittaB: number;

beforeAll(async () => {
  await initDbExtensions();
  cittaA = await createCitta();
  cittaB = await createCitta();
});

beforeEach(() => {
  beneficiarioIds.length = 0;
});

afterEach(async () => {
  if (beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds));
  }
});

afterAll(async () => {
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds));
  }
  await pool.end();
});

const appAs = (cittaId: number | null) => makeApp({ id: 1, centroAscoltoId: null, cittaId });
const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);

describe("GET /beneficiari/cerca-simili", () => {
  it("trova un nome simile (Ammed Solin ≈ Hamed Saolin) nella stessa città", async () => {
    const id = await createBeneficiario({ nome: "Hamed", cognome: "Saolin", cittaId: cittaA });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ nome: "Ammed", cognome: "Solin" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(id);
    const hit = (res.body as Array<{ id: number; score: number }>).find((r) => r.id === id);
    expect(hit!.score).toBeGreaterThanOrEqual(0.2);
  });

  it("non restituisce persone di un'altra città (confine duro)", async () => {
    const other = await createBeneficiario({ nome: "Hamed", cognome: "Saolin", cittaId: cittaB });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ nome: "Hamed", cognome: "Saolin" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).not.toContain(other);
  });

  it("ritorna [] quando non c'è nulla su cui cercare", async () => {
    await createBeneficiario({ nome: "Mario", cognome: "Rossi", cittaId: cittaA });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("esclude il record indicato da excludeId", async () => {
    const id = await createBeneficiario({ nome: "Giuseppe", cognome: "Verdi", cittaId: cittaA });
    const res = await request(appAs(cittaA))
      .get("/beneficiari/cerca-simili")
      .query({ nome: "Giuseppe", cognome: "Verdi", excludeId: String(id) });
    expect(idsOf(res.body)).not.toContain(id);
  });

  it("un caller globale può restringere a una città con ?cittaId", async () => {
    const inA = await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaA });
    const inB = await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaB });
    const res = await request(appAs(null))
      .get("/beneficiari/cerca-simili")
      .query({ nome: "Anna", cognome: "Bianchi", cittaId: String(cittaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(inA);
    expect(ids).not.toContain(inB);
  });

  it("ignora parametri numerici malformati (excludeId=abc) senza errore", async () => {
    const id = await createBeneficiario({ nome: "Paola", cognome: "Gialli", cittaId: cittaA });
    const res = await request(appAs(cittaA))
      .get("/beneficiari/cerca-simili")
      .query({ nome: "Paola", cognome: "Gialli", excludeId: "abc" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(id);
  });

  it("un match esatto su telefono alza il punteggio", async () => {
    const id = await createBeneficiario({ nome: "Luca", cognome: "Neri", cittaId: cittaA, telefono: "3331234567" });
    const res = await request(appAs(cittaA))
      .get("/beneficiari/cerca-simili")
      .query({ nome: "Luca", cognome: "Neri", telefono: "3331234567" });
    const hit = (res.body as Array<{ id: number; score: number }>).find((r) => r.id === id);
    expect(hit).toBeDefined();
    expect(hit!.score).toBeGreaterThanOrEqual(0.5);
  });
});
