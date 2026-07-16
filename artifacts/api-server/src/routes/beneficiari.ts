import { randomInt } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { beneficiariTable, nucleoFamiliareTable, interventiTable, consegneTable, centriAscoltoTable, cittaTable, magazziniTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, and, or, ilike, sql, desc, ne, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  centroScopeFilter,
  cittaScopeFilter,
  zonaUdsScopeFilter,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
  beneficiarioCentroId,
  beneficiarioCittaId,
  beneficiarioZonaUdsId,
} from "../lib/centroScope";
import {
  EMPORIO_DISABLED_MSG,
  UNITA_STRADA_DISABLED_MSG,
  isEmporioEnabled,
  isUnitaStradaEnabled,
} from "../lib/impostazioniModuli";

const router: IRouter = Router();

import { DATA_NASCITA_FUTURA_MSG, hasFutureBirthDate } from "../lib/bug5Validation";

const CODICE_BENEFICIARIO_DUPLICATO_MSG = "Il codice beneficiario indicato è già associato a un altro beneficiario.";
const SESSO_OBBLIGATORIO_MSG = "Il campo Sesso è obbligatorio.";
const CREDITO_SOLIDALE_CENTRO_ASCOLTO_RICHIESTO_MSG =
  "ATTENZIONE: il beneficiario non ha un Centro di Ascolto assegnato. Non è possibile assegnare Credito Solidale.";
const STATI_CREDITO_SOLIDALE = ["non_abilitato", "attivo", "sospeso", "revocato"] as const;
type CreditoSolidaleStato = (typeof STATI_CREDITO_SOLIDALE)[number];

