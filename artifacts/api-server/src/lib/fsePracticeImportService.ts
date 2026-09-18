import { createHash, randomUUID } from "node:crypto";
import {
  FONDI_ORIGINE,
  caricoPraticaRigheTable,
  caricoPraticheTable,
  fseImportFilesTable,
  fseImportAttachCommandsTable,
  fseImportRowRevisionsTable,
  fseImportRowsTable,
  fseImportSessionsTable,
  fseImportStockRowsTable,
  fseInitialBalanceCoverageTable,
  fseMovementClaimsTable,
  fseSourceRegistriesTable,
  importazioniAgeaRigheTable,
  lottiLogiciTable,
  magazziniTable,
  mappatureProdottiEsterniTable,
  movimentiTable,
  movimentiEsterniAgeaTable,
  prodottiTable,
  type FondoOrigine,
} from "@workspace/db";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import type { AuditCommandContext } from "./auditEvent";
import { auditFields, recordAuditEvent } from "./auditEvent";
import {
  fseMovementContentHash,
  fseSemanticIdentityHash,
  parseFseDate,
  parseFseFile,
  type FseFileProfile,
  type ParsedFseFile,
} from "./fseImportParser";
import { normalizeAgeaKey } from "./ageaSifeadParser";
import { resolveInventoryQuantityDimensions } from "./inventoryQuantityDimensions";
import { InventoryDecimal } from "./inventoryDecimal";
import { validateProductOperationalQuantity } from "./productQuantity";
import type { InventoryTransaction } from "./scaricoInventory";

export class FsePracticeImportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function lockFseSource(
  tx: InventoryTransaction,
  sourceRegistryId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-source:${sourceRegistryId}`}, 0))`,
  );
}

