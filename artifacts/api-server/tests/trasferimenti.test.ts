import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import { db, pool, trasferimentiTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
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

describe("POST /trasferimenti — unità di misura canonica", () => {
  it("rifiuta l'unità legacy difforme dal Prodotto senza creare il trasferimento", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const response = await request(app)
      .post("/trasferimenti")
      .send({
        magazzinoOrigineId: origineId,
        magazzinoDestinoId: destinoId,
        dataRichiesta: "2026-06-24",
        trasportatoreNome: "Trasporto test",
        righe: [{ prodottoId, quantita: 1, unitaMisura: "kg" }],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/deve essere pz/i);
  });

  it("deriva pz dal Prodotto e la conserva nei movimenti di uscita e entrata", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 3 });
    const created = await request(app)
      .post("/trasferimenti")
      .send({
        magazzinoOrigineId: origineId,
        magazzinoDestinoId: destinoId,
        dataRichiesta: "2026-06-24",
        trasportatoreNome: "Trasporto test",
        righe: [{ prodottoId, quantita: 3 }],
      });
    expect(created.status).toBe(201);
    scope.trasferimentoIds.push(created.body.id);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${created.body.id}/avvia`)
          .send({ versione: created.body.versione })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${created.body.id}/conferma`)
          .send({ versione: created.body.versione + 1 })
      ).status,
    ).toBe(200);
    const movements = await getMovimentiForTrasferimento(created.body.id);
    expect(movements.map((movement) => movement.unitaMisura)).toEqual(
      expect.arrayContaining(["pz", "pz"]),
    );
    expect(movements.every((movement) => movement.unitaMisura === "pz")).toBe(
      true,
    );
  });
});

