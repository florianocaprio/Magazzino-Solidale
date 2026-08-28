import { randomInt } from "node:crypto";
import {
  areeOperativeTable,
  centriAscoltoTable,
  configurazioniMatricoleVolontariTable,
  db,
  matricoleVolontariTable,
  progressiviMatricoleVolontariTable,
  volontariTable,
} from "@workspace/db";
import { and, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import type { VolontariTx } from "./volontariOperational";

export const MATRICOLA_DUPLICATA_MSG =
  "La matricola indicata è già associata a un altro volontario.";
export const MATRICOLA_OBBLIGATORIA_MSG = "Matricola obbligatoria";
export const TEMPORARY_IDENTIFIER_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class VolunteerIdentifierError extends Error {
  constructor(
    public readonly code:
      | "CONFIGURAZIONE_MATRICOLA_ASSENTE"
      | "CODICE_AREA_MATRICOLA_ASSENTE"
      | "CENTRO_MATRICOLA_ASSENTE"
      | "MATRICOLA_PROGRESSIVO_ESAURITO"
      | "MATRICOLA_TEMPORANEA_NON_DISPONIBILE"
      | "PREVIEW_CONVERSIONE_SCADUTA",
    message: string,
  ) {
    super(message);
  }
}

export type MatricolaDuplicataPayload = {
  error: string;
  matricolaSuggerita?: string;
};

export type PermanentIdentifierConfig = Pick<
  typeof configurazioniMatricoleVolontariTable.$inferSelect,
  | "id"
  | "versione"
  | "prefissoAssociazione"
  | "includiCodiceArea"
  | "segmentoFisso"
  | "separatore"
  | "cifreProgressivo"
  | "numeroIniziale"
  | "ambitoProgressivo"
>;

export type PermanentIdentifierPreview = {
  matricola: string;
  matricolaNormalizzata: string;
  configurazioneId: number;
  configurazioneVersione: number;
  scopeKey: string;
  versioneProgressivo: number;
  prossimoNumero: number;
};

export function normalizeVolontarioMatricola(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() || undefined : undefined;
}

export function normalizeVolunteerIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

export function generateTemporaryVolunteerIdentifier(
  randomIndex: (maxExclusive: number) => number = (maxExclusive) =>
    randomInt(0, maxExclusive),
): string {
  const characters = Array.from({ length: 6 }, () =>
    TEMPORARY_IDENTIFIER_ALPHABET[randomIndex(TEMPORARY_IDENTIFIER_ALPHABET.length)],
  ).join("");
  return `${characters.slice(0, 3)}-${characters.slice(3)}`;
}

export function validatePermanentIdentifierConfiguration(input: {
  prefissoAssociazione?: unknown;
  includiCodiceArea?: unknown;
  segmentoFisso?: unknown;
  separatore?: unknown;
  cifreProgressivo?: unknown;
  numeroIniziale?: unknown;
  ambitoProgressivo?: unknown;
}) {
  const prefissoAssociazione =
    typeof input.prefissoAssociazione === "string"
      ? input.prefissoAssociazione.trim().toUpperCase() || null
      : null;
  const segmentoFisso =
    typeof input.segmentoFisso === "string"
      ? input.segmentoFisso.trim().toUpperCase() || null
      : null;
  const separatore = typeof input.separatore === "string" ? input.separatore : "-";
  const cifreProgressivo = Number(input.cifreProgressivo);
  const numeroIniziale = Number(input.numeroIniziale);
  const ambitoProgressivo = String(input.ambitoProgressivo ?? "PER_AREA").toUpperCase();
  if (prefissoAssociazione && !/^[A-Z0-9]{1,12}$/.test(prefissoAssociazione))
    throw new Error("Prefisso associazione non valido");
  if (segmentoFisso && !/^[A-Z0-9]{1,8}$/.test(segmentoFisso))
    throw new Error("Segmento fisso non valido");
  if (!["", "-", "/"].includes(separatore))
    throw new Error("Separatore non valido");
  if (!Number.isInteger(cifreProgressivo) || cifreProgressivo < 2 || cifreProgressivo > 8)
    throw new Error("Il numero di cifre deve essere compreso tra 2 e 8");
  if (!Number.isSafeInteger(numeroIniziale) || numeroIniziale <= 0)
    throw new Error("Il numero iniziale deve essere positivo");
  if (!["GLOBALE", "PER_AREA"].includes(ambitoProgressivo))
    throw new Error("Ambito progressivo non valido");
  return {
    prefissoAssociazione,
    includiCodiceArea: input.includiCodiceArea !== false,
    segmentoFisso,
    separatore,
    cifreProgressivo,
    numeroIniziale,
    ambitoProgressivo: ambitoProgressivo as "GLOBALE" | "PER_AREA",
  };
}

export function formatPermanentVolunteerIdentifier(
  config: PermanentIdentifierConfig,
  areaCode: string | null,
  progressivo: number,
): string {
  const parts = [
    config.prefissoAssociazione,
    config.includiCodiceArea ? areaCode : null,
    config.segmentoFisso,
    String(progressivo).padStart(config.cifreProgressivo, "0"),
  ].filter((part): part is string => Boolean(part));
  return parts.join(config.separatore);
}

async function activeConfiguration(executor: typeof db | VolontariTx) {
  const [config] = await executor
    .select()
    .from(configurazioniMatricoleVolontariTable)
    .where(
      and(
        eq(configurazioniMatricoleVolontariTable.scopeTipo, "GLOBALE"),
        eq(configurazioniMatricoleVolontariTable.attiva, true),
      ),
    )
    .orderBy(desc(configurazioniMatricoleVolontariTable.versione))
    .limit(1);
  if (!config)
    throw new VolunteerIdentifierError(
      "CONFIGURAZIONE_MATRICOLA_ASSENTE",
      "Configurazione matricole permanenti non disponibile",
    );
  return config;
}

async function identifierScope(
  executor: typeof db | VolontariTx,
  config: PermanentIdentifierConfig,
  centerId: number | null,
) {
  if (config.ambitoProgressivo === "GLOBALE" && !config.includiCodiceArea)
    return { scopeTipo: "GLOBALE" as const, scopeKey: "GLOBALE", areaId: null, areaCode: null };
  if (centerId == null)
    throw new VolunteerIdentifierError(
      "CENTRO_MATRICOLA_ASSENTE",
      "Seleziona un Centro associato a un'Area per generare la matricola",
    );
  const [center] = await executor
    .select({
      areaId: centriAscoltoTable.areaOperativaId,
      areaCode: areeOperativeTable.codiceMatricola,
      areaSigla: areeOperativeTable.sigla,
    })
    .from(centriAscoltoTable)
    .leftJoin(
      areeOperativeTable,
      eq(centriAscoltoTable.areaOperativaId, areeOperativeTable.id),
    )
    .where(eq(centriAscoltoTable.id, centerId));
  if (!center?.areaId)
    throw new VolunteerIdentifierError(
      "CODICE_AREA_MATRICOLA_ASSENTE",
      "Il Centro non è associato a un'Area operativa",
    );
  const areaCode = (center.areaCode ?? center.areaSigla)?.trim().toUpperCase() ?? null;
  if (config.includiCodiceArea && !areaCode)
    throw new VolunteerIdentifierError(
      "CODICE_AREA_MATRICOLA_ASSENTE",
      "Configura il codice matricola dell'Area operativa",
    );
  return config.ambitoProgressivo === "PER_AREA"
    ? {
        scopeTipo: "AREA" as const,
        scopeKey: `AREA:${center.areaId}`,
        areaId: center.areaId,
        areaCode,
      }
    : { scopeTipo: "GLOBALE" as const, scopeKey: "GLOBALE", areaId: center.areaId, areaCode };
}

async function nextAvailablePermanentIdentifier(
  executor: typeof db | VolontariTx,
  config: Awaited<ReturnType<typeof activeConfiguration>>,
  centerId: number | null,
) {
  const scope = await identifierScope(executor, config, centerId);
  const [counter] = await executor
    .select()
    .from(progressiviMatricoleVolontariTable)
    .where(
      and(
        eq(progressiviMatricoleVolontariTable.configurazioneId, config.id),
        eq(progressiviMatricoleVolontariTable.scopeKey, scope.scopeKey),
      ),
    );
  let number = counter ? counter.ultimoNumero + 1 : config.numeroIniziale;
  const max = 10 ** config.cifreProgressivo - 1;
  while (number <= max) {
    const matricola = formatPermanentVolunteerIdentifier(config, scope.areaCode, number);
    const normalized = normalizeVolunteerIdentifier(matricola);
    if (!normalized || matricola.length > 40)
      throw new Error("La configurazione produce una matricola non valida o troppo lunga");
    const [used] = await executor
      .select({ id: matricoleVolontariTable.id })
      .from(matricoleVolontariTable)
      .where(eq(matricoleVolontariTable.matricolaNormalizzata, normalized))
      .limit(1);
    if (!used)
      return { scope, counter, number, matricola, normalized };
    number += 1;
  }
  throw new VolunteerIdentifierError(
    "MATRICOLA_PROGRESSIVO_ESAURITO",
    "Progressivo matricole esaurito per l'ambito selezionato",
  );
}

export async function previewPermanentVolunteerIdentifier(
  centerId: number | null,
): Promise<PermanentIdentifierPreview> {
  const config = await activeConfiguration(db);
  const next = await nextAvailablePermanentIdentifier(db, config, centerId);
  return {
    matricola: next.matricola,
    matricolaNormalizzata: next.normalized,
    configurazioneId: config.id,
    configurazioneVersione: config.versione,
    scopeKey: next.scope.scopeKey,
    versioneProgressivo: next.counter?.versione ?? 0,
    prossimoNumero: next.number,
  };
}

async function closeActiveIdentifier(
  tx: VolontariTx,
  volunteerId: number,
  effectiveDate: string,
) {
  await tx
    .update(matricoleVolontariTable)
    .set({
      stato: "STORICA",
      dataFineValidita: sql`greatest(${matricoleVolontariTable.dataInizioValidita}, (${effectiveDate}::date - interval '1 day')::date)`,
    })
    .where(
      and(
        eq(matricoleVolontariTable.volontarioId, volunteerId),
        eq(matricoleVolontariTable.stato, "ATTIVA"),
      ),
    );
}

export async function assignTemporaryVolunteerIdentifier(
  tx: VolontariTx,
  volunteerId: number,
  effectiveDate: string,
  userId: number | null,
): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('volontari-identificativi'))`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const matricola = generateTemporaryVolunteerIdentifier();
    const normalized = normalizeVolunteerIdentifier(matricola)!;
    const [used] = await tx
      .select({ id: matricoleVolontariTable.id })
      .from(matricoleVolontariTable)
      .where(eq(matricoleVolontariTable.matricolaNormalizzata, normalized))
      .limit(1);
    if (used) continue;
    await closeActiveIdentifier(tx, volunteerId, effectiveDate);
    await tx.insert(matricoleVolontariTable).values({
      volontarioId: volunteerId,
      matricola,
      matricolaNormalizzata: normalized,
      tipoIdentificativo: "TEMPORANEA",
      stato: "ATTIVA",
      origine: "GENERATA",
      dataInizioValidita: effectiveDate,
      assegnataDa: userId,
      snapshotRegola: { alphabet: TEMPORARY_IDENTIFIER_ALPHABET, length: 6, display: "XXX-XXX" },
    });
    await tx.update(volontariTable).set({ matricola }).where(eq(volontariTable.id, volunteerId));
    return matricola;
  }
  throw new VolunteerIdentifierError(
    "MATRICOLA_TEMPORANEA_NON_DISPONIBILE",
    "Impossibile generare una matricola temporanea univoca",
  );
}

export async function assignPermanentVolunteerIdentifier(
  tx: VolontariTx,
  volunteerId: number,
  centerId: number | null,
  effectiveDate: string,
  userId: number | null,
  origin: "GENERATA" | "CONVERSIONE" = "GENERATA",
  expectedPreview?: PermanentIdentifierPreview,
): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('volontari-identificativi'))`);
  const config = await activeConfiguration(tx);
  const scope = await identifierScope(tx, config, centerId);
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('volontari-matricole'), hashtext(${`${config.id}:${scope.scopeKey}`}))`,
  );
  const next = await nextAvailablePermanentIdentifier(tx, config, centerId);
  if (
    expectedPreview &&
    (expectedPreview.configurazioneId !== config.id ||
      expectedPreview.configurazioneVersione !== config.versione ||
      expectedPreview.scopeKey !== scope.scopeKey ||
      expectedPreview.versioneProgressivo !== (next.counter?.versione ?? 0) ||
      expectedPreview.matricolaNormalizzata !== next.normalized)
  )
    throw new VolunteerIdentifierError(
      "PREVIEW_CONVERSIONE_SCADUTA",
      "La preview non è più attuale: rigenerala prima di confermare",
    );
  if (next.counter) {
    await tx
      .update(progressiviMatricoleVolontariTable)
      .set({
        ultimoNumero: next.number,
        versione: sql`${progressiviMatricoleVolontariTable.versione} + 1`,
        dataAggiornamento: new Date(),
      })
      .where(eq(progressiviMatricoleVolontariTable.id, next.counter.id));
  } else {
    await tx.insert(progressiviMatricoleVolontariTable).values({
      configurazioneId: config.id,
      scopeTipo: next.scope.scopeTipo,
      scopeKey: next.scope.scopeKey,
      areaOperativaId: next.scope.areaId,
      ultimoNumero: next.number,
    });
  }
  await closeActiveIdentifier(tx, volunteerId, effectiveDate);
  await tx.insert(matricoleVolontariTable).values({
    volontarioId: volunteerId,
    matricola: next.matricola,
    matricolaNormalizzata: next.normalized,
    tipoIdentificativo: "PERMANENTE",
    stato: "ATTIVA",
    origine: origin,
    dataInizioValidita: effectiveDate,
    assegnataDa: userId,
    configurazioneId: config.id,
    configurazioneVersione: config.versione,
    snapshotRegola: {
      prefissoAssociazione: config.prefissoAssociazione,
      includiCodiceArea: config.includiCodiceArea,
      segmentoFisso: config.segmentoFisso,
      separatore: config.separatore,
      cifreProgressivo: config.cifreProgressivo,
      ambitoProgressivo: config.ambitoProgressivo,
      scopeKey: next.scope.scopeKey,
      numero: next.number,
    },
  });
  await tx.update(volontariTable).set({ matricola: next.matricola }).where(eq(volontariTable.id, volunteerId));
  return next.matricola;
}

export async function registerImportedVolunteerIdentifier(
  tx: VolontariTx,
  volunteerId: number,
  matricola: string,
  tipo: "PERMANENTE" | "TEMPORANEO",
  effectiveDate: string,
  userId: number | null,
) {
  const normalized = normalizeVolunteerIdentifier(matricola);
  if (!normalized) throw new Error(MATRICOLA_OBBLIGATORIA_MSG);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('volontari-identificativi'))`);
  const [same] = await tx
    .select()
    .from(matricoleVolontariTable)
    .where(eq(matricoleVolontariTable.matricolaNormalizzata, normalized));
  if (same && same.volontarioId !== volunteerId) throw new Error("MATRICOLA_DUPLICATA");
  if (!same) {
    await closeActiveIdentifier(tx, volunteerId, effectiveDate);
    await tx.insert(matricoleVolontariTable).values({
      volontarioId: volunteerId,
      matricola,
      matricolaNormalizzata: normalized,
      tipoIdentificativo: tipo === "TEMPORANEO" ? "TEMPORANEA" : "PERMANENTE",
      stato: "ATTIVA",
      origine: "IMPORTATA",
      dataInizioValidita: effectiveDate,
      assegnataDa: userId,
      snapshotRegola: { origine: "IMPORT_VOLONTARI_2_0" },
    });
  }
}

