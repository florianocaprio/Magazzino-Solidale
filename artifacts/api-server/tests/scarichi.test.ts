import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { pool } from "@workspace/db";
import {
  makeScarichiApp,
  newScope,
  cleanup,
  createUtente,
  createMagazzino,
  createProdotto,
  createLotto,
  getLotto,
  getScaricoMovimentiForMagazzino,
  type SeedScope,
} from "./helpers";

let app: Express;
let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let magazzinoId: number;

/** Creates a scarico with one riga via the API and records its id for cleanup. */
async function creaScarico(opts: {
  prodottoId: number;
  quantita: number;
  unitaMisura?: string;
  causale?: string;
  causaleAltro?: string;
  note?: string;
}) {
  return request(app)
    .post("/scarichi")
    .send({
      magazzinoId,
      dataScarico: "2026-06-24",
      causale: opts.causale ?? "scaduta",
      causaleAltro: opts.causaleAltro,
      note: opts.note,
      righe: [
        {
          prodottoId: opts.prodottoId,
          quantita: opts.quantita,
          unitaMisura: opts.unitaMisura ?? "kg",
        },
      ],
    });
}

beforeAll(async () => {
  // The operator user is reused across the whole suite (scarichi stamp its id);
  // it is cleaned up once in afterAll.
  bootScope = newScope();
  operatoreId = await createUtente(bootScope);
});

beforeEach(async () => {
  scope = newScope();
  app = makeScarichiApp(operatoreId);
  magazzinoId = await createMagazzino(scope, "Magazzino Scarico Test");
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("POST /scarichi — scarico FEFO", () => {
  it("scala le quantità dai lotti in ordine FEFO (scadenza crescente)", async () => {
    const prodottoId = await createProdotto(scope);
    // Lotto A scade prima → deve essere svuotato per primo.
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId,
      quantita: 10,
      dataScadenza: "2026-07-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId,
      quantita: 10,
      dataScadenza: "2026-09-01",
    });

    const res = await creaScarico({ prodottoId, quantita: 15 });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);

    // FEFO: A svuotato (10), B ridotto a 5.
    expect(parseFloat((await getLotto(lottoA)).quantitaResidua)).toBe(0);
    expect(parseFloat((await getLotto(lottoB)).quantitaResidua)).toBe(5);

    // Movimenti scarico: uno per lotto toccato, con le quantità FEFO.
    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(2);
    const perLotto = new Map(movimenti.map((m) => [m.lottoId, parseFloat(m.quantita)]));
    expect(perLotto.get(lottoA)).toBe(10);
    expect(perLotto.get(lottoB)).toBe(5);
    for (const m of movimenti) {
      expect(m.tipoMovimento).toBe("scarico");
      expect(m.tipoDettaglio).toBe("scaduta");
      expect(m.magazzinoId).toBe(magazzinoId);
      expect(m.prodottoId).toBe(prodottoId);
    }
  });

  it("usa la data di carico come tiebreak quando le scadenze coincidono", async () => {
    const prodottoId = await createProdotto(scope);
    // Stessa scadenza → vince chi è entrato prima (dataCarico crescente).
    const lottoVecchio = await createLotto({
      prodottoId,
      magazzinoId,
      quantita: 5,
      dataScadenza: "2026-08-01",
      dataCarico: "2026-01-01",
    });
    const lottoNuovo = await createLotto({
      prodottoId,
      magazzinoId,
      quantita: 5,
      dataScadenza: "2026-08-01",
      dataCarico: "2026-02-01",
    });

    const res = await creaScarico({ prodottoId, quantita: 5 });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);

    expect(parseFloat((await getLotto(lottoVecchio)).quantitaResidua)).toBe(0);
    expect(parseFloat((await getLotto(lottoNuovo)).quantitaResidua)).toBe(5);
  });

  it("registra i movimenti con la causale e la quantità corrette", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId, quantita: 8 });

    const res = await creaScarico({ prodottoId, quantita: 3, causale: "rubata" });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);

    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(1);
    expect(movimenti[0].tipoDettaglio).toBe("rubata");
    expect(parseFloat(movimenti[0].quantita)).toBe(3);
  });

  it("deriva l'unità di misura dal prodotto (ignora quella inviata dal client)", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "lt" });
    await createLotto({ prodottoId, magazzinoId, quantita: 6 });

    // Il client invia "kg" ma il prodotto è in "lt" → deve prevalere il prodotto.
    const res = await creaScarico({ prodottoId, quantita: 2, unitaMisura: "kg" });
    expect(res.status).toBe(201);
    scope.scaricoIds.push(res.body.id);

    expect(res.body.righe[0].unitaMisura).toBe("lt");

    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(1);
    expect(movimenti[0].unitaMisura).toBe("lt");
  });

  it("rifiuta (400) quando la giacenza è insufficiente e non tocca lo stock", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({ prodottoId, magazzinoId, quantita: 5 });

    const res = await creaScarico({ prodottoId, quantita: 10 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/insufficiente/i);

    // Stock invariato e nessun movimento registrato.
    expect(parseFloat((await getLotto(lottoId)).quantitaResidua)).toBe(5);
    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(0);
  });

  it("rifiuta (400) quando la causale non è valida", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({ prodottoId, magazzinoId, quantita: 5 });

    const res = await creaScarico({ prodottoId, quantita: 1, causale: "inventata" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/causale/i);

    // Nessuna modifica allo stock.
    expect(parseFloat((await getLotto(lottoId)).quantitaResidua)).toBe(5);
    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(0);
  });

  it("rifiuta (400) quando la quantità non è positiva", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId, quantita: 5 });

    const res = await creaScarico({ prodottoId, quantita: 0 });
    expect(res.status).toBe(400);

    const movimenti = await getScaricoMovimentiForMagazzino(magazzinoId);
    expect(movimenti).toHaveLength(0);
  });
});
