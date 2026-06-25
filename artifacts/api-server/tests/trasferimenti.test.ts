import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { pool } from "@workspace/db";
import {
  makeApp,
  newScope,
  cleanup,
  createUtente,
  createMagazzino,
  createProdotto,
  createFornitore,
  createLotto,
  getLotto,
  getMovimentiForTrasferimento,
  getLottiInMagazzino,
  type SeedScope,
} from "./helpers";

let app: Express;
let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let origineId: number;
let destinoId: number;

/** Creates a transfer with one riga via the API and records its id for cleanup. */
async function creaTrasferimento(opts: {
  prodottoId: number;
  quantita: number;
  unitaMisura?: string;
  lottoId?: number;
}) {
  const res = await request(app)
    .post("/trasferimenti")
    .send({
      magazzinoOrigineId: origineId,
      magazzinoDestinoId: destinoId,
      dataRichiesta: "2026-06-24",
      trasportatoreNome: "Ritiro presso il magazzino",
      righe: [
        {
          prodottoId: opts.prodottoId,
          lottoId: opts.lottoId,
          quantita: opts.quantita,
          unitaMisura: opts.unitaMisura ?? "kg",
        },
      ],
    });
  expect(res.status).toBe(201);
  scope.trasferimentoIds.push(res.body.id);
  return res.body;
}

beforeAll(async () => {
  // The operator user is reused across the whole suite (transfers stamp its id);
  // it is cleaned up once in afterAll.
  bootScope = newScope();
  operatoreId = await createUtente(bootScope);
});

beforeEach(async () => {
  scope = newScope();
  app = makeApp(operatoreId);
  origineId = await createMagazzino(scope, "Origine Test");
  destinoId = await createMagazzino(scope, "Destino Test");
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("POST /trasferimenti/:id/avvia — uscita FEFO", () => {
  it("scala le quantità dai lotti origine in ordine FEFO (scadenza crescente)", async () => {
    const prodottoId = await createProdotto(scope);
    // Lotto A scade prima → deve essere svuotato per primo.
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2026-07-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2026-09-01",
    });

    const t = await creaTrasferimento({ prodottoId, quantita: 15 });

    const res = await request(app).post(`/trasferimenti/${t.id}/avvia`);
    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("in_transito");

    // FEFO: A svuotato (10), B ridotto a 5.
    expect(parseFloat((await getLotto(lottoA)).quantitaResidua)).toBe(0);
    expect(parseFloat((await getLotto(lottoB)).quantitaResidua)).toBe(5);

    // Movimenti uscita: uno per lotto toccato, con le quantità FEFO.
    const movimenti = await getMovimentiForTrasferimento(t.id);
    const uscite = movimenti.filter((m) => m.tipoDettaglio === "uscita");
    expect(uscite).toHaveLength(2);
    const perLotto = new Map(uscite.map((m) => [m.lottoId, parseFloat(m.quantita)]));
    expect(perLotto.get(lottoA)).toBe(10);
    expect(perLotto.get(lottoB)).toBe(5);
    for (const u of uscite) {
      expect(u.tipoMovimento).toBe("trasferimento");
      expect(u.magazzinoId).toBe(origineId);
    }
  });

  it("rifiuta (400) quando la giacenza all'origine è insufficiente", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 5 });

    const t = await creaTrasferimento({ prodottoId, quantita: 10 });

    const res = await request(app).post(`/trasferimenti/${t.id}/avvia`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficiente/i);

    // Stato invariato e nessun movimento registrato.
    const movimenti = await getMovimentiForTrasferimento(t.id);
    expect(movimenti).toHaveLength(0);
  });

  it("è respinto se il trasferimento non è in stato richiesto/preparato", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 20 });

    const t = await creaTrasferimento({ prodottoId, quantita: 5 });

    const first = await request(app).post(`/trasferimenti/${t.id}/avvia`);
    expect(first.status).toBe(200);

    // Secondo avvio: ora è "in_transito" → 400.
    const second = await request(app).post(`/trasferimenti/${t.id}/avvia`);
    expect(second.status).toBe(400);
  });
});

