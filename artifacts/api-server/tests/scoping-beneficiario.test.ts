import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import consegneRouter from "../src/routes/consegne";
import bolleRouter from "../src/routes/bolle";
import interventiRouter from "../src/routes/interventi";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createBeneficiario,
  createUtente,
  insertConsegna,
  insertBolla,
  insertIntervento,
} from "./scope-helpers";

/**
 * Centro scoping for indirect-link entities (consegne, bolle, interventi):
 * the centro is reached via the linked beneficiario. A scoped caller sees rows
 * whose beneficiario is own-centro or shared (NULL), and create/PATCH may not
 * attach a record to a beneficiario/magazzino outside the caller's centro (IDOR).
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let benA: number;
let benB: number;
let benNull: number;
let magNull: number;
let magB: number;

const idsOf = (body: unknown) => (body as Array<{ id: number }>).map((r) => r.id);
const appAs = (router: Parameters<typeof makeScopedApp>[0], centro: number | null) =>
  makeScopedApp(router, { id: operatoreId, centroAscoltoId: centro });

beforeAll(async () => {
  bootScope = newScope();
  operatoreId = await createUtente(bootScope, {});
});

beforeEach(async () => {
  scope = newScope();
  centroA = await createCentro(scope);
  centroB = await createCentro(scope);
  benA = await createBeneficiario(scope, centroA);
  benB = await createBeneficiario(scope, centroB);
  benNull = await createBeneficiario(scope, null);
  magNull = await createMagazzino(scope, null);
  magB = await createMagazzino(scope, centroB);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Consegne — scoping via beneficiario", () => {
  it("lista: A vede le consegne di benA + beneficiario comune, non quelle di benB", async () => {
    const cA = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const cB = await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const cNull = await insertConsegna(scope, { beneficiarioId: benNull, magazzinoId: magNull });
    const res = await request(appAs(consegneRouter, centroA)).get("/consegne");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(cA);
    expect(ids).toContain(cNull);
    expect(ids).not.toContain(cB);
  });

  it("lista: il caller globale vede tutto", async () => {
    const cA = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const cB = await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const res = await request(appAs(consegneRouter, null)).get("/consegne");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([cA, cB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const cB = await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const res = await request(appAs(consegneRouter, centroA)).get(`/consegne/${cB}`);
    expect(res.status).toBe(403);
  });

  it("POST: non può creare per un beneficiario di un altro centro → 403", async () => {
    const res = await request(appAs(consegneRouter, centroA))
      .post("/consegne")
      .send({
        beneficiarioId: benB,
        tipoConsegna: "domicilio",
        dataPrevista: "2026-06-01",
        magazzinoId: magNull,
      });
    expect(res.status).toBe(403);
  });

  it("POST: non può usare un magazzino di un altro centro → 403", async () => {
    const res = await request(appAs(consegneRouter, centroA))
      .post("/consegne")
      .send({
        beneficiarioId: benA,
        tipoConsegna: "domicilio",
        dataPrevista: "2026-06-01",
        magazzinoId: magB,
      });
    expect(res.status).toBe(403);
  });

  it("POST: crea per un beneficiario del proprio centro", async () => {
    const res = await request(appAs(consegneRouter, centroA))
      .post("/consegne")
      .send({
        beneficiarioId: benA,
        tipoConsegna: "domicilio",
        dataPrevista: "2026-06-01",
        magazzinoId: magNull,
      });
    expect(res.status).toBe(201);
    scope.consegnaIds.push(res.body.id);
  });

  it("PATCH IDOR: spostare la consegna su un beneficiario/magazzino di un altro centro → 403", async () => {
    const cA = await insertConsegna(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const appA = appAs(consegneRouter, centroA);
    expect((await request(appA).patch(`/consegne/${cA}`).send({ beneficiarioId: benB })).status).toBe(403);
    expect((await request(appA).patch(`/consegne/${cA}`).send({ magazzinoId: magB })).status).toBe(403);
  });

  it("azioni (associa-bolla/completa) fuori centro → 403", async () => {
    const cB = await insertConsegna(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const appA = appAs(consegneRouter, centroA);
    expect((await request(appA).post(`/consegne/${cB}/associa-bolla`).send({})).status).toBe(403);
    expect((await request(appA).post(`/consegne/${cB}/completa`).send({})).status).toBe(403);
  });
});

describe("Bolle — scoping via beneficiario", () => {
  it("lista: A vede le bolle di benA + comune, non quelle di benB", async () => {
    const bA = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const bB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const bNull = await insertBolla(scope, { beneficiarioId: benNull, magazzinoId: magNull });
    const res = await request(appAs(bolleRouter, centroA)).get("/bolle");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(bA);
    expect(ids).toContain(bNull);
    expect(ids).not.toContain(bB);
  });

  it("lista: il caller globale vede tutto", async () => {
    const bA = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const bB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const res = await request(appAs(bolleRouter, null)).get("/bolle");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([bA, bB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const bB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const res = await request(appAs(bolleRouter, centroA)).get(`/bolle/${bB}`);
    expect(res.status).toBe(403);
  });

  it("POST: non può creare per un beneficiario di un altro centro → 403", async () => {
    const res = await request(appAs(bolleRouter, centroA))
      .post("/bolle")
      .send({ beneficiarioId: benB, magazzinoId: magNull });
    expect(res.status).toBe(403);
  });

  it("POST: crea per un beneficiario del proprio centro", async () => {
    const res = await request(appAs(bolleRouter, centroA))
      .post("/bolle")
      .send({ beneficiarioId: benA, magazzinoId: magNull });
    expect(res.status).toBe(201);
    scope.bollaIds.push(res.body.id);
  });

  it("PATCH IDOR: spostare la bolla su un beneficiario/magazzino di un altro centro → 403", async () => {
    const bA = await insertBolla(scope, { beneficiarioId: benA, magazzinoId: magNull });
    const appA = appAs(bolleRouter, centroA);
    expect((await request(appA).patch(`/bolle/${bA}`).send({ beneficiarioId: benB })).status).toBe(403);
    expect((await request(appA).patch(`/bolle/${bA}`).send({ magazzinoId: magB })).status).toBe(403);
  });

  it("azioni (righe/conferma/consegna/annulla) fuori centro → 403", async () => {
    const bB = await insertBolla(scope, { beneficiarioId: benB, magazzinoId: magNull });
    const appA = appAs(bolleRouter, centroA);
    expect((await request(appA).post(`/bolle/${bB}/righe`).send({})).status).toBe(403);
    expect((await request(appA).delete(`/bolle/${bB}/righe/1`)).status).toBe(403);
    expect((await request(appA).post(`/bolle/${bB}/conferma`).send({})).status).toBe(403);
    expect((await request(appA).post(`/bolle/${bB}/consegna`).send({})).status).toBe(403);
    expect((await request(appA).post(`/bolle/${bB}/annulla`).send({})).status).toBe(403);
  });
});

describe("Interventi — scoping via beneficiario", () => {
  it("lista: A vede gli interventi di benA + comune, non quelli di benB", async () => {
    const iA = await insertIntervento(scope, { beneficiarioId: benA });
    const iB = await insertIntervento(scope, { beneficiarioId: benB });
    const iNull = await insertIntervento(scope, { beneficiarioId: benNull });
    const res = await request(appAs(interventiRouter, centroA)).get("/interventi");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(iA);
    expect(ids).toContain(iNull);
    expect(ids).not.toContain(iB);
  });

  it("lista: il caller globale vede tutto", async () => {
    const iA = await insertIntervento(scope, { beneficiarioId: benA });
    const iB = await insertIntervento(scope, { beneficiarioId: benB });
    const res = await request(appAs(interventiRouter, null)).get("/interventi");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([iA, iB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const iB = await insertIntervento(scope, { beneficiarioId: benB });
    const res = await request(appAs(interventiRouter, centroA)).get(`/interventi/${iB}`);
    expect(res.status).toBe(403);
  });

  it("POST: non può creare per un beneficiario di un altro centro → 403", async () => {
    const res = await request(appAs(interventiRouter, centroA))
      .post("/interventi")
      .send({ beneficiarioId: benB, dataIntervento: "2026-06-01", tipoIntervento: "pacco_alimentare" });
    expect(res.status).toBe(403);
  });

  it("POST: crea per un beneficiario del proprio centro", async () => {
    const res = await request(appAs(interventiRouter, centroA))
      .post("/interventi")
      .send({ beneficiarioId: benA, dataIntervento: "2026-06-01", tipoIntervento: "pacco_alimentare" });
    expect(res.status).toBe(201);
    scope.interventoIds.push(res.body.id);
  });

  it("PATCH IDOR: spostare l'intervento su un beneficiario di un altro centro → 403", async () => {
    const iA = await insertIntervento(scope, { beneficiarioId: benA });
    const res = await request(appAs(interventiRouter, centroA))
      .patch(`/interventi/${iA}`)
      .send({ beneficiarioId: benB });
    expect(res.status).toBe(403);
  });
});
