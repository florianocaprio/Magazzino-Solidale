import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { randomUUID } from "node:crypto";
import request from "supertest";
import express from "express";
import {
  db,
  pool,
  beneficiariTable,
  bolleTable,
  bollaRigheTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  consegneTable,
  interventiTable,
  interventiStoricoStatiTable,
  operazioniDistribuzioneMagazzinoTable,
  auditEventiTable,
  comandiOperativiTable,
  entiDestinatariTable,
  magazziniTable,
  trasferimentoRigheTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import bolleRouter from "../src/routes/bolle";
import trasferimentiRouter from "../src/routes/trasferimenti";
import consegneRouter from "../src/routes/consegne";
import preparazioneConsegneRouter from "../src/routes/preparazione-consegne";
import reportRouter from "../src/routes/report";
import {
  annullaInterventoDaBollaTx,
  stornoRigaTx,
} from "../src/lib/bollaDelivery";
import { dataOperativaEuropeRome } from "../src/lib/lottoPolicy";
import { buildPacchiReport } from "../src/lib/reporting/pacchi";
import {
  makeScopedApp,
  newScope,
  cleanup,
  type SeedScope,
  createAreaOperativa,
  createBeneficiario,
  createCentro,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  insertConsegna,
  insertBolla,
  insertBollaRiga,
  insertMovimento,
  insertPrenotazioneMagazzino,
  insertTrasferimento,
} from "./scope-helpers";

let bootScope: SeedScope;
let scope: SeedScope;
let operatoreId: number;
let centroA: number;
let centroB: number;
let benA: number;
let benB: number;
let magA: number;
let magB: number;
let prod: number;

const appAs = (centro: number | null) =>
  makeScopedApp(bolleRouter, { id: operatoreId, centroAscoltoId: centro });
const consegneAppAs = (centro: number | null) =>
  makeScopedApp(consegneRouter, { id: operatoreId, centroAscoltoId: centro });
const preparazioneAppAs = (centro: number | null) =>
  makeScopedApp(preparazioneConsegneRouter, {
    id: operatoreId,
    centroAscoltoId: centro,
  });
const reportAppAs = (centro: number | null) =>
  makeScopedApp(reportRouter, {
    id: operatoreId,
    centroAscoltoId: centro,
    aree: ["analisi", "sociale", "magazzino"],
    permessi: ["magazzino.fse.view"],
  });

async function prenotazioniBolla(bollaId: number) {
  return db
    .select()
    .from(prenotazioniMagazzinoTable)
    .where(eq(prenotazioniMagazzinoTable.bollaId, bollaId))
    .orderBy(asc(prenotazioniMagazzinoTable.id));
}

async function movimentiBolla(bollaId: number) {
  return db
    .select()
    .from(movimentiTable)
    .where(eq(movimentiTable.bollaId, bollaId))
    .orderBy(asc(movimentiTable.id));
}

async function lottoResidua(lottoId: number): Promise<number> {
  const [lotto] = await db
    .select()
    .from(lottiTable)
    .where(eq(lottiTable.id, lottoId));
  return Number(lotto.quantitaResidua);
}

async function bollaStato(bollaId: number): Promise<string> {
  const [bolla] = await db
    .select()
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  return bolla.stato;
}

async function bollaVersione(bollaId: number): Promise<number> {
  const [bolla] = await db
    .select({ versione: bolleTable.versione })
    .from(bolleTable)
    .where(eq(bolleTable.id, bollaId));
  if (!bolla) throw new Error(`Bolla ${bollaId} non trovata nel test`);
  return bolla.versione;
}

const commandKey = (label: string) => `${label}-${randomUUID()}`;

function createCommandBody<T extends Record<string, unknown>>(
  body: T,
  idempotencyKey = commandKey("bolla-create"),
) {
  return { ...body, idempotencyKey };
}

async function bollaCommandBody<T extends Record<string, unknown>>(
  bollaId: number,
  body: T,
  idempotencyKey = commandKey("bolla-command"),
) {
  return {
    ...body,
    idempotencyKey,
    versione: await bollaVersione(bollaId),
  };
}

function databaseDiagnostic(
  error: unknown,
  field: "code" | "constraint",
): string | null {
  let current = error;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    if (typeof current !== "object") return null;
    const value = (current as Record<string, unknown>)[field];
    if (typeof value === "string") return value;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

async function waitForBlockedBackends(
  blockerPid: number,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
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
    `Attese ${expected} transazioni bloccate sul lock di laboratorio`,
  );
}

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
  magA = await createMagazzino(scope, centroA);
  magB = await createMagazzino(scope, centroB);
  prod = await createProdotto(scope);
});

afterEach(async () => {
  await cleanup(scope);
});

afterAll(async () => {
  await cleanup(bootScope);
  await pool.end();
});