describe("POST /trasferimenti/:id/avvia — uscita FEFO", () => {
  it("scala le quantità dai lotti origine in ordine FEFO (scadenza crescente)", async () => {
    const prodottoId = await createProdotto(scope);
    // Lotto A scade prima → deve essere svuotato per primo.
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-07-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-09-01",
    });

    const t = await creaTrasferimento({ prodottoId, quantita: 15 });

    const res = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send({ versione: t.versione });
    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("in_transito");

    // FEFO: A svuotato (10), B ridotto a 5.
    expect(parseFloat((await getLotto(lottoA)).quantitaResidua)).toBe(0);
    expect(parseFloat((await getLotto(lottoB)).quantitaResidua)).toBe(5);

    // Movimenti uscita: uno per lotto toccato, con le quantità FEFO.
    const movimenti = await getMovimentiForTrasferimento(t.id);
    const uscite = movimenti.filter((m) => m.tipoDettaglio === "uscita");
    expect(uscite).toHaveLength(2);
    const perLotto = new Map(
      uscite.map((m) => [m.lottoId, parseFloat(m.quantita)]),
    );
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

    const res = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send({ versione: t.versione });
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

    const first = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send({ versione: t.versione });
    expect(first.status).toBe(200);

    // Secondo avvio: ora è "in_transito" → 400.
    const second = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send({ versione: t.versione });
    expect(second.status).toBe(400);
  });

  it("non distribuisce lotti scaduti e mantiene il rollback completo", async () => {
    const prodottoId = await createProdotto(scope);
    const expired = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2020-01-01",
    });
    const t = await creaTrasferimento({ prodottoId, quantita: 5 });

    const response = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send({ versione: t.versione });
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/scaduti|FEFO/i);
    expect(parseFloat((await getLotto(expired)).quantitaResidua)).toBe(10);
    expect(await getMovimentiForTrasferimento(t.id)).toHaveLength(0);
  });

  it("due avvii concorrenti producono un solo scarico", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
    });
    const t = await creaTrasferimento({ prodottoId, quantita: 6 });

    const responses = await Promise.all([
      request(app)
        .post(`/trasferimenti/${t.id}/avvia`)
        .send({ versione: t.versione }),
      request(app)
        .post(`/trasferimenti/${t.id}/avvia`)
        .send({ versione: t.versione }),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(parseFloat((await getLotto(lottoId)).quantitaResidua)).toBe(4);
    const outputs = (await getMovimentiForTrasferimento(t.id)).filter(
      (row) => row.tipoDettaglio === "uscita",
    );
    expect(outputs).toHaveLength(1);
    expect(parseFloat(outputs[0].quantita)).toBe(6);
  });

  it("ricostruisce separatamente quantità FSE+ e non FSE+ dai lotti FEFO realmente usati", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 4,
      dataScadenza: "2027-01-01",
      fsePlus: true,
    });
    const fornitoreId = await createFornitore(scope, "Fornitore misto");
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 6,
      dataScadenza: "2027-02-01",
      fornitoreId,
      fsePlus: false,
    });
    const trasferimento = await creaTrasferimento({ prodottoId, quantita: 10 });

    expect(
      (
        await request(app)
          .post(`/trasferimenti/${trasferimento.id}/avvia`)
          .send({ versione: trasferimento.versione })
      ).status,
    ).toBe(200);
    const detail = await request(app).get(`/trasferimenti/${trasferimento.id}`);

    expect(detail.status).toBe(200);
    expect(detail.body.righe[0]).toMatchObject({
      fsePlusQuantita: 4,
      nonFsePlusQuantita: 6,
    });
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
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/avvia`)
          .send({ versione: t.versione })
      ).status,
    ).toBe(200);

    const res = await request(app)
      .post(`/trasferimenti/${t.id}/conferma`)
      .send({ versione: t.versione + 1 });
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
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/avvia`)
          .send({ versione: t.versione })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/conferma`)
          .send({ versione: t.versione + 1 })
      ).status,
    ).toBe(200);

    const [dest] = await getLottiInMagazzino(destinoId);
    expect(dest.fsePlus).toBe(true);
    expect(dest.fornitoreId).toBeNull();
  });

  it("registra i movimenti di entrata a destinazione", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 6 });

    const t = await creaTrasferimento({ prodottoId, quantita: 6 });
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/avvia`)
          .send({ versione: t.versione })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/conferma`)
          .send({ versione: t.versione + 1 })
      ).status,
    ).toBe(200);

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
    const res = await request(app)
      .post(`/trasferimenti/${t.id}/conferma`)
      .send({ versione: t.versione });
    expect(res.status).toBe(400);
  });

  it("due conferme concorrenti producono un solo carico a destinazione", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 6 });
    const t = await creaTrasferimento({ prodottoId, quantita: 6 });
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/avvia`)
          .send({ versione: t.versione })
      ).status,
    ).toBe(200);

    const responses = await Promise.all([
      request(app)
        .post(`/trasferimenti/${t.id}/conferma`)
        .send({ versione: t.versione + 1 }),
      request(app)
        .post(`/trasferimenti/${t.id}/conferma`)
        .send({ versione: t.versione + 1 }),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    const destinationLots = await getLottiInMagazzino(destinoId);
    expect(destinationLots).toHaveLength(1);
    expect(parseFloat(destinationLots[0].quantitaResidua)).toBe(6);
  });
});

