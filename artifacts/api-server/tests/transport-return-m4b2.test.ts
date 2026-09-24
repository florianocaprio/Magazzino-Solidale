import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  bolleTable,
  lottiTable,
  movimentiTable,
  prenotazioniMagazzinoTable,
  rientriTrasportoTable,
  rientroTrasportoRigheTable,
  scarichiTable,
  trasferimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  entiDestinatariTable,
  ruoliTable,
  utentiTable,
} from "@workspace/db";
import bolleRouter from "../src/routes/bolle";
import consegneRouter from "../src/routes/consegne";
import trasferimentiRouter from "../src/routes/trasferimenti";
import {
  cleanup,
  createAreaOperativa,
  createBeneficiario,
  createCentro,
  createCentroRec,
  createLotto,
  createMagazzino,
  createProdotto,
  createUtente,
  createVolontario,
  insertBolla,
  insertBollaRiga,
  insertConsegna,
  insertTrasferimento,
  makeScopedApp,
  newScope,
  type SeedScope,
} from "./scope-helpers";
import { movementPhysicalEffect } from "../src/lib/movementPhysicalEffect";
import { signedPhysicalMovementSql } from "../src/lib/movementPhysicalEffect";
import { buildLogisticaReport } from "../src/lib/reporting/logistica";
import { buildFsePlusReport } from "../src/lib/reporting/fsePlus";
import type { ReportFilters } from "../src/lib/reporting/types";
import { buildFseCanonicalReport } from "../src/lib/fseCanonicalReporting";

let scope: SeedScope;
let actorId: number;
let centreId: number;
let warehouseId: number;
let beneficiaryId: number;
let productId: number;
let lotId: number;

const key = () => `m4b2-${randomUUID()}`;
const bollaApp = () =>
  makeScopedApp(bolleRouter, { id: actorId, centroAscoltoId: centreId });
const transferApp = () =>
  makeScopedApp(trasferimentiRouter, {
    id: actorId,
    centroAscoltoId: centreId,
  });
const lotAmount = async (id = lotId) => {
  const [lot] = await db.select().from(lottiTable).where(eq(lottiTable.id, id));
  return Number(lot.quantitaResidua);
};
const bollaVersion = async (id: number) => {
  const [row] = await db
    .select({ versione: bolleTable.versione })
    .from(bolleTable)
    .where(eq(bolleTable.id, id));
  return row.versione;
};
const command = (versione: number, extra: Record<string, unknown> = {}) => ({
  idempotencyKey: key(),
  versione,
  ...extra,
});
async function waitForBlockedBackend(blockerPid: number) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM pg_stat_activity
       WHERE $1 = ANY(pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (Number(result.rows[0]?.count ?? 0) > 0) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Il comando non ha raggiunto il lock PostgreSQL osservabile");
}
async function raceOnBolla(
  id: number,
  firstCommand: () => Promise<request.Response>,
  secondCommand: () => Promise<request.Response>,
) {
  const blocker = await pool.connect();
  let first: Promise<request.Response> | null = null;
  let second: Promise<request.Response> | null = null;
  try {
    await blocker.query("BEGIN");
    const pid = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    await blocker.query("SELECT id FROM bolle WHERE id = $1 FOR UPDATE", [id]);
    first = firstCommand();
    await waitForBlockedBackend(pid.rows[0].pid);
    second = secondCommand();
    await blocker.query("COMMIT");
    return await Promise.all([first, second]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await Promise.allSettled(
      [first, second].filter(
        (promise): promise is Promise<request.Response> => promise != null,
      ),
    );
  }
}
async function raceOnTransfer(
  id: number,
  firstCommand: () => Promise<request.Response>,
  secondCommand: () => Promise<request.Response>,
) {
  const blocker = await pool.connect();
  let first: Promise<request.Response> | null = null;
  let second: Promise<request.Response> | null = null;
  try {
    await blocker.query("BEGIN");
    const pid = await blocker.query<{ pid: number }>(
      "SELECT pg_backend_pid() AS pid",
    );
    await blocker.query(
      "SELECT id FROM trasferimenti WHERE id = $1 FOR UPDATE",
      [id],
    );
    first = firstCommand();
    await waitForBlockedBackend(pid.rows[0].pid);
    second = secondCommand();
    await blocker.query("COMMIT");
    return await Promise.all([first, second]);
  } finally {
    await blocker.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    await Promise.allSettled(
      [first, second].filter(
        (promise): promise is Promise<request.Response> => promise != null,
      ),
    );
  }
}
const physicalSign = signedPhysicalMovementSql(
  sql`mv.quantita`,
  sql`mv.tipo_movimento`,
  sql`mv.tipo_dettaglio`,
  sql`original.tipo_movimento`,
  sql`original.tipo_dettaglio`,
);
async function physicalDeltaForWarehouse(id: number) {
  const result =
    await db.execute(sql`SELECT COALESCE(SUM(${physicalSign}), 0)::text AS quantity
    FROM movimenti mv LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    WHERE mv.magazzino_id = ${id}`);
  return Number(result.rows[0].quantity);
}
const reportingFilters: ReportFilters = {
  da: "2026-01-01",
  a: "2026-12-31",
  anno: 2026,
  areaOperativaId: null,
  centroAscoltoId: null,
  magazzinoId: null,
  mensaId: null,
  zonaUdsId: null,
  operatoreId: null,
  tipoIntervento: null,
  tipoServizio: null,
  areaOperativaMode: "all",
  centroMode: "all",
  zonaMode: "all",
  callerAreas: ["sociale", "emporio", "mensa", "uds", "magazzino", "logistica"],
  callerPermissions: ["mensa.reports.view"],
  callerIsAdmin: true,
};
const kpiValue = (
  report: { kpi: Array<{ key: string; value: number | null }> },
  key: string,
) => {
  const value = report.kpi.find((row) => row.key === key)?.value;
  expect(value, `KPI ${key} non disponibile`).not.toBeNull();
  expect(value, `KPI ${key} non presente`).not.toBeUndefined();
  return value!;
};

async function readyBolla(quantity: number, unitaMisura = "pz") {
  const id = await insertBolla(scope, {
    beneficiarioId: beneficiaryId,
    magazzinoId: warehouseId,
  });
  await insertBollaRiga(scope, {
    bollaId: id,
    prodottoId: productId,
    lottoId: lotId,
    quantita: quantity,
    unitaMisura,
  });
  const response = await request(bollaApp())
    .post(`/bolle/${id}/conferma`)
    .send(command(await bollaVersion(id)));
  expect(response.status, response.text).toBe(200);
  return id;
}

async function entrustedBolla(quantity: number) {
  const id = await readyBolla(quantity);
  const response = await request(bollaApp())
    .post(`/bolle/${id}/affida`)
    .send(
      command(await bollaVersion(id), {
        trasportatoreNome: "Trasportatore senza account",
      }),
    );
  expect(response.status, response.text).toBe(200);
  expect(response.body.stato).toBe("in_trasporto");
  return id;
}

async function missingDelivery(id: number) {
  const response = await request(bollaApp())
    .post(`/bolle/${id}/mancata-consegna`)
    .send(command(await bollaVersion(id), { motivo: "Beneficiario assente" }));
  expect(response.status, response.text).toBe(200);
  return response;
}
async function startedTransfer(quantity: number) {
  const destinationId = await createMagazzino(scope, centreId);
  const created = await request(transferApp())
    .post("/trasferimenti")
    .send({
      idempotencyKey: key(),
      magazzinoOrigineId: warehouseId,
      magazzinoDestinoId: destinationId,
      dataRichiesta: "2026-09-24",
      trasportatoreNome: "Trasportatore",
      righe: [{ prodottoId: productId, quantita: quantity }],
    });
  expect(created.status, created.text).toBe(201);
  scope.trasferimentoIds.push(created.body.id);
  const id = created.body.id;
  const prepared = await request(transferApp())
    .post(`/trasferimenti/${id}/prepara`)
    .send(command(created.body.versione));
  expect(prepared.status, prepared.text).toBe(200);
  const started = await request(transferApp())
    .post(`/trasferimenti/${id}/avvia`)
    .send(command(prepared.body.versione));
  expect(started.status, started.text).toBe(200);
  return { id, destinationId, version: started.body.versione };
}

beforeEach(async () => {
  scope = newScope();
  centreId = await createCentro(scope);
  actorId = await createUtente(scope, { centroId: centreId });
  warehouseId = await createMagazzino(scope, centreId);
  beneficiaryId = await createBeneficiario(scope, centreId);
  productId = await createProdotto(scope, { unitaMisura: "pz" });
  lotId = await createLotto(scope, {
    prodottoId: productId,
    magazzinoId: warehouseId,
    quantita: 100,
  });
});
afterEach(async () => {
  await cleanup(scope);
});
afterAll(async () => {
  await pool.end();
});

describe("CR-M4-01 — incaricato esclusivo in Affida", () => {
  it("CR-M4-01-A: usa il volontario assegnato senza nome esterno né distribuzione", async () => {
    const volontarioId = await createVolontario(scope, centreId);
    const id = await readyBolla(2);
    await db
      .update(bolleTable)
      .set({ volontarioConsegnaId: volontarioId })
      .where(eq(bolleTable.id, id));

    const payload = command(await bollaVersion(id));
    const response = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(payload);
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      stato: "in_trasporto",
      volontarioConsegnaId: volontarioId,
      trasportatoreNome: null,
    });
    expect(await lotAmount()).toBe(98);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      tipoDettaglio: "affidamento_trasporto",
      naturaContabile: "AFFIDAMENTO_TRASPORTO",
    });
    const retry = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(payload);
    expect(retry.status, retry.text).toBe(200);
    expect(await lotAmount()).toBe(98);
    expect(
      await db
        .select()
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(eq(operazioniDistribuzioneMagazzinoTable.entitaOrigineId, id)),
    ).toHaveLength(0);
  });

  it("CR-M4-01-B: rifiuta nome esterno se il volontario è già assegnato", async () => {
    const volontarioId = await createVolontario(scope, centreId);
    const id = await readyBolla(2);
    await db
      .update(bolleTable)
      .set({ volontarioConsegnaId: volontarioId })
      .where(eq(bolleTable.id, id));

    const response = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(await bollaVersion(id), { trasportatoreNome: "Esterno" }));
    expect(response.status, response.text).toBe(400);
    expect(response.body.error).toMatch(/volontario OPPURE/i);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(bolla).toMatchObject({
      stato: "confermato",
      volontarioConsegnaId: volontarioId,
      trasportatoreNome: null,
    });
    expect(await lotAmount()).toBe(100);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(0);
  });

  it("CR-M4-01-C: conserva il nome esterno già assegnato senza reinvio", async () => {
    const id = await readyBolla(2);
    await db
      .update(bolleTable)
      .set({ trasportatoreNome: "Incaricato già assegnato" })
      .where(eq(bolleTable.id, id));

    const changed = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(
        command(await bollaVersion(id), { trasportatoreNome: "Altro nome" }),
      );
    expect(changed.status, changed.text).toBe(400);
    expect(await lotAmount()).toBe(100);

    const response = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(await bollaVersion(id)));
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      stato: "in_trasporto",
      volontarioConsegnaId: null,
      trasportatoreNome: "Incaricato già assegnato",
    });
    expect(await lotAmount()).toBe(98);
  });

  it("CR-M4-01-D: senza incaricato il nome è obbligatorio", async () => {
    const id = await readyBolla(2);
    const response = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(await bollaVersion(id)));
    expect(response.status, response.text).toBe(400);
    expect(response.body.error).toMatch(/indicare il trasportatore/i);
    const [bolla] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(bolla.stato).toBe("confermato");
    expect(await lotAmount()).toBe(100);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(0);
  });

  it("CR-M4-01-E: salva soltanto un nome libero valido e scarica una volta", async () => {
    const id = await readyBolla(2);
    const version = await bollaVersion(id);
    const tooLong = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(version, { trasportatoreNome: "A".repeat(121) }));
    expect(tooLong.status, tooLong.text).toBe(400);
    expect(await lotAmount()).toBe(100);

    const response = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(version, { trasportatoreNome: "  Autista esterno  " }));
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      stato: "in_trasporto",
      volontarioConsegnaId: null,
      trasportatoreNome: "Autista esterno",
    });
    expect(await lotAmount()).toBe(98);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(1);
  });
});

