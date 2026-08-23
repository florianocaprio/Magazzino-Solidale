import { createHash } from "node:crypto";
import {
  carichiMagazzinoTable,
  importazioniAgeaPartiteTable,
  importazioniAgeaRigheTable,
  importazioniAgeaTable,
  lottiTable,
  mappatureProdottiEsterniTable,
  movimentiEsterniAgeaTable,
  prodottiTable,
  systemLogsTable,
  type AgeaImportMode,
  type FondoOrigine,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";
import {
  createWarehouseLoad,
  findInventoryPartyCandidates,
  inventoryPartyBusinessKey,
  InventoryLedgerError,
  lockInventoryPartyBusinessKeys,
} from "./inventoryLedger";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  AGEA_PARSER_VERSION,
  AGEA_TRACE_CODE,
  AGEA_MAX_LOT_LENGTH,
  AGEA_XLSX_MIME,
  normalizeAgeaKey,
  normalizeAgeaText,
  parseAgeaWorkbook,
  type ParsedAgeaRow,
} from "./ageaSifeadParser";

export class AgeaImportError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function ratioHalfUp(
  kgLt: string | null,
  pieces: string | null,
): string | null {
  if (!kgLt || !pieces) return null;
  const kg = InventoryDecimal.parse(kgLt, { allowNegative: true }).abs();
  const pz = InventoryDecimal.parse(pieces, { allowNegative: true }).abs();
  if (kg.isZero() || pz.isZero()) return null;
  const scale = 1_000_000_000n;
  const numerator = kg.toUnits() * scale;
  const denominator = pz.toUnits();
  const units = (numerator + denominator / 2n) / denominator;
  return `${units / scale}.${String(units % scale).padStart(9, "0")}`;
}

function operationalQuantity(
  unit: string,
  pieces: string | null,
  kgLt: string | null,
): string | null {
  const normalized = unit.trim().toLowerCase();
  if (normalized === "pz") return pieces;
  if (["kg", "lt", "l"].includes(normalized)) return kgLt;
  return null;
}

function positive(value: string | null): boolean {
  return (
    value != null &&
    InventoryDecimal.parse(value, { allowNegative: true }).isPositive()
  );
}

function absolute(value: string | null): string | null {
  return value == null
    ? null
    : InventoryDecimal.parse(value, { allowNegative: true }).abs().toDb();
}

function sign(value: string | null): -1 | 0 | 1 {
  if (value == null) return 0;
  const parsed = InventoryDecimal.parse(value, { allowNegative: true });
  return parsed.isZero() ? 0 : parsed.isPositive() ? 1 : -1;
}

function effectiveLot(row: typeof importazioniAgeaRigheTable.$inferSelect) {
  return {
    raw: row.lottoEffettivoRaw ?? row.lottoRaw,
    normalized: row.lottoEffettivoNormalizzato ?? row.lottoNormalizzato,
  };
}

function partyKeyForRow(
  row: typeof importazioniAgeaRigheTable.$inferSelect,
): string {
  const fund = row.fondoNormalizzato ?? "?";
  const lot = effectiveLot(row).normalized ?? "∅";
  return row.prodottoIdSnapshot == null
    ? ["EXT", fund, row.prodottoNormalizzato, lot].join("|")
    : ["INT", row.prodottoIdSnapshot, fund, lot].join("|");
}

function mutableRowState(
  row: typeof importazioniAgeaRigheTable.$inferSelect,
  mapped: boolean,
): string {
  if (
    [
      "DUPLICATA",
      "MODIFICATO_NEL_REGISTRO",
      "IDENTITA_AMBIGUA",
      "APPLICATO_INCREMENTALE",
      "ASSORBITO_SALDO_INIZIALE",
    ].includes(row.statoRiga)
  )
    return row.statoRiga;
  if (row.blocking) return "BLOCCATA";
  if (!mapped) return "DA_MAPPARE";
  if (row.tipoMovimentoEsterno === "CARICO") return "DA_APPLICARE";
  return row.tipoMovimentoEsterno === "RESO"
    ? "RESO_RIFERIMENTO"
    : "SCARICO_RIFERIMENTO";
}

const DATA_CARICO_GRUPPO_INCOERENTE = "DATA_CARICO_GRUPPO_INCOERENTE";
const LOTTO_NON_VALIDO = "LOTTO_NON_VALIDO";

function documentGroupKey(
  row: typeof importazioniAgeaRigheTable.$inferSelect,
): string | null {
  if (row.tipoMovimentoEsterno !== "CARICO" || !row.numeroDocumentoNormalizzato)
    return null;
  return [
    row.numeroDocumentoNormalizzato,
    row.dataDocumento ?? "∅",
    normalizeAgeaKey(row.mittenteDestinatarioRaw) ?? "∅",
  ].join("|");
}

function effectiveLoadDate(
  row: typeof importazioniAgeaRigheTable.$inferSelect,
): string | null {
  return row.dataCaricoEffettiva ?? row.dataCaricoRisolta;
}

