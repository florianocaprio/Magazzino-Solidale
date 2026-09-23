import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import request from "supertest";
import type { Express } from "express";
import {
  db,
  comandiOperativiTable,
  lottiTable,
  movimentiTable,
  pool,
  prenotazioniMagazzinoTable,
  trasferimentiTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  cleanup,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  getLotto,
  makeApp,
  newScope,
  type SeedScope,
} from "./helpers";

let app: Express;
let scope: SeedScope;
let bootScope: SeedScope;
let actorId: number;
let origineId: number;
let destinoId: number;
let sequence = 0;
const key = () => `m4b1-${Date.now()}-${++sequence}`;

async function createTransfer(
  rows: Array<{ prodottoId: number; quantita: number; lottoId?: number }>,
) {
  const response = await request(app).post("/trasferimenti").send({
    idempotencyKey: key(),
    magazzinoOrigineId: origineId,
    magazzinoDestinoId: destinoId,
    dataRichiesta: "2026-09-23",
    trasportatoreNome: "Test M4B.1",
    righe: rows,
  });
  expect(response.status, response.text).toBe(201);
  scope.trasferimentoIds.push(response.body.id);
  return response.body;
}

async function prepare(
  transfer: { id: number; versione: number },
  idempotencyKey = key(),
  targetApp: Express = app,
) {
  return request(targetApp)
    .post(`/trasferimenti/${transfer.id}/prepara`)
    .send({ idempotencyKey, versione: transfer.versione });
}

async function reservations(transferId: number) {
  return db
    .select()
    .from(prenotazioniMagazzinoTable)
    .where(eq(prenotazioniMagazzinoTable.trasferimentoId, transferId));
}

