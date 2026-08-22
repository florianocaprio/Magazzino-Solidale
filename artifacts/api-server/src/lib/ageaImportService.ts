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
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { InventoryDecimal } from "./inventoryDecimal";
import { createWarehouseLoad, InventoryLedgerError } from "./inventoryLedger";
import type { InventoryTransaction } from "./scaricoInventory";
import {
  AGEA_PARSER_VERSION,
  AGEA_TRACE_CODE,
  AGEA_XLSX_MIME,
  normalizeAgeaKey,
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

async function rebuildImport(tx: InventoryTransaction, importId: number) {
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
  const rows = await tx
    .select()
    .from(importazioniAgeaRigheTable)
    .where(eq(importazioniAgeaRigheTable.importazioneId, importId));
  const missingKeys = [
    ...new Set(
      rows
        .filter((row) => row.prodottoIdSnapshot == null)
        .map((row) => row.prodottoNormalizzato),
    ),
  ];
  const mappings = missingKeys.length
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
              missingKeys,
            ),
          ),
        )
    : [];
  const mappingByKey = new Map(
    mappings.map((item) => [item.mapping.chiaveDescrizioneNormalizzata, item]),
  );
  for (const row of rows) {
    if (row.prodottoIdSnapshot != null) continue;
    const found = mappingByKey.get(row.prodottoNormalizzato);
    if (!found) continue;
    await tx
      .update(importazioniAgeaRigheTable)
      .set({
        mappingProdottoId: found.mapping.id,
        prodottoIdSnapshot: found.prodotto.id,
        descrizioneProdottoSnapshot: found.prodotto.nome,
        unitaMisuraSnapshot: found.prodotto.unitaMisura,
        statoRiga: row.blocking
          ? "BLOCCATA"
          : row.statoRiga === "DA_MAPPARE"
            ? row.tipoMovimentoEsterno === "CARICO"
              ? "DA_APPLICARE"
              : "SCARICO_RIFERIMENTO"
            : row.statoRiga,
      })
      .where(eq(importazioniAgeaRigheTable.id, row.id));
    row.mappingProdottoId = found.mapping.id;
    row.prodottoIdSnapshot = found.prodotto.id;
    row.descrizioneProdottoSnapshot = found.prodotto.nome;
    row.unitaMisuraSnapshot = found.prodotto.unitaMisura;
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
    const key = [
      row.fondoNormalizzato ?? "?",
      row.prodottoNormalizzato,
      row.lottoNormalizzato ?? "∅",
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  let positiveParties = 0;
  let blockingParties = 0;
  for (const [key, group] of groups) {
    const first = group[0];
    const previous = previousByKey.get(key);
    const piecesSet = new Set(group.map((row) => row.saldoFinalePezzi ?? null));
    const kgSet = new Set(group.map((row) => row.saldoFinaleKgLt ?? null));
    const errors: string[] = [];
    const warnings: string[] = [];
    if (piecesSet.size > 1 || kgSet.size > 1)
      errors.push("SALDO_FINALE_INCOERENTE");
    if (!first.fondoNormalizzato) errors.push("FONDO_NON_RICONOSCIUTO");
    if (!first.prodottoIdSnapshot || !first.unitaMisuraSnapshot)
      errors.push("MAPPING_PRODOTTO_MANCANTE");
    const pieces = first.saldoFinalePezzi;
    const kgLt = first.saldoFinaleKgLt;
    const hasPositiveBalance = positive(pieces) || positive(kgLt);
    if (hasPositiveBalance) positiveParties += 1;
    let existingLotto: typeof lottiTable.$inferSelect | undefined;
    if (
      first.prodottoIdSnapshot &&
      first.fondoNormalizzato &&
      first.lottoNormalizzato
    ) {
      const matches =
        lotsByKey.get(
          [
            first.prodottoIdSnapshot,
            first.fondoNormalizzato,
            first.lottoNormalizzato,
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
    if (hasPositiveBalance && first.unitaMisuraSnapshot && !quantity)
      errors.push("UNITA_PRODOTTO_INCOMPATIBILE");
    if (hasPositiveBalance && !ratioHalfUp(kgLt, pieces))
      warnings.push("FATTORE_MANCANTE");
    if (hasPositiveBalance && first.prodottoIdSnapshot) {
      const product = productsById.get(first.prodottoIdSnapshot);
      if (product?.gestioneLotto && !first.lottoNormalizzato)
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
    await tx.insert(importazioniAgeaPartiteTable).values({
      importazioneId: importId,
      partyKey: key,
      fondoOrigine: first.fondoNormalizzato ?? "NON_RICONOSCIUTO",
      prodottoId: first.prodottoIdSnapshot,
      prodottoNormalizzato: first.prodottoNormalizzato,
      lottoRaw: first.lottoRaw,
      lottoNormalizzato: first.lottoNormalizzato,
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
          !["DUPLICATA", "MODIFICATO_NEL_REGISTRO"].includes(row.statoRiga),
      ).length,
      righeDuplicate: parsed.rows.filter((row) => row.statoRiga === "DUPLICATA")
        .length,
      righeModificate: parsed.rows.filter(
        (row) => row.statoRiga === "MODIFICATO_NEL_REGISTRO",
      ).length,
      righeBloccanti: parsed.counts.bloccanti,
      creatoDa: input.creatoDa,
      noteAudit: { warnings: parsed.warnings, binaryStored: false },
    })
    .returning();
  await tx.insert(importazioniAgeaRigheTable).values(
    parsed.rows.map((row) => {
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
        numeroDocumentoRaw: row.numeroDocumentoRaw,
        numeroDocumentoNormalizzato: row.numeroDocumentoNormalizzato,
        dataDocumentoRaw: row.dataDocumentoRaw,
        dataDocumento: row.dataDocumento,
        dataCaricoMagazzinoRaw: row.dataCaricoMagazzinoRaw,
        dataCaricoRisolta: row.dataCaricoRisolta,
        dataCaricoFonte: row.dataCaricoFonte,
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
    }),
  );
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
) {
  await rebuildImport(tx, importId);
  const [result] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId));
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
  for (const row of rows) {
    const [known] = await tx
      .select()
      .from(movimentiEsterniAgeaTable)
      .where(
        and(
          eq(movimentiEsterniAgeaTable.magazzinoId, importRow.magazzinoId),
          eq(movimentiEsterniAgeaTable.identityKey, row.identityKey),
        ),
      )
      .for("update");
    if (known) {
      if (known.acceptedContentHash !== row.contentHash)
        throw new AgeaImportError(
          409,
          "MODIFICATO_NEL_REGISTRO",
          `La riga ${row.numeroRiga} è cambiata rispetto alla versione già acquisita`,
        );
      const [updated] = await tx
        .update(movimentiEsterniAgeaTable)
        .set({
          lastSeenImportId: importRow.id,
          dataUltimoRiscontro: new Date(),
        })
        .where(eq(movimentiEsterniAgeaTable.id, known.id))
        .returning();
      result.set(row.id, updated);
      continue;
    }
    const [created] = await tx
      .insert(movimentiEsterniAgeaTable)
      .values({
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
      })
      .returning();
    result.set(row.id, created);
  }
  return result;
}

export async function confirmAgeaImport(
  tx: InventoryTransaction,
  importId: number,
  userId: number,
  expectedVersion?: number,
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
  if (importRow.stato === "CONFERMATA")
    return { importazione: importRow, replay: true, carichi: [] as number[] };
  if (expectedVersion != null && importRow.versione !== expectedVersion)
    throw new AgeaImportError(
      409,
      "VERSIONE_NON_CORRENTE",
      "La preview è stata aggiornata: ricaricare prima di confermare",
    );
  await rebuildImport(tx, importId);
  const [fresh] = await tx
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, importId))
    .for("update");
  if (!fresh || fresh.stato !== "PRONTA")
    throw new AgeaImportError(
      409,
      "PREFLIGHT_NON_SUPERATO",
      "Mapping, date, lotti o saldi richiedono ancora intervento",
    );
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agea-warehouse:${fresh.magazzinoId}`}, 0))`,
  );
  const rows = await tx
    .select()
    .from(importazioniAgeaRigheTable)
    .where(eq(importazioniAgeaRigheTable.importazioneId, importId));
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
          !mapping?.attiva || mapping.prodottoId !== row.prodottoIdSnapshot
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
  const canonical =
    fresh.modalita === "SOLO_ANALISI"
      ? new Map<number, typeof movimentiEsterniAgeaTable.$inferSelect>()
      : await registerCanonicalRows(tx, fresh, rows);
  const createdLoadIds: number[] = [];
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
    const positiveParties = parties.filter((party) =>
      positive(party.quantitaOperativa),
    );
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
          [
            item.fondoNormalizzato ?? "?",
            item.prodottoNormalizzato,
            item.lottoNormalizzato ?? "∅",
          ].join("|") === party.partyKey &&
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
        row.dataCaricoRisolta ?? "∅",
        normalizeAgeaKey(row.mittenteDestinatarioRaw) ?? "∅",
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [key, group] of groups) {
      const first = group[0];
      if (!first.dataCaricoRisolta)
        throw new AgeaImportError(
          409,
          "DATA_CARICO_DA_COMPLETARE",
          "Data carico mancante",
        );
      const result = await createWarehouseLoad(tx, {
        magazzinoId: fresh.magazzinoId,
        origineCarico: "AGEA_SIFEAD",
        numeroDocumento: first.numeroDocumentoRaw,
        dataDocumento: first.dataDocumento,
        dataCarico: first.dataCaricoRisolta,
        descrizione: `Import incrementale AGEA/SIFEAD #${fresh.id}`,
        note:
          first.dataCaricoFonte === "DATA_DOCUMENTO_FALLBACK"
            ? "Data carico derivata dalla data documento"
            : null,
        idempotencyKey:
          `agea-incremental:${fresh.magazzinoId}:${key}:${fresh.id}`.slice(
            0,
            120,
          ),
        executionContext: "system",
        creatoDa: userId,
        righe: group.map((row) => {
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
            fattoreKgLtPezzo: ratioHalfUp(
              row.movimentoKgLt,
              row.movimentoPezzi,
            ),
            codiceLotto: row.lottoRaw,
            descrizioneEsterna: row.prodottoRaw,
            riferimentoEsterno: row.identityKey,
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