describe("POST /trasferimenti/:id/conferma — entrata a destinazione", () => {
  it("ricrea i lotti a destinazione preservando scadenza/codiceLotto/fornitore", async () => {
    const prodottoId = await createProdotto(scope);
    const fornitoreId = await createFornitore(scope, "Fornitore Test");
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 8,
      dataScadenza: "2026-12-31",
      codiceLotto: "LOT-ABC",
      fornitoreId,
      fsePlus: false,
    });

    const t = await creaTrasferimento({ prodottoId, quantita: 8 });
    expect((await request(app).post(`/trasferimenti/${t.id}/avvia`)).status).toBe(200);

    const res = await request(app).post(`/trasferimenti/${t.id}/conferma`);
    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("completato");

    const lottiDest = await getLottiInMagazzino(destinoId);
    expect(lottiDest).toHaveLength(1);
    const dest = lottiDest[0];
    expect(dest.prodottoId).toBe(prodottoId);
    expect(dest.codiceLotto).toBe("LOT-ABC");
    expect(dest.dataScadenza).toBe("2026-12-31");
    expect(dest.fornitoreId).toBe(fornitoreId);
    expect(dest.fsePlus).toBe(false);
    expect(parseFloat(dest.quantitaResidua)).toBe(8);
  });

  it("preserva il flag fsePlus sul lotto ricreato", async () => {
    const prodottoId = await createProdotto(scope, { fsePlus: true });
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 4,
      fsePlus: true,
      fornitoreId: null,
    });

    const t = await creaTrasferimento({ prodottoId, quantita: 4 });
    expect((await request(app).post(`/trasferimenti/${t.id}/avvia`)).status).toBe(200);
    expect((await request(app).post(`/trasferimenti/${t.id}/conferma`)).status).toBe(200);

    const [dest] = await getLottiInMagazzino(destinoId);
    expect(dest.fsePlus).toBe(true);
    expect(dest.fornitoreId).toBeNull();
  });

  it("registra i movimenti di entrata a destinazione", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 6 });

    const t = await creaTrasferimento({ prodottoId, quantita: 6 });
    expect((await request(app).post(`/trasferimenti/${t.id}/avvia`)).status).toBe(200);
    expect((await request(app).post(`/trasferimenti/${t.id}/conferma`)).status).toBe(200);

    const movimenti = await getMovimentiForTrasferimento(t.id);
    const entrate = movimenti.filter((m) => m.tipoDettaglio === "entrata");
    expect(entrate.length).toBeGreaterThanOrEqual(1);
    const tot = entrate.reduce((s, m) => s + parseFloat(m.quantita), 0);
    expect(tot).toBe(6);
    for (const e of entrate) {
      expect(e.tipoMovimento).toBe("trasferimento");
      expect(e.magazzinoId).toBe(destinoId);
    }
  });

  it("rifiuta (400) la conferma se il trasferimento non è in transito", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 6 });

    const t = await creaTrasferimento({ prodottoId, quantita: 6 });

    // Ancora in "richiesto" → conferma non consentita.
    const res = await request(app).post(`/trasferimenti/${t.id}/conferma`);
    expect(res.status).toBe(400);
  });
});

describe("PATCH /trasferimenti/:id — modifica righe", () => {
  it("blocca la modifica delle righe dopo l'avvio", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 20 });

    const t = await creaTrasferimento({ prodottoId, quantita: 5 });
    expect((await request(app).post(`/trasferimenti/${t.id}/avvia`)).status).toBe(200);

    const res = await request(app)
      .patch(`/trasferimenti/${t.id}`)
      .send({
        righe: [{ prodottoId, quantita: 3, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prima dell'avvio/i);
  });

  it("consente la modifica delle righe prima dell'avvio", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 20 });

    const t = await creaTrasferimento({ prodottoId, quantita: 5 });

    const res = await request(app)
      .patch(`/trasferimenti/${t.id}`)
      .send({
        righe: [{ prodottoId, quantita: 7, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.righe).toHaveLength(1);
    expect(res.body.righe[0].quantita).toBe(7);
  });
});