beforeAll(async () => {
  bootScope = newScope();
  actorId = await createUtente(bootScope);
});
beforeEach(async () => {
  scope = newScope();
  app = makeApp(actorId);
  origineId = await createMagazzino(scope, "Origine M4B.1");
  destinoId = await createMagazzino(scope, "Destinazione M4B.1");
});
afterEach(async () => {
  await cleanup(scope);
});
afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("M4B.1 — Pronto reale e prenotazioni comuni", () => {
  it("PREP-TR-01/02/03: la richiesta non prenota; Pronto alloca FEFO senza scaricare fisico", async () => {
    const productId = await createProdotto(scope);
    const laterId = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 8,
      dataScadenza: "2027-12-01",
    });
    const earlierId = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 5,
      dataScadenza: "2027-01-01",
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 7 },
    ]);
    expect(await reservations(transfer.id)).toHaveLength(0);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/avvia`)
          .send({ idempotencyKey: key(), versione: transfer.versione })
      ).status,
    ).toBe(409);
    const ready = await prepare(transfer);
    expect(ready.status, ready.text).toBe(200);
    expect(ready.body.stato).toBe("preparato");
    expect(
      ready.body.righe[0].ripartizioniLotto.map(
        (row: { lottoId: number; quantita: number }) => [
          row.lottoId,
          row.quantita,
        ],
      ),
    ).toEqual([
      [earlierId, 5],
      [laterId, 2],
    ]);
    expect(
      (await reservations(transfer.id)).map((row) => [
        row.lottoId,
        Number(row.quantita),
        row.stato,
      ]),
    ).toEqual([
      [earlierId, 5, "attiva"],
      [laterId, 2, "attiva"],
    ]);
    expect(Number((await getLotto(earlierId)).quantitaResidua)).toBe(5);
    expect(Number((await getLotto(laterId)).quantitaResidua)).toBe(8);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, transfer.id)),
    ).toHaveLength(0);
  });

  it("PREP-TR-04/07: il lotto esplicito vincola Pronto e Avvia consuma solo le partite prenotate", async () => {
    const productId = await createProdotto(scope);
    const lotA = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 5,
      dataScadenza: "2027-01-01",
    });
    const lotB = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 4,
      dataScadenza: "2027-12-01",
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 3, lottoId: lotB },
    ]);
    const ready = await prepare(transfer);
    expect(ready.status, ready.text).toBe(200);
    expect((await reservations(transfer.id)).map((row) => row.lottoId)).toEqual(
      [lotB],
    );
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ idempotencyKey: key(), versione: ready.body.versione });
    expect(started.status, started.text).toBe(200);
    expect(started.body.stato).toBe("in_transito");
    expect(Number((await getLotto(lotA)).quantitaResidua)).toBe(5);
    expect(Number((await getLotto(lotB)).quantitaResidua)).toBe(1);
    const outgoing = await db
      .select()
      .from(movimentiTable)
      .where(
        and(
          eq(movimentiTable.trasferimentoId, transfer.id),
          eq(movimentiTable.tipoDettaglio, "uscita"),
        ),
      );
    expect(outgoing.map((row) => [row.lottoId, Number(row.quantita)])).toEqual([
      [lotB, 3],
    ]);
    expect((await reservations(transfer.id)).map((row) => row.stato)).toEqual([
      "convertita_in_trasferimento",
    ]);
  });

  it("PREP-TR-04: lotto esplicito insufficiente non usa fallback", async () => {
    const productId = await createProdotto(scope);
    const lotA = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 1,
    });
    await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 10,
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 2, lottoId: lotA },
    ]);
    const ready = await prepare(transfer);
    expect(ready.status).toBe(409);
    expect(await reservations(transfer.id)).toHaveLength(0);
    expect(Number((await getLotto(lotA)).quantitaResidua)).toBe(1);
  });

  it("PREP-TR-02: una riga insufficiente rollbacka anche la prenotazione della prima", async () => {
    const firstProduct = await createProdotto(scope);
    const secondProduct = await createProdotto(scope);
    const firstLot = await createLotto({
      prodottoId: firstProduct,
      magazzinoId: origineId,
      quantita: 5,
    });
    await createLotto({
      prodottoId: secondProduct,
      magazzinoId: origineId,
      quantita: 1,
    });
    const transfer = await createTransfer([
      { prodottoId: firstProduct, quantita: 5 },
      { prodottoId: secondProduct, quantita: 2 },
    ]);
    const failed = await prepare(transfer);
    expect(failed.status).toBe(409);
    expect(await reservations(transfer.id)).toHaveLength(0);
    expect(Number((await getLotto(firstLot)).quantitaResidua)).toBe(5);
    expect(
      (await request(app).get(`/trasferimenti/${transfer.id}`)).body.stato,
    ).toBe("richiesto");
  });

  it("PREP-TR-06: due comandi Pronto sullo stesso documento hanno un solo effetto", async () => {
    const productId = await createProdotto(scope);
    await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 3,
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 2 },
    ]);
    const [first, second] = await Promise.all([
      prepare(transfer),
      prepare(transfer),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect(await reservations(transfer.id)).toHaveLength(1);
  });

  it("PREP-TR-09/10: prepara non concede dispatch e replay rispetta permesso e scope correnti", async () => {
    const productId = await createProdotto(scope);
    await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 3,
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 2 },
    ]);
    const prepareKey = key();
    const onlyPrepare = makeApp(actorId, {
      isAdmin: false,
      aree: ["magazzino"],
      areaOperativaId: scope.areaOperativaIds[0],
      permessi: ["magazzino.view", "magazzino.transfers.prepare"],
    });
    const ready = await prepare(transfer, prepareKey, onlyPrepare);
    expect(ready.status, ready.text).toBe(200);
    const deniedDispatch = await request(onlyPrepare)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ idempotencyKey: key(), versione: ready.body.versione });
    expect(deniedDispatch.status).toBe(403);
    const revoked = makeApp(actorId, {
      isAdmin: false,
      aree: ["magazzino"],
      areaOperativaId: scope.areaOperativaIds[0],
      permessi: ["magazzino.view"],
    });
    expect((await prepare(transfer, prepareKey, revoked)).status).toBe(403);
    const wrongArea = makeApp(actorId, {
      isAdmin: false,
      aree: ["magazzino"],
      areaOperativaId: scope.areaOperativaIds[0] + 100000,
      permessi: ["magazzino.view", "magazzino.transfers.prepare"],
    });
    expect((await prepare(transfer, prepareKey, wrongArea)).status).toBe(403);
    expect(await reservations(transfer.id)).toHaveLength(1);
  });

  it("PREP-TR-09: un errore dell'audit rollbacka prenotazioni, stato e ricevuta", async () => {
    const productId = await createProdotto(scope);
    const lotId = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 3,
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 2 },
    ]);
    const suffix = `${process.pid}_${++sequence}`;
    const functionName = `m4b1_audit_failure_${suffix}`;
    const triggerName = `m4b1_audit_failure_trigger_${suffix}`;
    const idempotencyKey = key();
    await pool.query(
      `CREATE FUNCTION "${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure test'; END; $$`,
    );
    await pool.query(
      `CREATE TRIGGER "${triggerName}" BEFORE INSERT ON audit_eventi FOR EACH ROW WHEN (NEW.azione = 'TRASFERIMENTO_PREPARATO') EXECUTE FUNCTION "${functionName}"()`,
    );
    try {
      const failed = await prepare(transfer, idempotencyKey);
      expect(failed.status).toBe(500);
    } finally {
      await pool.query(
        `DROP TRIGGER IF EXISTS "${triggerName}" ON audit_eventi`,
      );
      await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }
    expect(await reservations(transfer.id)).toHaveLength(0);
    const [current] = await db
      .select({
        stato: trasferimentiTable.stato,
        versione: trasferimentiTable.versione,
      })
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, transfer.id));
    expect(current).toEqual({
      stato: "richiesto",
      versione: transfer.versione,
    });
    expect(
      await db
        .select()
        .from(comandiOperativiTable)
        .where(eq(comandiOperativiTable.idempotencyKey, idempotencyKey)),
    ).toHaveLength(0);
    expect(Number((await getLotto(lotId)).quantitaResidua)).toBe(3);
  });

  it("PREP-TR-05/06: ultima unità contesa, due Pronto concorrenti ed idempotenza", async () => {
    const productId = await createProdotto(scope);
    await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 1,
    });
    const first = await createTransfer([
      { prodottoId: productId, quantita: 1 },
    ]);
    const second = await createTransfer([
      { prodottoId: productId, quantita: 1 },
    ]);
    const [a, b] = await Promise.all([prepare(first), prepare(second)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? first : second;
    const loser = a.status === 200 ? second : first;
    expect(await reservations(winner.id)).toHaveLength(1);
    expect(await reservations(loser.id)).toHaveLength(0);
    const repeatKey = key();
    const replay = await prepare(winner, repeatKey);
    expect(replay.status).toBe(409); // nuova intenzione con versione obsoleta
  });

  it("PREP-TR-08/09: annulla Pronto con motivo e libera senza movimenti; replay non duplica", async () => {
    const productId = await createProdotto(scope);
    const lotId = await createLotto({
      prodottoId: productId,
      magazzinoId: origineId,
      quantita: 5,
    });
    const transfer = await createTransfer([
      { prodottoId: productId, quantita: 5 },
    ]);
    const prepareKey = key();
    const ready = await prepare(transfer, prepareKey);
    expect(ready.status).toBe(200);
    const prepareReplay = await prepare(transfer, prepareKey);
    expect(prepareReplay.status).toBe(200);
    expect(await reservations(transfer.id)).toHaveLength(1);
    const edit = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send({
        idempotencyKey: key(),
        versione: ready.body.versione,
        note: "Non modificabile",
      });
    expect(edit.status).toBe(409);
    const cancelKey = key();
    const cancelled = await request(app)
      .post(`/trasferimenti/${transfer.id}/annulla`)
      .send({
        idempotencyKey: cancelKey,
        versione: ready.body.versione,
        motivo: "Cambio programma",
      });
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(cancelled.body).toMatchObject({
      stato: "annullato",
      motivoAnnullamento: "Cambio programma",
    });
    const replay = await request(app)
      .post(`/trasferimenti/${transfer.id}/annulla`)
      .send({
        idempotencyKey: cancelKey,
        versione: ready.body.versione,
        motivo: "Cambio programma",
      });
    expect(replay.status).toBe(200);
    expect((await reservations(transfer.id)).map((row) => row.stato)).toEqual([
      "rilasciata",
    ]);
    expect(Number((await getLotto(lotId)).quantitaResidua)).toBe(5);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, transfer.id)),
    ).toHaveLength(0);
  });

  it("PREP-TR-02: righe ripetute non prenotano oltre il residuo e lasciano versione e fisico invariati", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
    });
    const transfer = await createTransfer([
      { prodottoId, lottoId, quantita: 6 },
      { prodottoId, lottoId, quantita: 6 },
    ]);
    const response = await prepare(transfer);
    expect(response.status).toBe(409);
    expect(await reservations(transfer.id)).toHaveLength(0);
    expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(10);
    const detail = await request(app).get(`/trasferimenti/${transfer.id}`);
    expect(detail.body).toMatchObject({
      stato: "richiesto",
      versione: transfer.versione,
    });
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, transfer.id)),
    ).toHaveLength(0);
  });

  it("PREP-TR-06: stessa chiave e payload simultanei ritornano lo stesso Pronto con un solo effetto", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 3 });
    const transfer = await createTransfer([{ prodottoId, quantita: 2 }]);
    const idempotencyKey = key();
    const [first, second] = await Promise.all([
      prepare(transfer, idempotencyKey),
      prepare(transfer, idempotencyKey),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(first.body.versione).toBe(second.body.versione);
    expect(await reservations(transfer.id)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(comandiOperativiTable)
        .where(eq(comandiOperativiTable.idempotencyKey, idempotencyKey)),
    ).toHaveLength(1);
  });

  it("PREP-TR-07: un nuovo lotto FEFO precedente non cambia la partita già prenotata", async () => {
    const prodottoId = await createProdotto(scope);
    const prenotatoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      dataScadenza: "2027-12-01",
    });
    const transfer = await createTransfer([{ prodottoId, quantita: 3 }]);
    const ready = await prepare(transfer);
    expect(ready.status).toBe(200);
    const nuovoFefoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      dataScadenza: "2027-01-01",
    });
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ idempotencyKey: key(), versione: ready.body.versione });
    expect(started.status, started.text).toBe(200);
    const outgoing = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.trasferimentoId, transfer.id));
    expect(outgoing.map((row) => [row.lottoId, Number(row.quantita)])).toEqual([
      [prenotatoId, 3],
    ]);
    expect(Number((await getLotto(prenotatoId)).quantitaResidua)).toBe(2);
    expect(Number((await getLotto(nuovoFefoId)).quantitaResidua)).toBe(5);
  });

  it("PREP-TR-07: riserva incompleta impedisce Avvia senza ricostruzione FEFO", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
    });
    const transfer = await createTransfer([{ prodottoId, quantita: 3 }]);
    const ready = await prepare(transfer);
    expect(ready.status).toBe(200);
    const [reservation] = await reservations(transfer.id);
    await db
      .update(prenotazioniMagazzinoTable)
      .set({ quantita: "2" })
      .where(eq(prenotazioniMagazzinoTable.id, reservation.id));
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ idempotencyKey: key(), versione: ready.body.versione });
    expect(started.status).toBe(409);
    expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(5);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.trasferimentoId, transfer.id)),
    ).toHaveLength(0);
    expect(
      (await request(app).get(`/trasferimenti/${transfer.id}`)).body,
    ).toMatchObject({ stato: "preparato", versione: ready.body.versione });
  });

  it("PREP-TR-07: scadenza della partita riservata impedisce Avvia senza sostituzione", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      dataScadenza: "2027-01-01",
    });
    const transfer = await createTransfer([{ prodottoId, quantita: 3 }]);
    const ready = await prepare(transfer);
    expect(ready.status).toBe(200);
    await db
      .update(lottiTable)
      .set({ dataScadenza: "2020-01-01" })
      .where(eq(lottiTable.id, lottoId));
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send({ idempotencyKey: key(), versione: ready.body.versione });
    expect(started.status).toBe(409);
    expect((await reservations(transfer.id)).map((row) => row.stato)).toEqual([
      "attiva",
    ]);
    expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(5);
    expect(
      (await request(app).get(`/trasferimenti/${transfer.id}`)).body,
    ).toMatchObject({ stato: "preparato", versione: ready.body.versione });
  });

  it("PREP-TR-08: Annulla e Avvia concorrenti hanno un solo esito coerente", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
    });
    const transfer = await createTransfer([{ prodottoId, quantita: 3 }]);
    const ready = await prepare(transfer);
    expect(ready.status).toBe(200);
    const [cancel, dispatch] = await Promise.all([
      request(app).post(`/trasferimenti/${transfer.id}/annulla`).send({
        idempotencyKey: key(),
        versione: ready.body.versione,
        motivo: "Concorrenza M4B.1",
      }),
      request(app)
        .post(`/trasferimenti/${transfer.id}/avvia`)
        .send({ idempotencyKey: key(), versione: ready.body.versione }),
    ]);
    expect([cancel.status, dispatch.status].sort()).toEqual([200, 409]);
    const reservationStates = (await reservations(transfer.id)).map(
      (row) => row.stato,
    );
    const outgoing = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.trasferimentoId, transfer.id));
    if (dispatch.status === 200) {
      expect(reservationStates).toEqual(["convertita_in_trasferimento"]);
      expect(outgoing).toHaveLength(1);
      expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(2);
    } else {
      expect(reservationStates).toEqual(["rilasciata"]);
      expect(outgoing).toHaveLength(0);
      expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(5);
    }
  });
});