describe("M4B.2 — effetto fisico e Bolla affidata", () => {
  it("REPORT-M4-A: Bolla diretta riduce 20 fisici e distribuisce 20 una sola volta", async () => {
    lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouseId,
      quantita: 100,
      fsePlus: true,
    });
    const logisticsBefore = await buildLogisticaReport(reportingFilters);
    const fseBefore = await buildFsePlusReport(reportingFilters);
    const id = await readyBolla(20);
    const delivered = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(command(await bollaVersion(id), { confermaRicezione: true }));
    expect(delivered.status, delivered.text).toBe(200);
    const logisticsAfter = await buildLogisticaReport(reportingFilters);
    const fseAfter = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(logisticsAfter, "giacenzaCorrentePezzi") -
        kpiValue(logisticsBefore, "giacenzaCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseAfter, "giacenzaFseCorrentePezzi") -
        kpiValue(fseBefore, "giacenzaFseCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseAfter, "distribuzioniFseLordePezzi") -
        kpiValue(fseBefore, "distribuzioniFseLordePezzi"),
    ).toBe(20);
  });

  it("REPORT-M4-B: Logistica/FSE leggono -20 fisico all'affidamento e +20 distribuito solo alla consegna", async () => {
    lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouseId,
      quantita: 100,
      fsePlus: true,
    });
    const logisticsBefore = await buildLogisticaReport(reportingFilters);
    const fseBefore = await buildFsePlusReport(reportingFilters);
    const id = await readyBolla(20);
    const entrusted = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(
        command(await bollaVersion(id), { trasportatoreNome: "Incaricato" }),
      );
    expect(entrusted.status, entrusted.text).toBe(200);
    const logisticsEntrusted = await buildLogisticaReport(reportingFilters);
    const fseEntrusted = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(logisticsEntrusted, "giacenzaCorrentePezzi") -
        kpiValue(logisticsBefore, "giacenzaCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(logisticsEntrusted, "giacenzaAsOfPezzi") -
        kpiValue(logisticsBefore, "giacenzaAsOfPezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseEntrusted, "giacenzaFseCorrentePezzi") -
        kpiValue(fseBefore, "giacenzaFseCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseEntrusted, "giacenzaFseAsOfPezzi") -
        kpiValue(fseBefore, "giacenzaFseAsOfPezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseEntrusted, "distribuzioniFseLordePezzi") -
        kpiValue(fseBefore, "distribuzioniFseLordePezzi"),
    ).toBe(0);
    const canonicalEntrusted = await buildFseCanonicalReport({
      magazzinoId: warehouseId,
      dataDa: "2026-01-01",
      dataA: "2026-12-31",
    });
    const delivered = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(command(await bollaVersion(id), { confermaRicezione: true }));
    expect(delivered.status, delivered.text).toBe(200);
    const [outgoing, outcome] = await db
      .select({
        type: movimentiTable.tipoMovimento,
        nature: movimentiTable.naturaContabile,
        fund: movimentiTable.fondoOrigine,
        channel: movimentiTable.canaleOperativo,
        pieces: movimentiTable.quantitaPezzi,
      })
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id))
      .orderBy(asc(movimentiTable.id));
    expect(outgoing).toMatchObject({
      type: "scarico",
      nature: "AFFIDAMENTO_TRASPORTO",
      fund: "FSE_PLUS",
    });
    expect(outcome).toMatchObject({
      type: "esito",
      nature: "DISTRIBUZIONE_FINALE",
      fund: "FSE_PLUS",
      channel: "RITIRO_SEDE",
    });
    expect(Number(outcome.pieces)).toBe(20);
    const logisticsDelivered = await buildLogisticaReport(reportingFilters);
    const fseDelivered = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(logisticsDelivered, "giacenzaCorrentePezzi") -
        kpiValue(logisticsBefore, "giacenzaCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(logisticsDelivered, "giacenzaAsOfPezzi") -
        kpiValue(logisticsBefore, "giacenzaAsOfPezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseDelivered, "giacenzaFseCorrentePezzi") -
        kpiValue(fseBefore, "giacenzaFseCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseDelivered, "giacenzaFseAsOfPezzi") -
        kpiValue(fseBefore, "giacenzaFseAsOfPezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseDelivered, "distribuzioniFseLordePezzi") -
        kpiValue(fseBefore, "distribuzioniFseLordePezzi"),
    ).toBe(20);
    const canonicalDelivered = await buildFseCanonicalReport({
      magazzinoId: warehouseId,
      dataDa: "2026-01-01",
      dataA: "2026-12-31",
    });
    expect(
      canonicalEntrusted.lines.filter(
        (line) => line.accountingNature === "DISTRIBUZIONE_FINALE",
      ),
    ).toHaveLength(0);
    expect(
      canonicalDelivered.lines.filter(
        (line) => line.accountingNature === "DISTRIBUZIONE_FINALE",
      ),
    ).toHaveLength(1);
    expect(
      Number(
        canonicalDelivered.balances.find((row) => row.lotId === lotId)?.pieces,
      ),
    ).toBe(
      Number(
        canonicalEntrusted.balances.find((row) => row.lotId === lotId)?.pieces,
      ),
    );
  });

  it("REPORT-M4-B-KG: l'esito distribuisce kg FSE senza un secondo effetto fisico", async () => {
    productId = await createProdotto(scope, { unitaMisura: "kg" });
    lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouseId,
      quantita: 100,
      fsePlus: true,
    });
    const before = await buildFsePlusReport(reportingFilters);
    const id = await readyBolla(20, "kg");
    const entrusted = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(
        command(await bollaVersion(id), { trasportatoreNome: "Incaricato" }),
      );
    expect(entrusted.status, entrusted.text).toBe(200);
    const afterEntrustment = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(afterEntrustment, "kgCalcolabili") -
        kpiValue(before, "kgCalcolabili"),
    ).toBe(0);

    const delivered = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(command(await bollaVersion(id), { confermaRicezione: true }));
    expect(delivered.status, delivered.text).toBe(200);
    const afterDelivery = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(afterDelivery, "kgCalcolabili") -
        kpiValue(before, "kgCalcolabili"),
    ).toBe(20);
    expect(
      kpiValue(afterDelivery, "distribuzioniFseNetteKgLt") -
        kpiValue(before, "distribuzioniFseNetteKgLt"),
    ).toBe(20);
    expect(await lotAmount()).toBe(80);
  });

  it("REPORT-M4-C: rientro 18 idonei, 1 deteriorato e 1 mancante lascia 98 fisici e zero distribuiti", async () => {
    lotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouseId,
      quantita: 100,
      fsePlus: true,
    });
    const logisticsBefore = await buildLogisticaReport(reportingFilters);
    const fseBefore = await buildFsePlusReport(reportingFilters);
    const id = await entrustedBolla(20);
    await missingDelivery(id);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const returned = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          righe: [
            {
              movimentoUscitaId,
              idonea: "18",
              deteriorata: "1",
              mancante: "1",
            },
          ],
        }),
      );
    expect(returned.status, returned.text).toBe(200);
    expect(await lotAmount()).toBe(98);
    const logisticsAfter = await buildLogisticaReport(reportingFilters);
    const fseAfter = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(logisticsAfter, "giacenzaCorrentePezzi") -
        kpiValue(logisticsBefore, "giacenzaCorrentePezzi"),
    ).toBe(-2);
    expect(
      kpiValue(fseAfter, "giacenzaFseCorrentePezzi") -
        kpiValue(fseBefore, "giacenzaFseCorrentePezzi"),
    ).toBe(-2);
    expect(
      kpiValue(fseAfter, "distribuzioniFseLordePezzi") -
        kpiValue(fseBefore, "distribuzioniFseLordePezzi"),
    ).toBe(0);
    const outcomes = await db
      .select()
      .from(rientroTrasportoRigheTable)
      .where(eq(rientroTrasportoRigheTable.bollaId, id));
    expect(
      outcomes.map((row) => [row.tipoEsito, Number(row.quantita)]).sort(),
    ).toEqual([
      ["deteriorata", 1],
      ["idonea", 18],
      ["mancante", 1],
    ]);
  });

  it("BOLLA-DIRECT-REG: il percorso diretto mantiene un solo scarico fisico", async () => {
    const id = await readyBolla(20);
    const result = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(command(await bollaVersion(id), { confermaRicezione: true }));
    expect(result.status, result.text).toBe(200);
    expect(await lotAmount()).toBe(80);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id))
      .orderBy(asc(movimentiTable.id));
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      tipoMovimento: "scarico",
      naturaContabile: "DISTRIBUZIONE_FINALE",
    });
  });

  it("AFF-01/02/03, DEL-01/02/04: affida una volta, finalizza con esito neutro e distribuzione unica", async () => {
    const id = await entrustedBolla(20);
    expect(await lotAmount()).toBe(80);
    const reservations = await db
      .select()
      .from(prenotazioniMagazzinoTable)
      .where(eq(prenotazioniMagazzinoTable.bollaId, id));
    expect(reservations.map((row) => row.stato)).toEqual([
      "convertita_in_affidamento",
    ]);
    const outgoing = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id));
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0]).toMatchObject({
      tipoMovimento: "scarico",
      tipoDettaglio: "affidamento_trasporto",
      naturaContabile: "AFFIDAMENTO_TRASPORTO",
    });
    expect(
      await db
        .select()
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(eq(operazioniDistribuzioneMagazzinoTable.entitaOrigineId, id)),
    ).toHaveLength(0);
    const payload = command(await bollaVersion(id), {
      confermaRicezione: true,
    });
    const delivered = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(payload);
    expect(delivered.status, delivered.text).toBe(200);
    expect(delivered.body.stato).toBe("consegnato");
    expect(await lotAmount()).toBe(80);
    const retry = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(payload);
    expect(retry.status, retry.text).toBe(200);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id))
      .orderBy(asc(movimentiTable.id));
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({
      tipoMovimento: "esito",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      movimentoOrigineId: outgoing[0].id,
    });
    expect(movementPhysicalEffect(movements[1])).toBe(0);
    expect(await physicalDeltaForWarehouse(warehouseId)).toBe(-20);
    expect(await lotAmount()).toBe(80);
    expect(
      Number(
        movements
          .filter(
            (movement) => movement.naturaContabile === "DISTRIBUZIONE_FINALE",
          )
          .reduce((total, movement) => total + Number(movement.quantita), 0),
      ),
    ).toBe(20);
  });

  it("DEL-03: la consegna a Ente dopo affidamento è un esito senza secondo scarico né fatto sociale", async () => {
    const areaId = await createAreaOperativa(scope);
    const centre = await createCentroRec(scope, { areaOperativaId: areaId });
    const actor = await createUtente(scope, { centroId: centre.id });
    const warehouse = await createMagazzino(scope, centre.id, {
      areaOperativaId: areaId,
    });
    const lot = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouse,
      quantita: 100,
      fsePlus: true,
    });
    const logisticsBefore = await buildLogisticaReport(reportingFilters);
    const fseBefore = await buildFsePlusReport(reportingFilters);
    const [ente] = await db
      .insert(entiDestinatariTable)
      .values({
        denominazione: "Ente M4B.2",
        indirizzo: "Via Test 1",
        areaOperativaId: areaId,
      })
      .returning({ id: entiDestinatariTable.id });
    scope.enteDestinatarioIds.push(ente.id);
    const [created] = await db
      .insert(bolleTable)
      .values({
        numeroBolla: `ENTE-${randomUUID().slice(0, 12)}`,
        dataBolla: "2026-09-24",
        tipoDestinatario: "ente",
        enteDestinatarioId: ente.id,
        magazzinoId: warehouse,
        areaOperativaIdSnapshot: areaId,
        stato: "bozza",
      })
      .returning({ id: bolleTable.id });
    scope.bollaIds.push(created.id);
    await insertBollaRiga(scope, {
      bollaId: created.id,
      prodottoId: productId,
      lottoId: lot,
      quantita: 20,
      unitaMisura: "pz",
    });
    const app = makeScopedApp(bolleRouter, {
      id: actor,
      centroAscoltoId: centre.id,
      areaOperativaId: areaId,
    });
    const confirmed = await request(app)
      .post(`/bolle/${created.id}/conferma`)
      .send(command(await bollaVersion(created.id)));
    expect(confirmed.status, confirmed.text).toBe(200);
    const entrusted = await request(app)
      .post(`/bolle/${created.id}/affida`)
      .send(
        command(confirmed.body.versione, {
          trasportatoreNome: "Incaricato Ente",
        }),
      );
    expect(entrusted.status, entrusted.text).toBe(200);
    const delivered = await request(app)
      .post(`/bolle/${created.id}/consegna`)
      .send(
        command(entrusted.body.versione, {
          confermaRicezione: true,
        }),
      );
    expect(delivered.status, delivered.text).toBe(200);
    expect(await lotAmount(lot)).toBe(80);
    const logisticsAfter = await buildLogisticaReport(reportingFilters);
    const fseAfter = await buildFsePlusReport(reportingFilters);
    expect(
      kpiValue(logisticsAfter, "giacenzaCorrentePezzi") -
        kpiValue(logisticsBefore, "giacenzaCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseAfter, "giacenzaFseCorrentePezzi") -
        kpiValue(fseBefore, "giacenzaFseCorrentePezzi"),
    ).toBe(-20);
    expect(
      kpiValue(fseAfter, "distribuzioniFseLordePezzi") -
        kpiValue(fseBefore, "distribuzioniFseLordePezzi"),
    ).toBe(0);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, created.id))
      .orderBy(asc(movimentiTable.id));
    expect(movements).toHaveLength(2);
    expect(movements[0]).toMatchObject({
      tipoMovimento: "scarico",
      naturaContabile: "AFFIDAMENTO_TRASPORTO",
    });
    expect(movements[1]).toMatchObject({
      tipoMovimento: "esito",
      naturaContabile: "CONSEGNA_ENTE",
      movimentoOrigineId: movements[0].id,
    });
    expect(
      await db
        .select()
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(
          eq(operazioniDistribuzioneMagazzinoTable.entitaOrigineId, created.id),
        ),
    ).toHaveLength(0);
  });

  it("DEL-SHARED: la pagina Consegne finalizza la stessa Bolla affidata senza secondo scarico", async () => {
    const consegnaId = await insertConsegna(scope, {
      beneficiarioId: beneficiaryId,
      magazzinoId: warehouseId,
    });
    const id = await insertBolla(scope, {
      beneficiarioId: beneficiaryId,
      magazzinoId: warehouseId,
      consegnaId,
    });
    await insertBollaRiga(scope, {
      bollaId: id,
      prodottoId: productId,
      lottoId: lotId,
      quantita: 20,
    });
    const confirmed = await request(bollaApp())
      .post(`/bolle/${id}/conferma`)
      .send(command(await bollaVersion(id)));
    expect(confirmed.status, confirmed.text).toBe(200);
    const entrusted = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(
        command(confirmed.body.versione, {
          trasportatoreNome: "Incaricato Consegne",
        }),
      );
    expect(entrusted.status, entrusted.text).toBe(200);
    const app = makeScopedApp(consegneRouter, {
      id: actorId,
      centroAscoltoId: centreId,
    });
    const completed = await request(app)
      .post(`/consegne/${consegnaId}/completa`)
      .send(command(entrusted.body.versione));
    expect(completed.status, completed.text).toBe(200);
    expect(await lotAmount()).toBe(80);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id))
      .orderBy(asc(movimentiTable.id));
    expect(movements).toHaveLength(2);
    expect(movements[1]).toMatchObject({
      tipoMovimento: "esito",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      movimentoOrigineId: movements[0].id,
    });
  });

  it("RET-01..10: 18 idonei, 1 avariato e 1 mancante producono stock 98 senza distribuzione", async () => {
    const id = await entrustedBolla(20);
    await missingDelivery(id);
    expect(await lotAmount()).toBe(80);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const under = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          righe: [{ movimentoUscitaId, idonea: "18", deteriorata: "1" }],
        }),
      );
    expect(under.status).toBe(409);
    const over = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          righe: [{ movimentoUscitaId, idonea: "21" }],
        }),
      );
    expect(over.status).toBe(409);
    const other = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          righe: [{ movimentoUscitaId, idonea: "20", altro: "1" }],
        }),
      );
    expect(other.status).toBe(400);
    const otherWarehouseId = await createMagazzino(scope, centreId);
    const wrongDestination = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          magazzinoId: otherWarehouseId,
          righe: [{ movimentoUscitaId, idonea: "20" }],
        }),
      );
    expect(wrongDestination.status).toBe(400);
    expect(await lotAmount()).toBe(80);
    const payload = command(await bollaVersion(id), {
      righe: [
        { movimentoUscitaId, idonea: "18", deteriorata: "1", mancante: "1" },
      ],
    });
    const returned = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(payload);
    expect(returned.status, returned.text).toBe(200);
    expect(returned.body.stato).toBe("rientrato");
    expect(await lotAmount()).toBe(98);
    const retry = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(payload);
    expect(retry.status, retry.text).toBe(200);
    expect(await lotAmount()).toBe(98);
    const detail = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(
      detail.body.documenti.map((row: { tipo: string }) => row.tipo),
    ).toEqual(["idonea", "deteriorata", "mancante"]);
    expect(detail.body.documenti[1].scaricoId).toBeTruthy();
    expect(detail.body.documenti[2].scaricoId).toBeNull();
    const [scarico] = await db
      .select()
      .from(scarichiTable)
      .where(eq(scarichiTable.id, detail.body.documenti[1].scaricoId));
    expect(scarico.causale).toBe("deteriorata");
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id));
    expect(
      movements.filter((row) => row.naturaContabile === "DISTRIBUZIONE_FINALE"),
    ).toHaveLength(0);
    expect(
      movements.filter((row) => row.tipoMovimento === "rientro"),
    ).toHaveLength(2);
    expect(
      movements.filter((row) => row.tipoMovimento === "esito"),
    ).toHaveLength(1);
    expect(await physicalDeltaForWarehouse(warehouseId)).toBe(-2);
    const late = await request(bollaApp())
      .post(`/bolle/${id}/consegna`)
      .send(command(await bollaVersion(id)));
    expect(late.status).toBe(400);
  });

  it("RET-03/05: scaduta e rubata restano distinte, netto fisico zero", async () => {
    const id = await entrustedBolla(2);
    await missingDelivery(id);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const response = await request(bollaApp())
      .post(`/bolle/${id}/rientro`)
      .send(
        command(await bollaVersion(id), {
          righe: [{ movimentoUscitaId, scaduta: "1", rubata: "1" }],
        }),
      );
    expect(response.status, response.text).toBe(200);
    expect(await lotAmount()).toBe(98);
    const rows = await db
      .select()
      .from(rientroTrasportoRigheTable)
      .where(eq(rientroTrasportoRigheTable.bollaId, id));
    expect(rows.map((row) => row.tipoEsito)).toEqual(["scaduta", "rubata"]);
    expect(rows[0].scaricoId).toBeTruthy();
    expect(rows[1].scaricoId).toBeNull();
  });

  it("CONC-AFF-01: due affidamenti in attesa sullo stesso lock serializzano una sola uscita", async () => {
    const id = await readyBolla(3);
    const version = await bollaVersion(id);
    const blocker = await pool.connect();
    let first: Promise<request.Response> | null = null;
    let second: Promise<request.Response> | null = null;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM bolle WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      first = request(bollaApp())
        .post(`/bolle/${id}/affida`)
        .send(command(version, { trasportatoreNome: "T1" }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid);
      second = request(bollaApp())
        .post(`/bolle/${id}/affida`)
        .send(command(version, { trasportatoreNome: "T2" }))
        .then((response) => response);
      await blocker.query("COMMIT");
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(await lotAmount()).toBe(97);
      expect(
        (
          await db
            .select()
            .from(movimentiTable)
            .where(eq(movimentiTable.bollaId, id))
        ).length,
      ).toBe(1);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [first, second].filter(
          (promise): promise is Promise<request.Response> => promise != null,
        ),
      );
    }
  });

  it("CONC-RET-01: due riconciliazioni sullo stesso lock producono un solo rientro", async () => {
    const id = await entrustedBolla(3);
    await missingDelivery(id);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const version = await bollaVersion(id);
    const blocker = await pool.connect();
    let first: Promise<request.Response> | null = null;
    let second: Promise<request.Response> | null = null;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM bolle WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      first = request(bollaApp())
        .post(`/bolle/${id}/rientro`)
        .send(command(version, { righe: [{ movimentoUscitaId, idonea: "3" }] }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid);
      second = request(bollaApp())
        .post(`/bolle/${id}/rientro`)
        .send(command(version, { righe: [{ movimentoUscitaId, idonea: "3" }] }))
        .then((response) => response);
      await blocker.query("COMMIT");
      const responses = await Promise.all([first, second]);
      expect(responses.map((response) => response.status).sort()).toEqual([
        200, 409,
      ]);
      expect(await lotAmount()).toBe(100);
      expect(
        await db
          .select()
          .from(rientriTrasportoTable)
          .where(eq(rientriTrasportoTable.bollaId, id)),
      ).toHaveLength(1);
      expect(
        (
          await db
            .select()
            .from(movimentiTable)
            .where(
              and(
                eq(movimentiTable.bollaId, id),
                eq(movimentiTable.tipoMovimento, "rientro"),
              ),
            )
        ).length,
      ).toBe(1);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      await Promise.allSettled(
        [first, second].filter(
          (promise): promise is Promise<request.Response> => promise != null,
        ),
      );
    }
  });

  it("CONC-AFF-02: Affida conteso con Annulla non reintegra merce fuori scaffale", async () => {
    const id = await readyBolla(2);
    const version = await bollaVersion(id);
    const [entrusted, cancelled] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/affida`)
          .send(command(version, { trasportatoreNome: "Incaricato" }))
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/annulla`)
          .send(command(version, { motivo: "Annullamento concorrente" }))
          .then((response) => response),
    );
    expect(entrusted.status, entrusted.text).toBe(200);
    expect(cancelled.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    const [current] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(current.stato).toBe("in_trasporto");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("CONC-AFF-03: Affida conteso con Storno non crea una falsa compensazione", async () => {
    const id = await readyBolla(2);
    const version = await bollaVersion(id);
    const rows = await pool.query<{ id: number }>(
      "SELECT id FROM bolla_righe WHERE bolla_id=$1",
      [id],
    );
    const adminApp = makeScopedApp(bolleRouter, {
      id: actorId,
      centroAscoltoId: centreId,
      permessi: ["bolle.reverse.admin"],
    });
    const [entrusted, reversed] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/affida`)
          .send(command(version, { trasportatoreNome: "Incaricato" }))
          .then((response) => response),
      () =>
        request(adminApp)
          .post(`/bolle/${id}/storno-amministrativo`)
          .send(
            command(version, {
              motivo: "Contesa",
              rigaIds: rows.rows.map((row) => row.id),
            }),
          )
          .then((response) => response),
    );
    expect(entrusted.status, entrusted.text).toBe(200);
    expect(reversed.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("CONC-DEL-01: due conferme trasportate creano un solo esito e nessun secondo scarico", async () => {
    const id = await entrustedBolla(2);
    const version = await bollaVersion(id);
    const [first, second] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/consegna`)
          .send(command(version, { confermaRicezione: true }))
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/consegna`)
          .send(command(version, { confermaRicezione: true }))
          .then((response) => response),
    );
    expect(first.status, first.text).toBe(200);
    expect(second.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    const movements = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, id));
    expect(movements.map((row) => row.tipoMovimento).sort()).toEqual([
      "esito",
      "scarico",
    ]);
    expect(
      await db
        .select()
        .from(operazioniDistribuzioneMagazzinoTable)
        .where(eq(operazioniDistribuzioneMagazzinoTable.entitaOrigineId, id)),
    ).toHaveLength(1);
  });

  it("CONC-DEL-02: Conferma consegna e Mancata consegna non producono due stati terminali", async () => {
    const id = await entrustedBolla(2);
    const version = await bollaVersion(id);
    const [delivered, missed] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/consegna`)
          .send(command(version, { confermaRicezione: true }))
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/mancata-consegna`)
          .send(command(version, { motivo: "Destinatario assente" }))
          .then((response) => response),
    );
    expect(delivered.status, delivered.text).toBe(200);
    expect(missed.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    const [current] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(current.stato).toBe("consegnato");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(2);
  });

  it("CONC-FAIL-01: due segnalazioni di mancata consegna non duplicano l'esito", async () => {
    const id = await entrustedBolla(2);
    const version = await bollaVersion(id);
    const [first, second] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/mancata-consegna`)
          .send(command(version, { motivo: "Destinatario assente" }))
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/mancata-consegna`)
          .send(command(version, { motivo: "Destinatario assente" }))
          .then((response) => response),
    );
    expect(first.status, first.text).toBe(200);
    expect(second.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    const [current] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(current.stato).toBe("rientro_atteso");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("CONC-RET-02: un over-return conteso non altera il rientro valido", async () => {
    const id = await entrustedBolla(3);
    await missingDelivery(id);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const version = await bollaVersion(id);
    const [valid, excessive] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/rientro`)
          .send(
            command(version, { righe: [{ movimentoUscitaId, idonea: "3" }] }),
          )
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/rientro`)
          .send(
            command(version, { righe: [{ movimentoUscitaId, idonea: "4" }] }),
          )
          .then((response) => response),
    );
    expect(valid.status, valid.text).toBe(200);
    expect(excessive.status).toBe(409);
    expect(await lotAmount()).toBe(100);
    expect(
      await db
        .select()
        .from(rientriTrasportoTable)
        .where(eq(rientriTrasportoTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("CONC-RET-04: due operatori sulla stessa uscita non duplicano il rientro", async () => {
    const id = await entrustedBolla(2);
    await missingDelivery(id);
    const secondActorId = await createUtente(scope, { centroId: centreId });
    const secondApp = makeScopedApp(bolleRouter, {
      id: secondActorId,
      centroAscoltoId: centreId,
    });
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const version = await bollaVersion(id);
    const [first, second] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/rientro`)
          .send(
            command(version, { righe: [{ movimentoUscitaId, idonea: "2" }] }),
          )
          .then((response) => response),
      () =>
        request(secondApp)
          .post(`/bolle/${id}/rientro`)
          .send(
            command(version, { righe: [{ movimentoUscitaId, idonea: "2" }] }),
          )
          .then((response) => response),
    );
    expect(first.status, first.text).toBe(200);
    expect(second.status).toBe(409);
    expect(await lotAmount()).toBe(100);
    expect(
      await db
        .select()
        .from(rientriTrasportoTable)
        .where(eq(rientriTrasportoTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("CONC-RET-03: Rientro e Conferma consegna non generano due esiti", async () => {
    const id = await entrustedBolla(2);
    await missingDelivery(id);
    const preview = await request(bollaApp()).get(`/bolle/${id}/rientro`);
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const version = await bollaVersion(id);
    const [returned, delivered] = await raceOnBolla(
      id,
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/rientro`)
          .send(
            command(version, { righe: [{ movimentoUscitaId, idonea: "2" }] }),
          )
          .then((response) => response),
      () =>
        request(bollaApp())
          .post(`/bolle/${id}/consegna`)
          .send(command(version, { confermaRicezione: true }))
          .then((response) => response),
    );
    expect(returned.status, returned.text).toBe(200);
    expect(delivered.status).not.toBe(200);
    expect(await lotAmount()).toBe(100);
    const [current] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(current.stato).toBe("rientrato");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.bollaId, id),
            eq(movimentiTable.naturaContabile, "DISTRIBUZIONE_FINALE"),
          ),
        ),
    ).toHaveLength(0);
  });

  it("IDEMP-M4B2: replay, mismatch e versione stale non ripetono l'affidamento", async () => {
    const id = await readyBolla(2);
    const version = await bollaVersion(id);
    const payload = command(version, { trasportatoreNome: "Incaricato" });
    const first = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(payload);
    expect(first.status, first.text).toBe(200);
    const retry = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(payload);
    expect(retry.status, retry.text).toBe(200);
    const mismatch = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send({
        ...payload,
        trasportatoreNome: "Altro incaricato",
      });
    expect(mismatch.status).toBe(409);
    const stale = await request(bollaApp())
      .post(`/bolle/${id}/affida`)
      .send(command(version, { trasportatoreNome: "Incaricato" }));
    expect(stale.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(1);
  });

  it("AUDIT-M4B2: errore audit annulla uscita e receipt dell'affidamento", async () => {
    const id = await readyBolla(2);
    const invalidAuditApp = makeScopedApp(bolleRouter, {
      id: actorId,
      centroAscoltoId: centreId,
      matricola: "X".repeat(161),
    });
    const response = await request(invalidAuditApp)
      .post(`/bolle/${id}/affida`)
      .send(
        command(await bollaVersion(id), { trasportatoreNome: "Incaricato" }),
      );
    expect(response.status).toBe(500);
    expect(await lotAmount()).toBe(100);
    const [current] = await db
      .select()
      .from(bolleTable)
      .where(eq(bolleTable.id, id));
    expect(current.stato).toBe("confermato");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(eq(movimentiTable.bollaId, id)),
    ).toHaveLength(0);
  });

  it("RECEIPT-M4B2: errore nel receipt rollbacka audit e uscita fisica", async () => {
    const id = await readyBolla(2);
    const idempotencyKey = key();
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const functionName = `test_m4b2_receipt_fail_${suffix}`;
    const triggerName = `test_m4b2_receipt_fail_trg_${suffix}`;
    let functionCreated = false;
    let triggerCreated = false;
    try {
      await pool.query(`CREATE FUNCTION ${functionName}()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.idempotency_key = '${idempotencyKey}' THEN
            RAISE EXCEPTION 'synthetic M4B2 receipt failure';
          END IF;
          RETURN NEW;
        END $$`);
      functionCreated = true;
      await pool.query(`CREATE TRIGGER ${triggerName}
        BEFORE INSERT ON comandi_operativi
        FOR EACH ROW EXECUTE FUNCTION ${functionName}()`);
      triggerCreated = true;
      const response = await request(bollaApp())
        .post(`/bolle/${id}/affida`)
        .send({
          idempotencyKey,
          versione: await bollaVersion(id),
          trasportatoreNome: "Incaricato",
        });
      expect(response.status).toBe(500);
      expect(await lotAmount()).toBe(100);
      const [current] = await db
        .select()
        .from(bolleTable)
        .where(eq(bolleTable.id, id));
      expect(current.stato).toBe("confermato");
      expect(
        await db
          .select()
          .from(movimentiTable)
          .where(eq(movimentiTable.bollaId, id)),
      ).toHaveLength(0);
    } finally {
      try {
        if (triggerCreated)
          await pool.query(
            `DROP TRIGGER IF EXISTS ${triggerName} ON comandi_operativi`,
          );
      } finally {
        if (functionCreated)
          await pool.query(`DROP FUNCTION IF EXISTS ${functionName}()`);
      }
    }
  });

  it("DB-RET-01: la FK composta impedisce di attribuire un'uscita fisica alla Bolla sbagliata", async () => {
    const firstId = await entrustedBolla(2);
    const secondId = await entrustedBolla(2);
    const [foreignMovement] = await db
      .select()
      .from(movimentiTable)
      .where(
        and(
          eq(movimentiTable.bollaId, secondId),
          eq(movimentiTable.tipoDettaglio, "affidamento_trasporto"),
        ),
      );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const parent = await client.query<{ id: number }>(
        `INSERT INTO rientri_trasporto (bolla_id, magazzino_origine_id, data_rientro, created_by)
         VALUES ($1, $2, CURRENT_DATE, $3) RETURNING id`,
        [firstId, warehouseId, actorId],
      );
      await expect(
        client.query(
          `INSERT INTO rientro_trasporto_righe
         (rientro_id, bolla_id, movimento_uscita_id, prodotto_id, lotto_id, tipo_esito, quantita)
         VALUES ($1, $2, $3, $4, $5, 'idonea', 2)`,
          [parent.rows[0].id, firstId, foreignMovement.id, productId, lotId],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
    expect(await lotAmount()).toBe(96);
  });

  it("DB-RET-02: owner esclusivo, quantità, partita reale e unicità sono vincoli PostgreSQL", async () => {
    const bollaId = await entrustedBolla(4);
    const destinationId = await createMagazzino(scope, centreId);
    const transferId = await insertTrasferimento(scope, {
      origineId: warehouseId,
      destinoId: destinationId,
    });
    const [outgoing] = await db
      .select()
      .from(movimentiTable)
      .where(eq(movimentiTable.bollaId, bollaId));
    const otherProductId = await createProdotto(scope, { unitaMisura: "pz" });
    const otherLotId = await createLotto(scope, {
      prodottoId: productId,
      magazzinoId: warehouseId,
      quantita: 1,
    });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      async function rejected(
        statement: string,
        values: unknown[],
        code: string,
      ) {
        await client.query("SAVEPOINT invalid_row");
        await expect(client.query(statement, values)).rejects.toMatchObject({
          code,
        });
        await client.query("ROLLBACK TO SAVEPOINT invalid_row");
      }
      await rejected(
        `INSERT INTO rientri_trasporto
         (magazzino_origine_id, data_rientro, created_by)
         VALUES ($1, CURRENT_DATE, $2)`,
        [warehouseId, actorId],
        "23514",
      );
      await rejected(
        `INSERT INTO rientri_trasporto
         (bolla_id, trasferimento_id, magazzino_origine_id, data_rientro, created_by)
         VALUES ($1, $2, $3, CURRENT_DATE, $4)`,
        [bollaId, transferId, warehouseId, actorId],
        "23514",
      );
      const parent = await client.query<{ id: number }>(
        `INSERT INTO rientri_trasporto
         (bolla_id, magazzino_origine_id, data_rientro, created_by)
         VALUES ($1, $2, CURRENT_DATE, $3) RETURNING id`,
        [bollaId, warehouseId, actorId],
      );
      const parentId = parent.rows[0].id;
      await rejected(
        `INSERT INTO rientri_trasporto
         (bolla_id, magazzino_origine_id, data_rientro, created_by)
         VALUES ($1, $2, CURRENT_DATE, $3)`,
        [bollaId, warehouseId, actorId],
        "23505",
      );
      const insertLine = `INSERT INTO rientro_trasporto_righe
        (rientro_id, bolla_id, movimento_uscita_id, prodotto_id, lotto_id, tipo_esito, quantita)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`;
      const valid = [
        parentId,
        bollaId,
        outgoing.id,
        productId,
        lotId,
        "idonea",
        4,
      ];
      await rejected(insertLine, [...valid.slice(0, 6), 0], "23514");
      await rejected(insertLine, [...valid.slice(0, 5), "altro", 4], "23514");
      await rejected(
        insertLine,
        [...valid.slice(0, 3), otherProductId, ...valid.slice(4)],
        "23503",
      );
      await rejected(
        insertLine,
        [...valid.slice(0, 4), otherLotId, ...valid.slice(5)],
        "23503",
      );
      await client.query(insertLine, valid);
      await rejected(insertLine, valid, "23505");
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
    expect(await lotAmount()).toBe(96);
    expect(
      await db
        .select()
        .from(rientriTrasportoTable)
        .where(eq(rientriTrasportoTable.bollaId, bollaId)),
    ).toHaveLength(0);
  });

  it("AUTH-M4B2: revoca del permesso durante l'attesa del lock impedisce l'uscita", async () => {
    const id = await readyBolla(3);
    const [actor] = await db
      .select({ ruoloId: utentiTable.ruoloId })
      .from(utentiTable)
      .where(eq(utentiTable.id, actorId));
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | null = null;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM bolle WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      pending = request(bollaApp())
        .post(`/bolle/${id}/affida`)
        .send(command(await bollaVersion(id), { trasportatoreNome: "T" }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid);
      await db
        .update(ruoliTable)
        .set({ isAdmin: false, permessi: [] })
        .where(eq(ruoliTable.id, actor.ruoloId!));
      await blocker.query("COMMIT");
      const result = await pending;
      expect(result.status).toBe(403);
      expect(await lotAmount()).toBe(100);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  });

  it("SCOPE-M4B2: cambio Centro durante l'attesa del lock impedisce l'uscita", async () => {
    const id = await readyBolla(3);
    const otherCentreId = await createCentro(scope);
    const blocker = await pool.connect();
    let pending: Promise<request.Response> | null = null;
    try {
      await blocker.query("BEGIN");
      const pid = await blocker.query<{ pid: number }>(
        "SELECT pg_backend_pid() AS pid",
      );
      await blocker.query("SELECT id FROM bolle WHERE id = $1 FOR UPDATE", [
        id,
      ]);
      pending = request(bollaApp())
        .post(`/bolle/${id}/affida`)
        .send(command(await bollaVersion(id), { trasportatoreNome: "T" }))
        .then((response) => response);
      await waitForBlockedBackend(pid.rows[0].pid);
      await db
        .update(utentiTable)
        .set({ centroAscoltoId: otherCentreId })
        .where(eq(utentiTable.id, actorId));
      await blocker.query("COMMIT");
      const result = await pending;
      expect(result.status).toBe(403);
      expect(await lotAmount()).toBe(100);
    } finally {
      await blocker.query("ROLLBACK").catch(() => undefined);
      blocker.release();
      if (pending) await Promise.allSettled([pending]);
    }
  });
});

describe("M4B.2 — Trasferimento rientrato", () => {
  it("CONC-TR-01: ricezione destino e mancato arrivo non possono entrambe prevalere", async () => {
    const transfer = await startedTransfer(2);
    const [missing, received] = await raceOnTransfer(
      transfer.id,
      () =>
        request(transferApp())
          .post(`/trasferimenti/${transfer.id}/mancato-arrivo`)
          .send(command(transfer.version, { motivo: "Destinazione chiusa" }))
          .then((response) => response),
      () =>
        request(transferApp())
          .post(`/trasferimenti/${transfer.id}/conferma`)
          .send(
            command(transfer.version, {
              dataConferma: new Date().toISOString(),
            }),
          )
          .then((response) => response),
    );
    expect(missing.status, missing.text).toBe(200);
    expect(received.status).toBe(409);
    expect(await lotAmount()).toBe(98);
    const [current] = await db
      .select()
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, transfer.id));
    expect(current.stato).toBe("rientro_atteso");
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.trasferimentoId, transfer.id),
            eq(movimentiTable.tipoDettaglio, "entrata"),
          ),
        ),
    ).toHaveLength(0);
  });

  it("CONC-TR-02: rientro origine e ricezione destino non duplicano il carico", async () => {
    const transfer = await startedTransfer(2);
    const missing = await request(transferApp())
      .post(`/trasferimenti/${transfer.id}/mancato-arrivo`)
      .send(command(transfer.version, { motivo: "Destinazione chiusa" }));
    expect(missing.status, missing.text).toBe(200);
    const preview = await request(transferApp()).get(
      `/trasferimenti/${transfer.id}/rientro`,
    );
    expect(preview.status).toBe(200);
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const [returned, received] = await raceOnTransfer(
      transfer.id,
      () =>
        request(transferApp())
          .post(`/trasferimenti/${transfer.id}/rientro`)
          .send(
            command(missing.body.versione, {
              righe: [{ movimentoUscitaId, idonea: "2" }],
            }),
          )
          .then((response) => response),
      () =>
        request(transferApp())
          .post(`/trasferimenti/${transfer.id}/conferma`)
          .send(
            command(missing.body.versione, {
              dataConferma: new Date().toISOString(),
            }),
          )
          .then((response) => response),
    );
    expect(returned.status, returned.text).toBe(200);
    expect(received.status).toBe(409);
    expect(await lotAmount()).toBe(100);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.trasferimentoId, transfer.id),
            eq(movimentiTable.tipoDettaglio, "entrata"),
          ),
        ),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(rientriTrasportoTable)
        .where(eq(rientriTrasportoTable.trasferimentoId, transfer.id)),
    ).toHaveLength(1);
  });

  it("TR-RET-01..05: rientra all'origine, nessuna entrata al destino e stato terminale", async () => {
    const destinationId = await createMagazzino(scope, centreId);
    const created = await request(transferApp())
      .post("/trasferimenti")
      .send({
        idempotencyKey: key(),
        magazzinoOrigineId: warehouseId,
        magazzinoDestinoId: destinationId,
        dataRichiesta: "2026-09-24",
        trasportatoreNome: "Trasportatore",
        righe: [{ prodottoId: productId, quantita: 10 }],
      });
    expect(created.status, created.text).toBe(201);
    scope.trasferimentoIds.push(created.body.id);
    const id = created.body.id;
    const prepared = await request(transferApp())
      .post(`/trasferimenti/${id}/prepara`)
      .send(command(created.body.versione));
    expect(prepared.status, prepared.text).toBe(200);
    const started = await request(transferApp())
      .post(`/trasferimenti/${id}/avvia`)
      .send(command(prepared.body.versione));
    expect(started.status, started.text).toBe(200);
    expect(await lotAmount()).toBe(90);
    const missing = await request(transferApp())
      .post(`/trasferimenti/${id}/mancato-arrivo`)
      .send(
        command(started.body.versione, {
          motivo: "Destinazione non raggiunta",
        }),
      );
    expect(missing.status, missing.text).toBe(200);
    const preview = await request(transferApp()).get(
      `/trasferimenti/${id}/rientro`,
    );
    const movimentoUscitaId = preview.body.partite[0].movimentoUscitaId;
    const returned = await request(transferApp())
      .post(`/trasferimenti/${id}/rientro`)
      .send(
        command(missing.body.versione, {
          righe: [
            { movimentoUscitaId, idonea: "8", deteriorata: "1", mancante: "1" },
          ],
        }),
      );
    expect(returned.status, returned.text).toBe(200);
    expect(returned.body.stato).toBe("rientrato");
    expect(await lotAmount()).toBe(98);
    expect(
      await db
        .select()
        .from(movimentiTable)
        .where(
          and(
            eq(movimentiTable.trasferimentoId, id),
            eq(movimentiTable.tipoDettaglio, "entrata"),
          ),
        ),
    ).toHaveLength(0);
    const receive = await request(transferApp())
      .post(`/trasferimenti/${id}/conferma`)
      .send(
        command(returned.body.versione, {
          dataConferma: new Date().toISOString(),
        }),
      );
    expect(receive.status).toBe(400);
    const [row] = await db
      .select()
      .from(trasferimentiTable)
      .where(eq(trasferimentiTable.id, id));
    expect(row.motivoMancatoArrivo).toBe("Destinazione non raggiunta");
    expect(
      await db
        .select()
        .from(rientriTrasportoTable)
        .where(eq(rientriTrasportoTable.trasferimentoId, id)),
    ).toHaveLength(1);
  });

  it("TR-RET-FEFO: due partite uscite senza lotto esplicito rientrano sulle due partite originarie", async () => {
    const destinationId = await createMagazzino(scope, centreId);
    const transferredProductId = await createProdotto(scope, {
      unitaMisura: "pz",
    });
    const firstLotId = await createLotto(scope, {
      prodottoId: transferredProductId,
      magazzinoId: warehouseId,
      quantita: 5,
      dataScadenza: "2027-01-01",
    });
    const secondLotId = await createLotto(scope, {
      prodottoId: transferredProductId,
      magazzinoId: warehouseId,
      quantita: 5,
      dataScadenza: "2027-02-01",
    });
    const created = await request(transferApp())
      .post("/trasferimenti")
      .send({
        idempotencyKey: key(),
        magazzinoOrigineId: warehouseId,
        magazzinoDestinoId: destinationId,
        dataRichiesta: "2026-09-24",
        trasportatoreNome: "Trasportatore",
        righe: [{ prodottoId: transferredProductId, quantita: 10 }],
      });
    expect(created.status, created.text).toBe(201);
    scope.trasferimentoIds.push(created.body.id);
    const id = created.body.id;
    const prepared = await request(transferApp())
      .post(`/trasferimenti/${id}/prepara`)
      .send(command(created.body.versione));
    expect(prepared.status, prepared.text).toBe(200);
    const started = await request(transferApp())
      .post(`/trasferimenti/${id}/avvia`)
      .send(command(prepared.body.versione));
    expect(started.status, started.text).toBe(200);
    expect(await lotAmount(firstLotId)).toBe(0);
    expect(await lotAmount(secondLotId)).toBe(0);
    const missing = await request(transferApp())
      .post(`/trasferimenti/${id}/mancato-arrivo`)
      .send(command(started.body.versione, { motivo: "Destinazione chiusa" }));
    expect(missing.status, missing.text).toBe(200);
    const preview = await request(transferApp()).get(
      `/trasferimenti/${id}/rientro`,
    );
    expect(preview.status, preview.text).toBe(200);
    expect(
      preview.body.partite
        .map((part: { lottoId: number }) => part.lottoId)
        .sort(),
    ).toEqual([firstLotId, secondLotId].sort());
    const returned = await request(transferApp())
      .post(`/trasferimenti/${id}/rientro`)
      .send(
        command(missing.body.versione, {
          righe: preview.body.partite.map(
            (part: { movimentoUscitaId: number }) => ({
              movimentoUscitaId: part.movimentoUscitaId,
              idonea: "5",
            }),
          ),
        }),
      );
    expect(returned.status, returned.text).toBe(200);
    expect(await lotAmount(firstLotId)).toBe(5);
    expect(await lotAmount(secondLotId)).toBe(5);
    const rows = await db
      .select()
      .from(rientroTrasportoRigheTable)
      .where(eq(rientroTrasportoRigheTable.trasferimentoId, id));
    expect(rows.map((row) => row.lottoId).sort()).toEqual(
      [firstLotId, secondLotId].sort(),
    );
  });
});
