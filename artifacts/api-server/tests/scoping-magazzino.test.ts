import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import lottiRouter from "../src/routes/lotti";
import trasferimentiRouter from "../src/routes/trasferimenti";
import giacenzeRouter from "../src/routes/giacenze";
import movimentiRouter from "../src/routes/movimenti";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createCentro,
  createMagazzino,
  createProdotto,
  createFornitore,
  createUtente,
  createLotto,
  insertTrasferimento,
  insertMovimento,
} from "./scope-helpers";

/**
 * Centro scoping for magazzino-derived entities. Lotti are visible when their
 * warehouse is in the caller's visible set (own centro OR shared NULL).
 * Trasferimenti are visible when EITHER the origin OR the destination warehouse
 * is visible. Create/PATCH may not target a warehouse outside the centro (IDOR).
 */

let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let magA: number;
let magNull: number;
let magB: number;
let prod: number;
let forn: number;

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
  magA = await createMagazzino(scope, centroA);
  magNull = await createMagazzino(scope, null);
  magB = await createMagazzino(scope, centroB);
  prod = await createProdotto(scope);
  forn = await createFornitore(scope, null);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Lotti — scoping via magazzino visibile", () => {
  it("lista: A vede i lotti di magA + magazzino comune, non quelli di magB", async () => {
    const lA = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const lB = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const lNull = await createLotto(scope, { prodottoId: prod, magazzinoId: magNull, quantita: 10 });
    const res = await request(appAs(lottiRouter, centroA)).get("/lotti");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(lA);
    expect(ids).toContain(lNull);
    expect(ids).not.toContain(lB);
  });

  it("lista: il caller globale vede tutto", async () => {
    const lA = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const lB = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const res = await request(appAs(lottiRouter, null)).get("/lotti");
    expect(idsOf(res.body)).toEqual(expect.arrayContaining([lA, lB]));
  });

  it("GET /:id fuori centro → 403", async () => {
    const lB = await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const res = await request(appAs(lottiRouter, centroA)).get(`/lotti/${lB}`);
    expect(res.status).toBe(403);
  });

  it("POST: non può creare un lotto in un magazzino di un altro centro → 403", async () => {
    const res = await request(appAs(lottiRouter, centroA))
      .post("/lotti")
      .send({
        prodottoId: prod,
        magazzinoId: magB,
        dataCarico: "2026-06-01",
        quantitaCaricata: 10,
        fornitoreId: forn,
      });
    expect(res.status).toBe(403);
  });

  it("POST: crea un lotto in un magazzino del proprio centro", async () => {
    const res = await request(appAs(lottiRouter, centroA))
      .post("/lotti")
      .send({
        prodottoId: prod,
        magazzinoId: magA,
        dataCarico: "2026-06-01",
        quantitaCaricata: 10,
        fornitoreId: forn,
      });
    expect(res.status).toBe(201);
    scope.lottoIds.push(res.body.id);
  });

  it("PATCH IDOR: spostare il lotto in un magazzino di un altro centro → 403", async () => {
    const lA = await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    const res = await request(appAs(lottiRouter, centroA))
      .patch(`/lotti/${lA}`)
      .send({ magazzinoId: magB });
    expect(res.status).toBe(403);
  });
});

