import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, magazziniTable } from "@workspace/db";
import { inArray, eq } from "drizzle-orm";
import magazziniRouter from "../src/routes/magazzini";

let app: Express;
const createdIds: number[] = [];

/** Builds a minimal app mounting only the magazzini router (no auth needed). */
function makeApp(): Express {
  const a = express();
  a.use(express.json());
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