describe("Bolle — prenotazione merce su conferma", () => {
  it("M4B.1 PREP-TR-05: Bolla e Trasferimento contesi sull'ultima unità producono una sola prenotazione", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 1,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 1,
    });
    const trasferimentoId = await insertTrasferimento(scope, {
      origineId: magA,
      destinoId: magB,
    });
    await db.insert(trasferimentoRigheTable).values({
      trasferimentoId,
      prodottoId: prod,
      lottoId,
      quantita: "1",
      unitaMisura: "kg",
    });
    const router = express.Router();
    router.use(bolleRouter, trasferimentiRouter);
    const target = makeScopedApp(router, {
      id: operatoreId,
      centroAscoltoId: null,
    });
    const blocker = await pool.connect();
    let committed = false;
    let pendingBolla: Promise<request.Response> | undefined;
    let pendingTransfer: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM lotti WHERE id = $1 FOR UPDATE", [
        lottoId,
      ]);
      pendingBolla = request(target)
        .post(`/bolle/${bollaId}/conferma`)
        .send({
          idempotencyKey: commandKey("bolla-vs-transfer"),
          versione: await bollaVersione(bollaId),
        })
        .then((response) => response);
      await waitForBlockedBackends(pid.rows[0].pid, 1);
      pendingTransfer = request(target)
        .post(`/trasferimenti/${trasferimentoId}/prepara`)
        .send({ idempotencyKey: commandKey("transfer-vs-bolla"), versione: 1 })
        .then((response) => response);
      await waitForBlockedBackends(pid.rows[0].pid, 2);
      await blocker.query("COMMIT");
      committed = true;
      const responses = await Promise.all([pendingBolla, pendingTransfer]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      const active = await db
        .select()
        .from(prenotazioniMagazzinoTable)
        .where(
          and(
            eq(prenotazioniMagazzinoTable.lottoId, lottoId),
            eq(prenotazioniMagazzinoTable.stato, "attiva"),
          ),
        );
      expect(active).toHaveLength(1);
      expect(Number(active[0].quantita)).toBe(1);
      expect(await lottoResidua(lottoId)).toBe(1);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingBolla, pendingTransfer].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }
  });

  it("M4B.1 PREP-TR-05: Bolla e Trasferimento con prodotti inversi serializzano senza sovraprenotare", async () => {
    const secondProduct = await createProdotto(scope);
    const products = [prod, secondProduct].sort((a, b) => a - b);
    const lots = new Map<number, number>();
    for (const prodottoId of products) {
      lots.set(
        prodottoId,
        await createLotto(scope, {
          prodottoId,
          magazzinoId: magA,
          quantita: 1,
        }),
      );
    }
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    for (const prodottoId of products) {
      await insertBollaRiga(scope, {
        bollaId,
        prodottoId,
        lottoId: lots.get(prodottoId)!,
        quantita: 1,
      });
    }
    const trasferimentoId = await insertTrasferimento(scope, {
      origineId: magA,
      destinoId: magB,
    });
    for (const prodottoId of [...products].reverse()) {
      await db.insert(trasferimentoRigheTable).values({
        trasferimentoId,
        prodottoId,
        lottoId: lots.get(prodottoId)!,
        quantita: "1",
        unitaMisura: "kg",
      });
    }
    const router = express.Router();
    router.use(bolleRouter, trasferimentiRouter);
    const target = makeScopedApp(router, {
      id: operatoreId,
      centroAscoltoId: null,
    });
    const blocker = await pool.connect();
    let committed = false;
    let pendingBolla: Promise<request.Response> | undefined;
    let pendingTransfer: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM lotti WHERE id = $1 FOR UPDATE", [
        lots.get(products[0]),
      ]);
      pendingBolla = request(target)
        .post(`/bolle/${bollaId}/conferma`)
        .send({
          idempotencyKey: commandKey("bolla-inverse"),
          versione: await bollaVersione(bollaId),
        })
        .then((response) => response);
      await waitForBlockedBackends(pid.rows[0].pid, 1);
      pendingTransfer = request(target)
        .post(`/trasferimenti/${trasferimentoId}/prepara`)
        .send({ idempotencyKey: commandKey("transfer-inverse"), versione: 1 })
        .then((response) => response);
      await waitForBlockedBackends(pid.rows[0].pid, 2);
      await blocker.query("COMMIT");
      committed = true;
      const responses = await Promise.all([pendingBolla, pendingTransfer]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      for (const lotId of lots.values()) {
        const active = await db
          .select()
          .from(prenotazioniMagazzinoTable)
          .where(
            and(
              eq(prenotazioniMagazzinoTable.lottoId, lotId),
              eq(prenotazioniMagazzinoTable.stato, "attiva"),
            ),
          );
        expect(active).toHaveLength(1);
        expect(Number(active[0].quantita)).toBe(1);
        expect(await lottoResidua(lotId)).toBe(1);
      }
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingBolla, pendingTransfer].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }
  });

  it("M4B.1 PREP-TR-07: Avvia consuma la propria riserva senza sottrarre due volte quella della Bolla", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const trasferimentoId = await insertTrasferimento(scope, {
      origineId: magA,
      destinoId: magB,
    });
    await db.insert(trasferimentoRigheTable).values({
      trasferimentoId,
      prodottoId: prod,
      lottoId,
      quantita: "6",
      unitaMisura: "kg",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    const router = express.Router();
    router.use(bolleRouter, trasferimentiRouter);
    const target = makeScopedApp(router, {
      id: operatoreId,
      centroAscoltoId: null,
    });
    const ready = await request(target)
      .post(`/trasferimenti/${trasferimentoId}/prepara`)
      .send({ idempotencyKey: commandKey("own-reserve"), versione: 1 });
    expect(ready.status, ready.text).toBe(200);
    const confirmed = await request(target)
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        idempotencyKey: commandKey("other-reserve"),
        versione: await bollaVersione(bollaId),
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(await lottoResidua(lottoId)).toBe(10);
    const started = await request(target)
      .post(`/trasferimenti/${trasferimentoId}/avvia`)
      .send({
        idempotencyKey: commandKey("own-dispatch"),
        versione: ready.body.versione,
      });
    expect(started.status, started.text).toBe(200);
    expect(await lottoResidua(lottoId)).toBe(4);
    const active = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(
        and(
          eq(prenotazioniMagazzinoTable.lottoId, lottoId),
          eq(prenotazioniMagazzinoTable.stato, "attiva"),
        ),
      );
    expect(active).toHaveLength(1);
    expect(active[0].bollaId).toBe(bollaId);
    expect(Number(active[0].quantita)).toBe(4);
    const outgoing = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.trasferimentoId, trasferimentoId));
    expect(outgoing).toHaveLength(1);
    expect(Number(outgoing[0].quantita)).toBe(6);
  });

  it("mantiene la precedenza applicativa per id tra righe FEFO e lotto esplicito", async () => {
    const prodottoId = await createProdotto(scope);
    const lottoPrimaScadenza = await createLotto(scope, {
      prodottoId,
      magazzinoId: magA,
      quantita: 1,
      dataScadenza: "2027-01-01",
    });
    const lottoSecondaScadenza = await createLotto(scope, {
      prodottoId,
      magazzinoId: magA,
      quantita: 1,
      dataScadenza: "2027-02-01",
    });
    const automaticoPrima = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: automaticoPrima,
      prodottoId,
      quantita: 1,
    });
    await insertBollaRiga(scope, {
      bollaId: automaticoPrima,
      prodottoId,
      lottoId: lottoPrimaScadenza,
      quantita: 1,
    });

    const blocked = await request(appAs(centroA))
      .post(`/bolle/${automaticoPrima}/conferma`)
      .send(await bollaCommandBody(automaticoPrima, {}));
    expect(blocked.status, blocked.text).toBe(409);
    expect(await prenotazioniBolla(automaticoPrima)).toHaveLength(0);

    const esplicitoPrima = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: esplicitoPrima,
      prodottoId,
      lottoId: lottoPrimaScadenza,
      quantita: 1,
    });
    await insertBollaRiga(scope, {
      bollaId: esplicitoPrima,
      prodottoId,
      quantita: 1,
    });

    const confirmed = await request(appAs(centroA))
      .post(`/bolle/${esplicitoPrima}/conferma`)
      .send(await bollaCommandBody(esplicitoPrima, {}));
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(
      (await prenotazioniBolla(esplicitoPrima)).map(
        (prenotazione) => prenotazione.lottoId,
      ),
    ).toEqual([lottoPrimaScadenza, lottoSecondaScadenza]);
  });

  it("pre-locka prodotti e lotti in ordine globale anche con righe documento inverse", async () => {
    const prodottoA = await createProdotto(scope);
    const prodottoB = await createProdotto(scope);
    const lottoA = await createLotto(scope, {
      prodottoId: prodottoA,
      magazzinoId: magA,
      quantita: 10,
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prodottoB,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaAB = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const bollaBA = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: bollaAB,
      prodottoId: prodottoA,
      lottoId: lottoA,
      quantita: 1,
    });
    await insertBollaRiga(scope, {
      bollaId: bollaAB,
      prodottoId: prodottoB,
      lottoId: lottoB,
      quantita: 1,
    });
    await insertBollaRiga(scope, {
      bollaId: bollaBA,
      prodottoId: prodottoB,
      lottoId: lottoB,
      quantita: 1,
    });
    await insertBollaRiga(scope, {
      bollaId: bollaBA,
      prodottoId: prodottoA,
      lottoId: lottoA,
      quantita: 1,
    });

    const target = appAs(centroA);
    const bodyAB = await bollaCommandBody(bollaAB, {});
    const bodyBA = await bollaCommandBody(bollaBA, {});
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

      pendingAB = request(target)
        .post(`/bolle/${bollaAB}/conferma`)
        .send(bodyAB)
        .then((response) => response);
      await waitForBlockedBackends(blockerPid.rows[0].pid, 1);
      pendingBA = request(target)
        .post(`/bolle/${bollaBA}/conferma`)
        .send(bodyBA)
        .then((response) => response);
      await waitForBlockedBackends(blockerPid.rows[0].pid, 2);

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

    expect(await prenotazioniBolla(bollaAB)).toHaveLength(2);
    expect(await prenotazioniBolla(bollaBA)).toHaveLength(2);
  });

  it("rifiuta una riga frazionaria per un Prodotto non frazionabile", async () => {
    const pieceProduct = await createProdotto(scope, { unitaMisura: "pz" });
    const lottoId = await createLotto(scope, {
      prodottoId: pieceProduct,
      magazzinoId: magA,
      quantita: 10,
    });
    const created = await request(appAs(centroA))
      .post("/bolle")
      .send(
        createCommandBody({
          beneficiarioId: benA,
          magazzinoId: magA,
        }),
      );
    expect(created.status).toBe(201);
    scope.bollaIds.push(created.body.id);
    const response = await request(appAs(centroA))
      .post(`/bolle/${created.body.id}/righe`)
      .send(
        await bollaCommandBody(created.body.id, {
          prodottoId: pieceProduct,
          lottoId,
          quantita: "1.5",
        }),
      );
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/numero intero/i);
  });

  it("registra la catena audit A crea, B conferma e C consegna", async () => {
    const actorA = await createUtente(scope, { centroId: centroA });
    const actorB = await createUtente(scope, { centroId: centroA });
    const actorC = await createUtente(scope, { centroId: centroA });
    const appFor = (id: number, matricola: string) =>
      makeScopedApp(bolleRouter, {
        id,
        centroAscoltoId: centroA,
        matricola,
      });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });

    const created = await request(appFor(actorA, "AUD-A"))
      .post("/bolle")
      .send(
        createCommandBody({
          beneficiarioId: benA,
          magazzinoId: magA,
        }),
      );
    expect(created.status).toBe(201);
    scope.bollaIds.push(created.body.id);
    expect(
      (
        await request(appFor(actorA, "AUD-A"))
          .post(`/bolle/${created.body.id}/righe`)
          .send(
            await bollaCommandBody(created.body.id, {
              prodottoId: prod,
              lottoId,
              quantita: 4,
            }),
          )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(appFor(actorB, "AUD-B"))
          .post(`/bolle/${created.body.id}/conferma`)
          .send(await bollaCommandBody(created.body.id, {}))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(appFor(actorC, "AUD-C"))
          .post(`/bolle/${created.body.id}/consegna`)
          .send(
            await bollaCommandBody(created.body.id, {
              confermaRicezione: true,
            }),
          )
      ).status,
    ).toBe(200);

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "bolla"),
          eq(auditEventiTable.entitaId, created.body.id),
        ),
      )
      .orderBy(asc(auditEventiTable.id));
    expect(events.map((event) => event.azione)).toEqual([
      "BOLLA_CREATA",
      "BOLLA_RIGA_AGGIUNTA",
      "BOLLA_CONFERMATA",
      "BOLLA_CONSEGNATA",
    ]);
    expect(events.map((event) => event.actorUserId)).toEqual([
      actorA,
      actorA,
      actorB,
      actorC,
    ]);
    expect(events.map((event) => event.actorCodeSnapshot)).toEqual([
      "AUD-A",
      "AUD-A",
      "AUD-B",
      "AUD-C",
    ]);
    expect(new Set(events.map((event) => event.correlationId)).size).toBe(4);
    expect(
      events.every((event) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          event.correlationId,
        ),
      ),
    ).toBe(true);
    expect(events.map((event) => event.previousEventId)).toEqual([
      null,
      events[0].id,
      events[1].id,
      events[2].id,
    ]);
    expect(
      events.every(
        (event, index) =>
          index === 0 ||
          event.registratoAt.getTime() >=
            events[index - 1].registratoAt.getTime(),
      ),
    ).toBe(true);
    const [movement] = await movimentiBolla(created.body.id);
    expect(movement).toMatchObject({
      operatoreId: actorC,
      auditEventoId: events[3].id,
    });
    const [header] = await db
      .select({ operatoreId: bolleTable.operatoreId })
      .from(bolleTable)
      .where(eq(bolleTable.id, created.body.id));
    expect(header.operatoreId).toBe(actorC);
  });

  it("annulla prenotazioni e stato Bolla se l'audit di conferma fallisce", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    const invalidAuditApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      matricola: "X".repeat(161),
    });

    const response = await request(invalidAuditApp)
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(response.status).toBe(500);
    expect(await bollaStato(bollaId)).toBe("bozza");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.entitaTipo, "bolla"),
            eq(auditEventiTable.entitaId, bollaId),
          ),
        ),
    ).toHaveLength(0);
  });

  it("crea sempre in bozza, rifiuta campi server-managed e rende immutabile una Bolla consegnata", async () => {
    const rejected = await request(appAs(centroA))
      .post("/bolle")
      .send(
        createCommandBody({
          beneficiarioId: benA,
          magazzinoId: magA,
          stato: "consegnato",
        }),
      );
    expect(rejected.status).toBe(400);

    const created = await request(appAs(centroA))
      .post("/bolle")
      .send(createCommandBody({ beneficiarioId: benA, magazzinoId: magA }));
    expect(created.status).toBe(201);
    expect(created.body.stato).toBe("bozza");
    scope.bollaIds.push(created.body.id);

    const altroBeneficiario = await createBeneficiario(scope, centroA);
    const delivered = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "consegnato",
    });
    const patch = await request(appAs(centroA))
      .patch(`/bolle/${delivered}`)
      .send(
        await bollaCommandBody(delivered, {
          beneficiarioId: altroBeneficiario,
        }),
      );
    expect([400, 409]).toContain(patch.status);
    const [unchanged] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, delivered));
    expect(unchanged.beneficiarioId).toBe(benA);
    expect(await movimentiBolla(delivered)).toHaveLength(0);
  });

  it("conferma una bolla con disponibilita reale sufficiente creando prenotazioni senza scalare lotti o creare movimenti", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(prenotazioni).toHaveLength(1);
    expect(prenotazioni[0]).toMatchObject({
      lottoId,
      stato: "attiva",
      quantita: "4.00",
    });
  });

  it("fallisce se la disponibilita reale e insufficiente e lascia bolla, lotti e prenotazioni invariati", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaPrenotata = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "confermato",
    });
    const rigaPrenotata = await insertBollaRiga(scope, {
      bollaId: bollaPrenotata,
      prodottoId: prod,
      lottoId,
      quantita: 8,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magA,
      quantita: 8,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 3,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Disponibilità reale insufficiente");
    expect(await bollaStato(bollaId)).toBe("bozza");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("usa le prenotazioni della prima bolla per bloccare una seconda bolla oltre il disponibile reale", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const primaBolla = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: primaBolla,
      prodottoId: prod,
      lottoId,
      quantita: 8,
    });
    const secondaBolla = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: secondaBolla,
      prodottoId: prod,
      lottoId,
      quantita: 3,
    });

    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${primaBolla}/conferma`)
          .send(await bollaCommandBody(primaBolla, {}))
      ).status,
    ).toBe(200);
    const res = await request(appAs(centroA))
      .post(`/bolle/${secondaBolla}/conferma`)
      .send(await bollaCommandBody(secondaBolla, {}));

    expect(res.status).toBe(409);
    expect(await bollaStato(secondaBolla)).toBe("bozza");
    expect(await prenotazioniBolla(secondaBolla)).toHaveLength(0);
  });

  it("prenota FEFO splittando una riga su piu lotti senza scalare la giacenza fisica", async () => {
    const lottoA = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 40,
      dataScadenza: "2098-02-01",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 60,
      dataScadenza: "2098-06-01",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId: null,
      quantita: 70,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(200);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(
      prenotazioni.map((p) => ({
        lottoId: p.lottoId,
        quantita: p.quantita,
        stato: p.stato,
      })),
    ).toEqual([
      { lottoId: lottoA, quantita: "40.00", stato: "attiva" },
      { lottoId: lottoB, quantita: "30.00", stato: "attiva" },
    ]);
    expect(await lottoResidua(lottoA)).toBe(40);
    expect(await lottoResidua(lottoB)).toBe(60);
    const [riga] = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.id, rigaId));
    expect(riga.lottoId).toBe(lottoA);
    const dettaglio = await request(appAs(centroA)).get(`/bolle/${bollaId}`);
    expect(dettaglio.status, dettaglio.text).toBe(200);
    expect(dettaglio.body.righe[0].ripartizioniLotto).toEqual([
      expect.objectContaining({ lottoId: lottoA, quantita: 40 }),
      expect.objectContaining({ lottoId: lottoB, quantita: 30 }),
    ]);
  });

  it("blocca aggiunta e cancellazione righe su bolla confermata", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "confermato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 2,
    });

    const add = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/righe`)
      .send(
        await bollaCommandBody(bollaId, {
          prodottoId: prod,
          lottoId,
          quantita: 1,
        }),
      );
    const del = await request(appAs(centroA))
      .delete(`/bolle/${bollaId}/righe/${rigaId}`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(add.status).toBe(400);
    expect(del.status).toBe(400);
    expect(add.body.error).toContain("solo in stato bozza");
    expect(del.body.error).toContain("solo in stato bozza");
  });
});

