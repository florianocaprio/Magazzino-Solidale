/* @vitest-environment node */
// Eseguire esclusivamente nel futuro ##test con PostgreSQL effimero a ledger M5B.
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { eq, sql } from "drizzle-orm";
import {
  bolleTable,
  db,
  entiDestinatariTable,
  interventiDelegheM4Table,
  interventiMaterialiTable,
  interventiTable,
  lottiTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prenotazioniMagazzinoTable,
  richiesteMagazzinoDocumentiTable,
  richiesteMagazzinoTable,
  ruoliTable,
  trasferimentoRigheTable,
  trasferimentiTable,
  utentiTable,
} from "@workspace/db";
import documentRouter from "../src/routes/richieste-magazzino-documenti";
import requestsRouter from "../src/routes/richieste-magazzino";
import bolleRouter from "../src/routes/bolle";
import trasferimentiRouter from "../src/routes/trasferimenti";
import interventiRouter from "../src/routes/interventi";
import consegneRouter from "../src/routes/consegne";
import { lockInterventionMaterialPath } from "../src/lib/m5bInterventionDelegation";
import {
  createAreaOperativa,
  createBeneficiario,
  createCentroRec,
  createMagazzino,
  createLotto,
  createProdotto,
  createUtente,
  createZona,
  insertBolla,
  makeScopedApp,
  newScope,
} from "./scope-helpers";

const scope = newScope();
const suffix = randomUUID().slice(0, 8);
const grants = [
  "richieste_magazzino.view",
  "richieste_magazzino.prepare",
  "richieste_magazzino.cancel",
  "bolle.view",
  "bolle.manage",
  "bolle.deliver",
  "bolle.cancel",
  "magazzino.view",
  "magazzino.stock.receive",
  "magazzino.transfers.create",
  "magazzino.transfers.prepare",
  "magazzino.transfers.dispatch",
  "magazzino.transfers.receive",
  "magazzino.transfers.cancel",
];
let areaId: number;
let centreId: number;
let beneficiaryId: number;
let originId: number;
let destinationId: number;
let productId: number;
let operatorId: number;
let centreOperatorId: number;

function centreDeliveryApp() {
  return makeScopedApp(consegneRouter, {
    id: centreOperatorId,
    centroAscoltoId: centreId,
    areaOperativaId: areaId,
    aree: ["sociale"],
    permessi: [
      "richieste_magazzino.view",
      "consegne.view",
      "consegne.manage",
      "consegne.complete",
    ],
  });
}

function app(permissions = grants, userId = operatorId) {
  const router = express.Router();
  router.use(requestsRouter, documentRouter, bolleRouter, trasferimentiRouter);
  return makeScopedApp(router, {
    id: userId,
    username: `m5b-${suffix}`,
    centroAscoltoId: centreId,
    areaOperativaId: areaId,
    aree: ["magazzino"],
    permessi: permissions,
  });
}

function socialApp(warehouse = false) {
  return makeScopedApp(interventiRouter, {
    id: operatorId,
    username: `m5b-${suffix}`,
    centroAscoltoId: centreId,
    areaOperativaId: areaId,
    aree: warehouse ? ["sociale", "magazzino"] : ["sociale"],
    permessi: [
      "sociale.interventi.view",
      "sociale.interventi.update",
      "sociale.interventi.complete",
    ],
  });
}

async function interventionFixture() {
  const [row] = await db
    .insert(interventiTable)
    .values({
      beneficiarioId: beneficiaryId,
      tipoIntervento: `M5B delega ${randomUUID().slice(0, 8)}`,
      ambito: "sociale",
      stato: "in_corso",
      areaOperativaIdSnapshot: areaId,
      centroAscoltoIdSnapshot: centreId,
      operatoreId: operatorId,
    })
    .returning();
  scope.interventoIds.push(row.id);
  return row;
}

async function advisoryWaiters() {
  const result = await pool.query<{ count: number }>(`
    SELECT count(*)::integer AS count FROM pg_stat_activity
    WHERE datname = current_database()
      AND wait_event_type = 'Lock'
      AND wait_event = 'advisory'
      AND query LIKE '%m5b.intervento.materiali%'
  `);
  return result.rows[0].count;
}

async function waitForAdvisoryWaiters(expected: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if ((await advisoryWaiters()) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Non osservati ${expected} waiter advisory PostgreSQL`);
}

async function withDatabaseFault(
  table:
    | "bolle"
    | "trasferimento_righe"
    | "richieste_magazzino_documenti"
    | "interventi_deleghe_m4"
    | "audit_eventi"
    | "comandi_operativi",
  operation: "INSERT" | "UPDATE",
  body: () => Promise<void>,
  condition?: string,
) {
  const identifier = `m5b_fault_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await pool.query(`CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'M5B_FAULT_INJECTED' USING ERRCODE = 'P0001'; END; $$`);
  try {
    await pool.query(`CREATE TRIGGER ${identifier} BEFORE ${operation} ON ${table}
      FOR EACH ROW ${condition ? `WHEN (${condition})` : ""}
      EXECUTE FUNCTION ${identifier}()`);
    try {
      const installed = await pool.query(
        "SELECT count(*)::integer AS count FROM pg_trigger WHERE tgname = $1 AND NOT tgisinternal",
        [identifier],
      );
      expect(installed.rows[0].count).toBe(1);
      await body();
    } finally {
      await pool.query(`DROP TRIGGER ${identifier} ON ${table}`);
    }
  } finally {
    await pool.query(`DROP FUNCTION ${identifier}()`);
  }
}

async function withDeferredReceiptFault(body: () => Promise<void>) {
  const identifier = `m5b_commit_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await pool.query(`CREATE FUNCTION ${identifier}() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'M5B_COMMIT_FAULT' USING ERRCODE = 'P0001'; END; $$`);
  try {
    await pool.query(`CREATE CONSTRAINT TRIGGER ${identifier}
      AFTER INSERT ON comandi_operativi DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION ${identifier}()`);
    try {
      await body();
    } finally {
      await pool.query(`DROP TRIGGER ${identifier} ON comandi_operativi`);
    }
  } finally {
    await pool.query(`DROP FUNCTION ${identifier}()`);
  }
}

async function domainCounts(requestId: number) {
  const result = await pool.query(
    `SELECT
      (SELECT versione FROM richieste_magazzino WHERE id = $1) AS versione,
      (SELECT count(*)::integer FROM bolle) AS bolle,
      (SELECT count(*)::integer FROM bolla_righe) AS bolla_righe,
      (SELECT count(*)::integer FROM trasferimenti) AS trasferimenti,
      (SELECT count(*)::integer FROM trasferimento_righe) AS trasferimento_righe,
      (SELECT count(*)::integer FROM richieste_magazzino_documenti) AS relazioni,
      (SELECT count(*)::integer FROM interventi_deleghe_m4) AS deleghe,
      (SELECT count(*)::integer FROM audit_eventi) AS audit,
      (SELECT count(*)::integer FROM comandi_operativi) AS ricevute,
      (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni,
      (SELECT count(*)::integer FROM movimenti) AS movimenti`,
    [requestId],
  );
  return result.rows[0];
}

async function withBlockedIntervention(
  interventionId: number,
  body: (release: () => Promise<void>) => Promise<void>,
) {
  const blocker = await pool.connect();
  let released = false;
  try {
    await blocker.query("BEGIN");
    await blocker.query(
      "SELECT pg_advisory_xact_lock(hashtext('m5b.intervento.materiali'), $1)",
      [interventionId],
    );
    const release = async () => {
      if (!released) {
        released = true;
        await blocker.query("COMMIT");
      }
    };
    await body(release);
  } finally {
    if (!released) await blocker.query("ROLLBACK");
    blocker.release();
  }
}

async function fixture(
  kind: "beneficiario" | "magazzino" | "ente",
  interventoId: number | null = null,
) {
  const entity =
    kind === "ente"
      ? (
          await db
            .insert(entiDestinatariTable)
            .values({
              denominazione: `Ente ritorno ${randomUUID().slice(0, 8)}`,
              areaOperativaId: areaId,
              indirizzo: "Via test M5B 1",
            })
            .returning()
        )[0]
      : null;
  const [row] = await db
    .insert(richiesteMagazzinoTable)
    .values({
      codice: `RM-M5B-${randomUUID().slice(0, 8)}`,
      tipoDestinatario: kind,
      beneficiarioId: kind === "beneficiario" ? beneficiaryId : null,
      enteDestinatarioId: entity?.id ?? null,
      magazzinoDestinatarioId: kind === "magazzino" ? destinationId : null,
      areaOperativaId: areaId,
      centroAscoltoId: kind === "beneficiario" ? centreId : null,
      sorgente:
        interventoId != null
          ? "intervento_sociale"
          : kind === "beneficiario"
            ? "beneficiario"
            : "operativa",
      interventoId,
      destinatarioNomeSnapshot:
        kind === "beneficiario" ? "Persona sintetica" : "Deposito sintetico",
      areaNomeSnapshot: "Area sintetica",
      centroNomeSnapshot: kind === "beneficiario" ? "Centro sintetico" : null,
      bisogno: "Bisogno sintetico per raccordo M5B",
      stato: "presa_in_carico",
      inviatoDa: operatorId,
      presoInCaricoDa: operatorId,
      presoInCaricoAt: new Date(),
      presoInCaricoCodiceSnapshot: `m5b-${suffix}`,
    })
    .returning();
  return row;
}

beforeAll(async () => {
  if (process.env.M5B_TEST_DISPOSABLE_DB !== "verified")
    throw new Error(
      "M5B API test requires verified disposable PostgreSQL with the M5B migration",
    );
  areaId = await createAreaOperativa(scope);
  centreId = (await createCentroRec(scope, { areaOperativaId: areaId })).id;
  beneficiaryId = await createBeneficiario(scope, centreId, {
    areaOperativaId: areaId,
  });
  originId = await createMagazzino(scope, centreId, {
    areaOperativaId: areaId,
  });
  destinationId = await createMagazzino(scope, null, {
    areaOperativaId: areaId,
  });
  productId = await createProdotto(scope, {
    unitaMisura: "pz",
    quantitaFrazionabile: false,
  });
  const [role] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5B ${suffix}`,
      aree: ["magazzino"],
      permessi: grants,
    })
    .returning({ id: ruoliTable.id });
  scope.ruoloIds.push(role.id);
  operatorId = await createUtente(scope, {
    ruoloId: role.id,
    centroId: centreId,
  });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: areaId })
    .where(eq(utentiTable.id, operatorId));
  // Separate Centre actor: do not promote the warehouse operator for the new handoff.
  const [centreRole] = await db
    .insert(ruoliTable)
    .values({
      nome: `M5C2 Centro ${suffix}`,
      aree: ["sociale"],
      permessi: [
        "richieste_magazzino.view",
        "consegne.view",
        "consegne.manage",
        "consegne.complete",
      ],
    })
    .returning();
  centreOperatorId = await createUtente(scope, {
    ruoloId: centreRole.id,
    centroId: centreId,
  });
  await db
    .update(utentiTable)
    .set({ areaOperativaId: areaId })
    .where(eq(utentiTable.id, centreOperatorId));
});

