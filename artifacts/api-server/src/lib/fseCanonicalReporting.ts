import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
  FSE_REPORTING_MODEL_VERSION,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";

export const FSE_CANONICAL_FORMAT = "FSE_CANONICAL_AUDIT_XLSX_V1";
export const FSE_OBSERVED_CONTROL_FORMAT =
  "SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1";
export const FSE_TIMEZONE = "Europe/Rome" as const;

export type FseOfficialActivity =
  | "PACCHI"
  | "DOMICILIARE"
  | "EMPORIO"
  | "MENSA"
  | "STRADA";

export const FSE_CHANNEL_MAP = {
  PACCHI: "PACCHI",
  RITIRO_SEDE: "PACCHI",
  DOMICILIARE: "DOMICILIARE",
  EMPORIO: "EMPORIO",
  MENSA: "MENSA",
  UDS_STRADA: "STRADA",
} as const satisfies Record<string, FseOfficialActivity>;

export type FseCanonicalEvent = {
  eventKey: string;
  contentHash: string;
  eventType: string;
  eventDate: string;
  magazzinoId: number;
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  sourceDomain: string;
  sourceEntityType: string;
  sourceEntityId: number;
  operationDistributionId: number | null;
  caricoMagazzinoId: number | null;
  documentNumber: string | null;
  officialActivity: FseOfficialActivity | null;
  internalChannel: string | null;
  status: string;
  packs: number | null;
  meals: number | null;
  occasionalPeople: number | null;
  continuousPeople: number | null;
  grossStatistics: boolean;
  netStatisticsStatus: "NET" | "GROSS_ONLY" | "NOT_APPLICABLE";
  qualityCodes: string[];
};

export type FseCanonicalLine = {
  lineKey: string;
  contentHash: string;
  eventKey: string;
  movementId: number;
  originalMovementId: number | null;
  movementDate: string;
  accountingNature: string;
  fund: string;
  productId: number;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  lotId: number | null;
  lotCodeSnapshot: string | null;
  expirySnapshot: string | null;
  quantityPiecesSigned: string | null;
  quantityKgLtSigned: string | null;
  factorKgLtPiece: string | null;
  unitOfMeasureSnapshot: string;
  sourceLineage: Record<string, unknown>;
  reportingDisposition: string;
  qualityCodes: string[];
};

export type FseCanonicalReport = {
  modelVersion: typeof FSE_REPORTING_MODEL_VERSION;
  timezone: typeof FSE_TIMEZONE;
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf: string;
  cutoff: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
  events: FseCanonicalEvent[];
  lines: FseCanonicalLine[];
  quality: Array<{ code: string; count: number; blocking: boolean }>;
  canonicalHash: string;
};

export class FseReportingError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type DbExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

