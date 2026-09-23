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
import {
  areeOperativeTable,
  auditEventiTable,
  db,
  lottiTable,
  lottiLogiciTable,
  magazziniTable,
  movimentiTable,
  prodottiTable,
  pool,
  trasferimentiTable,
} from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
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
import logicalLotsRouter from "../src/routes/lotti-logici";
import { inventoryPartyBusinessKey } from "../src/lib/inventoryLedger";

let app: Express;
let scope: SeedScope;
let bootScope: SeedScope;
let operatoreId: number;
let origineId: number;
let destinoId: number;
let commandSequence = 0;

function commandBody<T extends Record<string, unknown>>(
  body: T,
  idempotencyKey = `trasferimenti-test-${Date.now()}-${++commandSequence}`,
) {
  return { ...body, idempotencyKey };
}

async function waitForBlockedBackend(
  blockerPid: number,
  expected = 1,
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await pool.query<{ blocked: string }>(
      `WITH RECURSIVE blocked(pid) AS (
         SELECT pid
           FROM pg_stat_activity
          WHERE $1 = ANY(pg_blocking_pids(pid))
         UNION
         SELECT activity.pid
           FROM pg_stat_activity activity
           JOIN blocked parent
             ON parent.pid = ANY(pg_blocking_pids(activity.pid))
       )
       SELECT count(*)::text AS blocked FROM blocked`,
      [blockerPid],
    );
    if (Number(result.rows[0]?.blocked ?? 0) >= expected) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `Attese ${expected} richieste sul lock PostgreSQL di laboratorio`,
  );
}

/** Creates a transfer with one riga via the API and records its id for cleanup. */
async function creaTrasferimento(opts: {
  prodottoId: number;
  quantita: number;
  unitaMisura?: string;
  lottoId?: number;
}) {
  const res = await request(app)
    .post("/trasferimenti")
    .send(
      commandBody({
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
      }),
    );
  expect(res.status).toBe(201);
  scope.trasferimentoIds.push(res.body.id);
  return res.body;
}

async function getLogicalLotState(logicalLotId: number) {
  const response = await request(app).get(`/lotti-logici/${logicalLotId}`);
  expect(response.status).toBe(200);
  return response.body as {
    inTransito: boolean;
    esaurito: boolean;
    maiCaricato: boolean;
    quantitaResiduaPrecisa: string;
  };
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
  app.use(logicalLotsRouter);
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
  it("rifiuta quantità frazionarie per un Prodotto non frazionabile", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const response = await request(app)
      .post("/trasferimenti")
      .send(
        commandBody({
          magazzinoOrigineId: origineId,
          magazzinoDestinoId: destinoId,
          dataRichiesta: "2026-06-24",
          trasportatoreNome: "Trasporto test",
          righe: [{ prodottoId, quantita: "1.5", unitaMisura: "pz" }],
        }),
      );
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/numero intero/i);
  });

  it("rifiuta l'unità legacy difforme dal Prodotto senza creare il trasferimento", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const response = await request(app)
      .post("/trasferimenti")
      .send(
        commandBody({
          magazzinoOrigineId: origineId,
          magazzinoDestinoId: destinoId,
          dataRichiesta: "2026-06-24",
          trasportatoreNome: "Trasporto test",
          righe: [{ prodottoId, quantita: 1, unitaMisura: "kg" }],
        }),
      );
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/deve essere pz/i);
  });

  it("deriva pz dal Prodotto e la conserva nei movimenti di uscita e entrata", async () => {
    const dispatcherId = await createUtente(scope);
    const receiverId = await createUtente(scope);
    const dispatcherApp = makeApp(dispatcherId, {
      username: `dispatcher_${dispatcherId}`,
      matricola: "M1C-DISPATCHER",
    });
    const receiverApp = makeApp(receiverId, {
      username: `receiver_${receiverId}`,
      matricola: "M1C-RECEIVER",
    });
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 3 });
    const created = await request(app)
      .post("/trasferimenti")
      .send(
        commandBody({
          magazzinoOrigineId: origineId,
          magazzinoDestinoId: destinoId,
          dataRichiesta: "2026-06-24",
          trasportatoreNome: "Trasporto test",
          righe: [{ prodottoId, quantita: 3 }],
        }),
      );
    expect(created.status).toBe(201);
    scope.trasferimentoIds.push(created.body.id);
    expect(
      (
        await request(dispatcherApp)
          .post(`/trasferimenti/${created.body.id}/avvia`)
          .send(commandBody({ versione: created.body.versione }))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(receiverApp)
          .post(`/trasferimenti/${created.body.id}/conferma`)
          .send(commandBody({ versione: created.body.versione + 1 }))
      ).status,
    ).toBe(200);
    const movements = await getMovimentiForTrasferimento(created.body.id);
    expect(movements.map((movement) => movement.unitaMisura)).toEqual(
      expect.arrayContaining(["pz", "pz"]),
    );
    expect(movements.every((movement) => movement.unitaMisura === "pz")).toBe(
      true,
    );
    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "trasferimento"),
          eq(auditEventiTable.entitaId, created.body.id),
        ),
      );
    expect(events.map((event) => event.azione)).toEqual(
      expect.arrayContaining([
        "TRASFERIMENTO_CREATO",
        "TRASFERIMENTO_AVVIATO",
        "TRASFERIMENTO_RICEVUTO",
      ]),
    );
    const actorByAction = new Map(
      events.map((event) => [event.azione, event.actorUserId]),
    );
    expect(actorByAction.get("TRASFERIMENTO_CREATO")).toBe(operatoreId);
    expect(actorByAction.get("TRASFERIMENTO_AVVIATO")).toBe(dispatcherId);
    expect(actorByAction.get("TRASFERIMENTO_RICEVUTO")).toBe(receiverId);
    const eventByAction = new Map(
      events.map((event) => [event.azione, event.id]),
    );
    expect(
      movements.find((movement) => movement.tipoDettaglio === "uscita"),
    ).toMatchObject({
      operatoreId: dispatcherId,
      auditEventoId: eventByAction.get("TRASFERIMENTO_AVVIATO"),
    });
    expect(
      movements.find((movement) => movement.tipoDettaglio === "entrata"),
    ).toMatchObject({
      operatoreId: receiverId,
      auditEventoId: eventByAction.get("TRASFERIMENTO_RICEVUTO"),
    });
  });
});