async function lockFseSourceForSession(
  tx: InventoryTransaction,
  sessionId: number,
) {
  const [session] = await tx
    .select({ sourceRegistryId: fseImportSessionsTable.sourceRegistryId })
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, sessionId));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  await lockFseSource(tx, session.sourceRegistryId);
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function code(): string {
  return `FSE-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

function quantityForProduct(
  product: typeof prodottiTable.$inferSelect,
  values: {
    pieces: string | null;
    kgLt: string | null;
    factor?: string | null;
  },
) {
  const unit = product.unitaMisura.trim().toLowerCase();
  const operational =
    unit === "pz"
      ? values.pieces
      : ["kg", "l", "lt"].includes(unit)
        ? values.kgLt
        : null;
  if (operational == null)
    throw new FsePracticeImportError(
      400,
      "QUANTITA_NON_COMPATIBILE",
      `Il tracciato non fornisce una quantità utilizzabile in ${product.unitaMisura}`,
    );
  validateProductOperationalQuantity({
    quantita: operational,
    quantitaFrazionabile: product.quantitaFrazionabile,
    prodottoLabel: product.nome,
  });
  const dimensions = resolveInventoryQuantityDimensions({
    quantitaOperativa: operational,
    unitaMisura: product.unitaMisura,
    quantitaPezzi: values.pieces,
    quantitaKgLt: values.kgLt,
    fattoreKgLtPezzo: values.factor,
  });
  return dimensions;
}

async function sourceMapping(
  tx: InventoryTransaction,
  sourceRegistryId: number,
  descriptions: string[],
) {
  if (descriptions.length === 0) return new Map<string, number>();
  const mappings = await tx
    .select({
      key: mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
      productId: mappatureProdottiEsterniTable.prodottoId,
    })
    .from(mappatureProdottiEsterniTable)
    .where(
      and(
        eq(mappatureProdottiEsterniTable.sourceRegistryId, sourceRegistryId),
        eq(mappatureProdottiEsterniTable.attiva, true),
        inArray(
          mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
          descriptions,
        ),
      ),
    );
  return new Map(mappings.map((item) => [item.key, item.productId]));
}

async function productsById(tx: InventoryTransaction, ids: number[]) {
  if (ids.length === 0)
    return new Map<number, typeof prodottiTable.$inferSelect>();
  const products = await tx
    .select()
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, [...new Set(ids)]));
  return new Map(products.map((product) => [product.id, product]));
}

async function assertSessionContext(
  tx: InventoryTransaction,
  input: {
    sessionId?: number;
    sourceRegistryId: number;
    areaOperativaId: number;
    magazzinoId: number;
    lottoLogicoId: number;
    modalita: "NUOVI_CARICHI" | "SALDO_INIZIALE";
    caricoPraticaId?: number | null;
    actorId: number;
  },
) {
  const [source] = await tx
    .select()
    .from(fseSourceRegistriesTable)
    .where(eq(fseSourceRegistriesTable.id, input.sourceRegistryId));
  if (!source || source.attiva !== 1)
    throw new FsePracticeImportError(
      404,
      "SORGENTE_NON_TROVATA",
      "Sorgente esterna non disponibile",
    );
  if (source.areaOperativaId !== input.areaOperativaId)
    throw new FsePracticeImportError(
      400,
      "SORGENTE_AREA_INCOERENTE",
      "La sorgente non appartiene all'Area selezionata",
    );
  const [[warehouse], [logicalLot]] = await Promise.all([
    tx
      .select()
      .from(magazziniTable)
      .where(eq(magazziniTable.id, input.magazzinoId)),
    tx
      .select()
      .from(lottiLogiciTable)
      .where(eq(lottiLogiciTable.id, input.lottoLogicoId)),
  ]);
  if (
    !warehouse ||
    warehouse.stato !== "attivo" ||
    warehouse.areaOperativaId !== input.areaOperativaId
  )
    throw new FsePracticeImportError(
      409,
      "MAGAZZINO_NON_OPERATIVO",
      "Il Magazzino non è operativo nell'Area selezionata",
    );
  if (
    !logicalLot ||
    logicalLot.stato !== "aperto" ||
    logicalLot.areaOperativaId !== input.areaOperativaId
  )
    throw new FsePracticeImportError(
      409,
      "LOTTO_LOGICO_NON_OPERATIVO",
      "Il lotto logico non è aperto nell'Area selezionata",
    );
  if (input.caricoPraticaId != null) {
    const [practice] = await tx
      .select()
      .from(caricoPraticheTable)
      .where(eq(caricoPraticheTable.id, input.caricoPraticaId));
    if (
      !practice ||
      !["bozza", "aperta"].includes(practice.stato) ||
      practice.areaOperativaId !== input.areaOperativaId ||
      practice.magazzinoId !== input.magazzinoId ||
      practice.lottoLogicoId !== input.lottoLogicoId ||
      practice.tipoPratica !== "ORDINARIA"
    )
      throw new FsePracticeImportError(
        409,
        "PRATICA_INCOMPATIBILE",
        "La pratica non è compatibile con il contesto di import",
      );
  }
  if (input.sessionId != null) {
    const [session] = await tx
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.id, input.sessionId));
    if (!session)
      throw new FsePracticeImportError(
        404,
        "SESSIONE_NON_TROVATA",
        "Procedura di import non trovata",
      );
    if (
      session.sourceRegistryId !== input.sourceRegistryId ||
      session.areaOperativaId !== input.areaOperativaId ||
      session.magazzinoId !== input.magazzinoId ||
      session.lottoLogicoId !== input.lottoLogicoId ||
      session.modalita !== input.modalita
    )
      throw new FsePracticeImportError(
        409,
        "CONTESTO_SESSIONE_DIVERSO",
        "La procedura esistente appartiene a un contesto diverso",
      );
    if (
      input.caricoPraticaId != null &&
      session.caricoPraticaId !== input.caricoPraticaId
    )
      throw new FsePracticeImportError(
        409,
        "PRATICA_SESSIONE_DIVERSA",
        "La procedura esistente appartiene a una pratica diversa",
      );
    if (["REGISTRATA", "ANNULLATA"].includes(session.stato))
      throw new FsePracticeImportError(
        409,
        "SESSIONE_NON_MODIFICABILE",
        "La procedura non è più modificabile",
      );
    return session;
  }
  const [session] = await tx
    .insert(fseImportSessionsTable)
    .values({
      sourceRegistryId: input.sourceRegistryId,
      areaOperativaId: input.areaOperativaId,
      magazzinoId: input.magazzinoId,
      lottoLogicoId: input.lottoLogicoId,
      caricoPraticaId: input.caricoPraticaId ?? null,
      modalita: input.modalita,
      stato: "IN_ANALISI",
      creatoDa: input.actorId,
      aggiornatoDa: input.actorId,
    })
    .returning();
  return session;
}

async function classifyRegistryRows(
  tx: InventoryTransaction,
  sourceRegistryId: number,
  warehouseId: number,
  parsed: ParsedFseFile,
  mode: "NUOVI_CARICHI" | "SALDO_INIZIALE",
) {
  const descriptions = [
    ...new Set(parsed.registryRows.map((row) => row.prodottoNormalizzato)),
  ];
  const mappings = await sourceMapping(tx, sourceRegistryId, descriptions);
  const productMap = await productsById(tx, [...mappings.values()]);
  const identities = [
    ...new Set(parsed.registryRows.map((row) => row.identityKey)),
  ];
  const claims =
    identities.length === 0
      ? []
      : await tx
          .select()
          .from(fseMovementClaimsTable)
          .where(
            and(
              eq(fseMovementClaimsTable.sourceRegistryId, sourceRegistryId),
              inArray(fseMovementClaimsTable.semanticIdentityHash, identities),
            ),
          );
  const claimsByIdentity = new Map(
    claims
      .filter((claim) => claim.stato !== "RILASCIATA")
      .map((claim) => [claim.semanticIdentityHash, claim]),
  );
  const legacyRows = await tx
    .select({
      stato: movimentiEsterniAgeaTable.statoApplicazione,
      magazzinoId: movimentiEsterniAgeaTable.magazzinoId,
      fondo: importazioniAgeaRigheTable.fondoNormalizzato,
      prodotto: importazioniAgeaRigheTable.prodottoNormalizzato,
      numeroDocumento: importazioniAgeaRigheTable.numeroDocumentoNormalizzato,
      dataDocumento: importazioniAgeaRigheTable.dataDocumento,
      lotto: importazioniAgeaRigheTable.lottoNormalizzato,
      natura: importazioniAgeaRigheTable.tipoMovimentoEsterno,
      mittente: importazioniAgeaRigheTable.mittenteDestinatarioRaw,
      movimentoKgLt: importazioniAgeaRigheTable.movimentoKgLt,
      movimentoPezzi: importazioniAgeaRigheTable.movimentoPezzi,
      dataOperativa: importazioniAgeaRigheTable.dataCaricoRisolta,
    })
    .from(movimentiEsterniAgeaTable)
    .innerJoin(
      importazioniAgeaRigheTable,
      eq(
        movimentiEsterniAgeaTable.acceptedImportRowId,
        importazioniAgeaRigheTable.id,
      ),
    )
    .where(
      inArray(movimentiEsterniAgeaTable.statoApplicazione, [
        "APPLICATO_INCREMENTALE",
        "ASSORBITO_SALDO_INIZIALE",
      ]),
    );
  const legacyByIdentity = new Map<
    string,
    Array<(typeof legacyRows)[number] & { contentHash: string }>
  >();
  for (const legacy of legacyRows) {
    const identity = fseSemanticIdentityHash({
      fondo: legacy.fondo,
      prodotto: legacy.prodotto,
      numeroDocumento: legacy.numeroDocumento,
      dataDocumento: legacy.dataDocumento,
      lotto: legacy.lotto,
      natura: legacy.natura,
      mittenteDestinatario: normalizeAgeaKey(legacy.mittente),
    });
    const match = {
      ...legacy,
      contentHash: fseMovementContentHash({
        movimentoKgLt: legacy.movimentoKgLt,
        movimentoPezzi: legacy.movimentoPezzi,
        dataOperativaProposta: legacy.dataOperativa,
        lotto: legacy.lotto,
        fondo: legacy.fondo,
      }),
    };
    legacyByIdentity.set(identity, [
      ...(legacyByIdentity.get(identity) ?? []),
      match,
    ]);
  }
  const [activeCoverage] = await tx
    .select({ dataTaglio: fseInitialBalanceCoverageTable.dataTaglio })
    .from(fseInitialBalanceCoverageTable)
    .where(
      and(
        eq(fseInitialBalanceCoverageTable.sourceRegistryId, sourceRegistryId),
        eq(fseInitialBalanceCoverageTable.stato, "ATTIVA"),
      ),
    );
  return parsed.registryRows.map((row) => {
    const productId = mappings.get(row.prodottoNormalizzato) ?? null;
    const product = productId == null ? null : productMap.get(productId);
    const claim = claimsByIdentity.get(row.identityKey);
    const legacyMatches = legacyByIdentity.get(row.identityKey) ?? [];
    const legacy =
      legacyMatches.find((match) => match.magazzinoId === warehouseId) ??
      legacyMatches[0];
    let state =
      row.tipoMovimentoEsterno === "CARICO" ? "DA_ASSOCIARE" : "RIFERIMENTO";
    const errors = [...row.errorCodes];
    const warnings = [...row.warningCodes];
    let operational: ReturnType<typeof quantityForProduct> | null = null;
    if (row.blocking) state = "ERRORE";
    else if (mode === "SALDO_INIZIALE") state = "RIFERIMENTO";
    else if (claim) {
      state =
        claim.acceptedContentHash !== row.contentHash
          ? "DATO_MODIFICATO"
          : claim.stato === "REGISTRATA"
            ? "GIA_REGISTRATO"
            : claim.stato === "COPERTA_SALDO"
              ? "COPERTO_SALDO"
              : claim.stato === "RISERVATA"
                ? "GIA_NELLA_PRATICA"
                : "DA_VERIFICARE";
    } else if (legacy) {
      const sameWarehouse = legacy.magazzinoId === warehouseId;
      warnings.push(
        sameWarehouse
          ? "LEGACY_MATCH_RICOSTRUITO"
          : "LEGACY_MATCH_ALTRO_MAGAZZINO_DA_VERIFICARE",
      );
      state = !sameWarehouse
        ? "DA_VERIFICARE"
        : legacy.contentHash !== row.contentHash
          ? "DATO_MODIFICATO"
          : legacy.stato === "ASSORBITO_SALDO_INIZIALE"
            ? "COPERTO_SALDO"
            : "GIA_REGISTRATO";
    } else if (row.tipoMovimentoEsterno === "CARICO" && product) {
      try {
        operational = quantityForProduct(product, {
          pieces: row.movimentoPezzi,
          kgLt: row.movimentoKgLt,
        });
        if (product.lottoFisicoObbligatorio && !row.lottoRaw)
          errors.push("LOTTO_FISICO_OBBLIGATORIO");
        if (product.gestioneScadenza) errors.push("SCADENZA_OBBLIGATORIA");
        if (
          activeCoverage &&
          row.dataDocumento != null &&
          row.dataDocumento <= activeCoverage.dataTaglio
        )
          warnings.push("EVENTO_RETRODATATO_DOPO_SALDO");
        state =
          errors.length > 0
            ? "ERRORE"
            : warnings.some((warning) =>
                  [
                    "DATA_DOCUMENTO_FALLBACK",
                    "EVENTO_RETRODATATO_DOPO_SALDO",
                  ].includes(warning),
                )
              ? "DA_VERIFICARE"
              : "PRONTO";
      } catch (error) {
        state = "ERRORE";
        errors.push(
          error instanceof FsePracticeImportError
            ? error.code
            : "QUANTITA_NON_COMPATIBILE",
        );
      }
    }
    return { row, productId, state, errors, warnings, operational };
  });
}

function mutableImportState(state: string) {
  return [
    "DA_ASSOCIARE",
    "DA_VERIFICARE",
    "DATO_MODIFICATO",
    "ERRORE",
    "PRONTO",
  ].includes(state);
}

async function reconcileRegistryPhysicalData(
  tx: InventoryTransaction,
  sessionId: number,
  actorId: number,
  mode: "NUOVI_CARICHI" | "SALDO_INIZIALE",
) {
  if (mode === "SALDO_INIZIALE") return;
  const [registryRows, stockRows] = await Promise.all([
    tx
      .select()
      .from(fseImportRowsTable)
      .where(eq(fseImportRowsTable.sessioneId, sessionId)),
    tx
      .select()
      .from(fseImportStockRowsTable)
      .where(eq(fseImportStockRowsTable.sessioneId, sessionId)),
  ]);
  const productMap = await productsById(
    tx,
    registryRows
      .map((row) => row.prodottoId)
      .filter((id): id is number => id != null),
  );
  for (const row of registryRows) {
    if (
      row.tipoMovimento !== "CARICO" ||
      row.prodottoId == null ||
      !mutableImportState(row.stato)
    )
      continue;
    const product = productMap.get(row.prodottoId);
    if (!product) continue;
    const matches = stockRows.filter(
      (stock) =>
        stock.fondoOrigine === row.fondoOrigine &&
        stock.prodottoNormalizzato === row.prodottoNormalizzato &&
        (stock.lottoFisico ?? "") === (row.lottoFisico ?? ""),
    );
    const errors = row.errorCodesJson.filter(
      (code) =>
        ![
          "LOTTO_FISICO_OBBLIGATORIO",
          "SCADENZA_OBBLIGATORIA",
          "GIACENZA_AMBIGUA",
          "QUANTITA_NON_COMPATIBILE",
        ].includes(code),
    );
    const warnings = row.warningCodesJson.filter(
      (code) => code !== "GIACENZA_NON_UNIVOCA",
    );
    let expiry = row.dataScadenza;
    let factor = row.fattoreKgLtPezzo;
    if (matches.length === 1) {
      expiry = matches[0].dataScadenza;
      factor = matches[0].pesoUnita;
    } else if (matches.length > 1) {
      errors.push("GIACENZA_AMBIGUA");
      warnings.push("GIACENZA_NON_UNIVOCA");
    }
    if (product.lottoFisicoObbligatorio && !row.lottoFisico)
      errors.push("LOTTO_FISICO_OBBLIGATORIO");
    if (product.gestioneScadenza && !expiry)
      errors.push("SCADENZA_OBBLIGATORIA");
    let dimensions: ReturnType<typeof quantityForProduct> | null = null;
    try {
      dimensions = quantityForProduct(product, {
        pieces: row.quantitaPezzi,
        kgLt: row.quantitaKgLt,
        factor,
      });
    } catch (error) {
      errors.push(
        error instanceof FsePracticeImportError
          ? error.code
          : "QUANTITA_NON_COMPATIBILE",
      );
    }
    const uniqueErrors = [...new Set(errors)];
    const uniqueWarnings = [...new Set(warnings)];
    await tx
      .update(fseImportRowsTable)
      .set({
        dataScadenza: expiry,
        fattoreKgLtPezzo: dimensions?.fattoreKgLtPezzo ?? factor,
        quantitaOperativa: dimensions?.quantitaOperativa ?? null,
        stato:
          row.stato === "DATO_MODIFICATO"
            ? "DATO_MODIFICATO"
            : uniqueErrors.length > 0
              ? "ERRORE"
              : uniqueWarnings.some((warning) =>
                    [
                      "DATA_DOCUMENTO_FALLBACK",
                      "EVENTO_RETRODATATO_DOPO_SALDO",
                      "GIACENZA_NON_UNIVOCA",
                      "LEGACY_MATCH_ALTRO_MAGAZZINO_DA_VERIFICARE",
                    ].includes(warning),
                  )
                ? "DA_VERIFICARE"
                : "PRONTO",
        errorCodesJson: uniqueErrors,
        warningCodesJson: uniqueWarnings,
        aggiornatoDa: actorId,
        dataAggiornamento: new Date(),
      })
      .where(eq(fseImportRowsTable.id, row.id));
  }
}

async function persistRegistryRows(
  tx: InventoryTransaction,
  sessionId: number,
  fileId: number,
  actorId: number,
  classified: Awaited<ReturnType<typeof classifyRegistryRows>>,
) {
  if (classified.length === 0) return;
  await tx.insert(fseImportRowsTable).values(
    classified.map(
      ({ row, productId, state, errors, warnings, operational }) => ({
        sessioneId: sessionId,
        fileId,
        numeroRiga: row.numeroRiga,
        rawJson: row.rawJson,
        semanticIdentityHash: row.identityKey,
        movementContentHash: row.contentHash,
        summaryHash: hash({
          saldoFinalePezzi: row.saldoFinalePezzi,
          saldoFinaleKgLt: row.saldoFinaleKgLt,
          saldoMovimentoPezzi: row.saldoMovimentoPezzi,
          saldoMovimentoKgLt: row.saldoMovimentoKgLt,
        }),
        tipoMovimento: row.tipoMovimentoEsterno,
        fondoOrigine: row.fondoNormalizzato,
        prodottoEsterno: row.prodottoRaw,
        prodottoNormalizzato: row.prodottoNormalizzato,
        lottoFisico: row.lottoRaw,
        numeroDocumento: row.numeroDocumentoRaw,
        dataDocumento: row.dataDocumento,
        dataOperativaProposta: row.dataCaricoRisolta,
        dataOperativaFonte: row.dataCaricoFonte,
        quantitaPezzi: row.movimentoPezzi,
        quantitaKgLt: row.movimentoKgLt,
        saldoFinalePezzi: row.saldoFinalePezzi,
        saldoFinaleKgLt: row.saldoFinaleKgLt,
        prodottoId: productId,
        quantitaOperativa: operational?.quantitaOperativa ?? null,
        fattoreKgLtPezzo: operational?.fattoreKgLtPezzo ?? null,
        stato: state,
        errorCodesJson: [...new Set(errors)],
        warningCodesJson: [...new Set(warnings)],
        aggiornatoDa: actorId,
      }),
    ),
  );
}

async function persistStockRows(
  tx: InventoryTransaction,
  sessionId: number,
  fileId: number,
  sourceRegistryId: number,
  parsed: ParsedFseFile,
) {
  const mappings = await sourceMapping(tx, sourceRegistryId, [
    ...new Set(parsed.stockRows.map((row) => row.prodottoNormalizzato)),
  ]);
  const productMap = await productsById(tx, [...mappings.values()]);
  if (parsed.stockRows.length === 0) return;
  await tx.insert(fseImportStockRowsTable).values(
    parsed.stockRows.map((row) => {
      const productId = mappings.get(row.prodottoNormalizzato) ?? null;
      const product = productId == null ? null : productMap.get(productId);
      let operational: ReturnType<typeof quantityForProduct> | null = null;
      const errors = [...row.errorCodes];
      if (product) {
        try {
          const productUnit = product.unitaMisura.trim().toLowerCase();
          if (
            ["kg", "l", "lt"].includes(productUnit) &&
            row.unitaMisuraPeso != null &&
            !(
              (productUnit === "kg" && row.unitaMisuraPeso === "kg") ||
              (["l", "lt"].includes(productUnit) && row.unitaMisuraPeso === "l")
            )
          )
            throw new FsePracticeImportError(
              400,
              "UNITA_PESO_INCOMPATIBILE",
              `L'unità esterna non coincide con ${product.unitaMisura}`,
            );
          if (product.lottoFisicoObbligatorio && !row.lottoRaw)
            errors.push("LOTTO_FISICO_OBBLIGATORIO");
          if (product.gestioneScadenza && !row.dataScadenza)
            errors.push("SCADENZA_OBBLIGATORIA");
          operational = quantityForProduct(product, {
            pieces: row.giacenzaPezzi,
            kgLt: row.giacenzaPesoVolume,
            factor: row.pesoUnita,
          });
        } catch (error) {
          errors.push(
            error instanceof FsePracticeImportError
              ? error.code
              : "QUANTITA_NON_COMPATIBILE",
          );
        }
      }
      return {
        sessioneId: sessionId,
        fileId,
        numeroRiga: row.numeroRiga,
        rawJson: row.rawJson,
        balanceKey: row.balanceKey,
        fondoOrigine: row.fondoNormalizzato,
        prodottoEsterno: row.prodottoRaw,
        prodottoNormalizzato: row.prodottoNormalizzato,
        lottoFisico: row.lottoRaw,
        pesoUnita: row.pesoUnita,
        unitaMisuraPeso: row.unitaMisuraPeso,
        giacenzaPesoVolume: row.giacenzaPesoVolume,
        giacenzaPezzi: row.giacenzaPezzi,
        pezziPerCollo: row.pezziPerCollo,
        giacenzaColli: row.giacenzaColli,
        dataScadenza: row.dataScadenza,
        prodottoId: productId,
        quantitaOperativa: operational?.quantitaOperativa ?? null,
        stato:
          errors.length > 0
            ? "ERRORE"
            : productId == null
              ? "DA_ASSOCIARE"
              : "PRONTO",
        errorCodesJson: [...new Set(errors)],
        warningCodesJson: row.warningCodes,
      };
    }),
  );
}

