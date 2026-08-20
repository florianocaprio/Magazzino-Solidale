import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, cittaTable, centriAscoltoTable, zoneUdsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import beneficiariRouter from "../src/routes/beneficiari";
import { initDbExtensions } from "../src/lib/dbInit";

/**
 * Fuzzy anti-duplicate search (GET /beneficiari/cerca-simili). pg_trgm-backed
 * lookup over names in both orders, soprannome, telefono, beneficiary/tax codes,
 * plus fuzzy identity matching. Città is the only HARD scope: centro/zona are
 * ignored and NULL/other-città records are hidden from scoped callers.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(user: { id: number; centroAscoltoId: number | null; cittaId: number | null; zonaUdsId: number | null }): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: typeof user & { isAdmin: boolean; permessi: string[] } }).user = {
      ...user,
      isAdmin: false,
      permessi: ["beneficiari.duplicates.search"],
    };
    next();
  });
  app.use(beneficiariRouter);
  return app;
}

const beneficiarioIds: number[] = [];
const cittaIds: number[] = [];
const centroIds: number[] = [];
const zonaIds: number[] = [];

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
  codice?: string;
  codiceFiscale?: string | null;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
  uds?: boolean;
}): Promise<number> {
  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: opts.codice ?? `BEN-${rnd()}`,
      codiceFiscale: opts.codiceFiscale ?? null,
      nome: opts.nome,
      cognome: opts.cognome,
      sesso: opts.sesso ?? "M",
      cittaId: opts.cittaId,
      soprannome: opts.soprannome ?? null,
      telefono: opts.telefono ?? null,
      dataNascita: opts.dataNascita ?? null,
      centroAscoltoId: opts.centroAscoltoId ?? null,
      zonaUdsId: opts.zonaUdsId ?? null,
      uds: opts.uds ?? false,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioIds.push(b.id);
  return b.id;
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
  if (zonaIds.length > 0) {
    await db.delete(zoneUdsTable).where(inArray(zoneUdsTable.id, zonaIds));
  }
  if (centroIds.length > 0) {
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, centroIds));
  }
  if (cittaIds.length > 0) {
    await db.delete(cittaTable).where(inArray(cittaTable.id, cittaIds));
  }
  await pool.end();
});

const appAs = (
  cittaId: number | null,
  options: { centroAscoltoId?: number | null; zonaUdsId?: number | null } = {},
) => makeApp({
  id: 1,
  centroAscoltoId: options.centroAscoltoId ?? null,
  cittaId,
  zonaUdsId: options.zonaUdsId ?? null,
});
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

  it("un operatore trova un beneficiario Sociale non UDS della propria città anche se appartiene a un altro centro", async () => {
    const centroOperatore = await createCentro(cittaA);
    const centroPersona = await createCentro(cittaA);
    const sociale = await createBeneficiario({
      nome: "Sociale",
      cognome: "Condiviso",
      cittaId: cittaA,
      centroAscoltoId: centroPersona,
      uds: false,
    });
    const res = await request(appAs(cittaA, { centroAscoltoId: centroOperatore }))
      .get("/beneficiari/cerca-simili")
      .query({ search: "Sociale Condiviso" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(sociale);
    expect((res.body as Array<{ id: number; uds: boolean }>).find((row) => row.id === sociale)?.uds).toBe(false);
  });

  it("un operatore trova una persona UDS di un'altra zona della stessa città", async () => {
    const zonaOperatore = await createZona(cittaA);
    const altraZona = await createZona(cittaA);
    const uds = await createBeneficiario({ nome: "Altra", cognome: "Zona", cittaId: cittaA, zonaUdsId: altraZona, uds: true });
    const res = await request(appAs(cittaA, { zonaUdsId: zonaOperatore }))
      .get("/beneficiari/cerca-simili")
      .query({ search: "Altra Zona" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toContain(uds);
  });

  it("non mostra a un operatore territoriale i record legacy con città NULL", async () => {
    const legacy = await createBeneficiario({ nome: "Legacy", cognome: "SenzaCitta", cittaId: null });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ search: "Legacy SenzaCitta" });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).not.toContain(legacy);
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

  it("un caller globale deve indicare esplicitamente la città", async () => {
    const res = await request(appAs(null))
      .get("/beneficiari/cerca-simili")
      .query({ search: "Anna Bianchi" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Area/i);
  });

  it("un caller globale ricerca soltanto nella città indicata", async () => {
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

  it.each(["abc", "12abc", "0", "-1", "1.5", "1e2", "2147483648"])(
    "un cittaId globale malformato non avvia una ricerca globale: %s",
    async (cittaId) => {
      await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaA });
      await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaB });
      const res = await request(appAs(null))
        .get("/beneficiari/cerca-simili")
        .query({ search: "Anna Bianchi", cittaId });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Area/i);
    },
  );

  it("un operatore territoriale usa sempre la propria città ignorando cittaId", async () => {
    const inA = await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaA });
    const inB = await createBeneficiario({ nome: "Anna", cognome: "Bianchi", cittaId: cittaB });
    const res = await request(appAs(cittaA))
      .get("/beneficiari/cerca-simili")
      .query({ search: "Anna Bianchi", cittaId: String(cittaB) });
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(inA);
    expect(ids).not.toContain(inB);
  });

  it.each(["Marco", "Polo", "Marco Polo", "Polo Marco", "IlViaggiatore", "3337654321"])(
    "ricerca libera per i campi anagrafici previsti: %s",
    async (search) => {
      const id = await createBeneficiario({
        nome: "Marco",
        cognome: "Polo",
        soprannome: "IlViaggiatore",
        telefono: "3337654321",
        cittaId: cittaA,
      });
      const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ search });
      expect(res.status).toBe(200);
      expect(idsOf(res.body)).toContain(id);
    },
  );

  it.each([
    ["codice beneficiario", "BEN-RICERCA-42"],
    ["codice fiscale", "RSSMRA80A01H501U"],
  ])("ricerca per %s senza esporre il codice fiscale nel risultato", async (_label, search) => {
    const id = await createBeneficiario({
      nome: "Codice", cognome: "Identificativo", cittaId: cittaA,
      codice: "BEN-RICERCA-42", codiceFiscale: "RSSMRA80A01H501U",
    });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ search });
    expect(res.status).toBe(200);
    const hit = (res.body as Array<Record<string, unknown>>).find((row) => row.id === id);
    expect(hit).toBeDefined();
    expect(hit).not.toHaveProperty("codiceFiscale");
  });

  it("non esegue una ricerca libera con meno di 2 caratteri", async () => {
    await createBeneficiario({ nome: "Al", cognome: "Corto", cittaId: cittaA });
    const res = await request(appAs(cittaA)).get("/beneficiari/cerca-simili").query({ search: "A" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
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
