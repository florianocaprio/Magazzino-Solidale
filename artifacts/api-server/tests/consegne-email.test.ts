/* @vitest-environment node */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import consegneRouter from "../src/routes/consegne";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createBeneficiario,
  insertConsegna,
} from "./scope-helpers";

/**
 * Reminder email endpoints per le consegne (T7). Coprono i casi che NON
 * inviano davvero email (404 / sent=false / 403), così da blindare lo scoping
 * e la gestione best-effort senza dipendere da un provider SMTP/connector.
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

describe("POST /consegne/:id/invia-email-*", () => {
  it("ritorna 404 per una consegna inesistente", async () => {
    const res = await request(appGlobal()).post("/consegne/999999999/invia-email-beneficiario").send({});
    expect(res.status).toBe(404);
  });

  it("ritorna sent=false se il beneficiario non ha email", async () => {
    const centro = await createCentro(scope);
    const mag = await createMagazzino(scope, centro);
    const ben = await createBeneficiario(scope, centro);
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });

    const res = await request(appGlobal()).post(`/consegne/${consegnaId}/invia-email-beneficiario`).send({});
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });

  it("ritorna sent=false sull'endpoint volontario quando non c'è volontario assegnato", async () => {
    const centro = await createCentro(scope);
    const mag = await createMagazzino(scope, centro);
    const ben = await createBeneficiario(scope, centro);
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });

    const res = await request(appGlobal()).post(`/consegne/${consegnaId}/invia-email-volontario`).send({});
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });

  it("ritorna 403 quando il chiamante scoped non può accedere alla consegna", async () => {
    const centroA = await createCentro(scope);
    const centroB = await createCentro(scope);
    const mag = await createMagazzino(scope, centroA);
    const ben = await createBeneficiario(scope, centroA);
    const consegnaId = await insertConsegna(scope, { beneficiarioId: ben, magazzinoId: mag });

    const appScoped = makeScopedApp(consegneRouter, { id: 0, centroAscoltoId: centroB, cittaId: null });
    const res = await request(appScoped).post(`/consegne/${consegnaId}/invia-email-beneficiario`).send({});
    expect(res.status).toBe(403);
  });
});
