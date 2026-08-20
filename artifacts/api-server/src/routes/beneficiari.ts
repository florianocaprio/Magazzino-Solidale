import { randomInt } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { auditConfigurazioniTable, beneficiariTable, nucleoFamiliareTable, interventiTable, bisogniPianificatiTable, consegneTable, centriAscoltoTable, areeOperativeTable, magazziniTable, tessereBeneficiariTable, zoneUdsTable } from "@workspace/db";
import { db } from "@workspace/db";
import { calcolaEta, isFasciaEtaPresunta, risolviFasciaEta } from "@workspace/api-zod";
import { runBulk } from "../lib/bulk";
import { eq, and, or, ilike, inArray, isNull, sql, desc, ne, type SQL } from "drizzle-orm";
import { dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  centroScopeFilter,
  areaOperativaScopeFilter,
  zonaUdsScopeFilter,
  canAccessCentro,
  canAccessAreaOperativa,
  canAccessZonaUds,
  beneficiarioCentroId,
  beneficiarioAreaOperativaId,
  beneficiarioZonaUdsId,
} from "../lib/centroScope";
import {
  EMPORIO_DISABLED_MSG,
  UNITA_STRADA_DISABLED_MSG,
  isEmporioEnabled,
  isUnitaStradaEnabled,
} from "../lib/impostazioniModuli";
import { searchBeneficiariDuplicates } from "../lib/beneficiarioDuplicates";
import { formatTesseraBeneficiario, issueTesseraBeneficiario, TesseraBeneficiarioError } from "../lib/tesseraBeneficiarioService";
import { requirePermission } from "../middlewares/auth";
import {
  canAccessBeneficiarioRecord,
  hasPermission,
  validateBeneficiarioTerritorialAssignment,
  visibleInterventoAmbiti,
} from "../lib/beneficiarioPolicy";
import {
  CreateBeneficiarioInput,
  AuthorizeBeneficiariExportInput,
  NucleoFamiliareInput,
  NucleoFamiliareUpdateInput,
  UpdateBeneficiarioInput,
  UpdateBeneficiarioStatusInput,
  normalizeCodiceFiscale,
  validateBeneficiarioCompleto,
  zodErrorMessage,
} from "../lib/beneficiarioValidation";

const router: IRouter = Router();

const SOCIAL_SENSITIVE_FIELDS = new Set([
  "restrizioniAlimentari",
  "allergie",
  "notePaccoAlimentare",
  "noteInterne",
  "numFigliMaschi",
  "numFiglieFemmine",
  "numDisabili",
]);

import { DATA_NASCITA_FUTURA_MSG, hasFutureBirthDate } from "../lib/bug5Validation";

const CODICE_BENEFICIARIO_DUPLICATO_MSG = "Il codice beneficiario indicato è già associato a un altro beneficiario.";
const SESSO_OBBLIGATORIO_MSG = "Il campo Sesso è obbligatorio.";
const DATA_NASCITA_NON_VALIDA_MSG = "La data di nascita non è valida. Usa il formato AAAA-MM-GG.";
const FASCIA_ETA_PRESUNTA_NON_VALIDA_MSG = "La fascia d'età presunta selezionata non è valida.";
const CREDITO_SOLIDALE_CENTRO_ASCOLTO_RICHIESTO_MSG =
  "ATTENZIONE: il beneficiario non ha un Centro di Ascolto assegnato. Non è possibile assegnare Credito Solidale.";
const STATI_CREDITO_SOLIDALE = ["non_abilitato", "attivo", "sospeso", "revocato"] as const;
type CreditoSolidaleStato = (typeof STATI_CREDITO_SOLIDALE)[number];

// Normalize a loosely-typed body flag to a real boolean so the Area boundary
// guard checks the same value that gets persisted (avoids `uds:"true"` /
// `uds:1` type-confusion bypasses on the unvalidated body).
function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === "t" || v === "1" || v === 1 || v === "yes";
}

function toOptionalBool(v: unknown): boolean | null {
  if (v == null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "number" && (v === 0 || v === 1)) return Boolean(v);
  if (typeof v === "string") {
    const normalized = v.trim().toLowerCase();
    if (["si", "sì", "true", "t", "1", "yes", "y", "vero"].includes(normalized)) return true;
    if (["no", "false", "f", "0", "n", "falso"].includes(normalized)) return false;
  }
  return null;
}

const trimOrUndefined = (v: unknown): string | undefined =>
  typeof v === "string" ? v.trim() || undefined : undefined;

const nullableText = (v: unknown): string | null =>
  typeof v === "string" ? v.trim() || null : v == null ? null : String(v);

function parseCreditoSolidaleStato(v: unknown): CreditoSolidaleStato | null {
  return typeof v === "string" && STATI_CREDITO_SOLIDALE.includes(v as CreditoSolidaleStato)
    ? (v as CreditoSolidaleStato)
    : null;
}

function parseDateTime(v: unknown): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseNonNegativeDecimal(v: unknown, label: string): { value: string | null; number: number | null } | { error: string } {
  if (v == null || v === "") return { value: null, number: null };
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return { error: `${label} non può essere negativo.` };
  const rounded = Math.round(n * 100) / 100;
  return { value: rounded.toFixed(2), number: rounded };
}

function sameNullableDecimal(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.round(Number(a) * 100) === Math.round(Number(b) * 100);
}

const normalizzaSesso = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const sesso = v.trim().toUpperCase();
  if (sesso === "M" || sesso === "MASCHIO") return "M";
  if (sesso === "F" || sesso === "FEMMINA") return "F";
  if (sesso === "ALTRO") return "ALTRO";
  return undefined;
};

const ANAGRAFICA_BENEFICIARIO_PATCH_KEYS = new Set([
  "codice",
  "codiceFiscale",
  "cognome",
  "nome",
  "soprannome",
  "dataNascita",
  "fasciaEtaPresunta",
  "sesso",
  "cittadinanza",
  "areaProvenienza",
  "residenza",
  "domicilio",
  "comune",
  "zonaMunicipio",
  "telefono",
  "email",
  "statoCivile",
  "numComponenti",
  "numFigliMaschi",
  "numFiglieFemmine",
  "numMinori",
  "numAnziani",
  "numDisabili",
  "restrizioniAlimentari",
  "allergie",
  "notePaccoAlimentare",
  "priorita",
  "consegnaDomicilio",
  "motivoConsegnaDomicilio",
]);

const isAnagraficaBeneficiarioPatch = (updates: Record<string, unknown>): boolean =>
  Object.keys(updates).some((key) => ANAGRAFICA_BENEFICIARIO_PATCH_KEYS.has(key));

function normalizeEtaFields(
  values: Record<string, unknown>,
  source: Record<string, unknown>,
): { error?: string } {
  delete values.fasciaEtaCorrente;
  delete values.fasciaEtaOrigine;

  if ("dataNascita" in source) {
    const raw = source.dataNascita;
    if (raw == null || raw === "") {
      values.dataNascita = null;
    } else if (typeof raw !== "string" || calcolaEta(raw) == null) {
      return { error: hasFutureBirthDate(raw) ? DATA_NASCITA_FUTURA_MSG : DATA_NASCITA_NON_VALIDA_MSG };
    } else {
      values.dataNascita = raw;
    }
  }

  if ("fasciaEtaPresunta" in source) {
    const raw = source.fasciaEtaPresunta;
    if (raw == null || raw === "") {
      values.fasciaEtaPresunta = null;
    } else if (!isFasciaEtaPresunta(raw)) {
      return { error: FASCIA_ETA_PRESUNTA_NON_VALIDA_MSG };
    } else {
      values.fasciaEtaPresunta = raw;
    }
  }
  return {};
}