async function refreshSessionState(
  tx: InventoryTransaction,
  sessionId: number,
  actorId: number,
) {
  const [session] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, sessionId));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  await lockFseSource(tx, session.sourceRegistryId);
  const files = await tx
    .select()
    .from(fseImportFilesTable)
    .where(eq(fseImportFilesTable.sessioneId, sessionId));
  const rows = await tx
    .select({ state: fseImportRowsTable.stato })
    .from(fseImportRowsTable)
    .where(eq(fseImportRowsTable.sessioneId, sessionId));
  const stock = await tx
    .select({ state: fseImportStockRowsTable.stato })
    .from(fseImportStockRowsTable)
    .where(eq(fseImportStockRowsTable.sessioneId, sessionId));
  const hasRegistry = files.some((file) => file.profilo === "REGISTRO");
  const hasStock = files.some((file) => file.profilo === "GIACENZE");
  const actionable =
    session.modalita === "SALDO_INIZIALE"
      ? stock
      : rows.filter((row) => row.state !== "RIFERIMENTO");
  const registryHasBlockingErrors = rows.some((row) => row.state === "ERRORE");
  const ready =
    hasRegistry &&
    (session.modalita === "NUOVI_CARICHI" || hasStock) &&
    !registryHasBlockingErrors &&
    actionable.length > 0 &&
    actionable.every((row) =>
      [
        "PRONTO",
        "GIA_REGISTRATO",
        "GIA_NELLA_PRATICA",
        "COPERTO_SALDO",
      ].includes(row.state),
    );
  const [changed] = await tx
    .update(fseImportSessionsTable)
    .set({
      stato: ready ? "PRONTA" : "DA_COMPLETARE",
      versione: session.versione + 1,
      aggiornatoDa: actorId,
      dataAggiornamento: new Date(),
    })
    .where(eq(fseImportSessionsTable.id, sessionId))
    .returning();
  return changed;
}