async function applyDynamicRowPreflight(
  tx: InventoryTransaction,
  rows: Array<typeof importazioniAgeaRigheTable.$inferSelect>,
) {
  const documentGroups = new Map<
    string,
    Array<typeof importazioniAgeaRigheTable.$inferSelect>
  >();
  for (const row of rows) {
    const key = documentGroupKey(row);
    if (key) documentGroups.set(key, [...(documentGroups.get(key) ?? []), row]);
  }
  const inconsistentRowIds = new Set<number>();
  for (const group of documentGroups.values()) {
    const dates = new Set(group.map(effectiveLoadDate));
    if (dates.size > 1) group.forEach((row) => inconsistentRowIds.add(row.id));
  }

  const changed: Array<typeof importazioniAgeaRigheTable.$inferSelect> = [];
  for (const row of rows) {
    const errors = row.errorCodesJson.filter(
      (code) =>
        code !== DATA_CARICO_GRUPPO_INCOERENTE && code !== LOTTO_NON_VALIDO,
    );
    if (
      (normalizeAgeaText(effectiveLot(row).raw)?.length ?? 0) >
      AGEA_MAX_LOT_LENGTH
    )
      errors.push(LOTTO_NON_VALIDO);
    if (inconsistentRowIds.has(row.id))
      errors.push(DATA_CARICO_GRUPPO_INCOERENTE);
    const nextErrors = [...new Set(errors)];
    const nextBlocking = nextErrors.length > 0;
    if (
      nextBlocking !== row.blocking ||
      JSON.stringify(nextErrors) !== JSON.stringify(row.errorCodesJson)
    )
      changed.push(row);
    row.errorCodesJson = nextErrors;
    row.blocking = nextBlocking;
  }
  for (let offset = 0; offset < changed.length; offset += 500) {
    const chunk = changed.slice(offset, offset + 500);
    const values = sql.join(
      chunk.map(
        (row) =>
          sql`(${row.id}::integer, ${JSON.stringify(row.errorCodesJson)}::jsonb, ${row.blocking}::boolean)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE importazioni_agea_righe AS r
      SET error_codes_json = v.error_codes,
          blocking = v.blocking
      FROM (VALUES ${values}) AS v(id, error_codes, blocking)
      WHERE r.id = v.id
    `);
  }
}

function assertConsistentDocumentGroupDates(
  rows: Array<typeof importazioniAgeaRigheTable.$inferSelect>,
): void {
  const groups = new Map<
    string,
    Array<typeof importazioniAgeaRigheTable.$inferSelect>
  >();
  for (const row of rows) {
    const key = documentGroupKey(row);
    if (key) groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  if (
    [...groups.values()].some(
      (group) => new Set(group.map(effectiveLoadDate)).size > 1,
    )
  )
    throw new AgeaImportError(
      409,
      DATA_CARICO_GRUPPO_INCOERENTE,
      "Le righe dello stesso documento hanno date carico effettive diverse",
    );
}

async function mappingsForRows(
  tx: InventoryTransaction,
  rows: ParsedAgeaRow[],
) {
  const keys = [...new Set(rows.map((row) => row.prodottoNormalizzato))];
  if (keys.length === 0) return new Map();
  const mappings = await tx
    .select({ mapping: mappatureProdottiEsterniTable, prodotto: prodottiTable })
    .from(mappatureProdottiEsterniTable)
    .innerJoin(
      prodottiTable,
      eq(mappatureProdottiEsterniTable.prodottoId, prodottiTable.id),
    )
    .where(
      and(
        eq(mappatureProdottiEsterniTable.fonte, "AGEA_SIFEAD"),
        eq(mappatureProdottiEsterniTable.attiva, true),
        inArray(
          mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
          keys,
        ),
      ),
    );
  return new Map(
    mappings.map((item) => [item.mapping.chiaveDescrizioneNormalizzata, item]),
  );
}

async function classifyAgainstLedger(
  tx: InventoryTransaction,
  magazzinoId: number,
  rows: ParsedAgeaRow[],
) {
  const baseHashes = [...new Set(rows.map((row) => row.identityBaseHash))];
  const known = baseHashes.length
    ? await tx
        .select()
        .from(movimentiEsterniAgeaTable)
        .where(
          and(
            eq(movimentiEsterniAgeaTable.magazzinoId, magazzinoId),
            inArray(movimentiEsterniAgeaTable.identityBaseHash, baseHashes),
          ),
        )
    : [];

  const rowsByBase = new Map<string, ParsedAgeaRow[]>();
  const knownByBase = new Map<string, typeof known>();
  for (const row of rows)
    rowsByBase.set(row.identityBaseHash, [
      ...(rowsByBase.get(row.identityBaseHash) ?? []),
      row,
    ]);
  for (const movement of known)
    knownByBase.set(movement.identityBaseHash, [
      ...(knownByBase.get(movement.identityBaseHash) ?? []),
      movement,
    ]);

  const setNewRowState = (row: ParsedAgeaRow) => {
    if (row.tipoMovimentoEsterno === "CARICO")
      row.statoRiga = row.blocking ? "BLOCCATA" : "DA_APPLICARE";
    else
      row.statoRiga = row.blocking
        ? "BLOCCATA"
        : row.tipoMovimentoEsterno === "RESO"
          ? "RESO_RIFERIMENTO"
          : "SCARICO_RIFERIMENTO";
  };

  for (const [baseHash, baseRows] of rowsByBase) {
    const baseKnown = (knownByBase.get(baseHash) ?? []).sort(
      (left, right) => left.identityOccurrence - right.identityOccurrence,
    );
    const unmatchedRows = new Set(baseRows);
    const unmatchedKnown = new Set(baseKnown);

    // Il content hash viene abbinato come multinsieme prima di usare ordinali:
    // l'inserimento di una nuova occorrenza non rinumera lo storico già noto.
    for (const movement of baseKnown) {
      const match = [...unmatchedRows]
        .filter((row) => row.contentHash === movement.acceptedContentHash)
        .sort((left, right) => left.numeroRiga - right.numeroRiga)[0];
      if (!match) continue;
      match.identityOccurrence = movement.identityOccurrence;
      match.identityKey = movement.identityKey;
      match.statoRiga = "DUPLICATA";
      unmatchedRows.delete(match);
      unmatchedKnown.delete(movement);
    }

    const remainingRows = [...unmatchedRows].sort(
      (left, right) =>
        left.contentHash.localeCompare(right.contentHash) ||
        left.numeroRiga - right.numeroRiga,
    );
    const remainingKnown = [...unmatchedKnown].sort(
      (left, right) => left.identityOccurrence - right.identityOccurrence,
    );
    if (remainingRows.length && remainingKnown.length) {
      const ambiguous =
        remainingRows.length !== 1 || remainingKnown.length !== 1;
      for (let index = 0; index < remainingRows.length; index += 1) {
        const row = remainingRows[index];
        const previous = remainingKnown[index];
        if (previous) {
          row.identityOccurrence = previous.identityOccurrence;
          row.identityKey = previous.identityKey;
        }
        row.statoRiga = ambiguous
          ? "IDENTITA_AMBIGUA"
          : "MODIFICATO_NEL_REGISTRO";
        row.blocking = true;
        row.errorCodes.push(
          ambiguous ? "IDENTITA_AMBIGUA" : "MODIFICATO_NEL_REGISTRO",
        );
      }
      continue;
    }

    let nextOccurrence =
      Math.max(0, ...baseKnown.map((item) => item.identityOccurrence)) + 1;
    for (const row of remainingRows) {
      row.identityOccurrence = nextOccurrence;
      row.identityKey = `${baseHash}:${nextOccurrence}`;
      nextOccurrence += 1;
      setNewRowState(row);
    }
  }
}

async function rebuildImport(
  tx: InventoryTransaction,
  importId: number,
  expectedVersion?: number,
) {
  const [importRow] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId))
    .for("update");
  if (!importRow)
    throw new AgeaImportError(
      404,
      "IMPORTAZIONE_NON_TROVATA",
      "Importazione non trovata",
    );
  if (["CONFERMATA", "ANNULLATA"].includes(importRow.stato))
    throw new AgeaImportError(
      409,
      "IMPORTAZIONE_IMMUTABILE",
      "L'importazione non è più modificabile",
    );
  if (expectedVersion != null && importRow.versione !== expectedVersion)
    throw new AgeaImportError(
      409,
      "VERSIONE_NON_CORRENTE",
      "La preview è stata aggiornata: ricaricare i dati",
    );
  const rows = await tx
    .select()
    .from(importazioniAgeaRigheTable)
    .where(eq(importazioniAgeaRigheTable.importazioneId, importId));
  await applyDynamicRowPreflight(tx, rows);
  const descriptionKeys = [
    ...new Set(rows.map((row) => row.prodottoNormalizzato)),
  ];
  const mappings = descriptionKeys.length
    ? await tx
        .select({
          mapping: mappatureProdottiEsterniTable,
          prodotto: prodottiTable,
        })
        .from(mappatureProdottiEsterniTable)
        .innerJoin(
          prodottiTable,
          eq(mappatureProdottiEsterniTable.prodottoId, prodottiTable.id),
        )
        .where(
          and(
            eq(mappatureProdottiEsterniTable.fonte, "AGEA_SIFEAD"),
            eq(mappatureProdottiEsterniTable.attiva, true),
            inArray(
              mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
              descriptionKeys,
            ),
          ),
        )
    : [];
  const mappingByKey = new Map(
    mappings.map((item) => [item.mapping.chiaveDescrizioneNormalizzata, item]),
  );
  const rowMappingUpdates = rows.map((row) => {
    const found = mappingByKey.get(row.prodottoNormalizzato);
    return {
      row,
      mappingId: found?.mapping.id ?? null,
      mappingVersion: found?.mapping.versione ?? null,
      productId: found?.prodotto.id ?? null,
      productName: found?.prodotto.nome ?? null,
      unit: found?.prodotto.unitaMisura ?? null,
      state: mutableRowState(row, Boolean(found)),
    };
  });
  for (let offset = 0; offset < rowMappingUpdates.length; offset += 500) {
    const chunk = rowMappingUpdates.slice(offset, offset + 500);
    const values = sql.join(
      chunk.map(
        (item) =>
          sql`(${item.row.id}::integer, ${item.mappingId}::integer, ${item.mappingVersion}::integer, ${item.productId}::integer, ${item.productName}::text, ${item.unit}::varchar, ${item.state}::varchar)`,
      ),
      sql`, `,
    );
    await tx.execute(sql`
      UPDATE importazioni_agea_righe AS r
      SET mapping_prodotto_id = v.mapping_id,
          mapping_versione_snapshot = v.mapping_version,
          prodotto_id_snapshot = v.product_id,
          descrizione_prodotto_snapshot = v.product_name,
          unita_misura_snapshot = v.unit,
          stato_riga = v.state
      FROM (VALUES ${values}) AS v(id, mapping_id, mapping_version, product_id, product_name, unit, state)
      WHERE r.id = v.id
    `);
  }
  for (const update of rowMappingUpdates) {
    update.row.mappingProdottoId = update.mappingId;
    update.row.mappingVersioneSnapshot = update.mappingVersion;
    update.row.prodottoIdSnapshot = update.productId;
    update.row.descrizioneProdottoSnapshot = update.productName;
    update.row.unitaMisuraSnapshot = update.unit;
    update.row.statoRiga = update.state;
  }

  const previousParties = await tx
    .select()
    .from(importazioniAgeaPartiteTable)
    .where(eq(importazioniAgeaPartiteTable.importazioneId, importId));
  const previousByKey = new Map(
    previousParties.map((party) => [party.partyKey, party]),
  );
  await tx
    .delete(importazioniAgeaPartiteTable)
    .where(eq(importazioniAgeaPartiteTable.importazioneId, importId));
  const productIds = [
    ...new Set(
      rows
        .map((row) => row.prodottoIdSnapshot)
        .filter((id): id is number => id != null),
    ),
  ];
  const products = productIds.length
    ? await tx
        .select()
        .from(prodottiTable)
        .where(inArray(prodottiTable.id, productIds))
    : [];
  const productsById = new Map(
    products.map((product) => [product.id, product]),
  );
  const candidateLots = productIds.length
    ? await tx
        .select()
        .from(lottiTable)
        .where(
          and(
            eq(lottiTable.magazzinoId, importRow.magazzinoId),
            inArray(lottiTable.prodottoId, productIds),
          ),
        )
    : [];
  const lotsByKey = new Map<string, typeof candidateLots>();
  for (const lot of candidateLots) {
    const key = [
      lot.prodottoId,
      lot.fondoOrigine,
      lot.codiceLottoNormalizzato ?? "∅",
    ].join("|");
    lotsByKey.set(key, [...(lotsByKey.get(key) ?? []), lot]);
  }
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = partyKeyForRow(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let positiveParties = 0;
  let blockingParties = 0;
  const partyValues: Array<typeof importazioniAgeaPartiteTable.$inferInsert> =
    [];
  for (const [key, group] of groups) {
    const first = group[0];
    const descriptions = [
      ...new Set(group.map((row) => row.prodottoNormalizzato)),
    ].sort();
    const overlappingPrevious = previousParties.filter(
      (party) =>
        party.fondoOrigine === first.fondoNormalizzato &&
        party.descrizioniEsterneJson.some((description) =>
          descriptions.includes(description),
        ),
    );
    const sameLotPrevious = overlappingPrevious.filter(
      (party) => party.lottoNormalizzato === effectiveLot(first).normalized,
    );
    const exactPrevious = previousByKey.get(key);
    const correctionCandidates =
      sameLotPrevious.length > 0
        ? sameLotPrevious
        : exactPrevious
          ? [exactPrevious]
          : overlappingPrevious.length === 1
            ? overlappingPrevious
            : [];
    const previous = [...correctionCandidates].sort(
      (left, right) => left.id - right.id,
    )[0];
    const manualExpiryValues = new Set(
      correctionCandidates
        .filter(
          (party) =>
            party.dataScadenzaFonte === "INSERIMENTO_MANUALE" &&
            party.dataScadenzaRisolta != null,
        )
        .map((party) => party.dataScadenzaRisolta!),
    );
    const piecesSet = new Set(group.map((row) => row.saldoFinalePezzi ?? null));
    const kgSet = new Set(group.map((row) => row.saldoFinaleKgLt ?? null));
    const errors: string[] = [];
    const warnings: string[] = [];
    if (manualExpiryValues.size > 1)
      errors.push("CORREZIONI_PARTITA_CONFLITTO");
    if (piecesSet.size > 1 || kgSet.size > 1)
      errors.push("SALDO_FINALE_INCOERENTE");
    if (!first.fondoNormalizzato) errors.push("FONDO_NON_RICONOSCIUTO");
    if (!first.prodottoIdSnapshot || !first.unitaMisuraSnapshot)
      errors.push("MAPPING_PRODOTTO_MANCANTE");
    const pieces = first.saldoFinalePezzi;
    const kgLt = first.saldoFinaleKgLt;
    const piecesSign = sign(pieces);
    const kgLtSign = sign(kgLt);
    if (piecesSign < 0 || kgLtSign < 0) errors.push("SALDO_FINALE_NEGATIVO");
    if ((piecesSign < 0 && kgLtSign > 0) || (piecesSign > 0 && kgLtSign < 0))
      errors.push("SALDO_FINALE_SEGNO_INCOERENTE");
    const hasPositiveBalance = positive(pieces) || positive(kgLt);
    if (hasPositiveBalance) positiveParties += 1;
    let existingLotto: typeof lottiTable.$inferSelect | undefined;
    if (
      first.prodottoIdSnapshot &&
      first.fondoNormalizzato &&
      effectiveLot(first).normalized
    ) {
      const matches =
        lotsByKey.get(
          [
            first.prodottoIdSnapshot,
            first.fondoNormalizzato,
            effectiveLot(first).normalized,
          ].join("|"),
        ) ?? [];
      if (matches.length > 1) errors.push("PARTITA_LOCALE_AMBIGUA");
      existingLotto = matches[0];
      if (
        importRow.modalita === "PRIMA_ACQUISIZIONE" &&
        hasPositiveBalance &&
        existingLotto
      )
        errors.push("PARTITA_LOCALE_POTENZIALMENTE_DUPLICATA");
    }
    const quantity = first.unitaMisuraSnapshot
      ? operationalQuantity(first.unitaMisuraSnapshot, pieces, kgLt)
      : null;
    if (
      hasPositiveBalance &&
      first.unitaMisuraSnapshot &&
      (!quantity || !positive(quantity))
    )
      errors.push("UNITA_PRODOTTO_INCOMPATIBILE");
    if (hasPositiveBalance && !ratioHalfUp(kgLt, pieces))
      warnings.push("FATTORE_MANCANTE");
    if (hasPositiveBalance && first.prodottoIdSnapshot) {
      const product = productsById.get(first.prodottoIdSnapshot);
      if (product?.gestioneLotto && !effectiveLot(first).normalized)
        errors.push("LOTTO_DA_COMPLETARE");
      if (
        product?.gestioneScadenza &&
        !existingLotto?.dataScadenza &&
        !previous?.dataScadenzaRisolta
      )
        errors.push("SCADENZA_DA_COMPLETARE");
    }
    const blocking = errors.length > 0 || group.some((row) => row.blocking);
    if (blocking) blockingParties += 1;
    partyValues.push({
      importazioneId: importId,
      partyKey: key,
      fondoOrigine: first.fondoNormalizzato ?? "NON_RICONOSCIUTO",
      prodottoId: first.prodottoIdSnapshot,
      prodottoNormalizzato:
        first.descrizioneProdottoSnapshot ?? first.prodottoNormalizzato,
      descrizioniEsterneJson: descriptions,
      lottoRaw: effectiveLot(first).raw,
      lottoNormalizzato: effectiveLot(first).normalized,
      existingLottoId: existingLotto?.id,
      saldoFinalePezzi: pieces,
      saldoFinaleKgLt: kgLt,
      quantitaOperativa: quantity,
      unitaMisuraOperativa: first.unitaMisuraSnapshot,
      fattoreKgLtPezzo:
        existingLotto?.fattoreKgLtPezzo ?? ratioHalfUp(kgLt, pieces),
      dataScadenzaRisolta:
        existingLotto?.dataScadenza ?? previous?.dataScadenzaRisolta,
      dataScadenzaFonte: existingLotto?.dataScadenza
        ? "PARTITA_ESISTENTE"
        : previous?.dataScadenzaFonte,
      correzioneMotivazione: previous?.correzioneMotivazione,
      correttoDa: previous?.correttoDa,
      dataCorrezione: previous?.dataCorrezione,
      stato: blocking
        ? "BLOCCATA"
        : hasPositiveBalance
          ? "PRONTA"
          : "SALDO_ZERO",
      blocking,
      errorCodesJson: [...new Set(errors)],
      warningCodesJson: [...new Set(warnings)],
    });
  }
  for (let offset = 0; offset < partyValues.length; offset += 500)
    await tx
      .insert(importazioniAgeaPartiteTable)
      .values(partyValues.slice(offset, offset + 500));
  const unmapped = new Set(
    rows
      .filter((row) => row.prodottoIdSnapshot == null)
      .map((row) => row.prodottoNormalizzato),
  ).size;
  const rowBlocking = rows.filter((row) => row.blocking).length;
  const blocking = rowBlocking + blockingParties;
  const nextState =
    unmapped > 0 ? "DA_MAPPARE" : blocking > 0 ? "BLOCCATA" : "PRONTA";
  await tx
    .update(importazioniAgeaTable)
    .set({
      stato: nextState,
      versione: importRow.versione + 1,
      righeBloccanti: blocking,
      partiteTotali: groups.size,
      partiteSaldoPositivo: positiveParties,
    })
    .where(eq(importazioniAgeaTable.id, importId));
  return {
    stato: nextState,
    unmapped,
    blocking,
    partiteTotali: groups.size,
    partiteSaldoPositivo: positiveParties,
  };
}

export async function analyzeAgeaImport(
  tx: InventoryTransaction,
  input: {
    buffer: Buffer;
    magazzinoId: number;
    modalita: AgeaImportMode;
    nomeFile: string;
    creatoDa: number;
  },
) {
  const parsed = parseAgeaWorkbook(input.buffer);
  await classifyAgainstLedger(tx, input.magazzinoId, parsed.rows);
  const mappings = await mappingsForRows(tx, parsed.rows);
  const [created] = await tx
    .insert(importazioniAgeaTable)
    .values({
      magazzinoId: input.magazzinoId,
      nomeFile: input.nomeFile,
      mimeType: AGEA_XLSX_MIME,
      dimensioneBytes: input.buffer.length,
      sha256File: parsed.sha256File,
      tracciatoCodice: AGEA_TRACE_CODE,
      parserVersion: AGEA_PARSER_VERSION,
      sheetName: parsed.sheetName,
      dataRiferimento: parsed.dataRiferimento,
      modalita: input.modalita,
      stato: "ANALIZZATA",
      righeTotali: parsed.counts.total,
      righeCarico: parsed.counts.carichi,
      righeDistribuzione: parsed.counts.distribuzioni,
      righeReso: parsed.counts.resi,
      righeNonClassificate: parsed.counts.nonClassificate,
      righeNuove: parsed.rows.filter(
        (row) =>
          ![
            "DUPLICATA",
            "MODIFICATO_NEL_REGISTRO",
            "IDENTITA_AMBIGUA",
          ].includes(row.statoRiga),
      ).length,
      righeDuplicate: parsed.rows.filter((row) => row.statoRiga === "DUPLICATA")
        .length,
      righeModificate: parsed.rows.filter(
        (row) => row.statoRiga === "MODIFICATO_NEL_REGISTRO",
      ).length,
      righeAmbigue: parsed.rows.filter(
        (row) => row.statoRiga === "IDENTITA_AMBIGUA",
      ).length,
      righeBloccanti: parsed.counts.bloccanti,
      creatoDa: input.creatoDa,
      noteAudit: { warnings: parsed.warnings, binaryStored: false },
    })
    .returning();
  const stagingRows = parsed.rows.map((row) => {
    const found = mappings.get(row.prodottoNormalizzato);
    return {
      importazioneId: created.id,
      numeroRiga: row.numeroRiga,
      rawJson: row.rawJson,
      fondoRaw: row.fondoRaw,
      fondoNormalizzato: row.fondoNormalizzato,
      prodottoRaw: row.prodottoRaw,
      prodottoNormalizzato: row.prodottoNormalizzato,
      lottoRaw: row.lottoRaw,
      lottoNormalizzato: row.lottoNormalizzato,
      lottoEffettivoRaw: row.lottoRaw,
      lottoEffettivoNormalizzato: row.lottoNormalizzato,
      numeroDocumentoRaw: row.numeroDocumentoRaw,
      numeroDocumentoNormalizzato: row.numeroDocumentoNormalizzato,
      dataDocumentoRaw: row.dataDocumentoRaw,
      dataDocumento: row.dataDocumento,
      dataCaricoMagazzinoRaw: row.dataCaricoMagazzinoRaw,
      dataCaricoRisolta: row.dataCaricoRisolta,
      dataCaricoFonte: row.dataCaricoFonte,
      dataCaricoEffettiva: row.dataCaricoRisolta,
      mittenteDestinatarioRaw: row.mittenteDestinatarioRaw,
      movimentoKgLtRaw: row.movimentoKgLtRaw,
      movimentoKgLt: row.movimentoKgLt,
      movimentoPezziRaw: row.movimentoPezziRaw,
      movimentoPezzi: row.movimentoPezzi,
      saldoMovimentoKgLtRaw: row.saldoMovimentoKgLtRaw,
      saldoMovimentoKgLt: row.saldoMovimentoKgLt,
      saldoMovimentoPezziRaw: row.saldoMovimentoPezziRaw,
      saldoMovimentoPezzi: row.saldoMovimentoPezzi,
      saldoFinaleKgLtRaw: row.saldoFinaleKgLtRaw,
      saldoFinaleKgLt: row.saldoFinaleKgLt,
      saldoFinalePezziRaw: row.saldoFinalePezziRaw,
      saldoFinalePezzi: row.saldoFinalePezzi,
      noteRaw: row.noteRaw,
      attivitaRaw: row.attivitaRaw,
      attivitaNormalizzata: row.attivitaNormalizzata,
      pacchiRaw: row.pacchiRaw,
      pastiRaw: row.pastiRaw,
      saltuariRaw: row.saltuariRaw,
      continuativiRaw: row.continuativiRaw,
      tipoMovimentoEsterno: row.tipoMovimentoEsterno,
      identityBaseHash: row.identityBaseHash,
      identityOccurrence: row.identityOccurrence,
      identityKey: row.identityKey,
      contentHash: row.contentHash,
      mappingProdottoId: found?.mapping.id,
      mappingVersioneSnapshot: found?.mapping.versione,
      prodottoIdSnapshot: found?.prodotto.id,
      descrizioneProdottoSnapshot: found?.prodotto.nome,
      unitaMisuraSnapshot: found?.prodotto.unitaMisura,
      statoRiga: found
        ? row.statoRiga
        : row.blocking
          ? "BLOCCATA"
          : "DA_MAPPARE",
      blocking: row.blocking,
      errorCodesJson: row.errorCodes,
      warningCodesJson: row.warningCodes,
    };
  });
  for (let offset = 0; offset < stagingRows.length; offset += 500)
    await tx
      .insert(importazioniAgeaRigheTable)
      .values(stagingRows.slice(offset, offset + 500));
  await rebuildImport(tx, created.id);
  const [result] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, created.id));
  await tx.insert(systemLogsTable).values({
    evento: "MAGAZZINO_AGEA_UPLOAD_ANALIZZATO",
    esito: result.stato === "BLOCCATA" ? "FAILURE" : "SUCCESS",
    actorUserId: input.creatoDa,
    details: {
      importazioneId: result.id,
      magazzinoId: result.magazzinoId,
      modalita: result.modalita,
      sha256File: result.sha256File,
      tracciatoCodice: result.tracciatoCodice,
      righeTotali: result.righeTotali,
      righeBloccanti: result.righeBloccanti,
    },
  });
  return result;
}