export async function matricolaVolontarioGiaUsata(
  matricola: string,
  excludeId?: number,
): Promise<boolean> {
  const where =
    excludeId != null
      ? and(eq(volontariTable.matricola, matricola), ne(volontariTable.id, excludeId))
      : eq(volontariTable.matricola, matricola);
  const [existing] = await db
    .select({ id: volontariTable.id })
    .from(volontariTable)
    .where(where)
    .limit(1);
  return existing != null;
}

export async function suggerisciMatricolaVolontario(
  matricola: string,
  excludeId?: number,
): Promise<string | undefined> {
  const base = matricola.trim();
  if (!base) return undefined;
  const conditions: SQL[] = [
    or(eq(volontariTable.matricola, base), ilike(volontariTable.matricola, `${base}-%`))!,
  ];
  if (excludeId != null) conditions.push(ne(volontariTable.id, excludeId));
  const rows = await db
    .select({ matricola: volontariTable.matricola })
    .from(volontariTable)
    .where(and(...conditions));
  const used = new Set(rows.map((row) => row.matricola?.trim()).filter(Boolean));
  for (let index = 1; index <= 99; index += 1) {
    const candidate = `${base}-${String(index).padStart(2, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return undefined;
}

export async function matricolaVolontarioDuplicataPayload(
  matricola: string,
  excludeId?: number,
): Promise<MatricolaDuplicataPayload> {
  const matricolaSuggerita = await suggerisciMatricolaVolontario(matricola, excludeId);
  return {
    error: matricolaSuggerita
      ? `${MATRICOLA_DUPLICATA_MSG} Puoi usare ad esempio: ${matricolaSuggerita}.`
      : MATRICOLA_DUPLICATA_MSG,
    ...(matricolaSuggerita ? { matricolaSuggerita } : {}),
  };
}

export function isVolontarioMatricolaUniqueViolation(error: unknown): boolean {
  const value = postgresError(error);
  return (
    value?.code === "23505" &&
    (value.constraint === "volontari_matricola_unique" ||
      value.constraint === "matricole_volontari_normalizzata_unique" ||
      (value.detail?.includes("matricola") ?? false))
  );
}

export function isVolontarioCodiceFiscaleUniqueViolation(error: unknown): boolean {
  const value = postgresError(error);
  return (
    value?.code === "23505" &&
    (value.constraint === "volontari_codice_fiscale_norm_unique" ||
      (value.detail?.includes("codice_fiscale_normalizzato") ?? false))
  );
}

function postgresError(error: unknown):
  | { code?: string; constraint?: string; detail?: string }
  | null {
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== "object") return null;
    const candidate = current as {
      code?: string;
      constraint?: string;
      detail?: string;
      cause?: unknown;
    };
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}