describe("comandi Trasferimento — idempotenza e versione", () => {
  it("rende la creazione ritentabile e rifiuta il riuso incompatibile della chiave", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const key = `transfer-create-${Date.now()}`;
    const payload = {
      magazzinoOrigineId: origineId,
      magazzinoDestinoId: destinoId,
      dataRichiesta: "2026-06-24",
      trasportatoreNome: "Trasporto idempotente",
      righe: [{ prodottoId, quantita: 2, unitaMisura: "pz" }],
    };

    const created = await request(app)
      .post("/trasferimenti")
      .send(commandBody(payload, key));
    expect(created.status).toBe(201);
    scope.trasferimentoIds.push(created.body.id);

    const replay = await request(app)
      .post("/trasferimenti")
      .send(
        commandBody(
          {
            ...payload,
            // Quantità equivalente e UDM omessa: il catalogo resta la fonte
            // autorevole, quindi l'intenzione applicativa non cambia.
            righe: [{ prodottoId, quantita: "2.0" }],
          },
          key,
        ),
      );
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      id: created.body.id,
      codice: created.body.codice,
      versione: created.body.versione,
    });

    const conflict = await request(app)
      .post("/trasferimenti")
      .send(commandBody({ ...payload, note: "intenzione differente" }, key));
    expect(conflict.status).toBe(409);

    const rows = await db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, created.body.id));
    expect(rows).toHaveLength(1);

    const revoked = makeApp(operatoreId, {
      isAdmin: false,
      aree: ["magazzino"],
      permessi: [],
    });
    expect(
      (
        await request(revoked)
          .post("/trasferimenti")
          .send(commandBody(payload, key))
      ).status,
    ).toBe(403);
  });

  it("serializza due creazioni concorrenti con la stessa intenzione", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const marker = `concurrent-${Date.now()}`;
    const key = `transfer-create-concurrent-${Date.now()}`;
    const payload = {
      magazzinoOrigineId: origineId,
      magazzinoDestinoId: destinoId,
      dataRichiesta: "2026-06-24",
      trasportatoreNome: "Trasporto concorrente",
      note: marker,
      righe: [{ prodottoId, quantita: 2, unitaMisura: "pz" }],
    };

    const responses = await Promise.all([
      request(app).post("/trasferimenti").send(commandBody(payload, key)),
      request(app).post("/trasferimenti").send(commandBody(payload, key)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 201,
    ]);
    expect(responses[0].body.id).toBe(responses[1].body.id);
    scope.trasferimentoIds.push(responses[0].body.id);

    const rows = await db
      .select({ id: trasferimentiTable.id })
      .from(trasferimentiTable)
      .where(
        and(
          eq(trasferimentiTable.magazzinoOrigineId, origineId),
          eq(trasferimentiTable.magazzinoDestinoId, destinoId),
          eq(trasferimentiTable.note, marker),
        ),
      );
    expect(rows).toHaveLength(1);
  });

  it("rivalida lo scope corrente prima di restituire un replay in attesa del lock", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 2,
      unitaMisura: "pz",
    });
    const areaOrigineId = scope.areaOperativaIds[0];
    const scopedApp = makeApp(operatoreId, {
      isAdmin: false,
      aree: ["magazzino"],
      permessi: ["magazzino.transfers.create"],
      areaOperativaId: areaOrigineId,
    });
    const key = `transfer-update-scope-${Date.now()}`;
    const payload = {
      versione: transfer.versione,
      note: "replay con scope corrente",
    };
    const updated = await request(scopedApp)
      .patch(`/trasferimenti/${transfer.id}`)
      .send(commandBody(payload, key));
    expect(updated.status, updated.text).toBe(200);

    const [revokedArea] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Area revoca replay ${Date.now()}` })
      .returning({ id: areeOperativeTable.id });
    scope.areaOperativaIds.push(revokedArea.id);
    const [revokedGeneral] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: revokedArea.id,
        codice: "GENERALE",
        descrizione: "Generale",
        isGenerale: true,
      })
      .returning({ id: lottiLogiciTable.id });
    scope.lottoLogicoIds.push(revokedGeneral.id);

    const blocker = await pool.connect();
    let replayPromise: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const blockerPid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [`document-command:trasferimento.update:${key}`],
      );

      replayPromise = request(scopedApp)
        .patch(`/trasferimenti/${transfer.id}`)
        .send(commandBody(payload, key))
        .then((response) => response);
      await waitForBlockedBackend(blockerPid.rows[0].pid);

      await db
        .update(magazziniTable)
        .set({ areaOperativaId: revokedArea.id })
        .where(inArray(magazziniTable.id, [origineId, destinoId]));
      await blocker.query("COMMIT");

      const replay = await replayPromise;
      expect(replay.status, replay.text).toBe(403);
      expect(replay.body.error).toMatch(/non accessibile/i);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await replayPromise?.catch(() => undefined);
    }
  });

  it("richiede una chiave client sui quattro comandi mutanti", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 5 });
    const createPayload = {
      magazzinoOrigineId: origineId,
      magazzinoDestinoId: destinoId,
      dataRichiesta: "2026-06-24",
      trasportatoreNome: "Trasporto con chiave",
      righe: [{ prodottoId, quantita: 2, unitaMisura: "pz" }],
    };
    expect(
      (await request(app).post("/trasferimenti").send(createPayload)).status,
    ).toBe(400);

    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 2,
      unitaMisura: "pz",
    });
    expect(
      (
        await request(app)
          .patch(`/trasferimenti/${transfer.id}`)
          .send({ versione: transfer.versione, note: "senza chiave" })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/avvia`)
          .send({ versione: transfer.versione })
      ).status,
    ).toBe(400);

    const dispatched = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: transfer.versione }));
    expect(dispatched.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/conferma`)
          .send({ versione: dispatched.body.versione })
      ).status,
    ).toBe(400);
  });

  it("protegge modifica, partenza e ricezione con receipt e versione autorevole", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 5 });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 2,
      unitaMisura: "pz",
    });

    const updateKey = `transfer-update-${Date.now()}`;
    const updatePayload = {
      versione: transfer.versione,
      note: "nota idempotente",
    };
    const updated = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send(commandBody(updatePayload, updateKey));
    expect(updated.status).toBe(200);
    const updateReplay = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send(commandBody(updatePayload, updateKey));
    expect(updateReplay.status).toBe(200);
    expect(updateReplay.body.versione).toBe(updated.body.versione);
    expect(
      (
        await request(app)
          .patch(`/trasferimenti/${transfer.id}`)
          .send(
            commandBody(
              { ...updatePayload, note: "payload incompatibile" },
              updateKey,
            ),
          )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .patch(`/trasferimenti/${transfer.id}`)
          .send(commandBody(updatePayload))
      ).status,
    ).toBe(409);

    const dispatchKey = `transfer-dispatch-${Date.now()}`;
    const dispatchPayload = { versione: updated.body.versione };
    const dispatched = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody(dispatchPayload, dispatchKey));
    expect(dispatched.status).toBe(200);
    const dispatchReplay = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody(dispatchPayload, dispatchKey));
    expect(dispatchReplay.status).toBe(200);
    expect(dispatchReplay.body.versione).toBe(dispatched.body.versione);
    expect(
      (await getMovimentiForTrasferimento(transfer.id)).filter(
        (row) => row.tipoDettaglio === "uscita",
      ),
    ).toHaveLength(1);

    const receiveKey = `transfer-receive-${Date.now()}`;
    const receivePayload = { versione: dispatched.body.versione };
    const received = await request(app)
      .post(`/trasferimenti/${transfer.id}/conferma`)
      .send(commandBody(receivePayload, receiveKey));
    expect(received.status).toBe(200);
    const receiveReplay = await request(app)
      .post(`/trasferimenti/${transfer.id}/conferma`)
      .send(commandBody(receivePayload, receiveKey));
    expect(receiveReplay.status).toBe(200);
    expect(receiveReplay.body.versione).toBe(received.body.versione);
    expect(
      (await getMovimentiForTrasferimento(transfer.id)).filter(
        (row) => row.tipoDettaglio === "entrata",
      ),
    ).toHaveLength(1);
  });
});

describe("POST /trasferimenti/:id/avvia — uscita FEFO", () => {
  it("LOT-EX-01: usa solo il lotto esplicito anche se un altro scade prima", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-01-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-06-01",
    });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 6,
      lottoId: lottoB,
    });
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: transfer.versione }));
    expect(started.status, started.text).toBe(200);
    expect(Number((await getLotto(lottoA)).quantitaResidua)).toBe(10);
    expect(Number((await getLotto(lottoB)).quantitaResidua)).toBe(4);
    const outputs = (await getMovimentiForTrasferimento(transfer.id)).filter(
      (m) => m.tipoDettaglio === "uscita",
    );
    expect(outputs).toHaveLength(1);
    expect(outputs[0].lottoId).toBe(lottoB);
    expect(Number(outputs[0].quantita)).toBe(6);
  });

  it("LOT-EX-02: lotto esplicito insufficiente non ripiega su FEFO", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-01-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 2,
      dataScadenza: "2027-06-01",
    });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 5,
      lottoId: lottoB,
    });
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: transfer.versione }));
    expect(started.status).toBe(409);
    expect(Number((await getLotto(lottoA)).quantitaResidua)).toBe(10);
    expect(Number((await getLotto(lottoB)).quantitaResidua)).toBe(2);
    expect(await getMovimentiForTrasferimento(transfer.id)).toHaveLength(0);
    expect(
      (await request(app).get(`/trasferimenti/${transfer.id}`)).body.stato,
    ).toBe("richiesto");
  });

  it("LOT-EX-03: rifiuta lotto di altro prodotto, deposito o scaduto", async () => {
    const prodottoId = await createProdotto(scope);
    const altroProdotto = await createProdotto(scope);
    const invalidi = [
      await createLotto({
        prodottoId: altroProdotto,
        magazzinoId: origineId,
        quantita: 8,
      }),
      await createLotto({ prodottoId, magazzinoId: destinoId, quantita: 8 }),
      await createLotto({
        prodottoId,
        magazzinoId: origineId,
        quantita: 8,
        dataScadenza: "2020-01-01",
      }),
    ];
    for (const lottoId of invalidi) {
      const transfer = await creaTrasferimento({
        prodottoId,
        quantita: 3,
        lottoId,
      });
      const started = await request(app)
        .post(`/trasferimenti/${transfer.id}/avvia`)
        .send(commandBody({ versione: transfer.versione }));
      expect(started.status, started.text).toBe(409);
      expect(Number((await getLotto(lottoId)).quantitaResidua)).toBe(8);
      expect(await getMovimentiForTrasferimento(transfer.id)).toHaveLength(0);
    }
  });

  it("richiede il lotto quando il prodotto lo prevede", async () => {
    const prodottoId = await createProdotto(scope);
    await db
      .update(prodottiTable)
      .set({ lottoFisicoObbligatorio: true })
      .where(eq(prodottiTable.id, prodottoId));
    const response = await request(app)
      .post("/trasferimenti")
      .send(
        commandBody({
          magazzinoOrigineId: origineId,
          magazzinoDestinoId: destinoId,
          dataRichiesta: "2026-06-24",
          trasportatoreNome: "Trasporto test",
          righe: [{ prodottoId, quantita: 1 }],
        }),
      );
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/lotto fisico.*obbligatorio/i);
  });

  it("LOT-EX-05: due Trasferimenti concorrenti sullo stesso lotto esplicito non duplicano il prelievo", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoA = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-01-01",
    });
    const lottoB = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
      dataScadenza: "2027-06-01",
    });
    const first = await creaTrasferimento({
      prodottoId,
      quantita: 6,
      lottoId: lottoB,
    });
    const second = await creaTrasferimento({
      prodottoId,
      quantita: 6,
      lottoId: lottoB,
    });
    const blocker = await pool.connect();
    let committed = false;
    let pendingFirst: Promise<request.Response> | undefined;
    let pendingSecond: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM lotti WHERE id = $1 FOR UPDATE", [
        lottoB,
      ]);
      pendingFirst = request(app)
        .post(`/trasferimenti/${first.id}/avvia`)
        .send(commandBody({ versione: first.versione }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid);
      pendingSecond = request(app)
        .post(`/trasferimenti/${second.id}/avvia`)
        .send(commandBody({ versione: second.versione }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid, 2);
      await blocker.query("COMMIT");
      committed = true;
      const responses = await Promise.all([pendingFirst, pendingSecond]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(Number((await getLotto(lottoA)).quantitaResidua)).toBe(10);
      expect(Number((await getLotto(lottoB)).quantitaResidua)).toBe(4);
      const outputs = (await getMovimentiForTrasferimento(first.id))
        .concat(await getMovimentiForTrasferimento(second.id))
        .filter((m) => m.tipoDettaglio === "uscita");
      expect(outputs).toHaveLength(1);
      expect(outputs[0].lottoId).toBe(lottoB);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingFirst, pendingSecond].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }
  });
  it("pre-locka prodotti e lotti in ordine globale con righe Trasferimento inverse", async () => {
    const prodottoA = await createProdotto(scope);
    const prodottoB = await createProdotto(scope);
    const lottoA = await createLotto({
      prodottoId: prodottoA,
      magazzinoId: origineId,
      quantita: 10,
    });
    await createLotto({
      prodottoId: prodottoB,
      magazzinoId: origineId,
      quantita: 10,
    });
    const transferPayload = (righe: Array<Record<string, unknown>>) => ({
      magazzinoOrigineId: origineId,
      magazzinoDestinoId: destinoId,
      dataRichiesta: "2026-06-24",
      trasportatoreNome: "Trasporto lock ordering",
      righe,
    });
    const rigaA = {
      prodottoId: prodottoA,
      quantita: 1,
      unitaMisura: "kg",
    };
    const rigaB = {
      prodottoId: prodottoB,
      quantita: 1,
      unitaMisura: "kg",
    };
    const [createdAB, createdBA] = await Promise.all([
      request(app)
        .post("/trasferimenti")
        .send(commandBody(transferPayload([rigaA, rigaB]))),
      request(app)
        .post("/trasferimenti")
        .send(commandBody(transferPayload([rigaB, rigaA]))),
    ]);
    expect(createdAB.status, createdAB.text).toBe(201);
    expect(createdBA.status, createdBA.text).toBe(201);
    scope.trasferimentoIds.push(createdAB.body.id, createdBA.body.id);

    const blocker = await pool.connect();
    let committed = false;
    let pendingAB: Promise<request.Response> | undefined;
    let pendingBA: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const blockerPid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM lotti WHERE id = $1 FOR UPDATE", [
        lottoA,
      ]);

      pendingAB = request(app)
        .post(`/trasferimenti/${createdAB.body.id}/avvia`)
        .send(commandBody({ versione: createdAB.body.versione }))
        .then((response) => response);
      await waitForBlockedBackend(blockerPid.rows[0].pid);
      pendingBA = request(app)
        .post(`/trasferimenti/${createdBA.body.id}/avvia`)
        .send(commandBody({ versione: createdBA.body.versione }))
        .then((response) => response);
      await waitForBlockedBackend(blockerPid.rows[0].pid, 2);

      await blocker.query("COMMIT");
      committed = true;
      const responses = await Promise.all([pendingAB, pendingBA]);
      expect(
        responses.map((response) => response.status),
        responses.map((response) => response.text).join("\n"),
      ).toEqual([200, 200]);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingAB, pendingBA].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }
  });

  it("traduce il deadlock PostgreSQL in 409 e consente il retry senza receipt fantasma", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 10,
    });
    const transfer = await creaTrasferimento({
      prodottoId,
      quantita: 1,
    });
    const suffix = `${process.pid}_${Date.now()}_${++commandSequence}`;
    const functionName = `test_transfer_deadlock_${suffix}`;
    const triggerName = `test_transfer_deadlock_trg_${suffix}`;
    const idempotencyKey = `transfer-deadlock-${suffix}`;
    const body = commandBody({ versione: transfer.versione }, idempotencyKey);

    await pool.query(`
      CREATE FUNCTION "${functionName}"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic transfer deadlock' USING ERRCODE = '40P01';
      END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER "${triggerName}"
      BEFORE UPDATE OF quantita_residua ON lotti
      FOR EACH ROW WHEN (OLD.id = ${lottoId})
      EXECUTE FUNCTION "${functionName}"()
    `);
    try {
      const failed = await request(app)
        .post(`/trasferimenti/${transfer.id}/avvia`)
        .send(body);
      expect(failed.status, failed.text).toBe(409);
      expect(failed.body.error).toMatch(/operazione concorrente/i);
    } finally {
      await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON lotti`);
      await pool.query(`DROP FUNCTION IF EXISTS "${functionName}"()`);
    }

    const retried = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(body);
    expect(retried.status, retried.text).toBe(200);
    expect(retried.body.stato).toBe("in_transito");
  });

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
      .send(commandBody({ versione: t.versione }));
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
    const dettaglio = await request(app).get(`/trasferimenti/${t.id}`);
    expect(dettaglio.status, dettaglio.text).toBe(200);
    expect(dettaglio.body.righe[0].ripartizioniLotto).toEqual([
      expect.objectContaining({ lottoId: lottoA, quantita: 10 }),
      expect.objectContaining({ lottoId: lottoB, quantita: 5 }),
    ]);
  });

  it("rifiuta atomicamente quando la giacenza all'origine è insufficiente", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 5 });

    const t = await creaTrasferimento({ prodottoId, quantita: 10 });

    const res = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send(commandBody({ versione: t.versione }));
    expect(res.status).toBe(409);
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
      .send(commandBody({ versione: t.versione }));
    expect(first.status).toBe(200);

    // Secondo avvio con una nuova intenzione e versione superata → 409.
    const second = await request(app)
      .post(`/trasferimenti/${t.id}/avvia`)
      .send(commandBody({ versione: t.versione }));
    expect(second.status).toBe(409);
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
      .send(commandBody({ versione: t.versione }));
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
        .send(commandBody({ versione: t.versione })),
      request(app)
        .post(`/trasferimenti/${t.id}/avvia`)
        .send(commandBody({ versione: t.versione })),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
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
          .send(commandBody({ versione: trasferimento.versione }))
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
  it("acquisisce tutte le business key di ricezione prima di applicare ordini inversi", async () => {
    const prodottoA = await createProdotto(scope);
    const prodottoB = await createProdotto(scope);
    const lottoA = await createLotto({
      prodottoId: prodottoA,
      magazzinoId: origineId,
      quantita: 2,
      codiceLotto: "RECEIVE-A",
    });
    const lottoB = await createLotto({
      prodottoId: prodottoB,
      magazzinoId: origineId,
      quantita: 2,
      codiceLotto: "RECEIVE-B",
    });
    await db
      .update(lottiTable)
      .set({ codiceLottoNormalizzato: "RECEIVE-A" })
      .where(eq(lottiTable.id, lottoA));
    await db
      .update(lottiTable)
      .set({ codiceLottoNormalizzato: "RECEIVE-B" })
      .where(eq(lottiTable.id, lottoB));
    const sourceLots = await db
      .select()
      .from(lottiTable)
      .where(inArray(lottiTable.id, [lottoA, lottoB]));
    const byId = new Map(sourceLots.map((lotto) => [lotto.id, lotto]));
    const keyByLot = new Map(
      sourceLots.map((lotto) => [
        lotto.id,
        inventoryPartyBusinessKey({
          magazzinoId: destinoId,
          prodottoId: lotto.prodottoId,
          lottoLogicoId: lotto.lottoLogicoId!,
          fondoOrigine: lotto.fondoOrigine,
          fornitoreId: lotto.fornitoreId,
          lottoNormalizzato: lotto.codiceLottoNormalizzato!,
          dataScadenza: lotto.dataScadenza,
          fattoreKgLtPezzo: lotto.fattoreKgLtPezzo,
        }),
      ]),
    );
    const orderedLots = [lottoA, lottoB].sort((left, right) =>
      keyByLot.get(left)!.localeCompare(keyByLot.get(right)!),
    );

    const createInTransit = async (lotIds: number[]) => {
      const [transfer] = await db
        .insert(trasferimentiTable)
        .values({
          codice: `TRF-RECEIVE-${Date.now()}-${++commandSequence}`,
          magazzinoOrigineId: origineId,
          magazzinoDestinoId: destinoId,
          dataRichiesta: "2026-06-24",
          stato: "in_transito",
          operatoreId,
        })
        .returning();
      scope.trasferimentoIds.push(transfer.id);
      for (const lottoId of lotIds) {
        const lotto = byId.get(lottoId)!;
        await db.insert(movimentiTable).values({
          tipoMovimento: "trasferimento",
          tipoDettaglio: "uscita",
          dataMovimento: "2026-06-24",
          magazzinoId: origineId,
          prodottoId: lotto.prodottoId,
          lottoId,
          quantita: "1.00",
          unitaMisura: "kg",
          trasferimentoId: transfer.id,
          fondoOrigine: lotto.fondoOrigine,
          naturaContabile: "TRASFERIMENTO_INTERNO_USCITA",
          dominioOrigine: "TRASFERIMENTO",
          entitaOrigineTipo: "trasferimento",
          entitaOrigineId: transfer.id,
          operatoreId,
        });
      }
      return transfer;
    };
    const transferAB = await createInTransit(orderedLots);
    const transferBA = await createInTransit([...orderedLots].reverse());
    const firstKey = keyByLot.get(orderedLots[0])!;
    const blocker = await pool.connect();
    let committed = false;
    let pendingAB: Promise<request.Response> | undefined;
    let pendingBA: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const blockerPid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [firstKey],
      );
      pendingAB = request(app)
        .post(`/trasferimenti/${transferAB.id}/conferma`)
        .send(commandBody({ versione: transferAB.versione }))
        .then((response) => response);
      await waitForBlockedBackend(blockerPid.rows[0].pid);
      pendingBA = request(app)
        .post(`/trasferimenti/${transferBA.id}/conferma`)
        .send(commandBody({ versione: transferBA.versione }))
        .then((response) => response);
      await waitForBlockedBackend(blockerPid.rows[0].pid, 2);
      await blocker.query("COMMIT");
      committed = true;
      const responses = await Promise.all([pendingAB, pendingBA]);
      expect(
        responses.map((response) => response.status),
        responses.map((response) => response.text).join("\n"),
      ).toEqual([200, 200]);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingAB, pendingBA].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }

    const destinationLots = await getLottiInMagazzino(destinoId);
    expect(destinationLots).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codiceLottoNormalizzato: "RECEIVE-A" }),
        expect.objectContaining({ codiceLottoNormalizzato: "RECEIVE-B" }),
      ]),
    );
    expect(
      destinationLots
        .filter((lotto) =>
          ["RECEIVE-A", "RECEIVE-B"].includes(
            lotto.codiceLottoNormalizzato ?? "",
          ),
        )
        .map((lotto) => Number(lotto.quantitaResidua)),
    ).toEqual([2, 2]);
  });

  it("preserva il lotto logico nella stessa Area anche se viene chiuso durante il transito", async () => {
    const [logicalLot] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: scope.areaOperativaIds[0],
        codice: `PAM-${Date.now()}`,
        descrizione: "Raccolta PAM",
      })
      .returning();
    scope.lottoLogicoIds.push(logicalLot.id);
    const prodottoId = await createProdotto(scope);
    const sourceLotId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      lottoLogicoId: logicalLot.id,
      codiceLotto: "PAM-FISICO",
    });

    const transfer = await creaTrasferimento({ prodottoId, quantita: 5 });
    expect(transfer.righe[0].lottoId).toBeNull();
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/avvia`)
          .send(commandBody({ versione: transfer.versione }))
      ).status,
    ).toBe(200);
    expect(Number((await getLotto(sourceLotId)).quantitaResidua)).toBe(0);
    expect(await getLogicalLotState(logicalLot.id)).toMatchObject({
      inTransito: true,
      esaurito: false,
      maiCaricato: false,
    });
    await db
      .update(lottiLogiciTable)
      .set({ stato: "chiuso" })
      .where(eq(lottiLogiciTable.id, logicalLot.id));

    const received = await request(app)
      .post(`/trasferimenti/${transfer.id}/conferma`)
      .send(commandBody({ versione: transfer.versione + 1 }));
    expect(received.status).toBe(200);
    const [destinationLot] = await getLottiInMagazzino(destinoId);
    expect(destinationLot).toMatchObject({
      lottoLogicoId: logicalLot.id,
      codiceLotto: "PAM-FISICO",
    });
    const sameAreaState = await getLogicalLotState(logicalLot.id);
    expect(sameAreaState).toMatchObject({
      inTransito: false,
      esaurito: false,
      maiCaricato: false,
    });
    expect(Number(sameAreaState.quantitaResiduaPrecisa)).toBe(5);
  });

  it("deriva il transito dal ledger quando FEFO usa più partite senza lotto esplicito", async () => {
    const [logicalLot] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: scope.areaOperativaIds[0],
        codice: `MULTI-${Date.now()}`,
        descrizione: "Raccolta FEFO multi-lotto",
      })
      .returning();
    scope.lottoLogicoIds.push(logicalLot.id);
    const prodottoId = await createProdotto(scope);
    const firstLotId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      lottoLogicoId: logicalLot.id,
      codiceLotto: "MULTI-A",
      dataScadenza: "2027-01-31",
    });
    const secondLotId = await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 5,
      lottoLogicoId: logicalLot.id,
      codiceLotto: "MULTI-B",
      dataScadenza: "2027-02-28",
    });

    const transfer = await creaTrasferimento({ prodottoId, quantita: 10 });
    expect(transfer.righe[0].lottoId).toBeNull();
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: transfer.versione }));
    expect(started.status).toBe(200);
    expect(started.body.stato).toBe("in_transito");

    const outputs = (await getMovimentiForTrasferimento(transfer.id)).filter(
      (movement) => movement.tipoDettaglio === "uscita",
    );
    expect(outputs).toHaveLength(2);
    expect(new Set(outputs.map((movement) => movement.lottoId))).toEqual(
      new Set([firstLotId, secondLotId]),
    );
    const state = await getLogicalLotState(logicalLot.id);
    expect(state).toMatchObject({
      inTransito: true,
      esaurito: false,
      maiCaricato: false,
    });
    expect(Number(state.quantitaResiduaPrecisa)).toBe(0);
  });

  it("mantiene inTransito su un trasferimento parziale materializzato nel ledger", async () => {
    const [logicalLot] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: scope.areaOperativaIds[0],
        codice: `PART-${Date.now()}`,
        descrizione: "Raccolta trasferimento parziale",
      })
      .returning();
    scope.lottoLogicoIds.push(logicalLot.id);
    const prodottoId = await createProdotto(scope);
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 20,
      lottoLogicoId: logicalLot.id,
      codiceLotto: "PART-A",
    });

    const transfer = await creaTrasferimento({ prodottoId, quantita: 5 });
    expect(transfer.righe[0].lottoId).toBeNull();
    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: transfer.versione }));
    expect(started.status).toBe(200);

    const state = await getLogicalLotState(logicalLot.id);
    expect(state).toMatchObject({
      inTransito: true,
      esaurito: false,
      maiCaricato: false,
    });
    expect(Number(state.quantitaResiduaPrecisa)).toBe(15);
  });

  it("assegna il Generale di destinazione nei trasferimenti cross-Area e conserva la provenienza", async () => {
    const sourceAreaId = scope.areaOperativaIds[0];
    const [sourceLogicalLot] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: sourceAreaId,
        codice: `DON-${Date.now()}`,
        descrizione: "Donazione origine",
      })
      .returning();
    scope.lottoLogicoIds.push(sourceLogicalLot.id);
    const [destinationArea] = await db
      .insert(areeOperativeTable)
      .values({ nome: `Area destinazione ${Date.now()}` })
      .returning();
    scope.areaOperativaIds.push(destinationArea.id);
    const [destinationGeneral] = await db
      .insert(lottiLogiciTable)
      .values({
        areaOperativaId: destinationArea.id,
        codice: "GENERALE",
        descrizione: "Generale",
        isGenerale: true,
      })
      .returning();
    scope.lottoLogicoIds.push(destinationGeneral.id);
    const [destinationWarehouse] = await db
      .insert(magazziniTable)
      .values({
        codice: `DST-${Math.random().toString(36).slice(2, 8)}`,
        nome: "Destinazione altra Area",
        areaOperativaId: destinationArea.id,
      })
      .returning();
    scope.magazzinoIds.push(destinationWarehouse.id);
    destinoId = destinationWarehouse.id;

    const prodottoId = await createProdotto(scope);
    await createLotto({
      prodottoId,
      magazzinoId: origineId,
      quantita: 4,
      lottoLogicoId: sourceLogicalLot.id,
      codiceLotto: "DON-FISICO",
    });
    const transfer = await creaTrasferimento({ prodottoId, quantita: 4 });
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/avvia`)
          .send(commandBody({ versione: transfer.versione }))
      ).status,
    ).toBe(200);
    expect(await getLogicalLotState(sourceLogicalLot.id)).toMatchObject({
      inTransito: true,
      esaurito: false,
      maiCaricato: false,
    });
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${transfer.id}/conferma`)
          .send(commandBody({ versione: transfer.versione + 1 }))
      ).status,
    ).toBe(200);

    const [destinationLot] = await getLottiInMagazzino(destinoId);
    expect(destinationLot.lottoLogicoId).toBe(destinationGeneral.id);
    expect(destinationLot.lottoLogicoId).not.toBe(sourceLogicalLot.id);
    const copiedLogicalLots = await db
      .select()
      .from(lottiLogiciTable)
      .where(
        and(
          eq(lottiLogiciTable.areaOperativaId, destinationArea.id),
          eq(lottiLogiciTable.codice, sourceLogicalLot.codice),
        ),
      );
    expect(copiedLogicalLots).toHaveLength(0);
    const movements = await getMovimentiForTrasferimento(transfer.id);
    const output = movements.find((row) => row.tipoDettaglio === "uscita");
    const input = movements.find((row) => row.tipoDettaglio === "entrata");
    expect(input?.movimentoOrigineId).toBe(output?.id);
    const sourceState = await getLogicalLotState(sourceLogicalLot.id);
    expect(sourceState).toMatchObject({
      inTransito: false,
      esaurito: true,
      maiCaricato: false,
    });
    expect(Number(sourceState.quantitaResiduaPrecisa)).toBe(0);
    const destinationState = await getLogicalLotState(destinationGeneral.id);
    expect(destinationState).toMatchObject({
      inTransito: false,
      esaurito: false,
      maiCaricato: false,
    });
    expect(Number(destinationState.quantitaResiduaPrecisa)).toBe(4);
  });

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
          .send(commandBody({ versione: t.versione }))
      ).status,
    ).toBe(200);

    const res = await request(app)
      .post(`/trasferimenti/${t.id}/conferma`)
      .send(commandBody({ versione: t.versione + 1 }));
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
          .send(commandBody({ versione: t.versione }))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/conferma`)
          .send(commandBody({ versione: t.versione + 1 }))
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
          .send(commandBody({ versione: t.versione }))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/trasferimenti/${t.id}/conferma`)
          .send(commandBody({ versione: t.versione + 1 }))
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
      .send(commandBody({ versione: t.versione }));
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
          .send(commandBody({ versione: t.versione }))
      ).status,
    ).toBe(200);

    const responses = await Promise.all([
      request(app)
        .post(`/trasferimenti/${t.id}/conferma`)
        .send(commandBody({ versione: t.versione + 1 })),
      request(app)
        .post(`/trasferimenti/${t.id}/conferma`)
        .send(commandBody({ versione: t.versione + 1 })),
    ]);
    expect(
      responses.filter((response) => response.status === 200),
    ).toHaveLength(1);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
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
      .send(
        commandBody({
          versione: transfer.versione,
          note: "non deve restare",
          righe: [
            { prodottoId, quantita: 4, unitaMisura: "pz" },
            { prodottoId, quantita: 1, unitaMisura: "kg" },
          ],
        }),
      );
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
      .send(
        commandBody({
          versione: transfer.versione,
          righe: [{ prodottoId, quantita: 3, unitaMisura: "pz" }],
        }),
      );
    expect(withCanonicalUnit.status).toBe(200);
    expect(withCanonicalUnit.body.righe).toMatchObject([
      { prodottoId, quantita: 3, unitaMisura: "pz" },
    ]);

    const withoutUnit = await request(app)
      .patch(`/trasferimenti/${transfer.id}`)
      .send(
        commandBody({
          versione: withCanonicalUnit.body.versione,
          righe: [{ prodottoId, quantita: 4 }],
        }),
      );
    expect(withoutUnit.status).toBe(200);
    expect(withoutUnit.body.righe).toMatchObject([
      { prodottoId, quantita: 4, unitaMisura: "pz" },
    ]);

    const started = await request(app)
      .post(`/trasferimenti/${transfer.id}/avvia`)
      .send(commandBody({ versione: withoutUnit.body.versione }));
    expect(started.status).toBe(200);
    const received = await request(app)
      .post(`/trasferimenti/${transfer.id}/conferma`)
      .send(commandBody({ versione: started.body.versione }));
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
      .send(
        commandBody({
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
        }),
      );
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
      .send(
        commandBody({
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
        }),
      );
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
          .send(commandBody({ versione: t.versione }))
      ).status,
    ).toBe(200);

    const res = await request(app)
      .patch(`/trasferimenti/${t.id}`)
      .send(
        commandBody({
          versione: t.versione + 1,
          righe: [{ prodottoId, quantita: 3, unitaMisura: "kg" }],
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/prima dell'avvio/i);
  });

  it("consente la modifica delle righe prima dell'avvio", async () => {
    const prodottoId = await createProdotto(scope);
    await createLotto({ prodottoId, magazzinoId: origineId, quantita: 20 });

    const t = await creaTrasferimento({ prodottoId, quantita: 5 });

    const res = await request(app)
      .patch(`/trasferimenti/${t.id}`)
      .send(
        commandBody({
          versione: t.versione,
          righe: [{ prodottoId, quantita: 7, unitaMisura: "kg" }],
        }),
      );
    expect(res.status).toBe(200);
    expect(res.body.righe).toHaveLength(1);
    expect(res.body.righe[0].quantita).toBe(7);
  });
});