export async function recalculateAgeaImport(
  tx: InventoryTransaction,
  importId: number,
  expectedVersion: number,
) {
  await rebuildImport(tx, importId, expectedVersion);
  const [result] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId));
  return result;
}

function requireMutableImport(
  row: typeof importazioniAgeaTable.$inferSelect | undefined,
  expectedVersion: number,
) {
  if (!row)
    throw new AgeaImportError(
      404,
      "IMPORTAZIONE_NON_TROVATA",
      "Importazione non trovata",
    );
  if (["CONFERMATA", "ANNULLATA"].includes(row.stato))
    throw new AgeaImportError(
      409,
      "IMPORTAZIONE_IMMUTABILE",
      "L'importazione non è più modificabile",
    );
  if (row.versione !== expectedVersion)
    throw new AgeaImportError(
      409,
      "VERSIONE_NON_CORRENTE",
      "La preview è stata aggiornata: ricaricare i dati",
    );
}

export async function correctAgeaImportRow(
  tx: InventoryTransaction,
  input: {
    importId: number;
    rowId: number;
    expectedVersion: number;
    userId: number;
    motivation: string;
    field: "DATA_CARICO" | "LOTTO";
    value: string | null;
  },
) {
  const [importRow] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, input.importId))
    .for("update");
  requireMutableImport(importRow, input.expectedVersion);
  if (
    input.field === "LOTTO" &&
    input.value != null &&
    (normalizeAgeaText(input.value)?.length ?? 0) > AGEA_MAX_LOT_LENGTH
  )
    throw new AgeaImportError(
      400,
      LOTTO_NON_VALIDO,
      `Il lotto non può superare ${AGEA_MAX_LOT_LENGTH} caratteri`,
    );
  const [row] = await tx
    .select()
    .from(importazioniAgeaRigheTable)
    .where(
      and(
        eq(importazioniAgeaRigheTable.id, input.rowId),
        eq(importazioniAgeaRigheTable.importazioneId, input.importId),
      ),
    )
    .for("update");
  if (!row)
    throw new AgeaImportError(404, "RIGA_NON_TROVATA", "Riga non trovata");
  const previous =
    input.field === "DATA_CARICO"
      ? (row.dataCaricoEffettiva ?? row.dataCaricoRisolta)
      : (row.lottoEffettivoRaw ?? row.lottoRaw);
  const correctedErrorCodes =
    input.field === "DATA_CARICO"
      ? ["DATA_CARICO_DA_COMPLETARE"]
      : ["LOTTO_DA_COMPLETARE", LOTTO_NON_VALIDO];
  const remainingErrors = row.errorCodesJson.filter(
    (code) => !correctedErrorCodes.includes(code),
  );
  if (
    input.field === "DATA_CARICO" &&
    input.value == null &&
    row.dataCaricoRisolta == null &&
    row.tipoMovimentoEsterno === "CARICO"
  )
    remainingErrors.push("DATA_CARICO_DA_COMPLETARE");
  if (
    input.field === "LOTTO" &&
    input.value == null &&
    row.lottoNormalizzato == null
  )
    remainingErrors.push("LOTTO_DA_COMPLETARE");
  const effectiveLotAfterCorrection =
    input.field === "LOTTO"
      ? (input.value ?? row.lottoRaw)
      : effectiveLot(row).raw;
  if (
    (normalizeAgeaText(effectiveLotAfterCorrection)?.length ?? 0) >
    AGEA_MAX_LOT_LENGTH
  )
    remainingErrors.push(LOTTO_NON_VALIDO);
  await tx
    .update(importazioniAgeaRigheTable)
    .set(
      input.field === "DATA_CARICO"
        ? {
            dataCaricoEffettiva: input.value ?? row.dataCaricoRisolta,
            correzioneMotivazione: input.motivation,
            correttoDa: input.userId,
            dataCorrezione: new Date(),
            errorCodesJson: [...new Set(remainingErrors)],
            blocking: remainingErrors.length > 0,
          }
        : {
            lottoEffettivoRaw: input.value ?? row.lottoRaw,
            lottoEffettivoNormalizzato:
              normalizeAgeaKey(input.value) ?? row.lottoNormalizzato,
            correzioneMotivazione: input.motivation,
            correttoDa: input.userId,
            dataCorrezione: new Date(),
            errorCodesJson: [...new Set(remainingErrors)],
            blocking: remainingErrors.length > 0,
          },
    )
    .where(eq(importazioniAgeaRigheTable.id, row.id));
  await tx.insert(systemLogsTable).values({
    evento: `MAGAZZINO_AGEA_CORREZIONE_${input.field}`,
    esito: "SUCCESS",
    actorUserId: input.userId,
    details: {
      importazioneId: input.importId,
      rigaId: input.rowId,
      campo: input.field,
      valorePrecedente: previous,
      valoreNuovo: input.value,
      rimozione: input.value == null,
      motivazione: input.motivation,
      versionePrecedente: input.expectedVersion,
      versioneNuova: input.expectedVersion + 1,
    },
  });
  await rebuildImport(tx, input.importId, input.expectedVersion);
  const [result] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, input.importId));
  return result;
}