export async function acquireFseFile(
  tx: InventoryTransaction,
  input: {
    buffer: Buffer;
    nomeFile: string;
    mimeType?: string | null;
    profile: FseFileProfile;
    sheetName?: string;
    referenceDate?: string;
    sessionId?: number;
    sourceRegistryId: number;
    areaOperativaId: number;
    magazzinoId: number;
    lottoLogicoId: number;
    caricoPraticaId?: number | null;
    modalita: "NUOVI_CARICHI" | "SALDO_INIZIALE";
    actorId: number;
    audit: AuditCommandContext;
  },
) {
  const parsed = parseFseFile(input.buffer, {
    profile: input.profile,
    sheetName: input.sheetName,
    referenceDate: input.referenceDate,
  });
  await lockFseSource(tx, input.sourceRegistryId);
  if (input.modalita === "NUOVI_CARICHI") {
    const [proposedCoverage] = await tx
      .select({ id: fseInitialBalanceCoverageTable.id })
      .from(fseInitialBalanceCoverageTable)
      .where(
        and(
          eq(
            fseInitialBalanceCoverageTable.sourceRegistryId,
            input.sourceRegistryId,
          ),
          eq(fseInitialBalanceCoverageTable.stato, "PROPOSTA"),
        ),
      );
    if (proposedCoverage)
      throw new FsePracticeImportError(
        409,
        "SALDO_INIZIALE_IN_CORSO",
        "È in corso la preparazione della giacenza iniziale. Completa o annulla il saldo prima di importare nuovi carichi.",
      );
  }
  if (input.sessionId == null) {
    const [sameFile] = await tx
      .select({
        sessionId: fseImportSessionsTable.id,
        fileId: fseImportFilesTable.id,
        versione: fseImportSessionsTable.versione,
        stato: fseImportSessionsTable.stato,
      })
      .from(fseImportFilesTable)
      .innerJoin(
        fseImportSessionsTable,
        eq(fseImportFilesTable.sessioneId, fseImportSessionsTable.id),
      )
      .where(
        and(
          eq(fseImportFilesTable.profilo, input.profile),
          eq(fseImportFilesTable.sha256File, parsed.sha256File),
          eq(fseImportSessionsTable.sourceRegistryId, input.sourceRegistryId),
          eq(fseImportSessionsTable.areaOperativaId, input.areaOperativaId),
          eq(fseImportSessionsTable.magazzinoId, input.magazzinoId),
          eq(fseImportSessionsTable.lottoLogicoId, input.lottoLogicoId),
          eq(fseImportSessionsTable.modalita, input.modalita),
          ne(fseImportSessionsTable.stato, "ANNULLATA"),
        ),
      )
      .limit(1);
    if (sameFile)
      return {
        ...sameFile,
        replay: true,
        formato: parsed.format,
        sha256File: parsed.sha256File,
      };
  }
  const session = await assertSessionContext(tx, input);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-session:${session.id}`}, 0))`,
  );
  const [existing] = await tx
    .select()
    .from(fseImportFilesTable)
    .where(
      and(
        eq(fseImportFilesTable.sessioneId, session.id),
        eq(fseImportFilesTable.profilo, input.profile),
        eq(fseImportFilesTable.sha256File, parsed.sha256File),
      ),
    );
  if (existing)
    return { sessionId: session.id, fileId: existing.id, replay: true };
  const [file] = await tx
    .insert(fseImportFilesTable)
    .values({
      sessioneId: session.id,
      profilo: input.profile,
      nomeFile: input.nomeFile,
      formato: parsed.format,
      mimeTypeDichiarato: input.mimeType ?? null,
      dimensioneBytes: input.buffer.length,
      sha256File: parsed.sha256File,
      tracciatoCodice: parsed.profileCode,
      parserVersion: parsed.parserVersion,
      sheetName: parsed.sheetName,
      dataRiferimento: parsed.dataRiferimento,
      warningsJson: parsed.warnings,
      acquisitoDa: input.actorId,
    })
    .returning();
  if (input.profile === "REGISTRO") {
    const classified = await classifyRegistryRows(
      tx,
      input.sourceRegistryId,
      input.magazzinoId,
      parsed,
      input.modalita,
    );
    await persistRegistryRows(
      tx,
      session.id,
      file.id,
      input.actorId,
      classified,
    );
  } else {
    await persistStockRows(
      tx,
      session.id,
      file.id,
      input.sourceRegistryId,
      parsed,
    );
  }
  await reconcileRegistryPhysicalData(
    tx,
    session.id,
    input.actorId,
    session.modalita as "NUOVI_CARICHI" | "SALDO_INIZIALE",
  );
  if (input.modalita === "SALDO_INIZIALE" && parsed.dataRiferimento) {
    await tx
      .update(fseImportSessionsTable)
      .set({ dataRiferimentoSaldo: parsed.dataRiferimento })
      .where(eq(fseImportSessionsTable.id, session.id));
  }
  const refreshed = await refreshSessionState(tx, session.id, input.actorId);
  await recordAuditEvent(tx, {
    command: input.audit,
    azione: "FSE_IMPORT_FILE_ACQUISITO",
    entitaTipo: "fse_import_session",
    entitaId: session.id,
    areaOperativaIdSnapshot: session.areaOperativaId,
    magazzinoIdSnapshot: session.magazzinoId,
    metadata: auditFields(
      {
        fileId: file.id,
        profilo: file.profilo,
        formato: file.formato,
        sha256File: file.sha256File,
        righe:
          input.profile === "REGISTRO"
            ? parsed.registryRows.length
            : parsed.stockRows.length,
      },
      ["fileId", "profilo", "formato", "sha256File", "righe"],
    ),
  });
  return {
    sessionId: session.id,
    fileId: file.id,
    replay: false,
    versione: refreshed.versione,
    stato: refreshed.stato,
    formato: parsed.format,
    sha256File: parsed.sha256File,
  };
}

export async function mapFseProduct(
  tx: InventoryTransaction,
  input: {
    sessionId: number;
    version: number;
    externalDescription: string;
    productId: number;
    actorId: number;
    reason: string;
    acceptDateFallback: boolean;
    audit: AuditCommandContext;
  },
) {
  await lockFseSourceForSession(tx, input.sessionId);
  await tx.execute(
    sql`SELECT id FROM ${fseImportSessionsTable} WHERE ${fseImportSessionsTable.id}=${input.sessionId} FOR UPDATE`,
  );
  const [session] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, input.sessionId));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  if (session.versione !== input.version)
    throw new FsePracticeImportError(
      409,
      "VERSIONE_SESSIONE",
      "La procedura è stata modificata da un altro operatore",
    );
  if (
    ["REGISTRATA", "ANNULLATA"].includes(session.stato) ||
    (session.modalita === "SALDO_INIZIALE" && session.stato === "IN_PRATICA")
  )
    throw new FsePracticeImportError(
      409,
      "SESSIONE_NON_MODIFICABILE",
      "La procedura non è più modificabile",
    );
  const [product] = await tx
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, input.productId));
  if (!product || !product.attivo)
    throw new FsePracticeImportError(
      404,
      "PRODOTTO_NON_TROVATO",
      "Prodotto non disponibile",
    );
  const key = input.externalDescription
    .trim()
    .toLocaleUpperCase("it-IT")
    .replace(/\s+/g, " ");
  if (!key)
    throw new FsePracticeImportError(
      400,
      "DESCRIZIONE_OBBLIGATORIA",
      "Descrizione esterna obbligatoria",
    );
  const [existingMapping] = await tx
    .select({ id: mappatureProdottiEsterniTable.id })
    .from(mappatureProdottiEsterniTable)
    .where(
      and(
        eq(
          mappatureProdottiEsterniTable.sourceRegistryId,
          session.sourceRegistryId,
        ),
        eq(mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata, key),
      ),
    );
  if (existingMapping) {
    await tx
      .update(mappatureProdottiEsterniTable)
      .set({
        prodottoId: product.id,
        attiva: true,
        versione: sql`${mappatureProdottiEsterniTable.versione} + 1`,
        aggiornatoDa: input.actorId,
        dataUltimoAggiornamento: new Date(),
        dataUltimoRiscontro: new Date(),
      })
      .where(eq(mappatureProdottiEsterniTable.id, existingMapping.id));
  } else {
    await tx.insert(mappatureProdottiEsterniTable).values({
      fonte: "AGEA_SIFEAD",
      sourceRegistryId: session.sourceRegistryId,
      descrizioneEsterna: input.externalDescription.trim(),
      chiaveDescrizioneNormalizzata: key,
      prodottoId: product.id,
      creatoDa: input.actorId,
      aggiornatoDa: input.actorId,
    });
  }
  const registryRows =
    session.modalita === "SALDO_INIZIALE"
      ? []
      : await tx
          .select()
          .from(fseImportRowsTable)
          .where(
            and(
              eq(fseImportRowsTable.sessioneId, input.sessionId),
              eq(fseImportRowsTable.prodottoNormalizzato, key),
              eq(fseImportRowsTable.tipoMovimento, "CARICO"),
            ),
          );
  for (const row of registryRows.filter((item) =>
    mutableImportState(item.stato),
  )) {
    const errors = row.errorCodesJson.filter(
      (item) => item !== "QUANTITA_NON_COMPATIBILE",
    );
    let dimensions;
    try {
      dimensions = quantityForProduct(product, {
        pieces: row.quantitaPezzi,
        kgLt: row.quantitaKgLt,
      });
    } catch (error) {
      errors.push(
        error instanceof FsePracticeImportError
          ? error.code
          : "QUANTITA_NON_COMPATIBILE",
      );
    }
    const fallback = row.warningCodesJson.includes("DATA_DOCUMENTO_FALLBACK");
    const [lastRevision] = await tx
      .select({
        maxVersion: sql<number>`coalesce(max(${fseImportRowRevisionsTable.versione}), 0)::int`,
      })
      .from(fseImportRowRevisionsTable)
      .where(eq(fseImportRowRevisionsTable.rigaId, row.id));
    const acceptedValues = {
      prodottoId: product.id,
      accettaFallbackData: fallback && input.acceptDateFallback,
    };
    await tx.insert(fseImportRowRevisionsTable).values({
      rigaId: row.id,
      versione: (lastRevision?.maxVersion ?? 0) + 1,
      acceptedValuesJson: acceptedValues,
      revisionHash: hash(acceptedValues),
      motivo: input.reason,
      creatoDa: input.actorId,
    });
    await tx
      .update(fseImportRowsTable)
      .set({
        prodottoId: product.id,
        quantitaOperativa: dimensions?.quantitaOperativa ?? null,
        fattoreKgLtPezzo: dimensions?.fattoreKgLtPezzo ?? null,
        stato:
          errors.length > 0
            ? "ERRORE"
            : fallback && !input.acceptDateFallback
              ? "DA_VERIFICARE"
              : "PRONTO",
        errorCodesJson: [...new Set(errors)],
        warningCodesJson:
          fallback && input.acceptDateFallback
            ? row.warningCodesJson.filter(
                (item) => item !== "DATA_DOCUMENTO_FALLBACK",
              )
            : row.warningCodesJson,
        aggiornatoDa: input.actorId,
        dataAggiornamento: new Date(),
      })
      .where(eq(fseImportRowsTable.id, row.id));
  }
  const stockRows = await tx
    .select()
    .from(fseImportStockRowsTable)
    .where(
      and(
        eq(fseImportStockRowsTable.sessioneId, input.sessionId),
        eq(fseImportStockRowsTable.prodottoNormalizzato, key),
      ),
    );
  for (const row of stockRows) {
    const errors = row.errorCodesJson.filter(
      (item) =>
        ![
          "QUANTITA_NON_COMPATIBILE",
          "UNITA_PESO_INCOMPATIBILE",
          "LOTTO_FISICO_OBBLIGATORIO",
          "SCADENZA_OBBLIGATORIA",
        ].includes(item),
    );
    let dimensions;
    try {
      const productUnit = product.unitaMisura.trim().toLowerCase();
      if (
        ["kg", "l", "lt"].includes(productUnit) &&
        row.unitaMisuraPeso != null &&
        !(
          (productUnit === "kg" && row.unitaMisuraPeso === "kg") ||
          (["l", "lt"].includes(productUnit) && row.unitaMisuraPeso === "l")
        )
      )
        throw new FsePracticeImportError(
          400,
          "UNITA_PESO_INCOMPATIBILE",
          `L'unità esterna non coincide con ${product.unitaMisura}`,
        );
      if (product.lottoFisicoObbligatorio && !row.lottoFisico)
        errors.push("LOTTO_FISICO_OBBLIGATORIO");
      if (product.gestioneScadenza && !row.dataScadenza)
        errors.push("SCADENZA_OBBLIGATORIA");
      dimensions = quantityForProduct(product, {
        pieces: row.giacenzaPezzi,
        kgLt: row.giacenzaPesoVolume,
        factor: row.pesoUnita,
      });
    } catch (error) {
      errors.push(
        error instanceof FsePracticeImportError
          ? error.code
          : "QUANTITA_NON_COMPATIBILE",
      );
    }
    await tx
      .update(fseImportStockRowsTable)
      .set({
        prodottoId: product.id,
        quantitaOperativa: dimensions?.quantitaOperativa ?? null,
        stato: errors.length > 0 ? "ERRORE" : "PRONTO",
        errorCodesJson: [...new Set(errors)],
      })
      .where(eq(fseImportStockRowsTable.id, row.id));
  }
  await reconcileRegistryPhysicalData(
    tx,
    session.id,
    input.actorId,
    session.modalita as "NUOVI_CARICHI" | "SALDO_INIZIALE",
  );
  const refreshed = await refreshSessionState(tx, session.id, input.actorId);
  await recordAuditEvent(tx, {
    command: input.audit,
    azione: "FSE_IMPORT_MAPPING_CONFERMATO",
    entitaTipo: "fse_import_session",
    entitaId: session.id,
    areaOperativaIdSnapshot: session.areaOperativaId,
    magazzinoIdSnapshot: session.magazzinoId,
    motivo: input.reason,
    changes: auditFields(
      { prodottoId: product.id, descrizioneNormalizzata: key },
      ["prodottoId", "descrizioneNormalizzata"],
    ),
  });
  return refreshed;
}

