import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import {
  db,
  pool,
  beneficiariTable,
  areeOperativeTable,
  auditConfigurazioniTable,
  interventiTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import interventiRouter from "../src/routes/interventi";
import udsRouter from "../src/routes/uds";
import { updateModuloAmbiente } from "../src/lib/configurazioneAmbiente";

/**
 * UDS note: interventi carry a dedicated `noteUds` field (distinct from `note`,
 * which the UDS view uses as "Materiale"). This covers the create/update of
 * noteUds AND that the LIST endpoint (which drives the UDS interventi screen)
 * returns it, so the yellow "note present" state persists across refetches.
 */

const rnd = () => Math.random().toString(36).slice(2, 8);
let operatorUserId: number;
let areaOperativaId: number;

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (
      req as unknown as {
        user: {
          id: number;
          centroAscoltoId: number | null;
          areaOperativaId: number | null;
          aree: string[];
          permessi: string[];
        };
      }
    ).user = {
      id: operatorUserId,
      centroAscoltoId: null,
      areaOperativaId,
      aree: ["sociale", "uds"],
      permessi: [
        "uds.interventi.view",
        "uds.interventi.create",
        "uds.interventi.note",
      ],
    };
    next();
  });
  app.use(udsRouter);
  app.use(interventiRouter);
  return app;
}

const interventoIds: number[] = [];
const beneficiarioIds: number[] = [];
let beneficiarioId: number;

beforeAll(async () => {
  await updateModuloAmbiente("UDS", true, null);
  const [areaOperativa] = await db
    .insert(areeOperativeTable)
    .values({ nome: `Area Note UDS ${rnd()}` })
    .returning({ id: areeOperativeTable.id });
  areaOperativaId = areaOperativa.id;
  const [operator] = await db
    .insert(utentiTable)
    .values({
      username: `interventi_test_${rnd()}`,
      passwordHash: "test-only",
      nome: "Operatore Interventi Test",
      areaOperativaId,
      attivo: true,
    })
    .returning({ id: utentiTable.id });
  operatorUserId = operator.id;

  const [b] = await db
    .insert(beneficiariTable)
    .values({
      codice: `BEN-${rnd()}`,
      nome: "NoteUds",
      cognome: rnd(),
      sesso: "M",
      uds: true,
      areaOperativaId,
    })
    .returning({ id: beneficiariTable.id });
  beneficiarioId = b.id;
  beneficiarioIds.push(b.id);
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
  await db
    .delete(auditConfigurazioniTable)
    .where(eq(auditConfigurazioniTable.utenteId, operatorUserId));
  await db.delete(utentiTable).where(eq(utentiTable.id, operatorUserId));
  await db
    .delete(areeOperativeTable)
    .where(eq(areeOperativeTable.id, areaOperativaId));
  await pool.end();
});

describe("Nota UDS dedicata", () => {
  it("persiste noteUds con versione e lo ritorna nella LIST", async () => {
    const app = makeApp();
    const created = await request(app).post("/uds/interventi").send({
      beneficiarioId,
      tipoIntervento: "ascolto",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    interventoIds.push(id);
    expect(created.body.noteUds ?? null).toBeNull();

    const patched = await request(app)
      .patch(`/uds/interventi/${id}/nota`)
      .send({ versione: created.body.versione, noteUds: "Nota gialla" });
    expect(patched.status).toBe(200);
    expect(patched.body.noteUds).toBe("Nota gialla");

    const list = await request(app)
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
    expect(list.status).toBe(200);
    const found = (
      list.body as Array<{ id: number; noteUds: string | null }>
    ).find((r) => r.id === id);
    expect(found?.noteUds).toBe("Nota gialla");
  });

  it("mantiene note (materiale) e noteUds come campi distinti", async () => {
    const app = makeApp();
    const created = await request(app).post("/uds/interventi").send({
      beneficiarioId,
      tipoIntervento: "distribuzione",
      note: "Coperta",
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;
    interventoIds.push(id);

    const noted = await request(app).patch(`/uds/interventi/${id}/nota`).send({
      versione: created.body.versione,
      noteUds: "Da ricontattare",
    });
    expect(noted.status).toBe(200);

    const list = await request(app)
      .get("/interventi")
      .query({ beneficiarioId: String(beneficiarioId), ambito: "uds" });
    const found = (
      list.body as Array<{
        id: number;
        note: string | null;
        noteUds: string | null;
      }>
    ).find((r) => r.id === id);
    expect(found?.note).toBe("Coperta");
    expect(found?.noteUds).toBe("Da ricontattare");
  });
});