describe("Bolle — consegna e annullo prenotazioni", () => {
  it("esclude i lotti scaduti dalla selezione FEFO automatica e accetta quelli che scadono oggi", async () => {
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 8,
      dataScadenza: "2000-01-01",
    });
    const valido = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 4,
      dataScadenza: dataOperativaEuropeRome(),
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId: null,
      quantita: 4,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(200);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.lottoId)).toEqual([
      valido,
    ]);
    expect(await lottoResidua(scaduto)).toBe(8);
  });

  it("rifiuta conferma con lotto esplicito scaduto e quando esiste solo stock scaduto", async () => {
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
      dataScadenza: "2000-01-01",
    });
    const esplicita = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: esplicita,
      prodottoId: prod,
      lottoId: scaduto,
      quantita: 1,
    });
    const automatica = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId: automatica,
      prodottoId: prod,
      lottoId: null,
      quantita: 1,
    });

    const explicitResult = await request(appAs(centroA))
      .post(`/bolle/${esplicita}/conferma`)
      .send(await bollaCommandBody(esplicita, {}));
    const automaticResult = await request(appAs(centroA))
      .post(`/bolle/${automatica}/conferma`)
      .send(await bollaCommandBody(automatica, {}));

    expect(explicitResult.status).toBe(409);
    expect(explicitResult.body.error).toMatch(/scaduto/i);
    expect(automaticResult.status).toBe(409);
    expect(await prenotazioniBolla(esplicita)).toHaveLength(0);
    expect(await prenotazioniBolla(automatica)).toHaveLength(0);
  });
});

