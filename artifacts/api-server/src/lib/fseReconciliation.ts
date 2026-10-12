import {
  db,
  FSE_REPORTING_MODEL_VERSION,
  importazioniAgeaTable,
  riconciliazioniFseRigheTable,
  riconciliazioniFseRisoluzioniTable,
  riconciliazioniFseTable,
  fseAdministrativeVersionsTable,
  fseAdministrativeObservationsTable,
  fseReconciliationRunsTable,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import {
  canonicalSha256,
  currentFseCutoff,
  FseReportingError,
  loadFseBalances,
} from "./fseCanonicalReporting";
import { signedInventoryValue } from "./fseAccounting";
import { signedPhysicalMovementSql } from "./movementPhysicalEffect";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  auditUserId,
  recordAuditEvent,
  type AuditCommandContext,
} from "./auditEvent";
import { requireCurrentFseWarehouse } from "./fseAccess";
import {
  lockAdministrativeSource,
  freezeAdministrativeSource,
  loadAdministrativeLines,
} from "./fseAdministrativeSource";

type DbExecutor =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ReconciliationLocalLine = {
  movementId: number;
  operationDistributionId: number | null;
  caricoMagazzinoRigaId: number | null;
  eventKey: string;
  lineKey: string;
  type: string;
  fund: string;
  productId: number;
  lot: string | null;
  date: string;
  pieces: string | null;
  kgLt: string | null;
  channel: string | null;
  packs: number | null;
  meals: number | null;
  occasional: number | null;
  continuous: number | null;
};

export type ReconciliationExternalLine = {
  importRowId: number;
  observationId?: number;
  identityHash?: string;
  originalComparisonHash?: string;
  qualityCodes?: string[];
  externalMovementId: number | null;
  caricoMagazzinoRigaId: number | null;
  type: string;
  fund: string | null;
  productId: number | null;
  lot: string | null;
  date: string | null;
  pieces: string | null;
  kgLt: string | null;
  channel: string | null;
  packs: number | null;
  meals: number | null;
  occasional: number | null;
  continuous: number | null;
  modified: boolean;
  baselineAbsorbed?: boolean;
};

export type ReconciliationRow = {
  tipoRiga: string;
  businessKey: string;
  matchMethod: string;
  localEventKey: string | null;
  localLineKey: string | null;
  movimentoId: number | null;
  operazioneDistribuzioneId: number | null;
  externalMovementId: number | null;
  importazioneAgeaRigaId: number | null;
  observationId?: number | null;
  aggregateVersionId?: number | null;
  aggregationKey?: {
    fund: string | null;
    productId: number | null;
    lot: string | null;
    unit: string | null;
  };
  fundLocal: string | null;
  fundExternal: string | null;
  productIdLocal: number | null;
  productIdExternal: number | null;
  lotLocal: string | null;
  lotExternal: string | null;
  dateLocal: string | null;
  dateExternal: string | null;
  piecesLocal: string | null;
  piecesExternal: string | null;
  kgLtLocal: string | null;
  kgLtExternal: string | null;
  differencePieces: string | null;
  differenceKgLt: string | null;
  channelLocal: string | null;
  channelExternal: string | null;
  status: string;
  blocking: boolean;
  qualityCodesJson: string[];
  contentHash: string;
};

export function reconciliationMovementType(nature: string): string {
  if (nature === "CARICO") return "CARICO";
  if (nature === "DISTRIBUZIONE_FINALE") return "DISTRIBUZIONE";
  if (nature === "CONSEGNA_ENTE") return "CONSEGNA_ENTE";
  if (nature === "STORNO") return "STORNO";
  if (nature === "RESO") return "RESO";
  return "MODIFICA_GIACENZA";
}

function exact(value: string | null): string | null {
  return value == null
    ? null
    : InventoryDecimal.parse(value, { allowNegative: true }).toDb();
}

function difference(left: string | null, right: string | null): string | null {
  if (left == null || right == null) return null;
  return InventoryDecimal.parse(left, { allowNegative: true })
    .subtract(InventoryDecimal.parse(right, { allowNegative: true }))
    .toDb();
}

function normalizedChannel(channel: string | null): string | null {
  return channel === "RITIRO_SEDE"
    ? "PACCHI"
    : channel === "UDS_STRADA"
      ? "STRADA"
      : channel;
}

function exactKey(
  line: ReconciliationLocalLine | ReconciliationExternalLine,
): string {
  return [
    line.type,
    line.fund ?? "",
    line.productId ?? "",
    line.lot ?? "",
    line.date ?? "",
    exact(line.pieces),
    exact(line.kgLt),
    normalizedChannel(line.channel),
  ].join("|");
}

function statisticsDiffer(
  left: ReconciliationLocalLine,
  right: ReconciliationExternalLine,
): boolean {
  return (["packs", "meals", "occasional", "continuous"] as const).some(
    (field) => left[field] !== right[field],
  );
}

function mismatch(
  left: ReconciliationLocalLine,
  right: ReconciliationExternalLine,
): string {
  if (right.modified) return "MOVIMENTO_AGEA_MODIFICATO";
  if (right.qualityCodes?.length) return right.qualityCodes[0];
  if (left.fund !== right.fund) return "FONDO_DIFFERENTE";
  if (left.productId !== right.productId) return "PRODOTTO_DIFFERENTE";
  if ((left.lot ?? null) !== (right.lot ?? null)) return "LOTTO_DIFFERENTE";
  if (left.date !== right.date) return "DATA_DIFFERENTE";
  if (normalizedChannel(left.channel) !== normalizedChannel(right.channel))
    return "CANALE_DIFFERENTE";
  if (exact(left.pieces) !== exact(right.pieces))
    return "QUANTITA_PEZZI_DIFFERENTE";
  if (exact(left.kgLt) !== exact(right.kgLt)) return "QUANTITA_KGLT_DIFFERENTE";
  if (statisticsDiffer(left, right)) return "STATISTICHE_DIFFERENTI";
  return "RICONCILIATA_ESATTA";
}

function paired(
  local: ReconciliationLocalLine,
  external: ReconciliationExternalLine,
  matchMethod: string,
  forcedStatus?: string,
): ReconciliationRow {
  const status = forcedStatus ?? mismatch(local, external);
  const base = {
    tipoRiga: local.type,
    businessKey: `PAIR:${local.movementId}:${external.observationId == null ? "" : "M3B:"}${external.importRowId}`,
    matchMethod,
    localEventKey: local.eventKey,
    localLineKey: local.lineKey,
    movimentoId: local.movementId,
    operazioneDistribuzioneId: local.operationDistributionId,
    externalMovementId: external.externalMovementId,
    importazioneAgeaRigaId:
      external.observationId == null ? external.importRowId : null,
    ...(external.observationId == null
      ? {}
      : { observationId: external.observationId }),
    fundLocal: local.fund,
    fundExternal: external.fund,
    productIdLocal: local.productId,
    productIdExternal: external.productId,
    lotLocal: local.lot,
    lotExternal: external.lot,
    dateLocal: local.date,
    dateExternal: external.date,
    piecesLocal: exact(local.pieces),
    piecesExternal: exact(external.pieces),
    kgLtLocal: exact(local.kgLt),
    kgLtExternal: exact(external.kgLt),
    differencePieces: difference(local.pieces, external.pieces),
    differenceKgLt: difference(local.kgLt, external.kgLt),
    channelLocal: normalizedChannel(local.channel),
    channelExternal: normalizedChannel(external.channel),
    status,
    blocking: status !== "RICONCILIATA_ESATTA",
    qualityCodesJson: [
      ...new Set([
        ...(status === "RICONCILIATA_ESATTA" ? [] : [status]),
        ...(external.qualityCodes ?? []),
      ]),
    ],
  };
  return { ...base, contentHash: canonicalSha256(base) };
}

