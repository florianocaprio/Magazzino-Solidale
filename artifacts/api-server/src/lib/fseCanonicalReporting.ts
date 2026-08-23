import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseIndicatoriTable,
  esportazioniFseRigheTable,
  esportazioniFseSaldiTable,
  esportazioniFseTable,
  FSE_REPORTING_MODEL_VERSION,
} from "@workspace/db";
import { createHash } from "node:crypto";
import { and, eq, ne, sql, type SQL } from "drizzle-orm";
import {
  accountingDisposition,
  isAdministrativeDisposition,
  signedInventoryValue,
  signedMovementSql,
} from "./fseAccounting";
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

type StatisticsSnapshot = {
  packs: number | null;
  meals: number | null;
  occasionalPeople: number | null;
  continuousPeople: number | null;
};

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
  grossStatistics: StatisticsSnapshot;
  netStatistics: StatisticsSnapshot;
  netStatisticsStatus: "NET" | "GROSS_ONLY" | "NOT_APPLICABLE";
  qualityCodes: string[];
  administrativeStatus: string;
  arretrato: boolean;
  blocking: boolean;
  correctionOfEventKey: string | null;
  coverageEligible: boolean;
};

export type FseCanonicalLine = {
  lineKey: string;
  contentHash: string;
  eventKey: string;
  movementId: number;
  originalMovementId: number | null;
  movementDate: string;
  accountingNature: string;
  originalAccountingNature: string | null;
  fund: string;
  productId: number;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  lotId: number | null;
  lotCodeSnapshot: string | null;
  expirySnapshot: string | null;
  loadDateSnapshot: string | null;
  sourceDestinationSnapshot: string | null;
  quantityPiecesSigned: string | null;
  quantityKgLtSigned: string | null;
  factorKgLtPiece: string | null;
  unitOfMeasureSnapshot: string;
  sourceLineage: Record<string, unknown>;
  reportingDisposition: string;
  qualityCodes: string[];
  coverageEligible: boolean;
  openingBalancePieces: string | null;
  openingBalanceKgLt: string | null;
  balanceAfterPieces: string | null;
  balanceAfterKgLt: string | null;
};

export type FseIndicatorSnapshot = {
  id: number;
  annoMese: string;
  canaleUfficiale: string;
  dataRiferimento: string;
  values: Record<string, unknown>;
  contentHash: string;
};

export type FseBalanceSnapshot = {
  magazzinoId: number;
  fund: string;
  productId: number;
  productCodeSnapshot: string;
  productNameSnapshot: string;
  lotId: number | null;
  lotCodeSnapshot: string | null;
  pieces: string | null;
  kgLt: string | null;
  contentHash: string;
};

export type FseCanonicalReport = {
  modelVersion: typeof FSE_REPORTING_MODEL_VERSION;
  timezone: typeof FSE_TIMEZONE;
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf: string;
  includeArretrati: boolean;
  cutoff: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
  metadata: Record<string, unknown>;
  events: FseCanonicalEvent[];
  lines: FseCanonicalLine[];
  indicators: FseIndicatorSnapshot[];
  balances: FseBalanceSnapshot[];
  quality: Array<{ code: string; count: number; blocking: boolean }>;
  canonicalHash: string;
};

export class FseReportingError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

type LedgerRow = {
  id: number;
  data_movimento: string;
  magazzino_id: number;
  area_operativa_id: number | null;
  centro_ascolto_id: number | null;
  prodotto_id: number;
  prodotto_codice: string;
  prodotto_nome: string;
  prodotto_gestione_lotto: boolean;
  lotto_id: number | null;
  codice_lotto: string | null;
  lotto_fse_plus: boolean | null;
  data_scadenza: string | null;
  data_carico: string | null;
  quantita: string;
  quantita_pezzi: string | null;
  quantita_kg_lt: string | null;
  fattore_kg_lt_pezzo: string | null;
  unita_misura: string;
  fondo_origine: string;
  natura_contabile: string;
  natura_originale: string | null;
  original_operation_id: number | null;
  original_carico_id: number | null;
  dominio_origine: string | null;
  entita_origine_tipo: string | null;
  entita_origine_id: number | null;
  riga_origine_id: number | null;
  carico_magazzino_id: number | null;
  origine_carico: string | null;
  operazione_distribuzione_id: number | null;
  canale_operativo: string | null;
  documento_riferimento: string | null;
  note: string | null;
  op_data: string | null;
  op_dominio: string | null;
  op_entita_tipo: string | null;
  op_entita_id: number | null;
  op_documento: string | null;
  op_pacchi: number | null;
  op_pasti: number | null;
  op_saltuari: number | null;
  op_continuativi: number | null;
  movimento_origine_id: number | null;
};

