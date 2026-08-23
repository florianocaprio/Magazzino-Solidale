/* @vitest-environment node */

import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
  lottiTable,
  magazziniTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  pool,
  prodottiTable,
  utentiTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildFseCanonicalReport,
  canonicalJson,
  canonicalSha256,
  createFseExport,
  deactivateExportCoverage,
  FSE_CANONICAL_FORMAT,
  FSE_CHANNEL_MAP,
} from "../src/lib/fseCanonicalReporting";
import { generateFseExportWorkbook, safeExcelText } from "../src/lib/fseExportWorkbook";

const suffix = `${process.pid}${Date.now().toString(36)}`;
let userId: number;
let magazzinoId: number;
let prodottoId: number;
let lottoId: number;
let operationId: number;
const movementIds: number[] = [];
const exportIds: number[] = [];

beforeAll(async () => {
  const required = await pool.query(`
    SELECT count(*)::int AS count FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN (
      'esportazioni_fse', 'esportazioni_fse_eventi',
      'esportazioni_fse_righe', 'rilevazioni_monitoraggio_fse'
    )
  `);
  if (required.rows[0].count !== 4)
    throw new Error("Applicare la migration Magazzino 2.0C");
  [{ id: userId }] = await db.insert(utentiTable).values({
    username: `fse20c_${suffix}`,
    passwordHash: "x",
    nome: "Test",
    cognome: "FSE",
  }).returning({ id: utentiTable.id });
  [{ id: magazzinoId }] = await db.insert(magazziniTable).values({
    codice: `FSE-${suffix}`.slice(0, 20),
    nome: `Magazzino FSE ${suffix}`,
  }).returning({ id: magazziniTable.id });
  [{ id: prodottoId }] = await db.insert(prodottiTable).values({
    codice: `FSE-P-${suffix}`.slice(0, 30),
    nome: "=Prodotto formula injection",
    tipoProdotto: "alimentare",
    unitaMisura: "pz",
    gestioneLotto: true,
    gestioneScadenza: true,
  }).returning({ id: prodottiTable.id });
  [{ id: lottoId }] = await db.insert(lottiTable).values({
    prodottoId,
    codiceLotto: "LOT-FSE",
    dataScadenza: "2027-12-31",
    dataCarico: "2026-08-01",
    quantitaCaricata: "100.000000",
    quantitaResidua: "80.000000",
    magazzinoId,
    fsePlus: true,
    fondoOrigine: "FSE_PLUS",
  }).returning({ id: lottiTable.id });
  [{ id: operationId }] = await db.insert(operazioniDistribuzioneMagazzinoTable).values({
    magazzinoId,
    dataDistribuzione: "2026-08-10",
    canaleOperativo: "PACCHI",
    dominioOrigine: "TEST_2_0C",
    entitaOrigineTipo: "FIXTURE",
    entitaOrigineId: Number(String(Date.now()).slice(-8)),
    numeroDocumento: "DOC-FSE",
    numeroPacchi: 2,
    numeroPasti: 0,
    indigentiSaltuari: 3,
    indigentiContinuativi: 4,
    creatoDa: userId,
  }).returning({ id: operazioniDistribuzioneMagazzinoTable.id });
  const inserted = await db.insert(movimentiTable).values([
    {
      tipoMovimento: "scarico", tipoDettaglio: "distribuzione", dataMovimento: "2026-08-10",
      magazzinoId, prodottoId, lottoId, quantita: "10", quantitaPezzi: "10",
      quantitaKgLt: "5", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "DISTRIBUZIONE_FINALE",
      dominioOrigine: "TEST_2_0C", entitaOrigineTipo: "FIXTURE", entitaOrigineId: operationId,
      operazioneDistribuzioneId: operationId, canaleOperativo: "PACCHI",
    },
    {
      tipoMovimento: "scarico", tipoDettaglio: "distribuzione", dataMovimento: "2026-08-10",
      magazzinoId, prodottoId, lottoId, quantita: "2", quantitaPezzi: "2",
      quantitaKgLt: "1", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "DISTRIBUZIONE_FINALE",
      dominioOrigine: "TEST_2_0C", entitaOrigineTipo: "FIXTURE", entitaOrigineId: operationId,
      operazioneDistribuzioneId: operationId, canaleOperativo: "PACCHI",
    },
    {
      tipoMovimento: "scarico", tipoDettaglio: "distribuzione", dataMovimento: "2026-08-10",
      magazzinoId, prodottoId, lottoId, quantita: "1", quantitaPezzi: "1",
      quantitaKgLt: "0.5", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FONDO_NAZIONALE", naturaContabile: "DISTRIBUZIONE_FINALE",
      operazioneDistribuzioneId: operationId, canaleOperativo: "PACCHI",
    },
    {
      tipoMovimento: "carico", tipoDettaglio: "saldo", dataMovimento: "2026-08-01",
      magazzinoId, prodottoId, lottoId, quantita: "100", quantitaPezzi: "100",
      quantitaKgLt: "50", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "SALDO_INIZIALE",
    },
    {
      tipoMovimento: "scarico", tipoDettaglio: "scarto", dataMovimento: "2026-08-11",
      magazzinoId, prodottoId, lottoId, quantita: "1", quantitaPezzi: "1",
      quantitaKgLt: "0.5", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "SCARTO", documentoRiferimento: "Scarto verificato",
    },
    {
      tipoMovimento: "scarico", tipoDettaglio: "reso", dataMovimento: "2026-08-12",
      magazzinoId, prodottoId, lottoId, quantita: "1", quantitaPezzi: "1",
      quantitaKgLt: "0.5", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "RESO",
    },
    {
      tipoMovimento: "scarico", tipoDettaglio: "trasferimento", dataMovimento: "2026-08-13",
      magazzinoId, prodottoId, lottoId, quantita: "1", quantitaPezzi: "1",
      quantitaKgLt: "0.5", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
      fondoOrigine: "FSE_PLUS", naturaContabile: "TRASFERIMENTO_INTERNO_USCITA",
    },
  ]).returning({ id: movimentiTable.id });
  movementIds.push(...inserted.map((row) => row.id));
  const [reversal] = await db.insert(movimentiTable).values({
    tipoMovimento: "carico", tipoDettaglio: "storno", dataMovimento: "2026-08-14",
    magazzinoId, prodottoId, lottoId, quantita: "4", quantitaPezzi: "4",
    quantitaKgLt: "2", fattoreKgLtPezzo: "0.5", unitaMisura: "pz",
    fondoOrigine: "FSE_PLUS", naturaContabile: "STORNO",
    movimentoOrigineId: movementIds[0], operazioneDistribuzioneId: operationId,
    canaleOperativo: "PACCHI",
  }).returning({ id: movimentiTable.id });
  movementIds.push(reversal.id);
});