describe("Bolle — inserimento righe con scope operativo", () => {
  it("valida Bolla e magazzino prima di leggere il lotto e non espone dati fuori scope", async () => {
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const [lotto] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, lottoB));
    const bollaFuoriScope = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaFuoriScope}/righe`)
      .send({
        prodottoId: prod,
        lottoId: lottoB,
        quantita: 1,
      });

    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain(
      lotto.codiceLotto ?? "codice-impossibile",
    );
  });

  it("rifiuta lotto inesistente, scaduto o non coerente con prodotto/magazzino e accetta un lotto valido", async () => {
    const altroProdotto = await createProdotto(scope);
    const valido = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const scaduto = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2000-01-01",
    });
    const altroMagazzino = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const path = `/bolle/${bollaId}/righe`;

    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send(
            await bollaCommandBody(bollaId, {
              prodottoId: prod,
              lottoId: 2_000_000_000,
              quantita: 1,
            }),
          )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send(
            await bollaCommandBody(bollaId, {
              prodottoId: prod,
              lottoId: scaduto,
              quantita: 1,
            }),
          )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send(
            await bollaCommandBody(bollaId, {
              prodottoId: altroProdotto,
              lottoId: valido,
              quantita: 1,
            }),
          )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(appAs(centroA))
          .post(path)
          .send(
            await bollaCommandBody(bollaId, {
              prodottoId: prod,
              lottoId: altroMagazzino,
              quantita: 1,
            }),
          )
      ).status,
    ).toBe(404);
    const accepted = await request(appAs(centroA))
      .post(path)
      .send(
        await bollaCommandBody(bollaId, {
          prodottoId: prod,
          lottoId: valido,
          quantita: 1,
        }),
      );
    expect(accepted.status).toBe(201);
    expect(accepted.body).toMatchObject({
      prodottoId: prod,
      lottoId: valido,
      quantita: 1,
    });
  });

  it("consente a un operatore Sociale con bolle.manage la propria Bolla senza permettere probe su altri magazzini", async () => {
    const socialApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      aree: ["sociale"],
      permessi: ["bolle.manage"],
    });
    const lottoA = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 5,
      dataScadenza: "2099-12-31",
    });
    const propria = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const altrui = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });

    expect(
      (
        await request(socialApp)
          .post(`/bolle/${propria}/righe`)
          .send(
            await bollaCommandBody(propria, {
              prodottoId: prod,
              lottoId: lottoA,
              quantita: 1,
            }),
          )
      ).status,
    ).toBe(201);
    expect(
      (
        await request(socialApp)
          .post(`/bolle/${altrui}/righe`)
          .send({ prodottoId: prod, lottoId: lottoB, quantita: 1 })
      ).status,
    ).toBe(403);
  });
});

describe("Bolle — consegna e annullo prenotazioni", () => {
  it("consegna una bolla confermata convertendo prenotazioni in scarico fisico", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, { confermaRicezione: true }));

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    const prenotazioni = await prenotazioniBolla(bollaId);
    expect(prenotazioni.map((p) => p.stato)).toEqual(["convertita_in_scarico"]);
    const movimenti = await movimentiBolla(bollaId);
    expect(movimenti).toHaveLength(1);
    expect(movimenti[0]).toMatchObject({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      lottoId,
      prodottoId: prod,
      bollaId,
      bollaRigaId: prenotazioni[0].rigaBollaId,
      quantita: "4.00",
    });
  });

  it("congela Area, Centro e numero componenti per Bolla e Consegna concluse", async () => {
    const historicalArea = await createAreaOperativa(scope);
    const currentArea = await createAreaOperativa(scope);
    const historicalCentre = await createCentroRec(scope, {
      areaOperativaId: historicalArea,
    });
    const currentCentre = await createCentroRec(scope, {
      areaOperativaId: currentArea,
    });
    const historicalWarehouse = await createMagazzino(
      scope,
      historicalCentre.id,
      { areaOperativaId: historicalArea },
    );
    const beneficiary = await createBeneficiario(scope, historicalCentre.id, {
      areaOperativaId: historicalArea,
    });
    await db
      .update(beneficiariTable)
      .set({ numComponenti: 3 })
      .where(eq(beneficiariTable.id, beneficiary));
    const delivery = await insertConsegna(scope, {
      beneficiarioId: beneficiary,
      magazzinoId: historicalWarehouse,
    });
    const product = await createProdotto(scope);
    const lot = await createLotto(scope, {
      prodottoId: product,
      magazzinoId: historicalWarehouse,
      quantita: 5,
    });
    const bolla = await insertBolla(scope, {
      beneficiarioId: beneficiary,
      magazzinoId: historicalWarehouse,
      consegnaId: delivery,
    });
    await insertBollaRiga(scope, {
      bollaId: bolla,
      prodottoId: product,
      lottoId: lot,
      quantita: 1,
    });
    expect(
      (
        await request(
          makeScopedApp(bolleRouter, {
            id: operatoreId,
            centroAscoltoId: historicalCentre.id,
          }),
        )
          .post(`/bolle/${bolla}/conferma`)
          .send(await bollaCommandBody(bolla, {}))
      ).status,
    ).toBe(200);
    const completionBody = await bollaCommandBody(bolla, {});
    expect(
      (
        await request(
          makeScopedApp(consegneRouter, {
            id: operatoreId,
            centroAscoltoId: historicalCentre.id,
          }),
        )
          .post(`/consegne/${delivery}/completa`)
          .send(completionBody)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          makeScopedApp(consegneRouter, {
            id: operatoreId,
            centroAscoltoId: historicalCentre.id,
          }),
        )
          .post(`/consegne/${delivery}/completa`)
          .send(completionBody)
      ).status,
    ).toBe(200);

    await db
      .update(beneficiariTable)
      .set({
        areaOperativaId: currentArea,
        centroAscoltoId: currentCentre.id,
        numComponenti: 4,
      })
      .where(eq(beneficiariTable.id, beneficiary));

    const [historicalBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bolla));
    const [historicalDelivery] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, delivery));
    expect(historicalBolla).toMatchObject({
      areaOperativaIdSnapshot: historicalArea,
      centroAscoltoIdSnapshot: historicalCentre.id,
      numeroComponentiNucleoSnapshot: 3,
    });
    expect(historicalDelivery).toMatchObject({
      areaOperativaIdSnapshot: historicalArea,
      centroAscoltoIdSnapshot: historicalCentre.id,
    });
    const operations = await db
      .select()
      .from(operazioniDistribuzioneMagazzinoTable)
      .where(
        and(
          eq(operazioniDistribuzioneMagazzinoTable.dominioOrigine, "BOLLA"),
          eq(operazioniDistribuzioneMagazzinoTable.entitaOrigineId, bolla),
        ),
      );
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      areaOperativaIdSnapshot: historicalArea,
      centroAscoltoIdSnapshot: historicalCentre.id,
      territorioClassificazione: "attribuito",
    });
    const [syncedIntervention] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bolla));
    expect(syncedIntervention).toMatchObject({
      areaOperativaIdSnapshot: historicalArea,
      centroAscoltoIdSnapshot: historicalCentre.id,
    });

    const historicalReport = await buildPacchiReport({
      da: "2026-06-01",
      a: "2026-06-01",
      anno: 2026,
      areaOperativaId: historicalArea,
      centroAscoltoId: historicalCentre.id,
      magazzinoId: historicalWarehouse,
      mensaId: null,
      zonaUdsId: null,
      operatoreId: null,
      tipoIntervento: null,
      tipoServizio: null,
      areaOperativaMode: "query",
      centroMode: "query",
      zonaMode: "all",
      callerAreas: ["sociale"],
      callerPermissions: [],
      callerIsAdmin: false,
    });
    expect(
      historicalReport.kpi.find((item) => item.key === "pacchiDistribuiti")
        ?.value,
    ).toBe(1);
    expect(
      historicalReport.kpi.find((item) => item.key === "personeRaggiunte")
        ?.value,
    ).toBe(3);
    const currentReport = await buildPacchiReport({
      ...historicalReport.filters,
      areaOperativaId: currentArea,
      centroAscoltoId: currentCentre.id,
    });
    expect(
      currentReport.kpi.find((item) => item.key === "pacchiDistribuiti")?.value,
    ).toBe(0);
  });

  it("blocca la consegna se il lotto prenotato non ha piu residuo sufficiente", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "2.00" })
      .where(eq(lottiTable.id, lottoId));

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, { confermaRicezione: true }));

    expect(res.status).toBe(409);
    expect(await bollaStato(bollaId)).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(2);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "attiva",
    ]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });

  it("blocca la consegna se il lotto è scaduto dopo la conferma", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
      dataScadenza: "2099-12-31",
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    await db
      .update(lottiTable)
      .set({ dataScadenza: "2000-01-01" })
      .where(eq(lottiTable.id, lottoId));

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/scaduto/i);
    expect(await bollaStato(bollaId)).toBe("confermato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "attiva",
    ]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });

  it("annulla una bolla confermata nuova rilasciando prenotazioni senza scalare lotti o creare movimenti", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/annulla`)
      .send(
        await bollaCommandBody(bollaId, {
          motivo: "Documento non più necessario",
        }),
      );

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("annullato");
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "rilasciata",
    ]);
    expect(await movimentiBolla(bollaId)).toHaveLength(0);
  });

  it("non usa il normale annullamento per reintegrare una Bolla già consegnata", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/consegna`)
          .send(
            await bollaCommandBody(bollaId, {
              confermaRicezione: true,
            }),
          )
      ).status,
    ).toBe(200);
    expect(await lottoResidua(lottoId)).toBe(6);
    const [interventoConsegnato] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoConsegnato).toMatchObject({
      bollaId,
      beneficiarioId: benA,
      stato: "concluso",
    });

    const cancelled = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/annulla`)
      .send(
        await bollaCommandBody(bollaId, {
          motivo: "Consegna annullata dal test",
        }),
      );
    expect(cancelled.status).toBe(409);
    expect(await lottoResidua(lottoId)).toBe(6);
    const movements = await movimentiBolla(bollaId);
    expect(movements).toHaveLength(1);
    expect(movements[0].tipoMovimento).toBe("scarico");
    const [cancellationEvent] = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, "BOLLA_ANNULLATA"),
          eq(auditEventiTable.entitaTipo, "bolla"),
          eq(auditEventiTable.entitaId, bollaId),
        ),
      );
    expect(cancellationEvent).toBeUndefined();
    const [interventoInvariato] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoInvariato).toMatchObject({
      id: interventoConsegnato.id,
      bollaId,
      beneficiarioId: benA,
      stato: "concluso",
    });
    const storico = await db
      .select()
      .from(interventiStoricoStatiTable)
      .where(
        eq(interventiStoricoStatiTable.interventoId, interventoConsegnato.id),
      );
    expect(storico).toHaveLength(0);
  });

  it("rollbacka storno e stato Intervento se l'audit dell'annullamento fallisce", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/consegna`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    const [interventoPrima] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));

    await expect(
      db.transaction(async (tx) => {
        await stornoRigaTx(tx, { id: rigaId }, bollaId, operatoreId);
        await annullaInterventoDaBollaTx(
          tx,
          bollaId,
          2_000_000_000,
          "Errore simulato",
        );
      }),
    ).rejects.toBeDefined();

    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    const [interventoDopo] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.bollaId, bollaId));
    expect(interventoDopo).toMatchObject({
      id: interventoPrima.id,
      stato: "concluso",
    });
    expect(
      await db
        .select()
        .from(interventiStoricoStatiTable)
        .where(
          eq(interventiStoricoStatiTable.interventoId, interventoPrima.id),
        ),
    ).toHaveLength(0);
  });

  it("tratta una bolla legacy confermata con movimenti scarico come gia scaricata e non scala di nuovo alla consegna", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "confermato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "6.00" })
      .where(eq(lottiTable.id, lottoId));
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: "2026-06-01",
      magazzinoId: magA,
      prodottoId: prod,
      lottoId,
      quantita: "4.00",
      unitaMisura: "kg",
      beneficiarioId: benA,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: "legacy",
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, { confermaRicezione: true }));

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });
});

describe("M4A — idempotenza e concorrenza comandi Bolla", () => {
  async function nuovaBollaConRiga() {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    return { bollaId, lottoId, rigaId };
  }

  it("gestisce replay, mismatch, stale version e richieste concorrenti su conferma e consegna", async () => {
    const target = appAs(centroA);
    const prima = await nuovaBollaConRiga();
    const versioneBozza = await bollaVersione(prima.bollaId);
    const confermaKey = commandKey("conferma-replay");
    const confermaBody = {
      idempotencyKey: confermaKey,
      versione: versioneBozza,
    };

    const confermata = await request(target)
      .post(`/bolle/${prima.bollaId}/conferma`)
      .send(confermaBody);
    const confermaReplay = await request(target)
      .post(`/bolle/${prima.bollaId}/conferma`)
      .send(confermaBody);
    expect(confermata.status, confermata.text).toBe(200);
    expect(confermaReplay.status, confermaReplay.text).toBe(200);
    expect(confermaReplay.body).toMatchObject({
      id: prima.bollaId,
      stato: "confermato",
      versione: versioneBozza + 1,
    });
    expect(await prenotazioniBolla(prima.bollaId)).toHaveLength(1);
    expect(await bollaVersione(prima.bollaId)).toBe(versioneBozza + 1);

    const confermaMismatch = await request(target)
      .post(`/bolle/${prima.bollaId}/conferma`)
      .send({
        idempotencyKey: confermaKey,
        versione: versioneBozza + 1,
      });
    expect(confermaMismatch.status).toBe(409);
    expect(confermaMismatch.body.error).toMatch(/chiave di idempotenza/i);
    const confermaStale = await request(target)
      .post(`/bolle/${prima.bollaId}/conferma`)
      .send({
        idempotencyKey: commandKey("conferma-stale"),
        versione: versioneBozza,
      });
    expect(confermaStale.status).toBe(409);
    expect(confermaStale.body.error).toMatch(/versione non aggiornata/i);

    const versioneConfermata = await bollaVersione(prima.bollaId);
    const consegnaKey = commandKey("consegna-replay");
    const consegnaBody = {
      idempotencyKey: consegnaKey,
      versione: versioneConfermata,
      confermaRicezione: true,
    };
    const consegnata = await request(target)
      .post(`/bolle/${prima.bollaId}/consegna`)
      .send(consegnaBody);
    const consegnaReplay = await request(target)
      .post(`/bolle/${prima.bollaId}/consegna`)
      .send(consegnaBody);
    expect(consegnata.status, consegnata.text).toBe(200);
    expect(consegnaReplay.status, consegnaReplay.text).toBe(200);
    expect(consegnaReplay.body).toMatchObject({
      id: prima.bollaId,
      stato: "consegnato",
      versione: versioneConfermata + 1,
    });
    expect(await movimentiBolla(prima.bollaId)).toHaveLength(1);
    expect(await lottoResidua(prima.lottoId)).toBe(6);

    const consegnaMismatch = await request(target)
      .post(`/bolle/${prima.bollaId}/consegna`)
      .send({
        ...consegnaBody,
        versione: versioneConfermata + 1,
      });
    expect(consegnaMismatch.status).toBe(409);
    expect(consegnaMismatch.body.error).toMatch(/chiave di idempotenza/i);
    const consegnaStale = await request(target)
      .post(`/bolle/${prima.bollaId}/consegna`)
      .send({
        ...consegnaBody,
        idempotencyKey: commandKey("consegna-stale"),
      });
    expect(consegnaStale.status).toBe(409);
    expect(consegnaStale.body.error).toMatch(/versione non aggiornata/i);

    const concorrente = await nuovaBollaConRiga();
    const versioneConcorrente = await bollaVersione(concorrente.bollaId);
    const confermaConcorrenteBody = {
      idempotencyKey: commandKey("conferma-concorrente"),
      versione: versioneConcorrente,
    };
    const confermeConcorrenti = await Promise.all([
      request(target)
        .post(`/bolle/${concorrente.bollaId}/conferma`)
        .send(confermaConcorrenteBody),
      request(target)
        .post(`/bolle/${concorrente.bollaId}/conferma`)
        .send(confermaConcorrenteBody),
    ]);
    expect(confermeConcorrenti.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(await prenotazioniBolla(concorrente.bollaId)).toHaveLength(1);
    expect(await bollaVersione(concorrente.bollaId)).toBe(
      versioneConcorrente + 1,
    );

    const consegnaConcorrenteVersione = await bollaVersione(
      concorrente.bollaId,
    );
    const consegnaConcorrenteBody = {
      idempotencyKey: commandKey("consegna-concorrente"),
      versione: consegnaConcorrenteVersione,
      confermaRicezione: true,
    };
    const consegneConcorrenti = await Promise.all([
      request(target)
        .post(`/bolle/${concorrente.bollaId}/consegna`)
        .send(consegnaConcorrenteBody),
      request(target)
        .post(`/bolle/${concorrente.bollaId}/consegna`)
        .send(consegnaConcorrenteBody),
    ]);
    expect(consegneConcorrenti.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(await movimentiBolla(concorrente.bollaId)).toHaveLength(1);
    expect(await lottoResidua(concorrente.lottoId)).toBe(6);
    expect(await bollaVersione(concorrente.bollaId)).toBe(
      consegnaConcorrenteVersione + 1,
    );

    const events = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, "bolla"),
          inArray(auditEventiTable.entitaId, [
            prima.bollaId,
            concorrente.bollaId,
          ]),
        ),
      );
    expect(
      events.filter((event) => event.azione === "BOLLA_CONFERMATA"),
    ).toHaveLength(2);
    expect(
      events.filter((event) => event.azione === "BOLLA_CONSEGNATA"),
    ).toHaveLength(2);
  });

  it("consegna e storna documenti con ordini inversi senza cicli di lock", async () => {
    const beneficiarioBA = await createBeneficiario(scope, centroA);
    const prodottoA = await createProdotto(scope);
    const prodottoB = await createProdotto(scope);
    const lottoA = await createLotto(scope, {
      prodottoId: prodottoA,
      magazzinoId: magA,
      quantita: 10,
    });
    const lottoB = await createLotto(scope, {
      prodottoId: prodottoB,
      magazzinoId: magA,
      quantita: 10,
    });
    const consegnaAB = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const consegnaBA = await insertConsegna(scope, {
      beneficiarioId: beneficiarioBA,
      magazzinoId: magA,
    });
    const bollaAB = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId: consegnaAB,
      stato: "confermato",
    });
    const bollaBA = await insertBolla(scope, {
      beneficiarioId: beneficiarioBA,
      magazzinoId: magA,
      consegnaId: consegnaBA,
      stato: "confermato",
    });
    const rigaABA = await insertBollaRiga(scope, {
      bollaId: bollaAB,
      prodottoId: prodottoA,
      lottoId: lottoA,
      quantita: 1,
    });
    const rigaABB = await insertBollaRiga(scope, {
      bollaId: bollaAB,
      prodottoId: prodottoB,
      lottoId: lottoB,
      quantita: 1,
    });
    const rigaBAB = await insertBollaRiga(scope, {
      bollaId: bollaBA,
      prodottoId: prodottoB,
      lottoId: lottoB,
      quantita: 1,
    });
    const rigaBAA = await insertBollaRiga(scope, {
      bollaId: bollaBA,
      prodottoId: prodottoA,
      lottoId: lottoA,
      quantita: 1,
    });
    for (const prenotazione of [
      {
        bollaId: bollaAB,
        rigaBollaId: rigaABA,
        prodottoId: prodottoA,
        lottoId: lottoA,
      },
      {
        bollaId: bollaAB,
        rigaBollaId: rigaABB,
        prodottoId: prodottoB,
        lottoId: lottoB,
      },
      {
        bollaId: bollaBA,
        rigaBollaId: rigaBAB,
        prodottoId: prodottoB,
        lottoId: lottoB,
      },
      {
        bollaId: bollaBA,
        rigaBollaId: rigaBAA,
        prodottoId: prodottoA,
        lottoId: lottoA,
      },
    ]) {
      await insertPrenotazioneMagazzino(scope, {
        ...prenotazione,
        magazzinoId: magA,
        quantita: 1,
      });
    }

    const target = appAs(centroA);
    const runBehindLotLock = async (
      requestAB: () => Promise<request.Response>,
      requestBA: () => Promise<request.Response>,
    ) => {
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
        pendingAB = requestAB();
        await waitForBlockedBackends(blockerPid.rows[0].pid, 1);
        pendingBA = requestBA();
        await waitForBlockedBackends(blockerPid.rows[0].pid, 2);
        await blocker.query("COMMIT");
        committed = true;
        return await Promise.all([pendingAB, pendingBA]);
      } finally {
        if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
        blocker.release();
        await Promise.allSettled(
          [pendingAB, pendingBA].filter(
            (pending): pending is Promise<request.Response> => pending != null,
          ),
        );
      }
    };

    const deliveryAB = await bollaCommandBody(bollaAB, {
      confermaRicezione: true,
    });
    const deliveryBA = await bollaCommandBody(bollaBA, {
      confermaRicezione: true,
    });
    const delivered = await runBehindLotLock(
      () =>
        request(target)
          .post(`/bolle/${bollaAB}/consegna`)
          .send(deliveryAB)
          .then((response) => response),
      () =>
        request(target)
          .post(`/bolle/${bollaBA}/consegna`)
          .send(deliveryBA)
          .then((response) => response),
    );
    expect(
      delivered.map((response) => response.status),
      delivered.map((response) => response.text).join("\n"),
    ).toEqual([200, 200]);

    const adminApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      permessi: ["bolle.reverse.admin"],
    });
    const reverseAB = {
      idempotencyKey: commandKey("lock-order-storno-ab"),
      versione: await bollaVersione(bollaAB),
      motivo: "Verifica ordine globale AB",
      rigaIds: [rigaABA, rigaABB],
    };
    const reverseBA = {
      idempotencyKey: commandKey("lock-order-storno-ba"),
      versione: await bollaVersione(bollaBA),
      motivo: "Verifica ordine globale BA",
      rigaIds: [rigaBAB, rigaBAA],
    };
    const reversed = await runBehindLotLock(
      () =>
        request(adminApp)
          .post(`/bolle/${bollaAB}/storno-amministrativo`)
          .send(reverseAB)
          .then((response) => response),
      () =>
        request(adminApp)
          .post(`/bolle/${bollaBA}/storno-amministrativo`)
          .send(reverseBA)
          .then((response) => response),
    );
    expect(
      reversed.map((response) => response.status),
      reversed.map((response) => response.text).join("\n"),
    ).toEqual([200, 200]);
    expect(await lottoResidua(lottoA)).toBe(10);
    expect(await lottoResidua(lottoB)).toBe(10);
  });
});

describe("M4A — invarianti Bolla, replay semantico e scope corrente", () => {
  it("serializza due creazioni concorrenti sulla stessa Consegna e il vincolo DB impedisce una seconda Bolla attiva", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const target = appAs(centroA);
    const body = {
      beneficiarioId: benA,
      consegnaId,
      magazzinoId: magA,
    };

    // Mantiene la riga Consegna bloccata finché entrambe le richieste hanno
    // superato i controlli preliminari: il test esercita così davvero la
    // serializzazione transazionale, non due chiamate accidentalmente seriali.
    const responses = await (async () => {
      const blocker = await pool.connect();
      let committed = false;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM consegne WHERE id = $1 FOR UPDATE",
          [consegnaId],
        );
        const blockerPid = Number(
          (
            await blocker.query<{ pid: number }>(
              "SELECT pg_backend_pid() AS pid",
            )
          ).rows[0]?.pid,
        );
        const pending = Promise.all([
          request(target)
            .post("/bolle")
            .send(
              createCommandBody(body, commandKey("consegna-concorrente-a")),
            ),
          request(target)
            .post("/bolle")
            .send(
              createCommandBody(body, commandKey("consegna-concorrente-b")),
            ),
        ]);
        await waitForBlockedBackends(blockerPid, 2);
        await blocker.query("COMMIT");
        committed = true;
        return await pending;
      } finally {
        if (!committed) await blocker.query("ROLLBACK");
        blocker.release();
      }
    })();

    const linked = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.consegnaId, consegnaId));
    scope.bollaIds.push(...linked.map((bolla) => bolla.id));

    expect(
      responses.map((response) => response.status).sort((a, b) => a - b),
    ).toEqual([201, 409]);
    expect(linked.filter((bolla) => bolla.stato !== "annullato")).toHaveLength(
      1,
    );

    let uniqueViolation: unknown;
    try {
      await db.insert(bolleTable).values({
        numeroBolla: `DB-${randomUUID().slice(0, 12)}`,
        dataBolla: "2026-09-19",
        tipoDestinatario: "beneficiario",
        beneficiarioId: benA,
        consegnaId,
        magazzinoId: magA,
        stato: "bozza",
      });
    } catch (error) {
      uniqueViolation = error;
    }
    expect(databaseDiagnostic(uniqueViolation, "code")).toBe("23505");
    expect(databaseDiagnostic(uniqueViolation, "constraint")).toBe(
      "bolle_consegna_attiva_unique",
    );
  });

  it("serializza associazione e creazione collegate tramite la guardia PostgreSQL della Consegna", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const blocker = await pool.connect();
    let committed = false;
    let pendingAssociazione: Promise<request.Response> | undefined;
    let pendingCreazione: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM consegne WHERE id = $1 FOR UPDATE", [
        consegnaId,
      ]);
      const blockerPid = Number(
        (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      pendingAssociazione = request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/associa-bolla`)
        .send({
          bollaId,
          versione: 1,
          idempotencyKey: commandKey("barriera-associa-prima"),
        })
        .then((response) => response);
      await waitForBlockedBackends(blockerPid, 1);
      pendingCreazione = request(appAs(centroA))
        .post("/bolle")
        .send(
          createCommandBody(
            { beneficiarioId: benA, consegnaId, magazzinoId: magA },
            commandKey("barriera-crea-dopo"),
          ),
        )
        .then((response) => response);
      await waitForBlockedBackends(blockerPid, 2);
      await blocker.query("COMMIT");
      committed = true;

      const [associazione, creazione] = await Promise.all([
        pendingAssociazione,
        pendingCreazione,
      ]);
      expect(associazione.status, associazione.text).toBe(200);
      expect(creazione.status, creazione.text).toBe(409);
      expect(creazione.body.error).toMatch(/già una Bolla operativa/i);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingAssociazione, pendingCreazione].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }

    const linked = await db
      .select({ id: bolleTable.id })
      .from(bolleTable)
      .where(
        and(
          eq(bolleTable.consegnaId, consegnaId),
          eq(bolleTable.stato, "bozza"),
        ),
      );
    expect(linked).toEqual([{ id: bollaId }]);
  });

  it("impedisce di cambiare il Beneficiario di una bozza collegata a una Consegna", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
    });
    const versione = await bollaVersione(bollaId);

    const response = await request(appAs(null))
      .patch(`/bolle/${bollaId}`)
      .send({
        idempotencyKey: commandKey("beneficiario-consegna"),
        versione,
        beneficiarioId: benB,
      });

    expect(response.status, response.text).toBe(409);
    expect(response.body.error).toMatch(/Beneficiario.*Consegna/i);
    const [unchanged] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    expect(unchanged).toMatchObject({
      beneficiarioId: benA,
      consegnaId,
      versione,
    });
  });

  it("impedisce a una Bolla Ente di cambiare Magazzino verso un'altra Area", async () => {
    const areaA = await createAreaOperativa(scope);
    const areaB = await createAreaOperativa(scope);
    const centroAreaA = await createCentroRec(scope, {
      areaOperativaId: areaA,
    });
    const centroAreaB = await createCentroRec(scope, {
      areaOperativaId: areaB,
    });
    const magazzinoAreaA = await createMagazzino(scope, centroAreaA.id, {
      areaOperativaId: areaA,
    });
    const magazzinoAreaB = await createMagazzino(scope, centroAreaB.id, {
      areaOperativaId: areaB,
    });
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente vincolo Area",
        indirizzo: "Via Area 1",
        areaOperativaId: areaA,
      })
      .returning();
    scope.enteDestinatarioIds.push(ente.id);
    const [bolla] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `ENTE-${randomUUID().slice(0, 12)}`,
        dataBolla: "2026-09-19",
        tipoDestinatario: "ente",
        enteDestinatarioId: ente.id,
        magazzinoId: magazzinoAreaA,
        areaOperativaIdSnapshot: areaA,
        stato: "bozza",
      })
      .returning();
    scope.bollaIds.push(bolla.id);

    const response = await request(appAs(null))
      .patch(`/bolle/${bolla.id}`)
      .send({
        idempotencyKey: commandKey("ente-cambio-area"),
        versione: bolla.versione,
        magazzinoId: magazzinoAreaB,
      });

    expect(response.status, response.text).toBe(409);
    expect(response.body.error).toMatch(/Ente.*Magazzino/i);
    const [unchanged] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bolla.id));
    expect(unchanged).toMatchObject({
      magazzinoId: magazzinoAreaA,
      areaOperativaIdSnapshot: areaA,
      versione: bolla.versione,
    });
  });

  it("normalizza quantità e UDM nel replay di aggiunta riga senza duplicare l'effetto", async () => {
    const prodottoId = await createProdotto(scope, { unitaMisura: "pz" });
    const lottoId = await createLotto(scope, {
      prodottoId,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const versione = await bollaVersione(bollaId);
    const idempotencyKey = commandKey("riga-semantica");

    const created = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/righe`)
      .send({
        idempotencyKey,
        versione,
        prodottoId,
        lottoId,
        quantita: 2,
        unitaMisura: "pz",
      });
    const replay = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/righe`)
      .send({
        idempotencyKey,
        versione,
        prodottoId,
        lottoId,
        quantita: "2.0",
      });

    expect(created.status, created.text).toBe(201);
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body).toEqual(created.body);
    const righe = await db
      .select()
      .from(bollaRigheTable)
      .where(eq(bollaRigheTable.bollaId, bollaId));
    expect(righe).toHaveLength(1);
    expect(Number(righe[0].quantita)).toBe(2);
    expect(righe[0].unitaMisura).toBe("pz");
    expect(await bollaVersione(bollaId)).toBe(versione + 1);

    const mismatch = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/righe`)
      .send({
        idempotencyKey,
        versione,
        prodottoId,
        lottoId,
        quantita: "3.0",
      });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/chiave di idempotenza/i);
    expect(
      await db
        .select()
        .from(bollaRigheTable)
        .where(eq(bollaRigheTable.bollaId, bollaId)),
    ).toHaveLength(1);
  });

  it("nega il replay di creazione quando l'aggregato reale non è più nello scope corrente", async () => {
    const idempotencyKey = commandKey("creazione-scope-replay");
    const body = {
      beneficiarioId: benA,
      magazzinoId: magA,
    };
    const target = appAs(centroA);
    const created = await request(target)
      .post("/bolle")
      .send(createCommandBody(body, idempotencyKey));
    expect(created.status, created.text).toBe(201);
    scope.bollaIds.push(created.body.id);

    await db
      .update(bolleTable)
      .set({ beneficiarioId: benB, magazzinoId: magB })
      .where(eq(bolleTable.id, created.body.id));

    const replay = await request(target)
      .post("/bolle")
      .send(createCommandBody(body, idempotencyKey));
    expect(replay.status, replay.text).toBe(403);
    expect(replay.body.error).toMatch(/non accessibile/i);

    const [actual] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, created.body.id));
    expect(actual).toMatchObject({
      beneficiarioId: benB,
      magazzinoId: magB,
    });
    const createEvents = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, "BOLLA_CREATA"),
          eq(auditEventiTable.operationKey, `m4a:BOLLA_CREA:${idempotencyKey}`),
        ),
      );
    expect(createEvents).toHaveLength(1);
  });
});

describe("M4A — snapshot Ente e fallback legacy", () => {
  it("conserva lo snapshot A con contatti null dopo modifica/disattivazione e marca il fallback legacy", async () => {
    const areaId = await createAreaOperativa(scope);
    const centro = await createCentroRec(scope, { areaOperativaId: areaId });
    const magazzinoId = await createMagazzino(scope, centro.id, {
      areaOperativaId: areaId,
    });
    const productId = await createProdotto(scope);
    const lottoId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId,
      quantita: 10,
    });
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente Snapshot A",
        indirizzo: "Via Snapshot A 1",
        telefono: null,
        email: null,
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(ente.id);
    const target = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: null,
      areaOperativaId: areaId,
    });

    const created = await request(target)
      .post("/bolle")
      .send(
        createCommandBody({
          tipoDestinatario: "ente",
          enteDestinatarioId: ente.id,
          magazzinoId,
        }),
      );
    expect(created.status, created.text).toBe(201);
    scope.bollaIds.push(created.body.id);
    const rowAdded = await request(target)
      .post(`/bolle/${created.body.id}/righe`)
      .send(
        await bollaCommandBody(created.body.id, {
          prodottoId: productId,
          lottoId,
          quantita: 2,
        }),
      );
    expect(rowAdded.status, rowAdded.text).toBe(201);
    const confirmed = await request(target)
      .post(`/bolle/${created.body.id}/conferma`)
      .send(await bollaCommandBody(created.body.id, {}));
    expect(confirmed.status, confirmed.text).toBe(200);
    expect(confirmed.body).toMatchObject({
      destinatarioSnapshotCongelato: true,
      destinatarioSnapshotFonte: "confermato",
      enteDestinatarioNome: "Ente Snapshot A",
      enteDestinatarioIndirizzo: "Via Snapshot A 1",
      enteDestinatarioTelefono: null,
      enteDestinatarioEmail: null,
    });

    await db
      .update(entiDestinatariTable)
      .set({
        denominazione: "Ente Snapshot B",
        indirizzo: "Via Snapshot B 2",
        telefono: "0600000000",
        email: "snapshot-b@example.test",
        attivo: false,
      })
      .where(eq(entiDestinatariTable.id, ente.id));

    const historical = await request(target).get(`/bolle/${created.body.id}`);
    expect(historical.status, historical.text).toBe(200);
    expect(historical.body).toMatchObject({
      destinatarioSnapshotCongelato: true,
      destinatarioSnapshotFonte: "confermato",
      enteDestinatarioNome: "Ente Snapshot A",
      enteDestinatarioIndirizzo: "Via Snapshot A 1",
      enteDestinatarioTelefono: null,
      enteDestinatarioEmail: null,
    });
    const delivered = await request(target)
      .post(`/bolle/${created.body.id}/consegna`)
      .send(
        await bollaCommandBody(created.body.id, {
          confermaRicezione: true,
        }),
      );
    expect(delivered.status, delivered.text).toBe(200);
    expect(delivered.body).toMatchObject({
      enteDestinatarioNome: "Ente Snapshot A",
      enteDestinatarioTelefono: null,
      enteDestinatarioEmail: null,
    });

    const inactiveCreate = await request(target)
      .post("/bolle")
      .send(
        createCommandBody({
          tipoDestinatario: "ente",
          enteDestinatarioId: ente.id,
          magazzinoId,
        }),
      );
    expect(inactiveCreate.status).toBe(400);

    const [legacy] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `LEG-${randomUUID().slice(0, 12)}`,
        dataBolla: "2026-09-19",
        tipoDestinatario: "ente",
        beneficiarioId: null,
        enteDestinatarioId: ente.id,
        magazzinoId,
        areaOperativaIdSnapshot: areaId,
        destinatarioSnapshotCongelato: false,
        stato: "confermato",
      })
      .returning({ id: bolleTable.id });
    scope.bollaIds.push(legacy.id);
    const legacyDetail = await request(target).get(`/bolle/${legacy.id}`);
    expect(legacyDetail.status, legacyDetail.text).toBe(200);
    expect(legacyDetail.body).toMatchObject({
      destinatarioSnapshotCongelato: false,
      destinatarioSnapshotFonte: "legacy_live",
      enteDestinatarioNome: "Ente Snapshot B",
      enteDestinatarioIndirizzo: "Via Snapshot B 2",
      enteDestinatarioTelefono: "0600000000",
      enteDestinatarioEmail: "snapshot-b@example.test",
    });
  });
});

describe("M4A — storno amministrativo Bolla", () => {
  async function consegnaDaStornare() {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    const target = appAs(centroA);
    const confirmed = await request(target)
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));
    expect(confirmed.status, confirmed.text).toBe(200);
    const delivered = await request(target)
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, { confermaRicezione: true }));
    expect(delivered.status, delivered.text).toBe(200);
    return { bollaId, rigaId, lottoId };
  }

  it("richiede permesso, motivo e righe; reintegra una volta ed è idempotente anche in concorrenza", async () => {
    const prima = await consegnaDaStornare();
    const versioneConsegnata = await bollaVersione(prima.bollaId);
    const normalCancel = await request(appAs(centroA))
      .post(`/bolle/${prima.bollaId}/annulla`)
      .send({
        idempotencyKey: commandKey("annulla-post-uscita"),
        versione: versioneConsegnata,
        motivo: "Non deve reintegrare dal comando ordinario",
      });
    expect(normalCancel.status).toBe(409);
    expect(await lottoResidua(prima.lottoId)).toBe(6);

    const stornoPath = `/bolle/${prima.bollaId}/storno-amministrativo`;
    const denied = await request(appAs(centroA))
      .post(stornoPath)
      .send({
        idempotencyKey: commandKey("storno-denied"),
        versione: versioneConsegnata,
        motivo: "Rettifica autorizzata",
        rigaIds: [prima.rigaId],
      });
    expect(denied.status).toBe(403);

    const adminApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      permessi: ["bolle.reverse.admin"],
    });
    const missingReason = await request(adminApp)
      .post(stornoPath)
      .send({
        idempotencyKey: commandKey("storno-no-reason"),
        versione: versioneConsegnata,
        rigaIds: [prima.rigaId],
      });
    expect(missingReason.status).toBe(400);
    const missingRows = await request(adminApp)
      .post(stornoPath)
      .send({
        idempotencyKey: commandKey("storno-no-rows"),
        versione: versioneConsegnata,
        motivo: "Rettifica senza righe",
      });
    expect(missingRows.status).toBe(400);

    const stornoKey = commandKey("storno-replay");
    const stornoBody = {
      idempotencyKey: stornoKey,
      versione: versioneConsegnata,
      motivo: "Rettifica amministrativa documentata",
      rigaIds: [prima.rigaId],
    };
    const reversed = await request(adminApp).post(stornoPath).send(stornoBody);
    const replay = await request(adminApp).post(stornoPath).send(stornoBody);
    expect(reversed.status, reversed.text).toBe(200);
    expect(replay.status, replay.text).toBe(200);
    expect(await lottoResidua(prima.lottoId)).toBe(10);
    expect(await bollaVersione(prima.bollaId)).toBe(versioneConsegnata + 1);

    const movements = await movimentiBolla(prima.bollaId);
    expect(movements).toHaveLength(2);
    const scarico = movements.find(
      (movement) => movement.tipoMovimento === "scarico",
    );
    const storno = movements.find(
      (movement) => movement.tipoMovimento === "storno",
    );
    expect(scarico).toBeDefined();
    expect(storno).toMatchObject({
      tipoDettaglio: "storno_bolla",
      movimentoOrigineId: scarico!.id,
      bollaId: prima.bollaId,
      bollaRigaId: prima.rigaId,
      lottoId: prima.lottoId,
      quantita: "4.00",
      naturaContabile: "STORNO",
    });
    const [audit] = await db
      .select()
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, "BOLLA_STORNO_AMMINISTRATIVO"),
          eq(auditEventiTable.entitaId, prima.bollaId),
        ),
      );
    expect(audit).toMatchObject({
      motivo: "Rettifica amministrativa documentata",
      metadata: { rigaIds: [prima.rigaId] },
    });
    expect(storno!.auditEventoId).toBe(audit.id);

    const mismatch = await request(adminApp)
      .post(stornoPath)
      .send({
        ...stornoBody,
        motivo: "Tentativo diverso con la stessa chiave",
      });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/chiave di idempotenza/i);
    const stale = await request(adminApp)
      .post(stornoPath)
      .send({
        ...stornoBody,
        idempotencyKey: commandKey("storno-stale"),
      });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/versione non aggiornata/i);
    expect(await lottoResidua(prima.lottoId)).toBe(10);

    const stillBlocked = await request(appAs(centroA))
      .post(`/bolle/${prima.bollaId}/annulla`)
      .send(
        await bollaCommandBody(prima.bollaId, {
          motivo: "Annulla resta separato dallo storno",
        }),
      );
    expect(stillBlocked.status).toBe(409);

    const concorrente = await consegnaDaStornare();
    const concorrenteVersione = await bollaVersione(concorrente.bollaId);
    const concorrenteBody = {
      idempotencyKey: commandKey("storno-concorrente"),
      versione: concorrenteVersione,
      motivo: "Rettifica amministrativa concorrente",
      rigaIds: [concorrente.rigaId],
    };
    const concurrentResponses = await Promise.all([
      request(adminApp)
        .post(`/bolle/${concorrente.bollaId}/storno-amministrativo`)
        .send(concorrenteBody),
      request(adminApp)
        .post(`/bolle/${concorrente.bollaId}/storno-amministrativo`)
        .send(concorrenteBody),
    ]);
    expect(concurrentResponses.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(await lottoResidua(concorrente.lottoId)).toBe(10);
    const concurrentMovements = await movimentiBolla(concorrente.bollaId);
    expect(
      concurrentMovements.filter(
        (movement) => movement.tipoMovimento === "storno",
      ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.azione, "BOLLA_STORNO_AMMINISTRATIVO"),
            eq(auditEventiTable.entitaId, concorrente.bollaId),
          ),
        ),
    ).toHaveLength(1);
  });

  it("annulla integralmente lo storno se fallisce l'audit e consente il retry con la stessa chiave", async () => {
    const target = await consegnaDaStornare();
    const versioneConsegnata = await bollaVersione(target.bollaId);
    const quantitaDopoConsegna = await lottoResidua(target.lottoId);
    const idempotencyKey = commandKey("storno-audit-rollback");
    const operationKey = `m4a:BOLLA_STORNO_AMMINISTRATIVO:${idempotencyKey}`;
    const body = {
      idempotencyKey,
      versione: versioneConsegnata,
      motivo: "Verifica rollback transazionale audit",
      rigaIds: [target.rigaId],
    };
    const adminApp = makeScopedApp(bolleRouter, {
      id: operatoreId,
      centroAscoltoId: centroA,
      permessi: ["bolle.reverse.admin"],
    });
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const functionName = `test_bolla_storno_fail_${suffix}`;
    const triggerName = `test_bolla_storno_fail_trg_${suffix}`;
    const escapedOperationKey = operationKey.replaceAll("'", "''");
    let functionCreated = false;
    let triggerCreated = false;

    try {
      await pool.query(`CREATE FUNCTION ${functionName}()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.operation_key = '${escapedOperationKey}' THEN
            RAISE EXCEPTION 'synthetic Bolla storno audit failure';
          END IF;
          RETURN NEW;
        END $$`);
      functionCreated = true;
      await pool.query(`CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON audit_eventi
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      triggerCreated = true;

      const failed = await request(adminApp)
        .post(`/bolle/${target.bollaId}/storno-amministrativo`)
        .send(body);
      expect(failed.status).toBe(500);

      expect(await lottoResidua(target.lottoId)).toBe(quantitaDopoConsegna);
      expect(await bollaVersione(target.bollaId)).toBe(versioneConsegnata);
      expect(
        (await movimentiBolla(target.bollaId)).filter(
          (movement) => movement.tipoMovimento === "storno",
        ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(comandiOperativiTable)
          .where(
            and(
              eq(
                comandiOperativiTable.tipoComando,
                "BOLLA_STORNO_AMMINISTRATIVO",
              ),
              eq(comandiOperativiTable.idempotencyKey, idempotencyKey),
            ),
          ),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(auditEventiTable)
          .where(
            and(
              eq(auditEventiTable.azione, "BOLLA_STORNO_AMMINISTRATIVO"),
              eq(auditEventiTable.operationKey, operationKey),
            ),
          ),
      ).toHaveLength(0);
    } finally {
      try {
        if (triggerCreated) {
          await pool.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON audit_eventi`,
          );
        }
      } finally {
        if (functionCreated) {
          await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
        }
      }
    }

    const retry = await request(adminApp)
      .post(`/bolle/${target.bollaId}/storno-amministrativo`)
      .send(body);
    expect(retry.status, retry.text).toBe(200);
    expect(await lottoResidua(target.lottoId)).toBe(10);
    expect(await bollaVersione(target.bollaId)).toBe(versioneConsegnata + 1);
    expect(
      (await movimentiBolla(target.bollaId)).filter(
        (movement) => movement.tipoMovimento === "storno",
      ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(comandiOperativiTable)
        .where(
          and(
            eq(
              comandiOperativiTable.tipoComando,
              "BOLLA_STORNO_AMMINISTRATIVO",
            ),
            eq(comandiOperativiTable.idempotencyKey, idempotencyKey),
          ),
        ),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.azione, "BOLLA_STORNO_AMMINISTRATIVO"),
            eq(auditEventiTable.operationKey, operationKey),
          ),
        ),
    ).toHaveLength(1);
  });
});

describe("Consegne — completa converte le prenotazioni bolla", () => {
  it("associa la Bolla con versione, replay, mismatch, stale e concorrenza atomici", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const primaBollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const secondaBollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const associaKey = commandKey("consegna-associa-bolla");
    const associaBody = {
      bollaId: primaBollaId,
      versione: 1,
      idempotencyKey: associaKey,
    };

    const first = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(associaBody);
    const replay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(associaBody);
    const mismatch = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send({ ...associaBody, bollaId: secondaBollaId });
    const stale = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send({
        bollaId: primaBollaId,
        versione: 1,
        idempotencyKey: commandKey("consegna-associa-stale"),
      });
    const forbiddenReplay = await request(consegneAppAs(centroB))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(associaBody);

    expect(first.status, first.text).toBe(200);
    expect(first.body).toMatchObject({
      bollaId: primaBollaId,
      bollaVersione: 2,
    });
    expect(replay.status, replay.text).toBe(200);
    expect(replay.body.bollaVersione).toBe(2);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/chiave di idempotenza/i);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/versione non aggiornata/i);
    expect(forbiddenReplay.status).toBe(403);

    const switchKey = commandKey("consegna-associa-concorrente");
    const switchBody = {
      bollaId: secondaBollaId,
      versione: 1,
      idempotencyKey: switchKey,
    };
    const concurrent = await Promise.all([
      request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/associa-bolla`)
        .send(switchBody),
      request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/associa-bolla`)
        .send(switchBody),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
    expect(concurrent[0].body).toMatchObject({
      bollaId: secondaBollaId,
      bollaVersione: 2,
    });
    expect(concurrent[1].body).toMatchObject({
      bollaId: secondaBollaId,
      bollaVersione: 2,
    });

    const detachBody = {
      bollaId: null,
      versione: 2,
      idempotencyKey: commandKey("consegna-dissocia-bolla"),
    };
    const detached = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(detachBody);
    const detachReplay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(detachBody);
    expect(detached.status, detached.text).toBe(200);
    expect(detached.body.bollaId).toBeNull();
    expect(detachReplay.status, detachReplay.text).toBe(200);
    expect(
      await db
        .select()
        .from(comandiOperativiTable)
        .where(eq(comandiOperativiTable.idempotencyKey, switchKey)),
    ).toHaveLength(1);
  });

  it("preserva il replay storico ma blocca nuove associazioni su Consegne terminali e Bolle non operative", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const associaBody = {
      bollaId,
      versione: 1,
      idempotencyKey: commandKey("associa-prima-della-chiusura"),
    };
    const first = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(associaBody);
    expect(first.status, first.text).toBe(200);

    await db
      .update(consegneTable)
      .set({ stato: "effettuata", dataEffettuata: new Date() })
      .where(eq(consegneTable.id, consegnaId));
    const historicalReplay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send(associaBody);
    const terminalDetach = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send({
        bollaId: null,
        versione: 2,
        idempotencyKey: commandKey("dissocia-consegna-terminale"),
      });
    expect(historicalReplay.status, historicalReplay.text).toBe(200);
    expect(terminalDetach.status, terminalDetach.text).toBe(409);
    expect(terminalDetach.body.error).toMatch(/consegna conclusa/i);

    await db
      .update(consegneTable)
      .set({ stato: "pianificata", dataEffettuata: null })
      .where(eq(consegneTable.id, consegnaId));
    await db
      .update(bolleTable)
      .set({ stato: "consegnato" })
      .where(eq(bolleTable.id, bollaId));
    const deliveredDetach = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send({
        bollaId: null,
        versione: 2,
        idempotencyKey: commandKey("dissocia-bolla-consegnata"),
      });
    expect(deliveredDetach.status, deliveredDetach.text).toBe(409);
    expect(deliveredDetach.body.error).toMatch(/bolla consegnata/i);

    await db
      .update(bolleTable)
      .set({ stato: "annullato", consegnaId: null })
      .where(eq(bolleTable.id, bollaId));
    const deliveredTargetId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "consegnato",
    });
    const deliveredTarget = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/associa-bolla`)
      .send({
        bollaId: deliveredTargetId,
        versione: 1,
        idempotencyKey: commandKey("associa-bolla-consegnata"),
      });
    expect(deliveredTarget.status, deliveredTarget.text).toBe(409);
    expect(deliveredTarget.body.error).toMatch(/bozza o confermata/i);
  });

  it("completa una consegna collegata a bolla confermata convertendo prenotazioni in scarico fisico", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);

    const missingEnvelope = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send({});
    expect(missingEnvelope.status).toBe(400);
    expect(await bollaStato(bollaId)).toBe("confermato");

    const res = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("effettuata");
    expect(await bollaStato(bollaId)).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "convertita_in_scarico",
    ]);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);

    const [consegna] = await db
      .select()
      .from(consegneTable)
      .where(eq(consegneTable.id, consegnaId));
    expect(consegna.stato).toBe("effettuata");
    expect(consegna.dataEffettuata).not.toBeNull();
  });

  it("completa una consegna legacy senza scalare lotti o duplicare movimenti", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
      stato: "confermato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "6.00" })
      .where(eq(lottiTable.id, lottoId));
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: "2026-06-01",
      magazzinoId: magA,
      prodottoId: prod,
      lottoId,
      quantita: "4.00",
      unitaMisura: "kg",
      beneficiarioId: benA,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: "legacy",
    });

    const res = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(200);
    expect(res.body.stato).toBe("effettuata");
    expect(await bollaStato(bollaId)).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("serializza completa e dissocia sulla stessa Consegna senza inversioni di lock", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    const confirmed = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));
    expect(confirmed.status, confirmed.text).toBe(200);
    const versione = await bollaVersione(bollaId);

    const blocker = await pool.connect();
    let committed = false;
    let pendingCompleta: Promise<request.Response> | undefined;
    let pendingDissocia: Promise<request.Response> | undefined;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM consegne WHERE id = $1 FOR UPDATE", [
        consegnaId,
      ]);
      const blockerPid = Number(
        (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid"))
          .rows[0]?.pid,
      );
      pendingCompleta = request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/completa`)
        .send({
          versione,
          idempotencyKey: commandKey("barriera-completa-prima"),
        })
        .then((response) => response);
      await waitForBlockedBackends(blockerPid, 1);
      pendingDissocia = request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/associa-bolla`)
        .send({
          bollaId: null,
          versione,
          idempotencyKey: commandKey("barriera-dissocia-dopo"),
        })
        .then((response) => response);
      await waitForBlockedBackends(blockerPid, 2);
      await blocker.query("COMMIT");
      committed = true;

      const [completa, dissocia] = await Promise.all([
        pendingCompleta,
        pendingDissocia,
      ]);
      expect(completa.status, completa.text).toBe(200);
      expect(dissocia.status, dissocia.text).toBe(409);
      expect(dissocia.body.error).toMatch(/consegna conclusa/i);
    } finally {
      if (!committed) await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [pendingCompleta, pendingDissocia].filter(
          (pending): pending is Promise<request.Response> => pending != null,
        ),
      );
    }

    expect(await bollaStato(bollaId)).toBe("consegnato");
    expect(await lottoResidua(lottoId)).toBe(6);
  });

  it("applica replay, mismatch, stale e concorrenza senza scaricare due volte", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    expect(
      (
        await request(appAs(centroA))
          .post(`/bolle/${bollaId}/conferma`)
          .send(await bollaCommandBody(bollaId, {}))
      ).status,
    ).toBe(200);
    const versioneConfermata = await bollaVersione(bollaId);
    const list = await request(consegneAppAs(centroA)).get("/consegne");
    expect(list.status, list.text).toBe(200);
    expect(
      list.body.items.find((item: { id: number }) => item.id === consegnaId),
    ).toMatchObject({
      bollaId,
      bollaVersione: versioneConfermata,
    });

    const completionKey = commandKey("consegna-completa-concorrente");
    const completionBody = {
      idempotencyKey: completionKey,
      versione: versioneConfermata,
    };
    const concurrent = await Promise.all([
      request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/completa`)
        .send(completionBody),
      request(consegneAppAs(centroA))
        .post(`/consegne/${consegnaId}/completa`)
        .send(completionBody),
    ]);
    expect(concurrent.map((response) => response.status)).toEqual([200, 200]);

    const completaBis = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(completionBody);
    const mismatch = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send({ ...completionBody, versione: versioneConfermata + 1 });
    const stale = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send({
        idempotencyKey: commandKey("consegna-completa-stale"),
        versione: versioneConfermata,
      });
    const forbiddenReplay = await request(consegneAppAs(centroB))
      .post(`/consegne/${consegnaId}/completa`)
      .send(completionBody);
    const consegnaBis = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/consegna`)
      .send(await bollaCommandBody(bollaId, {}));
    await db
      .update(beneficiariTable)
      .set({ attivo: false })
      .where(eq(beneficiariTable.id, benA));
    const inactiveReplay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(completionBody);
    await db
      .update(magazziniTable)
      .set({ stato: "inattivo" })
      .where(eq(magazziniTable.id, magA));
    const inactiveWarehouseReplay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(completionBody);

    expect(completaBis.status).toBe(200);
    expect(completaBis.body.stato).toBe("effettuata");
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/chiave di idempotenza/i);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/versione non aggiornata/i);
    expect(forbiddenReplay.status).toBe(403);
    expect(consegnaBis.status).toBe(400);
    expect(consegnaBis.body.error).toContain("già consegnata");
    expect(inactiveReplay.status, inactiveReplay.text).toBe(200);
    expect(inactiveWarehouseReplay.status, inactiveWarehouseReplay.text).toBe(
      200,
    );
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(await bollaVersione(bollaId)).toBe(versioneConfermata + 1);
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.azione, "BOLLA_CONSEGNATA"),
            eq(auditEventiTable.entitaId, bollaId),
          ),
        ),
    ).toHaveLength(1);
  });

  it("registra una ricevuta idempotente anche per una Bolla legacy già consegnata", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
      stato: "consegnato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "6.00" })
      .where(eq(lottiTable.id, lottoId));
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: "2026-06-01",
      magazzinoId: magA,
      prodottoId: prod,
      lottoId,
      quantita: "4.00",
      unitaMisura: "kg",
      beneficiarioId: benA,
      bollaId,
      bollaRigaId: rigaId,
      documentoRiferimento: "legacy-consegnata",
    });

    const versione = await bollaVersione(bollaId);
    const body = {
      idempotencyKey: commandKey("consegna-completa-legacy"),
      versione,
    };
    const first = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(body);
    const replay = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send(body);
    const mismatch = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send({ ...body, versione: versione + 1 });

    expect(first.status, first.text).toBe(200);
    expect(replay.status, replay.text).toBe(200);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toMatch(/chiave di idempotenza/i);
    expect(first.body.stato).toBe("effettuata");
    expect(await bollaVersione(bollaId)).toBe(versione);
    expect(await lottoResidua(lottoId)).toBe(6);
    expect(await movimentiBolla(bollaId)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(auditEventiTable)
        .where(
          and(
            eq(auditEventiTable.azione, "CONSEGNA_LEGACY_RICONCILIATA"),
            eq(auditEventiTable.entitaId, bollaId),
          ),
        ),
    ).toHaveLength(1);
  });
});

