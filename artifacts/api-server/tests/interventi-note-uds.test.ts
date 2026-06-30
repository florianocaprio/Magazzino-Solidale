import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import { db, pool, beneficiariTable, interventiTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";

/**
 * UDS note: interventi carry a dedicated `noteUds` field (distinct from `note`,
 * which the UDS view uses as "Materiale"). This covers the create/update of
 * noteUds AND that the LIST endpoint (which drives the UDS interventi screen)
 * returns it, so the yellow "note present" state persists across refetches.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: { id: number; centroAscoltoId: number | null; cittaId: number | null } }).user = {
      id: 1,
      centroAscoltoId: null,
      cittaId: null,
    };
    next();
  });
  app.use(interventiRouter);
  return app;
}

const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
let beneficiarioId: number;

beforeAll(async () => {
  const [b] = await db
    .insert(beneficiariTable)
    .values({ codice: `BEN-${rnd()}`, nome: "NoteUds", cognome: rnd(), sesso: "M", uds: true, cittaId: null })
    .returning({ id: beneficiariTable.id });
  beneficiarioId = b.id;
  beneficiarioIds.push(b.id);
});

afterAll(async () => {
  if (interventoIds.length > 0) {
    await db.delete(interventiTable).where(inArray(interventiTable.id, interventoIds));
  }
  if (beneficiarioIds.length > 0) {
    await db.delete(beneficiariTable).where(inArray(beneficiariTable.id, beneficiarioIds));
  }
  await pool.end();
});

describe("noteUds su /interventi", () => {
  it("persiste noteUds in PATCH e lo ritorna nella LIST", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/interventi")
      .send({ beneficiarioId, dataIntervento: "2026-06-25", tipoIntervento: "ascolto" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    interventoIds.push(id);
    expect(created.body.noteUds ?? null).toBeNull();

    const patched = await request(app).patch(`/interventi/${id}`).send({ noteUds: "Nota gialla" });
    expect(patched.status).toBe(200);
    expect(patched.body.noteUds).toBe("Nota gialla");

    const list = await request(app).get("/interventi").query({ beneficiarioId: String(beneficiarioId) });
    expect(list.status).toBe(200);
    const found = (list.body as Array<{ id: number; noteUds: string | null }>).find((r) => r.id === id);
    expect(found?.noteUds).toBe("Nota gialla");
  });

  it("mantiene note (materiale) e noteUds come campi distinti", async () => {
    const app = makeApp();
    const created = await request(app)
      .post("/interventi")
      .send({ beneficiarioId, dataIntervento: "2026-06-25", tipoIntervento: "distribuzione", note: "Coperta", noteUds: "Da ricontattare" });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    interventoIds.push(id);

    const list = await request(app).get("/interventi").query({ beneficiarioId: String(beneficiarioId) });
    const found = (list.body as Array<{ id: number; note: string | null; noteUds: string | null }>).find((r) => r.id === id);
    expect(found?.note).toBe("Coperta");
    expect(found?.noteUds).toBe("Da ricontattare");
  });
});