// Normalize a loosely-typed body flag to a real boolean so the città-boundary
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
  if (!canAccessCitta(magazzino.cittaId, callerCittaId(req))) {
    return { error: "Risorsa non accessibile per la tua città", status: 403 };
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
  cittaNome?: string | null,
  magazzinoEmporioPreferitoNome?: string | null,
) {
  return {
    id: r.id,
    codice: r.codice,
    codiceFiscale: r.codiceFiscale ?? null,
    soprannome: r.soprannome ?? null,
    cognome: r.cognome,
    nome: r.nome,
    dataNascita: r.dataNascita ?? null,
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
    cittaId: r.cittaId ?? null,
    cittaNome: cittaNome ?? null,
    zonaUdsId: r.zonaUdsId ?? null,
    attivo: r.attivo,
    dataPresaInCarico: r.dataPresaInCarico ?? null,
    noteInterne: r.noteInterne ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

router.get("/beneficiari", async (req, res) => {
  const { search, priorita, domicilio, centroAscoltoId, cittaId, zonaUdsId, uds, attivo } = req.query as Record<string, string>;
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
  if (domicilio === "true") conditions.push(eq(beneficiariTable.consegnaDomicilio, true));
  // Città and zona are HARD boundaries when present on the caller; explicit
  // query params let a global caller narrow the result.
  if (cittaId) conditions.push(eq(beneficiariTable.cittaId, parseInt(cittaId)));
  if (zonaUdsId) conditions.push(eq(beneficiariTable.zonaUdsId, parseInt(zonaUdsId)));
  if (uds === "true") conditions.push(eq(beneficiariTable.uds, true));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);
  if (attivo === "true") conditions.push(eq(beneficiariTable.attivo, true));
  else if (attivo === "false") conditions.push(eq(beneficiariTable.attivo, false));

  const rows = await db
    .select({
      b: beneficiariTable,
      centroNome: centriAscoltoTable.nome,
      cittaNome: cittaTable.nome,
      magazzinoEmporioPreferitoNome: magazziniTable.nome,
    })
    .from(beneficiariTable)
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(beneficiariTable.cittaId, cittaTable.id))
    .leftJoin(magazziniTable, eq(beneficiariTable.magazzinoEmporioPreferitoId, magazziniTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(beneficiariTable.dataCreazione), desc(beneficiariTable.id));
  res.json(rows.map(r => fmtBenef(r.b, r.centroNome, r.cittaNome, r.magazzinoEmporioPreferitoNome)));
});

async function createBeneficiarioOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ row: typeof beneficiariTable.$inferSelect } | { error: string; status?: number }> {
  const b = body as Record<string, any>;
  if (hasFutureBirthDate(b.dataNascita)) {
    return { error: DATA_NASCITA_FUTURA_MSG, status: 400 };
  }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  const codice = trimOrUndefined(b.codice) ?? await generaCodiceBeneficiario();
  if (await codiceBeneficiarioEsiste(codice)) return { error: CODICE_BENEFICIARIO_DUPLICATO_MSG, status: 409 };
  const sesso = normalizzaSesso(b.sesso);
  if (!sesso) return { error: SESSO_OBBLIGATORIO_MSG, status: 400 };
  const values: Record<string, any> = { ...b, codice, sesso };
  delete values.creditoSolidaleSaldo;
  delete values.creditoSolidaleDataUltimoMovimento;
  if ("uds" in values) values.uds = toBool(values.uds);
  if (caller != null) values.centroAscoltoId = caller;
  if (cid != null) values.cittaId = cid;
  if (zid != null) values.zonaUdsId = zid;
  // Città is the HARD UDS boundary: a città-global caller must pin a città when
  // creating a UDS person, otherwise the row would be visible across all cities.
  if (values.uds === true && cid == null && values.cittaId == null) {
    return { error: "La città è obbligatoria per una persona UDS" };
  }
  const credito = normalizeCreditoSolidaleFields(values, b);
  if (credito.error) return { error: credito.error, status: 400 };
  if (values.creditoSolidaleAbilitato === true && values.centroAscoltoId == null) {
    return { error: CREDITO_SOLIDALE_CENTRO_ASCOLTO_RICHIESTO_MSG, status: 400 };
  }
  const quota = normalizeCreditoSolidaleQuotaFields(values, b);
  if (quota.error) return { error: quota.error, status: 400 };
  if ("magazzinoEmporioPreferitoId" in b) {
    const emporio = await validateMagazzinoEmporioPreferito(b.magazzinoEmporioPreferitoId, req);
    if ("error" in emporio) return { error: emporio.error, status: emporio.status ?? 400 };
    values.magazzinoEmporioPreferitoId = emporio.value;
  }
  const createsEmporioData =
    values.creditoSolidaleAbilitato === true ||
    values.magazzinoEmporioPreferitoId != null ||
    quota.quotaChanged ||
    quota.motivoChanged;
  if (createsEmporioData && !(await isEmporioEnabled())) {
    return { error: EMPORIO_DISABLED_MSG, status: 403 };
  }
  const createsUdsData =
    values.uds === true ||
    ("zonaUdsId" in b && values.zonaUdsId != null) ||
    (zid != null && values.zonaUdsId != null);
  if (createsUdsData && !(await isUnitaStradaEnabled())) {
    return { error: UNITA_STRADA_DISABLED_MSG, status: 403 };
  }
  try {
    const [row] = await db.insert(beneficiariTable).values(values as typeof beneficiariTable.$inferInsert).returning();
    return { row };
  } catch (e) {
    if (isCodiceBeneficiarioUniqueViolation(e)) return { error: CODICE_BENEFICIARIO_DUPLICATO_MSG, status: 409 };
    throw e;
  }
}

router.post("/beneficiari", async (req, res) => {
  const r = await createBeneficiarioOne(req.body, req);
  if ("error" in r) { res.status(r.status ?? 400).json({ error: r.error }); return; }
  res.status(201).json(fmtBenef(
    r.row,
    null,
    null,
    await magazzinoEmporioNomeOf(r.row.magazzinoEmporioPreferitoId),
  ));
});

