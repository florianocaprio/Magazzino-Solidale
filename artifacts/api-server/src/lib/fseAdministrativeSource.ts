import {
  fseAdministrativeVersionsTable,
  fseAdministrativeFilesTable,
  fseAdministrativeObservationsTable,
  fseAdministrativeLineageTable,
  fseImportSessionsTable,
  fseImportFilesTable,
  fseImportRowsTable,
  fseImportStockRowsTable,
  fseImportRowRevisionsTable,
  fseMovementIdentityAliasesTable,
  fseMovementClaimsTable,
  fseInitialBalanceCoverageTable,
  mappatureProdottiEsterniTable,
  caricoPraticheTable,
  carichiMagazzinoRigheTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";
import { canonicalSha256, FseReportingError } from "./fseCanonicalReporting";
import { requireCurrentFseWarehouse } from "./fseAccess";
import { InventoryDecimal } from "./inventoryDecimal";
import { fseSemanticIdentityHash, parseFseDate } from "./fseImportParser";
import { normalizeAgeaKey } from "./ageaSifeadParser";
import type { ReconciliationExternalLine } from "./fseReconciliation";

export type AdministrativeValue = {
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
};
function text(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}
function decimal(value: unknown, quality: string[]): string | null {
  if (value == null || value === "") return null;
  try {
    return InventoryDecimal.parse(String(value), {
      allowNegative: true,
    }).toDb();
  } catch {
    quality.push("DATO_RAW_NON_INTERPRETABILE");
    return null;
  }
}
function count(value: unknown): number | null {
  const t = text(value);
  if (t == null) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Same source lock as mapping/revision/attach. M3A starts from the practice
 * (saldo also acquires the source lock). Therefore practice locks here are NOWAIT:
 * conflict, never a source→practice / practice→source deadlock or a blind retry.
 * No inventory writes occur here. */
export async function lockAdministrativeSource(
  tx: InventoryTransaction,
  input: { sessionId: number; warehouseId: number; actorId: number },
) {
  const [identity] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, input.sessionId));
  if (!identity || identity.magazzinoId !== input.warehouseId)
    throw new FseReportingError(404, "Fonte amministrativa non disponibile");
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-source:${identity.sourceRegistryId}`},0))`,
  );
  const related = await tx
    .select({ id: fseImportSessionsTable.caricoPraticaId })
    .from(fseImportSessionsTable)
    .where(
      eq(fseImportSessionsTable.sourceRegistryId, identity.sourceRegistryId),
    );
  const ids = [
    ...new Set(related.flatMap((r) => (r.id == null ? [] : [r.id]))),
  ].sort((a, b) => a - b);
  if (ids.length)
    await tx
      .select({ id: caricoPraticheTable.id })
      .from(caricoPraticheTable)
      .where(inArray(caricoPraticheTable.id, ids))
      .orderBy(caricoPraticheTable.id)
      .for("share", { noWait: true })
      .catch((error: unknown) => {
        const e = error as { code?: string; cause?: { code?: string } };
        if (e.code === "55P03" || e.cause?.code === "55P03")
          throw new FseReportingError(
            409,
            "Pratica in registrazione: riprovare il confronto dopo il completamento",
          );
        throw error;
      });
  const [session] = await tx
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, input.sessionId))
    .for("share");
  await requireCurrentFseWarehouse(
    tx,
    input.actorId,
    "magazzino.fse.reconcile",
    input.warehouseId,
  );
  if (
    !session ||
    session.magazzinoId !== input.warehouseId ||
    session.sourceRegistryId !== identity.sourceRegistryId
  )
    throw new FseReportingError(409, "Fonte non più disponibile");
  return session;
}