describe("Report e preparazione — semantica merce impegnata/consegnata", () => {
  it("espone provenienza e lordo/storno/netto dal ledger, non dal flag corrente del lotto", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
      fsePlus: true,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "consegnato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 10,
    });
    const [originale] = await db
      .insert(movimentiTable)
      .values({
        tipoMovimento: "scarico",
        tipoDettaglio: "consegna_beneficiario",
        dataMovimento: "2026-06-01",
        magazzinoId: magA,
        prodottoId: prod,
        lottoId,
        quantita: "10.00",
        unitaMisura: "kg",
        beneficiarioId: benA,
        bollaId,
        bollaRigaId: rigaId,
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "DISTRIBUZIONE_FINALE",
      })
      .returning({ id: movimentiTable.id });
    const [storno] = await db
      .insert(movimentiTable)
      .values({
        tipoMovimento: "storno",
        tipoDettaglio: "storno_bolla",
        dataMovimento: "2026-06-02",
        magazzinoId: magA,
        prodottoId: prod,
        lottoId,
        quantita: "2.00",
        unitaMisura: "kg",
        beneficiarioId: benA,
        bollaId,
        bollaRigaId: null,
        movimentoOrigineId: originale.id,
        fondoOrigine: "FSE_PLUS",
        naturaContabile: "STORNO",
      })
      .returning({ id: movimentiTable.id });

    // Una riclassificazione successiva del lotto non deve riscrivere la
    // provenienza storica già registrata dal movimento di distribuzione.
    await db
      .update(lottiTable)
      .set({
        fsePlus: false,
        fondoOrigine: "NESSUN_FONDO",
      })
      .where(eq(lottiTable.id, lottoId));

    const partial = await request(appAs(centroA)).get(`/bolle/${bollaId}`);
    expect(partial.status).toBe(200);
    expect(partial.body.righe[0]).toMatchObject({
      fsePlus: true,
      fsePlusQuantita: 8,
      nonFsePlusQuantita: 0,
      quantitaLorda: 10,
      quantitaStornata: 2,
      quantitaNetta: 8,
    });

    await db
      .update(movimentiTable)
      .set({ quantita: "10.00" })
      .where(eq(movimentiTable.id, storno.id));
    const total = await request(appAs(centroA)).get(`/bolle/${bollaId}`);
    expect(total.status).toBe(200);
    expect(total.body.righe[0]).toMatchObject({
      fsePlus: false,
      fsePlusQuantita: 0,
      nonFsePlusQuantita: 0,
      quantitaLorda: 10,
      quantitaStornata: 10,
      quantitaNetta: 0,
    });
  });

  it("il report FSE+ conta solo bolle fisicamente consegnate", async () => {
    const before = (
      await request(reportAppAs(null)).get("/report/fse-plus?anno=2026")
    ).body.beneficiariTotali as number;
    const benConfermato = await createBeneficiario(scope, centroA);
    const benConsegnato = await createBeneficiario(scope, centroA);
    const lottoConfermato = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      fsePlus: true,
    });
    const lottoConsegnato = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 5,
      fsePlus: true,
    });
    const bollaConfermata = await insertBolla(scope, {
      beneficiarioId: benConfermato,
      magazzinoId: magA,
      stato: "confermato",
    });
    const bollaConsegnata = await insertBolla(scope, {
      beneficiarioId: benConsegnato,
      magazzinoId: magA,
      stato: "consegnato",
    });
    await insertBollaRiga(scope, {
      bollaId: bollaConfermata,
      prodottoId: prod,
      lottoId: lottoConfermato,
      quantita: 5,
    });
    const rigaConsegnata = await insertBollaRiga(scope, {
      bollaId: bollaConsegnata,
      prodottoId: prod,
      lottoId: lottoConsegnato,
      quantita: 5,
    });
    await insertMovimento(scope, {
      magazzinoId: magA,
      prodottoId: prod,
      lottoId: lottoConsegnato,
      bollaRigaId: rigaConsegnata,
      tipoMovimento: "scarico",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      fondoOrigine: "FSE_PLUS",
    });

    const after = (
      await request(reportAppAs(null)).get("/report/fse-plus?anno=2026")
    ).body.beneficiariTotali as number;

    expect(after).toBe(before + 1);
  });

  it("preparazione consegne usa il disponibile reale e non propone merce già impegnata", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magA,
      quantita: 10,
    });
    const bollaPrenotata = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      stato: "confermato",
    });
    const rigaPrenotata = await insertBollaRiga(scope, {
      bollaId: bollaPrenotata,
      prodottoId: prod,
      lottoId,
      quantita: 8,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magA,
      quantita: 8,
    });
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
    });
    const bollaDaPreparare = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magA,
      consegnaId,
    });
    await insertBollaRiga(scope, {
      bollaId: bollaDaPreparare,
      prodottoId: prod,
      lottoId,
      quantita: 3,
    });

    const res = await request(preparazioneAppAs(centroA)).get(
      `/preparazione-consegne?magazzinoId=${magA}`,
    );

    expect(res.status).toBe(200);
    expect(res.body.righe).toEqual([
      expect.objectContaining({
        prodottoId: prod,
        quantitaRichiesta: 3,
        quantitaDisponibile: 2,
        sufficiente: false,
      }),
    ]);
  });
});