export const BLOCKING_FSE_QUALITY = new Set([
  "FONDO_LEGACY_NON_DETERMINATO",
  "OPERAZIONE_DISTRIBUZIONE_MANCANTE",
  "CANALE_FSE_NON_CLASSIFICATO",
  "STATISTICHE_DDC_MANCANTI",
  "EVENTO_FONDI_MISTI",
  "STATISTICHE_STORNO_PARZIALE_NON_RIPARTIBILI",
  "MOTIVAZIONE_MODIFICA_GIACENZA_MANCANTE",
  "SNAPSHOT_INDICATORI_STORICI_MANCANTE",
  "PRODOTTO_NON_MAPPATO",
  "LOTTO_MANCANTE",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
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

function activity(channel: string | null): FseOfficialActivity | null {
  return channel == null
    ? null
    : (FSE_CHANNEL_MAP[channel as keyof typeof FSE_CHANNEL_MAP] ?? null);
}

function originalEventKey(row: LedgerRow): string | null {
  if (row.original_operation_id != null)
    return `DISTRIBUZIONE:${row.original_operation_id}`;
  if (row.original_carico_id != null) return `CARICO:${row.original_carico_id}`;
  if (row.movimento_origine_id != null)
    return `MOVIMENTO:${row.movimento_origine_id}`;
  return null;
}

function eventKey(row: LedgerRow, activeCoverage: Set<string>): string {
  if (row.natura_contabile === "STORNO") {
    const original = originalEventKey(row);
    if (original && !activeCoverage.has(original)) return original;
    return `CORREZIONE:${row.id}`;
  }
  if (row.operazione_distribuzione_id != null)
    return `DISTRIBUZIONE:${row.operazione_distribuzione_id}`;
  if (row.carico_magazzino_id != null)
    return `CARICO:${row.carico_magazzino_id}`;
  return `MOVIMENTO:${row.id}`;
}

function eventType(row: LedgerRow): string {
  if (row.natura_contabile === "STORNO") {
    const disposition = accountingDisposition({
      naturaContabile: row.natura_contabile,
      naturaOriginale: row.natura_originale,
    });
    return disposition.startsWith("CORREZIONE_")
      ? disposition
      : "CORREZIONE_CONTABILE";
  }
  if (row.operazione_distribuzione_id != null) return "DISTRIBUZIONE";
  if (row.natura_contabile === "CARICO") return "CARICO";
  if (row.natura_contabile === "RESO") return "RESO_OPC";
  if (
    ["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(
      row.natura_contabile,
    )
  )
    return "MODIFICA_GIACENZA";
  if (row.natura_contabile.startsWith("TRASFERIMENTO_INTERNO_"))
    return "TRASFERIMENTO_AUDIT";
  if (row.natura_contabile === "SALDO_INIZIALE") return "SALDO_INIZIALE";
  return row.natura_contabile;
}

function qualityForEvent(
  row: LedgerRow,
  mixedFund: boolean,
  partialReversal: boolean,
): string[] {
  const result: string[] = [];
  if (
    row.natura_contabile === "DISTRIBUZIONE_FINALE" &&
    row.operazione_distribuzione_id == null
  )
    result.push("OPERAZIONE_DISTRIBUZIONE_MANCANTE");
  if (
    (row.operazione_distribuzione_id != null ||
      row.original_operation_id != null) &&
    activity(row.canale_operativo) == null
  )
    result.push("CANALE_FSE_NON_CLASSIFICATO");
  if (mixedFund) result.push("EVENTO_FONDI_MISTI");
  const channel = row.canale_operativo;
  const peopleMissing = row.op_saltuari == null && row.op_continuativi == null;
  if (
    ((channel === "PACCHI" || channel === "RITIRO_SEDE") &&
      (row.op_pacchi == null || peopleMissing)) ||
    ((channel === "DOMICILIARE" || channel === "EMPORIO") && peopleMissing) ||
    (channel === "MENSA" && (row.op_pasti == null || peopleMissing)) ||
    (channel === "UDS_STRADA" && row.op_saltuari == null)
  )
    result.push("STATISTICHE_DDC_MANCANTI");
  if (partialReversal)
    result.push("STATISTICHE_STORNO_PARZIALE_NON_RIPARTIBILI");
  return [...new Set(result)].sort();
}

function qualityForLine(row: LedgerRow): string[] {
  const result: string[] = [];
  if (
    row.fondo_origine === "FSE_PLUS" &&
    row.natura_contabile === "CARICO" &&
    row.origine_carico !== "AGEA_SIFEAD"
  )
    result.push("CARICO_FSE_LOCALE_DA_VERIFICARE");
  if (row.prodotto_gestione_lotto && row.lotto_id == null)
    result.push("LOTTO_MANCANTE");
  if (
    ["RETTIFICA_POSITIVA", "RETTIFICA_NEGATIVA", "SCARTO"].includes(
      row.natura_contabile,
    ) &&
    !(row.note?.trim() || row.documento_riferimento?.trim())
  )
    result.push("MOTIVAZIONE_MODIFICA_GIACENZA_MANCANTE");
  return result.sort();
}

async function activeCoverageKeys(
  executor: DbExecutor,
  magazzinoId: number,
): Promise<{
  eventKeys: Set<string>;
  eventHashes: Map<
    string,
    Array<{ contentHash: string; dataDa: string; dataA: string }>
  >;
  lineHashes: Map<string, Set<string>>;
}> {
  const [eventsResult, linesResult] = await Promise.all([
    executor.execute(sql`
    SELECT e.event_key, e.content_hash, x.data_da, x.data_a
    FROM esportazioni_fse_eventi e
    JOIN esportazioni_fse x ON x.id = e.esportazione_id
    WHERE x.magazzino_id = ${magazzinoId}
      AND x.coverage_purpose = 'ADMINISTRATIVE'
      AND x.stato IN ('PRONTA_PER_INSERIMENTO_MANUALE', 'INSERITA_MANUALMENTE')
      AND e.active_coverage = true
  `),
    executor.execute(sql`
    SELECT r.line_key, r.content_hash
    FROM esportazioni_fse_righe r
    JOIN esportazioni_fse_eventi e ON e.id = r.esportazione_evento_id
    JOIN esportazioni_fse x ON x.id = e.esportazione_id
    WHERE x.magazzino_id = ${magazzinoId}
      AND x.coverage_purpose = 'ADMINISTRATIVE'
      AND x.stato IN ('PRONTA_PER_INSERIMENTO_MANUALE', 'INSERITA_MANUALMENTE')
      AND r.active_coverage = true
  `),
  ]);
  const eventHashes = new Map<
    string,
    Array<{ contentHash: string; dataDa: string; dataA: string }>
  >();
  for (const row of eventsResult.rows as Array<{
    event_key: string;
    content_hash: string;
    data_da: string;
    data_a: string;
  }>) {
    eventHashes.set(row.event_key, [
      ...(eventHashes.get(row.event_key) ?? []),
      {
        contentHash: row.content_hash,
        dataDa: row.data_da,
        dataA: row.data_a,
      },
    ]);
  }
  const lineHashes = new Map<string, Set<string>>();
  for (const row of linesResult.rows as Array<{
    line_key: string;
    content_hash: string;
  }>) {
    const hashes = lineHashes.get(row.line_key) ?? new Set<string>();
    hashes.add(row.content_hash);
    lineHashes.set(row.line_key, hashes);
  }
  return { eventKeys: new Set(eventHashes.keys()), eventHashes, lineHashes };
}

function originalEventKeySql(): SQL {
  return sql`CASE
    WHEN original.operazione_distribuzione_id IS NOT NULL
      THEN 'DISTRIBUZIONE:' || original.operazione_distribuzione_id::text
    WHEN ocr.carico_magazzino_id IS NOT NULL
      THEN 'CARICO:' || ocr.carico_magazzino_id::text
    WHEN mv.movimento_origine_id IS NOT NULL
      THEN 'MOVIMENTO:' || mv.movimento_origine_id::text
    ELSE NULL
  END`;
}

function canonicalEventKeySql(): SQL {
  const originalKey = originalEventKeySql();
  const originalIsCovered = sql`EXISTS (
    SELECT 1
    FROM esportazioni_fse_eventi covered_event
    JOIN esportazioni_fse covered_export
      ON covered_export.id = covered_event.esportazione_id
    WHERE covered_event.event_key = ${originalKey}
      AND covered_event.active_coverage = true
      AND covered_export.coverage_purpose = 'ADMINISTRATIVE'
      AND covered_export.stato IN (
        'PRONTA_PER_INSERIMENTO_MANUALE',
        'INSERITA_MANUALMENTE'
      )
  )`;
  return sql`CASE
    WHEN mv.natura_contabile = 'STORNO'
      AND ${originalKey} IS NOT NULL
      AND NOT ${originalIsCovered}
      THEN ${originalKey}
    WHEN mv.natura_contabile = 'STORNO'
      THEN 'CORREZIONE:' || mv.id::text
    WHEN mv.operazione_distribuzione_id IS NOT NULL
      THEN 'DISTRIBUZIONE:' || mv.operazione_distribuzione_id::text
    WHEN cr.carico_magazzino_id IS NOT NULL
      THEN 'CARICO:' || cr.carico_magazzino_id::text
    ELSE 'MOVIMENTO:' || mv.id::text
  END`;
}

function isActiveCoverageSql(eventKey: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM esportazioni_fse_eventi covered_event
    JOIN esportazioni_fse covered_export
      ON covered_export.id = covered_event.esportazione_id
    WHERE covered_event.event_key = ${eventKey}
      AND covered_event.active_coverage = true
      AND covered_export.coverage_purpose = 'ADMINISTRATIVE'
      AND covered_export.stato IN (
        'PRONTA_PER_INSERIMENTO_MANUALE',
        'INSERITA_MANUALMENTE'
      )
  )`;
}

function isActiveLineCoverageSql(movementId: SQL): SQL {
  return sql`EXISTS (
    SELECT 1
    FROM esportazioni_fse_righe covered_line
    JOIN esportazioni_fse_eventi covered_event
      ON covered_event.id = covered_line.esportazione_evento_id
    JOIN esportazioni_fse covered_export
      ON covered_export.id = covered_event.esportazione_id
    WHERE covered_line.line_key = 'MOVIMENTO:' || ${movementId}::text
      AND covered_line.active_coverage = true
      AND covered_export.coverage_purpose = 'ADMINISTRATIVE'
      AND covered_export.stato IN (
        'PRONTA_PER_INSERIMENTO_MANUALE',
        'INSERITA_MANUALMENTE'
      )
  )`;
}

async function ledgerRows(
  executor: DbExecutor,
  input: {
    magazzinoId: number;
    dataDa: string;
    dataA: string;
    includeArretrati: boolean;
    maxMovimentoId: number;
    maxOperazioneDistribuzioneId: number;
    movementIds?: number[];
    eventKeys?: string[];
  },
): Promise<LedgerRow[]> {
  const lowerBound = input.includeArretrati
    ? sql`mv.data_movimento <= ${input.dataA}`
    : sql`mv.data_movimento BETWEEN ${input.dataDa} AND ${input.dataA}`;
  const eventKey = canonicalEventKeySql();
  const selection = input.movementIds
    ? input.movementIds.length
      ? sql`mv.id IN (${sql.join(
          input.movementIds.map((id) => sql`${id}`),
          sql`, `,
        )})`
      : sql`false`
    : input.eventKeys
      ? input.eventKeys.length
        ? sql`${eventKey} IN (${sql.join(
            input.eventKeys.map((key) => sql`${key}`),
            sql`, `,
          )})`
        : sql`false`
      : sql`true`;
  const result = await executor.execute(sql`
    SELECT mv.id, mv.data_movimento, mv.magazzino_id, mg.area_operativa_id,
           mg.centro_ascolto_id, mv.prodotto_id, p.codice AS prodotto_codice,
           p.nome AS prodotto_nome, p.gestione_lotto AS prodotto_gestione_lotto,
           mv.lotto_id, l.codice_lotto, l.data_scadenza, l.data_carico,
           l.fse_plus AS lotto_fse_plus,
           mv.quantita, mv.quantita_pezzi, mv.quantita_kg_lt,
           mv.fattore_kg_lt_pezzo, mv.unita_misura, mv.fondo_origine,
           mv.natura_contabile, original.natura_contabile AS natura_originale,
           original.operazione_distribuzione_id AS original_operation_id,
           ocr.carico_magazzino_id AS original_carico_id,
           mv.dominio_origine, mv.entita_origine_tipo, mv.entita_origine_id,
           mv.riga_origine_id, cr.carico_magazzino_id, cm.origine_carico,
           mv.operazione_distribuzione_id,
           COALESCE(mv.canale_operativo, original.canale_operativo) AS canale_operativo,
           mv.documento_riferimento, mv.note, mv.movimento_origine_id,
           op.data_distribuzione AS op_data, op.dominio_origine AS op_dominio,
           op.entita_origine_tipo AS op_entita_tipo, op.entita_origine_id AS op_entita_id,
           op.numero_documento AS op_documento, op.numero_pacchi AS op_pacchi,
           op.numero_pasti AS op_pasti, op.indigenti_saltuari AS op_saltuari,
           op.indigenti_continuativi AS op_continuativi
    FROM movimenti mv
    JOIN magazzini mg ON mg.id = mv.magazzino_id
    JOIN prodotti p ON p.id = mv.prodotto_id
    LEFT JOIN lotti l ON l.id = mv.lotto_id
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    LEFT JOIN carichi_magazzino_righe ocr ON ocr.id = original.carico_magazzino_riga_id
    LEFT JOIN carichi_magazzino_righe cr ON cr.id = mv.carico_magazzino_riga_id
    LEFT JOIN carichi_magazzino cm ON cm.id = cr.carico_magazzino_id
    LEFT JOIN operazioni_distribuzione_magazzino op
      ON op.id = COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id)
     AND op.id <= ${input.maxOperazioneDistribuzioneId}
    WHERE mv.magazzino_id = ${input.magazzinoId}
      AND ${lowerBound}
      AND mv.id <= ${input.maxMovimentoId}
      AND ${selection}
      AND (
        COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id) IS NULL
        OR COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id) <= ${input.maxOperazioneDistribuzioneId}
      )
    ORDER BY mv.id
  `);
  return result.rows as LedgerRow[];
}

export async function currentFseCutoff(
  executor: DbExecutor,
  magazzinoId: number,
  dataA: string,
): Promise<{
  maxMovimentoId: number;
  maxOperazioneDistribuzioneId: number;
}> {
  const result = await executor.execute(sql`
    SELECT COALESCE((SELECT MAX(id) FROM movimenti
      WHERE magazzino_id = ${magazzinoId} AND data_movimento <= ${dataA}), 0)::int AS max_movimento_id,
      COALESCE((SELECT MAX(id) FROM operazioni_distribuzione_magazzino
      WHERE magazzino_id = ${magazzinoId} AND data_distribuzione <= ${dataA}), 0)::int AS max_operazione_id
  `);
  const row = result.rows[0] as {
    max_movimento_id: number;
    max_operazione_id: number;
  };
  return {
    maxMovimentoId: Number(row.max_movimento_id),
    maxOperazioneDistribuzioneId: Number(row.max_operazione_id),
  };
}

export type FseCanonicalPageProjection = "events" | "lines" | "quality";

export type FseCanonicalPageFilters = {
  statoRendicontazione?: string;
  canale?: string;
  fondo?: string;
  prodottoId?: number;
  qualityCode?: string;
};

function canonicalCandidateRowsSql(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  includeArretrati: boolean;
  maxMovimentoId: number;
  maxOperazioneDistribuzioneId: number;
}): SQL {
  const lowerBound = input.includeArretrati
    ? sql`mv.data_movimento <= ${input.dataA}`
    : sql`mv.data_movimento BETWEEN ${input.dataDa} AND ${input.dataA}`;
  const eventKey = canonicalEventKeySql();
  const originalKey = originalEventKeySql();
  const originalCovered = isActiveCoverageSql(originalKey);
  const activeCoverage = isActiveLineCoverageSql(sql`mv.id`);
  const channel = sql`COALESCE(mv.canale_operativo, original.canale_operativo)`;
  const officialChannel = sql`CASE ${channel}
    WHEN 'PACCHI' THEN 'PACCHI'
    WHEN 'RITIRO_SEDE' THEN 'PACCHI'
    WHEN 'DOMICILIARE' THEN 'DOMICILIARE'
    WHEN 'EMPORIO' THEN 'EMPORIO'
    WHEN 'MENSA' THEN 'MENSA'
    WHEN 'UDS_STRADA' THEN 'STRADA'
    ELSE NULL
  END`;
  const eventDate = sql`CASE
    WHEN mv.natura_contabile = 'STORNO' AND ${originalCovered}
      THEN mv.data_movimento
    ELSE COALESCE(op.data_distribuzione, mv.data_movimento)
  END`;
  const peopleMissing = sql`op.indigenti_saltuari IS NULL
    AND op.indigenti_continuativi IS NULL`;
  const operationMissing = sql`mv.natura_contabile = 'DISTRIBUZIONE_FINALE'
    AND mv.operazione_distribuzione_id IS NULL`;
  const channelMissing = sql`COALESCE(
      mv.operazione_distribuzione_id,
      original.operazione_distribuzione_id
    ) IS NOT NULL AND ${officialChannel} IS NULL`;
  const statisticsMissing = sql`(
    (${channel} IN ('PACCHI', 'RITIRO_SEDE')
      AND (op.numero_pacchi IS NULL OR (${peopleMissing})))
    OR (${channel} IN ('DOMICILIARE', 'EMPORIO') AND (${peopleMissing}))
    OR (${channel} = 'MENSA'
      AND (op.numero_pasti IS NULL OR (${peopleMissing})))
    OR (${channel} = 'UDS_STRADA' AND op.indigenti_saltuari IS NULL)
  )`;
  const lotMissing = sql`p.gestione_lotto = true AND mv.lotto_id IS NULL`;
  const adjustmentReasonMissing = sql`mv.natura_contabile IN (
      'RETTIFICA_POSITIVA', 'RETTIFICA_NEGATIVA', 'SCARTO'
    ) AND COALESCE(NULLIF(btrim(mv.note), ''), NULLIF(btrim(mv.documento_riferimento), '')) IS NULL`;
  const mixedFund = sql`COALESCE(
      mv.operazione_distribuzione_id,
      original.operazione_distribuzione_id
    ) IS NOT NULL AND EXISTS (
      SELECT 1 FROM movimenti mixed
      WHERE mixed.operazione_distribuzione_id = COALESCE(
        mv.operazione_distribuzione_id,
        original.operazione_distribuzione_id
      ) AND mixed.fondo_origine <> mv.fondo_origine
    )`;
  const monitoringMissing = sql`${officialChannel} IN ('PACCHI', 'MENSA', 'STRADA')
    AND NOT EXISTS (
      SELECT 1 FROM rilevazioni_monitoraggio_fse monitoring
      WHERE monitoring.magazzino_id = mv.magazzino_id
        AND monitoring.anno_mese = to_char(${eventDate}::date, 'YYYY-MM')
        AND monitoring.canale_ufficiale = ${officialChannel}
        AND monitoring.data_riferimento <= ${input.dataA}
    )`;
  const coverageEligible = sql`(
    mv.natura_contabile IN (
      'DISTRIBUZIONE_FINALE', 'RESO', 'RETTIFICA_POSITIVA',
      'RETTIFICA_NEGATIVA', 'SCARTO'
    ) OR (
      mv.natura_contabile = 'STORNO'
      AND COALESCE(original.natura_contabile, '') NOT LIKE 'TRASFERIMENTO_INTERNO_%'
    )
  )`;
  const qualityCodes = sql`array_remove(ARRAY[
    CASE WHEN ${operationMissing} THEN 'OPERAZIONE_DISTRIBUZIONE_MANCANTE' END,
    CASE WHEN ${channelMissing} THEN 'CANALE_FSE_NON_CLASSIFICATO' END,
    CASE WHEN ${statisticsMissing} THEN 'STATISTICHE_DDC_MANCANTI' END,
    CASE WHEN ${mixedFund} THEN 'EVENTO_FONDI_MISTI' END,
    CASE WHEN ${lotMissing} THEN 'LOTTO_MANCANTE' END,
    CASE WHEN ${adjustmentReasonMissing} THEN 'MOTIVAZIONE_MODIFICA_GIACENZA_MANCANTE' END,
    CASE WHEN ${monitoringMissing} THEN 'SNAPSHOT_INDICATORI_STORICI_MANCANTE' END,
    CASE WHEN mv.fondo_origine = 'NESSUN_FONDO' AND l.fse_plus = true
      THEN 'FONDO_LEGACY_NON_DETERMINATO' END
  ]::text[], NULL)`;
  return sql`
    SELECT mv.id, ${eventKey} AS event_key, ${eventDate}::date AS event_date,
           mv.fondo_origine, mv.prodotto_id, ${channel} AS internal_channel,
           ${officialChannel} AS official_channel, ${activeCoverage} AS active_coverage,
           ${coverageEligible} AS coverage_eligible,
           (${operationMissing} OR ${channelMissing} OR ${statisticsMissing}
             OR ${mixedFund} OR ${lotMissing} OR ${adjustmentReasonMissing}
             OR ${monitoringMissing}) AS blocking,
           ${qualityCodes} AS quality_codes
    FROM movimenti mv
    JOIN prodotti p ON p.id = mv.prodotto_id
    LEFT JOIN lotti l ON l.id = mv.lotto_id
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    LEFT JOIN carichi_magazzino_righe ocr
      ON ocr.id = original.carico_magazzino_riga_id
    LEFT JOIN carichi_magazzino_righe cr
      ON cr.id = mv.carico_magazzino_riga_id
    LEFT JOIN operazioni_distribuzione_magazzino op
      ON op.id = COALESCE(
        mv.operazione_distribuzione_id,
        original.operazione_distribuzione_id
      )
     AND op.id <= ${input.maxOperazioneDistribuzioneId}
    WHERE mv.magazzino_id = ${input.magazzinoId}
      AND ${lowerBound}
      AND mv.id <= ${input.maxMovimentoId}
      AND (
        COALESCE(
          mv.operazione_distribuzione_id,
          original.operazione_distribuzione_id
        ) IS NULL
        OR COALESCE(
          mv.operazione_distribuzione_id,
          original.operazione_distribuzione_id
        ) <= ${input.maxOperazioneDistribuzioneId}
      )
  `;
}

function queueFilterSql(filters: FseCanonicalPageFilters): SQL {
  const conditions: SQL[] = [
    sql`candidate.fondo_origine = 'FSE_PLUS'`,
    sql`candidate.active_coverage = false`,
    sql`candidate.coverage_eligible = true`,
  ];
  if (filters.fondo)
    conditions.push(sql`candidate.fondo_origine = ${filters.fondo}`);
  if (filters.prodottoId)
    conditions.push(sql`candidate.prodotto_id = ${filters.prodottoId}`);
  if (filters.canale)
    conditions.push(sql`(${filters.canale} = candidate.official_channel
      OR ${filters.canale} = candidate.internal_channel)`);
  if (filters.qualityCode)
    conditions.push(sql`${filters.qualityCode} = ANY(candidate.quality_codes)`);
  return and(...conditions) ?? sql`true`;
}

export async function listFseCanonicalPage(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf?: string;
  includeArretrati: boolean;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
  projection: FseCanonicalPageProjection;
  page: number;
  pageSize: number;
  filters?: FseCanonicalPageFilters;
}): Promise<{
  page: number;
  pageSize: number;
  total: number;
  rows: unknown[];
  summary: Record<string, unknown>;
}> {
  const dataAsOf = input.dataAsOf ?? input.dataA;
  const cutoff =
    input.cutoff ?? (await currentFseCutoff(db, input.magazzinoId, dataAsOf));
  const candidate = canonicalCandidateRowsSql({
    ...input,
    ...cutoff,
  });
  const filters = input.filters ?? {};
  const filtered = queueFilterSql(filters);
  const offset = (input.page - 1) * input.pageSize;
  const stateFilter =
    filters.statoRendicontazione == null
      ? sql`true`
      : filters.statoRendicontazione === "BLOCCATO"
        ? sql`event_summary.blocking = true`
        : filters.statoRendicontazione === "ARRETRATO_NON_RENDICONTATO"
          ? sql`event_summary.blocking = false AND event_summary.event_date < ${input.dataDa}::date`
          : filters.statoRendicontazione === "DA_RENDICONTARE"
            ? sql`event_summary.blocking = false AND event_summary.event_date >= ${input.dataDa}::date`
            : sql`false`;

  if (input.projection === "quality") {
    const result = await db.execute(sql`
      WITH candidate AS (${candidate}), filtered AS (
        SELECT * FROM candidate WHERE ${filtered}
      ), expanded AS (
        SELECT DISTINCT event_key, unnest(quality_codes) AS code FROM filtered
      ), totals AS (
        SELECT code, count(*)::int AS count
        FROM expanded GROUP BY code
      )
      SELECT code, count, (code IN (${sql.join(
        [...BLOCKING_FSE_QUALITY].map((code) => sql`${code}`),
        sql`, `,
      )})) AS blocking,
             count(*) OVER()::int AS total
      FROM totals ORDER BY code LIMIT ${input.pageSize} OFFSET ${offset}
    `);
    const rows = result.rows as Array<Record<string, unknown>>;
    const total = rows.length
      ? Number(rows[0].total)
      : Number(
          (
            await db.execute(sql`
              WITH candidate AS (${candidate}), filtered AS (
                SELECT * FROM candidate WHERE ${filtered}
              )
              SELECT count(DISTINCT code)::int AS total
              FROM filtered CROSS JOIN LATERAL unnest(quality_codes) code
            `)
          ).rows[0]?.total ?? 0,
        );
    return {
      page: input.page,
      pageSize: input.pageSize,
      total,
      rows: rows.map(({ total: _total, ...row }) => row),
      summary: { cutoff },
    };
  }

  let eventKeys: string[] = [];
  let total = 0;
  let selectedMovementIds: number[] | null = null;

  if (input.projection === "events") {
    const eventRows = await db.execute(sql`
      WITH candidate AS (${candidate}), filtered AS (
        SELECT * FROM candidate WHERE ${filtered}
      ), event_summary AS (
        SELECT event_key, min(id)::int AS first_id, min(event_date) AS event_date,
               bool_or(blocking) AS blocking
        FROM filtered GROUP BY event_key
      )
      SELECT event_key, count(*) OVER()::int AS total
      FROM event_summary
      WHERE ${stateFilter}
      ORDER BY first_id, event_key
      LIMIT ${input.pageSize} OFFSET ${offset}
    `);
    eventKeys = (eventRows.rows as Array<{ event_key: string }>).map(
      (row) => row.event_key,
    );
    total = Number(
      (eventRows.rows[0] as { total?: number } | undefined)?.total ?? 0,
    );
    if (eventRows.rows.length === 0) {
      const countRows = await db.execute(sql`
        WITH candidate AS (${candidate}), filtered AS (
          SELECT * FROM candidate WHERE ${filtered}
        ), event_summary AS (
          SELECT event_key, min(event_date) AS event_date,
                 bool_or(blocking) AS blocking
          FROM filtered GROUP BY event_key
        )
        SELECT count(*)::int AS total FROM event_summary WHERE ${stateFilter}
      `);
      total = Number(countRows.rows[0]?.total ?? 0);
    }
  } else {
    const lineRows = await db.execute(sql`
      WITH candidate AS (${candidate}), filtered AS (
        SELECT * FROM candidate WHERE ${filtered}
      ), event_summary AS (
        SELECT event_key, min(event_date) AS event_date, bool_or(blocking) AS blocking
        FROM filtered GROUP BY event_key
      )
      SELECT filtered.id, filtered.event_key, count(*) OVER()::int AS total
      FROM filtered JOIN event_summary USING (event_key)
      WHERE ${stateFilter}
      ORDER BY filtered.id
      LIMIT ${input.pageSize} OFFSET ${offset}
    `);
    selectedMovementIds = (
      lineRows.rows as Array<{ id: number; event_key: string }>
    ).map((row) => Number(row.id));
    eventKeys = [
      ...new Set(
        (lineRows.rows as Array<{ event_key: string }>).map(
          (row) => row.event_key,
        ),
      ),
    ];
    total = Number(
      (lineRows.rows[0] as { total?: number } | undefined)?.total ?? 0,
    );
    if (lineRows.rows.length === 0) {
      const countRows = await db.execute(sql`
        WITH candidate AS (${candidate}), filtered AS (
          SELECT * FROM candidate WHERE ${filtered}
        ), event_summary AS (
          SELECT event_key, min(event_date) AS event_date,
                 bool_or(blocking) AS blocking
          FROM filtered GROUP BY event_key
        )
        SELECT count(*)::int AS total
        FROM filtered JOIN event_summary USING (event_key)
        WHERE ${stateFilter}
      `);
      total = Number(countRows.rows[0]?.total ?? 0);
    }
  }

  if (eventKeys.length === 0) {
    return {
      page: input.page,
      pageSize: input.pageSize,
      total,
      rows: [],
      summary: { cutoff },
    };
  }
  const report = await buildFseCanonicalReport({
    ...input,
    dataAsOf,
    cutoff,
    ...(input.projection === "events"
      ? { eventKeys }
      : { movementIds: selectedMovementIds! }),
    excludeCovered: true,
  });
  const rows =
    input.projection === "events"
      ? eventKeys
          .map((key) =>
            report.events.find(
              (event) =>
                event.eventKey === key || event.correctionOfEventKey === key,
            ),
          )
          .filter((event): event is FseCanonicalEvent => event != null)
      : report.lines.filter((line) =>
          selectedMovementIds!.includes(line.movementId),
        );
  return {
    page: input.page,
    pageSize: input.pageSize,
    total,
    rows,
    summary: {
      cutoff,
      bloccanti: rows.filter(
        (row) =>
          "blocking" in row &&
          (row as { blocking?: boolean }).blocking === true,
      ).length,
    },
  };
}

async function loadMetadata(
  executor: DbExecutor,
  magazzinoId: number,
): Promise<Record<string, unknown>> {
  const result = await executor.execute(sql`
    SELECT mg.id AS "magazzinoId", mg.nome AS "magazzinoNome",
           ao.id AS "areaOperativaId", ao.nome AS "areaOperativaNome"
    FROM magazzini mg
    LEFT JOIN aree_operative ao ON ao.id = mg.area_operativa_id
    WHERE mg.id = ${magazzinoId}
  `);
  return (result.rows[0] ?? { magazzinoId }) as Record<string, unknown>;
}

async function loadIndicators(
  executor: DbExecutor,
  input: {
    magazzinoId: number;
    dataDa: string;
    dataAsOf: string;
    maxOperazioneDistribuzioneId: number;
  },
): Promise<FseIndicatorSnapshot[]> {
  const result = await executor.execute(sql`
    SELECT id, anno_mese, canale_ufficiale, data_riferimento,
           minori_18, giovani_18_29, donne, over_65, persone_disabilita,
           cittadini_paesi_terzi, origine_straniera_minoranze,
           senzatetto_esclusione_abitativa, totale_saltuari,
           fonte, completezza, versione, note_audit
    FROM rilevazioni_monitoraggio_fse
    WHERE magazzino_id = ${input.magazzinoId}
      AND data_riferimento BETWEEN ${input.dataDa} AND ${input.dataAsOf}
      AND (operazione_distribuzione_id IS NULL
        OR operazione_distribuzione_id <= ${input.maxOperazioneDistribuzioneId})
    ORDER BY anno_mese, canale_ufficiale, id
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const values = {
      minori18: row.minori_18,
      giovani18_29: row.giovani_18_29,
      donne: row.donne,
      over65: row.over_65,
      personeDisabilita: row.persone_disabilita,
      cittadiniPaesiTerzi: row.cittadini_paesi_terzi,
      origineStranieraMinoranze: row.origine_straniera_minoranze,
      senzatettoEsclusioneAbitativa: row.senzatetto_esclusione_abitativa,
      totaleSaltuari: row.totale_saltuari,
      fonte: row.fonte,
      completezza: row.completezza,
      versione: row.versione,
      noteAudit: row.note_audit,
    };
    const base = {
      id: Number(row.id),
      annoMese: String(row.anno_mese),
      canaleUfficiale: String(row.canale_ufficiale),
      dataRiferimento: String(row.data_riferimento),
      values,
    };
    return { ...base, contentHash: canonicalSha256(base) };
  });
}