async function codiceBeneficiarioEsiste(codice: string, excludeId?: number): Promise<boolean> {
  const where = excludeId != null
    ? and(eq(beneficiariTable.codice, codice), ne(beneficiariTable.id, excludeId))
    : eq(beneficiariTable.codice, codice);
  const [hit] = await db.select({ id: beneficiariTable.id }).from(beneficiariTable).where(where).limit(1);
  return hit != null;
}

async function generaCodiceBeneficiario(): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const codice = `BEN-${String(randomInt(0, 10_000_000_000_000)).padStart(13, "0")}`;
    if (!(await codiceBeneficiarioEsiste(codice))) return codice;
  }
  throw new Error("Impossibile generare un codice beneficiario univoco");
}

function isCodiceBeneficiarioUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; detail?: string } | null | undefined;
  return e?.code === "23505"
    && (e.constraint === "beneficiari_codice_unique" || (e.detail?.includes("codice") ?? false));
}

function normalizeCreditoSolidaleFields(
  values: Record<string, unknown>,
  source: Record<string, unknown>,
  existing?: typeof beneficiariTable.$inferSelect,
): { error?: string } {
  const hasAbilitato = "creditoSolidaleAbilitato" in source;
  const hasStato = "creditoSolidaleStato" in source;
  const hasData = "creditoSolidaleDataAbilitazione" in source;
  const hasNote = "creditoSolidaleNote" in source;

  let enabled = existing?.creditoSolidaleAbilitato ?? false;
  if (hasAbilitato) {
    const parsed = toOptionalBool(source.creditoSolidaleAbilitato);
    if (parsed == null) return { error: "Abilitazione Credito Solidale non valida." };
    enabled = parsed;
    values.creditoSolidaleAbilitato = parsed;
  } else if (!existing) {
    values.creditoSolidaleAbilitato = false;
  }

  if (hasStato) {
    const stato = parseCreditoSolidaleStato(source.creditoSolidaleStato);
    if (!stato) return { error: "Stato Credito Solidale non valido." };
    values.creditoSolidaleStato = stato;
  }

  if (!enabled) {
    if (!existing || hasAbilitato || hasStato) values.creditoSolidaleStato = "non_abilitato";
  } else if (!hasStato || values.creditoSolidaleStato === "non_abilitato") {
    values.creditoSolidaleStato = "attivo";
  }

  if (hasData) {
    const dataAbilitazione = parseDateTime(source.creditoSolidaleDataAbilitazione);
    if (source.creditoSolidaleDataAbilitazione != null && source.creditoSolidaleDataAbilitazione !== "" && !dataAbilitazione) {
      return { error: "Data abilitazione Credito Solidale non valida." };
    }
    values.creditoSolidaleDataAbilitazione = dataAbilitazione;
  }

  if (enabled && (!existing || !existing.creditoSolidaleAbilitato) && !existing?.creditoSolidaleDataAbilitazione && !values.creditoSolidaleDataAbilitazione) {
    values.creditoSolidaleDataAbilitazione = new Date();
  }
  if (!enabled && existing?.creditoSolidaleDataAbilitazione && values.creditoSolidaleDataAbilitazione == null) {
    delete values.creditoSolidaleDataAbilitazione;
  }

  if (hasNote) values.creditoSolidaleNote = nullableText(source.creditoSolidaleNote);
  return {};
}

function normalizeCreditoSolidaleQuotaFields(
  values: Record<string, unknown>,
  source: Record<string, unknown>,
  existing?: typeof beneficiariTable.$inferSelect,
): { error?: string; quotaChanged: boolean; motivoChanged: boolean } {
  const hasAssegnato = "creditoSolidaleMensileAssegnato" in source;
  const hasMotivo = "creditoSolidaleMotivoModifica" in source;
  const hasSuggerito = "creditoSolidaleMensileSuggerito" in source;
  let quotaChanged = false;
  let motivoChanged = false;
  delete values.creditoSolidaleMensileSuggerito;
  delete values.creditoSolidaleDataUltimaModificaQuota;
  if (!hasAssegnato) delete values.creditoSolidaleMensileManuale;

  if (hasAssegnato) {
    const assegnato = parseNonNegativeDecimal(source.creditoSolidaleMensileAssegnato, "Credito mensile assegnato");
    if ("error" in assegnato) return { error: assegnato.error, quotaChanged, motivoChanged };
    quotaChanged = !sameNullableDecimal(assegnato.value, existing?.creditoSolidaleMensileAssegnato ?? null);
    values.creditoSolidaleMensileAssegnato = assegnato.value;
    values.creditoSolidaleDataUltimaModificaQuota = quotaChanged
      ? new Date()
      : existing?.creditoSolidaleDataUltimaModificaQuota ?? null;

    let manuale = existing?.creditoSolidaleMensileManuale ?? false;
    if (assegnato.number == null) {
      manuale = false;
    } else if (hasSuggerito) {
      const suggerito = parseNonNegativeDecimal(source.creditoSolidaleMensileSuggerito, "Credito mensile suggerito");
      if ("error" in suggerito) return { error: suggerito.error, quotaChanged, motivoChanged };
      manuale = suggerito.number != null && !sameNullableDecimal(assegnato.number, suggerito.number);
    }
    values.creditoSolidaleMensileManuale = manuale;
  }

  if (hasMotivo) {
    const motivo = nullableText(source.creditoSolidaleMotivoModifica);
    motivoChanged = motivo !== (existing?.creditoSolidaleMotivoModifica ?? null);
    values.creditoSolidaleMotivoModifica = motivo;
  }

  return { quotaChanged, motivoChanged };
}

async function validateMagazzinoEmporioPreferito(
  id: unknown,
  req: Request,
): Promise<{ value: number | null } | { error: string; status?: number }> {
  if (id == null || id === "") return { value: null };
  const magazzinoId = typeof id === "number" ? id : Number(id);
  if (!Number.isInteger(magazzinoId)) return { error: "Emporio di riferimento non valido." };
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, magazzinoId));
  if (!magazzino) return { error: "Emporio di riferimento non trovato.", status: 404 };
  if (!canAccessCentro(magazzino.centroAscoltoId, callerCentroId(req))) {
    return { error: "Risorsa non accessibile per il tuo centro", status: 403 };
  }
  if (!canAccessAreaOperativa(magazzino.areaOperativaId, callerAreaOperativaId(req))) {
    return { error: "Risorsa non accessibile per la tua Area", status: 403 };
  }
  if (magazzino.tipoMagazzino !== "emporio" && magazzino.tipoMagazzino !== "misto") {
    return { error: "Il magazzino selezionato non è un Emporio Solidale." };
  }
  return { value: magazzinoId };
}

async function magazzinoEmporioNomeOf(id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const [m] = await db.select({ nome: magazziniTable.nome }).from(magazziniTable).where(eq(magazziniTable.id, id));
  return m?.nome ?? null;
}