router.post("/beneficiari/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createBeneficiarioOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

// Fuzzy person-duplicate suggestion (pg_trgm). Scoped HARD to the caller's città
// so a duplicate is never surfaced across cities. Returns candidates ordered by a
// combined similarity score over name(+reversed), soprannome, telefono and an
// exact birthdate boost. MUST stay registered before "/beneficiari/:id" so the
// literal segment is not captured as an id.
router.get("/beneficiari/cerca-simili", async (req, res) => {
  const q = req.query as Record<string, string>;
  const nome = (q.nome ?? "").trim();
  const cognome = (q.cognome ?? "").trim();
  const soprannome = (q.soprannome ?? "").trim().toLowerCase();
  const telefono = (q.telefono ?? "").trim();
  const dataNascita = (q.dataNascita ?? "").trim();
  const full = `${nome} ${cognome}`.trim().toLowerCase();
  const toIntOrNull = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = parseInt(v);
    return Number.isNaN(n) ? null : n;
  };
  const excludeId = toIntOrNull(q.excludeId);

  // Nothing to match on → empty result (avoids returning the whole città).
  if (!full && !soprannome && !telefono && !dataNascita) {
    res.json([]);
    return;
  }

  // Città is the HARD boundary: a scoped caller can only search their own città
  // (or NULL/legacy rows); zona is HARD when present on the caller. Global
  // callers may narrow with ?cittaId / ?zonaUdsId.
  const callerCitta = callerCittaId(req);
  const cittaId = callerCitta != null ? callerCitta : toIntOrNull(q.cittaId);
  const callerZona = callerZonaUdsId(req);
  const zonaId = callerZona != null ? callerZona : toIntOrNull(q.zonaUdsId);

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        b.id, b.codice, b.nome, b.cognome, b.soprannome,
        b.data_nascita::text AS "dataNascita", b.telefono,
        b.citta_id AS "cittaId", c.nome AS "cittaNome",
        b.zona_uds_id AS "zonaUdsId", z.nome AS "zonaUdsNome",
        b.centro_ascolto_id AS "centroAscoltoId", ca.nome AS "centroAscoltoNome",
        b.uds AS "uds",
        (
          GREATEST(
            similarity(lower(coalesce(b.nome, '') || ' ' || coalesce(b.cognome, '')), ${full}),
            similarity(lower(coalesce(b.cognome, '') || ' ' || coalesce(b.nome, '')), ${full})
          )
          + CASE WHEN ${soprannome} <> '' THEN similarity(lower(coalesce(b.soprannome, '')), ${soprannome}) * 0.5 ELSE 0 END
          + CASE WHEN ${telefono} <> '' THEN (CASE WHEN b.telefono = ${telefono} THEN 0.5 ELSE similarity(coalesce(b.telefono, ''), ${telefono}) * 0.3 END) ELSE 0 END
          + CASE WHEN ${dataNascita} <> '' AND b.data_nascita IS NOT NULL AND b.data_nascita::text = ${dataNascita} THEN 0.4 ELSE 0 END
        )::float8 AS score
      FROM beneficiari b
      LEFT JOIN citta c ON c.id = b.citta_id
      LEFT JOIN zone_uds z ON z.id = b.zona_uds_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = b.centro_ascolto_id
      WHERE (${cittaId}::int IS NULL OR b.citta_id = ${cittaId}::int OR b.citta_id IS NULL)
        AND (${zonaId}::int IS NULL OR b.zona_uds_id = ${zonaId}::int)
        AND (${excludeId}::int IS NULL OR b.id <> ${excludeId}::int)
    ) s
    WHERE s.score >= 0.2
    ORDER BY s.score DESC
    LIMIT 10
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    id: r.id,
    codice: r.codice,
    nome: r.nome,
    cognome: r.cognome,
    soprannome: (r.soprannome as string | null) ?? null,
    dataNascita: (r.dataNascita as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    cittaId: (r.cittaId as number | null) ?? null,
    cittaNome: (r.cittaNome as string | null) ?? null,
    zonaUdsId: (r.zonaUdsId as number | null) ?? null,
    zonaUdsNome: (r.zonaUdsNome as string | null) ?? null,
    centroAscoltoId: (r.centroAscoltoId as number | null) ?? null,
    centroAscoltoNome: (r.centroAscoltoNome as string | null) ?? null,
    uds: Boolean(r.uds),
    score: Math.round(Number(r.score) * 100) / 100,
  })));
});

