import { Router, type IRouter, type Request } from "express";
import {
  beneficiariTable,
  bisogniPianificatiTable,
  centriAscoltoTable,
  db,
  interventiStoricoStatiTable,
  interventiTable,
  ruoliTable,
  utentiTable,
  type BisognoPianificato,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
} from "../lib/centroScope";
import {
  canTransitionIntervento,
  dataCivileEuropeRome,
  isDateOnly,
  isInterventoAmbito,
  isInterventoPriorita,
  isInterventoStato,
  parseIsoTimestamp,
  type InterventoAmbito,
  type InterventoStato,
} from "../lib/interventiWorkflow";
import {
  condizioneVistaInterventi,
  INTERVENTO_ORDINAMENTI,
  INTERVENTO_VISTE,
  intervalloDateEuropeRome,
  intervalloOggiEuropeRome,
  prioritaOrdineSql,
  type InterventoOrdinamento,
  type InterventoVista,
} from "../lib/interventiViste";

const router: IRouter = Router();

const BISOGNO_TIPI = ["richiesta", "azione"] as const;
const BISOGNO_STATI = [
  "da_pianificare",
  "pianificato",
  "completato",
  "annullato",
] as const;
const BISOGNO_PRIORITA = ["bassa", "normale", "alta", "urgente"] as const;
const BISOGNO_STATI_APERTI = new Set<string>(["da_pianificare", "pianificato"]);

type BisognoTipo = (typeof BISOGNO_TIPI)[number];
type BisognoStato = (typeof BISOGNO_STATI)[number];
type BisognoPriorita = (typeof BISOGNO_PRIORITA)[number];
type InterventoRow = typeof interventiTable.$inferSelect;

interface BisognoInput {
  id?: number;
  tipo?: unknown;
  descrizione?: unknown;
  stato?: unknown;
  dataPrevista?: unknown;
  priorita?: unknown;
  note?: unknown;
}

interface BisogniSummary {
  totale: number;
  aperti: number;
  scaduti: number;
  prossimaScadenza: string | null;
}

interface InterventoDisplayDetails {
  beneficiarioCodice?: string | null;
  nucleoFamiliareSintesi?: string | null;
  centroAscoltoId?: number | null;
  centroAscoltoNome?: string | null;
  cittaId?: number | null;
  operatoreNome?: string | null;
}

interface WorkflowCreateResult {
  legacy: boolean;
  values: Pick<
    typeof interventiTable.$inferInsert,
    | "stato"
    | "ambito"
    | "priorita"
    | "dataIntervento"
    | "dataOraPianificata"
    | "dataOraAvvio"
    | "dataOraConclusione"
    | "sede"
    | "motivoAnnullamento"
    | "dataAggiornamento"
  >;
}

class RouteError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parsePositiveInteger(value: unknown): number | null {
  if (typeof value === "number")
    return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function oggiEuropeRome(referenceDate = new Date()): string {
  return dataCivileEuropeRome(referenceDate);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new RouteError(400, `Valore non valido per ${field}`);
  }
  return value as T;
}

function nullableText(
  value: unknown,
  field: string,
  maxLength: number,
): string | null {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw new RouteError(400, `${field} non valido`);
  }
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) {
    throw new RouteError(
      400,
      `${field} non può superare ${maxLength} caratteri`,
    );
  }
  return normalized;
}

function workflowCreateValues(
  body: Record<string, unknown>,
  now = new Date(),
): WorkflowCreateResult {
  const legacy = !hasOwn(body, "stato");
  if (
    hasOwn(body, "registrazionePregressa") &&
    typeof body.registrazionePregressa !== "boolean"
  ) {
    throw new RouteError(400, "registrazionePregressa non valida");
  }
  const registrazionePregressa = body.registrazionePregressa === true;
  const stato: InterventoStato = legacy
    ? "concluso"
    : isInterventoStato(body.stato)
      ? body.stato
      : (() => {
          throw new RouteError(400, "Stato dell'intervento non valido");
        })();

  let ambito: InterventoAmbito | null = null;
  if (hasOwn(body, "ambito")) {
    if (!isInterventoAmbito(body.ambito)) {
      throw new RouteError(400, "Ambito dell'intervento non valido");
    }
    ambito = body.ambito;
  } else if (!legacy) {
    throw new RouteError(
      400,
      "L'ambito è obbligatorio per i nuovi interventi di workflow",
    );
  }

  const priorita = hasOwn(body, "priorita")
    ? isInterventoPriorita(body.priorita)
      ? body.priorita
      : (() => {
          throw new RouteError(400, "Priorità dell'intervento non valida");
        })()
    : "normale";

  let dataIntervento: string | null = null;
  if (body.dataIntervento != null && body.dataIntervento !== "") {
    if (
      typeof body.dataIntervento !== "string" ||
      !isDateOnly(body.dataIntervento)
    ) {
      throw new RouteError(400, "dataIntervento non valida");
    }
    dataIntervento = body.dataIntervento;
  } else if (legacy) {
    throw new RouteError(
      400,
      "dataIntervento è obbligatoria per il payload legacy",
    );
  }

  let dataOraPianificata: Date | null;
  let dataOraAvvio: Date | null;
  let dataOraConclusione: Date | null;
  try {
    dataOraPianificata = parseIsoTimestamp(
      body.dataOraPianificata,
      "dataOraPianificata",
    );
    dataOraAvvio = parseIsoTimestamp(body.dataOraAvvio, "dataOraAvvio");
    dataOraConclusione = parseIsoTimestamp(
      body.dataOraConclusione,
      "dataOraConclusione",
    );
  } catch (error) {
    throw new RouteError(
      400,
      error instanceof Error ? error.message : "Timestamp non valido",
    );
  }

  const motivoAnnullamento = nullableText(
    body.motivoAnnullamento,
    "Il motivo dell'annullamento",
    2000,
  );
  const sede = nullableText(body.sede, "La sede", 255);

  if (!legacy) {
    if (stato === "pianificato" && dataOraPianificata == null) {
      throw new RouteError(
        400,
        "Un intervento pianificato richiede data e ora pianificate",
      );
    }
    if (stato === "in_corso") {
      dataOraAvvio ??= now;
    }
    if (registrazionePregressa) {
      if (
        stato !== "concluso" ||
        ambito !== "sociale" ||
        dataIntervento == null
      ) {
        throw new RouteError(
          400,
          "La registrazione pregressa richiede stato concluso, ambito sociale e data dell'intervento",
        );
      }
      if (dataOraAvvio != null || dataOraConclusione != null) {
        throw new RouteError(
          400,
          "La registrazione pregressa non accetta orari effettivi inventati",
        );
      }
    } else if (stato === "concluso") {
      if (dataOraAvvio == null || dataOraConclusione == null) {
        throw new RouteError(
          400,
          "Un nuovo intervento concluso richiede avvio e conclusione effettivi",
        );
      }
      if (dataOraConclusione < dataOraAvvio) {
        throw new RouteError(400, "La conclusione non può precedere l'avvio");
      }
    }
    if (stato === "annullato" && motivoAnnullamento == null) {
      throw new RouteError(400, "Il motivo dell'annullamento è obbligatorio");
    }
    if (stato === "mancata_presentazione" && dataOraPianificata == null) {
      throw new RouteError(
        400,
        "La mancata presentazione richiede una pianificazione",
      );
    }
    if (
      dataIntervento == null &&
      (stato === "in_corso" || stato === "concluso") &&
      dataOraAvvio != null
    ) {
      dataIntervento = dataCivileEuropeRome(dataOraAvvio);
    }
  } else {
    dataOraPianificata = null;
    dataOraAvvio = null;
    dataOraConclusione = null;
  }

  return {
    legacy,
    values: {
      stato,
      ambito,
      priorita,
      dataIntervento,
      dataOraPianificata,
      dataOraAvvio,
      dataOraConclusione,
      sede,
      motivoAnnullamento,
      dataAggiornamento: now,
    },
  };
}

function normalizeBisogno(
  input: BisognoInput,
  existing?: BisognoPianificato,
): Omit<
  typeof bisogniPianificatiTable.$inferInsert,
  "id" | "interventoId" | "dataCreazione"