function fmtBenef(
  r: typeof beneficiariTable.$inferSelect,
  centroNome?: string | null,
  areaOperativaNome?: string | null,
  magazzinoEmporioPreferitoNome?: string | null,
) {
  const fasciaEta = risolviFasciaEta(r.dataNascita, r.fasciaEtaPresunta);
  return {
    id: r.id,
    codice: r.codice,
    codiceFiscale: r.codiceFiscale ?? null,
    statoAnagrafica: r.statoAnagrafica,
    soprannome: r.soprannome ?? null,
    cognome: r.cognome,
    nome: r.nome,
    dataNascita: r.dataNascita ?? null,
    fasciaEtaPresunta: r.fasciaEtaPresunta ?? null,
    fasciaEtaCorrente: fasciaEta.fascia,
    fasciaEtaOrigine: fasciaEta.origine,
    sesso: r.sesso ?? null,
    cittadinanza: r.cittadinanza ?? null,
    areaProvenienza: r.areaProvenienza ?? null,
    residenza: r.residenza ?? null,
    domicilio: r.domicilio ?? null,
    comune: r.comune ?? null,
    zonaMunicipio: r.zonaMunicipio ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    statoCivile: r.statoCivile ?? null,
    numComponenti: r.numComponenti,
    numFigliMaschi: r.numFigliMaschi,
    numFiglieFemmine: r.numFiglieFemmine,
    numMinori: r.numMinori,
    numAnziani: r.numAnziani,
    numDisabili: r.numDisabili,
    restrizioniAlimentari: r.restrizioniAlimentari ?? null,
    allergie: r.allergie ?? null,
    notePaccoAlimentare: r.notePaccoAlimentare ?? null,
    priorita: r.priorita,
    consegnaDomicilio: r.consegnaDomicilio,
    motivoConsegnaDomicilio: r.motivoConsegnaDomicilio ?? null,
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: centroNome ?? null,
    creditoSolidaleAbilitato: r.creditoSolidaleAbilitato ?? false,
    creditoSolidaleStato: r.creditoSolidaleStato ?? "non_abilitato",
    creditoSolidaleDataAbilitazione: r.creditoSolidaleDataAbilitazione?.toISOString() ?? null,
    creditoSolidaleNote: r.creditoSolidaleNote ?? null,
    magazzinoEmporioPreferitoId: r.magazzinoEmporioPreferitoId ?? null,
    magazzinoEmporioPreferitoNome: magazzinoEmporioPreferitoNome ?? null,
    creditoSolidaleMensileAssegnato: r.creditoSolidaleMensileAssegnato == null ? null : Number(r.creditoSolidaleMensileAssegnato),
    creditoSolidaleMensileManuale: r.creditoSolidaleMensileManuale ?? false,
    creditoSolidaleMotivoModifica: r.creditoSolidaleMotivoModifica ?? null,
    creditoSolidaleDataUltimaModificaQuota: r.creditoSolidaleDataUltimaModificaQuota?.toISOString() ?? null,
    creditoSolidaleSaldo: Number(r.creditoSolidaleSaldo ?? "0"),
    creditoSolidaleDataUltimoMovimento: r.creditoSolidaleDataUltimoMovimento?.toISOString() ?? null,
    uds: r.uds,
    areaOperativaId: r.areaOperativaId ?? null,
    areaOperativaNome: areaOperativaNome ?? null,
    zonaUdsId: r.zonaUdsId ?? null,
    attivo: r.attivo,
    dataPresaInCarico: r.dataPresaInCarico ?? null,
    noteInterne: r.noteInterne ?? null,
    versione: r.versione,
    dataCreazione: r.dataCreazione.toISOString(),
    dataAggiornamento: r.dataAggiornamento.toISOString(),
  };
}

function fmtBenefForRequest(
  r: typeof beneficiariTable.$inferSelect,
  req: Request,
  centroNome?: string | null,
  areaOperativaNome?: string | null,
  magazzinoEmporioPreferitoNome?: string | null,
) {
  const result = fmtBenef(r, centroNome, areaOperativaNome, magazzinoEmporioPreferitoNome) as Record<string, unknown>;
  if (!hasPermission(req, "beneficiari.sensitive.view")) {
    for (const key of ["codiceFiscale", ...SOCIAL_SENSITIVE_FIELDS]) delete result[key];
  }
  if (!hasPermission(req, "credito.view")) {
    for (const key of Object.keys(result)) {
      if (key.startsWith("creditoSolidale")) delete result[key];
    }
  }
  return result;
}