router.get("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(row.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }

  let centroNome: string | null = null;
  if (row.centroAscoltoId) {
    const [c] = await db.select({ nome: centriAscoltoTable.nome }).from(centriAscoltoTable).where(eq(centriAscoltoTable.id, row.centroAscoltoId));
    centroNome = c?.nome ?? null;
  }

  const nucleo = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  const interventi = await db.select().from(interventiTable).where(eq(interventiTable.beneficiarioId, id)).limit(20);
  const consegne = await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, id)).limit(20);

  res.json({
    ...fmtBenef(row, centroNome, null, await magazzinoEmporioNomeOf(row.magazzinoEmporioPreferitoId)),
    nucleo: nucleo.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null })),
    interventi: interventi.map(i => ({
      id: i.id,
      beneficiarioId: i.beneficiarioId,
      beneficiarioNome: `${row.cognome} ${row.nome}`,
      bollaId: i.bollaId ?? null,
      dataIntervento: i.dataIntervento,
      tipoIntervento: i.tipoIntervento,
      descrizione: i.descrizione ?? null,
      esito: i.esito ?? null,
      prossimAzione: i.prossimAzione ?? null,
      note: i.note ?? null,
      dataFollowup: i.dataFollowup ?? null,
      dataCreazione: i.dataCreazione.toISOString(),
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

router.patch("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(existing.zonaUdsId, zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }
  const updates = { ...req.body, dataAggiornamento: new Date() };
  if (hasFutureBirthDate(updates.dataNascita)) {
    res.status(400).json({ error: DATA_NASCITA_FUTURA_MSG });
    return;
  }
  delete updates.creditoSolidaleSaldo;
  delete updates.creditoSolidaleDataUltimoMovimento;
  if ("uds" in updates) updates.uds = toBool(updates.uds);
  const credito = normalizeCreditoSolidaleFields(updates, req.body as Record<string, unknown>, existing);
  if (credito.error) {
    res.status(400).json({ error: credito.error });
    return;
  }
  const quota = normalizeCreditoSolidaleQuotaFields(updates, req.body as Record<string, unknown>, existing);
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
    if (creditoSolidaleAbilitatoFinale && existing.centroAscoltoId == null) {
      updates.centroAscoltoId = caller;
    } else {
      delete updates.centroAscoltoId;
    }
  }
  if (cid != null) delete updates.cittaId;
  if (zid != null) updates.zonaUdsId = zid;

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
  // Mirror the POST città-HARD-boundary guard: a UDS person must never end up
  // with a null città (cross-città visibility leak). A scoped caller auto-pins
  // their own città (even on legacy null-città rows); a global caller must
  // supply one explicitly.
  const resultingUds = "uds" in updates ? updates.uds === true : existing.uds === true;
  const resultingCitta = "cittaId" in updates ? updates.cittaId : existing.cittaId;
  if (resultingUds && resultingCitta == null) {
    if (cid != null) {
      updates.cittaId = cid;
    } else {
      res.status(400).json({ error: "La città è obbligatoria per una persona UDS" });
      return;
    }
  }
  try {
    const [row] = await db.update(beneficiariTable).set(updates).where(eq(beneficiariTable.id, id)).returning();
    res.json(fmtBenef(
      row,
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

router.delete("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(existing.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }
  await db.delete(beneficiariTable).where(eq(beneficiariTable.id, id));
  res.status(204).send();
});

router.get("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const rows = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  res.json(rows.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null, tagliaVestiti: n.tagliaVestiti ?? null, numeroScarpe: n.numeroScarpe ?? null })));
});

router.post("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const [row] = await db.insert(nucleoFamiliareTable).values({ ...req.body, beneficiarioId: id }).returning();
  res.status(201).json(row);
});

router.delete("/beneficiari/:id/nucleo/:membroId", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  await db
    .delete(nucleoFamiliareTable)
    .where(and(eq(nucleoFamiliareTable.id, parseInt(req.params.membroId)), eq(nucleoFamiliareTable.beneficiarioId, id)));
  res.status(204).send();
});

export default router;