export async function correctAgeaImportExpiry(
  tx: InventoryTransaction,
  input: {
    importId: number;
    partyId: number;
    expectedVersion: number;
    userId: number;
    motivation: string;
    value: string | null;
  },
) {
  const [importRow] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, input.importId))
    .for("update");
  requireMutableImport(importRow, input.expectedVersion);
  const [party] = await tx
    .select()
    .from(importazioniAgeaPartiteTable)
    .where(
      and(
        eq(importazioniAgeaPartiteTable.id, input.partyId),
        eq(importazioniAgeaPartiteTable.importazioneId, input.importId),
      ),
    )
    .for("update");
  if (!party)
    throw new AgeaImportError(
      404,
      "PARTITA_NON_TROVATA",
      "Partita preview non trovata",
    );
  if (party.existingLottoId && party.dataScadenzaRisolta !== input.value)
    throw new AgeaImportError(
      409,
      "SCADENZA_PARTITA_ESISTENTE_NON_MODIFICABILE",
      "La scadenza è determinata dalla partita locale esistente",
    );
  await tx
    .update(importazioniAgeaPartiteTable)
    .set({
      dataScadenzaRisolta: input.value,
      dataScadenzaFonte: input.value ? "INSERIMENTO_MANUALE" : null,
      correzioneMotivazione: input.motivation,
      correttoDa: input.userId,
      dataCorrezione: new Date(),
      dataAggiornamento: new Date(),
    })
    .where(eq(importazioniAgeaPartiteTable.id, party.id));
  await tx.insert(systemLogsTable).values({
    evento: "MAGAZZINO_AGEA_CORREZIONE_SCADENZA",
    esito: "SUCCESS",
    actorUserId: input.userId,
    details: {
      importazioneId: input.importId,
      partitaId: input.partyId,
      valorePrecedente: party.dataScadenzaRisolta,
      valoreNuovo: input.value,
      rimozione: input.value == null,
      motivazione: input.motivation,
      versionePrecedente: input.expectedVersion,
      versioneNuova: input.expectedVersion + 1,
    },
  });
  await rebuildImport(tx, input.importId, input.expectedVersion);
  const [result] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, input.importId));
  return result;
}