export async function freezeAdministrativeSource(
  tx: InventoryTransaction,
  input: {
    session: typeof fseImportSessionsTable.$inferSelect;
    expectedVersion: number;
    referenceDate: string;
    actorId: number;
  },
) {
  const { session } = input;
  if (session.stato === "ANNULLATA")
    throw new FseReportingError(409, "Fonte annullata");
  if (session.versione !== input.expectedVersion)
    throw new FseReportingError(
      409,
      "Versione della procedura modificata: rivedere la fonte prima di confermare",
    );
  const files = await tx
    .select()
    .from(fseImportFilesTable)
    .where(eq(fseImportFilesTable.sessioneId, session.id))
    .orderBy(fseImportFilesTable.id);
  if (
    !files.length ||
    files.filter((f) => f.profilo === "REGISTRO").length !== 1 ||
    files.some((f) => f.dataRiferimento !== input.referenceDate)
  )
    throw new FseReportingError(
      409,
      "Fonte ambigua o data di riferimento non coerente con i file",
    );
  if (files.filter((f) => f.profilo === "GIACENZE").length > 1)
    throw new FseReportingError(
      409,
      "Più versioni Giacenze nella stessa fonte: selezione non dimostrabile",
    );
  const rows = await tx
    .select()
    .from(fseImportRowsTable)
    .where(eq(fseImportRowsTable.sessioneId, session.id))
    .orderBy(fseImportRowsTable.id);
  const stock = await tx
    .select()
    .from(fseImportStockRowsTable)
    .where(eq(fseImportStockRowsTable.sessioneId, session.id))
    .orderBy(fseImportStockRowsTable.id);
  const revisions = rows.length
    ? await tx
        .select()
        .from(fseImportRowRevisionsTable)
        .where(
          inArray(
            fseImportRowRevisionsTable.rigaId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(fseImportRowRevisionsTable.id)
    : [];
  const mappings = await tx
    .select()
    .from(mappatureProdottiEsterniTable)
    .where(
      eq(
        mappatureProdottiEsterniTable.sourceRegistryId,
        session.sourceRegistryId,
      ),
    )
    .orderBy(mappatureProdottiEsterniTable.id);
  const aliases = await tx
    .select()
    .from(fseMovementIdentityAliasesTable)
    .where(
      eq(
        fseMovementIdentityAliasesTable.sourceRegistryId,
        session.sourceRegistryId,
      ),
    )
    .orderBy(fseMovementIdentityAliasesTable.id);
  const claims = await tx
    .select({
      claim: fseMovementClaimsTable,
      load: carichiMagazzinoRigheTable,
      acceptedRowId: fseImportRowRevisionsTable.rigaId,
    })
    .from(fseMovementClaimsTable)
    .innerJoin(
      fseImportRowRevisionsTable,
      eq(
        fseMovementClaimsTable.acceptedRevisionId,
        fseImportRowRevisionsTable.id,
      ),
    )
    .leftJoin(
      carichiMagazzinoRigheTable,
      eq(
        fseMovementClaimsTable.caricoMagazzinoRigaId,
        carichiMagazzinoRigheTable.id,
      ),
    )
    .where(
      and(
        eq(fseMovementClaimsTable.sourceRegistryId, session.sourceRegistryId),
        eq(fseMovementClaimsTable.magazzinoIdSnapshot, session.magazzinoId),
      ),
    )
    .orderBy(fseMovementClaimsTable.id);
  const coverage = await tx
    .select()
    .from(fseInitialBalanceCoverageTable)
    .where(
      and(
        eq(
          fseInitialBalanceCoverageTable.sourceRegistryId,
          session.sourceRegistryId,
        ),
        eq(fseInitialBalanceCoverageTable.magazzinoId, session.magazzinoId),
        eq(fseInitialBalanceCoverageTable.stato, "ATTIVA"),
      ),
    );
  const occurrences = new Map<string, number>();
  const identities = new Map<number, string>();
  const identityRows = new Map<string, number[]>();
  for (const row of rows) {
    const raw = row.rawJson;
    const originalIdentity = fseSemanticIdentityHash({
      fondo: row.fondoOrigine,
      prodotto: row.prodottoNormalizzato,
      numeroDocumento: normalizeAgeaKey(text(raw["Numero documento"])),
      dataDocumento: parseFseDate(text(raw["Data documento"])),
      lotto: normalizeAgeaKey(text(raw.Lotto)),
      natura: row.tipoMovimento,
      mittenteDestinatario: normalizeAgeaKey(
        text(raw["Mittente / destinatario"]),
      ),
    });
    const identity =
      aliases.find(
        (a) =>
          (a.semanticIdentityHash === originalIdentity ||
            a.semanticIdentityHash === row.semanticIdentityHash) &&
          a.disambiguatore === row.disambiguatore,
      )?.canonicalIdentityHash ?? originalIdentity;
    identities.set(row.id, identity);
    const key = `${identity}:${row.disambiguatore}`;
    const group = identityRows.get(key) ?? [];
    group.push(row.id);
    identityRows.set(key, group);
  }
  const observations = rows.map((row) => {
    const quality = [...row.errorCodesJson, ...row.warningCodesJson];
    const raw = row.rawJson;
    const rawDate =
      parseFseDate(text(raw["Data carico magazzino"])) ??
      parseFseDate(text(raw["Data documento"]));
    const identity = identities.get(row.id)!;
    const revision = revisions.filter((r) => r.rigaId === row.id).at(-1);
    const mapping = mappings.find(
      (m) =>
        m.attiva &&
        m.chiaveDescrizioneNormalizzata === row.prodottoNormalizzato &&
        (row.prodottoId == null || m.prodottoId === row.prodottoId),
    );
    const productId = row.prodottoId ?? mapping?.prodottoId ?? null;
    const original: AdministrativeValue = {
      type: row.tipoMovimento,
      fund: row.fondoOrigine,
      productId,
      lot: normalizeAgeaKey(text(raw.Lotto)),
      date: rawDate,
      pieces: decimal(raw["Carico / scarico pezzi"], quality),
      kgLt: decimal(raw["Carico / scarico"], quality),
      channel: normalizeAgeaKey(text(raw["Attività"])),
      packs: count(raw.Pacchi),
      meals: count(raw.Pasti),
      occasional: count(raw["Indigenti saltuari"]),
      continuous: count(raw["Indigenti continuativi"]),
    };
    const interpreted: AdministrativeValue = {
      ...original,
      lot: normalizeAgeaKey(row.lottoFisico),
      date: row.dataOperativaProposta ?? row.dataDocumento,
      pieces: decimal(row.quantitaPezzi, quality),
      kgLt: decimal(row.quantitaKgLt, quality),
    };
    if (!productId) quality.push("PRODOTTO_NON_MAPPATO");
    if (row.stato === "ESCLUSA") quality.push("RIGA_ESCLUSA");
    if (canonicalSha256(original) !== canonicalSha256(interpreted))
      quality.push("CORREZIONE_INTENZIONALE");
    const key = `${identity}:${row.disambiguatore}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const candidates = claims.filter(
      ({ claim }) =>
        claim.semanticIdentityHash === identity &&
        claim.disambiguatore === row.disambiguatore &&
        claim.stato !== "RILASCIATA",
    );
    const group = identityRows.get(key)!;
    // The accepted revision proves the exact occurrence when present. Across
    // cumulative files identity is sufficient only for a unique occurrence.
    const proven = candidates.filter(
      ({ acceptedRowId }) =>
        acceptedRowId === row.id ||
        (group.length === 1 && !identities.has(acceptedRowId)),
    );
    if (proven.length !== candidates.length) quality.push("LINEAGE_AMBIGUO");
    const lineage = proven.map(({ claim, load }) => ({
      claimId: claim.id,
      loadRowId: load?.id ?? null,
      claimState: claim.stato,
      pieces: load?.quantitaPezzi ?? null,
      kgLt: load?.quantitaKgLt ?? null,
    }));
    // Coverage is an explicit claim, not an inference from date or session mode.
    const absorbed =
      lineage.some((l) => l.claimState === "COPERTA_SALDO") &&
      coverage.some(
        (c) =>
          row.dataOperativaProposta != null &&
          row.dataOperativaProposta <= c.dataTaglio,
      );
    return {
      rowId: row.id,
      stockRowId: null,
      revisionId: revision?.id ?? null,
      fileId: row.fileId,
      identityHash: identity,
      occurrence,
      rawHash: canonicalSha256(raw),
      originalJson: original,
      interpretedJson: {
        ...interpreted,
        baselineAbsorbed: absorbed,
        disambiguator: row.disambiguatore,
        balancePieces: row.saldoFinalePezzi,
        balanceKgLt: row.saldoFinaleKgLt,
      },
      qualityJson: [...new Set(quality)],
      revisionHash: revision?.revisionHash ?? null,
      revisionTrail: revisions
        .filter((r) => r.rigaId === row.id)
        .map((r) => ({ id: r.id, version: r.versione, hash: r.revisionHash })),
      mapping: mapping
        ? {
            id: mapping.id,
            version: mapping.versione,
            productId: mapping.prodottoId,
          }
        : null,
      lineage,
    };
  });
  const stockObservations = stock.map((row) => ({
    rowId: null,
    stockRowId: row.id,
    revisionId: null,
    fileId: row.fileId,
    identityHash: row.balanceKey,
    occurrence: 1,
    rawHash: canonicalSha256(row.rawJson),
    originalJson: {
      fund: row.fondoOrigine,
      lot: normalizeAgeaKey(text(row.rawJson.Lotto)),
      pieces: decimal(row.rawJson.GiacenzaPezzi, []),
      kgLt: decimal(row.rawJson.GiacenzaPesoVolume, []),
      unit: row.unitaMisuraPeso,
    },
    interpretedJson: {
      type: "SALDO_PARTITA",
      fund: row.fondoOrigine,
      productId:
        row.prodottoId ??
        mappings.find(
          (m) =>
            m.attiva &&
            m.chiaveDescrizioneNormalizzata === row.prodottoNormalizzato,
        )?.prodottoId ??
        null,
      lot: row.lottoFisico,
      pieces: row.giacenzaPezzi,
      kgLt: row.giacenzaPesoVolume,
      unit: row.unitaMisuraPeso,
    },
    qualityJson: [...row.errorCodesJson, ...row.warningCodesJson],
    revisionHash: null,
    mapping: (() => {
      const mapping = mappings.find(
        (m) =>
          m.attiva &&
          m.chiaveDescrizioneNormalizzata === row.prodottoNormalizzato &&
          (row.prodottoId == null || m.prodottoId === row.prodottoId),
      );
      return mapping
        ? {
            id: mapping.id,
            version: mapping.versione,
            productId: mapping.prodottoId,
          }
        : null;
    })(),
    lineage: [],
  }));
  const manifest = {
    model: "M64_ADMIN_V1",
    sourceRegistryId: session.sourceRegistryId,
    sessionId: session.id,
    sessionVersion: session.versione,
    magazzinoId: session.magazzinoId,
    referenceDate: input.referenceDate,
    mode: session.modalita,
    files: files.map((f) => ({
      id: f.id,
      role: f.profilo,
      sha256: f.sha256File,
      parserVersion: f.parserVersion,
      referenceDate: f.dataRiferimento,
    })),
    observations: [...observations, ...stockObservations],
  };
  const manifestHash = canonicalSha256(manifest);
  const [existing] = await tx
    .select()
    .from(fseAdministrativeVersionsTable)
    .where(
      and(
        eq(fseAdministrativeVersionsTable.sessionId, session.id),
        eq(fseAdministrativeVersionsTable.manifestHash, manifestHash),
      ),
    );
  if (existing) return existing;
  const [version] = await tx
    .insert(fseAdministrativeVersionsTable)
    .values({
      sourceRegistryId: session.sourceRegistryId,
      sessionId: session.id,
      sessionVersion: session.versione,
      magazzinoId: session.magazzinoId,
      referenceDate: input.referenceDate,
      mode: session.modalita,
      manifestHash,
      manifestJson: manifest,
      creatoDa: input.actorId,
    })
    .returning();
  const persistedFiles = await tx
    .insert(fseAdministrativeFilesTable)
    .values(
      files.map((f) => ({
        versionId: version.id,
        fileId: f.id,
        role: f.profilo,
        fileHash: f.sha256File,
      })),
    )
    .returning();
  for (const {
    lineage,
    fileId,
    revisionHash: _revisionHash,
    mapping: _mapping,
    ...observation
  } of [...observations, ...stockObservations]) {
    const [saved] = await tx
      .insert(fseAdministrativeObservationsTable)
      .values({
        ...observation,
        versionId: version.id,
        sourceFileId: persistedFiles.find((f) => f.fileId === fileId)!.id,
        contentHash: canonicalSha256(observation),
      })
      .returning();
    if (lineage.length)
      await tx.insert(fseAdministrativeLineageTable).values(
        lineage.map((l) => ({
          ...l,
          observationId: saved.id,
          versionId: version.id,
        })),
      );
  }
  return version;
}

export async function loadAdministrativeLines(
  tx: InventoryTransaction,
  versionId: number,
): Promise<ReconciliationExternalLine[]> {
  const observations = await tx
    .select()
    .from(fseAdministrativeObservationsTable)
    .where(eq(fseAdministrativeObservationsTable.versionId, versionId))
    .orderBy(fseAdministrativeObservationsTable.id);
  const lineage = observations.length
    ? await tx
        .select()
        .from(fseAdministrativeLineageTable)
        .where(
          inArray(
            fseAdministrativeLineageTable.observationId,
            observations.map((o) => o.id),
          ),
        )
    : [];
  return observations
    .filter((o) => o.rowId != null)
    .map((o) => {
      const value = o.interpretedJson as AdministrativeValue & {
        baselineAbsorbed: boolean;
        disambiguator?: string;
      };
      const portions = lineage.filter(
        (l) => l.observationId === o.id && l.loadRowId != null,
      );
      return {
        ...value,
        importRowId: o.id,
        observationId: o.id,
        identityHash: `${o.identityHash}:${value.disambiguator ?? ""}`,
        originalComparisonHash: canonicalSha256(o.originalJson),
        externalMovementId: null,
        caricoMagazzinoRigaId:
          portions.length === 1 ? portions[0].loadRowId : null,
        modified: o.qualityJson.includes("CORREZIONE_INTENZIONALE"),
        qualityCodes: o.qualityJson,
        baselineAbsorbed: value.baselineAbsorbed,
      };
    });
}