export async function loadFseBalances(
  executor: DbExecutor,
  input: {
    magazzinoId: number;
    dataAsOf: string;
    maxMovimentoId: number;
    maxOperazioneDistribuzioneId: number;
  },
): Promise<FseBalanceSnapshot[]> {
  const pieces = signedMovementSql(
    sql`mv.quantita_pezzi`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const kgLt = signedMovementSql(
    sql`mv.quantita_kg_lt`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const result = await executor.execute(sql`
    SELECT mv.magazzino_id, mv.fondo_origine, mv.prodotto_id,
           p.codice AS prodotto_codice, p.nome AS prodotto_nome,
           mv.lotto_id, l.codice_lotto,
           SUM(${pieces})::text AS pieces,
           SUM(${kgLt})::text AS kg_lt
    FROM movimenti mv
    JOIN prodotti p ON p.id = mv.prodotto_id
    LEFT JOIN lotti l ON l.id = mv.lotto_id
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    WHERE mv.magazzino_id = ${input.magazzinoId}
      AND mv.fondo_origine = 'FSE_PLUS'
      AND mv.data_movimento <= ${input.dataAsOf}
      AND mv.id <= ${input.maxMovimentoId}
      AND (
        COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id) IS NULL
        OR COALESCE(mv.operazione_distribuzione_id, original.operazione_distribuzione_id) <= ${input.maxOperazioneDistribuzioneId}
      )
    GROUP BY mv.magazzino_id, mv.fondo_origine, mv.prodotto_id,
             p.codice, p.nome, mv.lotto_id, l.codice_lotto
    ORDER BY mv.prodotto_id, mv.lotto_id NULLS LAST
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const base = {
      magazzinoId: Number(row.magazzino_id),
      fund: String(row.fondo_origine),
      productId: Number(row.prodotto_id),
      productCodeSnapshot: String(row.prodotto_codice),
      productNameSnapshot: String(row.prodotto_nome),
      lotId: row.lotto_id == null ? null : Number(row.lotto_id),
      lotCodeSnapshot:
        row.codice_lotto == null ? null : String(row.codice_lotto),
      pieces: row.pieces == null ? null : String(row.pieces),
      kgLt: row.kg_lt == null ? null : String(row.kg_lt),
    };
    return { ...base, contentHash: canonicalSha256(base) };
  });
}

async function loadProgressiveBalances(
  executor: DbExecutor,
  input: {
    magazzinoId: number;
    dataAsOf: string;
    maxMovimentoId: number;
    movementIds: number[];
  },
): Promise<
  Map<
    number,
    {
      openingPieces: string | null;
      openingKgLt: string | null;
      afterPieces: string | null;
      afterKgLt: string | null;
    }
  >
> {
  if (input.movementIds.length === 0) return new Map();
  const pieces = signedMovementSql(
    sql`mv.quantita_pezzi`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const kgLt = signedMovementSql(
    sql`mv.quantita_kg_lt`,
    sql`mv.natura_contabile`,
    sql`original.natura_contabile`,
  );
  const result = await executor.execute(sql`
    WITH signed AS (
      SELECT mv.id, mv.data_movimento, mv.fondo_origine, mv.prodotto_id,
             COALESCE(mv.lotto_id, 0) AS lotto_key,
             CASE WHEN mv.quantita_pezzi IS NULL THEN NULL ELSE ${pieces} END AS pieces,
             CASE WHEN mv.quantita_kg_lt IS NULL THEN NULL ELSE ${kgLt} END AS kg_lt
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      WHERE mv.magazzino_id = ${input.magazzinoId}
        AND mv.id <= ${input.maxMovimentoId}
        AND mv.data_movimento <= ${input.dataAsOf}
    ), progressive AS (
      SELECT *,
        CASE WHEN count(pieces) OVER balance_window = 0 THEN NULL
          ELSE sum(pieces) OVER balance_window END AS after_pieces,
        CASE WHEN count(kg_lt) OVER balance_window = 0 THEN NULL
          ELSE sum(kg_lt) OVER balance_window END AS after_kg_lt
      FROM signed
      WINDOW balance_window AS (
        PARTITION BY fondo_origine, prodotto_id, lotto_key
        ORDER BY data_movimento, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      )
    )
    SELECT id,
      CASE WHEN after_pieces IS NULL THEN NULL ELSE after_pieces - COALESCE(pieces, 0) END AS opening_pieces,
      CASE WHEN after_kg_lt IS NULL THEN NULL ELSE after_kg_lt - COALESCE(kg_lt, 0) END AS opening_kg_lt,
      after_pieces, after_kg_lt
    FROM progressive
    WHERE id IN (${sql.join(
      input.movementIds.map((id) => sql`${id}`),
      sql`, `,
    )})
  `);
  return new Map(
    (result.rows as Array<Record<string, unknown>>).map((row) => [
      Number(row.id),
      {
        openingPieces:
          row.opening_pieces == null ? null : String(row.opening_pieces),
        openingKgLt:
          row.opening_kg_lt == null ? null : String(row.opening_kg_lt),
        afterPieces: row.after_pieces == null ? null : String(row.after_pieces),
        afterKgLt: row.after_kg_lt == null ? null : String(row.after_kg_lt),
      },
    ]),
  );
}

function addDecimal(total: InventoryDecimal, value: string): InventoryDecimal {
  return total.add(
    InventoryDecimal.parse(value, { allowNegative: true }).abs(),
  );
}

function reversalState(rows: LedgerRow[]): "NONE" | "PARTIAL" | "FULL" {
  let originals = InventoryDecimal.zero();
  let reversals = InventoryDecimal.zero();
  for (const row of rows) {
    if (row.natura_contabile === "DISTRIBUZIONE_FINALE")
      originals = addDecimal(originals, row.quantita);
    if (
      row.natura_contabile === "STORNO" &&
      row.natura_originale === "DISTRIBUZIONE_FINALE"
    )
      reversals = addDecimal(reversals, row.quantita);
  }
  if (reversals.isZero()) return "NONE";
  return originals.isPositive() && originals.compare(reversals) === 0
    ? "FULL"
    : "PARTIAL";
}

function zeroStatistics(): StatisticsSnapshot {
  return {
    packs: 0,
    meals: 0,
    occasionalPeople: 0,
    continuousPeople: 0,
  };
}

export async function buildFseCanonicalReport(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf?: string;
  includeArretrati?: boolean;
  excludeCovered?: boolean;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
  movementIds?: number[];
  eventKeys?: string[];
  executor?: DbExecutor;
}): Promise<FseCanonicalReport> {
  const executor = input.executor ?? db;
  const includeArretrati = input.includeArretrati ?? false;
  const dataAsOf = input.dataAsOf ?? input.dataA;
  const cutoff =
    input.cutoff ??
    (await currentFseCutoff(executor, input.magazzinoId, dataAsOf));
  const covered = await activeCoverageKeys(executor, input.magazzinoId);
  const source = await ledgerRows(executor, {
    ...input,
    includeArretrati,
    ...cutoff,
  });
  const indicatorDataDa = includeArretrati
    ? source.reduce(
        (earliest, row) =>
          (row.op_data ?? row.data_movimento) < earliest
            ? (row.op_data ?? row.data_movimento)
            : earliest,
        input.dataDa,
      )
    : input.dataDa;
  const [metadata, indicators, balances] = await Promise.all([
    loadMetadata(executor, input.magazzinoId),
    loadIndicators(executor, {
      magazzinoId: input.magazzinoId,
      dataDa: indicatorDataDa,
      dataAsOf,
      maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
    }),
    loadFseBalances(executor, {
      magazzinoId: input.magazzinoId,
      dataAsOf,
      maxMovimentoId: cutoff.maxMovimentoId,
      maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
    }),
  ]);
  const operationFunds = new Map<number, Set<string>>();
  for (const row of source) {
    const operationId =
      row.operazione_distribuzione_id ?? row.original_operation_id;
    if (operationId != null) {
      const funds = operationFunds.get(operationId) ?? new Set<string>();
      funds.add(row.fondo_origine);
      operationFunds.set(operationId, funds);
    }
  }
  const keyed = source
    .filter((row) => row.fondo_origine === "FSE_PLUS")
    .map((row) => ({ row, key: eventKey(row, covered.eventKeys) }));
  const grouped = new Map<string, LedgerRow[]>();
  for (const { row, key } of keyed)
    grouped.set(key, [...(grouped.get(key) ?? []), row]);

  const events: FseCanonicalEvent[] = [];
  const lines: FseCanonicalLine[] = [];
  for (const [key, eventRows] of grouped) {
    const row = eventRows[0];
    const operationId =
      row.operazione_distribuzione_id ?? row.original_operation_id;
    const reversal = reversalState(eventRows);
    const mixed =
      operationId != null && (operationFunds.get(operationId)?.size ?? 0) > 1;
    const qualityCodes = qualityForEvent(row, mixed, reversal === "PARTIAL");
    const grossStatistics: StatisticsSnapshot = {
      packs: row.op_pacchi,
      meals: row.op_pasti,
      occasionalPeople: row.op_saltuari,
      continuousPeople: row.op_continuativi,
    };
    const correctionOfEventKey =
      row.natura_contabile === "STORNO" ? originalEventKey(row) : null;
    const correctionAfterCoverage =
      correctionOfEventKey != null &&
      covered.eventKeys.has(correctionOfEventKey);
    const arretrato = (row.op_data ?? row.data_movimento) < input.dataDa;
    const blocking = qualityCodes.some((code) =>
      BLOCKING_FSE_QUALITY.has(code),
    );
    const eventBase = {
      eventKey: key,
      eventType: eventType(row),
      eventDate:
        correctionAfterCoverage || row.op_data == null
          ? row.data_movimento
          : row.op_data,
      magazzinoId: row.magazzino_id,
      areaOperativaId: row.area_operativa_id,
      centroAscoltoId: row.centro_ascolto_id,
      sourceDomain: row.op_dominio ?? row.dominio_origine ?? "MAGAZZINO",
      sourceEntityType:
        row.op_entita_tipo ?? row.entita_origine_tipo ?? "MOVIMENTO",
      sourceEntityId: row.op_entita_id ?? row.entita_origine_id ?? row.id,
      operationDistributionId: operationId,
      caricoMagazzinoId: row.carico_magazzino_id,
      documentNumber: row.op_documento ?? row.documento_riferimento,
      officialActivity: activity(row.canale_operativo),
      internalChannel: row.canale_operativo,
      status: blocking ? "BLOCCATO" : "RENDICONTABILE",
      packs: row.op_pacchi,
      meals: row.op_pasti,
      occasionalPeople: row.op_saltuari,
      continuousPeople: row.op_continuativi,
      grossStatistics,
      netStatistics:
        reversal === "FULL"
          ? zeroStatistics()
          : reversal === "PARTIAL"
            ? {
                packs: null,
                meals: null,
                occasionalPeople: null,
                continuousPeople: null,
              }
            : grossStatistics,
      netStatisticsStatus:
        operationId == null
          ? ("NOT_APPLICABLE" as const)
          : reversal === "PARTIAL" || correctionAfterCoverage
            ? ("GROSS_ONLY" as const)
            : ("NET" as const),
      qualityCodes,
      administrativeStatus: blocking
        ? "BLOCCATO"
        : correctionAfterCoverage
          ? "CORREZIONE_DA_GESTIRE_MANUALMENTE"
          : arretrato
            ? "ARRETRATO_NON_RENDICONTATO"
            : "DA_RENDICONTARE",
      arretrato,
      blocking,
      correctionOfEventKey,
      coverageEligible: false,
    };

    for (const item of eventRows) {
      const disposition = accountingDisposition({
        naturaContabile: item.natura_contabile,
        naturaOriginale: item.natura_originale,
        origineCarico: item.origine_carico,
      });
      const lineQuality = qualityForLine(item);
      const coverageEligible = isAdministrativeDisposition(disposition);
      const lineBase = {
        lineKey: `MOVIMENTO:${item.id}`,
        eventKey: key,
        movementId: item.id,
        originalMovementId: item.movimento_origine_id,
        movementDate: item.data_movimento,
        accountingNature: item.natura_contabile,
        originalAccountingNature: item.natura_originale,
        fund: item.fondo_origine,
        productId: item.prodotto_id,
        productCodeSnapshot: item.prodotto_codice,
        productNameSnapshot: item.prodotto_nome,
        lotId: item.lotto_id,
        lotCodeSnapshot: item.codice_lotto,
        expirySnapshot: item.data_scadenza,
        loadDateSnapshot: item.data_carico,
        sourceDestinationSnapshot:
          item.op_documento ?? item.documento_riferimento,
        quantityPiecesSigned: signedInventoryValue(item.quantita_pezzi, {
          naturaContabile: item.natura_contabile,
          naturaOriginale: item.natura_originale,
        }),
        quantityKgLtSigned: signedInventoryValue(item.quantita_kg_lt, {
          naturaContabile: item.natura_contabile,
          naturaOriginale: item.natura_originale,
        }),
        factorKgLtPiece: item.fattore_kg_lt_pezzo,
        unitOfMeasureSnapshot: item.unita_misura,
        sourceLineage: {
          dominioOrigine: item.dominio_origine,
          entitaOrigineTipo: item.entita_origine_tipo,
          entitaOrigineId: item.entita_origine_id,
          rigaOrigineId: item.riga_origine_id,
          caricoMagazzinoId: item.carico_magazzino_id,
          operazioneDistribuzioneId: operationId,
        },
        reportingDisposition: disposition,
        qualityCodes: lineQuality,
        coverageEligible,
        openingBalancePieces: null,
        openingBalanceKgLt: null,
        balanceAfterPieces: null,
        balanceAfterKgLt: null,
      };
      lines.push({ ...lineBase, contentHash: canonicalSha256(lineBase) });
      if (coverageEligible) eventBase.coverageEligible = true;
    }
    events.push({ ...eventBase, contentHash: canonicalSha256(eventBase) });
  }

  if (input.excludeCovered) {
    for (const event of [...events]) {
      const originalKey = event.eventKey;
      const eventWasCovered = covered.eventKeys.has(originalKey);
      if (!eventWasCovered) continue;
      const comparableEventHashes = (covered.eventHashes.get(originalKey) ?? [])
        .filter(
          (item) => item.dataDa === input.dataDa && item.dataA === input.dataA,
        )
        .map((item) => item.contentHash);
      const eventContentWasCovered =
        comparableEventHashes.length === 0 ||
        comparableEventHashes.includes(event.contentHash);
      const eventLines = lines.filter((line) => line.eventKey === originalKey);
      const uncoveredLines = eventLines.filter(
        (line) => !covered.lineHashes.get(line.lineKey)?.has(line.contentHash),
      );
      if (eventContentWasCovered && uncoveredLines.length === 0) {
        events.splice(events.indexOf(event), 1);
        for (const line of eventLines) lines.splice(lines.indexOf(line), 1);
        continue;
      }
      for (const line of eventLines) {
        if (!uncoveredLines.includes(line))
          lines.splice(lines.indexOf(line), 1);
      }
      const correctionKey = `CORREZIONE_CONTENUTO:${canonicalSha256({
        eventKey: originalKey,
        eventContentHash: event.contentHash,
        lineContentHashes: uncoveredLines
          .map((line) => line.contentHash)
          .sort(),
      }).slice(0, 64)}`;
      const { contentHash: _eventHash, ...eventSnapshot } = event;
      Object.assign(event, {
        ...eventSnapshot,
        eventKey: correctionKey,
        eventType: "CORREZIONE_CONTENUTO",
        administrativeStatus: "CORREZIONE_DA_GESTIRE_MANUALMENTE",
        correctionOfEventKey: originalKey,
        contentHash: canonicalSha256({
          ...eventSnapshot,
          eventKey: correctionKey,
          eventType: "CORREZIONE_CONTENUTO",
          administrativeStatus: "CORREZIONE_DA_GESTIRE_MANUALMENTE",
          correctionOfEventKey: originalKey,
        }),
      });
      for (const line of uncoveredLines) {
        const { contentHash: _lineHash, ...lineSnapshot } = line;
        Object.assign(line, {
          ...lineSnapshot,
          eventKey: correctionKey,
          contentHash: canonicalSha256({
            ...lineSnapshot,
            eventKey: correctionKey,
          }),
        });
      }
    }
  }

  const progressiveBalances = await loadProgressiveBalances(executor, {
    magazzinoId: input.magazzinoId,
    dataAsOf,
    maxMovimentoId: cutoff.maxMovimentoId,
    movementIds: lines.map((line) => line.movementId),
  });
  for (const line of lines) {
    const balance = progressiveBalances.get(line.movementId);
    if (!balance) continue;
    line.openingBalancePieces = balance.openingPieces;
    line.openingBalanceKgLt = balance.openingKgLt;
    line.balanceAfterPieces = balance.afterPieces;
    line.balanceAfterKgLt = balance.afterKgLt;
  }

  events.sort((left, right) =>
    left.eventKey < right.eventKey
      ? -1
      : left.eventKey > right.eventKey
        ? 1
        : 0,
  );
  lines.sort((left, right) => left.movementId - right.movementId);

  const qualityCounts = new Map<string, { count: number; blocking: boolean }>();
  const addQuality = (code: string, count = 1) => {
    if (count <= 0) return;
    const current = qualityCounts.get(code) ?? {
      count: 0,
      blocking: BLOCKING_FSE_QUALITY.has(code),
    };
    current.count += count;
    qualityCounts.set(code, current);
  };
  for (const code of [
    ...events.flatMap((item) => item.qualityCodes),
    ...lines.flatMap((item) => item.qualityCodes),
  ])
    addQuality(code);
  addQuality(
    "FONDO_LEGACY_NON_DETERMINATO",
    source.filter(
      (row) =>
        row.fondo_origine === "NESSUN_FONDO" && row.lotto_fse_plus === true,
    ).length,
  );
  const availableMonitoring = new Set(
    indicators.map((item) => `${item.annoMese}|${item.canaleUfficiale}`),
  );
  const requiredMonitoring = new Set(
    events
      .filter(
        (event) =>
          event.officialActivity &&
          ["PACCHI", "MENSA", "STRADA"].includes(event.officialActivity),
      )
      .map(
        (event) => `${event.eventDate.slice(0, 7)}|${event.officialActivity}`,
      ),
  );
  addQuality(
    "SNAPSHOT_INDICATORI_STORICI_MANCANTE",
    [...requiredMonitoring].filter((key) => !availableMonitoring.has(key))
      .length,
  );

  const reportBase = {
    modelVersion: FSE_REPORTING_MODEL_VERSION,
    timezone: FSE_TIMEZONE,
    magazzinoId: input.magazzinoId,
    dataDa: input.dataDa,
    dataA: input.dataA,
    dataAsOf,
    includeArretrati,
    cutoff,
    metadata,
    events,
    lines,
    indicators,
    balances,
    quality: [...qualityCounts.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([code, item]) => ({ code, ...item })),
  } as const;
  return { ...reportBase, canonicalHash: canonicalSha256(reportBase) };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

export async function createFseExport(input: {
  magazzinoId: number;
  dataDa: string;
  dataA: string;
  dataAsOf: string;
  formatCode: typeof FSE_CANONICAL_FORMAT | typeof FSE_OBSERVED_CONTROL_FORMAT;
  creatoDa: number;
  includeArretrati?: boolean;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
}) {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-export:${input.magazzinoId}`}, 0))`,
    );
    const cutoff =
      input.cutoff ??
      (await currentFseCutoff(tx, input.magazzinoId, input.dataAsOf));
    const scopeRequestHash = canonicalSha256({
      magazzinoId: input.magazzinoId,
      dataDa: input.dataDa,
      dataA: input.dataA,
      dataAsOf: input.dataAsOf,
      includeArretrati: input.includeArretrati ?? true,
      cutoff,
      coveragePurpose: "ADMINISTRATIVE",
    });
    const [existing] = await tx
      .select()
      .from(esportazioniFseTable)
      .where(
        and(
          eq(esportazioniFseTable.scopeRequestHash, scopeRequestHash),
          ne(esportazioniFseTable.stato, "ANNULLATA"),
        ),
      );
    if (existing) return { export: existing, report: null, replayed: true };
    const report = await buildFseCanonicalReport({
      ...input,
      cutoff,
      includeArretrati: input.includeArretrati ?? true,
      excludeCovered: true,
      executor: tx,
    });
    const requestHash = canonicalSha256({
      magazzinoId: input.magazzinoId,
      dataDa: input.dataDa,
      dataA: input.dataA,
      dataAsOf: input.dataAsOf,
      includeArretrati: input.includeArretrati ?? true,
      cutoff,
      canonicalHash: report.canonicalHash,
    });
    const [lastCancelled] = await tx
      .select({ id: esportazioniFseTable.id })
      .from(esportazioniFseTable)
      .where(eq(esportazioniFseTable.scopeRequestHash, scopeRequestHash))
      .orderBy(sql`${esportazioniFseTable.id} DESC`)
      .limit(1);
    const idempotencyKey = canonicalSha256({
      requestHash,
      regenerationAfter: lastCancelled?.id ?? null,
    });
    const blocking = report.quality
      .filter((item) => item.blocking)
      .reduce((sum, item) => sum + item.count, 0);
    const warnings = report.quality
      .filter((item) => !item.blocking)
      .reduce((sum, item) => sum + item.count, 0);
    const administrativeEvents = report.events.filter(
      (event) => event.coverageEligible && !event.blocking,
    );
    if (administrativeEvents.length === 0 && blocking === 0) {
      throw new FseReportingError(409, "NESSUN_DATO_DA_RENDICONTARE");
    }
    const coveragePurpose = blocking === 0 ? "ADMINISTRATIVE" : "AUDIT_ONLY";
    const [created] = await tx
      .insert(esportazioniFseTable)
      .values({
        magazzinoId: input.magazzinoId,
        dataDa: input.dataDa,
        dataA: input.dataA,
        dataAsOf: input.dataAsOf,
        formatCode: input.formatCode,
        modelVersion: FSE_REPORTING_MODEL_VERSION,
        stato:
          blocking === 0
            ? "PRONTA_PER_INSERIMENTO_MANUALE"
            : "GENERATA_CON_BLOCCHI",
        maxMovimentoId: report.cutoff.maxMovimentoId,
        maxOperazioneDistribuzioneId:
          report.cutoff.maxOperazioneDistribuzioneId,
        canonicalHash: report.canonicalHash,
        idempotencyKey,
        requestHash,
        scopeRequestHash,
        coveragePurpose,
        snapshotMetadataJson: {
          ...report.metadata,
          includeArretrati: report.includeArretrati,
          representations: [FSE_CANONICAL_FORMAT, FSE_OBSERVED_CONTROL_FORMAT],
        },
        eventiTotali: report.events.length,
        righeTotali: report.lines.length,
        righeBloccanti: blocking,
        righeWarning: warnings,
        creatoDa: input.creatoDa,
      })
      .returning();

    const eventIds = new Map<string, number>();
    if (report.events.length) {
      const insertedEvents = await tx
        .insert(esportazioniFseEventiTable)
        .values(
          report.events.map((event) => {
            const activeCoverage =
              coveragePurpose === "ADMINISTRATIVE" &&
              event.coverageEligible &&
              !event.blocking;
            return {
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
              activeCoverage,
              administrativeStatus: event.blocking
                ? "BLOCCATO"
                : activeCoverage
                  ? "IN_ESPORTAZIONE"
                  : event.administrativeStatus,
              arretrato: event.arretrato,
              blocking: event.blocking,
              correctionOfEventKey: event.correctionOfEventKey,
              coveredAt: activeCoverage ? new Date() : null,
              grossStatisticsJson: event.grossStatistics,
              netStatisticsJson: event.netStatistics,
            };
          }),
        )
        .returning({
          id: esportazioniFseEventiTable.id,
          eventKey: esportazioniFseEventiTable.eventKey,
        });
      for (const event of insertedEvents)
        eventIds.set(event.eventKey, event.id);
    }

    const eventsByKey = new Map(
      report.events.map((event) => [event.eventKey, event]),
    );
    for (const batch of chunks(report.lines, 500)) {
      await tx.insert(esportazioniFseRigheTable).values(
        batch.map((line) => {
          const event = eventsByKey.get(line.eventKey)!;
          return {
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
            sourceLineageJson: {
              ...line.sourceLineage,
              originalAccountingNature: line.originalAccountingNature,
              loadDateSnapshot: line.loadDateSnapshot,
              sourceDestinationSnapshot: line.sourceDestinationSnapshot,
            },
            reportingDisposition: line.reportingDisposition,
            qualityCodesJson: line.qualityCodes,
            openingBalancePieces: line.openingBalancePieces,
            openingBalanceKgLt: line.openingBalanceKgLt,
            balanceAfterPieces: line.balanceAfterPieces,
            balanceAfterKgLt: line.balanceAfterKgLt,
            activeCoverage:
              coveragePurpose === "ADMINISTRATIVE" &&
              line.coverageEligible &&
              !event.blocking,
          };
        }),
      );
    }

    if (report.indicators.length)
      await tx.insert(esportazioniFseIndicatoriTable).values(
        report.indicators.map((indicator) => ({
          esportazioneId: created.id,
          rilevazioneId: indicator.id,
          annoMese: indicator.annoMese,
          canaleUfficiale: indicator.canaleUfficiale,
          dataRiferimento: indicator.dataRiferimento,
          valuesJson: indicator.values,
          contentHash: indicator.contentHash,
        })),
      );
    if (report.balances.length)
      await tx.insert(esportazioniFseSaldiTable).values(
        report.balances.map((balance) => ({
          esportazioneId: created.id,
          magazzinoId: balance.magazzinoId,
          fondo: balance.fund,
          prodottoId: balance.productId,
          prodottoCodiceSnapshot: balance.productCodeSnapshot,
          prodottoNomeSnapshot: balance.productNameSnapshot,
          lottoId: balance.lotId,
          lottoCodiceSnapshot: balance.lotCodeSnapshot,
          saldoPezzi: balance.pieces,
          saldoKgLt: balance.kgLt,
          contentHash: balance.contentHash,
        })),
      );
    return { export: created, report, replayed: false };
  });
}

export function isFseFormat(
  value: unknown,
): value is typeof FSE_CANONICAL_FORMAT | typeof FSE_OBSERVED_CONTROL_FORMAT {
  return (
    value === FSE_CANONICAL_FORMAT || value === FSE_OBSERVED_CONTROL_FORMAT
  );
}

export function exportScopeCondition(
  magazzinoIds: number[] | null,
): SQL | undefined {
  if (magazzinoIds == null) return undefined;
  if (magazzinoIds.length === 0) return sql`false`;
  return sql`${esportazioniFseTable.magazzinoId} = ANY(${magazzinoIds}::int[])`;
}

export async function deactivateExportCoverage(
  exportId: number,
  actorId: number,
  motivation: string,
  version: number,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(esportazioniFseTable)
      .where(
        and(
          eq(esportazioniFseTable.id, exportId),
          eq(esportazioniFseTable.versione, version),
        ),
      )
      .for("update");
    if (!current)
      throw new FseReportingError(409, "Versione esportazione non corrente");
    if (current.stato === "ANNULLATA") return current;
    if (current.stato === "INSERITA_MANUALMENTE")
      throw new FseReportingError(
        409,
        "Una esportazione inserita non può essere annullata",
      );
    await tx.execute(sql`
      UPDATE esportazioni_fse_righe r SET active_coverage = false
      FROM esportazioni_fse_eventi e
      WHERE r.esportazione_evento_id = e.id AND e.esportazione_id = ${exportId}
    `);
    await tx
      .update(esportazioniFseEventiTable)
      .set({ activeCoverage: false, administrativeStatus: "ANNULLATO" })
      .where(eq(esportazioniFseEventiTable.esportazioneId, exportId));
    const [updated] = await tx
      .update(esportazioniFseTable)
      .set({
        stato: "ANNULLATA",
        annullatoDa: actorId,
        dataAnnullamento: new Date(),
        motivazioneAnnullamento: motivation,
        versione: version + 1,
      })
      .where(eq(esportazioniFseTable.id, exportId))
      .returning();
    return updated;
  });
}

export async function markFseExportEntered(input: {
  exportId: number;
  actorId: number;
  version: number;
  insertedAt: Date;
  externalReference: string;
}) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(esportazioniFseTable)
      .where(
        and(
          eq(esportazioniFseTable.id, input.exportId),
          eq(esportazioniFseTable.versione, input.version),
        ),
      )
      .for("update");
    if (!current)
      throw new FseReportingError(409, "Versione esportazione non corrente");
    if (current.stato !== "PRONTA_PER_INSERIMENTO_MANUALE")
      throw new FseReportingError(
        409,
        "Solo una esportazione pronta può essere marcata inserita",
      );
    if (
      current.righeBloccanti > 0 ||
      current.coveragePurpose !== "ADMINISTRATIVE"
    )
      throw new FseReportingError(
        409,
        "Esportazione bloccata o priva di copertura amministrativa",
      );
    const [updated] = await tx
      .update(esportazioniFseTable)
      .set({
        stato: "INSERITA_MANUALMENTE",
        marcatoInseritoDa: input.actorId,
        dataInserimentoEsterno: input.insertedAt,
        riferimentoEsterno: input.externalReference,
        versione: input.version + 1,
      })
      .where(eq(esportazioniFseTable.id, input.exportId))
      .returning();
    await tx
      .update(esportazioniFseEventiTable)
      .set({ administrativeStatus: "INSERITO_MANUALMENTE" })
      .where(eq(esportazioniFseEventiTable.esportazioneId, input.exportId));
    return updated;
  });
}