> {
  if (!input || typeof input !== "object") {
    throw new RouteError(400, "Bisogno Pianificato non valido");
  }

  const tipo = enumValue(
    input.tipo ?? existing?.tipo,
    BISOGNO_TIPI,
    "tipo",
  ) as BisognoTipo;
  const stato = enumValue(
    input.stato ?? existing?.stato ?? "da_pianificare",
    BISOGNO_STATI,
    "stato",
  ) as BisognoStato;
  const priorita = enumValue(
    input.priorita ?? existing?.priorita ?? "normale",
    BISOGNO_PRIORITA,
    "priorità",
  ) as BisognoPriorita;

  const rawDescrizione = input.descrizione ?? existing?.descrizione;
  if (
    typeof rawDescrizione !== "string" ||
    rawDescrizione.trim().length === 0
  ) {
    throw new RouteError(
      400,
      "La descrizione del Bisogno Pianificato è obbligatoria",
    );
  }
  const descrizione = rawDescrizione.trim();
  if (descrizione.length > 500) {
    throw new RouteError(400, "La descrizione non può superare 500 caratteri");
  }

  let dataPrevista = existing?.dataPrevista ?? null;
  if (hasOwn(input, "dataPrevista")) {
    if (input.dataPrevista == null || input.dataPrevista === "")
      dataPrevista = null;
    else if (
      typeof input.dataPrevista === "string" &&
      isDateOnly(input.dataPrevista)
    ) {
      dataPrevista = input.dataPrevista;
    } else {
      throw new RouteError(400, "La data prevista non è valida");
    }
  }
  if (stato === "pianificato" && dataPrevista == null) {
    throw new RouteError(
      400,
      "Un Bisogno Pianificato con stato pianificato richiede una data prevista",
    );
  }

  let note = existing?.note ?? null;
  if (hasOwn(input, "note")) {
    if (input.note == null || input.note === "") note = null;
    else if (typeof input.note === "string") note = input.note.trim() || null;
    else throw new RouteError(400, "Le note non sono valide");
  }
  if (note != null && note.length > 2000) {
    throw new RouteError(400, "Le note non possono superare 2000 caratteri");
  }

  let dataCompletamento = existing?.dataCompletamento ?? null;
  if (stato === "completato" && existing?.stato !== "completato") {
    dataCompletamento = new Date();
  } else if (stato !== "completato") {
    dataCompletamento = null;
  }

  return {
    tipo,
    descrizione,
    stato,
    dataPrevista,
    priorita,
    note,
    dataCompletamento,
    dataAggiornamento: new Date(),
  };
}

function cleanInterventoBody(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const allowed = [
    "beneficiarioId",
    "bollaId",
    "dataIntervento",
    "tipoIntervento",
    "descrizione",
    "esito",
    "prossimAzione",
    "note",
    "noteUds",
    "dataFollowup",
    "scadenzaIsee",
    "scadenzaRinnovo",
    "scadenzaAutodichiarazioneIndigenza",
  ];
  return Object.fromEntries(
    allowed.filter((key) => hasOwn(input, key)).map((key) => [key, input[key]]),
  );
}