afterAll(async () => {
  if (exportIds.length) {
    const events = await db.select({ id: esportazioniFseEventiTable.id }).from(esportazioniFseEventiTable).where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    if (events.length) await db.delete(esportazioniFseRigheTable).where(inArray(esportazioniFseRigheTable.esportazioneEventoId, events.map((row) => row.id)));
    await db.delete(esportazioniFseEventiTable).where(inArray(esportazioniFseEventiTable.esportazioneId, exportIds));
    await db.delete(esportazioniFseTable).where(inArray(esportazioniFseTable.id, exportIds));
  }
  if (movementIds.length) await db.delete(movimentiTable).where(inArray(movimentiTable.id, movementIds));
  await db.delete(operazioniDistribuzioneMagazzinoTable).where(eq(operazioniDistribuzioneMagazzinoTable.id, operationId));
  await db.delete(lottiTable).where(eq(lottiTable.id, lottoId));
  await db.delete(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  await db.delete(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  await db.delete(utentiTable).where(eq(utentiTable.id, userId));
  await pool.end();
});

describe("Magazzino 2.0C — canonical reporting ed export", () => {
  it("usa JSON/hash canonici indipendenti dall'ordine delle proprietà", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe('{"a":{"c":3,"d":4},"b":2}');
    expect(canonicalSha256({ b: 2, a: 1 })).toBe(canonicalSha256({ a: 1, b: 2 }));
  });

  it("mappa tutti i canali interni ammessi", () => {
    expect(FSE_CHANNEL_MAP).toEqual({
      PACCHI: "PACCHI", RITIRO_SEDE: "PACCHI", DOMICILIARE: "DOMICILIARE",
      EMPORIO: "EMPORIO", MENSA: "MENSA", UDS_STRADA: "STRADA",
    });
  });

  it("include solo FSE_PLUS, conta l'evento una volta e separa lordo/storno", async () => {
    const report = await buildFseCanonicalReport({
      magazzinoId, dataDa: "2026-08-01", dataA: "2026-08-31",
    });
    expect(report.lines.every((line) => line.fund === "FSE_PLUS")).toBe(true);
    const distribution = report.events.find((event) => event.operationDistributionId === operationId);
    expect(distribution).toMatchObject({ packs: 2, occasionalPeople: 3, continuousPeople: 4 });
    expect(report.events.filter((event) => event.operationDistributionId === operationId)).toHaveLength(1);
    expect(distribution?.qualityCodes).toContain("EVENTO_FONDI_MISTI");
    expect(report.lines.find((line) => line.movementId === movementIds[0])?.quantityPiecesSigned).toBe("-10.000000");
    expect(report.lines.find((line) => line.movementId === movementIds.at(-1))?.quantityPiecesSigned).toBe("4.000000");
    expect(report.lines.find((line) => line.accountingNature === "SALDO_INIZIALE")?.reportingDisposition).toBe("ESCLUSO_SALDO_INIZIALE");
    expect(report.lines.find((line) => line.accountingNature === "SCARTO")?.reportingDisposition).toBe("MODIFICA_GIACENZA");
    expect(report.lines.find((line) => line.accountingNature === "RESO")?.reportingDisposition).toBe("RESO_OPC");
    expect(report.lines.find((line) => line.accountingNature === "TRASFERIMENTO_INTERNO_USCITA")?.reportingDisposition).toBe("SOLO_AUDIT_TRASFERIMENTO");
  });

  it("fa replay a cutoff invariato, conserva snapshot e genera XLSX senza formule", async () => {
    const input = {
      magazzinoId, dataDa: "2026-08-01", dataA: "2026-08-31", dataAsOf: "2026-08-31",
      formatCode: FSE_CANONICAL_FORMAT, creatoDa: userId,
    } as const;
    const first = await createFseExport(input);
    exportIds.push(first.export.id);
    const replay = await createFseExport(input);
    expect(replay.replayed).toBe(true);
    expect(replay.export.id).toBe(first.export.id);
    const workbook = await generateFseExportWorkbook(first.export.id);
    expect(workbook.buffer.subarray(0, 2).toString()).toBe("PK");
    expect(safeExcelText("=2+2")).toBe("'=2+2");
    const cancelled = await deactivateExportCoverage(first.export.id, userId, "Nuova elaborazione", first.export.versione);
    expect(cancelled.stato).toBe("ANNULLATA");
    expect(await db.select().from(esportazioniFseEventiTable).where(eq(esportazioniFseEventiTable.esportazioneId, first.export.id))).not.toHaveLength(0);
  });
});
