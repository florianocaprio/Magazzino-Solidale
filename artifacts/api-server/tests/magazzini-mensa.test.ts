import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import {
  bolleTable,
  centriAscoltoTable,
  areeOperativeTable,
  db,
  magazziniTable,
  menseTable,
  pool,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import magazziniRouter from "../src/routes/magazzini";

let app: Express;
const magazzinoIds: number[] = [];
const centroIds: number[] = [];
const areaOperativaIds: number[] = [];
const bollaIds: number[] = [];

function makeApp(): Express {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as unknown as { user: Record<string, unknown> }).user = {
      id: null,
      isAdmin: true,
      isSuperAdmin: true,
      centroAscoltoId: null,
      areaOperativaId: null,
    };
    next();
  });
  result.use(magazziniRouter);
  return result;
}

async function createArea(nome: string): Promise<number> {
  const [row] = await db
    .insert(areeOperativeTable)
    .values({ nome })
    .returning({ id: areeOperativeTable.id });
  areaOperativaIds.push(row.id);
  return row.id;
}

async function createMensaMagazzino(areaOperativaId: number) {
  const response = await request(app).post("/magazzini").send({
    nome: "Mensa gestita dai Magazzini",
    tipoMagazzino: "mensa",
    areaOperativaId,
    indirizzo: "Via Test 1",
  });
  expect(response.status).toBe(201);
  magazzinoIds.push(response.body.id);
  return response.body as { id: number; codice: string };
}

beforeEach(() => {
  app = makeApp();
});

afterEach(async () => {
  if (bollaIds.length > 0) {
    await db.delete(bolleTable).where(inArray(bolleTable.id, bollaIds));
    bollaIds.length = 0;
  }
  if (magazzinoIds.length > 0) {
    await db
      .delete(menseTable)
      .where(inArray(menseTable.magazzinoId, magazzinoIds));
    await db
      .delete(magazziniTable)
      .where(inArray(magazziniTable.id, magazzinoIds));
    magazzinoIds.length = 0;
  }
  if (centroIds.length > 0) {
    await db
      .delete(centriAscoltoTable)
      .where(inArray(centriAscoltoTable.id, centroIds));
    centroIds.length = 0;
  }
  if (areaOperativaIds.length > 0) {
    await db.delete(areeOperativeTable).where(inArray(areeOperativeTable.id, areaOperativaIds));
    areaOperativaIds.length = 0;
  }
});

afterAll(async () => {
  await pool.end();
});