describe("Bolle — scoping prenotazioni", () => {
  it("impedisce a un utente del centro A di confermare merce del magazzino del centro B", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });

    const res = await request(appAs(centroA))
      .post(`/bolle/${bollaId}/conferma`)
      .send({});

    expect(res.status).toBe(403);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
    expect(await bollaStato(bollaId)).toBe("bozza");
  });

  it("anche un utente globale rispetta la disponibilita reale", async () => {
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 10,
    });
    const bollaPrenotata = await insertBolla(scope, {
      beneficiarioId: benB,
      magazzinoId: magB,
      stato: "confermato",
    });
    const rigaPrenotata = await insertBollaRiga(scope, {
      bollaId: bollaPrenotata,
      prodottoId: prod,
      lottoId,
      quantita: 9,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId: bollaPrenotata,
      rigaBollaId: rigaPrenotata,
      prodottoId: prod,
      lottoId,
      magazzinoId: magB,
      quantita: 9,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benB,
      magazzinoId: magB,
    });
    await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 2,
    });

    const res = await request(appAs(null))
      .post(`/bolle/${bollaId}/conferma`)
      .send(await bollaCommandBody(bollaId, {}));

    expect(res.status).toBe(409);
    expect(await prenotazioniBolla(bollaId)).toHaveLength(0);
  });

  it("completa consegna rispetta anche lo scope del magazzino della bolla", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
    });
    const lottoId = await createLotto(scope, {
      prodottoId: prod,
      magazzinoId: magB,
      quantita: 10,
    });
    const bollaId = await insertBolla(scope, {
      beneficiarioId: benA,
      magazzinoId: magB,
      consegnaId,
      stato: "confermato",
    });
    const rigaId = await insertBollaRiga(scope, {
      bollaId,
      prodottoId: prod,
      lottoId,
      quantita: 4,
    });
    await insertPrenotazioneMagazzino(scope, {
      bollaId,
      rigaBollaId: rigaId,
      prodottoId: prod,
      lottoId,
      magazzinoId: magB,
      quantita: 4,
    });

    const res = await request(consegneAppAs(centroA))
      .post(`/consegne/${consegnaId}/completa`)
      .send({});

    expect(res.status).toBe(403);
    expect(await lottoResidua(lottoId)).toBe(10);
    expect((await prenotazioniBolla(bollaId)).map((p) => p.stato)).toEqual([
      "attiva",
    ]);
    expect(await bollaStato(bollaId)).toBe("confermato");
  });
});