function localOnly(local: ReconciliationLocalLine): ReconciliationRow {
  const status =
    local.type === "STORNO"
      ? "STORNO_NON_RISCONTRATO"
      : local.type === "RESO"
        ? "RESO_NON_RISCONTRATO"
        : local.type === "CONSEGNA_ENTE"
          ? "CONSEGNA_ENTE_NON_RISCONTRATA"
          : local.type === "MODIFICA_GIACENZA"
            ? "MODIFICA_GIACENZA_NON_RISCONTRATA"
            : "SOLO_LOCALE_DA_RENDICONTARE";
  const base = {
    tipoRiga: local.type,
    businessKey: `LOCAL:${local.movementId}`,
    matchMethod: "NESSUNO",
    localEventKey: local.eventKey,
    localLineKey: local.lineKey,
    movimentoId: local.movementId,
    operazioneDistribuzioneId: local.operationDistributionId,
    externalMovementId: null,
    importazioneAgeaRigaId: null,
    fundLocal: local.fund,
    fundExternal: null,
    productIdLocal: local.productId,
    productIdExternal: null,
    lotLocal: local.lot,
    lotExternal: null,
    dateLocal: local.date,
    dateExternal: null,
    piecesLocal: exact(local.pieces),
    piecesExternal: null,
    kgLtLocal: exact(local.kgLt),
    kgLtExternal: null,
    differencePieces: exact(local.pieces),
    differenceKgLt: exact(local.kgLt),
    channelLocal: normalizedChannel(local.channel),
    channelExternal: null,
    status,
    blocking: true,
    qualityCodesJson: [status],
  };
  return { ...base, contentHash: canonicalSha256(base) };
}

function externalOnly(external: ReconciliationExternalLine): ReconciliationRow {
  const status = external.modified
    ? "MOVIMENTO_AGEA_MODIFICATO"
    : external.qualityCodes?.length
      ? external.qualityCodes[0]
      : external.baselineAbsorbed
        ? "BASELINE_ASSORBITA"
        : external.productId == null
          ? "PRODOTTO_NON_MAPPATO"
          : external.modified
            ? "MOVIMENTO_AGEA_MODIFICATO"
            : "SOLO_AGEA";
  const base = {
    tipoRiga: external.type,
    businessKey: `${external.observationId == null ? "AGEA" : "M3B"}:${external.importRowId}`,
    matchMethod: "NESSUNO",
    localEventKey: null,
    localLineKey: null,
    movimentoId: null,
    operazioneDistribuzioneId: null,
    externalMovementId: external.externalMovementId,
    importazioneAgeaRigaId:
      external.observationId == null ? external.importRowId : null,
    ...(external.observationId == null
      ? {}
      : { observationId: external.observationId }),
    fundLocal: null,
    fundExternal: external.fund,
    productIdLocal: null,
    productIdExternal: external.productId,
    lotLocal: null,
    lotExternal: external.lot,
    dateLocal: null,
    dateExternal: external.date,
    piecesLocal: null,
    piecesExternal: exact(external.pieces),
    kgLtLocal: null,
    kgLtExternal: exact(external.kgLt),
    differencePieces:
      external.pieces == null
        ? null
        : InventoryDecimal.zero()
            .subtract(
              InventoryDecimal.parse(external.pieces, { allowNegative: true }),
            )
            .toDb(),
    differenceKgLt:
      external.kgLt == null
        ? null
        : InventoryDecimal.zero()
            .subtract(
              InventoryDecimal.parse(external.kgLt, { allowNegative: true }),
            )
            .toDb(),
    channelLocal: null,
    channelExternal: normalizedChannel(external.channel),
    status,
    blocking: status !== "BASELINE_ASSORBITA",
    qualityCodesJson: [
      ...new Set([
        ...(status === "BASELINE_ASSORBITA" ? [] : [status]),
        ...(external.qualityCodes ?? []),
      ]),
    ],
  };
  return { ...base, contentHash: canonicalSha256(base) };
}

export function reconcileFseLines(
  localLines: ReconciliationLocalLine[],
  externalLines: ReconciliationExternalLine[],
): ReconciliationRow[] {
  const local = [...localLines].sort((a, b) => a.movementId - b.movementId);
  const external = [...externalLines].sort(
    (a, b) => a.importRowId - b.importRowId,
  );
  const usedLocal = new Set<number>();
  const usedExternal = new Set<number>();
  const rows: ReconciliationRow[] = [];

  for (const ext of external) {
    if (ext.caricoMagazzinoRigaId == null) continue;
    const direct = local.find(
      (item) =>
        !usedLocal.has(item.movementId) &&
        item.caricoMagazzinoRigaId === ext.caricoMagazzinoRigaId,
    );
    if (direct) {
      usedLocal.add(direct.movementId);
      usedExternal.add(ext.importRowId);
      rows.push(paired(direct, ext, "LINK_DIRETTO"));
    }
  }

  const localByExact = new Map<string, ReconciliationLocalLine[]>();
  for (const item of local.filter((row) => !usedLocal.has(row.movementId)))
    localByExact.set(exactKey(item), [
      ...(localByExact.get(exactKey(item)) ?? []),
      item,
    ]);
  const externalByExact = new Map<string, ReconciliationExternalLine[]>();
  for (const item of external.filter(
    (row) => !usedExternal.has(row.importRowId),
  ))
    externalByExact.set(exactKey(item), [
      ...(externalByExact.get(exactKey(item)) ?? []),
      item,
    ]);
  for (const key of [...externalByExact.keys()].sort()) {
    const locals = localByExact.get(key) ?? [];
    const externals = externalByExact.get(key) ?? [];
    const count = Math.min(locals.length, externals.length);
    for (let index = 0; index < count; index += 1) {
      usedLocal.add(locals[index].movementId);
      usedExternal.add(externals[index].importRowId);
      rows.push(
        paired(
          locals[index],
          externals[index],
          count > 1 ? "MULTINSIEME" : "EXACT_DETERMINISTICO",
        ),
      );
    }
  }

  for (const ext of external.filter(
    (row) => !usedExternal.has(row.importRowId),
  )) {
    const candidates = local.filter(
      (item) =>
        !usedLocal.has(item.movementId) &&
        item.type === ext.type &&
        (item.productId === ext.productId || ext.productId == null),
    );
    if (candidates.length === 1) {
      const candidate = candidates[0];
      usedLocal.add(candidate.movementId);
      usedExternal.add(ext.importRowId);
      rows.push(paired(candidate, ext, "CANDIDATO_UNIVOCO"));
    } else if (candidates.length > 1) {
      usedExternal.add(ext.importRowId);
      rows.push({
        ...externalOnly(ext),
        status: "IDENTITA_AMBIGUA",
        matchMethod: "AMBIGUO",
        qualityCodesJson: ["RICONCILIAZIONE_AMBIGUA"],
      });
    }
  }
  rows.push(
    ...local.filter((item) => !usedLocal.has(item.movementId)).map(localOnly),
  );
  rows.push(
    ...external
      .filter((item) => !usedExternal.has(item.importRowId))
      .map(externalOnly),
  );
  return rows.sort((a, b) => a.businessKey.localeCompare(b.businessKey));
}