type LedgerRow = {
  id: number;
  data_movimento: string;
  magazzino_id: number;
  area_operativa_id: number | null;
  centro_ascolto_id: number | null;
  prodotto_id: number;
  prodotto_codice: string;
  prodotto_nome: string;
  lotto_id: number | null;
  codice_lotto: string | null;
  data_scadenza: string | null;
  quantita: string;
  quantita_pezzi: string | null;
  quantita_kg_lt: string | null;
  fattore_kg_lt_pezzo: string | null;
  unita_misura: string;
  fondo_origine: string;
  natura_contabile: string;
  natura_originale: string | null;
  dominio_origine: string | null;
  entita_origine_tipo: string | null;
  entita_origine_id: number | null;
  riga_origine_id: number | null;
  carico_magazzino_id: number | null;
  origine_carico: string | null;
  operazione_distribuzione_id: number | null;
  canale_operativo: string | null;
  documento_riferimento: string | null;
  op_data: string | null;
  op_dominio: string | null;
  op_entita_tipo: string | null;
  op_entita_id: number | null;
  op_documento: string | null;
  op_pacchi: number | null;
  op_pasti: number | null;
  op_saltuari: number | null;
  op_continuativi: number | null;
  op_stato: string | null;
  movimento_origine_id: number | null;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function canonicalSha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function exact(raw: string | null): string | null {
  if (raw == null) return null;
  return InventoryDecimal.parse(raw, { allowNegative: true }).toDb();
}

function withSign(raw: string | null, sign: -1 | 1): string | null {
  const value = exact(raw);
  if (value == null) return null;
  const absolute = InventoryDecimal.parse(value, { allowNegative: true }).abs();
  return sign === -1 && !absolute.isZero()
    ? `-${absolute.toDb()}`
    : absolute.toDb();
}

function movementSign(row: LedgerRow): -1 | 1 {
  if (row.natura_contabile === "STORNO") {
    return [
      "DISTRIBUZIONE_FINALE",
      "TRASFERIMENTO_INTERNO_USCITA",
      "RETTIFICA_NEGATIVA",
      "SCARTO",
      "RESO",
    ].includes(row.natura_originale ?? "")
      ? 1
      : -1;
  }
  return [
    "DISTRIBUZIONE_FINALE",
    "TRASFERIMENTO_INTERNO_USCITA",
    "RETTIFICA_NEGATIVA",
    "SCARTO",
    "RESO",
  ].includes(row.natura_contabile)
    ? -1
    : 1;
}

function eventType(row: LedgerRow): string {
  if (row.operazione_distribuzione_id != null) return "DISTRIBUZIONE";
  if (row.natura_contabile === "CARICO") return "CARICO";
  if (row.natura_contabile === "RESO") return "RESO_OPC";
  if (["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(row.natura_contabile)) return "MODIFICA_GIACENZA";
  if (row.natura_contabile.startsWith("TRASFERIMENTO_INTERNO_")) return "TRASFERIMENTO_AUDIT";
  if (row.natura_contabile === "SALDO_INIZIALE") return "SALDO_INIZIALE";
  return row.natura_contabile;
}

function disposition(row: LedgerRow): string {
  if (row.natura_contabile === "SALDO_INIZIALE") return "ESCLUSO_SALDO_INIZIALE";
  if (row.natura_contabile.startsWith("TRASFERIMENTO_INTERNO_")) return "SOLO_AUDIT_TRASFERIMENTO";
  if (row.natura_contabile === "CARICO" && row.origine_carico === "AGEA_SIFEAD") return "GIA_PRESENTE_REGISTRO_ESTERNO";
  if (row.natura_contabile === "RESO") return "RESO_OPC";
  if (["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(row.natura_contabile)) return "MODIFICA_GIACENZA";
  if (["DISTRIBUZIONE_FINALE", "STORNO"].includes(row.natura_contabile)) return "DA_RENDICONTARE_DDC";
  return "TRACCIABILITA_INTERNA";
}

function eventKey(row: LedgerRow): string {
  if (row.operazione_distribuzione_id != null)
    return `DISTRIBUZIONE:${row.operazione_distribuzione_id}`;
  if (row.carico_magazzino_id != null) return `CARICO:${row.carico_magazzino_id}`;
  return `MOVIMENTO:${row.id}`;
}

function activity(channel: string | null): FseOfficialActivity | null {
  return channel == null
    ? null
    : (FSE_CHANNEL_MAP[channel as keyof typeof FSE_CHANNEL_MAP] ?? null);
}

const BLOCKING_QUALITY = new Set([
  "OPERAZIONE_DISTRIBUZIONE_MANCANTE",
  "CANALE_FSE_NON_CLASSIFICATO",
  "STATISTICHE_DDC_MANCANTI",
  "LOTTO_MANCANTE",
]);

function qualityForEvent(row: LedgerRow, mixedFund: boolean): string[] {
  const result: string[] = [];
  if (row.natura_contabile === "DISTRIBUZIONE_FINALE" && row.operazione_distribuzione_id == null)
    result.push("OPERAZIONE_DISTRIBUZIONE_MANCANTE");
  if (row.operazione_distribuzione_id != null && activity(row.canale_operativo) == null)
    result.push("CANALE_FSE_NON_CLASSIFICATO");
  if (mixedFund) result.push("EVENTO_FONDI_MISTI");
  const channel = row.canale_operativo;
  const peopleMissing = row.op_saltuari == null && row.op_continuativi == null;
  if (
    ((channel === "PACCHI" || channel === "RITIRO_SEDE") &&
      (row.op_pacchi == null || row.op_saltuari == null || row.op_continuativi == null)) ||
    ((channel === "DOMICILIARE" || channel === "EMPORIO") && peopleMissing) ||
    (channel === "MENSA" && (row.op_pasti == null || peopleMissing)) ||
    (channel === "UDS_STRADA" && row.op_saltuari == null)
  ) result.push("STATISTICHE_DDC_MANCANTI");
  if (row.op_stato === "parzialmente_stornata")
    result.push("STATISTICHE_STORNO_PARZIALE_NON_RIPARTIBILI");
  return [...new Set(result)].sort();
}

function qualityForLine(row: LedgerRow): string[] {
  const result: string[] = [];
  if (row.lotto_id == null) result.push("LOTTO_MANCANTE");
  if (row.quantita_pezzi != null && row.quantita_kg_lt == null && row.fattore_kg_lt_pezzo == null)
    result.push("FATTORE_MANCANTE");
  if (["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(row.natura_contabile) && !row.documento_riferimento)
    result.push("MOTIVAZIONE_MODIFICA_GIACENZA_MANCANTE");
  return result.sort();
}

async function ledgerRows(
  executor: DbExecutor,
  input: { magazzinoId: number; dataDa: string; dataA: string; maxMovimentoId: number },
): Promise<LedgerRow[]> {
  const result = await executor.execute(sql`
    SELECT mv.id, mv.data_movimento, mv.magazzino_id, mg.area_operativa_id,
           mg.centro_ascolto_id, mv.prodotto_id, p.codice AS prodotto_codice,
           p.nome AS prodotto_nome, mv.lotto_id, l.codice_lotto, l.data_scadenza,
           mv.quantita, mv.quantita_pezzi, mv.quantita_kg_lt,
           mv.fattore_kg_lt_pezzo, mv.unita_misura, mv.fondo_origine,
           mv.natura_contabile, original.natura_contabile AS natura_originale,
           mv.dominio_origine, mv.entita_origine_tipo, mv.entita_origine_id,
           mv.riga_origine_id, cr.carico_magazzino_id, cm.origine_carico,
           mv.operazione_distribuzione_id, mv.canale_operativo,
           mv.documento_riferimento, mv.movimento_origine_id,
           op.data_distribuzione AS op_data, op.dominio_origine AS op_dominio,
           op.entita_origine_tipo AS op_entita_tipo, op.entita_origine_id AS op_entita_id,
           op.numero_documento AS op_documento, op.numero_pacchi AS op_pacchi,
           op.numero_pasti AS op_pasti, op.indigenti_saltuari AS op_saltuari,
           op.indigenti_continuativi AS op_continuativi, op.stato AS op_stato
    FROM movimenti mv
    JOIN magazzini mg ON mg.id = mv.magazzino_id
    JOIN prodotti p ON p.id = mv.prodotto_id
    LEFT JOIN lotti l ON l.id = mv.lotto_id
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    LEFT JOIN carichi_magazzino_righe cr ON cr.id = mv.carico_magazzino_riga_id
    LEFT JOIN carichi_magazzino cm ON cm.id = cr.carico_magazzino_id
    LEFT JOIN operazioni_distribuzione_magazzino op ON op.id = mv.operazione_distribuzione_id
    WHERE mv.magazzino_id = ${input.magazzinoId}
      AND mv.data_movimento BETWEEN ${input.dataDa} AND ${input.dataA}
      AND mv.id <= ${input.maxMovimentoId}
    ORDER BY mv.id
  `);
  return result.rows as LedgerRow[];
}

export async function currentFseCutoff(
  executor: DbExecutor,
  magazzinoId: number,
  dataA: string,
): Promise<{ maxMovimentoId: number; maxOperazioneDistribuzioneId: number }> {
  const result = await executor.execute(sql`
    SELECT COALESCE((SELECT MAX(id) FROM movimenti WHERE magazzino_id = ${magazzinoId} AND data_movimento <= ${dataA}), 0)::int AS max_movimento_id,
           COALESCE((SELECT MAX(id) FROM operazioni_distribuzione_magazzino WHERE magazzino_id = ${magazzinoId} AND data_distribuzione <= ${dataA}), 0)::int AS max_operazione_id
  `);
  const row = result.rows[0] as { max_movimento_id: number; max_operazione_id: number };
  return {
    maxMovimentoId: Number(row.max_movimento_id),
    maxOperazioneDistribuzioneId: Number(row.max_operazione_id),
  };
}

export async function buildFseCanonicalReport(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf?: string;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
  executor?: DbExecutor;
}): Promise<FseCanonicalReport> {
  const executor = input.executor ?? db;
  const cutoff = input.cutoff ?? await currentFseCutoff(executor, input.magazzinoId, input.dataA);
  const source = await ledgerRows(executor, { ...input, maxMovimentoId: cutoff.maxMovimentoId });
  const operationFunds = new Map<number, Set<string>>();
  for (const row of source) {
    if (row.operazione_distribuzione_id != null) {
      const funds = operationFunds.get(row.operazione_distribuzione_id) ?? new Set<string>();
      funds.add(row.fondo_origine);
      operationFunds.set(row.operazione_distribuzione_id, funds);
    }
  }
  const fseRows = source.filter((row) => row.fondo_origine === "FSE_PLUS");
  const eventMap = new Map<string, FseCanonicalEvent>();
  const lines: FseCanonicalLine[] = [];
  for (const row of fseRows) {
    const key = eventKey(row);
    if (!eventMap.has(key)) {
      const mixed = row.operazione_distribuzione_id != null &&
        (operationFunds.get(row.operazione_distribuzione_id)?.size ?? 0) > 1;
      const qualityCodes = qualityForEvent(row, mixed);
      const base = {
        eventKey: key,
        eventType: eventType(row),
        eventDate: row.op_data ?? row.data_movimento,
        magazzinoId: row.magazzino_id,
        areaOperativaId: row.area_operativa_id,
        centroAscoltoId: row.centro_ascolto_id,
        sourceDomain: row.op_dominio ?? row.dominio_origine ?? "MAGAZZINO",
        sourceEntityType: row.op_entita_tipo ?? row.entita_origine_tipo ?? "MOVIMENTO",
        sourceEntityId: row.op_entita_id ?? row.entita_origine_id ?? row.id,
        operationDistributionId: row.operazione_distribuzione_id,
        caricoMagazzinoId: row.carico_magazzino_id,
        documentNumber: row.op_documento ?? row.documento_riferimento,
        officialActivity: activity(row.canale_operativo),
        internalChannel: row.canale_operativo,
        status: qualityCodes.some((code) => BLOCKING_QUALITY.has(code)) ? "BLOCCATO" : "RENDICONTABILE",
        packs: row.op_pacchi,
        meals: row.op_pasti,
        occasionalPeople: row.op_saltuari,
        continuousPeople: row.op_continuativi,
        grossStatistics: true,
        netStatisticsStatus: row.op_stato === "parzialmente_stornata" ? "GROSS_ONLY" as const : row.operazione_distribuzione_id == null ? "NOT_APPLICABLE" as const : "NET" as const,
        qualityCodes,
      };
      eventMap.set(key, { ...base, contentHash: canonicalSha256(base) });
    }
    const sign = movementSign(row);
    const lineQuality = qualityForLine(row);
    const base = {
      lineKey: `MOVIMENTO:${row.id}`,
      eventKey: key,
      movementId: row.id,
      originalMovementId: row.movimento_origine_id,
      movementDate: row.data_movimento,
      accountingNature: row.natura_contabile,
      fund: row.fondo_origine,
      productId: row.prodotto_id,
      productCodeSnapshot: row.prodotto_codice,
      productNameSnapshot: row.prodotto_nome,
      lotId: row.lotto_id,
      lotCodeSnapshot: row.codice_lotto,
      expirySnapshot: row.data_scadenza,
      quantityPiecesSigned: withSign(row.quantita_pezzi, sign),
      quantityKgLtSigned: withSign(row.quantita_kg_lt, sign),
      factorKgLtPiece: row.fattore_kg_lt_pezzo,
      unitOfMeasureSnapshot: row.unita_misura,
      sourceLineage: {
        dominioOrigine: row.dominio_origine,
        entitaOrigineTipo: row.entita_origine_tipo,
        entitaOrigineId: row.entita_origine_id,
        rigaOrigineId: row.riga_origine_id,
        caricoMagazzinoId: row.carico_magazzino_id,
        operazioneDistribuzioneId: row.operazione_distribuzione_id,
      },
      reportingDisposition: disposition(row),
      qualityCodes: lineQuality,
    };
    lines.push({ ...base, contentHash: canonicalSha256(base) });
  }
  const events = [...eventMap.values()].sort((left, right) => left.eventKey.localeCompare(right.eventKey));
  lines.sort((left, right) => left.movementId - right.movementId);
  const qualityCounts = new Map<string, { count: number; blocking: boolean }>();
  for (const code of [...events.flatMap((item) => item.qualityCodes), ...lines.flatMap((item) => item.qualityCodes)]) {
    const current = qualityCounts.get(code) ?? { count: 0, blocking: BLOCKING_QUALITY.has(code) };
    current.count += 1;
    qualityCounts.set(code, current);
  }
  const reportBase = {
    modelVersion: FSE_REPORTING_MODEL_VERSION,
    timezone: FSE_TIMEZONE,
    magazzinoId: input.magazzinoId,
    dataDa: input.dataDa,
    dataA: input.dataA,
    dataAsOf: input.dataAsOf ?? input.dataA,
    cutoff,
    events,
    lines,
    quality: [...qualityCounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, item]) => ({ code, ...item })),
  } as const;
  return { ...reportBase, canonicalHash: canonicalSha256(reportBase) };
}

export async function createFseExport(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf: string;
  formatCode: typeof FSE_CANONICAL_FORMAT | typeof FSE_OBSERVED_CONTROL_FORMAT;
  creatoDa: number;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-export:${input.magazzinoId}`}, 0))`);
    const report = await buildFseCanonicalReport({ ...input, executor: tx });
    const idempotencyKey = canonicalSha256({
      magazzinoId: input.magazzinoId,
      dataDa: input.dataDa,
      dataA: input.dataA,
      dataAsOf: input.dataAsOf,
      formatCode: input.formatCode,
      cutoff: report.cutoff,
      canonicalHash: report.canonicalHash,
    });
    const [existing] = await tx.select().from(esportazioniFseTable).where(eq(esportazioniFseTable.idempotencyKey, idempotencyKey));
    if (existing) return { export: existing, report, replayed: true };
    const blocking = report.quality.filter((item) => item.blocking).reduce((sum, item) => sum + item.count, 0);
    const warnings = report.quality.filter((item) => !item.blocking).reduce((sum, item) => sum + item.count, 0);
    const [created] = await tx.insert(esportazioniFseTable).values({
      magazzinoId: input.magazzinoId,
      dataDa: input.dataDa,
      dataA: input.dataA,
      dataAsOf: input.dataAsOf,
      formatCode: input.formatCode,
      modelVersion: FSE_REPORTING_MODEL_VERSION,
      stato: blocking === 0 ? "PRONTA_PER_INSERIMENTO_MANUALE" : "GENERATA",
      maxMovimentoId: report.cutoff.maxMovimentoId,
      maxOperazioneDistribuzioneId: report.cutoff.maxOperazioneDistribuzioneId,
      canonicalHash: report.canonicalHash,
      idempotencyKey,
      eventiTotali: report.events.length,
      righeTotali: report.lines.length,
      righeBloccanti: blocking,
      righeWarning: warnings,
      creatoDa: input.creatoDa,
    }).returning();
    const eventIds = new Map<string, number>();
    for (const event of report.events) {
      const [snapshot] = await tx.insert(esportazioniFseEventiTable).values({
        esportazioneId: created.id,
        eventKey: event.eventKey,
        contentHash: event.contentHash,
        sourceType: event.sourceEntityType,
        sourceId: event.sourceEntityId,
        eventDate: event.eventDate,
        officialActivity: event.officialActivity,
        internalChannel: event.internalChannel,
        documentNumber: event.documentNumber,
        packs: event.packs,
        meals: event.meals,
        occasionalPeople: event.occasionalPeople,
        continuousPeople: event.continuousPeople,
        status: event.status,
        qualityCodesJson: event.qualityCodes,
      }).returning({ id: esportazioniFseEventiTable.id });
      eventIds.set(event.eventKey, snapshot.id);
    }
    for (const line of report.lines) {
      await tx.insert(esportazioniFseRigheTable).values({
        esportazioneEventoId: eventIds.get(line.eventKey)!,
        lineKey: line.lineKey,
        contentHash: line.contentHash,
        movimentoId: line.movementId,
        movimentoOrigineId: line.originalMovementId,
        accountingNature: line.accountingNature,
        fund: line.fund,
        productId: line.productId,
        productCodeSnapshot: line.productCodeSnapshot,
        productNameSnapshot: line.productNameSnapshot,
        lotId: line.lotId,
        lotCodeSnapshot: line.lotCodeSnapshot,
        expirySnapshot: line.expirySnapshot,
        quantityPiecesSigned: line.quantityPiecesSigned,
        quantityKgLtSigned: line.quantityKgLtSigned,
        factorKgLtPiece: line.factorKgLtPiece,
        unitSnapshot: line.unitOfMeasureSnapshot,
        sourceLineageJson: line.sourceLineage,
        reportingDisposition: line.reportingDisposition,
        qualityCodesJson: line.qualityCodes,
      });
    }
    return { export: created, report, replayed: false };
  });
}

export function isFseFormat(value: unknown): value is typeof FSE_CANONICAL_FORMAT | typeof FSE_OBSERVED_CONTROL_FORMAT {
  return value === FSE_CANONICAL_FORMAT || value === FSE_OBSERVED_CONTROL_FORMAT;
}

export function exportScopeCondition(magazzinoIds: number[] | null): SQL | undefined {
  if (magazzinoIds == null) return undefined;
  if (magazzinoIds.length === 0) return sql`false`;
  return sql`${esportazioniFseTable.magazzinoId} = ANY(${magazzinoIds}::int[])`;
}

export async function deactivateExportCoverage(exportId: number, actorId: number, motivation: string, version: number) {
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(esportazioniFseTable).where(and(eq(esportazioniFseTable.id, exportId), eq(esportazioniFseTable.versione, version))).for("update");
    if (!current) throw new FseReportingError(409, "Versione esportazione non corrente");
    if (current.stato === "ANNULLATA") return current;
    await tx.execute(sql`UPDATE esportazioni_fse_righe r SET active_coverage = false FROM esportazioni_fse_eventi e WHERE r.esportazione_evento_id = e.id AND e.esportazione_id = ${exportId}`);
    await tx.update(esportazioniFseEventiTable).set({ activeCoverage: false }).where(eq(esportazioniFseEventiTable.esportazioneId, exportId));
    const [updated] = await tx.update(esportazioniFseTable).set({ stato: "ANNULLATA", annullatoDa: actorId, dataAnnullamento: new Date(), motivazioneAnnullamento: motivation, versione: version + 1 }).where(eq(esportazioniFseTable.id, exportId)).returning();
    return updated;
  });
}
