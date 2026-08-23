/* @vitest-environment node */

import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseIndicatoriTable,
  esportazioniFseRigheTable,
  esportazioniFseSaldiTable,
  esportazioniFseTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  rilevazioniMonitoraggioFseTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFseExport,
  FSE_CANONICAL_FORMAT,
  FseReportingError,
  listFseCanonicalPage,
  markFseExportEntered,
} from "../src/lib/fseCanonicalReporting";
import { generateFseExportWorkbook } from "../src/lib/fseExportWorkbook";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let userId: number;
let warehouseId: number;
let productId: number;
let lotId: number;
const operationIds: number[] = [];
const movementIds: number[] = [];
const monitoringIds: number[] = [];
const exportIds: number[] = [];

async function operation(input: {
  date: string;
  channel: "PACCHI" | "EMPORIO" | "UDS_STRADA" | "MENSA";
  source: number;
  packs?: number;
  meals?: number;
  occasional?: number;
  continuous?: number;
}) {
  const [row] = await db
    .insert(operazioniDistribuzioneMagazzinoTable)
    .values({
      magazzinoId: warehouseId,
      dataDistribuzione: input.date,
      canaleOperativo: input.channel,
      dominioOrigine: "R2_ACCEPTANCE",
      entitaOrigineTipo: input.channel,
      entitaOrigineId: input.source,
      numeroDocumento: `R2-${input.source}`,
      numeroPacchi: input.packs ?? null,
      numeroPasti: input.meals ?? null,
      indigentiSaltuari: input.occasional ?? null,
      indigentiContinuativi: input.continuous ?? null,
      creatoDa: userId,
    })
    .returning({ id: operazioniDistribuzioneMagazzinoTable.id });
  operationIds.push(row.id);
  return row.id;
}

async function distribution(input: {
  date: string;
  operationId: number;
  channel: "PACCHI" | "EMPORIO" | "UDS_STRADA" | "MENSA";
  pieces: string;
}) {
  const [row] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "scarico",
      tipoDettaglio: "r2_acceptance",
      dataMovimento: input.date,
      magazzinoId: warehouseId,
      prodottoId: productId,
      lottoId: lotId,
      quantita: input.pieces,
      quantitaPezzi: input.pieces,
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      operazioneDistribuzioneId: input.operationId,
      canaleOperativo: input.channel,
    })
    .returning({ id: movimentiTable.id });
  movementIds.push(row.id);
  return row.id;
}

async function monitoring(
  month: string,
  date: string,
  channel: "PACCHI" | "STRADA" | "MENSA",
) {
  const [row] = await db
    .insert(rilevazioniMonitoraggioFseTable)
    .values({
      magazzinoId: warehouseId,
      annoMese: month,
      canaleUfficiale: channel,
      dataRiferimento: date,
      minori18: 0,
      fonte: "RILEVAZIONE_MANUALE_VERIFICATA",
      completezza: "COMPLETA",
      creatoDa: userId,
      aggiornatoDa: userId,
    })
    .returning({ id: rilevazioniMonitoraggioFseTable.id });
  monitoringIds.push(row.id);
}

beforeAll(async () => {
  [{ id: userId }] = await db
    .insert(utentiTable)
    .values({
      username: `fse_r2_${suffix}`,
      passwordHash: "x",
      nome: "FSE",
      cognome: "R2",
    })
    .returning({ id: utentiTable.id });
  [{ id: warehouseId }] = await db
    .insert(magazziniTable)
    .values({
      codice: `R2-${suffix}`.slice(0, 20),
      nome: `Acceptance R2 ${suffix}`,
    })
    .returning({ id: magazziniTable.id });
  [{ id: productId }] = await db
    .insert(prodottiTable)
    .values({
      codice: `R2P-${suffix}`.slice(0, 30),
      nome: "Prodotto acceptance R2",
      tipoProdotto: "alimentare",
      unitaMisura: "pz",
      gestioneLotto: true,
    })
    .returning({ id: prodottiTable.id });
  [{ id: lotId }] = await db
    .insert(lottiTable)
    .values({
      prodottoId: productId,
      codiceLotto: `R2-L-${suffix}`.slice(0, 80),
      dataCarico: "2026-08-31",
      quantitaCaricata: "10000",
      quantitaResidua: "9960",
      magazzinoId: warehouseId,
      fsePlus: true,
      fondoOrigine: "FSE_PLUS",
    })
    .returning({ id: lottiTable.id });
  const [opening] = await db
    .insert(movimentiTable)
    .values({
      tipoMovimento: "carico",
      tipoDettaglio: "saldo",
      dataMovimento: "2026-08-31",
      magazzinoId: warehouseId,
      prodottoId: productId,
      lottoId: lotId,
      quantita: "10000",
      quantitaPezzi: "10000",
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "SALDO_INIZIALE",
    })
    .returning({ id: movimentiTable.id });
  movementIds.push(opening.id);
  await monitoring("2026-09", "2026-09-30", "PACCHI");
  await monitoring("2026-09", "2026-09-30", "STRADA");
  await monitoring("2026-10", "2026-10-31", "MENSA");
});