export async function reviseFseImportRow(
  tx: InventoryTransaction,
  input: {
    sessionId: number;
    rowId: number;
    version: number;
    quantity?: string;
    documentNumber?: string | null;
    documentDate?: string | null;
    operationalDate?: string | null;
    physicalLot?: string | null;
    expiryDate?: string | null;
    factor?: string | null;
    disambiguator?: string | null;
    acceptDateFallback: boolean;
    reason: string;
    actorId: number;
    audit: AuditCommandContext;
  },
) {
  await lockFseSourceForSession(tx, input.sessionId);
  await tx.execute(
    sql`SELECT id FROM ${fseImportSessionsTable} WHERE ${fseImportSessionsTable.id}=${input.sessionId} FOR UPDATE`,
  );
  const [session] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, input.sessionId));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  if (session.versione !== input.version)
    throw new FsePracticeImportError(
      409,
      "VERSIONE_SESSIONE",
      "La procedura è stata modificata da un altro operatore",
    );
  if (
    ["REGISTRATA", "ANNULLATA"].includes(session.stato) ||
    (session.modalita === "SALDO_INIZIALE" && session.stato === "IN_PRATICA")
  )
    throw new FsePracticeImportError(
      409,
      "SESSIONE_NON_MODIFICABILE",
      "La procedura non è più modificabile",
    );
  const [row] = await tx
    .select()
    .from(fseImportRowsTable)
    .where(
      and(
        eq(fseImportRowsTable.id, input.rowId),
        eq(fseImportRowsTable.sessioneId, session.id),
      ),
    );
  if (!row)
    throw new FsePracticeImportError(
      404,
      "RIGA_NON_TROVATA",
      "Riga di import non trovata",
    );
  if (!mutableImportState(row.stato))
    throw new FsePracticeImportError(
      409,
      "RIGA_NON_CORREGGIBILE",
      "La riga è già stata presa in carico o contabilizzata",
    );
  if (row.tipoMovimento !== "CARICO" || row.prodottoId == null)
    throw new FsePracticeImportError(
      409,
      "RIGA_NON_CORREGGIBILE",
      "Associa prima un prodotto a una riga di carico",
    );
  const [activeClaim] = await tx
    .select({ id: fseMovementClaimsTable.id })
    .from(fseMovementClaimsTable)
    .where(
      and(
        eq(fseMovementClaimsTable.sourceRegistryId, session.sourceRegistryId),
        eq(
          fseMovementClaimsTable.semanticIdentityHash,
          row.semanticIdentityHash,
        ),
        ne(fseMovementClaimsTable.stato, "RILASCIATA"),
      ),
    );
  if (activeClaim)
    throw new FsePracticeImportError(
      409,
      "RIGA_GIA_PRESA_IN_CARICO",
      "La riga è già collegata a una pratica o contabilizzazione",
    );
  const [product] = await tx
    .select()
    .from(prodottiTable)
    .where(eq(prodottiTable.id, row.prodottoId));
  if (!product || !product.attivo)
    throw new FsePracticeImportError(
      409,
      "PRODOTTO_NON_DISPONIBILE",
      "Il prodotto associato non è disponibile",
    );

  const normalizeOptional = (value: string | null | undefined, max: number) => {
    if (value === undefined) return undefined;
    const normalized =
      value?.normalize("NFC").trim().replace(/\s+/g, " ") ?? "";
    if (normalized.length > max)
      throw new FsePracticeImportError(
        400,
        "CAMPO_TROPPO_LUNGO",
        `Il valore supera ${max} caratteri`,
      );
    return normalized || null;
  };
  const normalizedDate = (value: string | null | undefined, field: string) => {
    if (value === undefined) return undefined;
    if (value == null || value.trim() === "") return null;
    const parsed = parseFseDate(value);
    if (!parsed)
      throw new FsePracticeImportError(
        400,
        "DATA_NON_VALIDA",
        `${field} deve essere una data valida YYYY-MM-DD`,
      );
    return parsed;
  };
  const revisedDocumentNumber = normalizeOptional(input.documentNumber, 100);
  const revisedDocumentDate = normalizedDate(
    input.documentDate,
    "dataDocumento",
  );
  const revisedOperationalDate = normalizedDate(
    input.operationalDate,
    "dataOperativa",
  );
  const revisedPhysicalLot = normalizeOptional(input.physicalLot, 80);
  const revisedExpiryDate = normalizedDate(input.expiryDate, "dataScadenza");
  const revisedDisambiguator = normalizeOptional(input.disambiguator, 80);
  const documentNumber =
    revisedDocumentNumber === undefined
      ? row.numeroDocumento
      : revisedDocumentNumber;
  const documentDate =
    revisedDocumentDate === undefined ? row.dataDocumento : revisedDocumentDate;
  const operationalDate =
    revisedOperationalDate === undefined
      ? row.dataOperativaProposta
      : revisedOperationalDate;
  const physicalLot =
    revisedPhysicalLot === undefined ? row.lottoFisico : revisedPhysicalLot;
  const expiryDate =
    revisedExpiryDate === undefined ? row.dataScadenza : revisedExpiryDate;
  const disambiguator =
    revisedDisambiguator === undefined
      ? row.disambiguatore
      : revisedDisambiguator;
  const factor =
    input.factor === undefined
      ? row.fattoreKgLtPezzo
      : input.factor == null || input.factor.trim() === ""
        ? null
        : InventoryDecimal.parse(input.factor).toDb();
  const unit = product.unitaMisura.trim().toLowerCase();
  const quantity =
    input.quantity == null
      ? row.quantitaOperativa
      : InventoryDecimal.parse(input.quantity).toDb();
  const pieces = unit === "pz" ? quantity : row.quantitaPezzi;
  const kgLt = ["kg", "l", "lt"].includes(unit) ? quantity : row.quantitaKgLt;
  const dimensions = quantityForProduct(product, {
    pieces,
    kgLt,
    factor,
  });
  const errors = row.errorCodesJson.filter(
    (code) =>
      ![
        "MOLTEPLICITA_AMBIGUA",
        "LOTTO_FISICO_OBBLIGATORIO",
        "SCADENZA_OBBLIGATORIA",
        "GIACENZA_AMBIGUA",
        "QUANTITA_NON_COMPATIBILE",
      ].includes(code),
  );
  const warnings = row.warningCodesJson.filter((code) => {
    if (input.acceptDateFallback && code === "DATA_DOCUMENTO_FALLBACK")
      return false;
    if (input.expiryDate !== undefined && code === "GIACENZA_NON_UNIVOCA")
      return false;
    return true;
  });
  if (row.errorCodesJson.includes("MOLTEPLICITA_AMBIGUA") && !disambiguator)
    errors.push("DISAMBIGUATORE_OBBLIGATORIO");
  if (product.lottoFisicoObbligatorio && !physicalLot)
    errors.push("LOTTO_FISICO_OBBLIGATORIO");
  if (product.gestioneScadenza && !expiryDate)
    errors.push("SCADENZA_OBBLIGATORIA");
  const identity = fseSemanticIdentityHash({
    fondo: row.fondoOrigine,
    prodotto: row.prodottoNormalizzato,
    numeroDocumento: normalizeAgeaKey(documentNumber),
    dataDocumento: documentDate,
    lotto: normalizeAgeaKey(physicalLot),
    natura: row.tipoMovimento,
    mittenteDestinatario: normalizeAgeaKey(
      String(row.rawJson["Mittente / destinatario"] ?? ""),
    ),
  });
  const content = fseMovementContentHash({
    movimentoKgLt: kgLt,
    movimentoPezzi: pieces,
    dataOperativaProposta: operationalDate,
    lotto: normalizeAgeaKey(physicalLot),
    fondo: row.fondoOrigine,
  });
  const [conflict] = await tx
    .select({ id: fseMovementClaimsTable.id })
    .from(fseMovementClaimsTable)
    .where(
      and(
        eq(fseMovementClaimsTable.sourceRegistryId, session.sourceRegistryId),
        eq(fseMovementClaimsTable.semanticIdentityHash, identity),
        eq(fseMovementClaimsTable.disambiguatore, disambiguator ?? ""),
        ne(fseMovementClaimsTable.stato, "RILASCIATA"),
      ),
    );
  if (conflict)
    throw new FsePracticeImportError(
      409,
      "IDENTITA_GIA_PRESA_IN_CARICO",
      "La correzione coincide con una riga già presa in carico",
    );
  const [lastRevision] = await tx
    .select({
      maxVersion: sql<number>`coalesce(max(${fseImportRowRevisionsTable.versione}), 0)::int`,
    })
    .from(fseImportRowRevisionsTable)
    .where(eq(fseImportRowRevisionsTable.rigaId, row.id));
  const acceptedValues = {
    prodottoId: product.id,
    fondoOrigine: row.fondoOrigine,
    quantita: dimensions.quantitaOperativa,
    lottoFisico: physicalLot,
    dataScadenza: expiryDate,
    numeroDocumento: documentNumber,
    dataDocumento: documentDate,
    dataOperativa: operationalDate,
    fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
    disambiguatore: disambiguator,
  };
  await tx.insert(fseImportRowRevisionsTable).values({
    rigaId: row.id,
    versione: (lastRevision?.maxVersion ?? 0) + 1,
    acceptedValuesJson: acceptedValues,
    revisionHash: hash(acceptedValues),
    motivo: input.reason,
    creatoDa: input.actorId,
  });
  await tx
    .update(fseImportRowsTable)
    .set({
      semanticIdentityHash: identity,
      disambiguatore: disambiguator ?? "",
      movementContentHash: content,
      numeroDocumento: documentNumber,
      dataDocumento: documentDate,
      dataOperativaProposta: operationalDate,
      dataOperativaFonte:
        operationalDate === documentDate
          ? "DATA_DOCUMENTO_CONFERMATA"
          : "CORREZIONE_OPERATORE",
      lottoFisico: physicalLot,
      quantitaPezzi: pieces,
      quantitaKgLt: kgLt,
      quantitaOperativa: dimensions.quantitaOperativa,
      dataScadenza: expiryDate,
      fattoreKgLtPezzo: dimensions.fattoreKgLtPezzo,
      stato:
        errors.length > 0
          ? "ERRORE"
          : warnings.length > 0
            ? "DA_VERIFICARE"
            : "PRONTO",
      errorCodesJson: [...new Set(errors)],
      warningCodesJson: [...new Set(warnings)],
      aggiornatoDa: input.actorId,
      dataAggiornamento: new Date(),
    })
    .where(eq(fseImportRowsTable.id, row.id));
  const refreshed = await refreshSessionState(tx, session.id, input.actorId);
  await recordAuditEvent(tx, {
    command: input.audit,
    azione: "FSE_IMPORT_RIGA_REVISIONATA",
    entitaTipo: "fse_import_row",
    entitaId: row.id,
    areaOperativaIdSnapshot: session.areaOperativaId,
    magazzinoIdSnapshot: session.magazzinoId,
    motivo: input.reason,
    changes: auditFields(
      {
        prodottoId: product.id,
        quantita: dimensions.quantitaOperativa,
        dataOperativa: operationalDate,
        disambiguatore: disambiguator,
      },
      ["prodottoId", "quantita", "dataOperativa", "disambiguatore"],
    ),
  });
  return refreshed;
}