function formatBisogno(row: BisognoPianificato) {
  return {
    ...row,
    dataCompletamento: row.dataCompletamento?.toISOString() ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

const emptySummary = (): BisogniSummary => ({
  totale: 0,
  aperti: 0,
  scaduti: 0,
  prossimaScadenza: null,
});

function summarizeBisogni(
  rows: BisognoPianificato[],
  today = oggiEuropeRome(),
): BisogniSummary {
  const openRows = rows.filter((row) => BISOGNO_STATI_APERTI.has(row.stato));
  const dates = openRows
    .map((row) => row.dataPrevista)
    .filter((value): value is string => value != null)
    .sort();
  return {
    totale: rows.length,
    aperti: openRows.length,
    scaduti: openRows.filter(
      (row) => row.dataPrevista != null && row.dataPrevista < today,
    ).length,
    prossimaScadenza: dates[0] ?? null,
  };
}

function formatIntervento(
  row: InterventoRow,
  summary: BisogniSummary,
  beneficiarioNome: string | null = null,
  operatoreCodice: string | null = null,
  successoriIds: number[] = [],
  details: InterventoDisplayDetails = {},
) {
  return {
    id: row.id,
    beneficiarioId: row.beneficiarioId,
    beneficiarioNome,
    beneficiarioCodice: details.beneficiarioCodice ?? null,
    nucleoFamiliareSintesi: details.nucleoFamiliareSintesi ?? null,
    bollaId: row.bollaId ?? null,
    operatoreId: row.operatoreId ?? null,
    operatoreCodice,
    operatoreNome: details.operatoreNome ?? null,
    centroAscoltoId: details.centroAscoltoId ?? null,
    centroAscoltoNome: details.centroAscoltoNome ?? null,
    cittaId: details.cittaId ?? null,
    dataIntervento: row.dataIntervento ?? null,
    tipoIntervento: row.tipoIntervento,
    descrizione: row.descrizione ?? null,
    esito: row.esito ?? null,
    prossimAzione: row.prossimAzione ?? null,
    note: row.note ?? null,
    noteUds: row.noteUds ?? null,
    dataFollowup: row.dataFollowup ?? null,
    scadenzaIsee: row.scadenzaIsee ?? null,
    scadenzaRinnovo: row.scadenzaRinnovo ?? null,
    scadenzaAutodichiarazioneIndigenza:
      row.scadenzaAutodichiarazioneIndigenza ?? null,
    stato: row.stato,
    ambito: row.ambito ?? null,
    ambitoLegacy: row.ambito == null,
    priorita: row.priorita,
    dataOraPianificata: row.dataOraPianificata?.toISOString() ?? null,
    dataOraAvvio: row.dataOraAvvio?.toISOString() ?? null,
    dataOraConclusione: row.dataOraConclusione?.toISOString() ?? null,
    interventoPrecedenteId: row.interventoPrecedenteId ?? null,
    successoriIds,
    numeroSuccessori: successoriIds.length,
    sede: row.sede ?? null,
    motivoAnnullamento: row.motivoAnnullamento ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento?.toISOString() ?? null,
    bisogniPianificatiTotale: summary.totale,
    bisogniPianificatiAperti: summary.aperti,
    bisogniPianificatiScaduti: summary.scaduti,
    bisogniPianificatiProssimaScadenza: summary.prossimaScadenza,
  };
}

async function orderedBisogni(
  interventoIds: number[],
): Promise<BisognoPianificato[]> {
  if (interventoIds.length === 0) return [];
  return db
    .select()
    .from(bisogniPianificatiTable)
    .where(inArray(bisogniPianificatiTable.interventoId, interventoIds))
    .orderBy(
      sql`${bisogniPianificatiTable.dataPrevista} asc nulls last`,
      sql`case ${bisogniPianificatiTable.priorita}
        when 'urgente' then 1 when 'alta' then 2 when 'normale' then 3 else 4 end`,
      bisogniPianificatiTable.id,
    );
}

async function summariesFor(
  interventoIds: number[],
): Promise<Map<number, BisogniSummary>> {
  const summaries = new Map<number, BisogniSummary>();
  const grouped = new Map<number, BisognoPianificato[]>();
  for (const bisogno of await orderedBisogni(interventoIds)) {
    const related = grouped.get(bisogno.interventoId) ?? [];
    related.push(bisogno);
    grouped.set(bisogno.interventoId, related);
  }
  for (const [interventoId, related] of grouped) {
    summaries.set(interventoId, summarizeBisogni(related));
  }
  return summaries;
}

async function successoriFor(
  interventoIds: number[],
): Promise<Map<number, number[]>> {
  const result = new Map<number, number[]>();
  if (interventoIds.length === 0) return result;
  const rows = await db
    .select({
      id: interventiTable.id,
      precedenteId: interventiTable.interventoPrecedenteId,
    })
    .from(interventiTable)
    .where(inArray(interventiTable.interventoPrecedenteId, interventoIds))
    .orderBy(interventiTable.id);
  for (const row of rows) {
    if (row.precedenteId == null) continue;
    const current = result.get(row.precedenteId) ?? [];
    current.push(row.id);
    result.set(row.precedenteId, current);
  }
  return result;
}

type BeneficiarioAccess = Pick<
  typeof beneficiariTable.$inferSelect,
  "id" | "uds" | "cittaId" | "centroAscoltoId" | "zonaUdsId"
>;

async function beneficiarioAccess(
  beneficiarioId: number,
): Promise<BeneficiarioAccess | null> {
  const [row] = await db
    .select({
      id: beneficiariTable.id,
      uds: beneficiariTable.uds,
      cittaId: beneficiariTable.cittaId,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      zonaUdsId: beneficiariTable.zonaUdsId,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .limit(1);
  return row ?? null;
}

function canAccessInterventoAmbito(
  ambito: string | null,
  beneficiario: BeneficiarioAccess,
  req: Request,
): boolean {
  const callerCitta = callerCittaId(req);
  if (ambito === "uds") {
    return (
      canUseInterventoArea(req, "uds") &&
      beneficiario.uds === true &&
      beneficiario.cittaId != null &&
      (callerCitta == null || beneficiario.cittaId === callerCitta)
    );
  }
  if (
    ambito == null &&
    canUseInterventoArea(req, "uds") &&
    beneficiario.uds === true &&
    beneficiario.cittaId != null &&
    (callerCitta == null || beneficiario.cittaId === callerCitta)
  ) {
    return true;
  }
  return (
    canUseInterventoArea(req, "sociale") &&
    canAccessCentro(beneficiario.centroAscoltoId, callerCentroId(req)) &&
    canAccessCitta(beneficiario.cittaId, callerCitta) &&
    canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req))
  );
}

function canUseInterventoArea(req: Request, area: InterventoAmbito): boolean {
  return (
    req.user?.isAdmin === true ||
    req.user?.isSuperAdmin === true ||
    req.user?.aree.includes(area) === true
  );
}

async function canCreateForAmbito(
  beneficiarioId: number,
  ambito: InterventoAmbito | null,
  req: Request,
): Promise<boolean> {
  const beneficiario = await beneficiarioAccess(beneficiarioId);
  return (
    beneficiario != null && canAccessInterventoAmbito(ambito, beneficiario, req)
  );
}

async function canAssignSocialOperator(
  operatoreId: number,
  beneficiarioId: number,
  req: Request,
): Promise<boolean> {
  const [target] = await db
    .select({
      id: utentiTable.id,
      attivo: utentiTable.attivo,
      isSuperAdmin: utentiTable.isSuperAdmin,
      cittaId: utentiTable.cittaId,
      centroAscoltoId: utentiTable.centroAscoltoId,
      zonaUdsId: utentiTable.zonaUdsId,
      roleAree: ruoliTable.aree,
      roleAdmin: ruoliTable.isAdmin,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(eq(utentiTable.id, operatoreId))
    .limit(1);
  if (!target?.attivo) return false;
  if (target.id === req.user!.id) return true;
  if (target.id !== req.user!.id) {
    const hasSocialArea =
      target.isSuperAdmin ||
      target.roleAdmin === true ||
      target.roleAree?.includes("sociale") === true;
    if (!hasSocialArea) return false;
  }
  const beneficiary = await beneficiarioAccess(beneficiarioId);
  if (!beneficiary) return false;
  return (
    (target.cittaId == null || target.cittaId === beneficiary.cittaId) &&
    (target.centroAscoltoId == null ||
      target.centroAscoltoId === beneficiary.centroAscoltoId) &&
    (target.zonaUdsId == null || target.zonaUdsId === beneficiary.zonaUdsId)
  );
}

async function requireAccessibleIntervento(
  interventoId: number,
  req: Request,
  expectedAmbito: InterventoAmbito | null = null,
): Promise<InterventoRow> {
  const [result] = await db
    .select({
      intervento: interventiTable,
      beneficiario: {
        id: beneficiariTable.id,
        uds: beneficiariTable.uds,
        cittaId: beneficiariTable.cittaId,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
        zonaUdsId: beneficiariTable.zonaUdsId,
      },
    })
    .from(interventiTable)
    .innerJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .where(eq(interventiTable.id, interventoId))
    .limit(1);
  if (!result) throw new RouteError(404, "Intervento non trovato");
  if (expectedAmbito === "sociale") {
    const socialAccessible =
      result.intervento.ambito !== "uds" &&
      canUseInterventoArea(req, "sociale") &&
      canAccessCentro(
        result.beneficiario.centroAscoltoId,
        callerCentroId(req),
      ) &&
      canAccessCitta(result.beneficiario.cittaId, callerCittaId(req)) &&
      canAccessZonaUds(result.beneficiario.zonaUdsId, callerZonaUdsId(req));
    if (!socialAccessible)
      throw new RouteError(403, "Intervento non accessibile");
    return result.intervento;
  }
  if (expectedAmbito === "uds") {
    const callerCitta = callerCittaId(req);
    const udsAccessible =
      result.intervento.ambito !== "sociale" &&
      canUseInterventoArea(req, "uds") &&
      result.beneficiario.uds === true &&
      result.beneficiario.cittaId != null &&
      (callerCitta == null || result.beneficiario.cittaId === callerCitta);
    if (!udsAccessible) throw new RouteError(403, "Intervento non accessibile");
    return result.intervento;
  }
  if (
    !canAccessInterventoAmbito(
      result.intervento.ambito,
      result.beneficiario,
      req,
    )
  ) {
    throw new RouteError(403, "Intervento non accessibile");
  }
  return result.intervento;
}

async function displayDetailsForIntervento(interventoId: number) {
  const [row] = await db
    .select({
      beneficiarioNome: sql<string>`${beneficiariTable.cognome} || ' ' || ${beneficiariTable.nome}`,
      beneficiarioCodice: beneficiariTable.codice,
      numComponenti: beneficiariTable.numComponenti,
      numMinori: beneficiariTable.numMinori,
      numAnziani: beneficiariTable.numAnziani,
      numDisabili: beneficiariTable.numDisabili,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: beneficiariTable.cittaId,
      operatoreCodice: sql<
        string | null
      >`coalesce(${utentiTable.matricola}, ${utentiTable.username})`,
      operatoreNome: sql<
        string | null
      >`nullif(trim(coalesce(${utentiTable.nome}, '') || ' ' || coalesce(${utentiTable.cognome}, '')), '')`,
    })
    .from(interventiTable)
    .innerJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(utentiTable, eq(interventiTable.operatoreId, utentiTable.id))
    .leftJoin(
      centriAscoltoTable,
      eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .where(eq(interventiTable.id, interventoId))
    .limit(1);
  if (!row) return null;
  return {
    beneficiarioNome: row.beneficiarioNome,
    operatoreCodice: row.operatoreCodice,
    details: {
      beneficiarioCodice: row.beneficiarioCodice,
      nucleoFamiliareSintesi: nucleoFamiliareSintesi(row),
      centroAscoltoId: row.centroAscoltoId,
      centroAscoltoNome: row.centroAscoltoNome,
      cittaId: row.cittaId,
      operatoreNome: row.operatoreNome,
    } satisfies InterventoDisplayDetails,
  };
}

async function canManageBisogniForBeneficiario(
  beneficiarioId: number,
  req: Request,
): Promise<boolean> {
  if (!canUseInterventoArea(req, "uds")) return false;
  const [beneficiario] = await db
    .select({ uds: beneficiariTable.uds, cittaId: beneficiariTable.cittaId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .limit(1);
  if (
    !beneficiario ||
    beneficiario.uds !== true ||
    beneficiario.cittaId == null
  )
    return false;
  const callerCitta = callerCittaId(req);
  return callerCitta == null || beneficiario.cittaId === callerCitta;
}

async function requireManageableUdsIntervento(
  interventoId: number,
  req: Request,
): Promise<InterventoRow> {
  if (!canUseInterventoArea(req, "uds")) {
    throw new RouteError(403, "Intervento UDS non accessibile");
  }
  const [result] = await db
    .select({
      intervento: interventiTable,
      uds: beneficiariTable.uds,
      cittaId: beneficiariTable.cittaId,
    })
    .from(interventiTable)
    .leftJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .where(eq(interventiTable.id, interventoId))
    .limit(1);
  if (!result) throw new RouteError(404, "Intervento non trovato");
  if (
    result.uds !== true ||
    result.cittaId == null ||
    result.intervento.ambito === "sociale"
  ) {
    throw new RouteError(
      403,
      "Intervento UDS non accessibile per la tua città",
    );
  }
  const callerCitta = callerCittaId(req);
  if (callerCitta != null && result.cittaId !== callerCitta) {
    throw new RouteError(
      403,
      "Intervento UDS non accessibile per la tua città",
    );
  }
  return result.intervento;
}

async function validateInterventoPrecedente(
  precedenteId: number | null,
  beneficiarioId: number,
  currentId: number | null = null,
): Promise<void> {
  if (precedenteId == null) return;
  if (currentId != null && precedenteId === currentId) {
    throw new RouteError(400, "Un intervento non può riferirsi a sé stesso");
  }
  let cursor: number | null = precedenteId;
  const visited = new Set<number>();
  while (cursor != null) {
    if (visited.has(cursor) || (currentId != null && cursor === currentId)) {
      throw new RouteError(400, "Il collegamento creerebbe una catena ciclica");
    }
    visited.add(cursor);
    const [row] = await db
      .select({
        beneficiarioId: interventiTable.beneficiarioId,
        precedenteId: interventiTable.interventoPrecedenteId,
      })
      .from(interventiTable)
      .where(eq(interventiTable.id, cursor))
      .limit(1);
    if (!row) {
      throw new RouteError(404, "Intervento precedente non trovato");
    }
    if (row.beneficiarioId !== beneficiarioId) {
      throw new RouteError(
        400,
        "Intervento precedente e successivo devono appartenere allo stesso beneficiario",
      );
    }
    cursor = row.precedenteId;
  }
}

function formatStoricoStato(
  row: typeof interventiStoricoStatiTable.$inferSelect,
) {
  return {
    id: row.id,
    interventoId: row.interventoId,
    statoPrecedente: row.statoPrecedente ?? null,
    statoNuovo: row.statoNuovo,
    operatoreId: row.operatoreId ?? null,
    dataTransizione: row.dataTransizione.toISOString(),
    motivo: row.motivo ?? null,
  };
}

function sendRouteError(
  error: unknown,
  res: { status: (status: number) => { json: (body: unknown) => void } },
) {
  if (error instanceof RouteError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  return false;
}

function nucleoFamiliareSintesi(input: {
  numComponenti: number | null;
  numMinori: number | null;
  numAnziani: number | null;
  numDisabili: number | null;
}): string {
  const numComponenti = input.numComponenti ?? 1;
  const numMinori = input.numMinori ?? 0;
  const numAnziani = input.numAnziani ?? 0;
  const numDisabili = input.numDisabili ?? 0;
  const details = [
    numMinori > 0 ? `${numMinori} minori` : null,
    numAnziani > 0 ? `${numAnziani} anziani` : null,
    numDisabili > 0 ? `${numDisabili} con disabilità` : null,
  ].filter((value): value is string => value != null);
  return `${numComponenti} componenti${details.length > 0 ? ` · ${details.join(" · ")}` : ""}`;
}

function socialScopeConditions(
  req: Request,
  query: Record<string, string | undefined>,
): SQL[] {
  if (!canUseInterventoArea(req, "sociale")) {
    throw new RouteError(403, "Ambito sociale non consentito");
  }
  const conditions: SQL[] = [];
  const callerCentro = callerCentroId(req);
  const callerCitta = callerCittaId(req);
  const callerZona = callerZonaUdsId(req);

  if (callerCentro == null && query.centroAscoltoId) {
    const centro = parsePositiveInteger(query.centroAscoltoId);
    if (centro == null) throw new RouteError(400, "centroAscoltoId non valido");
    conditions.push(eq(beneficiariTable.centroAscoltoId, centro));
  }
  if (callerCitta == null && query.cittaId) {
    const citta = parsePositiveInteger(query.cittaId);
    if (citta == null) throw new RouteError(400, "cittaId non valido");
    conditions.push(eq(beneficiariTable.cittaId, citta));
  }
  const scoped = [
    cittaScopeFilter(beneficiariTable.cittaId, callerCitta),
    centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentro),
    zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZona),
  ].filter((condition): condition is SQL => condition != null);
  if (scoped.length > 0) conditions.push(and(...scoped)!);
  return conditions;
}

function socialAmbitoCondition(value: string | undefined): SQL {
  if (value && !["tutti", "classificati", "legacy"].includes(value)) {
    throw new RouteError(400, "ambitoLegacy non valido");
  }
  if (value === "classificati") return eq(interventiTable.ambito, "sociale");
  if (value === "legacy") return isNull(interventiTable.ambito);
  return or(
    eq(interventiTable.ambito, "sociale"),
    isNull(interventiTable.ambito),
  )!;
}

function commonSocialFilterConditions(
  req: Request,
  query: Record<string, string | undefined>,
): SQL[] {
  const conditions = [
    socialAmbitoCondition(query.ambitoLegacy),
    ...socialScopeConditions(req, query),
  ];
  if (query.tipo) {
    const tokenMatch = or(
      eq(interventiTable.tipoIntervento, query.tipo),
      ilike(interventiTable.tipoIntervento, `${query.tipo},%`),
      ilike(interventiTable.tipoIntervento, `%,${query.tipo}`),
      ilike(interventiTable.tipoIntervento, `%,${query.tipo},%`),
    );
    if (tokenMatch) conditions.push(tokenMatch);
  }
  if (query.priorita) {
    if (!isInterventoPriorita(query.priorita)) {
      throw new RouteError(400, "priorita non valida");
    }
    conditions.push(eq(interventiTable.priorita, query.priorita));
  }
  if (query.operatoreId) {
    const operatore = parsePositiveInteger(query.operatoreId);
    if (operatore == null) throw new RouteError(400, "operatoreId non valido");
    conditions.push(eq(interventiTable.operatoreId, operatore));
  }
  if (query.beneficiarioId) {
    const beneficiario = parsePositiveInteger(query.beneficiarioId);
    if (beneficiario == null)
      throw new RouteError(400, "beneficiarioId non valido");
    conditions.push(eq(interventiTable.beneficiarioId, beneficiario));
  }
  const ricerca = query.ricerca?.trim();
  if (ricerca) {
    if (ricerca.length > 120) throw new RouteError(400, "ricerca troppo lunga");
    const like = `%${ricerca}%`;
    conditions.push(
      or(
        ilike(beneficiariTable.nome, like),
        ilike(beneficiariTable.cognome, like),
        ilike(
          sql`${beneficiariTable.nome} || ' ' || ${beneficiariTable.cognome}`,
          like,
        ),
        ilike(
          sql`${beneficiariTable.cognome} || ' ' || ${beneficiariTable.nome}`,
          like,
        ),
        ilike(beneficiariTable.codice, like),
      )!,
    );
  }
  if (query.stato) {
    if (!isInterventoStato(query.stato))
      throw new RouteError(400, "stato non valido");
    conditions.push(eq(interventiTable.stato, query.stato));
  }
  if (query.da || query.a) {
    if (!query.da || !query.a) {
      throw new RouteError(400, "da e a devono essere specificati insieme");
    }
    let range: { start: Date; end: Date };
    try {
      range = intervalloDateEuropeRome(query.da, query.a);
    } catch (error) {
      throw new RouteError(
        400,
        error instanceof Error ? error.message : "Intervallo non valido",
      );
    }
    const referenceDate = sql`coalesce(
      ${interventiTable.dataOraPianificata},
      ${interventiTable.dataOraConclusione},
      ${interventiTable.dataOraAvvio},
      ${interventiTable.dataIntervento}::timestamp at time zone 'Europe/Rome',
      ${interventiTable.dataCreazione} at time zone 'Europe/Rome'
    )`;
    conditions.push(
      sql`${referenceDate} >= ${range.start} and ${referenceDate} < ${range.end}`,
    );
  }
  return conditions;
}

function parseVista(value: string | undefined): InterventoVista | null {
  if (!value) return null;
  if (!INTERVENTO_VISTE.includes(value as InterventoVista)) {
    throw new RouteError(400, "vista non valida");
  }
  return value as InterventoVista;
}

function parseOrdinamento(
  value: string | undefined,
): InterventoOrdinamento | null {
  if (!value) return null;
  if (!INTERVENTO_ORDINAMENTI.includes(value as InterventoOrdinamento)) {
    throw new RouteError(400, "ordinamento non valido");
  }
  return value as InterventoOrdinamento;
}

function interventiOrderBy(
  vista: InterventoVista | null,
  ordinamento: InterventoOrdinamento | null,
  direzione: "asc" | "desc",
): SQL[] {
  const direction = direzione === "asc" ? asc : desc;
  if (ordinamento === "priorita") {
    return [direction(prioritaOrdineSql()), desc(interventiTable.id)];
  }
  if (ordinamento === "beneficiario") {
    return [
      direction(sql`lower(${beneficiariTable.cognome})`),
      direction(sql`lower(${beneficiariTable.nome})`),
      desc(interventiTable.id),
    ];
  }
  if (ordinamento === "operatore") {
    return [
      direction(
        sql`lower(coalesce(${utentiTable.cognome}, '') || ' ' || ${utentiTable.nome})`,
      ),
      desc(interventiTable.id),
    ];
  }
  if (ordinamento === "data") {
    return [
      direction(
        sql`coalesce(${interventiTable.dataOraPianificata}, ${interventiTable.dataOraConclusione}, ${interventiTable.dataOraAvvio}, ${interventiTable.dataIntervento}::timestamp at time zone 'Europe/Rome')`,
      ),
      desc(interventiTable.id),
    ];
  }
  switch (vista) {
    case "da_pianificare":
      return [
        asc(prioritaOrdineSql()),
        asc(interventiTable.dataCreazione),
        asc(interventiTable.id),
      ];
    case "pianificati":
      return [
        sql`${interventiTable.dataOraPianificata} asc nulls last`,
        asc(interventiTable.id),
      ];
    case "oggi":
      return [
        sql`coalesce(${interventiTable.dataOraPianificata}, ${interventiTable.dataOraAvvio}) asc nulls last`,
        asc(prioritaOrdineSql()),
        asc(beneficiariTable.cognome),
        asc(beneficiariTable.nome),
      ];
    case "in_corso":
      return [
        sql`${interventiTable.dataOraAvvio} asc nulls last`,
        asc(prioritaOrdineSql()),
        asc(interventiTable.id),
      ];
    case "conclusi":
      return [
        sql`${interventiTable.dataOraConclusione} desc nulls last`,
        sql`${interventiTable.dataIntervento} desc nulls last`,
        desc(interventiTable.id),
      ];
    case "annullati":
      return [
        sql`${interventiTable.dataAggiornamento} desc nulls last`,
        desc(interventiTable.id),
      ];
    default:
      return [
        sql`coalesce(${interventiTable.dataOraPianificata}, ${interventiTable.dataIntervento}::timestamp) desc nulls last`,
        desc(interventiTable.id),
      ];
  }
}

router.get("/interventi", async (req, res) => {
  const {
    beneficiarioId,
    tipo,
    centroAscoltoId,
    cittaId,
    bisogni,
    stato,
    ambito,
    includiStorici,
    operatoreId,
    priorita,
    pianificataDa,
    pianificataA,
    interventoPrecedenteId,
    vista,
    ricerca,
    da,
    a,
    ordina,
    direzione,
    ambitoLegacy,
    pagina,
    limite,
  } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  let parsedVista: InterventoVista | null;
  let parsedOrdinamento: InterventoOrdinamento | null;
  try {
    parsedVista = parseVista(vista);
    parsedOrdinamento = parseOrdinamento(ordina);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
  if (parsedVista && ambito !== "sociale") {
    res.status(400).json({ error: "vista richiede ambito=sociale" });
    return;
  }
  if (direzione && !["asc", "desc"].includes(direzione)) {
    res.status(400).json({ error: "direzione non valida" });
    return;
  }
  const requestedBeneficiarioId = beneficiarioId
    ? parsePositiveInteger(beneficiarioId)
    : null;
  if (beneficiarioId && requestedBeneficiarioId == null) {
    res.status(400).json({ error: "beneficiarioId non valido" });
    return;
  }
  if (requestedBeneficiarioId != null) {
    conditions.push(
      eq(interventiTable.beneficiarioId, requestedBeneficiarioId),
    );
  }
  if (stato && !isInterventoStato(stato)) {
    res.status(400).json({ error: "stato non valido" });
    return;
  }
  if (stato) conditions.push(eq(interventiTable.stato, stato));
  if (ambito && !isInterventoAmbito(ambito)) {
    res.status(400).json({ error: "ambito non valido" });
    return;
  }
  if (ambito && !canUseInterventoArea(req, ambito as InterventoAmbito)) {
    res.status(403).json({ error: `Ambito ${ambito} non consentito` });
    return;
  }
  if (includiStorici && !["true", "false"].includes(includiStorici)) {
    res.status(400).json({ error: "includiStorici non valido" });
    return;
  }
  const includeStorici = includiStorici === "true";
  if (includeStorici && !ambito) {
    res.status(400).json({
      error: "ambito è obbligatorio quando includiStorici è true",
    });
    return;
  }
  if (ambitoLegacy && ambito !== "sociale") {
    res.status(400).json({ error: "ambitoLegacy richiede ambito=sociale" });
    return;
  }
  if (ambito) {
    try {
      conditions.push(
        ambito === "sociale" && (includeStorici || ambitoLegacy)
          ? socialAmbitoCondition(ambitoLegacy)
          : includeStorici
            ? or(
                eq(interventiTable.ambito, ambito),
                isNull(interventiTable.ambito),
              )!
            : eq(interventiTable.ambito, ambito),
      );
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  }
  if (priorita && !isInterventoPriorita(priorita)) {
    res.status(400).json({ error: "priorita non valida" });
    return;
  }
  if (priorita) conditions.push(eq(interventiTable.priorita, priorita));
  for (const [raw, column, field] of [
    [operatoreId, interventiTable.operatoreId, "operatoreId"],
    [
      interventoPrecedenteId,
      interventiTable.interventoPrecedenteId,
      "interventoPrecedenteId",
    ],
  ] as const) {
    if (!raw) continue;
    const parsed = parsePositiveInteger(raw);
    if (parsed == null) {
      res.status(400).json({ error: `${field} non valido` });
      return;
    }
    conditions.push(eq(column, parsed));
  }
  let plannedFrom: Date | null = null;
  let plannedTo: Date | null = null;
  try {
    plannedFrom = parseIsoTimestamp(pianificataDa, "pianificataDa");
    plannedTo = parseIsoTimestamp(pianificataA, "pianificataA");
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Intervallo non valido",
    });
    return;
  }
  if (plannedFrom)
    conditions.push(gte(interventiTable.dataOraPianificata, plannedFrom));
  if (plannedTo)
    conditions.push(lte(interventiTable.dataOraPianificata, plannedTo));
  if (parsedVista) conditions.push(condizioneVistaInterventi(parsedVista));

  const beneficiarySearch = ricerca?.trim();
  if (beneficiarySearch) {
    if (beneficiarySearch.length > 120) {
      res.status(400).json({ error: "ricerca troppo lunga" });
      return;
    }
    const like = `%${beneficiarySearch}%`;
    conditions.push(
      or(
        ilike(beneficiariTable.nome, like),
        ilike(beneficiariTable.cognome, like),
        ilike(
          sql`${beneficiariTable.nome} || ' ' || ${beneficiariTable.cognome}`,
          like,
        ),
        ilike(
          sql`${beneficiariTable.cognome} || ' ' || ${beneficiariTable.nome}`,
          like,
        ),
        ilike(beneficiariTable.codice, like),
      )!,
    );
  }
  if (da || a) {
    if (!da || !a) {
      res
        .status(400)
        .json({ error: "da e a devono essere specificati insieme" });
      return;
    }
    try {
      const range = intervalloDateEuropeRome(da, a);
      const referenceDate = sql`coalesce(
        ${interventiTable.dataOraPianificata},
        ${interventiTable.dataOraConclusione},
        ${interventiTable.dataOraAvvio},
        ${interventiTable.dataIntervento}::timestamp at time zone 'Europe/Rome',
        ${interventiTable.dataCreazione} at time zone 'Europe/Rome'
      )`;
      conditions.push(
        sql`${referenceDate} >= ${range.start} and ${referenceDate} < ${range.end}`,
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Intervallo non valido",
      });
      return;
    }
  }

  const caller = callerCentroId(req);
  const callerCitta = callerCittaId(req);
  const callerZona = callerZonaUdsId(req);
  if (callerCitta == null && ambito === "uds" && !cittaId && !beneficiarioId) {
    res.status(400).json({
      error: "cittaId è obbligatorio per elencare gli interventi UDS",
    });
    return;
  }

  if (caller == null && centroAscoltoId) {
    const parsedCentro = parsePositiveInteger(centroAscoltoId);
    if (parsedCentro == null) {
      res.status(400).json({ error: "centroAscoltoId non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.centroAscoltoId, parsedCentro));
  }
  if (callerCitta == null && cittaId) {
    const parsedCitta = parsePositiveInteger(cittaId);
    if (parsedCitta == null) {
      res.status(400).json({ error: "cittaId non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.cittaId, parsedCitta));
  }
  if (caller != null || callerCitta != null || callerZona != null) {
    const scopeAlternatives: SQL[] = [];
    if (canUseInterventoArea(req, "sociale")) {
      const socialConditions = [
        or(ne(interventiTable.ambito, "uds"), isNull(interventiTable.ambito)),
        cittaScopeFilter(beneficiariTable.cittaId, callerCitta),
        centroScopeFilter(beneficiariTable.centroAscoltoId, caller),
        zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZona),
      ].filter((condition): condition is SQL => condition != null);
      scopeAlternatives.push(and(...socialConditions)!);
    }
    if (canUseInterventoArea(req, "uds") && callerCitta != null) {
      scopeAlternatives.push(
        and(
          eq(interventiTable.ambito, "uds"),
          eq(beneficiariTable.uds, true),
          eq(beneficiariTable.cittaId, callerCitta),
        )!,
      );
    }
    if (
      canUseInterventoArea(req, "uds") &&
      callerCitta != null &&
      requestedBeneficiarioId != null
    ) {
      scopeAlternatives.push(
        and(
          isNull(interventiTable.ambito),
          eq(beneficiariTable.id, requestedBeneficiarioId),
          eq(beneficiariTable.uds, true),
          eq(beneficiariTable.cittaId, callerCitta),
        )!,
      );
    }
    conditions.push(
      scopeAlternatives.length > 0 ? or(...scopeAlternatives)! : sql`false`,
    );
  } else if (!ambito) {
    const canUseSociale = canUseInterventoArea(req, "sociale");
    const canUseUds = canUseInterventoArea(req, "uds");
    if (canUseSociale && !canUseUds) {
      conditions.push(
        or(ne(interventiTable.ambito, "uds"), isNull(interventiTable.ambito))!,
      );
    } else if (canUseUds && !canUseSociale) {
      conditions.push(eq(interventiTable.ambito, "uds"));
    }
  }
  if (tipo) {
    const tokenMatch = or(
      eq(interventiTable.tipoIntervento, tipo),
      ilike(interventiTable.tipoIntervento, `${tipo},%`),
      ilike(interventiTable.tipoIntervento, `%,${tipo}`),
      ilike(interventiTable.tipoIntervento, `%,${tipo},%`),
    );
    if (tokenMatch) conditions.push(tokenMatch);
  }
  if (bisogni && !["aperti", "scaduti", "nessuno"].includes(bisogni)) {
    res.status(400).json({ error: "Filtro bisogni non valido" });
    return;
  }
  if (bisogni === "aperti") {
    conditions.push(sql`exists (
      select 1 from ${bisogniPianificatiTable}
      where ${bisogniPianificatiTable.interventoId} = ${interventiTable.id}
        and ${bisogniPianificatiTable.stato} in ('da_pianificare', 'pianificato')
    )`);
  } else if (bisogni === "scaduti") {
    conditions.push(sql`exists (
      select 1 from ${bisogniPianificatiTable}
      where ${bisogniPianificatiTable.interventoId} = ${interventiTable.id}
        and ${bisogniPianificatiTable.stato} in ('da_pianificare', 'pianificato')
        and ${bisogniPianificatiTable.dataPrevista} < ${oggiEuropeRome()}
    )`);
  } else if (bisogni === "nessuno") {
    conditions.push(sql`not exists (
      select 1 from ${bisogniPianificatiTable}
      where ${bisogniPianificatiTable.interventoId} = ${interventiTable.id}
    )`);
  }

  const parsedPage = pagina ? parsePositiveInteger(pagina) : 1;
  const parsedLimit = limite ? parsePositiveInteger(limite) : 200;
  if (parsedPage == null || parsedLimit == null || parsedLimit > 200) {
    res.status(400).json({ error: "pagina o limite non validi" });
    return;
  }
  const orderBy = interventiOrderBy(
    parsedVista,
    parsedOrdinamento,
    direzione === "desc" ? "desc" : "asc",
  );

  const rows = await db
    .select({
      i: interventiTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      codice: beneficiariTable.codice,
      numComponenti: beneficiariTable.numComponenti,
      numMinori: beneficiariTable.numMinori,
      numAnziani: beneficiariTable.numAnziani,
      numDisabili: beneficiariTable.numDisabili,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      cittaId: beneficiariTable.cittaId,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
      operatoreNome: utentiTable.nome,
      operatoreCognome: utentiTable.cognome,
    })
    .from(interventiTable)
    .leftJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(utentiTable, eq(interventiTable.operatoreId, utentiTable.id))
    .leftJoin(
      centriAscoltoTable,
      eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(...orderBy)
    .limit(parsedLimit)
    .offset((parsedPage - 1) * parsedLimit);

  const summaries = await summariesFor(rows.map((row) => row.i.id));
  const successori = await successoriFor(rows.map((row) => row.i.id));
  res.json(
    rows.map((row) =>
      formatIntervento(
        row.i,
        summaries.get(row.i.id) ?? emptySummary(),
        row.cognome && row.nome ? `${row.cognome} ${row.nome}` : null,
        row.operatoreMatricola ?? row.operatoreUsername ?? null,
        successori.get(row.i.id) ?? [],
        {
          beneficiarioCodice: row.codice,
          nucleoFamiliareSintesi: nucleoFamiliareSintesi(row),
          centroAscoltoId: row.centroAscoltoId,
          centroAscoltoNome: row.centroAscoltoNome,
          cittaId: row.cittaId,
          operatoreNome:
            [row.operatoreNome, row.operatoreCognome]
              .filter(Boolean)
              .join(" ") || null,
        },
      ),
    ),
  );
});

router.get("/interventi/riepilogo-viste", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  const referenceDate = new Date();
  let conditions: SQL[];
  try {
    conditions = commonSocialFilterConditions(req, query);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
  const [counts] = await db
    .select({
      daPianificare:
        sql<number>`count(*) filter (where ${condizioneVistaInterventi("da_pianificare", referenceDate)})`.mapWith(
          Number,
        ),
      pianificati:
        sql<number>`count(*) filter (where ${condizioneVistaInterventi("pianificati", referenceDate)})`.mapWith(
          Number,
        ),
      oggi: sql<number>`count(*) filter (where ${condizioneVistaInterventi("oggi", referenceDate)})`.mapWith(
        Number,
      ),
      inCorso:
        sql<number>`count(*) filter (where ${condizioneVistaInterventi("in_corso", referenceDate)})`.mapWith(
          Number,
        ),
      conclusi:
        sql<number>`count(*) filter (where ${condizioneVistaInterventi("conclusi", referenceDate)})`.mapWith(
          Number,
        ),
      annullati:
        sql<number>`count(*) filter (where ${condizioneVistaInterventi("annullati", referenceDate)})`.mapWith(
          Number,
        ),
    })
    .from(interventiTable)
    .innerJoin(
      beneficiariTable,
      eq(interventiTable.beneficiarioId, beneficiariTable.id),
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);
  res.json({
    daPianificare: counts?.daPianificare ?? 0,
    pianificati: counts?.pianificati ?? 0,
    oggi: counts?.oggi ?? 0,
    inCorso: counts?.inCorso ?? 0,
    conclusi: counts?.conclusi ?? 0,
    annullati: counts?.annullati ?? 0,
    dataRiferimento: intervalloOggiEuropeRome(referenceDate).date,
    fusoOrario: "Europe/Rome",
  });
});

router.get("/interventi/operatori", async (req, res) => {
  const query = req.query as Record<string, string | undefined>;
  if (!canUseInterventoArea(req, "sociale")) {
    res.status(403).json({ error: "Ambito sociale non consentito" });
    return;
  }
  const callerCitta = callerCittaId(req);
  const callerCentro = callerCentroId(req);
  const selectedCitta =
    callerCitta ?? (query.cittaId ? parsePositiveInteger(query.cittaId) : null);
  const selectedCentro =
    callerCentro ??
    (query.centroAscoltoId
      ? parsePositiveInteger(query.centroAscoltoId)
      : null);
  if (callerCitta == null && query.cittaId && selectedCitta == null) {
    res.status(400).json({ error: "cittaId non valido" });
    return;
  }
  if (selectedCitta == null) {
    res.status(400).json({
      error: "cittaId è obbligatorio per elencare gli operatori Sociali",
    });
    return;
  }
  if (callerCentro == null && query.centroAscoltoId && selectedCentro == null) {
    res.status(400).json({ error: "centroAscoltoId non valido" });
    return;
  }
  const conditions: SQL[] = [
    eq(utentiTable.attivo, true),
    or(
      eq(utentiTable.id, req.user!.id),
      eq(utentiTable.isSuperAdmin, true),
      eq(ruoliTable.isAdmin, true),
      sql`${ruoliTable.aree} ? 'sociale'`,
    )!,
    or(eq(utentiTable.cittaId, selectedCitta), isNull(utentiTable.cittaId))!,
  ];
  if (selectedCentro != null) {
    conditions.push(
      or(
        eq(utentiTable.centroAscoltoId, selectedCentro),
        isNull(utentiTable.centroAscoltoId),
      )!,
    );
  }
  const rows = await db
    .select({
      id: utentiTable.id,
      nome: utentiTable.nome,
      cognome: utentiTable.cognome,
      codice: utentiTable.matricola,
      username: utentiTable.username,
    })
    .from(utentiTable)
    .leftJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(and(...conditions))
    .orderBy(utentiTable.nome, utentiTable.cognome, utentiTable.id);
  res.json(
    rows
      .sort((left, right) =>
        `${left.nome} ${left.cognome ?? ""}`.localeCompare(
          `${right.nome} ${right.cognome ?? ""}`,
          "it",
        ),
      )
      .map((row) => ({
        id: row.id,
        nome: [row.nome, row.cognome].filter(Boolean).join(" "),
        codice: row.codice ?? row.username,
      })),
  );
});

router.post("/interventi", async (req, res) => {
  const body = req.body as Record<string, unknown>;
  let workflow: WorkflowCreateResult;
  try {
    workflow = workflowCreateValues(body);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
  const bisogniInput = body.bisogniPianificati;
  if (bisogniInput != null && !Array.isArray(bisogniInput)) {
    res.status(400).json({ error: "Bisogni Pianificati non validi" });
    return;
  }
  let normalizedBisogni: ReturnType<typeof normalizeBisogno>[] = [];
  try {
    normalizedBisogni =
      (bisogniInput as BisognoInput[] | undefined)?.map((item) =>
        normalizeBisogno(item),
      ) ?? [];
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }

  const beneficiarioId = parsePositiveInteger(body.beneficiarioId);
  if (beneficiarioId == null) {
    res.status(400).json({ error: "beneficiarioId non valido" });
    return;
  }
  if (
    !(await canCreateForAmbito(
      beneficiarioId,
      workflow.values.ambito as InterventoAmbito | null,
      req,
    ))
  ) {
    res.status(403).json({ error: "Beneficiario non accessibile" });
    return;
  }

  const assignedOperatorId =
    workflow.values.ambito === "sociale" && hasOwn(body, "operatoreId")
      ? parsePositiveInteger(body.operatoreId)
      : req.user!.id;
  if (
    assignedOperatorId == null ||
    (workflow.values.ambito === "sociale" &&
      !(await canAssignSocialOperator(assignedOperatorId, beneficiarioId, req)))
  ) {
    res.status(403).json({ error: "Operatore assegnato non accessibile" });
    return;
  }
  if (
    normalizedBisogni.length > 0 &&
    (workflow.values.ambito === "sociale" ||
      !(await canManageBisogniForBeneficiario(beneficiarioId, req)))
  ) {
    res.status(403).json({
      error:
        "I Bisogni Pianificati richiedono una persona UDS con città accessibile",
    });
    return;
  }

  let interventoPrecedenteId: number | null = null;
  if (hasOwn(body, "interventoPrecedenteId")) {
    interventoPrecedenteId =
      body.interventoPrecedenteId == null
        ? null
        : parsePositiveInteger(body.interventoPrecedenteId);
    if (body.interventoPrecedenteId != null && interventoPrecedenteId == null) {
      res.status(400).json({ error: "interventoPrecedenteId non valido" });
      return;
    }
  }
  try {
    await validateInterventoPrecedente(interventoPrecedenteId, beneficiarioId);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }

  const { intervento, bisogniCreati } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(interventiTable)
      .values({
        ...cleanInterventoBody(body),
        ...workflow.values,
        beneficiarioId,
        interventoPrecedenteId,
        operatoreId: assignedOperatorId,
      } as never)
      .returning();
    await tx.insert(interventiStoricoStatiTable).values({
      interventoId: created.id,
      statoPrecedente: null,
      statoNuovo: created.stato,
      operatoreId: req.user!.id,
      dataTransizione: workflow.values.dataAggiornamento!,
      motivo: workflow.legacy ? "Creazione da payload legacy" : null,
    });
    const createdNeeds =
      normalizedBisogni.length > 0
        ? await tx
            .insert(bisogniPianificatiTable)
            .values(
              normalizedBisogni.map((item) => ({
                ...item,
                interventoId: created.id,
              })),
            )
            .returning()
        : [];
    return { intervento: created, bisogniCreati: createdNeeds };
  });
  res
    .status(201)
    .json(formatIntervento(intervento, summarizeBisogni(bisogniCreati)));
});

router.get("/interventi/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  try {
    const row = await requireAccessibleIntervento(id, req);
    const needs = await orderedBisogni([row.id]);
    const successori = await successoriFor([row.id]);
    const display = await displayDetailsForIntervento(row.id);
    res.json(
      formatIntervento(
        row,
        summarizeBisogni(needs),
        display?.beneficiarioNome ?? null,
        display?.operatoreCodice ?? null,
        successori.get(row.id) ?? [],
        display?.details,
      ),
    );
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.patch("/interventi/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const forbiddenWorkflowFields = [
    "stato",
    "ambito",
    "dataOraAvvio",
    "dataOraConclusione",
    "motivoAnnullamento",
    "operatoreId",
  ];
  const forbiddenField = forbiddenWorkflowFields.find((field) =>
    hasOwn(body, field),
  );
  if (forbiddenField) {
    res.status(400).json({
      error: `${forbiddenField} può essere modificato soltanto tramite un'operazione di dominio`,
    });
    return;
  }
  let existing: InterventoRow;
  try {
    existing = await requireAccessibleIntervento(id, req);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
  const bisogniInput = body.bisogniPianificati;
  if (bisogniInput != null && !Array.isArray(bisogniInput)) {
    res.status(400).json({ error: "Bisogni Pianificati non validi" });
    return;
  }
  const targetBeneficiarioId =
    body.beneficiarioId == null
      ? existing.beneficiarioId
      : parsePositiveInteger(body.beneficiarioId);
  if (targetBeneficiarioId == null) {
    res.status(400).json({ error: "beneficiarioId non valido" });
    return;
  }
  if (targetBeneficiarioId !== existing.beneficiarioId) {
    if (
      !(await canCreateForAmbito(
        targetBeneficiarioId,
        existing.ambito as InterventoAmbito | null,
        req,
      ))
    ) {
      res.status(403).json({ error: "Beneficiario non accessibile" });
      return;
    }
    res.status(400).json({
      error:
        "Il beneficiario di un intervento esistente non può essere modificato",
    });
    return;
  }
  if (bisogniInput != null) {
    try {
      await requireManageableUdsIntervento(id, req);
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  }

  const workflowUpdates: Partial<typeof interventiTable.$inferInsert> = {
    dataAggiornamento: new Date(),
  };
  if (hasOwn(body, "priorita")) {
    if (!isInterventoPriorita(body.priorita)) {
      res.status(400).json({ error: "priorita non valida" });
      return;
    }
    workflowUpdates.priorita = body.priorita;
  }
  if (hasOwn(body, "sede")) {
    try {
      workflowUpdates.sede = nullableText(body.sede, "La sede", 255);
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  }
  if (hasOwn(body, "dataOraPianificata")) {
    try {
      workflowUpdates.dataOraPianificata = parseIsoTimestamp(
        body.dataOraPianificata,
        "dataOraPianificata",
      );
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Timestamp non valido",
      });
      return;
    }
    if (
      existing.stato === "pianificato" &&
      workflowUpdates.dataOraPianificata == null
    ) {
      res.status(400).json({
        error: "Un intervento pianificato richiede data e ora pianificate",
      });
      return;
    }
  }

  if (hasOwn(body, "interventoPrecedenteId")) {
    const parsed =
      body.interventoPrecedenteId == null
        ? null
        : parsePositiveInteger(body.interventoPrecedenteId);
    if (body.interventoPrecedenteId != null && parsed == null) {
      res.status(400).json({ error: "interventoPrecedenteId non valido" });
      return;
    }
    try {
      await validateInterventoPrecedente(parsed, existing.beneficiarioId, id);
      workflowUpdates.interventoPrecedenteId = parsed;
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interventiTable)
        .set({
          ...cleanInterventoBody(body),
          ...workflowUpdates,
          beneficiarioId: targetBeneficiarioId,
        } as never)
        .where(eq(interventiTable.id, id))
        .returning();

      for (const item of (bisogniInput as BisognoInput[] | undefined) ?? []) {
        const bisognoId =
          item.id == null ? null : parsePositiveInteger(item.id);
        if (item.id != null && bisognoId == null) {
          throw new RouteError(400, "id del Bisogno Pianificato non valido");
        }
        if (bisognoId == null) {
          await tx.insert(bisogniPianificatiTable).values({
            ...normalizeBisogno(item),
            interventoId: id,
          });
          continue;
        }
        const [existingNeed] = await tx
          .select()
          .from(bisogniPianificatiTable)
          .where(
            and(
              eq(bisogniPianificatiTable.id, bisognoId),
              eq(bisogniPianificatiTable.interventoId, id),
            ),
          );
        if (!existingNeed) {
          throw new RouteError(
            404,
            "Bisogno Pianificato non appartenente all'intervento",
          );
        }
        await tx
          .update(bisogniPianificatiTable)
          .set(normalizeBisogno(item, existingNeed))
          .where(eq(bisogniPianificatiTable.id, bisognoId));
      }
      return updated;
    });
    const needs = await orderedBisogni([id]);
    res.json(formatIntervento(row, summarizeBisogni(needs)));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.post("/interventi/:id/transizioni", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (!isInterventoStato(body.stato)) {
    res.status(400).json({ error: "Stato di destinazione non valido" });
    return;
  }
  let transitionDate: Date;
  let plannedDate: Date | null = null;
  let motivo: string | null;
  try {
    transitionDate =
      parseIsoTimestamp(body.dataOraTransizione, "dataOraTransizione") ??
      new Date();
    plannedDate = parseIsoTimestamp(
      body.dataOraPianificata,
      "dataOraPianificata",
    );
    motivo = nullableText(body.motivo, "Il motivo", 2000);
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error: error instanceof Error ? error.message : "Transizione non valida",
    });
    return;
  }

  try {
    await requireAccessibleIntervento(id, req);
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      if (!isInterventoStato(current.stato)) {
        throw new RouteError(409, "Stato corrente non riconosciuto");
      }
      const target = body.stato as InterventoStato;
      if (!canTransitionIntervento(current.stato, target)) {
        throw new RouteError(
          409,
          `Transizione da ${current.stato} a ${target} non consentita`,
        );
      }

      const updates: Partial<typeof interventiTable.$inferInsert> = {
        stato: target,
        dataAggiornamento: transitionDate,
      };
      if (target === "pianificato") {
        updates.dataOraPianificata = plannedDate ?? current.dataOraPianificata;
        if (updates.dataOraPianificata == null) {
          throw new RouteError(
            400,
            "La transizione a pianificato richiede data e ora pianificate",
          );
        }
      }
      if (target === "da_pianificare") {
        updates.dataOraPianificata = null;
      }
      if (target === "in_corso") {
        updates.dataOraAvvio = transitionDate;
        if (current.dataIntervento == null) {
          updates.dataIntervento = dataCivileEuropeRome(transitionDate);
        }
      }
      if (target === "concluso") {
        if (current.dataOraAvvio == null) {
          throw new RouteError(
            409,
            "Un intervento deve essere avviato prima della conclusione",
          );
        }
        if (transitionDate < current.dataOraAvvio) {
          throw new RouteError(400, "La conclusione non può precedere l'avvio");
        }
        updates.dataOraConclusione = transitionDate;
      }
      if (target === "annullato") {
        if (motivo == null) {
          throw new RouteError(
            400,
            "Il motivo dell'annullamento è obbligatorio",
          );
        }
        updates.motivoAnnullamento = motivo;
      }
      if (target === "mancata_presentazione") {
        updates.dataOraAvvio = null;
      }

      const [row] = await tx
        .update(interventiTable)
        .set(updates)
        .where(eq(interventiTable.id, id))
        .returning();
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: id,
        statoPrecedente: current.stato,
        statoNuovo: target,
        operatoreId: req.user!.id,
        dataTransizione: transitionDate,
        motivo,
      });
      return row;
    });
    const needs = await orderedBisogni([id]);
    const successori = await successoriFor([id]);
    res.json(
      formatIntervento(
        updated,
        summarizeBisogni(needs),
        null,
        null,
        successori.get(id) ?? [],
      ),
    );
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.get("/interventi/:id/storico-stati", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  try {
    await requireAccessibleIntervento(id, req);
    const rows = await db
      .select()
      .from(interventiStoricoStatiTable)
      .where(eq(interventiStoricoStatiTable.interventoId, id))
      .orderBy(
        asc(interventiStoricoStatiTable.dataTransizione),
        asc(interventiStoricoStatiTable.id),
      );
    res.json(rows.map(formatStoricoStato));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.post("/interventi/:id/successivi", async (req, res) => {
  const precedenteId = parsePositiveInteger(req.params.id);
  if (precedenteId == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (!hasOwn(body, "stato")) {
    res.status(400).json({
      error: "Lo stato iniziale è obbligatorio per un intervento successivo",
    });
    return;
  }
  try {
    const precedente = await requireAccessibleIntervento(precedenteId, req);
    const workflow = workflowCreateValues(body);
    if (
      !(await canCreateForAmbito(
        precedente.beneficiarioId,
        workflow.values.ambito as InterventoAmbito | null,
        req,
      ))
    ) {
      throw new RouteError(403, "Beneficiario non accessibile");
    }
    await validateInterventoPrecedente(precedenteId, precedente.beneficiarioId);

    const tipoIntervento = body.tipoIntervento;
    if (typeof tipoIntervento !== "string" || !tipoIntervento.trim()) {
      throw new RouteError(400, "tipoIntervento è obbligatorio");
    }
    const duplicateConditions: SQL[] = [
      eq(interventiTable.interventoPrecedenteId, precedenteId),
      eq(interventiTable.tipoIntervento, tipoIntervento),
      inArray(interventiTable.stato, [
        "da_pianificare",
        "pianificato",
        "in_corso",
      ]),
    ];
    if (workflow.values.dataOraPianificata == null) {
      duplicateConditions.push(isNull(interventiTable.dataOraPianificata));
    } else {
      duplicateConditions.push(
        eq(
          interventiTable.dataOraPianificata,
          workflow.values.dataOraPianificata,
        ),
      );
    }
    const [duplicate] = await db
      .select({ id: interventiTable.id })
      .from(interventiTable)
      .where(and(...duplicateConditions))
      .limit(1);
    if (duplicate) {
      throw new RouteError(
        409,
        "Esiste già un intervento successivo con la stessa pianificazione",
      );
    }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(interventiTable)
        .values({
          ...cleanInterventoBody(body),
          ...workflow.values,
          beneficiarioId: precedente.beneficiarioId,
          interventoPrecedenteId: precedenteId,
          operatoreId: req.user!.id,
        } as never)
        .returning();
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: row.id,
        statoPrecedente: null,
        statoNuovo: row.stato,
        operatoreId: req.user!.id,
        dataTransizione: workflow.values.dataAggiornamento!,
        motivo: "Creazione come intervento successivo",
      });
      return row;
    });
    res.status(201).json(formatIntervento(created, emptySummary()));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.get(
  "/interventi/:interventoId/bisogni-pianificati",
  async (req, res) => {
    const interventoId = parsePositiveInteger(req.params.interventoId);
    if (interventoId == null) {
      res.status(400).json({ error: "interventoId non valido" });
      return;
    }
    try {
      await requireAccessibleIntervento(interventoId, req);
      const rows = await orderedBisogni([interventoId]);
      res.json(rows.map(formatBisogno));
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/interventi/:interventoId/bisogni-pianificati",
  async (req, res) => {
    const interventoId = parsePositiveInteger(req.params.interventoId);
    if (interventoId == null) {
      res.status(400).json({ error: "interventoId non valido" });
      return;
    }
    try {
      await requireManageableUdsIntervento(interventoId, req);
      const [row] = await db
        .insert(bisogniPianificatiTable)
        .values({ ...normalizeBisogno(req.body as BisognoInput), interventoId })
        .returning();
      res.status(201).json(formatBisogno(row));
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/interventi/:interventoId/bisogni-pianificati/:bisognoId",
  async (req, res) => {
    const interventoId = parsePositiveInteger(req.params.interventoId);
    const bisognoId = parsePositiveInteger(req.params.bisognoId);
    if (interventoId == null || bisognoId == null) {
      res.status(400).json({ error: "Identificativo non valido" });
      return;
    }
    try {
      await requireManageableUdsIntervento(interventoId, req);
      const [existing] = await db
        .select()
        .from(bisogniPianificatiTable)
        .where(
          and(
            eq(bisogniPianificatiTable.id, bisognoId),
            eq(bisogniPianificatiTable.interventoId, interventoId),
          ),
        );
      if (!existing)
        throw new RouteError(
          404,
          "Bisogno Pianificato non appartenente all'intervento",
        );
      const [row] = await db
        .update(bisogniPianificatiTable)
        .set(normalizeBisogno(req.body as BisognoInput, existing))
        .where(eq(bisogniPianificatiTable.id, bisognoId))
        .returning();
      res.json(formatBisogno(row));
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  },
);

export default router;
