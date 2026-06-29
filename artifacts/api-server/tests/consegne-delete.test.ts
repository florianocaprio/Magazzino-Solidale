/* @vitest-environment node */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool, db, consegneTable, bolleTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import consegneRouter from "../src/routes/consegne";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createBeneficiario,
  createCitta,
  insertConsegna,
  insertBolla,
} from "./scope-helpers";

/**
 * DELETE /consegne/:id — annulla un'intera pianificazione: scollega le bolle
 * collegate (senza eliminarle) ed elimina la consegna. Copre 404, 403 (fuori
 * dal proprio centro) e il caso di successo con scollegamento bolla.
 */

let scope: SeedScope;

const appGlobal = () => makeScopedApp(consegneRouter, { id: 0, centroAscoltoId: null, cittaId: null });

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

describe("DELETE /consegne/:id", () => {
  it("ritorna 404 per una consegna inesistente", async () => {
    const res = await request(appGlobal()).delete("/consegne/999999999").send();
    expect(res.status).toBe(404);
  });

  it("elimina la consegna e scollega (senza eliminare) le bolle collegate", async () => {
    const centro = await createCentro(scope);
    const mag = await createMagazzino(scope, centro);
    const ben = await createBeneficiario(scope, centro);
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });
    const bollaId = await insertBolla(scope, { beneficiarioId: ben, magazzinoId: mag });
    await db.update(bolleTable).set({ consegnaId }).where(eq(bolleTable.id, bollaId));

    const res = await request(appGlobal()).delete(`/consegne/${consegnaId}`).send();
    expect(res.status).toBe(204);

    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
    expect(consegna).toBeUndefined();

    const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
    expect(bolla).toBeDefined();
    expect(bolla.consegnaId).toBeNull();
  });

  it("ritorna 403 per una consegna fuori dal proprio centro", async () => {
    const centroA = await createCentro(scope);
    const centroB = await createCentro(scope);
    const mag = await createMagazzino(scope, centroA);
    const ben = await createBeneficiario(scope, centroA);
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });

    const appScoped = makeScopedApp(consegneRouter, { id: 0, centroAscoltoId: centroB, cittaId: null });
    const res = await request(appScoped).delete(`/consegne/${consegnaId}`).send();
    expect(res.status).toBe(403);

    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
    expect(consegna).toBeDefined();
  });

  it("ritorna 403 per una consegna di un'altra città", async () => {
    const cittaA = await createCitta(scope);
    const cittaB = await createCitta(scope);
    const centro = await createCentro(scope);
    const mag = await createMagazzino(scope, centro);
    const ben = await createBeneficiario(scope, centro, { cittaId: cittaA });
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });

    const appScoped = makeScopedApp(consegneRouter, { id: 0, centroAscoltoId: null, cittaId: cittaB });
    const res = await request(appScoped).delete(`/consegne/${consegnaId}`).send();
    expect(res.status).toBe(403);

    const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
    expect(consegna).toBeDefined();
  });
});