async function assertInitialBalanceReconciliation(
  tx: InventoryTransaction,
  sessionId: number,
) {
  const registry = await tx
    .select()
    .from(fseImportRowsTable)
    .where(eq(fseImportRowsTable.sessioneId, sessionId));
  const stock = await tx
    .select()
    .from(fseImportStockRowsTable)
    .where(eq(fseImportStockRowsTable.sessioneId, sessionId));
  if (stock.length === 0 || registry.length === 0)
    throw new FsePracticeImportError(
      409,
      "COPPIA_FILE_INCOMPLETA",
      "Registro e Giacenze sono entrambi obbligatori per il saldo iniziale",
    );
  const files = await tx
    .select({
      profilo: fseImportFilesTable.profilo,
      dataRiferimento: fseImportFilesTable.dataRiferimento,
    })
    .from(fseImportFilesTable)
    .where(eq(fseImportFilesTable.sessioneId, sessionId));
  const registryDate = files.find(
    (file) => file.profilo === "REGISTRO",
  )?.dataRiferimento;
  const stockDate = files.find(
    (file) => file.profilo === "GIACENZE",
  )?.dataRiferimento;
  if (!stockDate || (registryDate != null && registryDate !== stockDate))
    throw new FsePracticeImportError(
      409,
      "DATE_RIFERIMENTO_INCOERENTI",
      "Registro e Giacenze non hanno la stessa data di riferimento confermata",
    );
  if (
    registry.some(
      (row) => row.tipoMovimento === "CARICO" && row.errorCodesJson.length > 0,
    )
  )
    throw new FsePracticeImportError(
      409,
      "REGISTRO_AMBIGUO",
      "Il Registro contiene carichi ambigui o non validi da risolvere",
    );

  const balanceKey = (row: {
    fondoOrigine: string | null;
    prodottoNormalizzato: string;
    lottoFisico: string | null;
  }) =>
    JSON.stringify([
      row.fondoOrigine,
      row.prodottoNormalizzato,
      row.lottoFisico ?? "",
    ]);
  const registryByBalance = new Map<string, Array<(typeof registry)[number]>>();
  const stockByBalance = new Map<string, Array<(typeof stock)[number]>>();
  for (const row of registry) {
    const key = balanceKey(row);
    registryByBalance.set(key, [...(registryByBalance.get(key) ?? []), row]);
  }
  for (const row of stock) {
    const key = balanceKey(row);
    stockByBalance.set(key, [...(stockByBalance.get(key) ?? []), row]);
  }

  for (const [key, balances] of stockByBalance) {
    if (balances.length !== 1)
      throw new FsePracticeImportError(
        409,
        "GIACENZA_AMBIGUA",
        "Più righe Giacenze descrivono lo stesso Fondo/Prodotto/Lotto",
      );
    if (!registryByBalance.has(key))
      throw new FsePracticeImportError(
        409,
        "SALDO_SENZA_REGISTRO",
        `La giacenza in riga ${balances[0].numeroRiga} non trova riscontro nel Registro`,
      );
  }

  for (const [key, matches] of registryByBalance) {
    const finalPieces = [
      ...new Set(matches.map((row) => row.saldoFinalePezzi)),
    ];
    const finalKg = [...new Set(matches.map((row) => row.saldoFinaleKgLt))];
    if (finalPieces.length !== 1 || finalKg.length !== 1)
      throw new FsePracticeImportError(
        409,
        "SALDO_NON_RICONCILIATO",
        "Il Registro contiene saldi finali incompatibili per lo stesso Fondo/Prodotto/Lotto",
      );
    const hasPositiveBalance = [finalPieces[0], finalKg[0]].some(
      (value) =>
        value != null &&
        InventoryDecimal.parse(value, { allowNegative: true }).isPositive(),
    );
    const balances = stockByBalance.get(key) ?? [];
    if (hasPositiveBalance && balances.length !== 1)
      throw new FsePracticeImportError(
        409,
        "SALDO_POSITIVO_SENZA_GIACENZA",
        "Un saldo finale positivo del Registro non è presente nel file Giacenze",
      );
    if (balances.length === 0) continue;
    const balance = balances[0];
    if (
      (balance.giacenzaPezzi != null &&
        finalPieces[0] !== balance.giacenzaPezzi) ||
      (balance.giacenzaPesoVolume != null &&
        finalKg[0] !== balance.giacenzaPesoVolume)
    )
      throw new FsePracticeImportError(
        409,
        "SALDO_NON_RICONCILIATO",
        `La giacenza in riga ${balance.numeroRiga} non coincide con il saldo finale del Registro`,
      );
  }
  return { registry, stock };
}