describe("Trasferimenti — scoping via magazzini visibili (origine O destino)", () => {
  it("lista: A vede un trasferimento che tocca un suo magazzino, non uno tutto interno a B", async () => {
    const magB2 = await createMagazzino(scope, centroB);
    const tVisible = await insertTrasferimento(scope, { origineId: magA, destinoId: magNull });
    const tHidden = await insertTrasferimento(scope, { origineId: magB, destinoId: magB2 });
    const res = await request(appAs(trasferimentiRouter, centroA)).get("/trasferimenti");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(tVisible);
    expect(ids).not.toContain(tHidden);
  });

  it("GET /:id: 200 se tocca un magazzino visibile, 403 se tutto interno a un altro centro", async () => {
    const magB2 = await createMagazzino(scope, centroB);
    const tVisible = await insertTrasferimento(scope, { origineId: magA, destinoId: magNull });
    const tHidden = await insertTrasferimento(scope, { origineId: magB, destinoId: magB2 });
    const appA = appAs(trasferimentiRouter, centroA);
    expect((await request(appA).get(`/trasferimenti/${tVisible}`)).status).toBe(200);
    expect((await request(appA).get(`/trasferimenti/${tHidden}`)).status).toBe(403);
  });

  it("POST: non può creare un trasferimento tutto interno a un altro centro → 403", async () => {
    const magB2 = await createMagazzino(scope, centroB);
    const res = await request(appAs(trasferimentiRouter, centroA))
      .post("/trasferimenti")
      .send({
        magazzinoOrigineId: magB,
        magazzinoDestinoId: magB2,
        dataRichiesta: "2026-06-01",
        trasportatoreNome: "Ritiro presso il magazzino",
        righe: [{ prodottoId: prod, quantita: 1, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(403);
  });

  it("POST: crea un trasferimento che tocca un magazzino del proprio centro", async () => {
    const res = await request(appAs(trasferimentiRouter, centroA))
      .post("/trasferimenti")
      .send({
        magazzinoOrigineId: magA,
        magazzinoDestinoId: magNull,
        dataRichiesta: "2026-06-01",
        trasportatoreNome: "Ritiro presso il magazzino",
        righe: [{ prodottoId: prod, quantita: 1, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(201);
    scope.trasferimentoIds.push(res.body.id);
  });

  it("PATCH IDOR: modificare un trasferimento tutto interno a un altro centro → 403", async () => {
    const magB2 = await createMagazzino(scope, centroB);
    const tHidden = await insertTrasferimento(scope, { origineId: magB, destinoId: magB2 });
    const res = await request(appAs(trasferimentiRouter, centroA))
      .patch(`/trasferimenti/${tHidden}`)
      .send({ righe: [{ prodottoId: prod, quantita: 2, unitaMisura: "kg" }] });
    expect(res.status).toBe(403);
  });

  it("azioni (avvia/conferma) tutto interno a un altro centro → 403", async () => {
    const magB2 = await createMagazzino(scope, centroB);
    const tHidden = await insertTrasferimento(scope, { origineId: magB, destinoId: magB2 });
    const appA = appAs(trasferimentiRouter, centroA);
    expect((await request(appA).post(`/trasferimenti/${tHidden}/avvia`).send({})).status).toBe(403);
    expect((await request(appA).post(`/trasferimenti/${tHidden}/conferma`).send({})).status).toBe(403);
  });
});

describe("Giacenze — scoping via magazzino visibile", () => {
  it("lista: A vede le giacenze di magA + magazzino comune, non quelle di magB", async () => {
    await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magNull, quantita: 10 });
    const res = await request(appAs(giacenzeRouter, centroA)).get("/giacenze");
    expect(res.status).toBe(200);
    const magIds = (res.body as Array<{ magazzinoId: number }>).map((r) => r.magazzinoId);
    expect(magIds).toContain(magA);
    expect(magIds).toContain(magNull);
    expect(magIds).not.toContain(magB);
  });

  it("lista: un utente senza centro vede tutte le giacenze", async () => {
    await createLotto(scope, { prodottoId: prod, magazzinoId: magA, quantita: 10 });
    await createLotto(scope, { prodottoId: prod, magazzinoId: magB, quantita: 10 });
    const res = await request(appAs(giacenzeRouter, null)).get("/giacenze");
    const magIds = (res.body as Array<{ magazzinoId: number }>).map((r) => r.magazzinoId);
    expect(magIds).toEqual(expect.arrayContaining([magA, magB]));
  });
});

describe("Movimenti — scoping via magazzino visibile", () => {
  it("lista: A vede i movimenti di magA + magazzino comune, non quelli di magB", async () => {
    const mA = await insertMovimento(scope, { magazzinoId: magA, prodottoId: prod });
    const mB = await insertMovimento(scope, { magazzinoId: magB, prodottoId: prod });
    const mNull = await insertMovimento(scope, { magazzinoId: magNull, prodottoId: prod });
    const res = await request(appAs(movimentiRouter, centroA)).get("/movimenti");
    expect(res.status).toBe(200);
    const ids = idsOf(res.body);
    expect(ids).toContain(mA);
    expect(ids).toContain(mNull);
    expect(ids).not.toContain(mB);
  });

  it("POST: non può registrare un movimento su un magazzino di un altro centro → 403", async () => {
    const res = await request(appAs(movimentiRouter, centroA))
      .post("/movimenti")
      .send({
        tipoMovimento: "carico",
        tipoDettaglio: "donazione",
        dataMovimento: "2026-06-01",
        magazzinoId: magB,
        prodottoId: prod,
        quantita: 1,
        unitaMisura: "kg",
      });
    expect(res.status).toBe(403);
  });

  it("POST: registra un movimento su un magazzino visibile", async () => {
    const res = await request(appAs(movimentiRouter, centroA))
      .post("/movimenti")
      .send({
        tipoMovimento: "carico",
        tipoDettaglio: "donazione",
        dataMovimento: "2026-06-01",
        magazzinoId: magA,
        prodottoId: prod,
        quantita: 1,
        unitaMisura: "kg",
      });
    expect(res.status).toBe(201);
  });
});