describe("PATCH /trasferimenti/:id — modifica righe", () => {
  it("rifiuta atomicamente una UOM difforme senza cambiare testata, righe o versione", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 2,
      unitaMisura: "pz",
    });

    const response = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send({
        versione: transfer.versione,
        note: "non deve restare",
        righe: [
          { prodottoId, quantita: 4, unitaMisura: "pz" },
          { prodottoId, quantita: 1, unitaMisura: "kg" },
        ],
      });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/deve essere pz/i);

    const unchanged = await request(app).get(`/trasferimenti/${transfer.id}`);
    expect(unchanged.body).toMatchObject({
      versione: transfer.versione,
      note: transfer.note,
    });
    expect(unchanged.body.righe).toMatchObject([
      { prodottoId, quantita: 2, unitaMisura: "pz" },
    ]);
    expect(await getMovimentiForTrasferimento(transfer.id)).toHaveLength(0);
  });

  it("normalizza PATCH con UOM corretta o omessa e la propaga al ledger", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 10 });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 2,
      unitaMisura: "pz",
    });

    const withCanonicalUnit = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send({
        versione: transfer.versione,
        righe: [{ prodottoId, quantita: 3, unitaMisura: "pz" }],
      });
    expect(withCanonicalUnit.status).toBe(200);
    expect(withCanonicalUnit.body.righe).toMatchObject([
      { prodottoId, quantita: 3, unitaMisura: "pz" },
    ]);

    const withoutUnit = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send({
        versione: withCanonicalUnit.body.versione,
        righe: [{ prodottoId, quantita: 4 }],
      });
    expect(withoutUnit.status).toBe(200);
    expect(withoutUnit.body.righe).toMatchObject([
      { prodottoId, quantita: 4, unitaMisura: "pz" },
    ]);

    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ versione: withoutUnit.body.versione });
    expect(started.status).toBe(200);
    const received = await request(app)
      .post(`/trasferimenti/${transfer.id}/conferma`)
      .send({ versione: started.body.versione });
    expect(received.status).toBe(200);
    const movements = await getMovimentiForTrasferimento(transfer.id);
    expect(movements.length).toBeGreaterThanOrEqual(2);
    expect(movements.every((row) => row.unitaMisura === "pz")).toBe(true);
  });

  it("esegue rollback di testata e righe quando una FK della riga fallisce", async () => {
    const prodottoId = await createProdotto(scope);
    const before = await db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(
        and(
          eq(trasferimentiTable.magazzinoOrigineId, origineId),
          eq(trasferimentiTable.magazzinoDestinoId, destinoId),
        ),
      );

    const createFailed = await request(app)
      .post("/trasferimenti")
      .send({
        magazzinoOrigineId: origineId,
        magazzinoDestinoId: destinoId,
        dataRichiesta: "2026-06-24",
        trasportatoreNome: "Test rollback",
        righe: [
          {
            prodottoId,
            lottoId: 2_000_000_000,
            quantita: 1,
            unitaMisura: "kg",
          },
        ],
      });
    expect(createFailed.status).toBe(400);
    const after = await db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(
        and(
          eq(trasferimentiTable.magazzinoOrigineId, origineId),
          eq(trasferimentiTable.magazzinoDestinoId, destinoId),
        ),
      );
    expect(after).toEqual(before);

    const transfer = await creaTrasferimento({ prodottoId, quantita: 2 });
    const replaceFailed = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send({
        versione: transfer.versione,
        note: "non deve restare",
        righe: [
          {
            prodottoId,
            lottoId: 2_000_000_000,
            quantita: 3,
            unitaMisura: "kg",
          },
        ],
      });
    expect(replaceFailed.status).toBe(400);
    const unchanged = await request(app).get(`/trasferimenti/${transfer.id}`);
    expect(unchanged.body.versione).toBe(transfer.versione);
    expect(unchanged.body.note).toBe(transfer.note);
    expect(unchanged.body.righe).toMatchObject([{ prodottoId, quantita: 2 }]);
  });

  it("blocca la modifica delle righe dopo l'avvio", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 20 });

    const t = await creaTrasferimento({ prodottoId, quantita: 5 });
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/avvia`)
          .send({ versione: t.versione })
      ).status,
    ).toBe(200);

    const res = await request(app)
      .patch(`/trasferimenti/${t.id}`)
      .send({
        versione: t.versione + 1,
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
        versione: t.versione,
        righe: [{ prodottoId, quantita: 7, unitaMisura: "kg" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.righe).toHaveLength(1);
    expect(res.body.righe[0].quantita).toBe(7);
  });
});