async function registerCanonicalRows(
  tx: InventoryTransaction,
  importRow: typeof importazioniAgeaTable.$inferSelect,
  rows: Array<typeof importazioniAgeaRigheTable.$inferSelect>,
) {
  const result = new Map<
    number,
    typeof movimentiEsterniAgeaTable.$inferSelect
  >();
  const knownRows: Array<typeof movimentiEsterniAgeaTable.$inferSelect> = [];
  const identityKeys = [...new Set(rows.map((row) => row.identityKey))];
  for (let offset = 0; offset < identityKeys.length; offset += 1_000) {
    const chunk = identityKeys.slice(offset, offset + 1_000);
    knownRows.push(
      ...(await tx
        .select()
        .from(movimentiEsterniAgeaTable)
        .where(
          and(
            eq(movimentiEsterniAgeaTable.magazzinoId, importRow.magazzinoId),
            inArray(movimentiEsterniAgeaTable.identityKey, chunk),
          ),
        )
        .for("update")),
    );
  }
  const knownByIdentity = new Map(
    knownRows.map((movement) => [movement.identityKey, movement]),
  );
  for (const row of rows) {
    const known = knownByIdentity.get(row.identityKey);
    if (known && known.acceptedContentHash !== row.contentHash)
      throw new AgeaImportError(
        409,
        "MODIFICATO_NEL_REGISTRO",
        `La riga ${row.numeroRiga} è cambiata rispetto alla versione già acquisita`,
      );
  }
  for (let offset = 0; offset < knownRows.length; offset += 1_000) {
    const ids = knownRows.slice(offset, offset + 1_000).map((row) => row.id);
    if (!ids.length) continue;
    await tx
      .update(movimentiEsterniAgeaTable)
      .set({ lastSeenImportId: importRow.id, dataUltimoRiscontro: new Date() })
      .where(inArray(movimentiEsterniAgeaTable.id, ids));
  }
  const newRows = rows.filter((row) => !knownByIdentity.has(row.identityKey));
  const createdRows: Array<typeof movimentiEsterniAgeaTable.$inferSelect> = [];
  for (let offset = 0; offset < newRows.length; offset += 500) {
    const chunk = newRows.slice(offset, offset + 500);
    if (!chunk.length) continue;
    createdRows.push(
      ...(await tx
        .insert(movimentiEsterniAgeaTable)
        .values(
          chunk.map((row) => ({
            magazzinoId: importRow.magazzinoId,
            identityKey: row.identityKey,
            identityBaseHash: row.identityBaseHash,
            identityOccurrence: row.identityOccurrence,
            acceptedContentHash: row.contentHash,
            acceptedImportRowId: row.id,
            tipoMovimentoEsterno: row.tipoMovimentoEsterno,
            prodottoIdSnapshot: row.prodottoIdSnapshot,
            firstSeenImportId: importRow.id,
            lastSeenImportId: importRow.id,
            statoApplicazione:
              row.tipoMovimentoEsterno === "CARICO"
                ? "DA_APPLICARE"
                : "NON_APPLICABILE_RIFERIMENTO",
          })),
        )
        .returning()),
    );
  }
  const allByIdentity = new Map(
    [...knownRows, ...createdRows].map((movement) => [
      movement.identityKey,
      movement,
    ]),
  );
  for (const row of rows) {
    const movement = allByIdentity.get(row.identityKey);
    if (!movement)
      throw new AgeaImportError(
        409,
        "REGISTRO_CANONICO_INCOMPLETO",
        `Registrazione canonica mancante per la riga ${row.numeroRiga}`,
      );
    result.set(row.id, movement);
  }
  return result;
}