export async function addFseRowsToPractice(
  tx: InventoryTransaction,
  input: {
    sessionId: number;
    version: number;
    practiceVersion?: number;
    rowIds?: number[];
    idempotencyKey: string;
    historicalCoverageConfirmed: boolean;
    actorId: number;
    audit: AuditCommandContext;
  },
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-attach:${input.idempotencyKey}`}, 0))`,
  );
  await lockFseSourceForSession(tx, input.sessionId);
  await tx.execute(
    sql`SELECT id FROM ${fseImportSessionsTable} WHERE ${fseImportSessionsTable.id}=${input.sessionId} FOR UPDATE`,
  );
  const [session] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, input.sessionId));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  const requestHash = hash({
    sessionId: input.sessionId,
    version: input.version,
    practiceVersion: input.practiceVersion ?? null,
    rowIds: [...new Set(input.rowIds ?? [])].sort((a, b) => a - b),
    historicalCoverageConfirmed: input.historicalCoverageConfirmed,
  });
  const [previousCommand] = await tx
    .select()
    .from(fseImportAttachCommandsTable)
    .where(
      eq(fseImportAttachCommandsTable.idempotencyKey, input.idempotencyKey),
    );
  if (previousCommand) {
    if (
      previousCommand.sessioneId === session.id &&
      previousCommand.requestHash === requestHash
    )
      return { ...previousCommand.resultJson, replay: true };
    throw new FsePracticeImportError(
      409,
      "IDEMPOTENCY_KEY_RIUSATA",
      "La chiave idempotente è già stata usata con un contenuto differente",
    );
  }
  if (session.versione !== input.version)
    throw new FsePracticeImportError(
      409,
      "VERSIONE_SESSIONE",
      "La procedura è stata modificata da un altro operatore",
    );
  if (
    !(
      session.stato === "PRONTA" ||
      (session.modalita === "NUOVI_CARICHI" && session.stato === "IN_PRATICA")
    )
  )
    throw new FsePracticeImportError(
      409,
      "SESSIONE_NON_PRONTA",
      "Completa le righe da verificare prima di aggiungerle alla pratica",
    );

  let convertPractice = false;
  let practice = session.caricoPraticaId
    ? (
        await tx
          .select()
          .from(caricoPraticheTable)
          .where(eq(caricoPraticheTable.id, session.caricoPraticaId))
      )[0]
    : null;
  if (practice) {
    await tx.execute(
      sql`SELECT id FROM ${caricoPraticheTable} WHERE ${caricoPraticheTable.id}=${practice.id} FOR UPDATE`,
    );
    if (practice.versione !== input.practiceVersion)
      throw new FsePracticeImportError(
        409,
        "VERSIONE_PRATICA",
        "La pratica è stata modificata da un altro operatore",
      );
    if (!["bozza", "aperta"].includes(practice.stato))
      throw new FsePracticeImportError(
        409,
        "PRATICA_NON_MODIFICABILE",
        "La pratica non è modificabile",
      );
    if (
      practice.areaOperativaId !== session.areaOperativaId ||
      practice.magazzinoId !== session.magazzinoId ||
      practice.lottoLogicoId !== session.lottoLogicoId
    )
      throw new FsePracticeImportError(
        409,
        "PRATICA_INCOMPATIBILE",
        "La pratica appartiene a un contesto diverso",
      );
    const [practiceRows] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(caricoPraticaRigheTable)
      .where(eq(caricoPraticaRigheTable.caricoPraticaId, practice.id));
    const nonEmpty = (practiceRows?.count ?? 0) > 0;
    const alreadyFsePractice = practice.origineCarico === "AGEA_SIFEAD";
    if (
      nonEmpty &&
      !(
        session.modalita === "NUOVI_CARICHI" &&
        alreadyFsePractice &&
        practice.tipoPratica === "ORDINARIA"
      )
    )
      throw new FsePracticeImportError(
        409,
        "PRATICA_NON_VUOTA",
        "L'import FSE+ richiede una pratica vuota per preservare la provenienza contabile",
      );
    convertPractice =
      !alreadyFsePractice || session.modalita === "SALDO_INIZIALE";
  }

  let workRows: Array<{
    sourceId: number;
    productId: number;
    fund: FondoOrigine;
    quantity: string;
    lot: string | null;
    expiry: string | null;
    factor: string | null;
    document: string | null;
    documentDate: string | null;
    operationalDate: string | null;
    operationalSource: string | null;
    identity: string | null;
    disambiguator: string;
    content: string | null;
    rawDescription: string;
  }>;
  let registryForCoverage: (typeof fseImportRowsTable.$inferSelect)[] = [];
  if (session.modalita === "SALDO_INIZIALE") {
    if (!input.historicalCoverageConfirmed)
      throw new FsePracticeImportError(
        409,
        "COPERTURA_STORICA_NON_CONFERMATA",
        "Conferma esplicitamente che il Registro copra lo storico necessario fino alla data di riferimento",
      );
    if (!session.dataRiferimentoSaldo)
      throw new FsePracticeImportError(
        409,
        "DATA_TAGLIO_MANCANTE",
        "Conferma la data di riferimento del saldo",
      );
    const [openOrdinaryImport] = await tx
      .select({ id: fseImportSessionsTable.id })
      .from(fseImportSessionsTable)
      .where(
        and(
          eq(fseImportSessionsTable.sourceRegistryId, session.sourceRegistryId),
          eq(fseImportSessionsTable.modalita, "NUOVI_CARICHI"),
          inArray(fseImportSessionsTable.stato, [
            "IN_ANALISI",
            "DA_COMPLETARE",
            "PRONTA",
            "IN_PRATICA",
          ]),
        ),
      )
      .limit(1);
    if (openOrdinaryImport)
      throw new FsePracticeImportError(
        409,
        "IMPORT_ORDINARIO_IN_CORSO",
        "Esiste un'importazione ordinaria FSE+ ancora aperta per questa sorgente. Completala o annullala prima di impostare la giacenza iniziale.",
      );
    const [existingCoverage] = await tx
      .select()
      .from(fseInitialBalanceCoverageTable)
      .where(
        and(
          or(
            eq(
              fseInitialBalanceCoverageTable.sourceRegistryId,
              session.sourceRegistryId,
            ),
            eq(fseInitialBalanceCoverageTable.magazzinoId, session.magazzinoId),
          ),
          ne(fseInitialBalanceCoverageTable.stato, "ANNULLATA"),
        ),
      );
    if (existingCoverage)
      throw new FsePracticeImportError(
        409,
        "SALDO_GIA_PRESENTE",
        "La sorgente o il Magazzino possiedono già una copertura iniziale",
      );
    const [activeClaims] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(fseMovementClaimsTable)
      .where(
        and(
          eq(fseMovementClaimsTable.sourceRegistryId, session.sourceRegistryId),
          ne(fseMovementClaimsTable.stato, "RILASCIATA"),
        ),
      );
    if ((activeClaims?.count ?? 0) > 0)
      throw new FsePracticeImportError(
        409,
        "SORGENTE_GIA_PRESA_IN_CARICO",
        "La sorgente contiene già righe prese in carico o contabilizzate",
      );
    await tx.execute(sql`LOCK TABLE ${movimentiTable} IN SHARE MODE`);
    const [inventoryHistory] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(movimentiTable)
      .where(eq(movimentiTable.magazzinoId, session.magazzinoId));
    if ((inventoryHistory?.count ?? 0) > 0)
      throw new FsePracticeImportError(
        409,
        "MAGAZZINO_CON_STORIA",
        "Il Magazzino possiede già storia inventariale: il saldo può solo essere confrontato",
      );
    const reconciled = await assertInitialBalanceReconciliation(tx, session.id);
    registryForCoverage = reconciled.registry.filter(
      (row) => row.tipoMovimento === "CARICO",
    );
    if (
      reconciled.stock.some(
        (row) =>
          row.stato !== "PRONTO" ||
          row.prodottoId == null ||
          row.quantitaOperativa == null,
      )
    )
      throw new FsePracticeImportError(
        409,
        "SALDO_NON_PRONTO",
        "Tutte le righe Giacenze devono essere valide e associate",
      );
    workRows = reconciled.stock.map((row) => ({
      sourceId: row.id,
      productId: row.prodottoId!,
      fund: row.fondoOrigine as FondoOrigine,
      quantity: row.quantitaOperativa!,
      lot: row.lottoFisico,
      expiry: row.dataScadenza,
      factor: row.pesoUnita,
      document: null,
      documentDate: null,
      operationalDate: session.dataRiferimentoSaldo,
      operationalSource: "DATA_RIFERIMENTO_SALDO",
      identity: null,
      disambiguator: "",
      content: null,
      rawDescription: row.prodottoEsterno,
    }));
  } else {
    const [proposedCoverage] = await tx
      .select({ id: fseInitialBalanceCoverageTable.id })
      .from(fseInitialBalanceCoverageTable)
      .where(
        and(
          eq(
            fseInitialBalanceCoverageTable.sourceRegistryId,
            session.sourceRegistryId,
          ),
          eq(fseInitialBalanceCoverageTable.stato, "PROPOSTA"),
        ),
      );
    if (proposedCoverage)
      throw new FsePracticeImportError(
        409,
        "SALDO_INIZIALE_IN_CORSO",
        "Completa o annulla la proposta di saldo iniziale prima di nuovi carichi",
      );
    const ids = [...new Set(input.rowIds ?? [])];
    if (ids.length === 0)
      throw new FsePracticeImportError(
        400,
        "RIGHE_MANCANTI",
        "Seleziona almeno una riga pronta",
      );
    const rows = await tx
      .select()
      .from(fseImportRowsTable)
      .where(
        and(
          eq(fseImportRowsTable.sessioneId, session.id),
          inArray(fseImportRowsTable.id, ids),
        ),
      );
    if (
      rows.length !== ids.length ||
      rows.some(
        (row) =>
          row.stato !== "PRONTO" ||
          row.prodottoId == null ||
          row.quantitaOperativa == null,
      )
    )
      throw new FsePracticeImportError(
        409,
        "RIGHE_NON_PRONTE",
        "Una o più righe non sono pronte",
      );
    workRows = rows.map((row) => ({
      sourceId: row.id,
      productId: row.prodottoId!,
      fund: row.fondoOrigine as FondoOrigine,
      quantity: row.quantitaOperativa!,
      lot: row.lottoFisico,
      expiry: row.dataScadenza,
      factor: row.fattoreKgLtPezzo,
      document: row.numeroDocumento,
      documentDate: row.dataDocumento,
      operationalDate: row.dataOperativaProposta,
      operationalSource: row.dataOperativaFonte,
      identity: row.semanticIdentityHash,
      disambiguator: row.disambiguatore,
      content: row.movementContentHash,
      rawDescription: row.prodottoEsterno,
    }));
  }
  if (workRows.some((row) => !FONDI_ORIGINE.includes(row.fund)))
    throw new FsePracticeImportError(
      400,
      "FONDO_NON_VALIDO",
      "Una riga usa un fondo non valido",
    );
  const operationalDates = workRows
    .map((row) => row.operationalDate)
    .filter((value): value is string => Boolean(value));
  const practiceDate =
    session.modalita === "SALDO_INIZIALE"
      ? session.dataRiferimentoSaldo!
      : (operationalDates.sort()[0] ?? new Date().toISOString().slice(0, 10));
  if (!practice) {
    [practice] = await tx
      .insert(caricoPraticheTable)
      .values({
        codice: code(),
        stato: "bozza",
        areaOperativaId: session.areaOperativaId,
        magazzinoId: session.magazzinoId,
        lottoLogicoId: session.lottoLogicoId,
        origineCarico:
          session.modalita === "SALDO_INIZIALE"
            ? "SALDO_INIZIALE"
            : "AGEA_SIFEAD",
        tipoPratica:
          session.modalita === "SALDO_INIZIALE"
            ? "SALDO_INIZIALE"
            : "ORDINARIA",
        dataCarico: practiceDate,
        descrizione:
          session.modalita === "SALDO_INIZIALE"
            ? `Giacenza iniziale FSE+ al ${practiceDate}`
            : "Carichi da Registro FSE+",
        creatoDa: input.actorId,
        aggiornatoDa: input.actorId,
      })
      .returning();
  } else if (convertPractice) {
    [practice] = await tx
      .update(caricoPraticheTable)
      .set({
        origineCarico:
          session.modalita === "SALDO_INIZIALE"
            ? "SALDO_INIZIALE"
            : "AGEA_SIFEAD",
        tipoPratica:
          session.modalita === "SALDO_INIZIALE"
            ? "SALDO_INIZIALE"
            : "ORDINARIA",
        dataCarico: practiceDate,
        descrizione:
          session.modalita === "SALDO_INIZIALE"
            ? `Giacenza iniziale FSE+ al ${practiceDate}`
            : practice.descrizione,
        aggiornatoDa: input.actorId,
        dataAggiornamento: new Date(),
      })
      .where(eq(caricoPraticheTable.id, practice.id))
      .returning();
  }
  const createdRows: Array<typeof caricoPraticaRigheTable.$inferSelect> = [];
  for (const work of workRows) {
    const [created] = await tx
      .insert(caricoPraticaRigheTable)
      .values({
        caricoPraticaId: practice.id,
        clientId: `fse:${session.id}:${session.modalita}:${work.sourceId}`,
        prodottoId: work.productId,
        fondoOrigine: work.fund,
        quantita: work.quantity,
        codiceLottoProduttore: work.lot,
        dataScadenza: work.expiry,
        fattoreKgLtPezzo: work.factor,
        note: `Origine esterna: ${work.rawDescription}`,
        numeroDocumentoEsterno: work.document,
        dataDocumentoEsterna: work.documentDate,
        dataOperativaFonte: work.operationalSource,
        creatoDa: input.actorId,
        aggiornatoDa: input.actorId,
      })
      .returning();
    createdRows.push(created);
    if (session.modalita === "NUOVI_CARICHI") {
      const source = await tx
        .select()
        .from(fseImportRowsTable)
        .where(eq(fseImportRowsTable.id, work.sourceId));
      const accepted = source[0];
      const acceptedValues = {
        prodottoId: work.productId,
        fondoOrigine: work.fund,
        quantita: work.quantity,
        lottoFisico: work.lot,
        dataScadenza: work.expiry,
        numeroDocumento: work.document,
        dataDocumento: work.documentDate,
        dataOperativa: work.operationalDate,
      };
      const [revision] = await tx
        .insert(fseImportRowRevisionsTable)
        .values({
          rigaId: accepted.id,
          versione:
            (
              await tx
                .select({
                  maxVersion: sql<number>`coalesce(max(${fseImportRowRevisionsTable.versione}), 0)::int`,
                })
                .from(fseImportRowRevisionsTable)
                .where(eq(fseImportRowRevisionsTable.rigaId, accepted.id))
            )[0].maxVersion + 1,
          acceptedValuesJson: acceptedValues,
          revisionHash: hash(acceptedValues),
          motivo: "Aggiunta alla pratica M3A",
          creatoDa: input.actorId,
        })
        .returning();
      await tx.insert(fseMovementClaimsTable).values({
        sourceRegistryId: session.sourceRegistryId,
        semanticIdentityHash: work.identity!,
        disambiguatore: work.disambiguator,
        acceptedContentHash: work.content!,
        acceptedRevisionId: revision.id,
        caricoPraticaRigaId: created.id,
        magazzinoIdSnapshot: session.magazzinoId,
        stato: "RISERVATA",
      });
      await tx
        .update(fseImportRowsTable)
        .set({ stato: "GIA_NELLA_PRATICA", dataAggiornamento: new Date() })
        .where(eq(fseImportRowsTable.id, accepted.id));
    }
  }
  if (session.modalita === "SALDO_INIZIALE") {
    for (const row of registryForCoverage) {
      const acceptedValues = {
        coperturaSaldo: true,
        dataTaglio: session.dataRiferimentoSaldo,
      };
      const [revision] = await tx
        .insert(fseImportRowRevisionsTable)
        .values({
          rigaId: row.id,
          versione:
            (
              await tx
                .select({
                  maxVersion: sql<number>`coalesce(max(${fseImportRowRevisionsTable.versione}), 0)::int`,
                })
                .from(fseImportRowRevisionsTable)
                .where(eq(fseImportRowRevisionsTable.rigaId, row.id))
            )[0].maxVersion + 1,
          acceptedValuesJson: acceptedValues,
          revisionHash: hash(acceptedValues),
          motivo: "Proposta copertura saldo iniziale",
          creatoDa: input.actorId,
        })
        .returning();
      await tx.insert(fseMovementClaimsTable).values({
        sourceRegistryId: session.sourceRegistryId,
        semanticIdentityHash: row.semanticIdentityHash,
        disambiguatore: row.disambiguatore,
        acceptedContentHash: row.movementContentHash,
        acceptedRevisionId: revision.id,
        magazzinoIdSnapshot: session.magazzinoId,
        stato: "RISERVATA",
      });
    }
    await tx.insert(fseInitialBalanceCoverageTable).values({
      sourceRegistryId: session.sourceRegistryId,
      sessioneId: session.id,
      caricoPraticaId: practice.id,
      magazzinoId: session.magazzinoId,
      dataTaglio: session.dataRiferimentoSaldo!,
      stato: "PROPOSTA",
    });
  }
  const nextVersion = practice.versione + 1;
  await tx
    .update(caricoPraticheTable)
    .set({
      versione: nextVersion,
      aggiornatoDa: input.actorId,
      dataAggiornamento: new Date(),
    })
    .where(eq(caricoPraticheTable.id, practice.id));
  const attachResult = {
    practiceId: practice.id,
    practiceVersion: nextVersion,
    addedRows: createdRows.length,
  };
  await tx
    .update(fseImportSessionsTable)
    .set({
      caricoPraticaId: practice.id,
      stato: "IN_PRATICA",
      versione: session.versione + 1,
      coperturaConfermata:
        session.modalita === "SALDO_INIZIALE" ? 1 : session.coperturaConfermata,
      aggiornatoDa: input.actorId,
      dataAggiornamento: new Date(),
    })
    .where(eq(fseImportSessionsTable.id, session.id));
  await tx.insert(fseImportAttachCommandsTable).values({
    sessioneId: session.id,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    resultJson: attachResult,
    creatoDa: input.actorId,
  });
  await recordAuditEvent(tx, {
    command: input.audit,
    azione: "FSE_IMPORT_AGGIUNTO_PRATICA",
    entitaTipo: "fse_import_session",
    entitaId: session.id,
    documentoTipo: "carico_pratica",
    documentoId: practice.id,
    areaOperativaIdSnapshot: session.areaOperativaId,
    magazzinoIdSnapshot: session.magazzinoId,
    changes: auditFields(
      {
        praticaId: practice.id,
        numeroRighe: createdRows.length,
        modalita: session.modalita,
      },
      ["praticaId", "numeroRighe", "modalita"],
    ),
  });
  return { ...attachResult, replay: false };
}

