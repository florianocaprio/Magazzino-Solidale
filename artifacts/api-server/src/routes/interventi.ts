import { Router, type IRouter, type Request } from "express";
import {
  beneficiariTable,
  bisogniPianificatiTable,
  centriAscoltoTable,
  db,
  interventiAttivitaTable,
  interventiDocumentiTable,
  interventiMaterialiTable,
  interventiStoricoStatiTable,
  interventiTable,
  magazziniTable,
  prodottiTable,
  ruoliTable,
  tipiInterventoTable,
  utentiTable,
  type InterventoAttivita,
  type InterventoDocumento,
  type InterventoMateriale,
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
  isNotNull,
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
  isModuloAttivo,
  requireAnyModulo,
  requireModulo,
} from "../lib/featureFlags";
import {
  avvisoInterventoEuropeRome,
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
import type { PermissionKey } from "../lib/permissions";
import {
  creaScaricoInventariale,
  InventoryError,
} from "../lib/scaricoInventory";

const router: IRouter = Router();

router.use("/interventi", requireAnyModulo(["CENTRO_ASCOLTO", "UDS"]));

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
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type SocialInterventoPermission = Extract<
  PermissionKey,
  `sociale.interventi.${string}`
>;

const MATERIALE_STATI = [
  "da_preparare",
  "pronto",
  "consegnato",
  "annullato",
] as const;
const DOCUMENTO_STATI = [
  "da_acquisire",
  "da_verificare",
  "acquisito",
  "verificato",
  "non_disponibile",
  "annullato",
] as const;

type MaterialeStato = (typeof MATERIALE_STATI)[number];
type DocumentoStato = (typeof DOCUMENTO_STATI)[number];

interface AttivitaOperativaInput {
  tipologiaId?: unknown;
  tipologiaSnapshot?: unknown;
  descrizione?: unknown;
  risultato?: unknown;
}

interface MaterialeOperativoInput {
  prodottoId?: unknown;
  descrizioneSnapshot?: unknown;
  unitaMisuraSnapshot?: unknown;
  quantitaPrevista?: unknown;
  quantitaConsegnata?: unknown;
  statoPreparazione?: unknown;
  magazzinoId?: unknown;
  note?: unknown;
}

interface DocumentoOperativoInput {
  tipoDescrizione?: unknown;
  stato?: unknown;
  dataScadenza?: unknown;
  note?: unknown;
}

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

function hasSocialInterventoPermission(
  req: Request,
  permission: SocialInterventoPermission,
): boolean {
  return Boolean(req.user?.isAdmin || req.user?.permessi?.includes(permission));
}

function requireSocialInterventoPermission(
  req: Request,
  permission: SocialInterventoPermission,
): void {
  if (!hasSocialInterventoPermission(req, permission)) {
    throw new RouteError(403, "Permesso Interventi Sociali non consentito");
  }
}

function moduloServizioIntervento(
  ambito: InterventoAmbito | null,
): "CENTRO_ASCOLTO" | "UDS" {
  return ambito === "uds" ? "UDS" : "CENTRO_ASCOLTO";
}

async function isServizioInterventoAttivo(
  ambito: InterventoAmbito | null,
): Promise<boolean> {
  return isModuloAttivo(moduloServizioIntervento(ambito));
}

async function requireServizioInterventoAttivo(
  ambito: InterventoAmbito | null,
): Promise<void> {
  const modulo = moduloServizioIntervento(ambito);
  if (!(await isModuloAttivo(modulo))) {
    throw new RouteError(
      403,
      `Il servizio ${modulo} non è abilitato per questo intervento`,
    );
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
    "risultato",
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
    risultato: row.risultato ?? null,
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
    avviso: avvisoInterventoEuropeRome(row.dataOraPianificata, row.stato),
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

function formatInterventoListItem(
  row: InterventoRow,
  summary: BisogniSummary,
  beneficiarioNome: string | null,
  operatoreCodice: string | null,
  successoriIds: number[],
  details: InterventoDisplayDetails,
) {
  const detail = formatIntervento(
    row,
    summary,
    beneficiarioNome,
    operatoreCodice,
    successoriIds,
    details,
  );
  return {
    id: detail.id,
    beneficiarioId: detail.beneficiarioId,
    beneficiarioNome: detail.beneficiarioNome,
    beneficiarioCodice: detail.beneficiarioCodice,
    nucleoFamiliareSintesi: detail.nucleoFamiliareSintesi,
    operatoreId: detail.operatoreId,
    operatoreCodice: detail.operatoreCodice,
    operatoreNome: detail.operatoreNome,
    centroAscoltoId: detail.centroAscoltoId,
    centroAscoltoNome: detail.centroAscoltoNome,
    cittaId: detail.cittaId,
    dataIntervento: detail.dataIntervento,
    tipoIntervento: detail.tipoIntervento,
    stato: detail.stato,
    ambito: detail.ambito,
    ambitoLegacy: detail.ambitoLegacy,
    priorita: detail.priorita,
    dataOraPianificata: detail.dataOraPianificata,
    dataOraAvvio: detail.dataOraAvvio,
    dataOraConclusione: detail.dataOraConclusione,
    avviso: detail.avviso,
    interventoPrecedenteId: detail.interventoPrecedenteId,
    numeroSuccessori: detail.numeroSuccessori,
    sede: detail.sede,
    dataCreazione: detail.dataCreazione,
    dataAggiornamento: detail.dataAggiornamento,
    bisogniPianificatiTotale: detail.bisogniPianificatiTotale,
    bisogniPianificatiAperti: detail.bisogniPianificatiAperti,
    bisogniPianificatiScaduti: detail.bisogniPianificatiScaduti,
    bisogniPianificatiProssimaScadenza:
      detail.bisogniPianificatiProssimaScadenza,
  };
}

function requiredText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  const normalized = nullableText(value, field, maxLength);
  if (normalized == null) throw new RouteError(400, `${field} è obbligatorio`);
  return normalized;
}

function optionalPositiveInteger(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  const parsed = parsePositiveInteger(value);
  if (parsed == null) throw new RouteError(400, `${field} non valido`);
  return parsed;
}

function nonNegativeQuantity(value: unknown, field: string): string {
  if (value == null || value === "") return "0";
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 999_999_999) {
    throw new RouteError(400, `${field} deve essere una quantità non negativa`);
  }
  return parsed.toFixed(3);
}

function inputArray<T>(
  body: Record<string, unknown>,
  key: string,
): T[] | undefined {
  if (!hasOwn(body, key)) return undefined;
  if (!Array.isArray(body[key])) {
    throw new RouteError(400, `${key} non valido`);
  }
  return body[key] as T[];
}

function formatAttivita(row: InterventoAttivita) {
  return {
    ...row,
    tipologiaId: row.tipologiaId ?? null,
    risultato: row.risultato ?? null,
    operatoreId: row.operatoreId ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

function formatMateriale(row: InterventoMateriale) {
  return {
    ...row,
    prodottoId: row.prodottoId ?? null,
    magazzinoId: row.magazzinoId ?? null,
    quantitaPrevista: Number(row.quantitaPrevista),
    quantitaConsegnata: Number(row.quantitaConsegnata),
    note: row.note ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

function formatDocumento(row: InterventoDocumento) {
  return {
    ...row,
    dataScadenza: row.dataScadenza ?? null,
    note: row.note ?? null,
    dataCreazione: row.dataCreazione.toISOString(),
    dataAggiornamento: row.dataAggiornamento.toISOString(),
  };
}

async function operativitaFor(intervento: InterventoRow) {
  const [attivita, materiali, documenti] = await Promise.all([
    db
      .select()
      .from(interventiAttivitaTable)
      .where(eq(interventiAttivitaTable.interventoId, intervento.id))
      .orderBy(interventiAttivitaTable.id),
    db
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, intervento.id))
      .orderBy(interventiMaterialiTable.id),
    db
      .select()
      .from(interventiDocumentiTable)
      .where(eq(interventiDocumentiTable.interventoId, intervento.id))
      .orderBy(interventiDocumentiTable.id),
  ]);
  return {
    interventoId: intervento.id,
    stato: intervento.stato,
    versione: intervento.dataAggiornamento?.toISOString() ?? null,
    risultato: intervento.risultato ?? null,
    esito: intervento.esito ?? null,
    note: intervento.note ?? null,
    attivita: attivita.map(formatAttivita),
    materiali: materiali.map(formatMateriale),
    documenti: documenti.map(formatDocumento),
  };
}

function assertExpectedVersion(
  body: Record<string, unknown>,
  current: InterventoRow,
): Date {
  if (!hasOwn(body, "versione") || body.versione == null) {
    throw new RouteError(400, "La versione è obbligatoria");
  }
  let expected: Date | null;
  try {
    expected = parseIsoTimestamp(body.versione, "versione");
  } catch (error) {
    throw new RouteError(
      400,
      error instanceof Error ? error.message : "Versione non valida",
    );
  }
  if (expected == null) {
    throw new RouteError(400, "La versione è obbligatoria");
  }
  if (
    current.dataAggiornamento == null ||
    expected.getTime() !== current.dataAggiornamento.getTime()
  ) {
    throw new RouteError(
      409,
      "L'intervento è stato modificato da un altro operatore. Ricarica i dati prima di continuare.",
    );
  }
  return expected;
}

async function replaceOperativita(
  tx: DbTransaction,
  intervento: InterventoRow,
  body: Record<string, unknown>,
  req: Request,
  now: Date,
): Promise<void> {
  const interventoId = intervento.id;
  const operatoreId = req.user!.id;
  const attivitaInput = inputArray<AttivitaOperativaInput>(body, "attivita");
  const materialiInput = inputArray<MaterialeOperativoInput>(body, "materiali");
  const documentiInput = inputArray<DocumentoOperativoInput>(body, "documenti");

  if (attivitaInput) {
    const tipologiaIds = [
      ...new Set(
        attivitaInput
          .map((item) =>
            optionalPositiveInteger(item.tipologiaId, "tipologiaId"),
          )
          .filter((id): id is number => id != null),
      ),
    ];
    const tipi =
      tipologiaIds.length === 0
        ? []
        : await tx
            .select({
              id: tipiInterventoTable.id,
              nome: tipiInterventoTable.nome,
            })
            .from(tipiInterventoTable)
            .where(inArray(tipiInterventoTable.id, tipologiaIds));
    const tipiMap = new Map(tipi.map((tipo) => [tipo.id, tipo.nome]));
    if (tipiMap.size !== tipologiaIds.length) {
      throw new RouteError(400, "Una tipologia di attività non esiste");
    }
    const values = attivitaInput.map((item) => {
      const tipologiaId = optionalPositiveInteger(
        item.tipologiaId,
        "tipologiaId",
      );
      return {
        interventoId,
        tipologiaId,
        tipologiaSnapshot:
          (tipologiaId == null ? null : tipiMap.get(tipologiaId)) ??
          requiredText(
            item.tipologiaSnapshot,
            "La tipologia dell'attività",
            120,
          ),
        descrizione: requiredText(
          item.descrizione,
          "La descrizione dell'attività",
          4000,
        ),
        risultato: nullableText(
          item.risultato,
          "Il risultato dell'attività",
          4000,
        ),
        operatoreId,
        dataAggiornamento: now,
      };
    });
    await tx
      .delete(interventiAttivitaTable)
      .where(eq(interventiAttivitaTable.interventoId, interventoId));
    if (values.length > 0)
      await tx.insert(interventiAttivitaTable).values(values);
  }

  if (materialiInput) {
    const materialiPrecedenti = await tx
      .select()
      .from(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, interventoId))
      .for("update");
    const prodottoIds = [
      ...new Set(
        materialiInput
          .map((item) => optionalPositiveInteger(item.prodottoId, "prodottoId"))
          .filter((id): id is number => id != null),
      ),
    ];
    const magazzinoIds = [
      ...new Set(
        materialiInput
          .map((item) =>
            optionalPositiveInteger(item.magazzinoId, "magazzinoId"),
          )
          .filter((id): id is number => id != null),
      ),
    ];
    const [prodotti, magazzini] = await Promise.all([
      prodottoIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: prodottiTable.id,
              nome: prodottiTable.nome,
              unitaMisura: prodottiTable.unitaMisura,
            })
            .from(prodottiTable)
            .where(inArray(prodottiTable.id, prodottoIds)),
      magazzinoIds.length === 0
        ? Promise.resolve([])
        : tx
            .select({
              id: magazziniTable.id,
              stato: magazziniTable.stato,
              cittaId: magazziniTable.cittaId,
              centroAscoltoId: magazziniTable.centroAscoltoId,
            })
            .from(magazziniTable)
            .where(inArray(magazziniTable.id, magazzinoIds)),
    ]);
    if (prodotti.length !== prodottoIds.length)
      throw new RouteError(400, "Un prodotto selezionato non esiste");
    if (magazzini.length !== magazzinoIds.length)
      throw new RouteError(400, "Un magazzino selezionato non esiste");
    const [beneficiario] = await tx
      .select({
        id: beneficiariTable.id,
        cittaId: beneficiariTable.cittaId,
        centroAscoltoId: beneficiariTable.centroAscoltoId,
      })
      .from(beneficiariTable)
      .where(eq(beneficiariTable.id, intervento.beneficiarioId))
      .limit(1);
    if (!beneficiario)
      throw new RouteError(409, "Beneficiario dell'intervento non trovato");
    for (const magazzino of magazzini) {
      if (magazzino.stato !== "attivo") {
        throw new RouteError(400, "Un magazzino selezionato non è attivo");
      }
      if (
        beneficiario.cittaId == null ||
        magazzino.cittaId == null ||
        magazzino.cittaId !== beneficiario.cittaId
      ) {
        throw new RouteError(
          400,
          "Il magazzino deve appartenere alla stessa Area della cartella sociale",
        );
      }
      if (
        magazzino.centroAscoltoId != null &&
        magazzino.centroAscoltoId !== beneficiario.centroAscoltoId
      ) {
        throw new RouteError(
          403,
          "Il magazzino non è coerente con il Centro della cartella sociale",
        );
      }
      if (
        callerCittaId(req) != null &&
        magazzino.cittaId !== callerCittaId(req)
      ) {
        throw new RouteError(403, "Magazzino non accessibile per la tua Area");
      }
      if (
        callerCentroId(req) != null &&
        magazzino.centroAscoltoId != null &&
        magazzino.centroAscoltoId !== callerCentroId(req)
      ) {
        throw new RouteError(
          403,
          "Magazzino non accessibile per il tuo Centro",
        );
      }
    }
    const prodottiMap = new Map(
      prodotti.map((prodotto) => [prodotto.id, prodotto]),
    );
    const values = materialiInput.map((item) => {
      const prodottoId = optionalPositiveInteger(item.prodottoId, "prodottoId");
      const prodotto = prodottoId == null ? null : prodottiMap.get(prodottoId);
      const statoPreparazione = enumValue(
        item.statoPreparazione ?? "da_preparare",
        MATERIALE_STATI,
        "statoPreparazione",
      );
      const magazzinoId = optionalPositiveInteger(
        item.magazzinoId,
        "magazzinoId",
      );
      const quantitaConsegnata = nonNegativeQuantity(
        item.quantitaConsegnata,
        "quantitaConsegnata",
      );
      if (
        prodottoId != null &&
        Number(quantitaConsegnata) > 0 &&
        magazzinoId == null
      ) {
        throw new RouteError(
          400,
          "Un materiale catalogato consegnato richiede il magazzino di scarico",
        );
      }
      if (
        prodottoId != null &&
        Math.round(Number(quantitaConsegnata) * 100) / 100 !==
          Number(quantitaConsegnata)
      ) {
        throw new RouteError(
          400,
          "La quantità consegnata inventariale accetta al massimo due decimali",
        );
      }
      return {
        interventoId,
        prodottoId,
        descrizioneSnapshot:
          prodotto?.nome ??
          requiredText(
            item.descrizioneSnapshot,
            "La descrizione del materiale",
            255,
          ),
        unitaMisuraSnapshot:
          prodotto?.unitaMisura ??
          requiredText(item.unitaMisuraSnapshot, "L'unità di misura", 40),
        quantitaPrevista: nonNegativeQuantity(
          item.quantitaPrevista,
          "quantitaPrevista",
        ),
        quantitaConsegnata,
        statoPreparazione,
        magazzinoId,
        note: nullableText(item.note, "Le note del materiale", 2000),
        dataAggiornamento: now,
      };
    });
    const deliveredByKey = (
      rows: Array<{
        prodottoId: number | null;
        magazzinoId: number | null;
        quantitaConsegnata: string;
        unitaMisuraSnapshot: string;
      }>,
    ) => {
      const result = new Map<
        string,
        {
          prodottoId: number;
          magazzinoId: number;
          quantita: number;
          unitaMisura: string;
        }
      >();
      for (const row of rows) {
        if (row.prodottoId == null || row.magazzinoId == null) continue;
        const key = `${row.prodottoId}:${row.magazzinoId}`;
        const current = result.get(key);
        result.set(key, {
          prodottoId: row.prodottoId,
          magazzinoId: row.magazzinoId,
          quantita: (current?.quantita ?? 0) + Number(row.quantitaConsegnata),
          unitaMisura: row.unitaMisuraSnapshot,
        });
      }
      return result;
    };
    const previousDelivered = deliveredByKey(materialiPrecedenti);
    const nextDelivered = deliveredByKey(values);
    const deltasByWarehouse = new Map<
      number,
      Array<{ prodottoId: number; quantita: number; unitaMisura: string }>
    >();
    for (const [key, previous] of previousDelivered) {
      const next = nextDelivered.get(key)?.quantita ?? 0;
      if (next + 0.000_001 < previous.quantita) {
        throw new RouteError(
          409,
          "Una quantità già consegnata e scaricata non può essere ridotta senza uno storno esplicito",
        );
      }
    }
    for (const [key, next] of nextDelivered) {
      const previous = previousDelivered.get(key)?.quantita ?? 0;
      const delta = Math.round((next.quantita - previous) * 100) / 100;
      if (delta <= 0) continue;
      const rows = deltasByWarehouse.get(next.magazzinoId) ?? [];
      rows.push({
        prodottoId: next.prodottoId,
        quantita: delta,
        unitaMisura: next.unitaMisura,
      });
      deltasByWarehouse.set(next.magazzinoId, rows);
    }
    await tx
      .delete(interventiMaterialiTable)
      .where(eq(interventiMaterialiTable.interventoId, interventoId));
    if (values.length > 0)
      await tx.insert(interventiMaterialiTable).values(values);
    let sequence = 0;
    for (const [magazzinoId, righe] of deltasByWarehouse) {
      sequence += 1;
      try {
        await creaScaricoInventariale(tx, {
          codice: `INT-${interventoId}-${now.getTime().toString(36)}-${sequence}`,
          magazzinoId,
          centroAscoltoId: beneficiario.centroAscoltoId,
          dataScarico: dataCivileEuropeRome(now),
          causale: "altro",
          causaleAltro: "Consegna Intervento Sociale",
          note: `Consegna materiali intervento #${interventoId}`,
          operatoreId,
          beneficiarioId: intervento.beneficiarioId,
          documentoRiferimento: `INTERVENTO-${interventoId}`,
          righe,
        });
      } catch (error) {
        if (error instanceof InventoryError) {
          throw new RouteError(400, error.message);
        }
        throw error;
      }
    }
  }

  if (documentiInput) {
    const values = documentiInput.map((item) => {
      const dataScadenza =
        item.dataScadenza == null || item.dataScadenza === ""
          ? null
          : String(item.dataScadenza);
      if (dataScadenza != null && !isDateOnly(dataScadenza)) {
        throw new RouteError(400, "dataScadenza non valida");
      }
      return {
        interventoId,
        tipoDescrizione: requiredText(
          item.tipoDescrizione,
          "Il documento",
          200,
        ),
        stato: enumValue(
          item.stato ?? "da_acquisire",
          DOCUMENTO_STATI,
          "stato documento",
        ),
        dataScadenza,
        note: nullableText(item.note, "Le note del documento", 2000),
        dataAggiornamento: now,
      };
    });
    await tx
      .delete(interventiDocumentiTable)
      .where(eq(interventiDocumentiTable.interventoId, interventoId));
    if (values.length > 0)
      await tx.insert(interventiDocumentiTable).values(values);
  }
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
  "id" | "uds" | "attivo" | "cittaId" | "centroAscoltoId" | "zonaUdsId"
>;

async function beneficiarioAccess(
  beneficiarioId: number,
): Promise<BeneficiarioAccess | null> {
  const [row] = await db
    .select({
      id: beneficiariTable.id,
      uds: beneficiariTable.uds,
      attivo: beneficiariTable.attivo,
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
  return canAccessSensitiveSocialBeneficiary(beneficiario, req);
}

function canUseInterventoArea(req: Request, area: InterventoAmbito): boolean {
  return (
    req.user?.isAdmin === true ||
    req.user?.isSuperAdmin === true ||
    req.user?.aree.includes(area) === true
  );
}

function isTerritoriallyScoped(req: Request): boolean {
  return (
    callerCittaId(req) != null ||
    callerCentroId(req) != null ||
    callerZonaUdsId(req) != null
  );
}

function canAccessUnassignedSocialFolder(req: Request): boolean {
  return req.user?.isAdmin === true || req.user?.isSuperAdmin === true;
}

/** Cartelle Sociali prive di Area o Centro restano visibili solo globalmente. */
function canAccessSensitiveSocialBeneficiary(
  beneficiario: BeneficiarioAccess,
  req: Request,
): boolean {
  if (!canUseInterventoArea(req, "sociale")) return false;
  if (beneficiario.cittaId == null || beneficiario.centroAscoltoId == null) {
    return !isTerritoriallyScoped(req) && canAccessUnassignedSocialFolder(req);
  }
  if (!isTerritoriallyScoped(req)) return true;
  const callerCitta = callerCittaId(req);
  const callerCentro = callerCentroId(req);
  const callerZona = callerZonaUdsId(req);
  return (
    (callerCitta == null || beneficiario.cittaId === callerCitta) &&
    (callerCentro == null || beneficiario.centroAscoltoId === callerCentro) &&
    (callerZona == null || beneficiario.zonaUdsId === callerZona)
  );
}

async function canCreateForAmbito(
  beneficiarioId: number,
  ambito: InterventoAmbito | null,
  req: Request,
): Promise<boolean> {
  if (!(await isServizioInterventoAttivo(ambito))) return false;
  const beneficiario = await beneficiarioAccess(beneficiarioId);
  return (
    beneficiario?.attivo === true &&
    canAccessInterventoAmbito(ambito, beneficiario, req)
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
  socialPermission: SocialInterventoPermission = "sociale.interventi.view",
): Promise<InterventoRow> {
  const [result] = await db
    .select({
      intervento: interventiTable,
      beneficiario: {
        id: beneficiariTable.id,
        uds: beneficiariTable.uds,
        attivo: beneficiariTable.attivo,
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
  await requireServizioInterventoAttivo(
    result.intervento.ambito === "uds" ? "uds" : "sociale",
  );
  if (expectedAmbito === "sociale") {
    const socialAccessible =
      result.intervento.ambito !== "uds" &&
      canAccessSensitiveSocialBeneficiary(result.beneficiario, req);
    if (!socialAccessible)
      throw new RouteError(403, "Intervento non accessibile");
    requireSocialInterventoPermission(req, socialPermission);
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
  if (result.intervento.ambito !== "uds") {
    const udsLegacyAccess =
      result.intervento.ambito == null &&
      canUseInterventoArea(req, "uds") &&
      result.beneficiario.uds === true &&
      result.beneficiario.cittaId != null &&
      (callerCittaId(req) == null ||
        result.beneficiario.cittaId === callerCittaId(req));
    if (!udsLegacyAccess) {
      requireSocialInterventoPermission(req, socialPermission);
    }
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

async function formattedInterventoFor(row: InterventoRow) {
  const [needs, successori, display] = await Promise.all([
    orderedBisogni([row.id]),
    successoriFor([row.id]),
    displayDetailsForIntervento(row.id),
  ]);
  return formatIntervento(
    row,
    summarizeBisogni(needs),
    display?.beneficiarioNome ?? null,
    display?.operatoreCodice ?? null,
    successori.get(row.id) ?? [],
    display?.details,
  );
}

function addCivilDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function preparazioneRange(query: Record<string, string | undefined>): {
  da: string;
  a: string;
  start: Date;
  end: Date;
} {
  const periodo = query.periodo ?? "7";
  let da: string;
  let a: string;
  if (periodo === "personalizzato") {
    if (!query.da || !query.a)
      throw new RouteError(400, "L'intervallo personalizzato richiede da e a");
    da = query.da;
    a = query.a;
  } else {
    const days = periodo === "oggi" ? 1 : Number(periodo);
    if (![1, 3, 7, 14].includes(days))
      throw new RouteError(400, "periodo non valido");
    da = oggiEuropeRome();
    a = addCivilDays(da, days - 1);
  }
  if (!isDateOnly(da) || !isDateOnly(a) || a < da)
    throw new RouteError(400, "Intervallo date non valido");
  const [fromYear, fromMonth, fromDay] = da.split("-").map(Number);
  const [toYear, toMonth, toDay] = a.split("-").map(Number);
  const span =
    (Date.UTC(toYear, toMonth - 1, toDay) -
      Date.UTC(fromYear, fromMonth - 1, fromDay)) /
    86_400_000;
  if (span > 30)
    throw new RouteError(400, "L'intervallo massimo è di 31 giorni");
  const range = intervalloDateEuropeRome(da, a);
  return { da, a, ...range };
}

const PRIORITA_RANK: Record<string, number> = {
  urgente: 1,
  alta: 2,
  normale: 3,
  bassa: 4,
};

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
  await requireServizioInterventoAttivo("uds");
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

async function requireManageableInterventoNeeds(
  interventoId: number,
  req: Request,
): Promise<InterventoRow> {
  const intervento = await requireAccessibleIntervento(
    interventoId,
    req,
    null,
    "sociale.interventi.update",
  );
  if (intervento.ambito === "sociale") return intervento;
  return requireManageableUdsIntervento(interventoId, req);
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
  requireSocialInterventoPermission(req, "sociale.interventi.view");
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
  const scoped: SQL[] = [];
  if (isTerritoriallyScoped(req) || !canAccessUnassignedSocialFolder(req)) {
    scoped.push(
      isNotNull(beneficiariTable.cittaId),
      isNotNull(beneficiariTable.centroAscoltoId),
    );
  }
  if (callerCitta != null)
    scoped.push(eq(beneficiariTable.cittaId, callerCitta));
  if (callerCentro != null)
    scoped.push(eq(beneficiariTable.centroAscoltoId, callerCentro));
  if (callerZona != null)
    scoped.push(eq(beneficiariTable.zonaUdsId, callerZona));
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
  const socialServiceActive = await isServizioInterventoAttivo("sociale");
  const udsServiceActive = await isServizioInterventoAttivo("uds");
  if (
    (ambito === "sociale" && !socialServiceActive) ||
    (ambito === "uds" && !udsServiceActive)
  ) {
    res.status(403).json({ error: `Servizio ${ambito} non abilitato` });
    return;
  }
  if (ambito && !canUseInterventoArea(req, ambito as InterventoAmbito)) {
    res.status(403).json({ error: `Ambito ${ambito} non consentito` });
    return;
  }
  if (
    ambito === "sociale" &&
    !hasSocialInterventoPermission(req, "sociale.interventi.view")
  ) {
    res
      .status(403)
      .json({ error: "Permesso Interventi Sociali non consentito" });
    return;
  }
  if (
    ambito === "sociale" &&
    !canAccessUnassignedSocialFolder(req) &&
    !isTerritoriallyScoped(req)
  ) {
    conditions.push(
      isNotNull(beneficiariTable.cittaId),
      isNotNull(beneficiariTable.centroAscoltoId),
    );
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
          : includeStorici && socialServiceActive
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
  } else {
    const featureScopes: SQL[] = [];
    if (
      socialServiceActive &&
      canUseInterventoArea(req, "sociale") &&
      hasSocialInterventoPermission(req, "sociale.interventi.view")
    ) {
      featureScopes.push(socialAmbitoCondition(undefined));
    }
    if (udsServiceActive && canUseInterventoArea(req, "uds")) {
      featureScopes.push(
        socialServiceActive
          ? or(
              eq(interventiTable.ambito, "uds"),
              isNull(interventiTable.ambito),
            )!
          : eq(interventiTable.ambito, "uds"),
      );
    }
    if (featureScopes.length === 0) {
      res.status(403).json({ error: "Nessun servizio interventi abilitato" });
      return;
    }
    if (featureScopes.length === 1) conditions.push(featureScopes[0]);
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
    conditions.push(isNotNull(beneficiariTable.id));
    const scopeAlternatives: SQL[] = [];
    if (
      canUseInterventoArea(req, "sociale") &&
      hasSocialInterventoPermission(req, "sociale.interventi.view")
    ) {
      const socialConditions = [
        or(ne(interventiTable.ambito, "uds"), isNull(interventiTable.ambito)),
        isNotNull(beneficiariTable.cittaId),
        isNotNull(beneficiariTable.centroAscoltoId),
        callerCitta == null
          ? undefined
          : eq(beneficiariTable.cittaId, callerCitta),
        caller == null
          ? undefined
          : eq(beneficiariTable.centroAscoltoId, caller),
        callerZona == null
          ? undefined
          : eq(beneficiariTable.zonaUdsId, callerZona),
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
    const canUseSociale =
      canUseInterventoArea(req, "sociale") &&
      hasSocialInterventoPermission(req, "sociale.interventi.view");
    const canUseUds = canUseInterventoArea(req, "uds");
    if (canUseSociale && !canUseUds) {
      conditions.push(
        or(ne(interventiTable.ambito, "uds"), isNull(interventiTable.ambito))!,
      );
    } else if (canUseUds && !canUseSociale) {
      conditions.push(eq(interventiTable.ambito, "uds"));
    } else if (canUseSociale && !canAccessUnassignedSocialFolder(req)) {
      conditions.push(
        or(
          eq(interventiTable.ambito, "uds"),
          and(
            or(
              ne(interventiTable.ambito, "uds"),
              isNull(interventiTable.ambito),
            ),
            isNotNull(beneficiariTable.cittaId),
            isNotNull(beneficiariTable.centroAscoltoId),
          ),
        )!,
      );
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
      (ambito === "uds" ? formatIntervento : formatInterventoListItem)(
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

router.get(
  "/interventi/riepilogo-viste",
  requireModulo("CENTRO_ASCOLTO"),
  async (req, res) => {
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
  },
);

router.get(
  "/interventi/operatori",
  requireModulo("CENTRO_ASCOLTO"),
  async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    try {
      requireSocialInterventoPermission(req, "sociale.interventi.view");
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
    if (!canUseInterventoArea(req, "sociale")) {
      res.status(403).json({ error: "Ambito sociale non consentito" });
      return;
    }
    const callerCitta = callerCittaId(req);
    const callerCentro = callerCentroId(req);
    const selectedCitta =
      callerCitta ??
      (query.cittaId ? parsePositiveInteger(query.cittaId) : null);
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
    if (
      callerCentro == null &&
      query.centroAscoltoId &&
      selectedCentro == null
    ) {
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
  },
);

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
  const creationBeneficiario = await beneficiarioAccess(beneficiarioId);
  const isUdsCreation =
    workflow.values.ambito === "uds" ||
    (workflow.values.ambito == null &&
      creationBeneficiario != null &&
      canUseInterventoArea(req, "uds") &&
      creationBeneficiario.uds === true &&
      creationBeneficiario.cittaId != null &&
      (callerCittaId(req) == null ||
        creationBeneficiario.cittaId === callerCittaId(req)));
  if (!isUdsCreation) {
    try {
      requireSocialInterventoPermission(req, "sociale.interventi.create");
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
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

router.get(
  "/interventi/materiale-da-preparare",
  requireModulo("CENTRO_ASCOLTO"),
  async (req, res) => {
    const query = req.query as Record<string, string | undefined>;
    try {
      const range = preparazioneRange(query);
      const conditions: SQL[] = [
        eq(interventiTable.ambito, "sociale"),
        inArray(interventiTable.stato, ["pianificato", "in_corso"]),
        gte(interventiTable.dataOraPianificata, range.start),
        lt(interventiTable.dataOraPianificata, range.end),
        inArray(interventiMaterialiTable.statoPreparazione, [
          "da_preparare",
          "pronto",
        ]),
        sql`${interventiMaterialiTable.quantitaPrevista} > ${interventiMaterialiTable.quantitaConsegnata}`,
        ...socialScopeConditions(req, query),
      ];
      const rows = await db
        .select({
          materialeId: interventiMaterialiTable.id,
          materialeAggiornato: interventiMaterialiTable.dataAggiornamento,
          interventoId: interventiTable.id,
          prodottoId: interventiMaterialiTable.prodottoId,
          descrizione: interventiMaterialiTable.descrizioneSnapshot,
          unitaMisura: interventiMaterialiTable.unitaMisuraSnapshot,
          magazzinoId: interventiMaterialiTable.magazzinoId,
          magazzinoNome: magazziniTable.nome,
          quantitaPrevista: interventiMaterialiTable.quantitaPrevista,
          quantitaConsegnata: interventiMaterialiTable.quantitaConsegnata,
          statoPreparazione: interventiMaterialiTable.statoPreparazione,
          note: interventiMaterialiTable.note,
          statoIntervento: interventiTable.stato,
          priorita: interventiTable.priorita,
          dataOraPianificata: interventiTable.dataOraPianificata,
          sede: interventiTable.sede,
          beneficiarioNome: sql<string>`${beneficiariTable.cognome} || ' ' || ${beneficiariTable.nome}`,
          beneficiarioCodice: beneficiariTable.codice,
          operatoreNome: sql<
            string | null
          >`nullif(trim(coalesce(${utentiTable.nome}, '') || ' ' || coalesce(${utentiTable.cognome}, '')), '')`,
        })
        .from(interventiMaterialiTable)
        .innerJoin(
          interventiTable,
          eq(interventiMaterialiTable.interventoId, interventiTable.id),
        )
        .innerJoin(
          beneficiariTable,
          eq(interventiTable.beneficiarioId, beneficiariTable.id),
        )
        .leftJoin(
          magazziniTable,
          eq(interventiMaterialiTable.magazzinoId, magazziniTable.id),
        )
        .leftJoin(utentiTable, eq(interventiTable.operatoreId, utentiTable.id))
        .where(and(...conditions))
        .orderBy(
          interventiTable.dataOraPianificata,
          prioritaOrdineSql(),
          interventiMaterialiTable.id,
        );

      type Detail = {
        materialeId: number;
        interventoId: number;
        beneficiarioNome: string;
        beneficiarioCodice: string;
        dataOraPianificata: string;
        sede: string | null;
        operatoreNome: string | null;
        quantitaResidua: number;
        statoPreparazione: string;
        note: string | null;
        versione: string;
        avviso: ReturnType<typeof avvisoInterventoEuropeRome>;
      };
      type Group = {
        chiave: string;
        prodottoId: number | null;
        descrizione: string;
        unitaMisura: string;
        magazzinoId: number | null;
        magazzinoNome: string | null;
        quantitaTotale: number;
        quantitaPronta: number;
        quantitaDaPreparare: number;
        numeroInterventi: number;
        primaScadenza: string;
        prioritaPiuAlta: string;
        avviso: ReturnType<typeof avvisoInterventoEuropeRome>;
        interventi: Detail[];
        interventoIds: Set<number>;
      };
      const grouped = new Map<string, Group>();
      const now = new Date();
      for (const row of rows) {
        if (row.dataOraPianificata == null) continue;
        const residual = Math.max(
          Number(row.quantitaPrevista) - Number(row.quantitaConsegnata),
          0,
        );
        if (residual <= 0) continue;
        const normalizedDescription = row.descrizione
          .trim()
          .toLocaleLowerCase("it-IT");
        const normalizedUnit = row.unitaMisura
          .trim()
          .toLocaleLowerCase("it-IT");
        const key = row.prodottoId
          ? `catalogo:${row.prodottoId}:${normalizedUnit}:${row.magazzinoId ?? "none"}`
          : `generico:${normalizedDescription}:${normalizedUnit}:${row.magazzinoId ?? "none"}`;
        const warning = avvisoInterventoEuropeRome(
          row.dataOraPianificata,
          row.statoIntervento,
          now,
        );
        const detail: Detail = {
          materialeId: row.materialeId,
          interventoId: row.interventoId,
          beneficiarioNome: row.beneficiarioNome,
          beneficiarioCodice: row.beneficiarioCodice,
          dataOraPianificata: row.dataOraPianificata.toISOString(),
          sede: row.sede ?? null,
          operatoreNome: row.operatoreNome ?? null,
          quantitaResidua: residual,
          statoPreparazione: row.statoPreparazione,
          note: row.note ?? null,
          versione: row.materialeAggiornato.toISOString(),
          avviso: warning,
        };
        const existing = grouped.get(key);
        if (!existing) {
          grouped.set(key, {
            chiave: key,
            prodottoId: row.prodottoId ?? null,
            descrizione: row.descrizione,
            unitaMisura: row.unitaMisura,
            magazzinoId: row.magazzinoId ?? null,
            magazzinoNome: row.magazzinoNome ?? null,
            quantitaTotale: residual,
            quantitaPronta: row.statoPreparazione === "pronto" ? residual : 0,
            quantitaDaPreparare:
              row.statoPreparazione === "pronto" ? 0 : residual,
            numeroInterventi: 1,
            primaScadenza: row.dataOraPianificata.toISOString(),
            prioritaPiuAlta: row.priorita,
            avviso: warning,
            interventi: [detail],
            interventoIds: new Set([row.interventoId]),
          });
          continue;
        }
        existing.quantitaTotale += residual;
        if (row.statoPreparazione === "pronto")
          existing.quantitaPronta += residual;
        else existing.quantitaDaPreparare += residual;
        existing.interventoIds.add(row.interventoId);
        existing.numeroInterventi = existing.interventoIds.size;
        if (detail.dataOraPianificata < existing.primaScadenza)
          existing.primaScadenza = detail.dataOraPianificata;
        if (
          (PRIORITA_RANK[row.priorita] ?? 99) <
          (PRIORITA_RANK[existing.prioritaPiuAlta] ?? 99)
        )
          existing.prioritaPiuAlta = row.priorita;
        const warningRank = { scaduto: 1, oggi: 2, imminente: 3, prossimo: 4 };
        if (
          warning &&
          (!existing.avviso ||
            warningRank[warning] < warningRank[existing.avviso])
        )
          existing.avviso = warning;
        existing.interventi.push(detail);
      }
      const groups = [...grouped.values()]
        .map(({ interventoIds: _interventoIds, ...group }) => group)
        .sort(
          (left, right) =>
            left.primaScadenza.localeCompare(right.primaScadenza) ||
            (PRIORITA_RANK[left.prioritaPiuAlta] ?? 99) -
              (PRIORITA_RANK[right.prioritaPiuAlta] ?? 99) ||
            left.descrizione.localeCompare(right.descrizione, "it"),
        );
      res.json({
        da: range.da,
        a: range.a,
        fusoOrario: "Europe/Rome",
        gruppi: groups,
      });
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  },
);

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

router.get("/interventi/:id/operativita", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  try {
    const row = await requireAccessibleIntervento(id, req, "sociale");
    res.json(await operativitaFor(row));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.patch("/interventi/:id/materiali/:materialeId", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  const materialeId = parsePositiveInteger(req.params.materialeId);
  if (id == null || materialeId == null) {
    res.status(400).json({ error: "Identificativo non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (
    body.statoPreparazione !== "pronto" &&
    body.statoPreparazione !== "da_preparare"
  ) {
    res.status(400).json({
      error: "statoPreparazione deve essere pronto o da_preparare",
    });
    return;
  }
  try {
    const expected = parseIsoTimestamp(body.versione, "versione");
    if (expected == null)
      throw new RouteError(400, "La versione del materiale è obbligatoria");
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.update",
    );
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [intervento] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!intervento) throw new RouteError(404, "Intervento non trovato");
      if (!["pianificato", "in_corso"].includes(intervento.stato))
        throw new RouteError(
          409,
          "Lo stato di preparazione non è modificabile per questo intervento",
        );
      const [materiale] = await tx
        .select()
        .from(interventiMaterialiTable)
        .where(
          and(
            eq(interventiMaterialiTable.id, materialeId),
            eq(interventiMaterialiTable.interventoId, id),
          ),
        )
        .for("update");
      if (!materiale)
        throw new RouteError(404, "Materiale non appartenente all'intervento");
      if (
        materiale.statoPreparazione === "annullato" ||
        materiale.statoPreparazione === "consegnato"
      )
        throw new RouteError(409, "Il materiale non è più preparabile");
      if (materiale.dataAggiornamento.getTime() !== expected.getTime())
        throw new RouteError(
          409,
          "Il materiale è stato modificato da un altro operatore",
        );
      const [row] = await tx
        .update(interventiMaterialiTable)
        .set({
          statoPreparazione: body.statoPreparazione as MaterialeStato,
          dataAggiornamento: now,
        })
        .where(
          and(
            eq(interventiMaterialiTable.id, materialeId),
            eq(interventiMaterialiTable.interventoId, id),
            eq(interventiMaterialiTable.dataAggiornamento, expected),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Modifica concorrente rilevata");
      await tx
        .update(interventiTable)
        .set({ dataAggiornamento: now })
        .where(eq(interventiTable.id, id));
      return row;
    });
    res.json(formatMateriale(updated));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Aggiornamento materiale non valido",
    });
  }
});

router.post("/interventi/:id/avvia", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  let now: Date;
  try {
    now = parseIsoTimestamp(body.dataOraAvvio, "dataOraAvvio") ?? new Date();
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.complete",
    );
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      assertExpectedVersion(body, current);
      if (!isInterventoStato(current.stato))
        throw new RouteError(409, "Stato corrente non riconosciuto");
      if (!["da_pianificare", "pianificato"].includes(current.stato)) {
        throw new RouteError(
          409,
          "L'intervento è già stato avviato o non è avviabile",
        );
      }
      const [row] = await tx
        .update(interventiTable)
        .set({
          stato: "in_corso",
          dataOraAvvio: now,
          dataIntervento: current.dataIntervento ?? dataCivileEuropeRome(now),
          dataAggiornamento: now,
        })
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.stato, current.stato),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Avvio concorrente rilevato");
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: id,
        statoPrecedente: current.stato,
        statoNuovo: "in_corso",
        operatoreId: req.user!.id,
        dataTransizione: now,
        motivo: null,
      });
      return row;
    });
    res.json(await formattedInterventoFor(updated));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error: error instanceof Error ? error.message : "Avvio non valido",
    });
  }
});

router.post("/interventi/:id/salva-operativita", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.update",
    );
    const now = new Date();
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      assertExpectedVersion(body, current);
      if (
        !["da_pianificare", "pianificato", "in_corso"].includes(current.stato)
      ) {
        throw new RouteError(
          409,
          "Un intervento terminale è consultabile in sola lettura",
        );
      }
      await replaceOperativita(tx, current, body, req, now);
      const updates: Partial<typeof interventiTable.$inferInsert> = {
        dataAggiornamento: now,
      };
      if (hasOwn(body, "risultato"))
        updates.risultato = nullableText(body.risultato, "Il risultato", 4000);
      if (hasOwn(body, "esito"))
        updates.esito = nullableText(body.esito, "L'esito", 4000);
      if (hasOwn(body, "note"))
        updates.note = nullableText(body.note, "Le note", 4000);
      const [row] = await tx
        .update(interventiTable)
        .set(updates)
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.stato, current.stato),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Modifica concorrente rilevata");
      return row;
    });
    res.json(await operativitaFor(updated));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    throw error;
  }
});

router.post("/interventi/:id/concludi", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  if (body.conferma !== true) {
    res
      .status(400)
      .json({ error: "La conclusione richiede conferma esplicita" });
    return;
  }
  const successivoInput =
    body.successivo &&
    typeof body.successivo === "object" &&
    !Array.isArray(body.successivo)
      ? (body.successivo as Record<string, unknown>)
      : null;
  if (
    hasOwn(body, "successivo") &&
    body.successivo != null &&
    successivoInput == null
  ) {
    res.status(400).json({ error: "Intervento successivo non valido" });
    return;
  }
  let successivoWorkflow: WorkflowCreateResult | null = null;
  let successivoOperatoreId: number | null = null;
  let conclusionDate: Date;
  try {
    conclusionDate =
      parseIsoTimestamp(body.dataOraConclusione, "dataOraConclusione") ??
      new Date();
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.complete",
    );
    if (successivoInput) {
      requireSocialInterventoPermission(req, "sociale.interventi.create");
      successivoWorkflow = workflowCreateValues(
        successivoInput,
        conclusionDate,
      );
      const successivoStato = successivoWorkflow.values.stato;
      if (
        successivoWorkflow.values.ambito !== "sociale" ||
        (successivoStato !== "da_pianificare" &&
          successivoStato !== "pianificato")
      ) {
        throw new RouteError(
          400,
          "Il successivo deve essere Sociale e da pianificare o pianificato",
        );
      }
      const tipo = requiredText(
        successivoInput.tipoIntervento,
        "La tipologia del successivo",
        120,
      );
      successivoInput.tipoIntervento = tipo;
      successivoOperatoreId = hasOwn(successivoInput, "operatoreId")
        ? optionalPositiveInteger(successivoInput.operatoreId, "operatoreId")
        : req.user!.id;
    }
    const result = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      assertExpectedVersion(body, current);
      if (current.stato !== "in_corso") {
        throw new RouteError(
          409,
          "L'intervento non è in corso o è già concluso",
        );
      }
      if (current.dataOraAvvio == null)
        throw new RouteError(409, "L'intervento non risulta avviato");
      if (conclusionDate < current.dataOraAvvio)
        throw new RouteError(400, "La conclusione non può precedere l'avvio");

      const risultato = hasOwn(body, "risultato")
        ? nullableText(body.risultato, "Il risultato", 4000)
        : current.risultato;
      const esito = hasOwn(body, "esito")
        ? nullableText(body.esito, "L'esito", 4000)
        : current.esito;
      if (risultato == null && esito == null) {
        throw new RouteError(
          400,
          "Inserire almeno un risultato o un esito finale",
        );
      }
      await replaceOperativita(tx, current, body, req, conclusionDate);
      const [concluso] = await tx
        .update(interventiTable)
        .set({
          stato: "concluso",
          risultato,
          esito,
          note: hasOwn(body, "note")
            ? nullableText(body.note, "Le note", 4000)
            : current.note,
          dataOraConclusione: conclusionDate,
          dataAggiornamento: conclusionDate,
        })
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.stato, "in_corso"),
          ),
        )
        .returning();
      if (!concluso)
        throw new RouteError(409, "Conclusione concorrente rilevata");
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: id,
        statoPrecedente: "in_corso",
        statoNuovo: "concluso",
        operatoreId: req.user!.id,
        dataTransizione: conclusionDate,
        motivo: null,
      });

      let successivo: InterventoRow | null = null;
      if (successivoInput && successivoWorkflow && successivoOperatoreId) {
        if (
          !(await canAssignSocialOperator(
            successivoOperatoreId,
            current.beneficiarioId,
            req,
          ))
        ) {
          throw new RouteError(403, "Operatore del successivo non accessibile");
        }
        const [duplicate] = await tx
          .select({ id: interventiTable.id })
          .from(interventiTable)
          .where(
            and(
              eq(interventiTable.interventoPrecedenteId, id),
              inArray(interventiTable.stato, [
                "da_pianificare",
                "pianificato",
                "in_corso",
              ]),
            ),
          )
          .limit(1);
        if (duplicate)
          throw new RouteError(
            409,
            "Esiste già un intervento successivo attivo",
          );
        [successivo] = await tx
          .insert(interventiTable)
          .values({
            ...cleanInterventoBody(successivoInput),
            ...successivoWorkflow.values,
            beneficiarioId: current.beneficiarioId,
            interventoPrecedenteId: id,
            operatoreId: successivoOperatoreId,
            risultato: null,
            esito: null,
          } as never)
          .returning();
        await tx.insert(interventiStoricoStatiTable).values({
          interventoId: successivo.id,
          statoPrecedente: null,
          statoNuovo: successivo.stato,
          operatoreId: req.user!.id,
          dataTransizione: conclusionDate,
          motivo: "Creato contestualmente alla conclusione del precedente",
        });
        await replaceOperativita(
          tx,
          successivo,
          {
            materiali: successivoInput.materiali ?? [],
            documenti: successivoInput.documenti ?? [],
          },
          req,
          conclusionDate,
        );
      }
      return { concluso, successivo };
    });
    res.json({
      intervento: await formattedInterventoFor(result.concluso),
      operativita: await operativitaFor(result.concluso),
      successivo: result.successivo
        ? await formattedInterventoFor(result.successivo)
        : null,
    });
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error: error instanceof Error ? error.message : "Conclusione non valida",
    });
  }
});