describe("Magazzino con tag Mensa", () => {
  it("crea automaticamente e atomicamente il dettaglio operativo Mensa", async () => {
    const areaOperativaId = await createArea(`Area Mensa ${Date.now()}`);
    const magazzino = await createMensaMagazzino(areaOperativaId);

    expect(magazzino.codice).toMatch(/^MAG-\d+$/);
    const [mensa] = await db
      .select()
      .from(menseTable)
      .where(eq(menseTable.magazzinoId, magazzino.id));
    expect(mensa).toMatchObject({
      nome: "Mensa gestita dai Magazzini",
      areaOperativaId,
      indirizzo: "Via Test 1",
      attiva: true,
    });
    expect(mensa.codice).toBe(`MEN-MAG-${magazzino.id}`);
  });

  it("richiede un'Area valida", async () => {
    const response = await request(app)
      .post("/magazzini")
      .send({ nome: "Mensa senza Area", tipoMagazzino: "mensa" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Area");
  });

  it("rifiuta un Centro inattivo o appartenente a un'altra Area", async () => {
    const areaOperativaId = await createArea(`Area A ${Date.now()}`);
    const altraAreaOperativaId = await createArea(`Area B ${Date.now()}`);
    const [centro] = await db
      .insert(centriAscoltoTable)
      .values({ nome: `Centro Mensa ${Date.now()}`, areaOperativaId: altraAreaOperativaId })
      .returning({ id: centriAscoltoTable.id });
    centroIds.push(centro.id);

    const wrongArea = await request(app).post("/magazzini").send({
      nome: "Mensa Centro fuori Area",
      tipoMagazzino: "mensa",
      areaOperativaId,
      centroAscoltoId: centro.id,
    });
    expect(wrongArea.status).toBe(400);
    expect(wrongArea.body.error).toContain("stessa Area");

    await db
      .update(centriAscoltoTable)
      .set({ areaOperativaId, attivo: false })
      .where(eq(centriAscoltoTable.id, centro.id));
    const inactive = await request(app).post("/magazzini").send({
      nome: "Mensa Centro inattivo",
      tipoMagazzino: "mensa",
      areaOperativaId,
      centroAscoltoId: centro.id,
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error).toContain("non è attivo");
  });

  it("sincronizza modifiche e disattivazione senza consentire il cambio di tipo", async () => {
    const areaOperativaId = await createArea(`Area Sync ${Date.now()}`);
    const magazzino = await createMensaMagazzino(areaOperativaId);

    const updated = await request(app)
      .patch(`/magazzini/${magazzino.id}`)
      .send({
        nome: "Mensa aggiornata",
        indirizzo: "Via Nuova 2",
        stato: "inattivo",
      });
    expect(updated.status).toBe(200);

    const [mensa] = await db
      .select()
      .from(menseTable)
      .where(eq(menseTable.magazzinoId, magazzino.id));
    expect(mensa).toMatchObject({
      nome: "Mensa aggiornata",
      indirizzo: "Via Nuova 2",
      attiva: false,
    });

    const retag = await request(app)
      .patch(`/magazzini/${magazzino.id}`)
      .send({ tipoMagazzino: "logistico" });
    expect(retag.status).toBe(409);
  });

  it("elimina insieme il dettaglio Mensa quando non esiste alcuno storico", async () => {
    const areaOperativaId = await createArea(`Area Delete ${Date.now()}`);
    const magazzino = await createMensaMagazzino(areaOperativaId);

    const response = await request(app).delete(`/magazzini/${magazzino.id}`);
    expect(response.status).toBe(204);

    const [mensa] = await db
      .select({ id: menseTable.id })
      .from(menseTable)
      .where(eq(menseTable.magazzinoId, magazzino.id));
    const [warehouse] = await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(eq(magazziniTable.id, magazzino.id));
    expect(mensa).toBeUndefined();
    expect(warehouse).toBeUndefined();
  });

  it("non elimina una Mensa presente in una bolla ma consente di disattivarla", async () => {
    const areaOperativaId = await createArea(`Area Bolla ${Date.now()}`);
    const magazzino = await createMensaMagazzino(areaOperativaId);
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `BM-${Date.now()}`,
        dataBolla: "2026-08-15",
        beneficiarioId: 1,
        magazzinoId: magazzino.id,
      })
      .returning({ id: bolleTable.id });
    bollaIds.push(bolla.id);

    const deletion = await request(app).delete(`/magazzini/${magazzino.id}`);
    expect(deletion.status).toBe(409);
    expect(deletion.body.error).toContain("bolla");
    expect(deletion.body.error).toContain("disattivarlo");

    const deactivation = await request(app)
      .patch(`/magazzini/${magazzino.id}`)
      .send({ stato: "inattivo" });
    expect(deactivation.status).toBe(200);
    expect(deactivation.body.stato).toBe("inattivo");
  });

  it("applica lo stesso blocco alle bolle di un normale magazzino logistico", async () => {
    const created = await request(app)
      .post("/magazzini")
      .send({ nome: "Magazzino logistico con bolla" });
    expect(created.status).toBe(201);
    magazzinoIds.push(created.body.id);
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `BL-${Date.now()}`,
        dataBolla: "2026-08-15",
        beneficiarioId: 1,
        magazzinoId: created.body.id,
      })
      .returning({ id: bolleTable.id });
    bollaIds.push(bolla.id);

    const deletion = await request(app).delete(`/magazzini/${created.body.id}`);
    expect(deletion.status).toBe(409);
    expect(deletion.body.error).toContain("bolla");
  });
});
