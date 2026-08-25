/* @vitest-environment node */

import express from "express";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { db, beneficiariTable, consegneTable, pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import consegneRouter from "../src/routes/consegne";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  insertConsegna,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;

beforeEach(() => {
  scope = newScope();
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

const globalApp = (permessi: string[]) => makeScopedApp(consegneRouter, {
  id: 1,
  centroAscoltoId: null,
  areaOperativaId: null,
  permessi,
});

describe("Consegne: paginazione, RBAC e scope storico", () => {
  it("pagina lato server, conta l'intero dataset e usa l'export dedicato", async () => {
    const centro = await createCentroRec(scope);
    const magazzinoId = await createMagazzino(scope, centro.id);
    const beneficiarioId = await createBeneficiario(scope, centro.id);

    const ids: number[] = [];
    for (let index = 0; index < 205; index += 1) {
      ids.push(await insertConsegna(scope, { beneficiarioId, magazzinoId }));
    }
    await db.update(consegneTable).set({ codice: "CON-RICERCA-UNIVOCA" }).where(eq(consegneTable.id, ids[117]));

    const app = globalApp(["consegne.view", "consegne.export"]);
    const first = await request(app).get("/consegne?page=1&pageSize=25");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 25, total: 205, totalPages: 9 });
    expect(first.body.items).toHaveLength(25);

    const last = await request(app).get("/consegne?page=9&pageSize=25");
    expect(last.status).toBe(200);
    expect(last.body.items).toHaveLength(5);

    const search = await request(app).get("/consegne?q=RICERCA-UNIVOCA");
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].id).toBe(ids[117]);

    const exported = await request(app).get("/consegne/export");
    expect(exported.status).toBe(200);
    expect(exported.body.total).toBe(205);
    expect(exported.body.items).toHaveLength(205);
  });

  it("separa view, manage, complete, cancel ed export", async () => {
    const viewOnly = globalApp(["consegne.view"]);
    expect((await request(viewOnly).get("/consegne")).status).toBe(200);
    expect((await request(viewOnly).get("/consegne/export")).status).toBe(403);
    expect((await request(viewOnly).post("/consegne").send({})).status).toBe(403);

    const app = express();
    app.use(express.json());
    app.use(consegneRouter);
    expect((await request(app).get("/consegne")).status).toBe(401);
  });

  it("mantiene lo scope storico delle consegne effettuate dopo il trasferimento del beneficiario", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroA = await createCentroRec(scope, { areaOperativaId: areaA });
    const centroB = await createCentroRec(scope, { areaOperativaId: areaB });
    const magazzinoId = await createMagazzino(scope, centroA.id, { areaOperativaId: areaA });
    const beneficiarioId = await createBeneficiario(scope, centroA.id, { areaOperativaId: areaA });
    const consegnaId = await insertConsegna(scope, { beneficiarioId, magazzinoId, stato: "effettuata" });
    await db.update(consegneTable).set({
      centroAscoltoIdSnapshot: centroA.id,
      areaOperativaIdSnapshot: areaA,
    }).where(eq(consegneTable.id, consegnaId));
    await db.update(beneficiariTable).set({
      centroAscoltoId: centroB.id,
      areaOperativaId: areaB,
    }).where(eq(beneficiariTable.id, beneficiarioId));

    const scopedA = makeScopedApp(consegneRouter, {
      id: 2,
      centroAscoltoId: centroA.id,
      areaOperativaId: areaA,
      permessi: ["consegne.view"],
    });
    const scopedB = makeScopedApp(consegneRouter, {
      id: 3,
      centroAscoltoId: centroB.id,
      areaOperativaId: areaB,
      permessi: ["consegne.view"],
    });

    const listA = await request(scopedA).get("/consegne");
    expect(listA.status).toBe(200);
    expect(listA.body.items.map((item: { id: number }) => item.id)).toContain(consegnaId);
    expect(listA.body.items.find((item: { id: number }) => item.id === consegnaId)).toMatchObject({
      centroAscoltoId: centroA.id,
      centroAscoltoNome: centroA.nome,
    });
    expect((await request(scopedA).get(`/consegne/${consegnaId}`)).status).toBe(200);

    const listB = await request(scopedB).get("/consegne");
    expect(listB.status).toBe(200);
    expect(listB.body.items.map((item: { id: number }) => item.id)).not.toContain(consegnaId);
    expect((await request(scopedB).get(`/consegne/${consegnaId}`)).status).toBe(403);
  });
});