async function revalidateBootstrapParties(
  tx: InventoryTransaction,
  magazzinoId: number,
  parties: Array<typeof importazioniAgeaPartiteTable.$inferSelect>,
): Promise<void> {
  const keyed = parties.map((party) => {
    if (
      party.prodottoId == null ||
      !["FSE_PLUS", "FONDO_NAZIONALE", "FONDO_NAZIONALE_COFINANZIATO"].includes(
        party.fondoOrigine,
      )
    )
      throw new AgeaImportError(
        409,
        "PREVIEW_DA_RICALCOLARE",
        "La Partita bootstrap non ha più una business key valida",
      );
    const fondoOrigine = party.fondoOrigine as FondoOrigine;
    return {
      party,
      fondoOrigine,
      key: party.lottoNormalizzato
        ? inventoryPartyBusinessKey({
            magazzinoId,
            prodottoId: party.prodottoId,
            fondoOrigine,
            lottoNormalizzato: party.lottoNormalizzato,
          })
        : null,
    };
  });
  await lockInventoryPartyBusinessKeys(
    tx,
    keyed.map((item) => item.key).filter((key): key is string => key != null),
  );
  for (const { party, fondoOrigine } of keyed) {
    if (!party.lottoNormalizzato) continue;
    const candidates = await findInventoryPartyCandidates(tx, {
      magazzinoId,
      prodottoId: party.prodottoId!,
      fondoOrigine,
      lottoNormalizzato: party.lottoNormalizzato!,
    });
    const expectedId = party.existingLottoId ?? null;
    const candidate = candidates.length === 1 ? candidates[0] : null;
    const realityChanged =
      candidates.length > 1 ||
      (candidate?.id ?? null) !== expectedId ||
      (candidate != null &&
        ((candidate.dataScadenza ?? null) !==
          (party.dataScadenzaRisolta ?? null) ||
          (candidate.fattoreKgLtPezzo ?? null) !==
            (party.fattoreKgLtPezzo ?? null)));
    if (realityChanged)
      throw new AgeaImportError(
        409,
        "PREVIEW_DA_RICALCOLARE",
        "Le Partite locali sono cambiate dopo la preview bootstrap",
      );
  }
}