afterAll(async () => {
  if (exportIds.length) {
    await db
      .delete(esportazioniFseIndicatoriTable)
      .where(inArray(esportazioniFseIndicatoriTable.esportazioneId, exportIds));
    await db
      .delete(esportazioniFseSaldiTable)
      .where(inArray(esportazioniFseSaldiTable.esportazioneId, exportIds));
    const events = await db
      .select({ id: esportazioniFseEventiTable.id })
      .from(esportazioniFseEventiTable)
      .where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    if (events.length)
      await db.delete(esportazioniFseRigheTable).where(
        inArray(
          esportazioniFseRigheTable.esportazioneEventoId,
          events.map((row) => row.id),
        ),
      );
    await db
      .delete(esportazioniFseEventiTable)
      .where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    await db
      .delete(esportazioniFseTable)
      .where(inArray(esportazioniFseTable.id, exportIds));
  }
  if (movementIds.length)
    await db
      .delete(movimentiTable)
      .where(inArray(movimentiTable.id, movementIds));
  if (monitoringIds.length)
    await db
      .delete(rilevazioniMonitoraggioFseTable)
      .where(inArray(rilevazioniMonitoraggioFseTable.id, monitoringIds));
  if (operationIds.length)
    await db
      .delete(operazioniDistribuzioneMagazzinoTable)
      .where(inArray(operazioniDistribuzioneMagazzinoTable.id, operationIds));
  await db.delete(lottiTable).where(eq(lottiTable.id, lotId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, productId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, warehouseId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await pool.end();
});

describe("Magazzino 2.0C-R2 — acceptance A/B/C/D e coverage contenuto", () => {
  it("copre periodi consecutivi, arretrato, overlap, replay e late line", async () => {
    const opA = await operation({
      date: "2026-09-01",
      channel: "PACCHI",
      source: 1,
      packs: 1,
      occasional: 2,
      continuous: 3,
    });
    const opB = await operation({
      date: "2026-09-05",
      channel: "EMPORIO",
      source: 2,
      occasional: 1,
      continuous: 4,
    });
    const movementA = await distribution({
      date: "2026-09-01",
      operationId: opA,
      channel: "PACCHI",
      pieces: "10",
    });
    const movementB = await distribution({
      date: "2026-09-05",
      operationId: opB,
      channel: "EMPORIO",
      pieces: "20",
    });
    const septemberInput = {
      magazzinoId: warehouseId,
      dataDa: "2026-09-01",
      dataA: "2026-09-30",
      dataAsOf: "2026-09-30",
      formatCode: FSE_CANONICAL_FORMAT,
      creatoDa: userId,
      includeArretrati: true,
    } as const;
    const september = await createFseExport(septemberInput);
    exportIds.push(september.export.id);
    expect(
      september.report?.events.filter((event) => event.coverageEligible),
    ).toHaveLength(2);
    expect(september.export.stato).toBe("PRONTA_PER_INSERIMENTO_MANUALE");
    const septemberReplay = await createFseExport(septemberInput);
    expect(septemberReplay).toMatchObject({ replayed: true });
    expect(septemberReplay.export.id).toBe(september.export.id);
    await markFseExportEntered({
      exportId: september.export.id,
      actorId: userId,
      version: september.export.versione,
      insertedAt: new Date("2026-10-01T10:00:00Z"),
      externalReference: "R2-SETTEMBRE",
    });

    const opC = await operation({
      date: "2026-09-28",
      channel: "UDS_STRADA",
      source: 3,
      occasional: 5,
    });
    const opD = await operation({
      date: "2026-10-10",
      channel: "MENSA",
      source: 4,
      meals: 12,
      occasional: 2,
      continuous: 6,
    });
    const movementC = await distribution({
      date: "2026-09-28",
      operationId: opC,
      channel: "UDS_STRADA",
      pieces: "3",
    });
    const movementD = await distribution({
      date: "2026-10-10",
      operationId: opD,
      channel: "MENSA",
      pieces: "7",
    });
    const octoberPage = await listFseCanonicalPage({
      magazzinoId: warehouseId,
      dataDa: "2026-10-01",
      dataA: "2026-10-31",
      dataAsOf: "2026-10-31",
      includeArretrati: true,
      projection: "events",
      page: 1,
      pageSize: 20,
    });
    expect(octoberPage.total).toBe(2);
    expect(octoberPage.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operationDistributionId: opC,
          administrativeStatus: "ARRETRATO_NON_RENDICONTATO",
        }),
        expect.objectContaining({
          operationDistributionId: opD,
          administrativeStatus: "DA_RENDICONTARE",
        }),
      ]),
    );
    const octoberInput = {
      magazzinoId: warehouseId,
      dataDa: "2026-10-01",
      dataA: "2026-10-31",
      dataAsOf: "2026-10-31",
      formatCode: FSE_CANONICAL_FORMAT,
      creatoDa: userId,
      includeArretrati: true,
    } as const;
    const october = await createFseExport(octoberInput);
    exportIds.push(october.export.id);
    expect(
      october.report?.lines
        .filter((line) => line.coverageEligible)
        .map((line) => line.movementId)
        .sort(),
    ).toEqual([movementC, movementD].sort());
    expect((await createFseExport(octoberInput)).export.id).toBe(
      october.export.id,
    );
    await expect(
      createFseExport({
        ...octoberInput,
        dataDa: "2026-09-15",
      }),
    ).rejects.toMatchObject<FseReportingError>({
      status: 409,
      message: "NESSUN_DATO_DA_RENDICONTARE",
    });

    const movementL2 = await distribution({
      date: "2026-10-20",
      operationId: opA,
      channel: "PACCHI",
      pieces: "2",
    });
    const correctionPage = await listFseCanonicalPage({
      magazzinoId: warehouseId,
      dataDa: "2026-10-01",
      dataA: "2026-10-31",
      dataAsOf: "2026-10-31",
      includeArretrati: true,
      projection: "events",
      page: 1,
      pageSize: 20,
    });
    expect(correctionPage.rows).toContainEqual(
      expect.objectContaining({
        correctionOfEventKey: `DISTRIBUZIONE:${opA}`,
        administrativeStatus: "CORREZIONE_DA_GESTIRE_MANUALMENTE",
      }),
    );
    const correction = await createFseExport({
      ...octoberInput,
      dataDa: "2026-10-15",
    });
    exportIds.push(correction.export.id);
    const correctionMovementIds = correction.report?.lines
      .filter((line) => line.coverageEligible)
      .map((line) => line.movementId);
    expect(correctionMovementIds).toEqual([movementL2]);
    expect(correctionMovementIds).not.toContain(movementA);
    expect(correctionMovementIds).not.toContain(movementB);
    expect(
      (await generateFseExportWorkbook(october.export.id)).buffer.length,
    ).toBeGreaterThan(0);
    console.info(
      "R2_ACCEPTANCE_IDS",
      JSON.stringify({
        warehouseId,
        septemberExportId: september.export.id,
        octoberExportId: october.export.id,
        correctionExportId: correction.export.id,
        movementA,
        movementB,
        movementC,
        movementD,
        movementL2,
      }),
    );
  });

  it("pagina in SQL e salva a chunk uno snapshot da 5.000 movimenti", async () => {
    await monitoring("2026-11", "2026-11-30", "PACCHI");
    const operationId = await operation({
      date: "2026-11-15",
      channel: "PACCHI",
      source: 5000,
      packs: 5000,
      occasional: 5000,
    });
    const values = Array.from({ length: 5000 }, () => ({
      tipoMovimento: "scarico" as const,
      tipoDettaglio: "r2_performance",
      dataMovimento: "2026-11-15",
      magazzinoId: warehouseId,
      prodottoId: productId,
      lottoId: lotId,
      quantita: "1",
      quantitaPezzi: "1",
      unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS",
      naturaContabile: "DISTRIBUZIONE_FINALE",
      operazioneDistribuzioneId: operationId,
      canaleOperativo: "PACCHI",
    }));
    for (let offset = 0; offset < values.length; offset += 500) {
      const inserted = await db
        .insert(movimentiTable)
        .values(values.slice(offset, offset + 500))
        .returning({ id: movimentiTable.id });
      movementIds.push(...inserted.map((row) => row.id));
    }

    const pageOne = await listFseCanonicalPage({
      magazzinoId: warehouseId,
      dataDa: "2026-11-01",
      dataA: "2026-11-30",
      dataAsOf: "2026-11-30",
      includeArretrati: false,
      projection: "lines",
      page: 1,
      pageSize: 50,
    });
    const pageTwo = await listFseCanonicalPage({
      magazzinoId: warehouseId,
      dataDa: "2026-11-01",
      dataA: "2026-11-30",
      dataAsOf: "2026-11-30",
      includeArretrati: false,
      projection: "lines",
      page: 2,
      pageSize: 50,
    });
    expect(pageOne).toMatchObject({ total: 5000, pageSize: 50 });
    expect(pageOne.rows).toHaveLength(50);
    expect(pageTwo.rows).toHaveLength(50);
    expect(
      pageTwo.rows.some((right) =>
        pageOne.rows.some(
          (left) =>
            (left as { movementId: number }).movementId ===
            (right as { movementId: number }).movementId,
        ),
      ),
    ).toBe(false);

    const snapshot = await createFseExport({
      magazzinoId: warehouseId,
      dataDa: "2026-11-01",
      dataA: "2026-11-30",
      dataAsOf: "2026-11-30",
      formatCode: FSE_CANONICAL_FORMAT,
      creatoDa: userId,
      includeArretrati: false,
    });
    exportIds.push(snapshot.export.id);
    expect(snapshot.report?.lines).toHaveLength(5000);
    expect(snapshot.export.righeTotali).toBe(5000);
  });
});