export async function releaseFseClaimForPracticeRow(
  tx: InventoryTransaction,
  practiceRowId: number,
  context: { actorId: number; audit: AuditCommandContext },
) {
  const [claim] = await tx
    .select({
      id: fseMovementClaimsTable.id,
      revisionId: fseMovementClaimsTable.acceptedRevisionId,
    })
    .from(fseMovementClaimsTable)
    .where(
      and(
        eq(fseMovementClaimsTable.caricoPraticaRigaId, practiceRowId),
        eq(fseMovementClaimsTable.stato, "RISERVATA"),
      ),
    );
  if (!claim) return;
  await tx
    .update(fseMovementClaimsTable)
    .set({
      stato: "RILASCIATA",
      caricoPraticaRigaId: null,
      dataAggiornamento: new Date(),
    })
    .where(eq(fseMovementClaimsTable.id, claim.id));
  const [revision] = await tx
    .select({ rowId: fseImportRowRevisionsTable.rigaId })
    .from(fseImportRowRevisionsTable)
    .where(eq(fseImportRowRevisionsTable.id, claim.revisionId));
  if (!revision) return;
  const [source] = await tx
    .update(fseImportRowsTable)
    .set({ stato: "PRONTO", dataAggiornamento: new Date() })
    .where(eq(fseImportRowsTable.id, revision.rowId))
    .returning({
      id: fseImportRowsTable.id,
      sessionId: fseImportRowsTable.sessioneId,
    });
  if (source) {
    const session = await refreshSessionState(
      tx,
      source.sessionId,
      context.actorId,
    );
    await recordAuditEvent(tx, {
      command: context.audit,
      azione: "FSE_IMPORT_CLAIM_RILASCIATA",
      entitaTipo: "fse_movement_claim",
      entitaId: claim.id,
      documentoTipo: "carico_pratica_riga",
      documentoId: practiceRowId,
      areaOperativaIdSnapshot: session.areaOperativaId,
      magazzinoIdSnapshot: session.magazzinoId,
      changes: auditFields({ rigaImportId: source.id }, ["rigaImportId"]),
    });
  }
}

export async function blockLegacyAgeaWriter(
  tx: InventoryTransaction,
  warehouseId: number,
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended('fse-agea-writer-transition', 0))`,
  );
  const [warehouse] = await tx
    .select({ areaOperativaId: magazziniTable.areaOperativaId })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, warehouseId))
    .limit(1);
  if (!warehouse?.areaOperativaId) return;
  const [managed] = await tx
    .select({ id: fseSourceRegistriesTable.id })
    .from(fseSourceRegistriesTable)
    .where(
      and(
        eq(fseSourceRegistriesTable.areaOperativaId, warehouse.areaOperativaId),
        eq(fseSourceRegistriesTable.attiva, 1),
      ),
    )
    .limit(1);
  if (managed)
    throw new FsePracticeImportError(
      409,
      "SORGENTE_GESTITA_DA_M3B",
      "Questa sorgente usa il flusso Importa file FSE+ nella pratica Carico Merce",
    );
}

export function totalStockPieces(
  rows: Array<{ giacenzaPezzi: string | null }>,
) {
  return rows
    .reduce(
      (total, row) =>
        row.giacenzaPezzi == null
          ? total
          : total.add(InventoryDecimal.parse(row.giacenzaPezzi)),
      InventoryDecimal.zero(),
    )
    .toDb();
}