export async function confirmAgeaImport(
  tx: InventoryTransaction,
  importId: number,
  userId: number,
  expectedVersion: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agea-import:${importId}`}, 0))`,
  );
  const [importRow] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId))
    .for("update");
  if (!importRow)
    throw new AgeaImportError(
      404,
      "IMPORTAZIONE_NON_TROVATA",
      "Importazione non trovata",
    );
  if (importRow.versione !== expectedVersion)
    throw new AgeaImportError(
      409,
      "VERSIONE_NON_CORRENTE",
      "La preview è stata aggiornata: ricaricare prima di confermare",
    );
  if (importRow.stato === "CONFERMATA") {
    await tx.insert(systemLogsTable).values({
      evento: "MAGAZZINO_AGEA_IMPORT_REPLAY",
      esito: "SUCCESS",
      actorUserId: userId,
      details: {
        importazioneId: importId,
        versione: expectedVersion,
        carichiCreati: 0,
      },
    });
    return {
      importazione: importRow,
      replay: true,
      carichi: [] as number[],
    };
  }
  if (["ANNULLATA"].includes(importRow.stato))
    throw new AgeaImportError(
      409,
      "IMPORTAZIONE_IMMUTABILE",
      "L'importazione non è più modificabile",
    );
  if (importRow.stato !== "PRONTA")
    throw new AgeaImportError(
      409,
      "PREFLIGHT_NON_SUPERATO",
      "Mapping, date, lotti o saldi richiedono ancora intervento",
    );
  const fresh = importRow;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agea-warehouse:${fresh.magazzinoId}`}, 0))`,
  );
  const rows = await tx
    .select()
    .from(importazioniAgeaRigheTable)
    .where(eq(importazioniAgeaRigheTable.importazioneId, importId));
  assertConsistentDocumentGroupDates(rows);
  const mappingIds = [
    ...new Set(
      rows
        .map((row) => row.mappingProdottoId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (mappingIds.length) {
    const lockedMappings = await tx
      .select()
      .from(mappatureProdottiEsterniTable)
      .where(inArray(mappatureProdottiEsterniTable.id, mappingIds))
      .for("update");
    const byId = new Map(
      lockedMappings.map((mapping) => [mapping.id, mapping]),
    );
    if (
      rows.some((row) => {
        if (row.mappingProdottoId == null) return false;
        const mapping = byId.get(row.mappingProdottoId);
        return (
          !mapping?.attiva ||
          mapping.prodottoId !== row.prodottoIdSnapshot ||
          mapping.versione !== row.mappingVersioneSnapshot
        );
      })
    )
      throw new AgeaImportError(
        409,
        "MAPPING_MODIFICATO",
        "Una mappatura è cambiata durante la conferma",
      );
  }
  if (fresh.modalita === "PRIMA_ACQUISIZIONE") {
    const previous = await tx
      .select({ id: importazioniAgeaTable.id })
      .from(importazioniAgeaTable)
      .where(
        and(
          eq(importazioniAgeaTable.magazzinoId, fresh.magazzinoId),
          eq(importazioniAgeaTable.modalita, "PRIMA_ACQUISIZIONE"),
          eq(importazioniAgeaTable.stato, "CONFERMATA"),
        ),
      );
    if (previous.length)
      throw new AgeaImportError(
        409,
        "BOOTSTRAP_GIA_CONFERMATO",
        "Esiste già una prima acquisizione AGEA per il magazzino",
      );
    const local = await tx
      .select({ id: carichiMagazzinoTable.id })
      .from(carichiMagazzinoTable)
      .where(
        and(
          eq(carichiMagazzinoTable.magazzinoId, fresh.magazzinoId),
          inArray(carichiMagazzinoTable.origineCarico, [
            "AGEA_SIFEAD",
            "SALDO_INIZIALE",
          ]),
        ),
      );
    if (local.length)
      throw new AgeaImportError(
        409,
        "CARICO_AGEA_ESISTENTE",
        "Esiste già un carico AGEA o saldo iniziale nel magazzino",
      );
  }
  if (fresh.modalita === "AGGIORNAMENTO") {
    const bootstrap = await tx
      .select({ id: importazioniAgeaTable.id })
      .from(importazioniAgeaTable)
      .where(
        and(
          eq(importazioniAgeaTable.magazzinoId, fresh.magazzinoId),
          eq(importazioniAgeaTable.modalita, "PRIMA_ACQUISIZIONE"),
          eq(importazioniAgeaTable.stato, "CONFERMATA"),
        ),
      );
    if (!bootstrap.length)
      throw new AgeaImportError(
        409,
        "BOOTSTRAP_MANCANTE",
        "Confermare prima la prima acquisizione AGEA",
      );
  }
  let bootstrapPositiveParties: Array<
    typeof importazioniAgeaPartiteTable.$inferSelect
  > = [];
  if (fresh.modalita === "PRIMA_ACQUISIZIONE") {
    const parties = await tx
      .select()
      .from(importazioniAgeaPartiteTable)
      .where(
        and(
          eq(importazioniAgeaPartiteTable.importazioneId, importId),
          eq(importazioniAgeaPartiteTable.stato, "PRONTA"),
        ),
      );
    bootstrapPositiveParties = parties.filter((party) =>
      positive(party.quantitaOperativa),
    );
    await revalidateBootstrapParties(
      tx,
      fresh.magazzinoId,
      bootstrapPositiveParties,
    );
  }
  const canonical =
    fresh.modalita === "SOLO_ANALISI"
      ? new Map<number, typeof movimentiEsterniAgeaTable.$inferSelect>()
      : await registerCanonicalRows(tx, fresh, rows);
  const createdLoadIds: number[] = [];
  if (fresh.modalita === "PRIMA_ACQUISIZIONE") {
    const positiveParties = bootstrapPositiveParties;
    const balanceHash = createHash("sha256")
      .update(
        JSON.stringify(
          positiveParties
            .map((party) => [
              party.partyKey,
              party.quantitaOperativa,
              party.saldoFinalePezzi,
              party.saldoFinaleKgLt,
            ])
            .sort(),
        ),
      )
      .digest("hex");
    const result = await createWarehouseLoad(tx, {
      magazzinoId: fresh.magazzinoId,
      origineCarico: "SALDO_INIZIALE",
      numeroDocumento: `AGEA-SALDO-${fresh.dataRiferimento}`,
      dataDocumento: fresh.dataRiferimento,
      dataCarico: fresh.dataRiferimento,
      descrizione: `Saldo iniziale AGEA/SIFEAD al ${fresh.dataRiferimento.split("-").reverse().join("/")}`,
      note: `Importazione AGEA #${fresh.id}; storico assorbito senza ricostruire gli scarichi`,
      idempotencyKey: `agea-bootstrap:${fresh.magazzinoId}:${fresh.dataRiferimento}:${balanceHash.slice(0, 48)}`,
      executionContext: "system",
      creatoDa: userId,
      righe: positiveParties.map((party) => ({
        prodottoId: party.prodottoId!,
        fondoOrigine: party.fondoOrigine as
          | "FSE_PLUS"
          | "FONDO_NAZIONALE"
          | "FONDO_NAZIONALE_COFINANZIATO",
        quantitaOperativa: party.quantitaOperativa!,
        unitaMisuraOperativa: party.unitaMisuraOperativa,
        quantitaPezzi: positive(party.saldoFinalePezzi)
          ? party.saldoFinalePezzi
          : null,
        quantitaKgLt: positive(party.saldoFinaleKgLt)
          ? party.saldoFinaleKgLt
          : null,
        fattoreKgLtPezzo: party.fattoreKgLtPezzo,
        codiceLotto: party.lottoRaw,
        dataScadenza: party.dataScadenzaRisolta,
        descrizioneEsterna: party.prodottoNormalizzato,
        riferimentoEsterno: `AGEA:${fresh.id}:${party.partyKey}`.slice(0, 160),
      })),
    });
    createdLoadIds.push(result.carico.id);
    for (let index = 0; index < positiveParties.length; index += 1) {
      const party = positiveParties[index];
      const loadLineId = result.righe[index].riga.id;
      for (const row of rows.filter(
        (item) =>
          partyKeyForRow(item) === party.partyKey &&
          item.tipoMovimentoEsterno === "CARICO",
      )) {
        const movement = canonical.get(row.id)!;
        await tx
          .update(movimentiEsterniAgeaTable)
          .set({
            statoApplicazione: "ASSORBITO_SALDO_INIZIALE",
            assorbitoDaBootstrapRigaId: loadLineId,
          })
          .where(eq(movimentiEsterniAgeaTable.id, movement.id));
        await tx
          .update(importazioniAgeaRigheTable)
          .set({
            movimentoEsternoId: movement.id,
            caricoMagazzinoRigaId: loadLineId,
            statoRiga: "ASSORBITO_SALDO_INIZIALE",
          })
          .where(eq(importazioniAgeaRigheTable.id, row.id));
      }
    }
    for (const row of rows.filter(
      (item) => item.tipoMovimentoEsterno !== "CARICO",
    )) {
      await tx
        .update(importazioniAgeaRigheTable)
        .set({ movimentoEsternoId: canonical.get(row.id)!.id })
        .where(eq(importazioniAgeaRigheTable.id, row.id));
    }
    for (const row of rows.filter(
      (item) =>
        item.tipoMovimentoEsterno === "CARICO" &&
        item.caricoMagazzinoRigaId == null,
    )) {
      const movement = canonical.get(row.id)!;
      await tx
        .update(movimentiEsterniAgeaTable)
        .set({ statoApplicazione: "ASSORBITO_SALDO_INIZIALE" })
        .where(eq(movimentiEsterniAgeaTable.id, movement.id));
      await tx
        .update(importazioniAgeaRigheTable)
        .set({
          movimentoEsternoId: movement.id,
          statoRiga: "ASSORBITO_SALDO_INIZIALE",
        })
        .where(eq(importazioniAgeaRigheTable.id, row.id));
    }
    await tx
      .update(importazioniAgeaTable)
      .set({ bootstrapCaricoId: result.carico.id })
      .where(eq(importazioniAgeaTable.id, importId));
  } else if (fresh.modalita === "AGGIORNAMENTO") {
    const newPositive = rows.filter(
      (row) =>
        row.tipoMovimentoEsterno === "CARICO" &&
        row.statoRiga !== "DUPLICATA" &&
        canonical.get(row.id)?.statoApplicazione === "DA_APPLICARE",
    );
    const groups = new Map<string, typeof newPositive>();
    for (const row of newPositive) {
      const key = [
        row.numeroDocumentoNormalizzato ?? "∅",
        row.dataDocumento ?? "∅",
        normalizeAgeaKey(row.mittenteDestinatarioRaw) ?? "∅",
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    const previewParties = await tx
      .select()
      .from(importazioniAgeaPartiteTable)
      .where(eq(importazioniAgeaPartiteTable.importazioneId, importId));
    const partyByKey = new Map(
      previewParties.map((party) => [party.partyKey, party]),
    );
    for (const group of groups.values()) {
      const first = group[0];
      const effectiveLoadDate =
        first.dataCaricoEffettiva ?? first.dataCaricoRisolta;
      if (!effectiveLoadDate)
        throw new AgeaImportError(
          409,
          "DATA_CARICO_DA_COMPLETARE",
          "Data carico mancante",
        );
      const idempotencyHash = createHash("sha256")
        .update(
          JSON.stringify({
            fonte: "AGEA_SIFEAD",
            magazzinoId: fresh.magazzinoId,
            documento: first.numeroDocumentoNormalizzato,
            dataDocumento: first.dataDocumento,
            dataCarico: effectiveLoadDate,
            mittenteDestinatario: normalizeAgeaKey(
              first.mittenteDestinatarioRaw,
            ),
            righe: group
              .map((row) => [row.identityKey, row.contentHash])
              .sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right)),
              ),
          }),
        )
        .digest("hex");
      const result = await createWarehouseLoad(tx, {
        magazzinoId: fresh.magazzinoId,
        origineCarico: "AGEA_SIFEAD",
        numeroDocumento:
          normalizeAgeaKey(first.numeroDocumentoRaw)?.slice(0, 100) ?? null,
        dataDocumento: first.dataDocumento,
        dataCarico: effectiveLoadDate,
        descrizione: `Import incrementale AGEA/SIFEAD #${fresh.id}`,
        note:
          first.dataCaricoFonte === "DATA_DOCUMENTO_FALLBACK"
            ? "Data carico derivata dalla data documento"
            : null,
        idempotencyKey: `agea-inc:${fresh.magazzinoId}:${idempotencyHash}`,
        executionContext: "system",
        creatoDa: userId,
        righe: group.map((row) => {
          const party = partyByKey.get(partyKeyForRow(row));
          if (!party)
            throw new AgeaImportError(
              409,
              "PARTITA_PREVIEW_NON_TROVATA",
              `Partita preview mancante in riga ${row.numeroRiga}`,
            );
          const quantity = operationalQuantity(
            row.unitaMisuraSnapshot!,
            absolute(row.movimentoPezzi),
            absolute(row.movimentoKgLt),
          );
          if (!quantity)
            throw new AgeaImportError(
              409,
              "UNITA_PRODOTTO_INCOMPATIBILE",
              `Quantità incompatibile in riga ${row.numeroRiga}`,
            );
          return {
            prodottoId: row.prodottoIdSnapshot!,
            fondoOrigine: row.fondoNormalizzato as
              | "FSE_PLUS"
              | "FONDO_NAZIONALE"
              | "FONDO_NAZIONALE_COFINANZIATO",
            quantitaOperativa: quantity,
            unitaMisuraOperativa: row.unitaMisuraSnapshot,
            quantitaPezzi: absolute(row.movimentoPezzi),
            quantitaKgLt: absolute(row.movimentoKgLt),
            fattoreKgLtPezzo:
              party.fattoreKgLtPezzo ??
              ratioHalfUp(row.movimentoKgLt, row.movimentoPezzi),
            codiceLotto: effectiveLot(row).raw,
            dataScadenza: party.dataScadenzaRisolta,
            descrizioneEsterna: row.prodottoRaw,
            riferimentoEsterno: `AGEA:${fresh.magazzinoId}:${row.identityKey}`,
          };
        }),
      });
      createdLoadIds.push(result.carico.id);
      for (let index = 0; index < group.length; index += 1) {
        const row = group[index];
        const movement = canonical.get(row.id)!;
        await tx
          .update(movimentiEsterniAgeaTable)
          .set({
            statoApplicazione: "APPLICATO_INCREMENTALE",
            caricoMagazzinoRigaId: result.righe[index].riga.id,
          })
          .where(eq(movimentiEsterniAgeaTable.id, movement.id));
        await tx
          .update(importazioniAgeaRigheTable)
          .set({
            movimentoEsternoId: movement.id,
            caricoMagazzinoRigaId: result.righe[index].riga.id,
            statoRiga: "APPLICATO_INCREMENTALE",
          })
          .where(eq(importazioniAgeaRigheTable.id, row.id));
      }
    }
    for (const row of rows.filter(
      (item) =>
        item.tipoMovimentoEsterno !== "CARICO" ||
        item.statoRiga === "DUPLICATA",
    )) {
      await tx
        .update(importazioniAgeaRigheTable)
        .set({ movimentoEsternoId: canonical.get(row.id)!.id })
        .where(eq(importazioniAgeaRigheTable.id, row.id));
    }
  }
  const [confirmed] = await tx
    .update(importazioniAgeaTable)
    .set({
      stato: "CONFERMATA",
      versione: fresh.versione + 1,
      confermatoDa: userId,
      dataConferma: new Date(),
    })
    .where(eq(importazioniAgeaTable.id, importId))
    .returning();
  await tx.insert(systemLogsTable).values({
    evento: "MAGAZZINO_AGEA_IMPORT_CONFERMATA",
    esito: "SUCCESS",
    actorUserId: userId,
    details: {
      importazioneId: importId,
      magazzinoId: fresh.magazzinoId,
      modalita: fresh.modalita,
      carichi: createdLoadIds,
    },
  });
  return { importazione: confirmed, replay: false, carichi: createdLoadIds };
}

export function asAgeaImportError(
  error: unknown,
): AgeaImportError | InventoryLedgerError | null {
  return error instanceof AgeaImportError ||
    error instanceof InventoryLedgerError
    ? error
    : null;
}