function parseOptionalPositiveQueryId(value: string | undefined): number | null | "invalid" {
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function fmtBeneficiarioDirectory(
  r: typeof beneficiariTable.$inferSelect,
  centroNome?: string | null,
  areaOperativaNome?: string | null,
  zonaUdsNome?: string | null,
) {
  const fasciaEta = risolviFasciaEta(r.dataNascita, r.fasciaEtaPresunta);
  return {
    id: r.id,
    codice: r.codice,
    statoAnagrafica: r.statoAnagrafica,
    cognome: r.cognome,
    nome: r.nome,
    soprannome: r.soprannome ?? null,
    dataNascita: r.dataNascita ?? null,
    fasciaEtaPresunta: r.fasciaEtaPresunta ?? null,
    fasciaEtaCorrente: fasciaEta.fascia,
    fasciaEtaOrigine: fasciaEta.origine,
    telefono: r.telefono ?? null,
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: centroNome ?? null,
    areaOperativaId: r.areaOperativaId ?? null,
    areaOperativaNome: areaOperativaNome ?? null,
    zonaUdsId: r.zonaUdsId ?? null,
    zonaUdsNome: zonaUdsNome ?? null,
    uds: r.uds,
    attivo: r.attivo,
    priorita: r.priorita,
    consegnaDomicilio: r.consegnaDomicilio,
    versione: r.versione,
  };
}

router.get("/beneficiari", requirePermission("beneficiari.view"), async (req, res) => {
  const { search, priorita, domicilio, centroAscoltoId, areaOperativaId, zonaUdsId, uds, attivo, statoAnagrafica } = req.query as Record<string, string>;
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e limit compreso tra 1 e 100." });
    return;
  }
  const conditions: SQL[] = [];
  if (search) {
    const q = `%${search}%`;
    const searchFilter = or(
      ilike(beneficiariTable.cognome, q),
      ilike(beneficiariTable.nome, q),
      ilike(beneficiariTable.codice, q),
      ilike(beneficiariTable.codiceFiscale, q),
    );
    if (searchFilter) conditions.push(searchFilter);
  }
  if (priorita) conditions.push(eq(beneficiariTable.priorita, priorita));
  if (statoAnagrafica) {
    if (!["provvisoria", "completa"].includes(statoAnagrafica)) {
      res.status(400).json({ error: "Stato anagrafica non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.statoAnagrafica, statoAnagrafica));
  }
  if (domicilio === "true") conditions.push(eq(beneficiariTable.consegnaDomicilio, true));
  // Area and Zona are boundaries when present on the caller; explicit
  // query params let a global caller narrow the result.
  const requestedAreaId = parseOptionalPositiveQueryId(areaOperativaId);
  const requestedZonaId = parseOptionalPositiveQueryId(zonaUdsId);
  const requestedCentroId = parseOptionalPositiveQueryId(centroAscoltoId);
  if ([requestedAreaId, requestedZonaId, requestedCentroId].includes("invalid")) {
    res.status(400).json({ error: "I filtri Area, Centro e Zona devono essere identificativi numerici validi." });
    return;
  }
  if (requestedAreaId != null) conditions.push(eq(beneficiariTable.areaOperativaId, requestedAreaId as number));
  if (requestedZonaId != null) conditions.push(eq(beneficiariTable.zonaUdsId, requestedZonaId as number));
  if (uds === "true") conditions.push(eq(beneficiariTable.uds, true));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (requestedCentroId != null) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, requestedCentroId as number));
  }
  const areaOperativaFilter = areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req));
  if (areaOperativaFilter) conditions.push(areaOperativaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);
  if (attivo === "true") conditions.push(eq(beneficiariTable.attivo, true));
  else if (attivo === "false") conditions.push(eq(beneficiariTable.attivo, false));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` })
    .from(beneficiariTable).where(where);
  const rows = await db
    .select({
      b: beneficiariTable,
      centroNome: centriAscoltoTable.nome,
      areaOperativaNome: areeOperativeTable.nome,
      magazzinoEmporioPreferitoNome: magazziniTable.nome,
      zonaUdsNome: zoneUdsTable.nome,
    })
    .from(beneficiariTable)
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(areeOperativeTable, eq(beneficiariTable.areaOperativaId, areeOperativeTable.id))
    .leftJoin(magazziniTable, eq(beneficiariTable.magazzinoEmporioPreferitoId, magazziniTable.id))
    .leftJoin(zoneUdsTable, eq(beneficiariTable.zonaUdsId, zoneUdsTable.id))
    .where(where)
    .orderBy(desc(beneficiariTable.dataCreazione), desc(beneficiariTable.id))
    .limit(limit)
    .offset((page - 1) * limit);
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(rows.map(r => fmtBeneficiarioDirectory(r.b, r.centroNome, r.areaOperativaNome, r.zonaUdsNome)));
});

type BeneficiarioTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
interface BeneficiarioCreationOptions {
  executor?: typeof db | BeneficiarioTx;
  areaOperativaId?: number;
  centroAscoltoId?: number | null;
  zonaUdsId?: number | null;
  /** Internal domain workflow already protected by its own purpose-specific permissions. */
  allowSensitiveFields?: boolean;
}

export async function createBeneficiarioOne(
  body: Record<string, unknown>,
  req: Request,
  options: BeneficiarioCreationOptions = {},
): Promise<{ row: typeof beneficiariTable.$inferSelect } | { error: string; status?: number }> {
  const parsed = CreateBeneficiarioInput.safeParse(body);
  if (!parsed.success) return { error: zodErrorMessage(parsed.error), status: 400 };
  const b = parsed.data;
  if (!options.allowSensitiveFields && !hasPermission(req, "beneficiari.sensitive.view")
    && Object.keys(b).some((key) => SOCIAL_SENSITIVE_FIELDS.has(key))) {
    return { error: "Non hai il permesso di modificare i dati sociali sensibili.", status: 403 };
  }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  const codice = trimOrUndefined(b.codice) ?? await generaCodiceBeneficiario();
  if (await codiceBeneficiarioEsiste(codice)) return { error: CODICE_BENEFICIARIO_DUPLICATO_MSG, status: 409 };
  const sesso = normalizzaSesso(b.sesso);
  if (!sesso) return { error: SESSO_OBBLIGATORIO_MSG, status: 400 };
  const values: Record<string, any> = {
    ...b,
    codice,
    codiceFiscale: normalizeCodiceFiscale(b.codiceFiscale),
    sesso,
    statoAnagrafica: b.statoAnagrafica ?? "provvisoria",
    attivo: true,
  };
  const eta = normalizeEtaFields(values, b);
  if (eta.error) return { error: eta.error, status: 400 };
  if ("uds" in values) values.uds = toBool(values.uds);
  if (caller != null) values.centroAscoltoId = caller;
  if (cid != null) values.areaOperativaId = cid;
  if (zid != null) values.zonaUdsId = zid;
  if (options.areaOperativaId != null) values.areaOperativaId = options.areaOperativaId;
  if ("centroAscoltoId" in options) values.centroAscoltoId = options.centroAscoltoId;
  if ("zonaUdsId" in options) values.zonaUdsId = options.zonaUdsId;
  const scopeError = await validateBeneficiarioTerritorialAssignment({
    areaOperativaId: values.areaOperativaId ?? null,
    centroAscoltoId: values.centroAscoltoId ?? null,
    zonaUdsId: values.zonaUdsId ?? null,
    magazzinoEmporioPreferitoId: values.magazzinoEmporioPreferitoId ?? null,
  }, { requireArea: true, requireActiveArea: true });
  if (scopeError) return scopeError;

  if ("magazzinoEmporioPreferitoId" in b) {
    const emporio = await validateMagazzinoEmporioPreferito(b.magazzinoEmporioPreferitoId, req);
    if ("error" in emporio) return { error: emporio.error, status: emporio.status ?? 400 };
    values.magazzinoEmporioPreferitoId = emporio.value;
  }
  if (values.magazzinoEmporioPreferitoId != null && !(await isEmporioEnabled())) {
    return { error: EMPORIO_DISABLED_MSG, status: 403 };
  }
  const createsUdsData =
    values.uds === true ||
    ("zonaUdsId" in b && values.zonaUdsId != null) ||
    (zid != null && values.zonaUdsId != null);
  if (createsUdsData && !(await isUnitaStradaEnabled())) {
    return { error: UNITA_STRADA_DISABLED_MSG, status: 403 };
  }
  const completeError = validateBeneficiarioCompleto({
    statoAnagrafica: values.statoAnagrafica,
    nome: values.nome,
    cognome: values.cognome,
    sesso: values.sesso,
    dataNascita: values.dataNascita ?? null,
    fasciaEtaPresunta: values.fasciaEtaPresunta ?? null,
    centroAscoltoId: values.centroAscoltoId ?? null,
  });
  if (completeError) return { error: completeError, status: 400 };

  const persist = async (executor: typeof db | BeneficiarioTx) => {
    const [row] = await executor.insert(beneficiariTable)
      .values(values as typeof beneficiariTable.$inferInsert).returning();
    await executor.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `beneficiario:${row.id}`,
      azione: "creazione",
      valoreNuovo: {
        beneficiarioId: row.id,
        statoAnagrafica: row.statoAnagrafica,
        areaOperativaId: row.areaOperativaId,
        centroAscoltoId: row.centroAscoltoId,
        zonaUdsId: row.zonaUdsId,
      },
      utenteId: req.user?.id ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
    return row;
  };
  try {
    const row = options.executor
      ? await persist(options.executor)
      : await db.transaction((tx) => persist(tx));
    return { row };
  } catch (e) {
    if (isCodiceBeneficiarioUniqueViolation(e)) return { error: CODICE_BENEFICIARIO_DUPLICATO_MSG, status: 409 };
    throw e;
  }
}

router.post("/beneficiari", requirePermission("beneficiari.manage"), async (req, res) => {
  const r = await createBeneficiarioOne(req.body, req);
  if ("error" in r) { res.status(r.status ?? 400).json({ error: r.error }); return; }
  res.status(201).json(fmtBenefForRequest(
    r.row,
    req,
    null,
    null,
    await magazzinoEmporioNomeOf(r.row.magazzinoEmporioPreferitoId),
  ));
});

router.post("/beneficiari/bulk", requirePermission("beneficiari.manage"), async (req, res) => {
  const righe = req.body?.righe;
  if (!Array.isArray(righe)) { res.status(400).json({ error: "Il campo righe deve essere un array." }); return; }
  if (righe.length > 500) { res.status(400).json({ error: "Il bulk Beneficiari accetta al massimo 500 righe." }); return; }
  const result = await runBulk(righe, async (row) => {
    if (row == null || typeof row !== "object" || Array.isArray(row)) return { error: "Riga non valida." };
    const r = await createBeneficiarioOne(row as Record<string, unknown>, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  await db.insert(auditConfigurazioniTable).values({
    area: "beneficiari",
    chiave: "beneficiari:bulk",
    azione: "import-bulk",
    valoreNuovo: { righe: righe.length, creati: result.creati, errori: result.errori.length },
    utenteId: req.user?.id ?? null,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
  });
  res.json(result);
});

// Fuzzy person-duplicate suggestion (pg_trgm). Scoped HARD to the caller's Area
// so a duplicate is never surfaced across Areas. The UDS lookup deliberately
// ignores Centro/Zona: an operator may find every shared person in their Area,
// including Sociale-only people and UDS people assigned to another zona.
// MUST stay registered before "/beneficiari/:id" so the literal segment is not
// captured as an id.
router.get("/beneficiari/cerca-simili", requirePermission("beneficiari.duplicates.search"), async (req, res) => {
  if (
    !req.user?.isAdmin &&
    !req.user?.isSuperAdmin &&
    req.user?.aree?.includes("uds") === true &&
    req.user?.aree?.includes("sociale") !== true
  ) {
    res.status(403).json({ error: "Ricerca anagrafica completa non consentita al profilo UDS" });
    return;
  }
  const q = req.query as Record<string, string>;
  const search = (q.search ?? "").trim().toLowerCase();
  const nome = (q.nome ?? "").trim();
  const cognome = (q.cognome ?? "").trim();
  const soprannome = (q.soprannome ?? "").trim().toLowerCase();
  const telefono = (q.telefono ?? "").trim();
  const dataNascita = (q.dataNascita ?? "").trim();
  const toIntOrNull = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = parseInt(v);
    return Number.isNaN(n) ? null : n;
  };
  const excludeId = toIntOrNull(q.excludeId);

  // A global caller must always choose one valid Area explicitly. Scoped
  // callers cannot override their own Area, even by sending another value.
  const callerAreaOperativa = callerAreaOperativaId(req);
  let areaOperativaId: number;
  if (callerAreaOperativa != null) {
    areaOperativaId = callerAreaOperativa;
  } else {
    const rawAreaOperativa = q.areaOperativaId as unknown;
    if (rawAreaOperativa == null || (typeof rawAreaOperativa === "string" && !rawAreaOperativa.trim())) {
      res.status(400).json({ error: "Seleziona un'Area per cercare le persone." });
      return;
    }
    const requestedAreaOperativa = typeof rawAreaOperativa === "string" ? rawAreaOperativa.trim() : "";
    const parsedAreaOperativa = Number(requestedAreaOperativa);
    if (
      !/^\d+$/.test(requestedAreaOperativa) ||
      !Number.isSafeInteger(parsedAreaOperativa) ||
      parsedAreaOperativa <= 0 ||
      parsedAreaOperativa > 2_147_483_647
    ) {
      res.status(400).json({ error: "L'Area Operativa selezionata non è valida." });
      return;
    }
    areaOperativaId = parsedAreaOperativa;
  }

  res.json(await searchBeneficiariDuplicates({
    areaOperativaId,
    search,
    nome,
    cognome,
    soprannome,
    telefono,
    dataNascita,
    excludeId,
  }));
});

router.post("/beneficiari/export/authorize", requirePermission("beneficiari.export"), async (req, res) => {
  const parsed = AuthorizeBeneficiariExportInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodErrorMessage(parsed.error) }); return; }
  if (parsed.data.beneficiarioId != null) {
    const access = await scopedBeneficiario(parsed.data.beneficiarioId, req);
    if ("error" in access) { res.status(access.status).json({ error: access.error }); return; }
  }
  const [audit] = await db.insert(auditConfigurazioniTable).values({
    area: "beneficiari",
    chiave: parsed.data.beneficiarioId == null ? "beneficiari:export" : `beneficiario:${parsed.data.beneficiarioId}`,
    azione: "export-autorizzato",
    valoreNuovo: {
      tipo: parsed.data.tipo,
      beneficiarioId: parsed.data.beneficiarioId ?? null,
      numeroRecord: parsed.data.numeroRecord,
      areaOperativaId: callerAreaOperativaId(req),
      centroAscoltoId: callerCentroId(req),
      zonaUdsId: callerZonaUdsId(req),
    },
    utenteId: req.user?.id ?? null,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
  }).returning({ id: auditConfigurazioniTable.id });
  res.json({ autorizzato: true, auditId: audit.id });
});

router.get("/beneficiari/:id/tessere", requirePermission("beneficiari.cards.manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Beneficiario non valido" }); return; }
  const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!beneficiario) { res.status(404).json({ error: "Beneficiario non trovato" }); return; }
  if (!canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req))
    || !canAccessAreaOperativa(beneficiario.areaOperativaId, callerAreaOperativaId(req))
    || !canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Beneficiario non accessibile" }); return;
  }
  const rows = await db.select().from(tessereBeneficiariTable)
    .where(eq(tessereBeneficiariTable.beneficiarioId, id))
    .orderBy(desc(tessereBeneficiariTable.createdAt));
  res.json(rows.map(formatTesseraBeneficiario));
});

router.post("/beneficiari/:id/tessere", requirePermission("beneficiari.cards.manage"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Beneficiario non valido" }); return; }
  const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!beneficiario) { res.status(404).json({ error: "Beneficiario non trovato" }); return; }
  if (!canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req))
    || !canAccessAreaOperativa(beneficiario.areaOperativaId, callerAreaOperativaId(req))
    || !canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Beneficiario non accessibile" }); return;
  }
  if (!beneficiario.attivo) { res.status(409).json({ error: "Il beneficiario non è attivo" }); return; }
  if (beneficiario.statoAnagrafica !== "completa" || beneficiario.centroAscoltoId == null) {
    res.status(409).json({ error: "Completa l'anagrafica prima di emettere la tessera" }); return;
  }
  const dataScadenza = req.body?.dataScadenza;
  if (dataScadenza != null && dataScadenza !== "" && (typeof dataScadenza !== "string" || !isDateOnly(dataScadenza))) {
    res.status(400).json({ error: "La scadenza non è valida" }); return;
  }
  const motivo = typeof req.body?.motivoSostituzione === "string" ? req.body.motivoSostituzione.trim() || null : null;
  try {
    const row = await issueTesseraBeneficiario({
      beneficiarioId: id,
      dataScadenza: dataScadenza || null,
      motivoSostituzione: motivo,
      operatoreId: req.user!.id,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
      areaAudit: "beneficiari",
    });
    res.status(201).json(formatTesseraBeneficiario(row));
  } catch (error) {
    if (error instanceof TesseraBeneficiarioError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.get("/beneficiari/:id", requirePermission("beneficiari.view"), async (req, res) => {
  const id = Number(req.params.id);
  const [row] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessBeneficiarioRecord(row, req)) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo profilo" });
    return;
  }

  let centroNome: string | null = null;
  if (row.centroAscoltoId) {
    const [c] = await db.select({ nome: centriAscoltoTable.nome }).from(centriAscoltoTable).where(eq(centriAscoltoTable.id, row.centroAscoltoId));
    centroNome = c?.nome ?? null;
  }

  const canViewSensitive = hasPermission(req, "beneficiari.sensitive.view");
  const canViewCredito = hasPermission(req, "credito.view");
  const ambiti = visibleInterventoAmbiti(req);
  const nucleo = canViewSensitive
    ? await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id))
    : [];
  const interventi = ambiti.length > 0
    ? await db.select().from(interventiTable).where(and(
      eq(interventiTable.beneficiarioId, id),
      ambiti.includes("sociale")
        ? or(inArray(interventiTable.ambito, ambiti), isNull(interventiTable.ambito))
        : inArray(interventiTable.ambito, ambiti),
    )).orderBy(
      desc(sql`coalesce(${interventiTable.dataIntervento}, ${interventiTable.dataCreazione}::date)`),
      desc(interventiTable.id),
    ).limit(20)
    : [];
  const interventoIds = interventi.map((intervento) => intervento.id);
  const successori = interventoIds.length > 0
    ? await db.select({ id: interventiTable.id, precedenteId: interventiTable.interventoPrecedenteId }).from(interventiTable).where(inArray(interventiTable.interventoPrecedenteId, interventoIds))
    : [];
  const bisogni = interventoIds.length > 0
    ? await db.select().from(bisogniPianificatiTable).where(inArray(bisogniPianificatiTable.interventoId, interventoIds))
    : [];
  const today = dataCivileEuropeRome();
  const consegne = canViewSensitive
    ? await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, id))
      .orderBy(desc(consegneTable.dataCreazione), desc(consegneTable.id)).limit(20)
    : [];

  const anagrafica = fmtBenefForRequest(
    row,
    req,
    centroNome,
    null,
    await magazzinoEmporioNomeOf(row.magazzinoEmporioPreferitoId),
  );
  res.json({
    ...anagrafica,
    nucleo: nucleo.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null })),
    interventi: interventi.map(i => ({
      id: i.id,
      beneficiarioId: i.beneficiarioId,
      beneficiarioNome: `${row.cognome} ${row.nome}`,
      bollaId: i.bollaId ?? null,
      operatoreId: i.operatoreId ?? null,
      operatoreCodice: null,
      dataIntervento: i.dataIntervento ?? null,
      tipoIntervento: i.tipoIntervento,
      descrizione: i.descrizione ?? null,
      esito: i.esito ?? null,
      prossimAzione: i.prossimAzione ?? null,
      note: i.ambito === "uds" ? null : i.note ?? null,
      noteUds: i.ambito === "uds" ? i.noteUds ?? null : null,
      dataFollowup: i.dataFollowup ?? null,
      scadenzaIsee: i.scadenzaIsee ?? null,
      scadenzaRinnovo: i.scadenzaRinnovo ?? null,
      scadenzaAutodichiarazioneIndigenza: i.scadenzaAutodichiarazioneIndigenza ?? null,
      stato: i.stato,
      ambito: i.ambito ?? null,
      priorita: i.priorita,
      dataOraPianificata: i.dataOraPianificata?.toISOString() ?? null,
      dataOraAvvio: i.dataOraAvvio?.toISOString() ?? null,
      dataOraConclusione: i.dataOraConclusione?.toISOString() ?? null,
      interventoPrecedenteId: i.interventoPrecedenteId ?? null,
      successoriIds: successori.filter((successivo) => successivo.precedenteId === i.id).map((successivo) => successivo.id),
      numeroSuccessori: successori.filter((successivo) => successivo.precedenteId === i.id).length,
      sede: i.sede ?? null,
      motivoAnnullamento: i.motivoAnnullamento ?? null,
      dataCreazione: i.dataCreazione.toISOString(),
      dataAggiornamento: i.dataAggiornamento?.toISOString() ?? null,
      bisogniPianificatiTotale: bisogni.filter((bisogno) => bisogno.interventoId === i.id).length,
      bisogniPianificatiAperti: bisogni.filter((bisogno) => bisogno.interventoId === i.id && (bisogno.stato === "da_pianificare" || bisogno.stato === "pianificato")).length,
      bisogniPianificatiScaduti: bisogni.filter((bisogno) => bisogno.interventoId === i.id && (bisogno.stato === "da_pianificare" || bisogno.stato === "pianificato") && bisogno.dataPrevista != null && bisogno.dataPrevista < today).length,
      bisogniPianificatiProssimaScadenza: bisogni.filter((bisogno) => bisogno.interventoId === i.id && (bisogno.stato === "da_pianificare" || bisogno.stato === "pianificato") && bisogno.dataPrevista != null).map((bisogno) => bisogno.dataPrevista!).sort()[0] ?? null,
    })),
    consegne: consegne.map(c => ({
      id: c.id,
      codice: c.codice,
      beneficiarioId: c.beneficiarioId,
      tipoConsegna: c.tipoConsegna,
      dataPrevista: c.dataPrevista,
      stato: c.stato,
      magazzinoId: c.magazzinoId,
      dataCreazione: c.dataCreazione.toISOString(),
    })),
  });
});

router.patch("/beneficiari/:id", requirePermission("beneficiari.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateBeneficiarioInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodErrorMessage(parsed.error) }); return; }
  const input = parsed.data;
  if (!hasPermission(req, "beneficiari.sensitive.view")
    && Object.keys(input).some((key) => SOCIAL_SENSITIVE_FIELDS.has(key))) {
    res.status(403).json({ error: "Non hai il permesso di modificare i dati sociali sensibili." });
    return;
  }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const patchKeys = Object.keys(input);
  const isInitialUdsLink = !existing.uds
    && toBool(input.uds) === true
    && patchKeys.length > 0
    && patchKeys.every((key) => key === "uds" || key === "zonaUdsId" || key === "fasciaEtaPresunta" || key === "versione");
  const canLinkWithinCallerAreaOperativa = isInitialUdsLink
    && cid != null
    && existing.areaOperativaId === cid;

  // The shared-directory UDS action is the only mutation allowed across centro
  // and Zona boundaries, and only for a non-UDS person in the caller's exact
  // Area. Every other patch retains the standard territorial checks.
  if (!canLinkWithinCallerAreaOperativa) {
    if (!canAccessCentro(existing.centroAscoltoId, caller)) {
      res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    if (!canAccessAreaOperativa(existing.areaOperativaId, cid)) {
      res.status(403).json({ error: "Risorsa non accessibile per la tua Area" });
      return;
    }
    if (!canAccessZonaUds(existing.zonaUdsId, zid)) {
      res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
      return;
    }
  }
  const { versione, ...inputUpdates } = input;
  const updates: Record<string, any> = { ...inputUpdates, dataAggiornamento: new Date() };
  if ("statoAnagrafica" in updates && !["provvisoria", "completa"].includes(String(updates.statoAnagrafica))) {
    res.status(400).json({ error: "Stato anagrafica non valido" }); return;
  }
  const eta = normalizeEtaFields(updates, inputUpdates as Record<string, unknown>);
  if (eta.error) {
    res.status(400).json({ error: eta.error });
    return;
  }
  if ("codiceFiscale" in updates) updates.codiceFiscale = normalizeCodiceFiscale(updates.codiceFiscale);
  delete updates.creditoSolidaleSaldo;
  delete updates.creditoSolidaleDataUltimoMovimento;
  if ("uds" in updates) updates.uds = toBool(updates.uds);
  const credito = normalizeCreditoSolidaleFields(updates, inputUpdates as Record<string, unknown>, existing);
  if (credito.error) {
    res.status(400).json({ error: credito.error });
    return;
  }
  const quota = normalizeCreditoSolidaleQuotaFields(updates, inputUpdates as Record<string, unknown>, existing);
  if (quota.error) {
    res.status(400).json({ error: quota.error });
    return;
  }
  if ("magazzinoEmporioPreferitoId" in updates) {
    const emporio = await validateMagazzinoEmporioPreferito(updates.magazzinoEmporioPreferitoId, req);
    if ("error" in emporio) {
      res.status(emporio.status ?? 400).json({ error: emporio.error });
      return;
    }
    updates.magazzinoEmporioPreferitoId = emporio.value;
  }
  const creditoSolidaleAbilitatoFinale = "creditoSolidaleAbilitato" in updates
    ? updates.creditoSolidaleAbilitato === true
    : existing.creditoSolidaleAbilitato === true;
  if (caller != null) {
    if (existing.statoAnagrafica === "provvisoria" && updates.statoAnagrafica === "completa") {
      updates.centroAscoltoId = caller;
    } else if (creditoSolidaleAbilitatoFinale && existing.centroAscoltoId == null) {
      updates.centroAscoltoId = caller;
    } else {
      delete updates.centroAscoltoId;
    }
  }
  if (cid != null) delete updates.areaOperativaId;
  if (zid != null) updates.zonaUdsId = zid;

  if ("statoAnagrafica" in updates) {
    const isCompletion = existing.statoAnagrafica === "provvisoria" && updates.statoAnagrafica === "completa";
    if (!isCompletion) {
      res.status(400).json({ error: "È consentito solo il completamento esplicito di un'anagrafica provvisoria" }); return;
    }
    const centroId = Number(updates.centroAscoltoId ?? existing.centroAscoltoId);
    if (!Number.isSafeInteger(centroId) || centroId <= 0) {
      res.status(400).json({ error: "Associa un Centro di Ascolto prima di completare l'anagrafica" }); return;
    }
    const [centro] = await db.select().from(centriAscoltoTable).where(eq(centriAscoltoTable.id, centroId));
    const finalAreaOperativaId = "areaOperativaId" in updates ? Number(updates.areaOperativaId) : existing.areaOperativaId;
    if (!centro || !centro.attivo) {
      res.status(400).json({ error: "Il Centro di Ascolto selezionato non è disponibile" }); return;
    }
    if (!canAccessCentro(centro.id, caller) || !canAccessAreaOperativa(centro.areaOperativaId, cid)
      || (finalAreaOperativaId != null && centro.areaOperativaId != null && centro.areaOperativaId !== finalAreaOperativaId)) {
      res.status(403).json({ error: "Il Centro di Ascolto selezionato non appartiene al perimetro territoriale consentito" }); return;
    }
    const nome = String(updates.nome ?? existing.nome).trim();
    const cognome = String(updates.cognome ?? existing.cognome).trim();
    const sesso = normalizzaSesso(updates.sesso ?? existing.sesso);
    const dataNascita = (updates.dataNascita ?? existing.dataNascita) as string | null | undefined;
    const fasciaEtaPresunta = updates.fasciaEtaPresunta ?? existing.fasciaEtaPresunta;
    const completeError = validateBeneficiarioCompleto({
      statoAnagrafica: "completa",
      nome,
      cognome,
      sesso: sesso ?? null,
      dataNascita: dataNascita ?? null,
      fasciaEtaPresunta: typeof fasciaEtaPresunta === "string" ? fasciaEtaPresunta : null,
      centroAscoltoId: centroId,
    });
    if (completeError) { res.status(400).json({ error: completeError }); return; }
    updates.nome = nome;
    updates.cognome = cognome;
    updates.sesso = sesso;
    updates.centroAscoltoId = centroId;
  }

  const centroAscoltoIdFinale = "centroAscoltoId" in updates ? updates.centroAscoltoId : existing.centroAscoltoId;
  if (creditoSolidaleAbilitatoFinale && (centroAscoltoIdFinale == null || centroAscoltoIdFinale === "")) {
    res.status(400).json({ error: CREDITO_SOLIDALE_CENTRO_ASCOLTO_RICHIESTO_MSG });
    return;
  }
  const enablesCreditoSolidale = updates.creditoSolidaleAbilitato === true && !existing.creditoSolidaleAbilitato;
  const assignsEmporio =
    "magazzinoEmporioPreferitoId" in updates &&
    updates.magazzinoEmporioPreferitoId != null &&
    updates.magazzinoEmporioPreferitoId !== existing.magazzinoEmporioPreferitoId;
  if ((enablesCreditoSolidale || assignsEmporio || quota.quotaChanged || quota.motivoChanged) && !(await isEmporioEnabled())) {
    res.status(403).json({ error: EMPORIO_DISABLED_MSG });
    return;
  }
  if ("codice" in updates) {
    const codice = trimOrUndefined(updates.codice);
    if (!codice) { res.status(400).json({ error: "Codice beneficiario obbligatorio" }); return; }
    if (await codiceBeneficiarioEsiste(codice, id)) {
      res.status(409).json({ error: CODICE_BENEFICIARIO_DUPLICATO_MSG });
      return;
    }
    updates.codice = codice;
  }
  if ("sesso" in updates) {
    const sesso = normalizzaSesso(updates.sesso);
    if (!sesso) { res.status(400).json({ error: SESSO_OBBLIGATORIO_MSG }); return; }
    updates.sesso = sesso;
  } else if (isAnagraficaBeneficiarioPatch(updates) && !normalizzaSesso(existing.sesso)) {
    res.status(400).json({ error: SESSO_OBBLIGATORIO_MSG });
    return;
  }
  const enablesUds = updates.uds === true && !existing.uds;
  const assignsZonaUds =
    "zonaUdsId" in updates &&
    updates.zonaUdsId != null &&
    updates.zonaUdsId !== existing.zonaUdsId;
  if ((enablesUds || assignsZonaUds) && !(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  // Un collegamento UDS non può restare senza Area. Un caller territoriale
  // assegna la propria Area anche ai record legacy; un caller globale deve
  // supply one explicitly.
  const resultingUds = "uds" in updates ? updates.uds === true : existing.uds === true;
  const resultingAreaOperativa = "areaOperativaId" in updates ? updates.areaOperativaId : existing.areaOperativaId;
  if (resultingUds && resultingAreaOperativa == null) {
    if (cid != null) {
      updates.areaOperativaId = cid;
    } else {
      res.status(400).json({ error: "L'Area è obbligatoria per una persona UDS" });
      return;
    }
  }
  const assignmentChanged = ["areaOperativaId", "centroAscoltoId", "zonaUdsId", "magazzinoEmporioPreferitoId"]
    .some((key) => key in updates);
  if (assignmentChanged || (existing.statoAnagrafica === "provvisoria" && updates.statoAnagrafica === "completa")) {
    const assignmentError = await validateBeneficiarioTerritorialAssignment({
      areaOperativaId: ("areaOperativaId" in updates ? updates.areaOperativaId : existing.areaOperativaId) ?? null,
      centroAscoltoId: ("centroAscoltoId" in updates ? updates.centroAscoltoId : existing.centroAscoltoId) ?? null,
      zonaUdsId: ("zonaUdsId" in updates ? updates.zonaUdsId : existing.zonaUdsId) ?? null,
      magazzinoEmporioPreferitoId: ("magazzinoEmporioPreferitoId" in updates
        ? updates.magazzinoEmporioPreferitoId
        : existing.magazzinoEmporioPreferitoId) ?? null,
    }, { requireArea: true, requireActiveArea: true });
    if (assignmentError) { res.status(assignmentError.status).json({ error: assignmentError.error }); return; }
  }
  const changedFields = Object.keys(inputUpdates);
  updates.versione = sql`${beneficiariTable.versione} + 1`;
  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx.update(beneficiariTable).set(updates).where(and(
        eq(beneficiariTable.id, id),
        eq(beneficiariTable.versione, versione),
      )).returning();
      if (!updated) return null;
      await tx.insert(auditConfigurazioniTable).values({
        area: "beneficiari",
        chiave: `beneficiario:${id}`,
        azione: updated.statoAnagrafica !== existing.statoAnagrafica && updated.statoAnagrafica === "completa"
          ? "completamento-anagrafica"
          : "modifica-anagrafica",
        valorePrecedente: {
          versione: existing.versione,
          statoAnagrafica: existing.statoAnagrafica,
          areaOperativaId: existing.areaOperativaId,
          centroAscoltoId: existing.centroAscoltoId,
          zonaUdsId: existing.zonaUdsId,
          campiModificati: changedFields,
        },
        valoreNuovo: {
          versione: updated.versione,
          statoAnagrafica: updated.statoAnagrafica,
          areaOperativaId: updated.areaOperativaId,
          centroAscoltoId: updated.centroAscoltoId,
          zonaUdsId: updated.zonaUdsId,
          campiModificati: changedFields,
        },
        utenteId: req.user?.id ?? null,
        ip: req.ip ?? req.socket.remoteAddress ?? null,
      });
      return updated;
    });
    if (!row) { res.status(409).json({ error: "Il Beneficiario è stato modificato da un altro utente. Ricarica la scheda e riprova." }); return; }
    res.json(fmtBenefForRequest(
      row,
      req,
      null,
      null,
      await magazzinoEmporioNomeOf(row.magazzinoEmporioPreferitoId),
    ));
  } catch (e) {
    if (isCodiceBeneficiarioUniqueViolation(e)) {
      res.status(409).json({ error: CODICE_BENEFICIARIO_DUPLICATO_MSG });
      return;
    }
    throw e;
  }
});

router.patch("/beneficiari/:id/stato", requirePermission("beneficiari.deactivate"), async (req, res) => {
  const id = Number(req.params.id);
  const parsed = UpdateBeneficiarioStatusInput.safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) {
    res.status(400).json({ error: parsed.success ? "Beneficiario non valido." : zodErrorMessage(parsed.error) });
    return;
  }
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Beneficiario non trovato." }); return; }
  if (!canAccessBeneficiarioRecord(existing, req)) { res.status(403).json({ error: "Beneficiario non accessibile." }); return; }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(beneficiariTable).set({
      attivo: parsed.data.attivo,
      versione: sql`${beneficiariTable.versione} + 1`,
      dataAggiornamento: new Date(),
    }).where(and(
      eq(beneficiariTable.id, id),
      eq(beneficiariTable.versione, parsed.data.versione),
    )).returning();
    if (!row) return null;
    await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `beneficiario:${id}`,
      azione: row.attivo ? "riattivazione" : "disattivazione",
      valorePrecedente: { attivo: existing.attivo, versione: existing.versione },
      valoreNuovo: { attivo: row.attivo, versione: row.versione },
      utenteId: req.user?.id ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
    return row;
  });
  if (!updated) { res.status(409).json({ error: "Versione Beneficiario superata." }); return; }
  res.json(fmtBenefForRequest(updated, req));
});

router.delete("/beneficiari/:id", requirePermission("beneficiari.deactivate"), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessAreaOperativa(existing.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua Area" });
    return;
  }
  if (!canAccessZonaUds(existing.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }
  if (!existing.attivo) { res.status(204).send(); return; }
  await db.transaction(async (tx) => {
    const [updated] = await tx.update(beneficiariTable).set({
      attivo: false,
      versione: sql`${beneficiariTable.versione} + 1`,
      dataAggiornamento: new Date(),
    }).where(eq(beneficiariTable.id, id)).returning();
    await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari",
      chiave: `beneficiario:${id}`,
      azione: "disattivazione",
      valorePrecedente: { attivo: true, versione: existing.versione },
      valoreNuovo: { attivo: false, versione: updated.versione },
      utenteId: req.user?.id ?? null,
      ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
  });
  res.status(204).send();
});

async function scopedBeneficiario(
  id: number,
  req: Request,
): Promise<
  | { beneficiario: typeof beneficiariTable.$inferSelect }
  | { status: 403 | 404; error: string }
> {
  const [beneficiario] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!beneficiario) return { status: 404, error: "Beneficiario non trovato." } as const;
  if (!canAccessBeneficiarioRecord(beneficiario, req)) return { status: 403, error: "Beneficiario non accessibile." } as const;
  return { beneficiario } as const;
}

router.get("/beneficiari/:id/nucleo", requirePermission("beneficiari.sensitive.view"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) { res.status(400).json({ error: "Beneficiario non valido." }); return; }
  const access = await scopedBeneficiario(id, req);
  if ("error" in access) { res.status(access.status).json({ error: access.error }); return; }
  const rows = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  res.json(rows.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null, tagliaVestiti: n.tagliaVestiti ?? null, numeroScarpe: n.numeroScarpe ?? null })));
});

router.post("/beneficiari/:id/nucleo", requirePermission("beneficiari.manage"), requirePermission("beneficiari.sensitive.view"), async (req, res) => {
  const id = Number(req.params.id);
  const access = Number.isSafeInteger(id) && id > 0 ? await scopedBeneficiario(id, req) : { status: 400, error: "Beneficiario non valido." } as const;
  if ("error" in access) { res.status(access.status).json({ error: access.error }); return; }
  const parsed = NucleoFamiliareInput.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: zodErrorMessage(parsed.error) }); return; }
  const row = await db.transaction(async (tx) => {
    const [created] = await tx.insert(nucleoFamiliareTable).values({ ...parsed.data, beneficiarioId: id }).returning();
    await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari", chiave: `beneficiario:${id}:nucleo`, azione: "aggiunta-membro-nucleo",
      valoreNuovo: { membroId: created.id, campiCompilati: Object.keys(parsed.data) },
      utenteId: req.user?.id ?? null, ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
    return created;
  });
  res.status(201).json(row);
});

router.patch("/beneficiari/:id/nucleo/:membroId", requirePermission("beneficiari.manage"), requirePermission("beneficiari.sensitive.view"), async (req, res) => {
  const id = Number(req.params.id);
  const membroId = Number(req.params.membroId);
  const access = Number.isSafeInteger(id) && id > 0 ? await scopedBeneficiario(id, req) : { status: 400, error: "Beneficiario non valido." } as const;
  if ("error" in access) { res.status(access.status).json({ error: access.error }); return; }
  if (!Number.isSafeInteger(membroId) || membroId <= 0) { res.status(400).json({ error: "Membro non valido." }); return; }
  const parsed = NucleoFamiliareUpdateInput.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) { res.status(400).json({ error: parsed.success ? "Nessun campo da aggiornare." : zodErrorMessage(parsed.error) }); return; }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(nucleoFamiliareTable).set(parsed.data).where(and(
      eq(nucleoFamiliareTable.id, membroId), eq(nucleoFamiliareTable.beneficiarioId, id),
    )).returning();
    if (!updated) return null;
    await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari", chiave: `beneficiario:${id}:nucleo`, azione: "modifica-membro-nucleo",
      valoreNuovo: { membroId, campiModificati: Object.keys(parsed.data) },
      utenteId: req.user?.id ?? null, ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
    return updated;
  });
  if (!row) { res.status(404).json({ error: "Membro del nucleo non trovato." }); return; }
  res.json(row);
});

router.delete("/beneficiari/:id/nucleo/:membroId", requirePermission("beneficiari.manage"), requirePermission("beneficiari.sensitive.view"), async (req, res) => {
  const id = Number(req.params.id);
  const membroId = Number(req.params.membroId);
  const access = Number.isSafeInteger(id) && id > 0 ? await scopedBeneficiario(id, req) : { status: 400, error: "Beneficiario non valido." } as const;
  if ("error" in access) { res.status(access.status).json({ error: access.error }); return; }
  await db.transaction(async (tx) => {
    const [deleted] = await tx.delete(nucleoFamiliareTable)
      .where(and(eq(nucleoFamiliareTable.id, membroId), eq(nucleoFamiliareTable.beneficiarioId, id))).returning({ id: nucleoFamiliareTable.id });
    if (deleted) await tx.insert(auditConfigurazioniTable).values({
      area: "beneficiari", chiave: `beneficiario:${id}:nucleo`, azione: "rimozione-membro-nucleo",
      valorePrecedente: { membroId }, utenteId: req.user?.id ?? null, ip: req.ip ?? req.socket.remoteAddress ?? null,
    });
  });
  res.status(204).send();
});

export default router;