afterAll(async () => {
  await pool.end();
});

describe("M5B — documento unico e transazione PostgreSQL", () => {
  it("M5C1: un attore solo Sociale con grant Bolla legacy non crea una Bolla diretta", async () => {
    const socialBolle = makeScopedApp(bolleRouter, {
      id: operatorId,
      centroAscoltoId: centreId,
      areaOperativaId: areaId,
      aree: ["sociale"],
      permessi: ["bolle.view", "bolle.manage", "bolle.deliver", "bolle.cancel"],
    });
    const before = await db.select({ id: bolleTable.id }).from(bolleTable);
    const response = await request(socialBolle).post("/bolle").send({});
    expect(response.status).toBe(403);
    expect(
      await db.select({ id: bolleTable.id }).from(bolleTable),
    ).toHaveLength(before.length);
  });

  it("ATOM-COMMIT: un errore deferred alla ricevuta finale rollbacka ogni effetto nei due rami", async () => {
    for (const kind of ["beneficiario", "magazzino"] as const) {
      const intervention =
        kind === "beneficiario" ? await interventionFixture() : null;
      const row = await fixture(kind, intervention?.id ?? null);
      const payload = {
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
        ...(kind === "magazzino"
          ? {
              righe: [
                { prodottoId: productId, quantita: "1", unitaMisura: "pz" },
              ],
            }
          : {}),
      };
      const before = await domainCounts(row.id);
      await withDeferredReceiptFault(async () => {
        const failed = await request(app())
          .post(`/richieste-magazzino/${row.id}/documento`)
          .send(payload);
        expect(failed.status).toBeGreaterThanOrEqual(400);
      });
      expect(await domainCounts(row.id)).toEqual(before);
      const retry = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(retry.status, retry.text).toBe(201);
      const replay = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(replay.status, replay.text).toBe(200);
      expect(replay.body.documentoId).toBe(retry.body.documentoId);
    }
  });

  it("ATOM-CREATE: errori DB dopo le prime scritture rollbackano Bolla, delega, relazione, audit e ricevuta", async () => {
    const cases = [
      { table: "interventi_deleghe_m4", operation: "INSERT" },
      { table: "bolle", operation: "INSERT" },
      { table: "richieste_magazzino_documenti", operation: "INSERT" },
      {
        table: "audit_eventi",
        operation: "INSERT",
        condition: "NEW.azione = 'richiesta_magazzino.documento_creato'",
      },
      { table: "comandi_operativi", operation: "INSERT" },
    ] as const;
    for (const fault of cases) {
      const intervention = await interventionFixture();
      const row = await fixture("beneficiario", intervention.id);
      const payload = {
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      };
      const before = await domainCounts(row.id);
      await withDatabaseFault(
        fault.table,
        fault.operation,
        async () => {
          const failed = await request(app())
            .post(`/richieste-magazzino/${row.id}/documento`)
            .send(payload);
          expect(failed.status).toBeGreaterThanOrEqual(400);
          expect(failed.text).toContain(fault.table);
        },
        "condition" in fault ? fault.condition : undefined,
      );
      expect(await domainCounts(row.id)).toEqual(before);
      const retry = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(retry.status, retry.text).toBe(201);
      const replay = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(replay.status, replay.text).toBe(200);
      expect(replay.body.documentoId).toBe(retry.body.documentoId);
    }
  }, 90_000);

  it("ATOM-TRANSFER: riga, relazione, audit e ricevuta falliti non lasciano Trasferimenti orfani", async () => {
    const cases = [
      { table: "trasferimento_righe", operation: "INSERT" },
      { table: "richieste_magazzino_documenti", operation: "INSERT" },
      {
        table: "audit_eventi",
        operation: "INSERT",
        condition: "NEW.azione = 'richiesta_magazzino.documento_creato'",
      },
      { table: "comandi_operativi", operation: "INSERT" },
    ] as const;
    for (const fault of cases) {
      const row = await fixture("magazzino");
      const payload = {
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
        righe: [{ prodottoId: productId, quantita: "1", unitaMisura: "pz" }],
      };
      const before = await domainCounts(row.id);
      await withDatabaseFault(
        fault.table,
        fault.operation,
        async () => {
          const failed = await request(app())
            .post(`/richieste-magazzino/${row.id}/documento`)
            .send(payload);
          expect(failed.status).toBeGreaterThanOrEqual(400);
          expect(failed.text).toContain(fault.table);
        },
        "condition" in fault ? fault.condition : undefined,
      );
      expect(await domainCounts(row.id)).toEqual(before);
      const retry = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(retry.status, retry.text).toBe(201);
      const replay = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(replay.status, replay.text).toBe(200);
      expect(replay.body.documentoId).toBe(retry.body.documentoId);
    }
  }, 90_000);

  it("ATOM-CANCEL: errore dopo rilascio riserve rollbacka annullamento M4 e cessazione M5B", async () => {
    const faultProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: faultProductId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    for (const kind of ["beneficiario", "magazzino"] as const) {
      const row = await fixture(kind);
      const created = await request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: row.versione,
          magazzinoId: originId,
          ...(kind === "magazzino"
            ? {
                righe: [
                  {
                    prodottoId: faultProductId,
                    lottoId: lotId,
                    quantita: "2",
                    unitaMisura: "pz",
                  },
                ],
              }
            : {}),
        });
      expect(created.status, created.text).toBe(201);
      const documentId = created.body.documentoId as number;
      let readyVersion: number;
      if (kind === "beneficiario") {
        const line = await request(app())
          .post(`/bolle/${documentId}/righe`)
          .send({
            idempotencyKey: randomUUID(),
            versione: created.body.versioneDocumento,
            prodottoId: faultProductId,
            lottoId: lotId,
            quantita: "2",
          });
        expect(line.status, line.text).toBe(201);
        const [withLine] = await db
          .select()
          .from(bolleTable)
          .where(eq(bolleTable.id, documentId));
        const ready = await request(app())
          .post(`/bolle/${documentId}/conferma`)
          .send({ idempotencyKey: randomUUID(), versione: withLine.versione });
        expect(ready.status, ready.text).toBe(200);
        readyVersion = ready.body.versione;
      } else {
        const ready = await request(app())
          .post(`/trasferimenti/${documentId}/prepara`)
          .send({
            idempotencyKey: randomUUID(),
            versione: created.body.versioneDocumento,
          });
        expect(ready.status, ready.text).toBe(200);
        readyVersion = ready.body.versione;
      }
      const snapshot = async () => {
        const result = await pool.query(
          `SELECT
            (SELECT versione FROM richieste_magazzino WHERE id=$1) AS richiesta_versione,
            (SELECT stato FROM ${kind === "beneficiario" ? "bolle" : "trasferimenti"} WHERE id=$2) AS stato,
            (SELECT versione FROM ${kind === "beneficiario" ? "bolle" : "trasferimenti"} WHERE id=$2) AS documento_versione,
            (SELECT corrente FROM richieste_magazzino_documenti WHERE richiesta_id=$1 AND ${kind === "beneficiario" ? "bolla_id" : "trasferimento_id"}=$2) AS corrente,
            (SELECT coalesce(sum(quantita) FILTER (WHERE stato='attiva'),0)::text FROM prenotazioni_magazzino WHERE ${kind === "beneficiario" ? "bolla_id" : "trasferimento_id"}=$2) AS riserva,
            (SELECT count(*)::integer FROM audit_eventi) AS audit,
            (SELECT count(*)::integer FROM comandi_operativi) AS ricevute,
            (SELECT count(*)::integer FROM movimenti) AS movimenti`,
          [row.id, documentId],
        );
        return result.rows[0];
      };
      const before = await snapshot();
      expect(before.riserva).toBe("2.000000");
      const route = kind === "beneficiario" ? "bolle" : "trasferimenti";
      const payload = {
        idempotencyKey: randomUUID(),
        versione: readyVersion,
        motivo: "TEST-M5B rollback annullamento",
      };
      await withDatabaseFault(
        "richieste_magazzino_documenti",
        "UPDATE",
        async () => {
          const failed = await request(app())
            .post(`/${route}/${documentId}/annulla`)
            .send(payload);
          expect(failed.status).toBe(500);
          expect(failed.text).toContain("richieste_magazzino_documenti");
        },
        "OLD.corrente AND NOT NEW.corrente",
      );
      expect(await snapshot()).toEqual(before);
      const retry = await request(app())
        .post(`/${route}/${documentId}/annulla`)
        .send(payload);
      expect(retry.status, retry.text).toBe(200);
      const after = await snapshot();
      expect(after.corrente).toBe(false);
      expect(after.riserva).toBe("0");
      expect(after.movimenti).toBe(before.movimenti);
    }
  }, 90_000);

  it("crea Bolla vuota, replay esatto, blocca doppia creazione e richiesta, riconcilia annullamento", async () => {
    const row = await fixture("beneficiario");
    const payload = {
      idempotencyKey: randomUUID(),
      versione: 1,
      magazzinoId: originId,
    };
    const before = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM movimenti) AS movimenti,
      (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni`);
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send(payload);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      tipoDocumento: "bolla",
      versioneRichiesta: 2,
      replay: false,
    });
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, created.body.documentoId));
    expect(bolla).toMatchObject({
      stato: "bozza",
      beneficiarioId: beneficiaryId,
      magazzinoId: originId,
    });
    const otherRequest = await fixture("beneficiario");
    await expect(
      db.insert(richiesteMagazzinoDocumentiTable).values({
        richiestaId: otherRequest.id,
        tipoDocumento: "bolla",
        bollaId: bolla.id,
        creatoDa: operatorId,
      }),
    ).rejects.toThrow();
    expect(
      (
        await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM movimenti) AS movimenti,
      (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni`)
      ).rows[0],
    ).toEqual(before.rows[0]);
    const replay = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send(payload);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ documentoId: bolla.id, replay: true });
    expect(
      (
        await request(app())
          .post(`/richieste-magazzino/${row.id}/documento`)
          .send({ ...payload, idempotencyKey: randomUUID(), versione: 2 })
      ).status,
    ).toBe(409);
    // R1: request cancellation now orchestrates M4 (covered in
    // m5c2a-r1-request-cancel.test.ts). This case keeps testing direct M4
    // cancellation and replacement while the request remains active.
    const [activeRequest] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    expect(activeRequest.stato).toBe("presa_in_carico");
    const cancelPayload = {
      idempotencyKey: randomUUID(),
      versione: bolla.versione,
      motivo: "Sostituzione",
    };
    const cancelled = await request(app())
      .post(`/bolle/${bolla.id}/annulla`)
      .send(cancelPayload);
    expect(cancelled.status).toBe(200);
    const cancelReplay = await request(app())
      .post(`/bolle/${bolla.id}/annulla`)
      .send(cancelPayload);
    expect(cancelReplay.status).toBe(200);
    const [link] = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.bollaId, bolla.id));
    expect(link).toMatchObject({
      corrente: false,
      eventoCessazione: "annullamento_m4",
    });
    const [updated] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    expect(updated.versione).toBe(3);
    const second = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 3,
        magazzinoId: originId,
      });
    expect(second.status).toBe(201);
    expect(second.body.documentoId).not.toBe(bolla.id);
    const history = await request(app()).get(
      `/richieste-magazzino/${row.id}/documenti`,
    );
    expect(history.body.precedenti).toHaveLength(1);
    expect(history.body.corrente.codice).toBe(second.body.codiceDocumento);
  });

  it("CAN-REPLAY: D1 pronta annullata, D2 pronta e replay K1 non rilasciano le nuove riserve", async () => {
    const lottoA = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    const lottoB = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-06-01",
    });
    const quantities = async () => {
      const result = await db.execute(sql`
        SELECT
          (SELECT coalesce(sum(quantita_residua), 0)::text FROM lotti
            WHERE id IN (${lottoA}, ${lottoB})) AS fisica,
          (SELECT coalesce(sum(quantita), 0)::text FROM prenotazioni_magazzino
            WHERE lotto_id IN (${lottoA}, ${lottoB}) AND stato = 'attiva') AS prenotata,
          (SELECT count(*)::integer FROM movimenti
            WHERE lotto_id IN (${lottoA}, ${lottoB})) AS movimenti
      `);
      const row = result.rows[0];
      const fisica = Number(row.fisica);
      const prenotata = Number(row.prenotata);
      return {
        fisica,
        prenotata,
        disponibile: fisica - prenotata,
        movimenti: row.movimenti,
      };
    };
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 0,
      disponibile: 20,
      movimenti: 0,
    });
    const richiesta = await fixture("beneficiario");
    const create = async (versione: number) => {
      const response = await request(app())
        .post(`/richieste-magazzino/${richiesta.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione,
          magazzinoId: originId,
        });
      expect(response.status, response.text).toBe(201);
      return response.body.documentoId as number;
    };
    const prepare = async (bollaId: number, quantita: string) => {
      const [draft] = await db
        .select()
        .from(bolleTable)
        .where(eq(bolleTable.id, bollaId));
      const line = await request(app()).post(`/bolle/${bollaId}/righe`).send({
        idempotencyKey: randomUUID(),
        versione: draft.versione,
        prodottoId: productId,
        quantita,
      });
      expect(line.status, line.text).toBe(201);
      const [withLine] = await db
        .select()
        .from(bolleTable)
        .where(eq(bolleTable.id, bollaId));
      const confirmed = await request(app())
        .post(`/bolle/${bollaId}/conferma`)
        .send({ idempotencyKey: randomUUID(), versione: withLine.versione });
      expect(confirmed.status, confirmed.text).toBe(200);
    };
    const activeQuantity = async (bollaId: number) => {
      const result = await db.execute(sql`
        SELECT coalesce(sum(quantita) FILTER (WHERE stato = 'attiva'), 0)::text AS quantita
        FROM prenotazioni_magazzino WHERE bolla_id = ${bollaId}
      `);
      return Number(result.rows[0].quantita);
    };

    const d1 = await create(richiesta.versione);
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 0,
      disponibile: 20,
      movimenti: 0,
    });
    await prepare(d1, "6");
    expect(await activeQuantity(d1)).toBe(6);
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 6,
      disponibile: 14,
      movimenti: 0,
    });
    const firstAllocation = await db.execute(sql`
      SELECT lotto_id AS "lottoId", quantita::text AS quantita
      FROM prenotazioni_magazzino WHERE bolla_id = ${d1} AND stato = 'attiva'
    `);
    expect(firstAllocation.rows).toEqual([
      { lottoId: lottoA, quantita: "6.000000" },
    ]);
    const competingRequest = await fixture("beneficiario");
    const competingDraft = await request(app())
      .post(`/richieste-magazzino/${competingRequest.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: competingRequest.versione,
        magazzinoId: originId,
      });
    expect(competingDraft.status, competingDraft.text).toBe(201);
    const competingBollaId = competingDraft.body.documentoId as number;
    const competingLine = await request(app())
      .post(`/bolle/${competingBollaId}/righe`)
      .send({
        idempotencyKey: randomUUID(),
        versione: competingDraft.body.versioneDocumento,
        prodottoId: productId,
        quantita: "15",
      });
    expect(competingLine.status, competingLine.text).toBe(400);
    expect(competingLine.body.error).toContain("Disponibilità insufficiente");
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 6,
      disponibile: 14,
      movimenti: 0,
    });
    const [readyD1] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, d1));
    const k1 = {
      idempotencyKey: randomUUID(),
      versione: readyD1.versione,
      motivo: "TEST-M5B sostituzione pre-uscita",
    };
    const cancelled = await request(app())
      .post(`/bolle/${d1}/annulla`)
      .send(k1);
    expect(cancelled.status, cancelled.text).toBe(200);
    expect(await activeQuantity(d1)).toBe(0);
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 0,
      disponibile: 20,
      movimenti: 0,
    });

    const [afterCancel] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, richiesta.id));
    const d2 = await create(afterCancel.versione);
    await prepare(d2, "12");
    expect(await activeQuantity(d2)).toBe(12);
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 12,
      disponibile: 8,
      movimenti: 0,
    });
    const secondAllocation = await db.execute(sql`
      SELECT lotto_id AS "lottoId", quantita::text AS quantita
      FROM prenotazioni_magazzino WHERE bolla_id = ${d2} AND stato = 'attiva'
      ORDER BY lotto_id
    `);
    expect(secondAllocation.rows).toEqual([
      { lottoId: lottoA, quantita: "10.000000" },
      { lottoId: lottoB, quantita: "2.000000" },
    ]);
    const [beforeReplay] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, richiesta.id));
    const [readyD2] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, d2));
    expect(readyD2.stato).toBe("confermato");
    const replay = await request(app()).post(`/bolle/${d1}/annulla`).send(k1);
    expect(replay.status, replay.text).toBe(200);
    const [afterReplay] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, richiesta.id));
    expect(afterReplay.versione).toBe(beforeReplay.versione);
    expect(await activeQuantity(d2)).toBe(12);
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, richiesta.id));
    expect(
      links.filter((item) => item.corrente).map((item) => item.bollaId),
    ).toEqual([d2]);
    const keyReuse = await request(app())
      .post(`/bolle/${d1}/annulla`)
      .send({ ...k1, motivo: "Contenuto differente" });
    expect(keyReuse.status).toBe(409);
    expect(await activeQuantity(d2)).toBe(12);
    const [lastDraft] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, d2));
    const finalCancel = await request(app()).post(`/bolle/${d2}/annulla`).send({
      idempotencyKey: randomUUID(),
      versione: lastDraft.versione,
      motivo: "TEST-M5B fine prova contabile",
    });
    expect(finalCancel.status, finalCancel.text).toBe(200);
    expect(await quantities()).toEqual({
      fisica: 20,
      prenotata: 0,
      disponibile: 20,
      movimenti: 0,
    });
  });

  it("LEDGER-M5B-DIRECT: il diretto sociale è negato; la pianificazione Centro scarica una volta e conserva il link", async () => {
    const intervention = await interventionFixture();
    const deliveryProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: deliveryProductId,
      magazzinoId: originId,
      quantita: 20,
      dataScadenza: "2098-01-01",
    });
    const row = await fixture("beneficiario", intervention.id);
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const bollaId = created.body.documentoId as number;
    const line = await request(app()).post(`/bolle/${bollaId}/righe`).send({
      idempotencyKey: randomUUID(),
      versione: created.body.versioneDocumento,
      prodottoId: deliveryProductId,
      quantita: "6",
    });
    expect(line.status, line.text).toBe(201);
    const confirmed = await request(app())
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        idempotencyKey: randomUUID(),
        versione: line.body.versioneBolla,
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const beforeDelivery = await db.execute(sql`
      SELECT l.quantita_residua::text AS physical,
        (SELECT coalesce(sum(p.quantita), 0)::text
         FROM prenotazioni_magazzino p
         WHERE p.bolla_id = ${bollaId} AND p.stato = 'attiva') AS reserved
      FROM lotti l WHERE l.id = ${lotId}
    `);
    expect(beforeDelivery.rows[0]).toMatchObject({
      physical: "20.000000",
      reserved: "6.000000",
    });
    const deniedDirect = await request(app())
      .post(`/bolle/${bollaId}/consegna`)
      .send({
        idempotencyKey: randomUUID(),
        versione: confirmed.body.versione,
      });
    expect(deniedDirect.status, deniedDirect.text).toBe(409);
    expect(deniedDirect.body.error).toContain("pianificazione del Centro");
    const planned = await request(centreDeliveryApp())
      .post(`/consegne/da-bolla/${bollaId}`)
      .send({
        idempotencyKey: randomUUID(),
        versione: confirmed.body.versione,
        dataPrevista: "2026-10-08",
        fasciaOraria: "Mattina",
        tipoConsegna: "in_sede",
      });
    expect(planned.status, planned.text).toBe(201);
    const [plannedBolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const command = {
      idempotencyKey: randomUUID(),
      versione: plannedBolla.versione,
      confermaRicezione: true,
    };
    const delivered = await request(centreDeliveryApp())
      .post(`/consegne/${planned.body.id}/completa`)
      .send(command);
    expect(delivered.status, delivered.text).toBe(200);
    const afterDelivery = await db.execute(sql`
      SELECT l.quantita_residua::text AS physical,
        (SELECT coalesce(sum(p.quantita), 0)::text
         FROM prenotazioni_magazzino p
         WHERE p.bolla_id = ${bollaId} AND p.stato = 'attiva') AS reserved
      FROM lotti l WHERE l.id = ${lotId}
    `);
    expect(afterDelivery.rows[0]).toMatchObject({
      physical: "14.000000",
      reserved: "0",
    });
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, bollaId));
    expect(movements).toHaveLength(1);
    expect(movements[0].quantita).toBe("6.00");
    const replay = await request(centreDeliveryApp())
      .post(`/consegne/${planned.body.id}/completa`)
      .send(command);
    expect(replay.status, replay.text).toBe(200);
    expect(
      (
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.bollaId, bollaId))
      ).length,
    ).toBe(1);
    const [lotAfterReplay] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lotId));
    expect(lotAfterReplay.residuo).toBe("14.00");
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ bollaId, corrente: true });
    const [currentRequest] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    expect(currentRequest.stato).toBe("chiusa");
    const secondDocument = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: currentRequest.versione,
        magazzinoId: originId,
      });
    expect(secondDocument.status).toBe(409);
    const [unchangedOrigin] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(unchangedOrigin.bollaId).toBeNull();
  });

  it("LEDGER-M5B-ENTE: la consegna collegata a Ente scarica una volta sola", async () => {
    const entityProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: entityProductId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    const [entity] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: `Ente M5B ${randomUUID().slice(0, 8)}`,
        indirizzo: "Via sintetica 1",
        areaOperativaId: areaId,
      })
      .returning();
    scope.enteDestinatarioIds.push(entity.id);
    const [row] = await db
      .insert(richiesteMagazzinoTable)
      .values({
        codice: `RM-M5B-${randomUUID().slice(0, 8)}`,
        tipoDestinatario: "ente",
        enteDestinatarioId: entity.id,
        areaOperativaId: areaId,
        sorgente: "operativa",
        destinatarioNomeSnapshot: entity.denominazione,
        areaNomeSnapshot: "Area sintetica",
        bisogno: "Test Ente M5B",
        stato: "presa_in_carico",
        inviatoDa: operatorId,
        presoInCaricoDa: operatorId,
        presoInCaricoAt: new Date(),
        presoInCaricoCodiceSnapshot: `m5b-${suffix}`,
      })
      .returning();
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const bollaId = created.body.documentoId as number;
    const line = await request(app()).post(`/bolle/${bollaId}/righe`).send({
      idempotencyKey: randomUUID(),
      versione: created.body.versioneDocumento,
      prodottoId: entityProductId,
      quantita: "4",
    });
    expect(line.status, line.text).toBe(201);
    const ready = await request(app()).post(`/bolle/${bollaId}/conferma`).send({
      idempotencyKey: randomUUID(),
      versione: line.body.versioneBolla,
    });
    expect(ready.status, ready.text).toBe(200);
    const command = {
      idempotencyKey: randomUUID(),
      versione: ready.body.versione,
      confermaRicezione: true,
    };
    const delivered = await request(app())
      .post(`/bolle/${bollaId}/consegna`)
      .send(command);
    expect(delivered.status, delivered.text).toBe(200);
    const replay = await request(app())
      .post(`/bolle/${bollaId}/consegna`)
      .send(command);
    expect(replay.status, replay.text).toBe(200);
    const [lot] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lotId));
    expect(Number(lot.residuo)).toBe(6);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, bollaId));
    expect(movements).toHaveLength(1);
    expect(Number(movements[0].quantita)).toBe(4);
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ bollaId, corrente: true });
  });

  it("LEDGER-M5B-RETURN: affidamento Ente e rientro 3 idonee + 1 mancante conservano il collegamento", async () => {
    const deliveryProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: deliveryProductId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    // Direct physical transport remains valid for Ente; social Beneficiario uses the Centre handoff.
    const row = await fixture("ente");
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const bollaId = created.body.documentoId as number;
    const line = await request(app()).post(`/bolle/${bollaId}/righe`).send({
      idempotencyKey: randomUUID(),
      versione: created.body.versioneDocumento,
      prodottoId: deliveryProductId,
      quantita: "4",
    });
    expect(line.status, line.text).toBe(201);
    const confirmed = await request(app())
      .post(`/bolle/${bollaId}/conferma`)
      .send({
        idempotencyKey: randomUUID(),
        versione: line.body.versioneBolla,
      });
    expect(confirmed.status, confirmed.text).toBe(200);
    const entrusted = await request(app())
      .post(`/bolle/${bollaId}/affida`)
      .send({
        idempotencyKey: randomUUID(),
        versione: confirmed.body.versione,
        trasportatoreNome: "Trasportatore sintetico M5B",
      });
    expect(entrusted.status, entrusted.text).toBe(200);
    const [afterEntrust] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lotId));
    expect(afterEntrust.residuo).toBe("6.00");
    const failedDelivery = await request(app())
      .post(`/bolle/${bollaId}/mancata-consegna`)
      .send({
        idempotencyKey: randomUUID(),
        versione: entrusted.body.versione,
        motivo: "Ente non disponibile — test sintetico",
      });
    expect(failedDelivery.status, failedDelivery.text).toBe(200);
    const preview = await request(app()).get(`/bolle/${bollaId}/rientro`);
    expect(preview.status, preview.text).toBe(200);
    expect(preview.body.partite).toHaveLength(1);
    const returned = await request(app())
      .post(`/bolle/${bollaId}/rientro`)
      .send({
        idempotencyKey: randomUUID(),
        versione: failedDelivery.body.versione,
        righe: [
          {
            movimentoUscitaId: preview.body.partite[0].movimentoUscitaId,
            idonea: "3",
            deteriorata: "0",
            mancante: "1",
          },
        ],
      });
    expect(returned.status, returned.text).toBe(200);
    const [afterReturn] = await db
      .select({ residuo: lottiTable.quantitaResidua })
      .from(lottiTable)
      .where(eq(lottiTable.id, lotId));
    expect(afterReturn.residuo).toBe("9.00");
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, bollaId));
    expect(
      movements.filter(
        (item) => item.tipoDettaglio === "affidamento_trasporto",
      ),
    ).toHaveLength(1);
    expect(
      movements.filter((item) => item.tipoMovimento === "rientro"),
    ).toHaveLength(1);
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ bollaId, corrente: true });
    const [currentRequest] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    expect(currentRequest.stato).toBe("presa_in_carico");
    const secondDocument = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: currentRequest.versione,
        magazzinoId: originId,
      });
    expect(secondDocument.status).toBe(409);
  });

  it("LEDGER-KG: 3,000 kg fisici e 0,250 kg prenotati lasciano 2,750 kg disponibili", async () => {
    const fractionalProductId = await createProdotto(scope, {
      unitaMisura: "kg",
      quantitaFrazionabile: true,
    });
    const lotId = await createLotto(scope, {
      prodottoId: fractionalProductId,
      magazzinoId: originId,
      quantita: 3,
      dataScadenza: "2098-01-01",
    });
    const row = await fixture("beneficiario");
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const bollaId = created.body.documentoId as number;
    const line = await request(app()).post(`/bolle/${bollaId}/righe`).send({
      idempotencyKey: randomUUID(),
      versione: created.body.versioneDocumento,
      prodottoId: fractionalProductId,
      lottoId: lotId,
      quantita: "0.250",
    });
    expect(line.status, line.text).toBe(201);
    const [draft] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bollaId));
    const ready = await request(app()).post(`/bolle/${bollaId}/conferma`).send({
      idempotencyKey: randomUUID(),
      versione: draft.versione,
    });
    expect(ready.status, ready.text).toBe(200);
    const result = await pool.query(
      `SELECT
        (SELECT quantita_residua::text FROM lotti WHERE id=$1) AS fisica,
        (SELECT coalesce(sum(quantita) FILTER (WHERE stato='attiva'),0)::text
          FROM prenotazioni_magazzino WHERE bolla_id=$2) AS prenotata,
        (SELECT count(*)::integer FROM movimenti WHERE lotto_id=$1) AS movimenti`,
      [lotId, bollaId],
    );
    expect(result.rows[0]).toEqual({
      fisica: "3.000000",
      prenotata: "0.250000",
      movimenti: 0,
    });
    expect(
      Number(result.rows[0].fisica) - Number(result.rows[0].prenotata),
    ).toBe(2.75);
  });

  it("LEDGER-CROSS: Bolla e Trasferimento in gara sull'ultima unità non prenotano due volte", async () => {
    const competingProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: competingProductId,
      magazzinoId: originId,
      quantita: 1,
      dataScadenza: "2098-01-01",
    });
    const bollaRequest = await fixture("beneficiario");
    const transferRequest = await fixture("magazzino");
    const bolla = await request(app())
      .post(`/richieste-magazzino/${bollaRequest.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: bollaRequest.versione,
        magazzinoId: originId,
      });
    expect(bolla.status, bolla.text).toBe(201);
    const line = await request(app())
      .post(`/bolle/${bolla.body.documentoId}/righe`)
      .send({
        idempotencyKey: randomUUID(),
        versione: bolla.body.versioneDocumento,
        prodottoId: competingProductId,
        lottoId: lotId,
        quantita: "1",
      });
    expect(line.status, line.text).toBe(201);
    const [bollaDraft] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, bolla.body.documentoId));
    const transfer = await request(app())
      .post(`/richieste-magazzino/${transferRequest.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: transferRequest.versione,
        magazzinoId: originId,
        righe: [
          {
            prodottoId: competingProductId,
            lottoId: lotId,
            quantita: "1",
            unitaMisura: "pz",
          },
        ],
      });
    expect(transfer.status, transfer.text).toBe(201);

    const blocker = await pool.connect();
    let released = false;
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM lotti WHERE id=$1 FOR UPDATE", [
        lotId,
      ]);
      const bollaPrepare = Promise.resolve(
        request(app()).post(`/bolle/${bolla.body.documentoId}/conferma`).send({
          idempotencyKey: randomUUID(),
          versione: bollaDraft.versione,
        }),
      );
      const transferPrepare = Promise.resolve(
        request(app())
          .post(`/trasferimenti/${transfer.body.documentoId}/prepara`)
          .send({
            idempotencyKey: randomUUID(),
            versione: transfer.body.versioneDocumento,
          }),
      );
      const deadline = Date.now() + 10_000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query(`SELECT count(*)::integer AS count
          FROM pg_stat_activity
          WHERE datname=current_database() AND wait_event_type='Lock'
            AND query ILIKE '%lotti%' AND query ILIKE '%for update%'`);
        waiting = result.rows[0].count;
        if (waiting >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      await blocker.query("COMMIT");
      released = true;
      const results = await Promise.all([bollaPrepare, transferPrepare]);
      expect(
        results.filter((response) => response.status === 200),
      ).toHaveLength(1);
      expect(
        results.filter((response) => [400, 409].includes(response.status)),
      ).toHaveLength(1);
    } finally {
      if (!released) await blocker.query("ROLLBACK");
      blocker.release();
    }
    const inventory = await pool.query(
      `SELECT
        (SELECT quantita_residua::text FROM lotti WHERE id=$1) AS fisica,
        (SELECT coalesce(sum(quantita) FILTER (WHERE stato='attiva'),0)::text
          FROM prenotazioni_magazzino WHERE lotto_id=$1) AS prenotata,
        (SELECT count(*)::integer FROM movimenti WHERE lotto_id=$1) AS movimenti`,
      [lotId],
    );
    expect(inventory.rows[0]).toEqual({
      fisica: "1.000000",
      prenotata: "1.000000",
      movimenti: 0,
    });
  }, 30_000);

  it("RBAC-FULL: sessione reale rivalida grant, territorio e attore prima del comando e replay", async () => {
    const [originalUser] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, operatorId));
    const [originalRole] = await db
      .select()
      .from(ruoliTable)
      .where(eq(ruoliTable.id, originalUser.ruoloId!));
    const password = `M5B-${randomUUID()}-test-only`;
    await db
      .update(utentiTable)
      .set({
        passwordHash: await bcrypt.hash(password, 4),
        mustChangePassword: false,
      })
      .where(eq(utentiTable.id, operatorId));
    try {
      const fullApp = (await import("../src/app")).default;
      const agent = request.agent(fullApp);
      const login = await agent
        .post("/api/auth/login")
        .send({ username: originalUser.username, password });
      expect(login.status, login.text).toBe(200);
      const row = await fixture("beneficiario");
      const payload = {
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      };
      expect(
        (await agent.get(`/api/richieste-magazzino/${row.id}`)).status,
      ).toBe(200);
      await db
        .update(ruoliTable)
        .set({
          permessi: grants.filter(
            (grant) => grant !== "richieste_magazzino.prepare",
          ),
        })
        .where(eq(ruoliTable.id, originalRole.id));
      const deniedPrepare = await agent
        .post(`/api/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(deniedPrepare.status).toBe(403);
      expect(
        await db
          .select()
          .from(richiesteMagazzinoDocumentiTable)
          .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id)),
      ).toHaveLength(0);
      await db
        .update(ruoliTable)
        .set({ permessi: grants })
        .where(eq(ruoliTable.id, originalRole.id));
      const created = await agent
        .post(`/api/richieste-magazzino/${row.id}/documento`)
        .send(payload);
      expect(created.status, created.text).toBe(201);
      const cancellation = {
        idempotencyKey: randomUUID(),
        versione: created.body.versioneDocumento,
        motivo: "M5B revoca replay",
      };
      const cancelled = await agent
        .post(`/api/bolle/${created.body.documentoId}/annulla`)
        .send(cancellation);
      expect(cancelled.status, cancelled.text).toBe(200);
      await db
        .update(ruoliTable)
        .set({ permessi: grants.filter((grant) => grant !== "bolle.cancel") })
        .where(eq(ruoliTable.id, originalRole.id));
      const deniedReplay = await agent
        .post(`/api/bolle/${created.body.documentoId}/annulla`)
        .send(cancellation);
      expect(deniedReplay.status).toBe(403);
      await db
        .update(ruoliTable)
        .set({ permessi: grants })
        .where(eq(ruoliTable.id, originalRole.id));
      await db
        .update(utentiTable)
        .set({ areaOperativaId: null, centroAscoltoId: null })
        .where(eq(utentiTable.id, operatorId));
      const outOfScope = await agent.get(`/api/richieste-magazzino/${row.id}`);
      const unassignedRequest = await fixture("beneficiario");
      const unassignedCommand = await agent
        .post(`/api/richieste-magazzino/${unassignedRequest.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: unassignedRequest.versione,
          magazzinoId: originId,
        });
      expect.soft([403, 404]).toContain(outOfScope.status);
      expect.soft([403, 404]).toContain(unassignedCommand.status);
      await db
        .update(utentiTable)
        .set({
          areaOperativaId: areaId,
          centroAscoltoId: centreId,
          attivo: false,
        })
        .where(eq(utentiTable.id, operatorId));
      const disabled = await agent.get("/api/auth/me");
      expect([401, 403]).toContain(disabled.status);
    } finally {
      await db
        .update(ruoliTable)
        .set({ permessi: originalRole.permessi })
        .where(eq(ruoliTable.id, originalRole.id));
      await db
        .update(utentiTable)
        .set({
          passwordHash: originalUser.passwordHash,
          mustChangePassword: originalUser.mustChangePassword,
          areaOperativaId: originalUser.areaOperativaId,
          centroAscoltoId: originalUser.centroAscoltoId,
          attivo: originalUser.attivo,
        })
        .where(eq(utentiTable.id, operatorId));
    }
  }, 30_000);

  it("minimizza il riepilogo al lettore e non gli consente la preparazione", async () => {
    const row = await fixture("beneficiario");
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originId,
      });
    expect(created.status).toBe(201);
    const readerApp = app(["richieste_magazzino.view"]);
    const summary = await request(readerApp).get(
      `/richieste-magazzino/${row.id}/documenti`,
    );
    expect(summary.status).toBe(200);
    expect(summary.body.corrente).toMatchObject({
      codice: created.body.codiceDocumento,
      percorsoDocumento: null,
    });
    const denied = await request(readerApp)
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 2,
        magazzinoId: originId,
      });
    expect(denied.status).toBe(403);
  });

  it("richiede righe reali per Trasferimento e non scrive stock alla creazione", async () => {
    const row = await fixture("magazzino");
    const before = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM movimenti) AS movimenti,
      (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni`);
    const empty = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originId,
      });
    expect(empty.status).toBe(400);
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originId,
        righe: [{ prodottoId: productId, quantita: "5", unitaMisura: "pz" }],
      });
    expect(created.status).toBe(201);
    expect(created.body.tipoDocumento).toBe("trasferimento");
    const rows = await db
      .select()
      .from(trasferimentoRigheTable)
      .where(
        eq(trasferimentoRigheTable.trasferimentoId, created.body.documentoId),
      );
    expect(rows).toHaveLength(1);
    const storedQuantity = await db.execute(sql`
      SELECT quantita::text AS quantita
      FROM trasferimento_righe WHERE id = ${rows[0].id}
    `);
    expect(storedQuantity.rows[0].quantita).toBe("5.000000");
    const after = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM movimenti) AS movimenti,
      (SELECT count(*)::integer FROM prenotazioni_magazzino) AS prenotazioni`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it("CAN-REPLAY-TR: K1 su T1 annullato non cessa T2 pronto né rilascia le sue riserve", async () => {
    const transferProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: transferProductId,
      magazzinoId: originId,
      quantita: 5,
      dataScadenza: "2098-01-01",
    });
    const row = await fixture("magazzino");
    const create = (versione: number) =>
      request(app())
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione,
          magazzinoId: originId,
          righe: [
            {
              prodottoId: transferProductId,
              lottoId: lotId,
              quantita: "3",
              unitaMisura: "pz",
            },
          ],
        });
    const first = await create(row.versione);
    expect(first.status, first.text).toBe(201);
    const readyFirst = await request(app())
      .post(`/trasferimenti/${first.body.documentoId}/prepara`)
      .send({
        idempotencyKey: randomUUID(),
        versione: first.body.versioneDocumento,
      });
    expect(readyFirst.status, readyFirst.text).toBe(200);
    const k1 = {
      idempotencyKey: randomUUID(),
      versione: readyFirst.body.versione,
      motivo: "TEST-M5B sostituzione trasferimento",
    };
    const cancelled = await request(app())
      .post(`/trasferimenti/${first.body.documentoId}/annulla`)
      .send(k1);
    expect(cancelled.status, cancelled.text).toBe(200);
    const [afterCancel] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    const second = await create(afterCancel.versione);
    expect(second.status, second.text).toBe(201);
    const readySecond = await request(app())
      .post(`/trasferimenti/${second.body.documentoId}/prepara`)
      .send({
        idempotencyKey: randomUUID(),
        versione: second.body.versioneDocumento,
      });
    expect(readySecond.status, readySecond.text).toBe(200);
    const beforeReplay = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM audit_eventi) AS audit,
      (SELECT count(*)::integer FROM comandi_operativi) AS ricevute,
      (SELECT count(*)::integer FROM richieste_magazzino_documenti WHERE richiesta_id = ${row.id} AND corrente) AS correnti`);
    const replay = await request(app())
      .post(`/trasferimenti/${first.body.documentoId}/annulla`)
      .send(k1);
    expect(replay.status, replay.text).toBe(200);
    const afterReplay = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM audit_eventi) AS audit,
      (SELECT count(*)::integer FROM comandi_operativi) AS ricevute,
      (SELECT count(*)::integer FROM richieste_magazzino_documenti WHERE richiesta_id = ${row.id} AND corrente) AS correnti`);
    expect(afterReplay.rows[0]).toEqual(beforeReplay.rows[0]);
    expect(afterReplay.rows[0].correnti).toBe(1);
    const [current] = await db
      .select()
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, second.body.documentoId));
    expect(current.stato).toBe("preparato");
    expect(
      (
        await db
          .select()
          .from(prenotazioniMagazzinoTable)
          .where(eq(prenotazioniMagazzinoTable.trasferimentoId, current.id))
      )
        .filter((reservation) => reservation.stato === "attiva")
        .map((reservation) => Number(reservation.quantita)),
    ).toEqual([3]);
    const mismatch = await request(app())
      .post(`/trasferimenti/${first.body.documentoId}/annulla`)
      .send({ ...k1, motivo: "TEST-M5B intenzione diversa" });
    expect(mismatch.status).toBe(409);
  });

  it("LEDGER-M5B-TRANSFER: riserva, spedizione e ricezione collegate contabilizzano una volta", async () => {
    const transferProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: transferProductId,
      magazzinoId: originId,
      quantita: 5,
      dataScadenza: "2098-01-01",
    });
    const row = await fixture("magazzino");
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
        righe: [
          {
            prodottoId: transferProductId,
            lottoId: lotId,
            quantita: "3",
            unitaMisura: "pz",
          },
        ],
      });
    expect(created.status, created.text).toBe(201);
    const transferId = created.body.documentoId as number;
    const physical = async () => {
      const result = await db.execute(sql`
        SELECT
          (SELECT quantita_residua::text FROM lotti WHERE id = ${lotId}) AS origine,
          (SELECT coalesce(sum(quantita_residua), 0)::text FROM lotti
            WHERE prodotto_id = ${transferProductId}
              AND magazzino_id = ${destinationId}) AS destinazione,
          (SELECT coalesce(sum(quantita) FILTER (WHERE stato = 'attiva'), 0)::text
            FROM prenotazioni_magazzino
            WHERE trasferimento_id = ${transferId}) AS prenotata
      `);
      const item = result.rows[0];
      return [item.origine, item.destinazione, item.prenotata].map(Number);
    };
    expect(await physical()).toEqual([5, 0, 0]);
    const ready = await request(app())
      .post(`/trasferimenti/${transferId}/prepara`)
      .send({
        idempotencyKey: randomUUID(),
        versione: created.body.versioneDocumento,
      });
    expect(ready.status, ready.text).toBe(200);
    expect(await physical()).toEqual([5, 0, 3]);
    const dispatched = await request(app())
      .post(`/trasferimenti/${transferId}/avvia`)
      .send({ idempotencyKey: randomUUID(), versione: ready.body.versione });
    expect(dispatched.status, dispatched.text).toBe(200);
    expect(dispatched.body.stato).toBe("in_transito");
    expect(await physical()).toEqual([2, 0, 0]);
    const receiptCommand = {
      idempotencyKey: randomUUID(),
      versione: dispatched.body.versione,
    };
    const received = await request(app())
      .post(`/trasferimenti/${transferId}/conferma`)
      .send(receiptCommand);
    expect(received.status, received.text).toBe(200);
    expect(await physical()).toEqual([2, 3, 0]);
    const replay = await request(app())
      .post(`/trasferimenti/${transferId}/conferma`)
      .send(receiptCommand);
    expect(replay.status, replay.text).toBe(200);
    expect(await physical()).toEqual([2, 3, 0]);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.trasferimentoId, transferId));
    expect(
      movements.filter((item) => item.tipoDettaglio === "uscita"),
    ).toHaveLength(1);
    expect(
      movements.filter((item) => item.tipoDettaglio === "entrata"),
    ).toHaveLength(1);
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      trasferimentoId: transferId,
      corrente: true,
    });
  });

  it("serializza due chiavi concorrenti e conserva un solo collegamento corrente", async () => {
    const row = await fixture("beneficiario");
    const [actor] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, operatorId));
    const secondOperatorId = await createUtente(scope, {
      ruoloId: actor.ruoloId!,
      centroId: centreId,
    });
    await db
      .update(utentiTable)
      .set({ areaOperativaId: areaId })
      .where(eq(utentiTable.id, secondOperatorId));
    const calls = await Promise.all([
      request(app()).post(`/richieste-magazzino/${row.id}/documento`).send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originId,
      }),
      request(app(grants, secondOperatorId))
        .post(`/richieste-magazzino/${row.id}/documento`)
        .send({
          idempotencyKey: randomUUID(),
          versione: 1,
          magazzinoId: originId,
        }),
    ]);
    expect(calls.map((item) => item.status).sort()).toEqual([201, 409]);
    const links = await db
      .select()
      .from(richiesteMagazzinoDocumentiTable)
      .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id));
    expect(links.filter((item) => item.corrente)).toHaveLength(1);
  });

  it("non permette di riusare la chiave con input differente né cambiare l'identità dal PATCH Bolla", async () => {
    const row = await fixture("beneficiario");
    const idempotencyKey = randomUUID();
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({ idempotencyKey, versione: 1, magazzinoId: originId });
    expect(created.status).toBe(201);
    const mismatch = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({ idempotencyKey, versione: 1, magazzinoId: destinationId });
    expect(mismatch.status).toBe(409);
    const secondBeneficiary = await createBeneficiario(scope, centreId, {
      areaOperativaId: areaId,
    });
    const changed = await request(app())
      .patch(`/bolle/${created.body.documentoId}`)
      .send({
        idempotencyKey: randomUUID(),
        versione: created.body.versioneDocumento,
        beneficiarioId: secondBeneficiary,
      });
    expect(changed.status).toBe(409);
    const [unchanged] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, created.body.documentoId));
    expect(unchanged.beneficiarioId).toBe(beneficiaryId);
  });

  it("nega a un titolare di soli grant Bolle legacy la composizione del documento collegato", async () => {
    const row = await fixture("beneficiario");
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: 1,
        magazzinoId: originId,
      });
    expect(created.status).toBe(201);
    const legacyGrants = [
      "bolle.view",
      "bolle.manage",
      "richieste_magazzino.view",
    ];
    const [role] = await db
      .insert(ruoliTable)
      .values({
        nome: `M5B legacy ${randomUUID().slice(0, 8)}`,
        aree: ["sociale"],
        permessi: legacyGrants,
      })
      .returning({ id: ruoliTable.id });
    const legacyUser = await createUtente(scope, {
      ruoloId: role.id,
      centroId: centreId,
    });
    await db
      .update(utentiTable)
      .set({ areaOperativaId: areaId })
      .where(eq(utentiTable.id, legacyUser));
    const denied = await request(app(legacyGrants, legacyUser))
      .patch(`/bolle/${created.body.documentoId}`)
      .send({
        idempotencyKey: randomUUID(),
        versione: created.body.versioneDocumento,
        noteConsegna: "Non autorizzato",
      });
    expect(denied.status).toBe(403);
  });

  it("LEG-M5B: la delega permanente blocca lo scarico legacy anche dopo annullamento", async () => {
    const intervention = await interventionFixture();
    const row = await fixture("beneficiario", intervention.id);
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const [delegation] = await db
      .select()
      .from(interventiDelegheM4Table)
      .where(eq(interventiDelegheM4Table.interventoId, intervention.id));
    expect(delegation.primaRichiestaId).toBe(row.id);

    const attempt = async () => {
      const [current] = await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, intervention.id));
      return request(socialApp(true))
        .post(`/interventi/${intervention.id}/salva-operativita`)
        .send({
          versione: current.dataAggiornamento?.toISOString() ?? null,
          materiali: [
            {
              prodottoId: productId,
              quantitaPrevista: 1,
              quantitaConsegnata: 1,
              statoPreparazione: "consegnato",
              magazzinoId: originId,
            },
          ],
        });
    };
    const denied = await attempt();
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error).toMatch(/affidati al documento M4/i);
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, intervention.id)),
    ).toHaveLength(0);

    const [current] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    const freeMaterial = await request(socialApp())
      .post(`/interventi/${intervention.id}/salva-operativita`)
      .send({
        versione: current.dataAggiornamento?.toISOString() ?? null,
        materiali: [
          {
            descrizioneSnapshot: "Coperta non inventariata",
            unitaMisuraSnapshot: "pz",
            quantitaPrevista: 0,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
          },
        ],
      });
    expect(freeMaterial.status, freeMaterial.text).toBe(200);
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, intervention.id)),
    ).toMatchObject([{ prodottoId: null, quantitaConsegnata: "1.00" }]);

    const cancelled = await request(app())
      .post(`/bolle/${created.body.documentoId}/annulla`)
      .send({
        idempotencyKey: randomUUID(),
        versione: created.body.versioneDocumento,
        motivo: "Prova delega",
      });
    expect(cancelled.status, cancelled.text).toBe(200);
    const [afterDocument] = await db
      .select()
      .from(richiesteMagazzinoTable)
      .where(eq(richiesteMagazzinoTable.id, row.id));
    const cancelledRequest = await request(app())
      .post(`/richieste-magazzino/${row.id}/annulla`)
      .send({
        idempotencyKey: randomUUID(),
        versione: afterDocument.versione,
        motivo: "Prova delega",
      });
    expect(cancelledRequest.status, cancelledRequest.text).toBe(200);
    const laterRequest = await fixture("beneficiario", intervention.id);
    expect(laterRequest.id).not.toBe(row.id);
    const deniedAgain = await attempt();
    expect(deniedAgain.status, deniedAgain.text).toBe(409);
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(eq(interventiDelegheM4Table.interventoId, intervention.id)),
    ).toHaveLength(1);
  });

  it("LEG-CONCLUDI: il payload materiale è negato ma la conclusione sociale resta possibile", async () => {
    const intervention = await interventionFixture();
    await db
      .update(interventiTable)
      .set({ dataOraAvvio: new Date(Date.now() - 60_000) })
      .where(eq(interventiTable.id, intervention.id));
    const row = await fixture("beneficiario", intervention.id);
    const created = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(created.status, created.text).toBe(201);
    const [current] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    const before = await db.execute(sql`SELECT
      (SELECT count(*)::integer FROM movimenti) AS movimenti,
      (SELECT count(*)::integer FROM operazioni_distribuzione_magazzino) AS distribuzioni`);
    const denied = await request(socialApp(true))
      .post(`/interventi/${intervention.id}/concludi`)
      .send({
        versione: current.dataAggiornamento?.toISOString() ?? null,
        conferma: true,
        risultato: "TEST-M5B colloquio concluso",
        materiali: [
          {
            prodottoId: productId,
            quantitaPrevista: 1,
            quantitaConsegnata: 1,
            statoPreparazione: "consegnato",
            magazzinoId: originId,
          },
        ],
      });
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error).toMatch(/affidati al documento M4/i);
    expect(
      await db.execute(sql`SELECT
        (SELECT count(*)::integer FROM movimenti) AS movimenti,
        (SELECT count(*)::integer FROM operazioni_distribuzione_magazzino) AS distribuzioni`),
    ).toMatchObject({ rows: [before.rows[0]] });
    const [afterDenied] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(afterDenied.stato).toBe("in_corso");
    const socialOnly = await request(socialApp())
      .post(`/interventi/${intervention.id}/concludi`)
      .send({
        versione: afterDenied.dataAggiornamento?.toISOString() ?? null,
        conferma: true,
        risultato: "TEST-M5B colloquio concluso",
      });
    expect(socialOnly.status, socialOnly.text).toBe(200);
    const [finished] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(finished.stato).toBe("concluso");
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, intervention.id)),
    ).toHaveLength(0);
  });

  it("LEG-UDS: un Intervento UDS non delegato resta concludibile senza effetti M5B", async () => {
    const zone = await createZona(scope, areaId);
    const udsBeneficiaryId = await createBeneficiario(scope, centreId, {
      uds: true,
      areaOperativaId: areaId,
      zonaUdsId: zone.id,
    });
    const [intervention] = await db
      .insert(interventiTable)
      .values({
        beneficiarioId: udsBeneficiaryId,
        tipoIntervento: `M5B UDS ${randomUUID().slice(0, 8)}`,
        ambito: "uds",
        stato: "in_corso",
        dataOraAvvio: new Date(Date.now() - 60_000),
        areaOperativaIdSnapshot: areaId,
        zonaUdsIdSnapshot: zone.id,
        centroAscoltoIdSnapshot: centreId,
        operatoreId: operatorId,
      })
      .returning();
    scope.interventoIds.push(intervention.id);
    const before = await pool.query(
      `SELECT (SELECT count(*)::integer FROM movimenti) AS movimenti,
        (SELECT count(*)::integer FROM interventi_deleghe_m4) AS deleghe`,
    );
    const udsApp = makeScopedApp(interventiRouter, {
      id: operatorId,
      username: `m5b-uds-${suffix}`,
      areaOperativaId: areaId,
      centroAscoltoId: centreId,
      zonaUdsId: zone.id,
      aree: ["uds"],
      permessi: ["uds.interventi.view", "uds.interventi.update"],
    });
    const finished = await request(udsApp)
      .post(`/interventi/${intervention.id}/concludi`)
      .send({
        versione: intervention.dataAggiornamento?.toISOString() ?? null,
        conferma: true,
        risultato: "M5B UDS colloquio non inventariale",
      });
    expect(finished.status, finished.text).toBe(200);
    const [completed] = await db
      .select({ stato: interventiTable.stato })
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(completed.stato).toBe("concluso");
    expect(
      await pool.query(
        `SELECT (SELECT count(*)::integer FROM movimenti) AS movimenti,
          (SELECT count(*)::integer FROM interventi_deleghe_m4) AS deleghe`,
      ),
    ).toMatchObject({ rows: [before.rows[0]] });
  });

  it("LEG-LEDGER: erogazione pregressa nel ledger senza riga materiale impedisce la delega", async () => {
    const intervention = await interventionFixture();
    const row = await fixture("beneficiario", intervention.id);
    const lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    await db
      .update(lottiTable)
      .set({ quantitaResidua: "9" })
      .where(eq(lottiTable.id, lotId));
    const [operation] = await db
      .insert(operazioniDistribuzioneMagazzinoTable)
      .values({
        magazzinoId: originId,
        dataDistribuzione: "2026-09-28",
        canaleOperativo: "sociale",
        dominioOrigine: "SOCIALE",
        entitaOrigineTipo: `intervento_materiali_${originId}`,
        entitaOrigineId: intervention.id,
        creatoDa: operatorId,
      })
      .returning();
    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "uscita",
      dataMovimento: "2026-09-28",
      magazzinoId: originId,
      prodottoId: productId,
      lottoId: lotId,
      quantita: "1",
      unitaMisura: "pz",
      dominioOrigine: "SOCIALE",
      entitaOrigineTipo: `intervento_materiali_${originId}`,
      entitaOrigineId: intervention.id,
      operazioneDistribuzioneId: operation.id,
      operatoreId: operatorId,
    });
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, intervention.id)),
    ).toHaveLength(0);
    const denied = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error).toMatch(/già materiale inventariale erogato/i);
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(eq(interventiDelegheM4Table.interventoId, intervention.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(richiesteMagazzinoDocumentiTable)
        .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id)),
    ).toHaveLength(0);
  });

  it("LEG-STORNO: il ledger storico a saldo netto zero impedisce una seconda delega", async () => {
    const intervention = await interventionFixture();
    const row = await fixture("beneficiario", intervention.id);
    const historicProductId = await createProdotto(scope, {
      unitaMisura: "pz",
      quantitaFrazionabile: false,
    });
    const lotId = await createLotto(scope, {
      prodottoId: historicProductId,
      magazzinoId: originId,
      quantita: 10,
      dataScadenza: "2098-01-01",
    });
    const origin = {
      dataMovimento: "2026-09-28",
      magazzinoId: originId,
      prodottoId: historicProductId,
      lottoId: lotId,
      quantita: "1",
      unitaMisura: "pz",
      dominioOrigine: "SOCIALE",
      entitaOrigineTipo: `intervento_materiali_${originId}`,
      entitaOrigineId: intervention.id,
      operatoreId: operatorId,
    };
    const [outgoing] = await db
      .insert(movimentiTable)
      .values({ ...origin, tipoMovimento: "scarico", tipoDettaglio: "uscita" })
      .returning({ id: movimentiTable.id });
    await db.insert(movimentiTable).values({
      ...origin,
      tipoMovimento: "storno",
      tipoDettaglio: "storno_legacy",
      naturaContabile: "STORNO",
      movimentoOrigineId: outgoing.id,
    });
    const net = await db.execute(sql`
      SELECT coalesce(sum(CASE WHEN tipo_movimento = 'scarico'
        THEN -quantita ELSE quantita END), 0)::text AS net
      FROM movimenti
      WHERE dominio_origine = 'SOCIALE'
        AND entita_origine_id = ${intervention.id}
        AND entita_origine_tipo = ${origin.entitaOrigineTipo}
    `);
    expect(Number(net.rows[0].net)).toBe(0);
    expect(
      await db
        .select()
        .from(interventiMaterialiTable)
        .where(eq(interventiMaterialiTable.interventoId, intervention.id)),
    ).toHaveLength(0);
    const denied = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(denied.status, denied.text).toBe(409);
    expect(denied.body.error).toMatch(/già materiale inventariale erogato/i);
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(eq(interventiDelegheM4Table.interventoId, intervention.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(richiesteMagazzinoDocumentiTable)
        .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id)),
    ).toHaveLength(0);
  });

  it("LEG-BOLLA: un Intervento già generato da Bolla non è delegato una seconda volta", async () => {
    const intervention = await interventionFixture();
    const oldBollaId = await insertBolla(scope, {
      beneficiarioId: beneficiaryId,
      magazzinoId: originId,
    });
    await db
      .update(interventiTable)
      .set({ bollaId: oldBollaId })
      .where(eq(interventiTable.id, intervention.id));
    const row = await fixture("beneficiario", intervention.id);
    const denied = await request(app())
      .post(`/richieste-magazzino/${row.id}/documento`)
      .send({
        idempotencyKey: randomUUID(),
        versione: row.versione,
        magazzinoId: originId,
      });
    expect(denied.status, denied.text).toBe(409);
    const [after] = await db
      .select()
      .from(interventiTable)
      .where(eq(interventiTable.id, intervention.id));
    expect(after.bollaId).toBe(oldBollaId);
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(eq(interventiDelegheM4Table.interventoId, intervention.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(richiesteMagazzinoDocumentiTable)
        .where(eq(richiesteMagazzinoDocumentiTable.richiestaId, row.id)),
    ).toHaveLength(0);
  });

  it("LEG-RACE: legacy prima, delega prima e rollback sono serializzati dal lock osservabile", async () => {
    const legacyIncrease = async (interventionId: number) => {
      const [current] = await db
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, interventionId));
      return request(socialApp(true))
        .post(`/interventi/${interventionId}/salva-operativita`)
        .send({
          versione: current.dataAggiornamento?.toISOString() ?? null,
          materiali: [
            {
              prodottoId: productId,
              quantitaPrevista: 1,
              quantitaConsegnata: 1,
              statoPreparazione: "consegnato",
              magazzinoId: originId,
            },
          ],
        });
    };
    const setup = async () => {
      const intervention = await interventionFixture();
      const row = await fixture("beneficiario", intervention.id);
      await createLotto(scope, {
        prodottoId: productId,
        magazzinoId: originId,
        quantita: 10,
        dataScadenza: "2098-01-01",
      });
      const document = () =>
        request(app()).post(`/richieste-magazzino/${row.id}/documento`).send({
          idempotencyKey: randomUUID(),
          versione: row.versione,
          magazzinoId: originId,
        });
      return { intervention, row, document };
    };

    const first = await setup();
    await withBlockedIntervention(first.intervention.id, async (release) => {
      const legacy = legacyIncrease(first.intervention.id);
      await waitForAdvisoryWaiters(1);
      const document = Promise.resolve(first.document());
      await waitForAdvisoryWaiters(2);
      await release();
      const [legacyResult, documentResult] = await Promise.all([
        legacy,
        document,
      ]);
      expect(legacyResult.status, legacyResult.text).toBe(200);
      expect(documentResult.status, documentResult.text).toBe(409);
    });
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(
          eq(interventiDelegheM4Table.interventoId, first.intervention.id),
        ),
    ).toHaveLength(0);

    const second = await setup();
    await withBlockedIntervention(second.intervention.id, async (release) => {
      const document = Promise.resolve(second.document());
      await waitForAdvisoryWaiters(1);
      const legacy = legacyIncrease(second.intervention.id);
      await waitForAdvisoryWaiters(2);
      await release();
      const [documentResult, legacyResult] = await Promise.all([
        document,
        legacy,
      ]);
      expect(documentResult.status, documentResult.text).toBe(201);
      expect(legacyResult.status, legacyResult.text).toBe(409);
    });
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(
          eq(interventiDelegheM4Table.interventoId, second.intervention.id),
        ),
    ).toHaveLength(1);

    const third = await setup();
    await withBlockedIntervention(third.intervention.id, async (release) => {
      const rolledBack = db
        .transaction(async (tx) => {
          await lockInterventionMaterialPath(tx, third.intervention.id);
          await tx.insert(interventiDelegheM4Table).values({
            interventoId: third.intervention.id,
            primaRichiestaId: third.row.id,
            delegatoDa: operatorId,
          });
          throw new Error("ROLLBACK-R1");
        })
        .then(
          () => "committed",
          (error) => (error as Error).message,
        );
      await waitForAdvisoryWaiters(1);
      const legacy = legacyIncrease(third.intervention.id);
      await waitForAdvisoryWaiters(2);
      await release();
      expect(await rolledBack).toBe("ROLLBACK-R1");
      const legacyResult = await legacy;
      expect(legacyResult.status, legacyResult.text).toBe(200);
    });
    expect(
      await db
        .select()
        .from(interventiDelegheM4Table)
        .where(
          eq(interventiDelegheM4Table.interventoId, third.intervention.id),
        ),
    ).toHaveLength(0);
  }, 20_000);
});