async function loadLocal(
  executor: DbExecutor,
  magazzinoId: number,
  dataRiferimento: string,
  maxMovimentoId: number,
  maxOperazioneDistribuzioneId: number,
): Promise<ReconciliationLocalLine[]> {
  const result = await executor.execute(sql`
    SELECT mv.id, mv.operazione_distribuzione_id, mv.carico_magazzino_riga_id,
           mv.natura_contabile, mv.fondo_origine, mv.prodotto_id,
           l.codice_lotto, mv.data_movimento, mv.quantita_pezzi, mv.quantita_kg_lt,
           mv.canale_operativo, op.numero_pacchi, op.numero_pasti,
           op.indigenti_saltuari, op.indigenti_continuativi,
           original.natura_contabile AS original_nature
    FROM movimenti mv
    LEFT JOIN lotti l ON l.id = mv.lotto_id
    LEFT JOIN operazioni_distribuzione_magazzino op ON op.id = mv.operazione_distribuzione_id
    LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
    WHERE mv.magazzino_id = ${magazzinoId} AND mv.data_movimento <= ${dataRiferimento}
      AND mv.id <= ${maxMovimentoId}
      AND (mv.operazione_distribuzione_id IS NULL OR mv.operazione_distribuzione_id <= ${maxOperazioneDistribuzioneId})
      AND mv.natura_contabile NOT IN ('SALDO_INIZIALE', 'TRASFERIMENTO_INTERNO_ENTRATA', 'TRASFERIMENTO_INTERNO_USCITA', 'LEGACY', 'ALTRO')
    ORDER BY mv.id
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => {
    const nature = String(row.natura_contabile);
    const signed = (value: unknown) =>
      signedInventoryValue(value == null ? null : String(value), {
        naturaContabile: nature,
        naturaOriginale:
          row.original_nature == null ? null : String(row.original_nature),
      });
    const type = reconciliationMovementType(nature);
    const operationId =
      row.operazione_distribuzione_id == null
        ? null
        : Number(row.operazione_distribuzione_id);
    return {
      movementId: Number(row.id),
      operationDistributionId: operationId,
      caricoMagazzinoRigaId:
        row.carico_magazzino_riga_id == null
          ? null
          : Number(row.carico_magazzino_riga_id),
      eventKey:
        operationId == null
          ? `MOVIMENTO:${row.id}`
          : `DISTRIBUZIONE:${operationId}`,
      lineKey: `MOVIMENTO:${row.id}`,
      type,
      fund: String(row.fondo_origine),
      productId: Number(row.prodotto_id),
      lot: row.codice_lotto == null ? null : String(row.codice_lotto),
      date: String(row.data_movimento),
      pieces: signed(row.quantita_pezzi),
      kgLt: signed(row.quantita_kg_lt),
      channel:
        row.canale_operativo == null ? null : String(row.canale_operativo),
      packs: row.numero_pacchi == null ? null : Number(row.numero_pacchi),
      meals: row.numero_pasti == null ? null : Number(row.numero_pasti),
      occasional:
        row.indigenti_saltuari == null ? null : Number(row.indigenti_saltuari),
      continuous:
        row.indigenti_continuativi == null
          ? null
          : Number(row.indigenti_continuativi),
    };
  });
}

function parsedCount(value: unknown): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(String(value).trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

async function loadExternal(
  executor: DbExecutor,
  importId: number,
): Promise<ReconciliationExternalLine[]> {
  const result = await executor.execute(sql`
    SELECT r.id, r.movimento_esterno_id, r.carico_magazzino_riga_id,
           r.tipo_movimento_esterno, r.fondo_normalizzato, r.prodotto_id_snapshot,
           COALESCE(r.lotto_effettivo_normalizzato, r.lotto_normalizzato) AS lotto,
           COALESCE(r.data_carico_effettiva, r.data_carico_risolta, r.data_documento) AS event_date,
           r.movimento_pezzi, r.movimento_kg_lt, r.attivita_normalizzata,
           r.pacchi_raw, r.pasti_raw, r.saltuari_raw, r.continuativi_raw,
           r.stato_riga, r.warning_codes_json,
           me.accepted_content_hash, me.stato_applicazione, r.content_hash
    FROM importazioni_agea_righe r
    LEFT JOIN movimenti_esterni_agea me ON me.id = r.movimento_esterno_id
    WHERE r.importazione_id = ${importId}
      AND r.tipo_movimento_esterno <> 'RIGA_SENZA_MOVIMENTO'
    ORDER BY r.id
  `);
  return (result.rows as Array<Record<string, unknown>>).map((row) => ({
    importRowId: Number(row.id),
    externalMovementId:
      row.movimento_esterno_id == null
        ? null
        : Number(row.movimento_esterno_id),
    caricoMagazzinoRigaId:
      row.carico_magazzino_riga_id == null
        ? null
        : Number(row.carico_magazzino_riga_id),
    type: String(row.tipo_movimento_esterno),
    fund:
      row.fondo_normalizzato == null ? null : String(row.fondo_normalizzato),
    productId:
      row.prodotto_id_snapshot == null
        ? null
        : Number(row.prodotto_id_snapshot),
    lot: row.lotto == null ? null : String(row.lotto),
    date: row.event_date == null ? null : String(row.event_date),
    pieces: row.movimento_pezzi == null ? null : String(row.movimento_pezzi),
    kgLt: row.movimento_kg_lt == null ? null : String(row.movimento_kg_lt),
    channel:
      row.attivita_normalizzata == null
        ? null
        : String(row.attivita_normalizzata),
    packs: parsedCount(row.pacchi_raw),
    meals: parsedCount(row.pasti_raw),
    occasional: parsedCount(row.saltuari_raw),
    continuous: parsedCount(row.continuativi_raw),
    modified:
      String(row.stato_riga).includes("MODIFICAT") ||
      (row.accepted_content_hash != null &&
        row.content_hash !== row.accepted_content_hash),
    baselineAbsorbed: row.stato_applicazione === "ASSORBITO_SALDO_INIZIALE",
  }));
}

async function loadBalanceRows(
  executor: DbExecutor,
  input: {
    magazzinoId: number;
    importId: number;
    dataRiferimento: string;
    maxMovimentoId: number;
    maxOperazioneDistribuzioneId: number;
  },
): Promise<ReconciliationRow[]> {
  const piecesSql = signedPhysicalMovementSql(
    sql`mv.quantita_pezzi`,
    sql`mv.tipo_movimento`,
    sql`mv.tipo_dettaglio`,
    sql`original.tipo_movimento`,
    sql`original.tipo_dettaglio`,
  );
  const kgLtSql = signedPhysicalMovementSql(
    sql`mv.quantita_kg_lt`,
    sql`mv.tipo_movimento`,
    sql`mv.tipo_dettaglio`,
    sql`original.tipo_movimento`,
    sql`original.tipo_dettaglio`,
  );
  const result = await executor.execute(sql`
    WITH local_balance AS (
      SELECT mv.fondo_origine AS fund, mv.prodotto_id AS product_id,
             COALESCE(l.codice_lotto, '') AS lot,
             SUM(${piecesSql})::text AS pieces,
             SUM(${kgLtSql})::text AS kg_lt
      FROM movimenti mv
      LEFT JOIN movimenti original ON original.id = mv.movimento_origine_id
      LEFT JOIN lotti l ON l.id = mv.lotto_id
      WHERE mv.magazzino_id = ${input.magazzinoId}
        AND mv.data_movimento <= ${input.dataRiferimento}
        AND mv.id <= ${input.maxMovimentoId}
        AND (mv.operazione_distribuzione_id IS NULL OR mv.operazione_distribuzione_id <= ${input.maxOperazioneDistribuzioneId})
      GROUP BY mv.fondo_origine, mv.prodotto_id, COALESCE(l.codice_lotto, '')
    ), external_balance AS (
      SELECT fondo_origine AS fund, prodotto_id AS product_id,
             COALESCE(lotto_normalizzato, '') AS lot,
             SUM(saldo_finale_pezzi)::text AS pieces,
             SUM(saldo_finale_kg_lt)::text AS kg_lt
      FROM importazioni_agea_partite
      WHERE importazione_id = ${input.importId} AND prodotto_id IS NOT NULL
        AND (
          COALESCE(saldo_finale_pezzi, 0) <> 0
          OR COALESCE(saldo_finale_kg_lt, 0) <> 0
        )
      GROUP BY fondo_origine, prodotto_id, COALESCE(lotto_normalizzato, '')
    )
    SELECT COALESCE(lb.fund, eb.fund) AS fund,
           COALESCE(lb.product_id, eb.product_id) AS product_id,
           COALESCE(lb.lot, eb.lot) AS lot,
           lb.pieces AS pieces_local, eb.pieces AS pieces_external,
           lb.kg_lt AS kg_lt_local, eb.kg_lt AS kg_lt_external
    FROM local_balance lb
    FULL OUTER JOIN external_balance eb
      ON eb.fund = lb.fund AND eb.product_id = lb.product_id AND eb.lot = lb.lot
    ORDER BY COALESCE(lb.fund, eb.fund), COALESCE(lb.product_id, eb.product_id), COALESCE(lb.lot, eb.lot)
  `);
  return (result.rows as Array<Record<string, unknown>>).map((source) => {
    const piecesLocal =
      source.pieces_local == null ? null : exact(String(source.pieces_local));
    const piecesExternal =
      source.pieces_external == null
        ? null
        : exact(String(source.pieces_external));
    const kgLtLocal =
      source.kg_lt_local == null ? null : exact(String(source.kg_lt_local));
    const kgLtExternal =
      source.kg_lt_external == null
        ? null
        : exact(String(source.kg_lt_external));
    const piecesMatch =
      piecesLocal != null &&
      piecesExternal != null &&
      piecesLocal === piecesExternal;
    const kgLtMatch =
      kgLtLocal != null && kgLtExternal != null && kgLtLocal === kgLtExternal;
    const localPresent = piecesLocal != null || kgLtLocal != null;
    const externalPresent = piecesExternal != null || kgLtExternal != null;
    const status = !localPresent
      ? "PARTITA_SOLO_AGEA"
      : !externalPresent
        ? "PARTITA_SOLO_LOCALE"
        : piecesMatch && kgLtMatch
          ? "SALDO_RICONCILIATO"
          : !piecesMatch && !kgLtMatch
            ? "SCOSTAMENTO_SALDO_ENTRAMBI"
            : !piecesMatch
              ? "SCOSTAMENTO_SALDO_PEZZI"
              : "SCOSTAMENTO_SALDO_KGLT";
    const base = {
      tipoRiga: "SALDO_PARTITA",
      businessKey: `SALDO:${input.magazzinoId}:${source.fund}:${source.product_id}:${source.lot}`,
      matchMethod: "PARTITA_AS_OF",
      localEventKey: null,
      localLineKey: null,
      movimentoId: null,
      operazioneDistribuzioneId: null,
      externalMovementId: null,
      importazioneAgeaRigaId: null,
      fundLocal: !localPresent ? null : String(source.fund),
      fundExternal: !externalPresent ? null : String(source.fund),
      productIdLocal: !localPresent ? null : Number(source.product_id),
      productIdExternal: !externalPresent ? null : Number(source.product_id),
      lotLocal: !localPresent ? null : String(source.lot) || null,
      lotExternal: !externalPresent ? null : String(source.lot) || null,
      dateLocal: input.dataRiferimento,
      dateExternal: input.dataRiferimento,
      piecesLocal,
      piecesExternal,
      kgLtLocal,
      kgLtExternal,
      differencePieces: difference(piecesLocal, piecesExternal),
      differenceKgLt: difference(kgLtLocal, kgLtExternal),
      channelLocal: null,
      channelExternal: null,
      status,
      blocking: status !== "SALDO_RICONCILIATO",
      qualityCodesJson: status === "SALDO_RICONCILIATO" ? [] : [status],
    };
    return { ...base, contentHash: canonicalSha256(base) };
  });
}

function persistedRow(row: ReconciliationRow) {
  const exact = ["RICONCILIATA_ESATTA", "SALDO_RICONCILIATO"].includes(
    row.status,
  );
  return {
    ...row,
    exact,
    calculatedStateJson: { ...row, exact },
    workflowStatus: "CALCOLATO",
  };
}

function totals(rows: ReconciliationRow[]) {
  return {
    totaleRighe: rows.length,
    riconciliate: rows.filter((row) =>
      ["RICONCILIATA_ESATTA", "SALDO_RICONCILIATO"].includes(row.status),
    ).length,
    soloLocali: rows.filter(
      (row) => row.status === "SOLO_LOCALE_DA_RENDICONTARE",
    ).length,
    soloAgea: rows.filter((row) => row.status === "SOLO_AGEA").length,
    scostamenti: rows.filter(
      (row) =>
        ![
          "RICONCILIATA_ESATTA",
          "SALDO_RICONCILIATO",
          "SOLO_LOCALE_DA_RENDICONTARE",
          "SOLO_AGEA",
        ].includes(row.status),
    ).length,
    ambigue: rows.filter((row) => row.status === "IDENTITA_AMBIGUA").length,
    scostamentiAccettati: rows.filter(
      (row) => row.status === "SCOSTAMENTO_ACCETTATO",
    ).length,
    bloccanti: rows.filter((row) => row.blocking).length,
  };
}

function externalFingerprint(row: ReconciliationExternalLine): string {
  return canonicalSha256({
    externalMovementId: row.externalMovementId,
    ...(row.identityHash ? { administrativeIdentity: row.identityHash } : {}),
    ...(row.originalComparisonHash
      ? { originalComparisonHash: row.originalComparisonHash }
      : {}),
    identity: exactKey(row),
    packs: row.packs,
    meals: row.meals,
    occasional: row.occasional,
    continuous: row.continuous,
  });
}

export function currentExternalDelta(
  current: ReconciliationExternalLine[],
  previous: ReconciliationExternalLine[],
) {
  const prior = new Map<string, ReconciliationExternalLine[]>();
  for (const row of previous) {
    const key = externalFingerprint(row);
    prior.set(key, [...(prior.get(key) ?? []), row]);
  }
  // First consume unchanged occurrences, then pair quality-only changes.
  // Physical identity stays separate: a warning is not a new stock movement.
  const quality = (row: ReconciliationExternalLine) =>
    row.observationId == null
      ? "legacy"
      : canonicalSha256({
          codes: [...new Set(row.qualityCodes ?? [])].sort(),
          modified: row.modified,
          baselineAbsorbed: row.baselineAbsorbed ?? false,
        });
  const pending = current.filter((row) => {
    const key = externalFingerprint(row);
    const remaining = prior.get(key) ?? [];
    const same = remaining.findIndex(
      (previous) => quality(previous) === quality(row),
    );
    if (same < 0) return true;
    remaining.splice(same, 1);
    return false;
  });
  const changed: ReconciliationExternalLine[] = [];
  const added = pending.filter((row) => {
    const remaining = prior.get(externalFingerprint(row)) ?? [];
    if (!remaining.length) return true;
    remaining.shift();
    changed.push(row);
    return false;
  });
  return { added, missing: [...prior.values()].flat(), changed };
}

function administrativeQualityChange(
  external: ReconciliationExternalLine,
): ReconciliationRow {
  const base = externalOnly(external);
  const row = {
    ...base,
    businessKey: `${base.businessKey}:QUALITA`,
    matchMethod: "VARIAZIONE_AMMINISTRATIVA",
    status: "QUALITA_AMMINISTRATIVA_VARIATA",
    blocking: true,
    // Keep the current source values for inspection, not a fictional stock delta.
    differencePieces: null,
    differenceKgLt: null,
    qualityCodesJson: [
      ...new Set([
        "QUALITA_AMMINISTRATIVA_VARIATA",
        ...(external.qualityCodes ?? []),
      ]),
    ],
  };
  return {
    ...row,
    contentHash: canonicalSha256({ ...row, contentHash: undefined }),
  };
}

export function selectLocalReconciliationDelta(
  local: ReconciliationLocalLine[],
  previousReference: string | null,
  previousMaxMovementId: number | null,
) {
  if (previousReference == null) return local;
  return previousMaxMovementId == null
    ? local.filter((row) => row.date > previousReference)
    : local.filter((row) => row.movementId > previousMaxMovementId);
}

type ReconciliationInput = {
  audit?: AuditCommandContext;
  magazzinoId: number;
  importazioneAgeaId?: number;
  importazioneAgeaPrecedenteId?: number | null;
  sourceType?: "AGEA_LEGACY" | "FSE_M3B";
  sessionId?: number;
  sessionVersion?: number;
  baselineRunId?: number | null;
  commandKey?: string;
  dataRiferimento: string;
  creatoDa: number;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
};

async function administrativeBalanceRows(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  version: typeof fseAdministrativeVersionsTable.$inferSelect,
  cutoff: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number },
): Promise<ReconciliationRow[]> {
  const local = await loadFseBalances(tx, {
    magazzinoId: version.magazzinoId,
    dataAsOf: version.referenceDate,
    groupByUnit: true,
    includeAllFunds: true,
    ...cutoff,
  });
  const observations = await tx
    .select()
    .from(fseAdministrativeObservationsTable)
    .where(eq(fseAdministrativeObservationsTable.versionId, version.id));
  const hasStock = observations.some((o) => o.stockRowId != null);
  type Balance = {
    unit: string | null;
    fund: string | null;
    productId: number | null;
    lot: string | null;
    pieces: string | null;
    kgLt: string | null;
    ambiguous?: boolean;
  };
  const key = (b: Balance) =>
    JSON.stringify([b.fund, b.productId, b.lot ?? "", b.unit]);
  const ext = new Map<string, Balance>();
  for (const o of observations.filter((o) =>
    hasStock ? o.stockRowId != null : o.rowId != null,
  )) {
    const v = o.interpretedJson;
    const b: Balance = {
      unit:
        (hasStock ? v.kgLt : v.balanceKgLt) == null
          ? "pz"
          : ((v.unit as string | null) ?? null),
      fund: v.fund as string | null,
      productId: v.productId as number | null,
      lot: v.lot as string | null,
      pieces: (hasStock ? v.pieces : v.balancePieces) as string | null,
      kgLt: (hasStock ? v.kgLt : v.balanceKgLt) as string | null,
      ambiguous:
        o.qualityJson.length > 0 ||
        ((hasStock ? v.kgLt : v.balanceKgLt) != null && v.unit == null),
    };
    const old = ext.get(key(b));
    if (old) {
      old.ambiguous ||= b.ambiguous;
      // Registry final balances repeat on every movement: never sum them.
      if (hasStock) {
        old.pieces = addDimension(old.pieces, b.pieces);
        old.kgLt = addDimension(old.kgLt, b.kgLt);
      } else if (
        exact(old.pieces) !== exact(b.pieces) ||
        exact(old.kgLt) !== exact(b.kgLt)
      )
        old.ambiguous = true;
    } else ext.set(key(b), b);
  }
  const loc = new Map<string, Balance>();
  for (const l of local) {
    const b = {
      unit: l.kgLt == null ? "pz" : (l.unit ?? null),
      fund: l.fund,
      productId: l.productId,
      lot: l.lotCodeSnapshot,
      pieces: l.pieces,
      kgLt: l.kgLt,
    };
    const old = loc.get(key(b));
    if (old) {
      old.pieces = addDimension(old.pieces, b.pieces);
      old.kgLt = addDimension(old.kgLt, b.kgLt);
    } else loc.set(key(b), b);
  }
  return [...new Set([...loc.keys(), ...ext.keys()])].sort().map((k) => {
    const l = loc.get(k),
      e = ext.get(k);
    const equal =
      l &&
      e &&
      !e.ambiguous &&
      e.productId != null &&
      exact(l.pieces) === exact(e.pieces) &&
      exact(l.kgLt) === exact(e.kgLt);
    const status = equal
      ? "SALDO_RICONCILIATO"
      : e?.ambiguous
        ? "SALDO_ESTERNO_AMBIGUO"
        : !e
          ? "PARTITA_SOLO_LOCALE"
          : !l
            ? "PARTITA_SOLO_AGEA"
            : "SCOSTAMENTO_SALDO_ENTRAMBI";
    const base: ReconciliationRow = {
      tipoRiga: "SALDO_PARTITA",
      businessKey: `SALDO:M3B:${canonicalSha256(k)}`,
      matchMethod: "PARTITA_AS_OF",
      localEventKey: null,
      localLineKey: null,
      movimentoId: null,
      operazioneDistribuzioneId: null,
      externalMovementId: null,
      importazioneAgeaRigaId: null,
      aggregateVersionId: version.id,
      aggregationKey: {
        fund: (e ?? l)!.fund,
        productId: (e ?? l)!.productId,
        lot: (e ?? l)!.lot,
        unit: (e ?? l)!.unit,
      },
      fundLocal: l?.fund ?? null,
      fundExternal: e?.fund ?? null,
      productIdLocal: l?.productId ?? null,
      productIdExternal: e?.productId ?? null,
      lotLocal: l?.lot ?? null,
      lotExternal: e?.lot ?? null,
      dateLocal: version.referenceDate,
      dateExternal: version.referenceDate,
      piecesLocal: exact(l?.pieces ?? null),
      piecesExternal: exact(e?.pieces ?? null),
      kgLtLocal: exact(l?.kgLt ?? null),
      kgLtExternal: exact(e?.kgLt ?? null),
      differencePieces: difference(l?.pieces ?? null, e?.pieces ?? null),
      differenceKgLt: difference(l?.kgLt ?? null, e?.kgLt ?? null),
      channelLocal: null,
      channelExternal: null,
      status,
      blocking: !equal,
      qualityCodesJson: equal ? [] : [status],
      contentHash: "",
    };
    return {
      ...base,
      contentHash: canonicalSha256({ ...base, contentHash: undefined }),
    };
  });
}
function addDimension(a: string | null, b: string | null) {
  return a == null || b == null
    ? null
    : InventoryDecimal.parse(a, { allowNegative: true })
        .add(InventoryDecimal.parse(b, { allowNegative: true }))
        .toDb();
}

async function buildAdministrativeReconciliation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  version: typeof fseAdministrativeVersionsTable.$inferSelect,
  baselineRunId: number | null,
  cutoff: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number },
) {
  const [baseline] =
    baselineRunId == null
      ? []
      : await tx
          .select()
          .from(fseReconciliationRunsTable)
          .where(eq(fseReconciliationRunsTable.id, baselineRunId));
  if (baselineRunId != null && !baseline?.administrativeVersionId)
    throw new FseReportingError(409, "Baseline M3B non compatibile");
  const [prior] =
    baseline?.administrativeVersionId == null
      ? []
      : await tx
          .select()
          .from(fseAdministrativeVersionsTable)
          .where(
            eq(
              fseAdministrativeVersionsTable.id,
              baseline.administrativeVersionId,
            ),
          );
  if (
    prior &&
    (prior.sourceRegistryId !== version.sourceRegistryId ||
      prior.magazzinoId !== version.magazzinoId ||
      prior.mode !== version.mode ||
      prior.referenceDate >= version.referenceDate)
  )
    throw new FseReportingError(
      409,
      "Baseline di altra fonte, ambito o stesso periodo: selezionare un run precedente compatibile",
    );
  if (
    baseline &&
    (cutoff.maxMovimentoId < baseline.maxMovementId ||
      cutoff.maxOperazioneDistribuzioneId < baseline.maxOperationId)
  )
    throw new FseReportingError(
      409,
      "Cutoff precedente alla baseline: selezionare un'istantanea non regressiva",
    );
  const current = await loadAdministrativeLines(tx, version.id);
  const previous = prior ? await loadAdministrativeLines(tx, prior.id) : [];
  const delta = currentExternalDelta(current, previous);
  const allLocal = await loadLocal(
    tx,
    version.magazzinoId,
    version.referenceDate,
    cutoff.maxMovimentoId,
    cutoff.maxOperazioneDistribuzioneId,
  );
  const local = selectLocalReconciliationDelta(
    allLocal,
    prior?.referenceDate ?? null,
    baseline?.maxMovementId ?? null,
  );
  const missing = delta.missing.map((e) => {
    const row = {
      ...externalOnly(e),
      status: "MOVIMENTO_AGEA_SCOMPARSO",
      blocking: true,
      qualityCodesJson: [
        ...new Set(["MOVIMENTO_AGEA_SCOMPARSO", ...(e.qualityCodes ?? [])]),
      ],
    };
    return {
      ...row,
      businessKey: row.businessKey + ":SCOMPARSO",
      contentHash: canonicalSha256(row),
    };
  });
  const rows = [
    ...reconcileFseLines(local, delta.added),
    ...delta.changed.map(administrativeQualityChange),
    ...missing,
    ...(await administrativeBalanceRows(tx, version, cutoff)),
  ].sort((a, b) => a.businessKey.localeCompare(b.businessKey));
  return {
    rows,
    summary: totals(rows),
    canonicalHash: canonicalSha256({
      source: "FSE_M3B",
      manifest: version.manifestHash,
      baselineRunId,
      cutoff,
      rows,
    }),
  };
}

async function calculateAdministrativeReconciliation(
  input: ReconciliationInput,
) {
  if (
    !input.sessionId ||
    !input.sessionVersion ||
    !input.commandKey?.trim() ||
    input.commandKey.length > 100 ||
    input.importazioneAgeaId != null ||
    input.importazioneAgeaPrecedenteId != null
  )
    throw new FseReportingError(
      400,
      "Fonte M3B: sessione, versione e chiave comando obbligatorie; riferimenti legacy non ammessi",
    );
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-reconciliation-command:${input.commandKey}`},0))`,
    );
    const session = await lockAdministrativeSource(tx, {
      sessionId: input.sessionId!,
      warehouseId: input.magazzinoId,
      actorId: input.creatoDa,
    });
    const commandHash = canonicalSha256({
      sourceType: "FSE_M3B",
      sessionId: input.sessionId,
      sessionVersion: input.sessionVersion,
      warehouse: input.magazzinoId,
      reference: input.dataRiferimento,
      baselineRunId: input.baselineRunId ?? null,
      requestedCutoff: input.cutoff ?? null,
    });
    const [replay] = await tx
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.commandKey, input.commandKey!));
    if (replay) {
      if (replay.commandHash !== commandHash)
        throw new FseReportingError(
          409,
          "Chiave comando riutilizzata con parametri diversi",
        );
      const [receipt] = await tx
        .select()
        .from(fseReconciliationRunsTable)
        .where(
          and(
            eq(fseReconciliationRunsTable.reconciliationId, replay.id),
            eq(fseReconciliationRunsTable.headerVersion, 1),
          ),
        );
      if (!receipt?.snapshotJson.header)
        throw new FseReportingError(
          409,
          "Ricevuta del comando non disponibile",
        );
      return {
        reconciliation: receipt.snapshotJson.header as typeof replay,
        rows: receipt.snapshotJson.rows as ReconciliationRow[],
        replayed: true,
      };
    }
    const version = await freezeAdministrativeSource(tx, {
      session,
      expectedVersion: input.sessionVersion!,
      referenceDate: input.dataRiferimento,
      actorId: input.creatoDa,
    });
    const cutoff =
      input.cutoff ??
      (await currentFseCutoff(tx, input.magazzinoId, input.dataRiferimento));
    const calculated = await buildAdministrativeReconciliation(
      tx,
      version,
      input.baselineRunId ?? null,
      cutoff,
    );
    const [header] = await tx
      .insert(riconciliazioniFseTable)
      .values({
        magazzinoId: input.magazzinoId,
        sourceType: "FSE_M3B",
        administrativeVersionId: version.id,
        baselineRunId: input.baselineRunId ?? null,
        commandKey: input.commandKey,
        commandHash,
        dataRiferimento: input.dataRiferimento,
        ...cutoff,
        modelVersion: "M64_ADMIN_V1",
        canonicalHash: calculated.canonicalHash,
        stato: calculated.summary.bloccanti ? "DA_RIVEDERE" : "CALCOLATA",
        ...calculated.summary,
        creatoDa: input.creatoDa,
      })
      .returning();
    if (calculated.rows.length)
      await tx.insert(riconciliazioniFseRigheTable).values(
        calculated.rows.map((row) => ({
          ...persistedRow(row),
          riconciliazioneId: header.id,
        })),
      );
    await tx.insert(fseReconciliationRunsTable).values({
      reconciliationId: header.id,
      headerVersion: header.versione,
      administrativeVersionId: version.id,
      baselineRunId: input.baselineRunId ?? null,
      maxMovementId: cutoff.maxMovimentoId,
      maxOperationId: cutoff.maxOperazioneDistribuzioneId,
      referenceDate: input.dataRiferimento,
      canonicalHash: calculated.canonicalHash,
      snapshotJson: {
        header,
        rows: calculated.rows,
        manifestHash: version.manifestHash,
      },
      creatoDa: input.creatoDa,
    });
    if (input.audit)
      await recordAuditEvent(tx, {
        command: input.audit,
        azione: "FSE_RICONCILIAZIONE_CREATA",
        entitaTipo: "riconciliazione_fse",
        entitaId: header.id,
        magazzinoIdSnapshot: header.magazzinoId,
      });
    return { reconciliation: header, rows: calculated.rows, replayed: false };
  });
}

export async function calculateFseReconciliation(input: ReconciliationInput) {
  if (input.sourceType === "FSE_M3B")
    return calculateAdministrativeReconciliation(input);
  if (input.importazioneAgeaId == null || input.sessionId != null)
    throw new FseReportingError(400, "Importazione legacy richiesta");
  const importId = input.importazioneAgeaId;
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-reconciliation:${input.magazzinoId}`}, 0))`,
    );
    if (input.audit)
      await requireCurrentFseWarehouse(
        tx,
        auditUserId(input.audit),
        "magazzino.fse.reconcile",
        input.magazzinoId,
      );
    const [agea] = await tx
      .select()
      .from(importazioniAgeaTable)
      .where(eq(importazioniAgeaTable.id, importId))
      .for("share");
    if (!agea)
      throw new FseReportingError(404, "Importazione AGEA non trovata");
    if (agea.magazzinoId !== input.magazzinoId)
      throw new FseReportingError(
        409,
        "Importazione AGEA di un altro Magazzino",
      );
    if (agea.stato !== "CONFERMATA")
      throw new FseReportingError(
        409,
        "L'importazione AGEA deve essere confermata",
      );
    let previousReference: string | null = null;
    if (input.importazioneAgeaPrecedenteId != null) {
      const [previous] = await tx
        .select()
        .from(importazioniAgeaTable)
        .where(
          eq(importazioniAgeaTable.id, input.importazioneAgeaPrecedenteId),
        );
      if (
        !previous ||
        previous.id === agea.id ||
        previous.magazzinoId !== input.magazzinoId ||
        previous.stato !== "CONFERMATA" ||
        previous.dataRiferimento >= agea.dataRiferimento
      )
        throw new FseReportingError(409, "Baseline AGEA precedente non valida");
      previousReference = previous.dataRiferimento;
    }
    const baseline = await selectLegacyBaselineRun(
      tx,
      input.magazzinoId,
      input.importazioneAgeaPrecedenteId ?? null,
      input.baselineRunId ?? null,
    );
    const cutoff =
      input.cutoff ??
      (await currentFseCutoff(tx, input.magazzinoId, input.dataRiferimento));
    const [local, externalCurrent, externalPrevious, balanceRows] =
      await Promise.all([
        loadLocal(
          tx,
          input.magazzinoId,
          input.dataRiferimento,
          cutoff.maxMovimentoId,
          cutoff.maxOperazioneDistribuzioneId,
        ),
        loadExternal(tx, importId),
        input.importazioneAgeaPrecedenteId == null
          ? Promise.resolve([])
          : loadExternal(tx, input.importazioneAgeaPrecedenteId),
        loadBalanceRows(tx, {
          magazzinoId: input.magazzinoId,
          importId,
          dataRiferimento: input.dataRiferimento,
          maxMovimentoId: cutoff.maxMovimentoId,
          maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
        }),
      ]);
    const externalDelta = currentExternalDelta(
      externalCurrent,
      externalPrevious,
    );
    const localDelta = selectLocalReconciliationDelta(
      local,
      previousReference,
      baseline?.maxMovementId ?? null,
    );
    const missingRows = externalDelta.missing.map((row) => {
      const base = externalOnly(row);
      const missing = {
        ...base,
        businessKey: `${base.businessKey}:SCOMPARSO`,
        status: "MOVIMENTO_AGEA_SCOMPARSO",
        blocking: true,
        exact: false,
        qualityCodesJson: ["MOVIMENTO_AGEA_SCOMPARSO"],
      };
      return { ...missing, contentHash: canonicalSha256(missing) };
    });
    const rows = [
      ...reconcileFseLines(localDelta, externalDelta.added),
      ...missingRows,
      ...balanceRows,
    ].sort((a, b) => a.businessKey.localeCompare(b.businessKey));
    const summary = totals(rows);
    const canonicalHash = canonicalSha256({
      modelVersion: FSE_REPORTING_MODEL_VERSION,
      magazzinoId: input.magazzinoId,
      importazioneAgeaId: input.importazioneAgeaId,
      importazioneAgeaPrecedenteId: input.importazioneAgeaPrecedenteId ?? null,
      dataRiferimento: input.dataRiferimento,
      cutoff,
      rows,
    });
    const requestHash = canonicalSha256({
      magazzinoId: input.magazzinoId,
      importazioneAgeaId: input.importazioneAgeaId,
      importazioneAgeaPrecedenteId: input.importazioneAgeaPrecedenteId ?? null,
      dataRiferimento: input.dataRiferimento,
      cutoff,
      baselineRunId: baseline?.id ?? null,
    });
    const [existing] = await tx
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.requestHash, requestHash));
    if (existing) {
      if (existing.canonicalHash !== canonicalHash)
        throw new FseReportingError(
          409,
          "Riconciliazione equivalente con contenuto canonico diverso",
        );
      const existingRows = await tx
        .select()
        .from(riconciliazioniFseRigheTable)
        .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, existing.id));
      return { reconciliation: existing, rows: existingRows, replayed: true };
    }
    const idempotencyKey = canonicalSha256({ requestHash, canonicalHash });
    const [header] = await tx
      .insert(riconciliazioniFseTable)
      .values({
        magazzinoId: input.magazzinoId,
        baselineRunId: baseline?.id ?? null,
        importazioneAgeaId: input.importazioneAgeaId,
        importazioneAgeaPrecedenteId:
          input.importazioneAgeaPrecedenteId ?? null,
        dataRiferimento: input.dataRiferimento,
        maxMovimentoId: cutoff.maxMovimentoId,
        maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
        modelVersion: FSE_REPORTING_MODEL_VERSION,
        canonicalHash,
        requestHash,
        idempotencyKey,
        stato: summary.bloccanti > 0 ? "DA_RIVEDERE" : "CALCOLATA",
        ...summary,
        creatoDa: input.creatoDa,
      })
      .returning();
    if (rows.length)
      await tx.insert(riconciliazioniFseRigheTable).values(
        rows.map((row) => ({
          ...persistedRow(row),
          riconciliazioneId: header.id,
        })),
      );
    await preserveLegacyRun(tx, header);
    if (input.audit)
      await recordAuditEvent(tx, {
        command: input.audit,
        azione: "FSE_RICONCILIAZIONE_CREATA",
        entitaTipo: "riconciliazione_fse",
        entitaId: header.id,
        magazzinoIdSnapshot: header.magazzinoId,
      });
    return { reconciliation: header, rows, replayed: false };
  });
}

async function preserveLegacyRun(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  header: typeof riconciliazioniFseTable.$inferSelect,
) {
  const [existing] = await tx
    .select()
    .from(fseReconciliationRunsTable)
    .where(
      and(
        eq(fseReconciliationRunsTable.reconciliationId, header.id),
        eq(fseReconciliationRunsTable.headerVersion, header.versione),
      ),
    );
  if (existing) return existing;
  const rows = await tx
    .select()
    .from(riconciliazioniFseRigheTable)
    .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, header.id));
  const [saved] = await tx
    .insert(fseReconciliationRunsTable)
    .values({
      reconciliationId: header.id,
      headerVersion: header.versione,
      legacyImportId: header.importazioneAgeaId,
      baselineRunId: header.baselineRunId,
      maxMovementId: header.maxMovimentoId,
      maxOperationId: header.maxOperazioneDistribuzioneId,
      referenceDate: header.dataRiferimento,
      canonicalHash: header.canonicalHash,
      snapshotJson: { header, rows, capturedLegacyState: true },
      creatoDa: header.creatoDa,
    })
    .returning();
  return saved;
}

async function selectLegacyBaselineRun(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  warehouseId: number,
  previousImportId: number | null,
  runId: number | null,
) {
  if (previousImportId == null) {
    if (runId != null)
      throw new FseReportingError(
        409,
        "Run baseline senza importazione precedente",
      );
    return null;
  }
  if (runId != null) {
    const [run] = await tx
      .select({ run: fseReconciliationRunsTable })
      .from(fseReconciliationRunsTable)
      .innerJoin(
        riconciliazioniFseTable,
        eq(
          fseReconciliationRunsTable.reconciliationId,
          riconciliazioniFseTable.id,
        ),
      )
      .where(
        and(
          eq(fseReconciliationRunsTable.id, runId),
          eq(fseReconciliationRunsTable.legacyImportId, previousImportId),
          eq(riconciliazioniFseTable.magazzinoId, warehouseId),
        ),
      );
    if (!run)
      throw new FseReportingError(409, "Run baseline legacy non compatibile");
    return run.run;
  }
  const headers = await tx
    .select()
    .from(riconciliazioniFseTable)
    .where(
      and(
        eq(riconciliazioniFseTable.importazioneAgeaId, previousImportId),
        eq(riconciliazioniFseTable.magazzinoId, warehouseId),
      ),
    )
    .for("share");
  // Preserve the historical date-only baseline when there is no local run. Never
  // replace a known but ambiguous cutoff with an arbitrary latest identifier.
  if (headers.length === 0) return null;
  if (headers.length !== 1)
    throw new FseReportingError(
      409,
      "Più calcoli della baseline: selezionare il run esatto",
    );
  const runs = await tx
    .select()
    .from(fseReconciliationRunsTable)
    .where(eq(fseReconciliationRunsTable.reconciliationId, headers[0].id));
  if (runs.length > 1)
    throw new FseReportingError(
      409,
      "Più run della baseline: selezionare il cutoff esatto",
    );
  return runs[0] ?? preserveLegacyRun(tx, headers[0]);
}

export async function refreshReconciliationCounts(
  executor: DbExecutor,
  id: number,
) {
  const result = await executor.execute(sql`
    SELECT count(*)::int AS totale,
      count(*) FILTER (WHERE status IN ('RICONCILIATA_ESATTA','SALDO_RICONCILIATO'))::int AS riconciliate,
      count(*) FILTER (WHERE status = 'SOLO_LOCALE_DA_RENDICONTARE')::int AS solo_locali,
      count(*) FILTER (WHERE status = 'SOLO_AGEA')::int AS solo_agea,
      count(*) FILTER (WHERE status NOT IN ('RICONCILIATA_ESATTA','SALDO_RICONCILIATO','SOLO_LOCALE_DA_RENDICONTARE','SOLO_AGEA'))::int AS scostamenti,
      count(*) FILTER (WHERE status = 'IDENTITA_AMBIGUA')::int AS ambigue,
      count(*) FILTER (WHERE status = 'SCOSTAMENTO_ACCETTATO')::int AS scostamenti_accettati,
      count(*) FILTER (WHERE blocking)::int AS bloccanti
    FROM riconciliazioni_fse_righe
    WHERE riconciliazione_id = ${id} AND active = true
  `);
  const row = result.rows[0] as Record<string, number>;
  await executor.execute(
    sql`UPDATE riconciliazioni_fse SET totale_righe=${row.totale}, riconciliate=${row.riconciliate}, solo_locali=${row.solo_locali}, solo_agea=${row.solo_agea}, scostamenti=${row.scostamenti}, scostamenti_accettati=${row.scostamenti_accettati}, ambigue=${row.ambigue}, bloccanti=${row.bloccanti} WHERE id=${id}`,
  );
}

export async function compareReconciliationTargets(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  header: typeof riconciliazioniFseTable.$inferSelect,
  movementId: number,
  externalId: number,
) {
  const local = (
    await loadLocal(
      tx,
      header.magazzinoId,
      header.dataRiferimento,
      header.maxMovimentoId,
      header.maxOperazioneDistribuzioneId,
    )
  ).find((r) => r.movementId === movementId);
  const externalRows =
    header.sourceType === "FSE_M3B"
      ? await loadAdministrativeLines(tx, header.administrativeVersionId!)
      : await loadExternal(tx, header.importazioneAgeaId!);
  let external = externalRows.find((r) => r.importRowId === externalId);
  if (!external && header.baselineRunId != null) {
    const [baseline] = await tx
      .select()
      .from(fseReconciliationRunsTable)
      .where(eq(fseReconciliationRunsTable.id, header.baselineRunId));
    const previous =
      baseline?.administrativeVersionId != null
        ? await loadAdministrativeLines(tx, baseline.administrativeVersionId)
        : baseline?.legacyImportId != null
          ? await loadExternal(tx, baseline.legacyImportId)
          : [];
    external = previous.find((r) => r.importRowId === externalId);
    // A disappearance remains a documented difference even after manual pairing.
    if (local && external) return "MOVIMENTO_AGEA_SCOMPARSO";
  }
  if (!local || !external)
    throw new FseReportingError(
      409,
      "Abbinamento non appartenente alla fonte corrente e al cutoff congelato",
    );
  // Use the same matcher, including raw corrections and indivisible statistics.
  return mismatch(local, external);
}

export async function requireOpenReconciliation(
  executor: DbExecutor,
  id: number,
  currentVersion: number,
) {
  const [row] = await executor
    .select()
    .from(riconciliazioniFseTable)
    .where(
      and(
        eq(riconciliazioniFseTable.id, id),
        eq(riconciliazioniFseTable.versione, currentVersion),
      ),
    )
    .for("update");
  if (!row)
    throw new FseReportingError(409, "Versione riconciliazione non corrente");
  if (
    ["RICONCILIATA", "CHIUSA_CON_SCOSTAMENTI", "ANNULLATA"].includes(row.stato)
  )
    throw new FseReportingError(409, "Riconciliazione chiusa o annullata");
  return row;
}

export async function recalculateFseReconciliation(input: {
  audit?: AuditCommandContext;
  id: number;
  versione: number;
  actorId: number;
  sessionVersion?: number;
  cutoff?: { maxMovimentoId: number; maxOperazioneDistribuzioneId: number };
}) {
  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select()
      .from(riconciliazioniFseTable)
      .where(eq(riconciliazioniFseTable.id, input.id));
    if (identity?.sourceType === "FSE_M3B") {
      const [oldSource] = await tx
        .select()
        .from(fseAdministrativeVersionsTable)
        .where(
          eq(
            fseAdministrativeVersionsTable.id,
            identity.administrativeVersionId!,
          ),
        );
      const session = await lockAdministrativeSource(tx, {
        sessionId: oldSource.sessionId,
        warehouseId: identity.magazzinoId,
        actorId: input.actorId,
      });
      const header = await requireOpenReconciliation(
        tx,
        input.id,
        input.versione,
      );
      const [resolution] = await tx
        .select()
        .from(riconciliazioniFseRisoluzioniTable)
        .where(
          eq(riconciliazioniFseRisoluzioniTable.riconciliazioneId, header.id),
        )
        .limit(1);
      if (resolution)
        throw new FseReportingError(
          409,
          "Il ricalcolo non può eliminare risoluzioni manuali auditabili",
        );
      if (!input.sessionVersion)
        throw new FseReportingError(
          400,
          "Confermare la versione amministrativa della procedura per ricalcolare",
        );
      const source = await freezeAdministrativeSource(tx, {
        session,
        expectedVersion: input.sessionVersion,
        referenceDate: header.dataRiferimento,
        actorId: input.actorId,
      });
      const cutoff =
        input.cutoff ??
        (await currentFseCutoff(
          tx,
          header.magazzinoId,
          header.dataRiferimento,
        ));
      const calculated = await buildAdministrativeReconciliation(
        tx,
        source,
        header.baselineRunId,
        cutoff,
      );
      // Previous source, cutoff and calculated rows remain in the immutable run ledger.
      await tx
        .delete(riconciliazioniFseRigheTable)
        .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, header.id));
      const [updated] = await tx
        .update(riconciliazioniFseTable)
        .set({
          ...cutoff,
          administrativeVersionId: source.id,
          canonicalHash: calculated.canonicalHash,
          ...calculated.summary,
          stato: calculated.summary.bloccanti ? "DA_RIVEDERE" : "CALCOLATA",
          versione: header.versione + 1,
          ricalcolatoDa: input.actorId,
          dataRicalcolo: new Date(),
        })
        .where(eq(riconciliazioniFseTable.id, header.id))
        .returning();
      if (calculated.rows.length)
        await tx.insert(riconciliazioniFseRigheTable).values(
          calculated.rows.map((row) => ({
            ...persistedRow(row),
            riconciliazioneId: header.id,
          })),
        );
      await tx.insert(fseReconciliationRunsTable).values({
        reconciliationId: header.id,
        headerVersion: updated.versione,
        administrativeVersionId: source.id,
        baselineRunId: header.baselineRunId,
        maxMovementId: cutoff.maxMovimentoId,
        maxOperationId: cutoff.maxOperazioneDistribuzioneId,
        referenceDate: header.dataRiferimento,
        canonicalHash: calculated.canonicalHash,
        snapshotJson: {
          rows: calculated.rows,
          manifestHash: source.manifestHash,
        },
        creatoDa: input.actorId,
      });
      if (input.audit)
        await recordAuditEvent(tx, {
          command: input.audit,
          azione: "FSE_RICONCILIAZIONE_RICALCOLATA",
          entitaTipo: "riconciliazione_fse",
          entitaId: header.id,
          magazzinoIdSnapshot: header.magazzinoId,
        });
      return { reconciliation: updated, rows: calculated.rows };
    }
    const header = await requireOpenReconciliation(
      tx,
      input.id,
      input.versione,
    );
    if (input.audit)
      await requireCurrentFseWarehouse(
        tx,
        auditUserId(input.audit),
        "magazzino.fse.reconcile",
        header.magazzinoId,
      );
    const [resolution] = await tx
      .select({ id: riconciliazioniFseRisoluzioniTable.id })
      .from(riconciliazioniFseRisoluzioniTable)
      .innerJoin(
        riconciliazioniFseRigheTable,
        eq(
          riconciliazioniFseRisoluzioniTable.riconciliazioneRigaId,
          riconciliazioniFseRigheTable.id,
        ),
      )
      .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, input.id))
      .limit(1);
    if (resolution)
      throw new FseReportingError(
        409,
        "Il ricalcolo non può eliminare risoluzioni manuali auditabili",
      );
    const cutoff =
      input.cutoff ??
      (await currentFseCutoff(tx, header.magazzinoId, header.dataRiferimento));
    await preserveLegacyRun(tx, header);
    const baseline = await selectLegacyBaselineRun(
      tx,
      header.magazzinoId,
      header.importazioneAgeaPrecedenteId,
      header.baselineRunId,
    );
    const [local, external, balanceRows, previousExternal] = await Promise.all([
      loadLocal(
        tx,
        header.magazzinoId,
        header.dataRiferimento,
        cutoff.maxMovimentoId,
        cutoff.maxOperazioneDistribuzioneId,
      ),
      loadExternal(tx, header.importazioneAgeaId!),
      loadBalanceRows(tx, {
        magazzinoId: header.magazzinoId,
        importId: header.importazioneAgeaId!,
        dataRiferimento: header.dataRiferimento,
        maxMovimentoId: cutoff.maxMovimentoId,
        maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
      }),
      header.importazioneAgeaPrecedenteId == null
        ? Promise.resolve([])
        : loadExternal(tx, header.importazioneAgeaPrecedenteId),
    ]);
    const [previousImport] =
      header.importazioneAgeaPrecedenteId == null
        ? []
        : await tx
            .select()
            .from(importazioniAgeaTable)
            .where(
              eq(importazioniAgeaTable.id, header.importazioneAgeaPrecedenteId),
            );
    const delta = currentExternalDelta(external, previousExternal);
    const missing = delta.missing.map((row) => {
      const value = {
        ...externalOnly(row),
        status: "MOVIMENTO_AGEA_SCOMPARSO",
        blocking: true,
        qualityCodesJson: ["MOVIMENTO_AGEA_SCOMPARSO"],
      };
      return { ...value, contentHash: canonicalSha256(value) };
    });
    const rows = [
      ...reconcileFseLines(
        selectLocalReconciliationDelta(
          local,
          previousImport?.dataRiferimento ?? null,
          baseline?.maxMovementId ?? null,
        ),
        delta.added,
      ),
      ...missing,
      ...balanceRows,
    ].sort((a, b) => a.businessKey.localeCompare(b.businessKey));
    const summary = totals(rows);
    const canonicalHash = canonicalSha256({
      modelVersion: FSE_REPORTING_MODEL_VERSION,
      magazzinoId: header.magazzinoId,
      importazioneAgeaId: header.importazioneAgeaId,
      importazioneAgeaPrecedenteId: header.importazioneAgeaPrecedenteId,
      dataRiferimento: header.dataRiferimento,
      cutoff,
      rows,
    });
    await tx
      .delete(riconciliazioniFseRigheTable)
      .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, input.id));
    if (rows.length)
      await tx.insert(riconciliazioniFseRigheTable).values(
        rows.map((row) => ({
          ...persistedRow(row),
          riconciliazioneId: input.id,
        })),
      );
    const [updated] = await tx
      .update(riconciliazioniFseTable)
      .set({
        maxMovimentoId: cutoff.maxMovimentoId,
        baselineRunId: baseline?.id ?? null,
        maxOperazioneDistribuzioneId: cutoff.maxOperazioneDistribuzioneId,
        canonicalHash,
        stato: summary.bloccanti > 0 ? "DA_RIVEDERE" : "CALCOLATA",
        ...summary,
        versione: input.versione + 1,
        ricalcolatoDa: input.actorId,
        dataRicalcolo: new Date(),
      })
      .where(eq(riconciliazioniFseTable.id, input.id))
      .returning();
    await preserveLegacyRun(tx, updated);
    if (input.audit)
      await recordAuditEvent(tx, {
        command: input.audit,
        azione: "FSE_RICONCILIAZIONE_RICALCOLATA",
        entitaTipo: "riconciliazione_fse",
        entitaId: updated.id,
        magazzinoIdSnapshot: updated.magazzinoId,
      });
    return { reconciliation: updated, rows };
  });
}