router.post("/interventi/:id/annulla", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    const motivo = requiredText(
      body.motivo,
      "Il motivo dell'annullamento",
      2000,
    );
    const now =
      parseIsoTimestamp(body.dataOraAnnullamento, "dataOraAnnullamento") ??
      new Date();
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.cancel",
    );
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      assertExpectedVersion(body, current);
      if (
        !["da_pianificare", "pianificato", "in_corso"].includes(current.stato)
      )
        throw new RouteError(409, "L'intervento è già in uno stato terminale");
      const [row] = await tx
        .update(interventiTable)
        .set({
          stato: "annullato",
          motivoAnnullamento: motivo,
          dataAggiornamento: now,
        })
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.stato, current.stato),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Annullamento concorrente rilevato");
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: id,
        statoPrecedente: current.stato,
        statoNuovo: "annullato",
        operatoreId: req.user!.id,
        dataTransizione: now,
        motivo,
      });
      return row;
    });
    res.json(await formattedInterventoFor(updated));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error: error instanceof Error ? error.message : "Annullamento non valido",
    });
  }
});

router.post("/interventi/:id/mancata-presentazione", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  try {
    const nota = nullableText(body.nota, "La nota", 2000);
    const now =
      parseIsoTimestamp(body.dataOraRegistrazione, "dataOraRegistrazione") ??
      new Date();
    await requireAccessibleIntervento(
      id,
      req,
      "sociale",
      "sociale.interventi.cancel",
    );
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      assertExpectedVersion(body, current);
      if (current.stato !== "pianificato")
        throw new RouteError(
          409,
          "La mancata presentazione richiede un intervento pianificato",
        );
      const [row] = await tx
        .update(interventiTable)
        .set({
          stato: "mancata_presentazione",
          dataOraAvvio: null,
          note: nota ?? current.note,
          dataAggiornamento: now,
        })
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.stato, "pianificato"),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Modifica concorrente rilevata");
      await tx.insert(interventiStoricoStatiTable).values({
        interventoId: id,
        statoPrecedente: "pianificato",
        statoNuovo: "mancata_presentazione",
        operatoreId: req.user!.id,
        dataTransizione: now,
        motivo: nota,
      });
      return row;
    });
    res.json(await formattedInterventoFor(updated));
  } catch (error) {
    if (sendRouteError(error, res)) return;
    res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Mancata presentazione non valida",
    });
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
    existing = await requireAccessibleIntervento(
      id,
      req,
      null,
      "sociale.interventi.update",
    );
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
      await requireManageableInterventoNeeds(id, req);
    } catch (error) {
      if (sendRouteError(error, res)) return;
      throw error;
    }
  }

  const patchNow = new Date();
  const workflowUpdates: Partial<typeof interventiTable.$inferInsert> = {
    dataAggiornamento: patchNow,
  };
  if (hasOwn(body, "operatoreId")) {
    const operatoreId = parsePositiveInteger(body.operatoreId);
    if (operatoreId == null) {
      res.status(400).json({ error: "operatoreId non valido" });
      return;
    }
    if (
      existing.ambito !== "sociale" ||
      !["da_pianificare", "pianificato"].includes(existing.stato) ||
      !(await canAssignSocialOperator(
        operatoreId,
        existing.beneficiarioId,
        req,
      ))
    ) {
      res.status(403).json({ error: "Operatore assegnato non accessibile" });
      return;
    }
    workflowUpdates.operatoreId = operatoreId;
  }
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
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      const expectedVersion = assertExpectedVersion(body, current);
      if (
        ["concluso", "annullato", "mancata_presentazione"].includes(
          current.stato,
        )
      ) {
        throw new RouteError(
          409,
          "Un intervento terminale è storico e consultabile in sola lettura",
        );
      }
      if (current.beneficiarioId !== targetBeneficiarioId) {
        throw new RouteError(
          409,
          "Il beneficiario di una cartella già operativa non può essere modificato",
        );
      }
      if (
        hasOwn(body, "operatoreId") &&
        !["da_pianificare", "pianificato"].includes(current.stato)
      ) {
        throw new RouteError(
          409,
          "L'operatore può essere modificato soltanto prima dell'avvio",
        );
      }
      const [updated] = await tx
        .update(interventiTable)
        .set({
          ...cleanInterventoBody(body),
          ...workflowUpdates,
          beneficiarioId: targetBeneficiarioId,
        } as never)
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.dataAggiornamento, expectedVersion),
          ),
        )
        .returning();
      if (!updated) throw new RouteError(409, "Modifica concorrente rilevata");

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
    const targetPermission: SocialInterventoPermission =
      body.stato === "annullato" || body.stato === "mancata_presentazione"
        ? "sociale.interventi.cancel"
        : body.stato === "in_corso" || body.stato === "concluso"
          ? "sociale.interventi.complete"
          : "sociale.interventi.update";
    await requireAccessibleIntervento(id, req, null, targetPermission);
    const updated = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(interventiTable)
        .where(eq(interventiTable.id, id))
        .for("update");
      if (!current) throw new RouteError(404, "Intervento non trovato");
      const expectedVersion = assertExpectedVersion(body, current);
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
        .where(
          and(
            eq(interventiTable.id, id),
            eq(interventiTable.dataAggiornamento, expectedVersion),
          ),
        )
        .returning();
      if (!row) throw new RouteError(409, "Modifica concorrente rilevata");
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
    const precedente = await requireAccessibleIntervento(
      precedenteId,
      req,
      null,
      "sociale.interventi.create",
    );
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
      await requireManageableInterventoNeeds(interventoId, req);
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
      await requireManageableInterventoNeeds(interventoId, req);
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
