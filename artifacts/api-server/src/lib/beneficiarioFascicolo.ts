import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  db,
  fseFascicoliSocialiTable,
  fseFascicoliSocialiSnapshotTable,
} from "@workspace/db";
import { normalizeFseCode } from "./fseBeneficiari";
import { dataCivileEuropeRome } from "./interventiWorkflow";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class BeneficiarioFascicoloError extends Error {}
export async function readBeneficiarioFascicolo(id: number) {
  const [profile] = await db
    .select({
      fascicolo: fseFascicoliSocialiTable.codiceFascicolo,
      versioneFascicolo: fseFascicoliSocialiTable.versione,
    })
    .from(fseFascicoliSocialiTable)
    .where(eq(fseFascicoliSocialiTable.beneficiarioId, id));
  return profile ?? { fascicolo: null, versioneFascicolo: 0 };
}
/** Identity-only edit. Demography, provenance and imported hashes are preserved. */
export async function saveBeneficiarioFascicolo(
  tx: Tx,
  id: number,
  value: string | null,
  expectedVersion: number,
  userId: number | null,
) {
  const code = value?.trim() || null;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-beneficiary:${id}`}, 0))`,
  );
  const [observed] = await tx
    .select({ code: fseFascicoliSocialiTable.codiceFascicoloNormalizzato })
    .from(fseFascicoliSocialiTable)
    .where(eq(fseFascicoliSocialiTable.beneficiarioId, id));
  // Take source identity locks before profile/beneficiary row locks, like the importer.
  for (const key of [
    ...new Set(
      [observed?.code, normalizeFseCode(code)].filter(
        (value): value is string => Boolean(value),
      ),
    ),
  ].sort()) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-profile:${key}`}, 0))`,
    );
  }
  const [current] = await tx
    .select()
    .from(fseFascicoliSocialiTable)
    .where(eq(fseFascicoliSocialiTable.beneficiarioId, id))
    .for("update");
  if ((current?.versione ?? 0) !== expectedVersion)
    throw new BeneficiarioFascicoloError(
      "Il Fascicolo è stato modificato. Ricarica l’anagrafica e riprova.",
    );
  if (code) {
    const [assigned] = await tx
      .select({ beneficiarioId: fseFascicoliSocialiTable.beneficiarioId })
      .from(fseFascicoliSocialiTable)
      .where(
        eq(
          fseFascicoliSocialiTable.codiceFascicoloNormalizzato,
          normalizeFseCode(code)!,
        ),
      );
    if (assigned && assigned.beneficiarioId !== id)
      throw new BeneficiarioFascicoloError(
        "Fascicolo già associato a un altro beneficiario.",
      );
  }
  if ((current?.codiceFascicolo ?? null) === code) return;
  const dataRiferimento = dataCivileEuropeRome();
  const changes = {
    codiceFascicolo: code,
    codiceFascicoloNormalizzato: normalizeFseCode(code),
    versione: expectedVersion + 1,
    dataAggiornamento: new Date(),
  };
  const [profile] = current
    ? await tx
        .update(fseFascicoliSocialiTable)
        .set(changes)
        .where(eq(fseFascicoliSocialiTable.id, current.id))
        .returning()
    : await tx
        .insert(fseFascicoliSocialiTable)
        .values({
          beneficiarioId: id,
          ...changes,
          dataRiferimento,
          origineDato: "aggiornamento_manuale",
          attendibilitaDato: "operatore_verificato",
        })
        .returning();
  const snapshot = canonicalFseSnapshot({
    beneficiarioId: id,
    dataRiferimento,
    origineSnapshot: "aggiornamento_manuale",
    utenteId: userId,
    versioneProfilo: profile.versione,
    codiceFascicolo: code,
    numeroComponenti: profile.numeroComponentiImportato,
    donne: profile.donneImportate,
    uomini: profile.uominiImportati,
    eta017: profile.eta017Importata,
    eta1829: profile.eta1829Importata,
    eta3064: profile.eta3064Importata,
    eta65Plus: profile.eta65PlusImportata,
    origineStranieraMinoranze: profile.origineStranieraMinoranze,
    personeDisabilita: profile.personeDisabilita,
    cittadiniPaesiTerzi: profile.cittadiniPaesiTerzi,
    senzaTettoEsclusioneAbitativa: profile.senzaTettoEsclusioneAbitativa,
    tipologiaAttivita: profile.tipologiaAttivitaImportata,
    statoAttuale: profile.statoAttualeImportato,
    attendibilitaDato: "operatore_verificato",
    riferimentoSorgente: `beneficiario:${id}:fascicolo`,
    metadatiQualita: { modifica: "identificativo_fascicolo" },
  });
  // Returning to an earlier code on the same day is a distinct identity event.
  // Include its profile version so it cannot collide with a previous snapshot.
  await tx.insert(fseFascicoliSocialiSnapshotTable).values({
    ...snapshot,
    hashCanonico: createHash("sha256")
      .update(
        JSON.stringify({
          contenuto: snapshot.hashCanonico,
          versioneProfilo: profile.versione,
        }),
      )
      .digest("hex"),
  });
}
export type SnapshotOrigin =
  | "import_fse"
  | "aggiornamento_manuale"
  | "export_fse";

