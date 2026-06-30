import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, magazziniTable, centriAscoltoTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import magazziniRouter from "../src/routes/magazzini";

let app: Express;
const createdIds: number[] = [];

/** Builds a minimal app mounting only the magazzini router. */
function makeApp(isAdmin = true): Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { isAdmin: boolean; centroAscoltoId: null; cittaId: null } }).user = {
      isAdmin,
      centroAscoltoId: null,
      cittaId: null,
    };
    next();
  });
  a.use(magazziniRouter);
  return a;
}

/** Mounts the router behind a middleware injecting a caller scoped to `centroId`. */
function makeAppAs(centroId: number | null, isAdmin = true): Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { user: { isAdmin: boolean; centroAscoltoId: number | null } }).user = {
      isAdmin,
      centroAscoltoId: centroId,
    };
    next();
  });
  a.use(magazziniRouter);
  return a;
}

/** Creates a warehouse via the API and tracks its id for cleanup. */
async function createMagazzino(body: Record<string, unknown>) {
  const res = await request(app).post("/magazzini").send(body);
  expect(res.status).toBe(201);
  createdIds.push(res.body.id);
  return res.body;
}

/** Highest existing MAG-<n> number across the whole table (0 if none). */
async function currentMaxMag(): Promise<number> {
  const rows = await db.select({ codice: magazziniTable.codice }).from(magazziniTable);
  let max = 0;
  for (const r of rows) {
    const m = /^MAG-(\d+)$/.exec(r.codice);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

beforeEach(() => {
  app = makeApp();
});

afterEach(async () => {
  if (createdIds.length > 0) {
    await db.delete(magazziniTable).where(inArray(magazziniTable.id, createdIds));
    createdIds.length = 0;
  }
});

afterAll(async () => {
  await pool.end();
});

describe("POST /magazzini — auto-generazione codice", () => {
  it("assegna un MAG-NNN sequenziale quando non è fornito alcun codice", async () => {
    const before = await currentMaxMag();
    const m = await createMagazzino({ nome: "Magazzino Senza Codice" });

    const expected = `MAG-${String(before + 1).padStart(3, "0")}`;
    expect(m.codice).toBe(expected);

    // Persistito davvero, non solo nella risposta.
    const [row] = await db
      .select({ codice: magazziniTable.codice })
      .from(magazziniTable)
      .where(inArray(magazziniTable.id, [m.id]));
    expect(row.codice).toBe(expected);
  });

  it("rispetta un codice fornito esplicitamente (trimmato)", async () => {
    const m = await createMagazzino({ nome: "Magazzino Con Codice", codice: "  WH-CUSTOM-1  " });
    expect(m.codice).toBe("WH-CUSTOM-1");

    const [row] = await db
      .select({ codice: magazziniTable.codice })
      .from(magazziniTable)
      .where(inArray(magazziniTable.id, [m.id]));
    expect(row.codice).toBe("WH-CUSTOM-1");
  });

  it("ripiega sull'auto-generazione quando il codice è solo spazi", async () => {
    const before = await currentMaxMag();
    const m = await createMagazzino({ nome: "Magazzino Spazi", codice: "   " });

    const expected = `MAG-${String(before + 1).padStart(3, "0")}`;
    expect(m.codice).toBe(expected);
  });

  it("continua la numerazione dal MAG-<n> massimo esistente", async () => {
    // Punto di partenza deterministico al di sopra di qualsiasi codice esistente.
    const base = (await currentMaxMag()) + 500;
    const baseCodice = `MAG-${String(base).padStart(3, "0")}`;
    const first = await createMagazzino({ nome: "Magazzino Base", codice: baseCodice });
    expect(first.codice).toBe(baseCodice);

    // Il prossimo auto-generato deve essere base + 1.
    const next = await createMagazzino({ nome: "Magazzino Successivo" });
    expect(next.codice).toBe(`MAG-${String(base + 1).padStart(3, "0")}`);
  });
});

describe("POST /magazzini — codice duplicato", () => {
  it("restituisce 409 (non 500) quando il codice fornito è già in uso", async () => {
    const codice = `DUP-${Date.now()}`;
    await createMagazzino({ nome: "Primo", codice });

    const res = await request(app).post("/magazzini").send({ nome: "Secondo", codice });
    expect(res.status).toBe(409);
    expect(res.body.error).toBeTruthy();

    // Nessun secondo record è stato creato con quel codice.
    const rows = await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(eq(magazziniTable.codice, codice));
    expect(rows.length).toBe(1);
  });
});

describe("Mutazioni /magazzini — admin only", () => {
  it("rifiuta la creazione per un non-admin", async () => {
    const res = await request(makeApp(false))
      .post("/magazzini")
      .send({ nome: "Non Admin" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Accesso riservato agli amministratori");
  });
});

describe("Scoping per Centro di Ascolto", () => {
  let centroA: number;
  let centroB: number;
  let magA: number;
  let magB: number;
  let magComune: number;

  beforeEach(async () => {
    const [a, b] = await db
      .insert(centriAscoltoTable)
      .values([{ nome: `Test Centro A ${Date.now()}` }, { nome: `Test Centro B ${Date.now()}` }])
      .returning({ id: centriAscoltoTable.id });
    centroA = a.id;
    centroB = b.id;

    const suffix = Date.now() % 1_000_000;
    const rows = await db
      .insert(magazziniTable)
      .values([
        { codice: `SA-${suffix}`, nome: "Mag A", centroAscoltoId: centroA },
        { codice: `SB-${suffix}`, nome: "Mag B", centroAscoltoId: centroB },
        { codice: `SC-${suffix}`, nome: "Mag Comune", centroAscoltoId: null },
      ])
      .returning({ id: magazziniTable.id });
    magA = rows[0].id;
    magB = rows[1].id;
    magComune = rows[2].id;
    createdIds.push(magA, magB, magComune);
  });

  afterEach(async () => {
    // Delete dependent magazzini before the referenced centri (FK has no cascade).
    if (createdIds.length > 0) {
      await db.delete(magazziniTable).where(inArray(magazziniTable.id, createdIds));
      createdIds.length = 0;
    }
    await db.delete(centriAscoltoTable).where(inArray(centriAscoltoTable.id, [centroA, centroB]));
  });

  it("un caller legato al centro A vede solo i magazzini del centro A e quelli comuni (NULL)", async () => {
    const scopedApp = makeAppAs(centroA);
    const res = await request(scopedApp).get("/magazzini");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((m) => m.id);
    expect(ids).toContain(magA);
    expect(ids).toContain(magComune);
    expect(ids).not.toContain(magB);
  });

  it("un caller globale (centro null) vede tutti i magazzini", async () => {
    const globalApp = makeAppAs(null);
    const res = await request(globalApp).get("/magazzini");
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: number }>).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([magA, magB, magComune]));
  });

  it("GET /magazzini/:id restituisce 403 per un magazzino fuori dal centro del caller", async () => {
    const scopedApp = makeAppAs(centroA);
    const res = await request(scopedApp).get(`/magazzini/${magB}`);
    expect(res.status).toBe(403);
  });

  it("POST /magazzini auto-assegna e blocca il centro del caller", async () => {
    const scopedApp = makeAppAs(centroA);
    const res = await request(scopedApp)
      .post("/magazzini")
      .send({ nome: "Creato Scoped", centroAscoltoId: centroB });
    expect(res.status).toBe(201);
    createdIds.push(res.body.id);
    expect(res.body.centroAscoltoId).toBe(centroA);
  });

  it("PATCH /magazzini/:id restituisce 403 per un magazzino fuori dal centro del caller", async () => {
    const scopedApp = makeAppAs(centroA);
    const res = await request(scopedApp).patch(`/magazzini/${magB}`).send({ nome: "Hack" });
    expect(res.status).toBe(403);
  });

  it("DELETE /magazzini/:id restituisce 403 per un magazzino fuori dal centro del caller", async () => {
    const scopedApp = makeAppAs(centroA);
    const res = await request(scopedApp).delete(`/magazzini/${magB}`);
    expect(res.status).toBe(403);
  });
});
