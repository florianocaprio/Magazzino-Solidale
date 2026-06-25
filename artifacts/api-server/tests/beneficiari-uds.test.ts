import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, cittaTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";

/**
 * UDS unification: an explicit `uds` boolean flag (independent of zonaUdsId)
 * lets one shared person record belong to UDS and/or a Centro. Covers the
 * GET ?uds filter and the città-HARD-boundary guard on UDS creation.
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

let cittaA: number;

const appAs = (cittaId: number | null) => makeApp({ id: 1, centroAscoltoId: null, cittaId });
const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);

beforeAll(async () => {
  cittaA = await createCitta();
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

describe("POST /beneficiari (uds)", () => {
  it("crea una persona UDS con la città e ritorna uds=true", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Mario", cognome: "Rossi", uds: true, cittaId: cittaA });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
    beneficiarioIds.push(res.body.id);
  });

  it("rifiuta una persona UDS senza città per un caller globale (400)", async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Senza", cognome: "Citta", uds: true });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it('rifiuta uds passato come stringa "true" senza città (no type-confusion bypass)', async () => {
    const res = await request(appAs(null))
      .post("/beneficiari")
      .send({ nome: "Coerce", cognome: "Citta", uds: "true" });
    expect(res.status).toBe(400);
    if (res.body?.id) beneficiarioIds.push(res.body.id);
  });

  it("un caller con città pinnata può creare una persona UDS senza inviare cittaId", async () => {
    const res = await request(appAs(cittaA))
      .post("/beneficiari")
      .send({ nome: "Auto", cognome: "Citta", uds: true });
    expect(res.status).toBe(201);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
    beneficiarioIds.push(res.body.id);
  });
});

describe("PATCH /beneficiari/:id (uds boundary)", () => {
  it("un caller globale non può attivare uds su una persona senza città (400)", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "NoCitta", cognome: rnd(), cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(400);
  });

  it("un caller globale può attivare uds se la persona ha una città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "ConCitta", cognome: rnd(), cittaId: cittaA })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
  });

  it('rifiuta uds="true" (stringa) su una persona senza città per un caller globale', async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "CoercePatch", cognome: rnd(), cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: "true" });
    expect(res.status).toBe(400);
  });

  it("un caller con città attiva uds su un record legacy senza città auto-assegnando la propria città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "Legacy", cognome: rnd(), cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(cittaA)).patch(`/beneficiari/${b.id}`).send({ uds: true });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
  });

  it("un caller globale può attivare uds assegnando contestualmente la città", async () => {
    const [b] = await db
      .insert(beneficiariTable)
      .values({ codice: `BEN-${rnd()}`, nome: "AssegnaCitta", cognome: rnd(), cittaId: null })
      .returning({ id: beneficiariTable.id });
    beneficiarioIds.push(b.id);
    const res = await request(appAs(null)).patch(`/beneficiari/${b.id}`).send({ uds: true, cittaId: cittaA });
    expect(res.status).toBe(200);
    expect(res.body.uds).toBe(true);
    expect(res.body.cittaId).toBe(cittaA);
  });
});

describe("GET /beneficiari?uds", () => {
  it("ritorna solo le persone con uds=true", async () => {
    const u = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "UdsOnly", cognome: rnd(), uds: true });
    const n = await request(appAs(cittaA)).post("/beneficiari").send({ nome: "NoUds", cognome: rnd(), uds: false });
    beneficiarioIds.push(u.body.id, n.body.id);

    const res = await request(appAs(cittaA)).get("/beneficiari").query({ uds: "true", cittaId: String(cittaA) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(u.body.id);
    expect(ids).not.toContain(n.body.id);
  });
});