export function canonicalFseSnapshot(input: {
  beneficiarioId: number;
  dataRiferimento: string;
  origineSnapshot: SnapshotOrigin;
  importBatchId?: number | null;
  utenteId?: number | null;
  versioneProfilo: number;
  codiceFascicolo?: string | null;
  numeroComponenti?: number | null;
  donne?: number | null;
  uomini?: number | null;
  eta017?: number | null;
  eta1829?: number | null;
  eta3064?: number | null;
  eta65Plus?: number | null;
  origineStranieraMinoranze?: number | null;
  personeDisabilita?: number | null;
  cittadiniPaesiTerzi?: number | null;
  senzaTettoEsclusioneAbitativa?: number | null;
  tipologiaAttivita?: string | null;
  statoAttuale?: string | null;
  attendibilitaDato?: string | null;
  riferimentoSorgente?: string | null;
  metadatiQualita?: Record<string, unknown>;
}) {
  const content = {
    beneficiarioId: input.beneficiarioId,
    dataRiferimento: input.dataRiferimento,
    origineSnapshot: input.origineSnapshot,
    codiceFascicolo: input.codiceFascicolo ?? null,
    numeroComponenti: input.numeroComponenti ?? null,
    donne: input.donne ?? null,
    uomini: input.uomini ?? null,
    eta017: input.eta017 ?? null,
    eta1829: input.eta1829 ?? null,
    eta3064: input.eta3064 ?? null,
    eta65Plus: input.eta65Plus ?? null,
    origineStranieraMinoranze: input.origineStranieraMinoranze ?? null,
    personeDisabilita: input.personeDisabilita ?? null,
    cittadiniPaesiTerzi: input.cittadiniPaesiTerzi ?? null,
    senzaTettoEsclusioneAbitativa: input.senzaTettoEsclusioneAbitativa ?? null,
    tipologiaAttivita: input.tipologiaAttivita ?? null,
    statoAttuale: input.statoAttuale ?? null,
    attendibilitaDato: input.attendibilitaDato ?? null,
  };
  return {
    ...content,
    origineSnapshot: input.origineSnapshot,
    importBatchId: input.importBatchId ?? null,
    utenteId: input.utenteId ?? null,
    versioneProfilo: input.versioneProfilo,
    hashCanonico: createHash("sha256")
      .update(JSON.stringify(content))
      .digest("hex"),
    metadatiQualita: input.metadatiQualita ?? {},
    riferimentoSorgente: input.riferimentoSorgente ?? null,
  };
}
