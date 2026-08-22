/* @vitest-environment node */

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db,
  lottiTable,
  magazziniTable,
  movimentiTable,
  pool,
} from "@workspace/db";
import lottiRouter from "../src/routes/lotti";
import movimentiRouter from "../src/routes/movimenti";
import scarichiRouter from "../src/routes/scarichi";
import trasferimentiRouter from "../src/routes/trasferimenti";
import { withDocumentCodeRetry } from "../src/lib/documentCode";
import {
  cleanup,
  createCentro,
  createFornitore,
  createMagazzino,
  createProdotto,
  createUtente,
  insertTrasferimento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";

let scope: SeedScope;
let centroId: number;
let magazzinoId: number;
let prodottoId: number;
let fornitoreId: number;
let operatoreId: number;

const permissions = [
  "magazzino.view",
  "magazzino.stock.receive",
  "magazzino.stock.issue",
  "magazzino.stock.adjust",
  "magazzino.transfers.create",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
];

const appFor = (router: Parameters<typeof makeScopedApp>[0], overrides: { id?: number; permessi?: string[]; aree?: string[] } = {}) =>
  makeScopedApp(router, {
    id: overrides.id ?? operatoreId,
    centroAscoltoId: centroId,
    aree: overrides.aree ?? ["magazzino"],
    permessi: overrides.permessi ?? permissions,
  });

async function carica(quantita = 10, operatorId = operatoreId) {
  return request(appFor(lottiRouter, { id: operatorId }))
    .post("/lotti")
    .send({
      prodottoId,
      magazzinoId,
      fornitoreId,
      dataCarico: "2026-08-19",
      quantitaCaricata: quantita,
      causale: "acquisto",
    });
}

beforeEach(async () => {
  scope = newScope();
  centroId = await createCentro(scope);
  magazzinoId = await createMagazzino(scope, centroId);
  prodottoId = await createProdotto(scope);
  fornitoreId = await createFornitore(scope, null);
  operatoreId = await createUtente(scope, { centroId });
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await pool.end();
});

describe("audit hardening del giornale inventariale", () => {
  it("ritenta una collisione del codice documento senza propagare un errore 500", async () => {
    let attempts = 0;
    const code = await withDocumentCodeRetry("AUD", async (candidate) => {
      attempts += 1;
      if (attempts === 1) {
        const wrapped = new Error("collisione");
        Object.assign(wrapped, { cause: { code: "23505" } });
        throw wrapped;
      }
      return candidate;
    });

    expect(attempts).toBe(2);
    expect(code).toMatch(/^AUD-/);
  });

  it("crea Lotto e Movimento di carico nella stessa operazione", async () => {
    const response = await carica(12);
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ quantitaCaricata: 12, quantitaResidua: 12 });
    scope.lottoIds.push(response.body.id);

    const [movimento] = await db.select().from(movimentiTable).where(eq(movimentiTable.lottoId, response.body.id));
    expect(movimento).toMatchObject({
      tipoMovimento: "carico",
      tipoDettaglio: "acquisto",
      operatoreId,
      fornitoreId,
    });
    expect(Number(movimento.quantita)).toBe(12);
  });

  it("esegue rollback del Lotto se il Movimento non può essere scritto", async () => {
    const before = await db.select({ id: lottiTable.id }).from(lottiTable).where(and(
      eq(lottiTable.magazzinoId, magazzinoId),
      eq(lottiTable.prodottoId, prodottoId),
    ));
    const response = await carica(3, 2_000_000_000);
    expect(response.status).toBe(500);
    const after = await db.select({ id: lottiTable.id }).from(lottiTable).where(and(
      eq(lottiTable.magazzinoId, magazzinoId),
      eq(lottiTable.prodottoId, prodottoId),
    ));
    expect(after).toEqual(before);
  });

  it("blocca quantità via PATCH e usa rettifiche append-only positive e negative", async () => {
    const loaded = await carica(10);
    expect(loaded.status).toBe(201);
    scope.lottoIds.push(loaded.body.id);

    const patch = await request(appFor(lottiRouter)).patch(`/lotti/${loaded.body.id}`).send({ quantitaResidua: 99 });
    expect(patch.status).toBe(400);
    for (const body of [
      { fondoOrigine: "FSE_PLUS" },
      { codiceLotto: "ALTERATO" },
      { dataScadenza: "2028-01-01" },
      { documentoCarico: "ALTERATO" },
      { fattoreKgLtPezzo: "0.500000000" },
    ]) {
      const immutable = await request(appFor(lottiRouter))
        .patch(`/lotti/${loaded.body.id}`)
        .send(body);
      expect(immutable.status).toBe(400);
    }
    const notes = await request(appFor(lottiRouter))
      .patch(`/lotti/${loaded.body.id}`)
      .send({ note: "Nota non identificativa R1" });
    expect(notes.status).toBe(200);
    expect(notes.body.note).toBe("Nota non identificativa R1");

    const positive = await request(appFor(lottiRouter))
      .post(`/lotti/${loaded.body.id}/rettifica`)
      .send({ delta: 2, causale: "inventario_fisico" });
    expect(positive.status).toBe(200);
    expect(positive.body.quantitaResidua).toBe(12);

    const negative = await request(appFor(lottiRouter))
      .post(`/lotti/${loaded.body.id}/rettifica`)
      .send({ delta: -3, causale: "deterioramento" });
    expect(negative.status).toBe(200);
    expect(negative.body.quantitaResidua).toBe(9);

    const movements = await db.select().from(movimentiTable).where(eq(movimentiTable.lottoId, loaded.body.id));
    expect(movements.map((row) => row.tipoMovimento)).toEqual([
      "carico",
      "rettifica_positiva",
      "rettifica_negativa",
    ]);
  });

  it("rifiuta una rettifica sotto zero senza modificare Lotto o giornale", async () => {
    const loaded = await carica(2);
    scope.lottoIds.push(loaded.body.id);
    const response = await request(appFor(lottiRouter))
      .post(`/lotti/${loaded.body.id}/rettifica`)
      .send({ delta: -3, causale: "errore_registrazione" });
    expect(response.status).toBe(409);
    const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, loaded.body.id));
    expect(Number(lotto.quantitaResidua)).toBe(2);
    expect(await db.select().from(movimentiTable).where(eq(movimentiTable.lottoId, loaded.body.id))).toHaveLength(1);
  });

  it("rende POST /movimenti indisponibile e pagina oltre il vecchio limite", async () => {
    const denied = await request(appFor(movimentiRouter)).post("/movimenti").send({});
    expect(denied.status).toBe(405);

    await db.insert(movimentiTable).values(Array.from({ length: 105 }, (_, index) => ({
      tipoMovimento: "carico",
      tipoDettaglio: "donazione",
      dataMovimento: "2026-08-19",
      magazzinoId,
      prodottoId,
      quantita: "1.00",
      unitaMisura: "kg",
      documentoRiferimento: `PAG-${index}`,
      operatoreId,
    })));
    const secondPage = await request(appFor(movimentiRouter)).get("/movimenti").query({ magazzinoId, page: 2, limit: 100 });
    expect(secondPage.status).toBe(200);
    expect(secondPage.body).toHaveLength(5);
  });

  it("rifiuta Magazzini inattivi e inesistenti per nuovi carichi", async () => {
    await db.update(magazziniTable).set({ stato: "inattivo" }).where(eq(magazziniTable.id, magazzinoId));
    expect((await carica(1)).status).toBe(400);

    const globalAdmin = makeScopedApp(lottiRouter, {
      id: operatoreId,
      centroAscoltoId: null,
      isAdmin: true,
      aree: ["magazzino"],
      permessi: [],
    });
    const missing = await request(globalAdmin).post("/lotti").send({
      prodottoId,
      magazzinoId: 2_000_000_000,
      fornitoreId,
      dataCarico: "2026-08-19",
      quantitaCaricata: 1,
    });
    expect(missing.status).toBe(404);
  });

  it("applica RBAC agli Scarichi e vieta il cambio stato generico del Trasferimento", async () => {
    const socialOnly = appFor(scarichiRouter, { aree: ["sociale"], permessi: [] });
    expect((await request(socialOnly).get("/scarichi")).status).toBe(403);
    expect((await request(appFor(scarichiRouter, { permessi: ["magazzino.view"] })).get("/scarichi")).status).toBe(200);

    const destinoId = await createMagazzino(scope, centroId);
    const transferId = await insertTrasferimento(scope, { origineId: magazzinoId, destinoId });
    const response = await request(appFor(trasferimentiRouter))
      .patch(`/trasferimenti/${transferId}`)
      .send({ versione: 1, stato: "in_transito" });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/stato/i);
  });
});
