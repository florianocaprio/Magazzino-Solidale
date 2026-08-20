import {
  Router,
  type IRouter,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { createHash } from "node:crypto";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  centriAscoltoTable,
  cittaTable,
  db,
  lottiTable,
  magazziniTable,
  mensaAbilitazioniTable,
  mensaAccessiTable,
  mensaAutorizzazioniTemporaneeTable,
  mensaConsumiStorniTable,
  mensaConsumiTable,
  mensaEccezioniTable,
  mensaGiornateServizioTable,
  mensaPastiTable,
  menseTable,
  prodottiTable,
  tessereBeneficiariTable,
  trasferimentiTable,
  utentiTable,
} from "@workspace/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  callerCittaId,
  callerCentroId,
  callerZonaUdsId,
  canAccessCitta,
  canAccessMagazzino,
  centroScopeFilter,
  cittaScopeFilter,
  visibleMagazzinoIds,
  zonaUdsScopeFilter,
} from "../lib/centroScope";
import { isDateOnly } from "../lib/interventiWorkflow";
import { intervalloGiornoEuropeRome } from "../lib/interventiViste";
import {
  canUseMensaException,
  dataServizioMensa,
  stessoGiornoServizioMensa,
} from "../lib/mensaWorkflow";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { searchBeneficiariDuplicates } from "../lib/beneficiarioDuplicates";
import { createBeneficiarioOne } from "./beneficiari";
import {
  issueTesseraBeneficiario,
  TesseraBeneficiarioError,
} from "../lib/tesseraBeneficiarioService";
import { nextMagazzinoCodice } from "../lib/magazzinoCodice";
import {
  getOrCreateGiornataMensa,
  snapshotBeneficiarioMensa,
  tipoServizioMensa,
} from "../lib/mensaService";
import {
  creaScaricoInventariale,
  InventoryError,
  stornaScaricoInventariale,
} from "../lib/scaricoInventory";
import {
  calcolaImpegnatoAttivoPerGiacenze,
  disponibilitaMagazzinoKey,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import { createTransferRequest } from "../lib/transferWorkflow";

const router: IRouter = Router();
router.use("/mensa", requireModulo("MENSA"));

const ABILITAZIONE_STATI = [
  "attiva",
  "sospesa",
  "revocata",
  "scaduta",
] as const;
const TESSERA_STATI = ["attiva", "sospesa", "revocata", "scaduta"] as const;
const MAX_RIEPILOGO_BENEFICIARI_IDS = 500;
const ACCESSO_MOTIVI = {
  CONSENTITO: "CONSENTITO",
  TESSERA_NON_VALIDA: "TESSERA_NON_VALIDA",
  TESSERA_SOSPESA: "TESSERA_SOSPESA",
  TESSERA_REVOCATA: "TESSERA_REVOCATA",
  TESSERA_SCADUTA: "TESSERA_SCADUTA",
  BENEFICIARIO_NON_ATTIVO: "BENEFICIARIO_NON_ATTIVO",
  ABILITAZIONE_NON_PRESENTE: "ABILITAZIONE_NON_PRESENTE",
  ABILITAZIONE_SOSPESA: "ABILITAZIONE_SOSPESA",
  ABILITAZIONE_REVOCATA: "ABILITAZIONE_REVOCATA",
  ABILITAZIONE_SCADUTA: "ABILITAZIONE_SCADUTA",
  MENSA_NON_AUTORIZZATA: "MENSA_NON_AUTORIZZATA",
  AREA_NON_COMPATIBILE: "AREA_NON_COMPATIBILE",
  MENSA_NON_ATTIVA: "MENSA_NON_ATTIVA",
  ECCEZIONE_STESSA_AREA: "ECCEZIONE_STESSA_AREA",
  ACCESSO_TEMPORANEO: "ACCESSO_TEMPORANEO",
} as const;

type AbilitazioneStato = (typeof ABILITAZIONE_STATI)[number];
type TesseraStato = (typeof TESSERA_STATI)[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isAbilitazioneStato(value: unknown): value is AbilitazioneStato {
  return (
    typeof value === "string" &&
    ABILITAZIONE_STATI.some((stato) => stato === value)
  );
}

class MensaError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendMensaError(error: unknown, res: import("express").Response) {
  if (!(error instanceof MensaError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function positiveInt(value: unknown, field: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new MensaError(400, `${field} non valido`);
  }
  return parsed;
}

function optionalPositiveInt(value: unknown, field: string): number | null {
  if (value == null || value === "") return null;
  return positiveInt(value, field);
}

function pagination(query: Request["query"]) {
  const requested = query.page != null || query.pageSize != null;
  const page = optionalPositiveInt(query.page, "page") ?? 1;
  const pageSize = optionalPositiveInt(query.pageSize, "pageSize") ?? 50;
  if (pageSize > 200)
    throw new MensaError(400, "pageSize non può superare 200");
  return { requested, page, pageSize, offset: (page - 1) * pageSize };
}

function canonicalTipoServizio(value: unknown) {
  try {
    return tipoServizioMensa(value);
  } catch {
    throw new MensaError(400, "Il tipo servizio deve essere pranzo o cena");
  }
}

function databaseErrorCode(error: unknown): unknown {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === "object" && "code" in current) {
      const code = (current as { code?: unknown }).code;
      if (code) return code;
    }
    current =
      typeof current === "object"
        ? (current as { cause?: unknown }).cause
        : null;
  }
  return null;
}

function consumoCodice(idempotencyKey: string) {
  return `MCON-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 20).toUpperCase()}`;
}

function beneficiarioIdsQuery(value: unknown): number[] {
  if (value == null || value === "") return [];
  if (typeof value !== "string") {
    throw new MensaError(400, "beneficiarioIds non valido");
  }
  const parts = value.split(",");
  if (parts.some((part) => !/^\d+$/.test(part))) {
    throw new MensaError(
      400,
      "beneficiarioIds deve contenere ID positivi separati da virgola",
    );
  }
  const ids = [
    ...new Set(parts.map((part) => positiveInt(part, "beneficiarioIds"))),
  ];
  if (ids.length > MAX_RIEPILOGO_BENEFICIARI_IDS) {
    throw new MensaError(
      400,
      `Sono consentiti al massimo ${MAX_RIEPILOGO_BENEFICIARI_IDS} beneficiari`,
    );
  }
  return ids;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new MensaError(400, `${field} è obbligatorio`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new MensaError(400, `${field} supera ${max} caratteri`);
  }
  return normalized;
}

function optionalText(
  value: unknown,
  field: string,
  max: number,
): string | null {
  if (value == null || value === "") return null;
  return text(value, field, max);
}

function magazzinoStato(value: unknown): "attivo" | "inattivo" {
  if (value == null || value === "") return "attivo";
  if (value !== "attivo" && value !== "inattivo") {
    throw new MensaError(400, "Lo stato non è valido");
  }
  return value;
}

async function nextMensaCodice(): Promise<string> {
  const rows = await db.select({ codice: menseTable.codice }).from(menseTable);
  let max = 0;
  for (const row of rows) {
    const match = /^MEN-(\d+)$/.exec(row.codice);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return `MEN-${String(max + 1).padStart(3, "0")}`;
}

function dateOnly(
  value: unknown,
  field: string,
  required = false,
): string | null {
  if (value == null || value === "") {
    if (required) throw new MensaError(400, `${field} è obbligatoria`);
    return null;
  }
  if (typeof value !== "string" || !isDateOnly(value)) {
    throw new MensaError(400, `${field} non valida`);
  }
  return value;
}

function expectedVersion(value: unknown): Date {
  if (typeof value !== "string" || !value.trim()) {
    throw new MensaError(400, "La versione è obbligatoria");
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !value.includes("T")) {
    throw new MensaError(400, "La versione non è un timestamp valido");
  }
  return parsed;
}

function hasPermission(req: Request, permission: string): boolean {
  return !!req.user?.isAdmin || (req.user?.permessi ?? []).includes(permission);
}

function assertPermission(req: Request, permission: string): void {
  if (!hasPermission(req, permission)) {
    throw new MensaError(403, "Permesso non consentito per il ruolo");
  }
}

function requireMensaPermissionOrLegacy(permission: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (
      hasPermission(req, permission) ||
      hasPermission(req, "mensa.transfers.manage")
    ) {
      next();
      return;
    }
    res.status(403).json({ error: "Permesso non consentito per il ruolo" });
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      (current as { code?: string }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object"
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

function auditValues(
  req: Request,
  chiave: string,
  azione: string,
  precedente: Record<string, unknown> | null,
  nuovo: Record<string, unknown> | null,
  note?: string | null,
) {
  return {
    area: "mensa",
    chiave,
    azione,
    valorePrecedente: precedente,
    valoreNuovo: nuovo,
    utenteId: req.user?.id ?? null,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
    note: note ?? null,
  };
}

function formatMensa(
  row: typeof menseTable.$inferSelect,
  cittaNome?: string | null,
  magazzino?: typeof magazziniTable.$inferSelect | null,
  centroAscoltoNome?: string | null,
) {
  return {
    id: row.id,
    codice: row.codice,
    nome: row.nome,
    cittaId: row.cittaId,
    cittaNome: cittaNome ?? null,
    magazzinoId: row.magazzinoId,
    magazzinoNome: magazzino?.nome ?? null,
    centroAscoltoId: magazzino?.centroAscoltoId ?? null,
    centroAscoltoNome: centroAscoltoNome ?? null,
    indirizzo: row.indirizzo ?? null,
    comune: magazzino?.comune ?? null,
    zona: magazzino?.zona ?? null,
    responsabile: magazzino?.responsabile ?? null,
    telefono: magazzino?.telefono ?? null,
    email: magazzino?.email ?? null,
    stato: magazzino?.stato ?? (row.attiva ? "attivo" : "inattivo"),
    statoServizio: row.attiva ? "attivo" : "inattivo",
    statoMagazzino: magazzino?.stato ?? null,
    attiva: row.attiva,
    note: row.note ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    versione: row.updatedAt.toISOString(),
  };
}

async function loadMensa(id: number) {
  const [row] = await db
    .select({
      mensa: menseTable,
      cittaNome: cittaTable.nome,
      magazzino: magazziniTable,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoStato: magazziniTable.stato,
      magazzinoTipo: magazziniTable.tipoMagazzino,
    })
    .from(menseTable)
    .leftJoin(cittaTable, eq(menseTable.cittaId, cittaTable.id))
    .leftJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
    .leftJoin(
      centriAscoltoTable,
      eq(magazziniTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .where(eq(menseTable.id, id));
  return row ?? null;
}

async function requireMensa(id: number, req: Request, active = false) {
  const row = await loadMensa(id);
  if (!row) throw new MensaError(404, "Mensa non trovata");
  if (!canAccessCitta(row.mensa.cittaId, callerCittaId(req))) {
    throw new MensaError(403, "Mensa non accessibile per la tua area");
  }
  if (
    active &&
    (!row.mensa.attiva ||
      row.magazzinoStato !== "attivo" ||
      row.magazzinoTipo !== "mensa")
  ) {
    throw new MensaError(409, "La Mensa o il magazzino associato non è attivo");
  }
  return row;
}

async function requireMensaLogisticsWarehouse(id: number, req: Request) {
  const [warehouse] = await db
    .select({
      id: magazziniTable.id,
      cittaId: magazziniTable.cittaId,
      stato: magazziniTable.stato,
      tipoMagazzino: magazziniTable.tipoMagazzino,
    })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, id));
  if (!warehouse) throw new MensaError(404, "Magazzino non trovato");
  const ownCity = callerCittaId(req);
  if (
    (ownCity != null && warehouse.cittaId !== ownCity) ||
    !(await canAccessMagazzino(id, callerCentroId(req), ownCity))
  ) {
    throw new MensaError(403, "Magazzino non accessibile per la tua area");
  }
  if (warehouse.stato !== "attivo") {
    throw new MensaError(409, "Il magazzino non è attivo");
  }
  return warehouse;
}

function formatAbilitazione(row: {
  abilitazione: typeof mensaAbilitazioniTable.$inferSelect;
  mensaNome: string | null;
  beneficiarioNome: string | null;
  beneficiarioCognome: string | null;
  beneficiarioCodice: string | null;
}) {
  return {
    id: row.abilitazione.id,
    beneficiarioId: row.abilitazione.beneficiarioId,
    beneficiarioNome:
      row.beneficiarioNome && row.beneficiarioCognome
        ? `${row.beneficiarioNome} ${row.beneficiarioCognome}`
        : null,
    beneficiarioCodice: row.beneficiarioCodice,
    mensaId: row.abilitazione.mensaId,
    mensaNome: row.mensaNome,
    dataInizio: row.abilitazione.dataInizio,
    dataFine: row.abilitazione.dataFine ?? null,
    stato: row.abilitazione.stato,
    mensaPrincipale: row.abilitazione.mensaPrincipale,
    motivo: row.abilitazione.motivo ?? null,
    createdBy: row.abilitazione.createdBy ?? null,
    createdAt: row.abilitazione.createdAt.toISOString(),
    versione: row.abilitazione.updatedAt.toISOString(),
  };
}

type MensaRiepilogoStato = AbilitazioneStato | "programmata" | "non_abilitato";
type MensaRiepilogoHistoryRow = {
  id: number;
  dataInizio: string;
  dataFine: string | null;
  stato: AbilitazioneStato;
  mensaPrincipale: boolean;
};

export function riepilogoAbilitazioneMensa(
  records: readonly MensaRiepilogoHistoryRow[],
  today: string,
) {
  const current = records.find(
    (item) =>
      item.mensaPrincipale &&
      item.stato === "attiva" &&
      item.dataInizio <= today &&
      (item.dataFine == null || item.dataFine >= today),
  );
  const shown =
    current ??
    records.find((item) => item.mensaPrincipale) ??
    records[0] ??
    null;
  if (!shown) {
    return { stato: "non_abilitato" as const };
  }
  const stato: MensaRiepilogoStato =
    shown.stato === "attiva" && shown.dataInizio > today
      ? "programmata"
      : shown.stato === "attiva" &&
          shown.dataFine != null &&
          shown.dataFine < today
        ? "scaduta"
        : shown.stato;
  return { stato };
}

async function loadRiepilogoAbilitazioniBeneficiari(
  req: Request,
  beneficiarioIds: number[],
) {
  if (beneficiarioIds.length === 0) return [];
  const conditions: SQL[] = [inArray(beneficiariTable.id, beneficiarioIds)];
  const scopes = [
    centroScopeFilter(beneficiariTable.centroAscoltoId, callerCentroId(req)),
    cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req)),
    zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req)),
  ];
  for (const scope of scopes) if (scope) conditions.push(scope);

  // Una sola query batch, limitata agli ID richiesti e senza PII.
  const rows = await db
    .select({
      beneficiarioId: beneficiariTable.id,
      id: mensaAbilitazioniTable.id,
      dataInizio: mensaAbilitazioniTable.dataInizio,
      dataFine: mensaAbilitazioniTable.dataFine,
      stato: mensaAbilitazioniTable.stato,
      mensaPrincipale: mensaAbilitazioniTable.mensaPrincipale,
    })
    .from(beneficiariTable)
    .leftJoin(
      mensaAbilitazioniTable,
      eq(mensaAbilitazioniTable.beneficiarioId, beneficiariTable.id),
    )
    .where(and(...conditions))
    .orderBy(
      desc(mensaAbilitazioniTable.createdAt),
      desc(mensaAbilitazioniTable.id),
    );

  const histories = new Map<number, MensaRiepilogoHistoryRow[]>();
  for (const row of rows) {
    const records = histories.get(row.beneficiarioId) ?? [];
    if (
      row.id != null &&
      row.dataInizio != null &&
      isAbilitazioneStato(row.stato) &&
      row.mensaPrincipale != null
    ) {
      records.push({
        id: row.id,
        dataInizio: row.dataInizio,
        dataFine: row.dataFine,
        stato: row.stato,
        mensaPrincipale: row.mensaPrincipale,
      });
    }
    histories.set(row.beneficiarioId, records);
  }
  const today = dataServizioMensa();
  return beneficiarioIds.flatMap((beneficiarioId) => {
    const history = histories.get(beneficiarioId);
    return history == null
      ? []
      : [{ beneficiarioId, ...riepilogoAbilitazioneMensa(history, today) }];
  });
}

async function loadAbilitazione(id: number) {
  const [row] = await db
    .select({
      abilitazione: mensaAbilitazioniTable,
      mensaNome: menseTable.nome,
      beneficiarioNome: beneficiariTable.nome,
      beneficiarioCognome: beneficiariTable.cognome,
      beneficiarioCodice: beneficiariTable.codice,
      cittaId: menseTable.cittaId,
    })
    .from(mensaAbilitazioniTable)
    .innerJoin(menseTable, eq(mensaAbilitazioniTable.mensaId, menseTable.id))
    .innerJoin(
      beneficiariTable,
      eq(mensaAbilitazioniTable.beneficiarioId, beneficiariTable.id),
    )
    .where(eq(mensaAbilitazioniTable.id, id));
  return row ?? null;
}

function formatTessera(row: typeof tessereBeneficiariTable.$inferSelect) {
  return {
    id: row.id,
    beneficiarioId: row.beneficiarioId,
    codice: row.codice,
    stato: row.stato,
    dataEmissione: row.dataEmissione.toISOString(),
    dataScadenza: row.dataScadenza ?? null,
    dataRevoca: row.dataRevoca?.toISOString() ?? null,
    motivoRevoca: row.motivoRevoca ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: row.createdAt.toISOString(),
    versione: row.updatedAt.toISOString(),
  };
}

async function expireEndedPrincipalEligibilities(
  tx: Tx,
  beneficiarioId: number,
  today: string,
  req: Request,
): Promise<void> {
  const ended = await tx
    .select()
    .from(mensaAbilitazioniTable)
    .where(
      and(
        eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId),
        eq(mensaAbilitazioniTable.stato, "attiva"),
        eq(mensaAbilitazioniTable.mensaPrincipale, true),
        lt(mensaAbilitazioniTable.dataFine, today),
      ),
    )
    .for("update");
  if (!ended.length) return;

  const updatedAt = new Date();
  await tx
    .update(mensaAbilitazioniTable)
    .set({ stato: "scaduta", updatedAt })
    .where(
      inArray(
        mensaAbilitazioniTable.id,
        ended.map((row) => row.id),
      ),
    );
  await tx.insert(auditConfigurazioniTable).values(
    ended.map((row) =>
      auditValues(
        req,
        `mensa-abilitazione:${row.id}`,
        "scadenza-automatica",
        row as unknown as Record<string, unknown>,
        {
          ...(row as unknown as Record<string, unknown>),
          stato: "scaduta",
          updatedAt,
        },
        `Data fine ${row.dataFine}; data servizio Europe/Rome ${today}`,
      ),
    ),
  );
}

export async function activeEligibility(beneficiarioId: number, today: string) {
  const [active] = await db
    .select({ abilitazione: mensaAbilitazioniTable, mensa: menseTable })
    .from(mensaAbilitazioniTable)
    .innerJoin(menseTable, eq(mensaAbilitazioniTable.mensaId, menseTable.id))
    .where(
      and(
        eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId),
        eq(mensaAbilitazioniTable.stato, "attiva"),
        eq(mensaAbilitazioniTable.mensaPrincipale, true),
        lte(mensaAbilitazioniTable.dataInizio, today),
        or(
          isNull(mensaAbilitazioniTable.dataFine),
          gte(mensaAbilitazioniTable.dataFine, today),
        ),
      ),
    )
    .orderBy(desc(mensaAbilitazioniTable.id))
    .limit(1);
  return active ?? null;
}

async function latestEligibility(beneficiarioId: number) {
  const [latest] = await db
    .select({ abilitazione: mensaAbilitazioniTable, mensa: menseTable })
    .from(mensaAbilitazioniTable)
    .innerJoin(menseTable, eq(mensaAbilitazioniTable.mensaId, menseTable.id))
    .where(eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId))
    .orderBy(
      desc(mensaAbilitazioniTable.createdAt),
      desc(mensaAbilitazioniTable.id),
    )
    .limit(1);
  return latest ?? null;
}

async function loadAccessoDto(id: number) {
  const [row] = await db
    .select({
      accesso: mensaAccessiTable,
      mensa: menseTable,
      beneficiario: beneficiariTable,
      tessera: tessereBeneficiariTable,
    })
    .from(mensaAccessiTable)
    .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
    .leftJoin(
      beneficiariTable,
      eq(mensaAccessiTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      tessereBeneficiariTable,
      eq(mensaAccessiTable.tesseraId, tessereBeneficiariTable.id),
    )
    .where(eq(mensaAccessiTable.id, id));
  if (!row) return null;
  const eligibility = row.beneficiario
    ? await activeEligibility(
        row.beneficiario.id,
        dataServizioMensa(row.accesso.dataOra),
      )
    : null;
  const hidePersonal =
    row.accesso.motivoEsito === ACCESSO_MOTIVI.AREA_NON_COMPATIBILE ||
    row.accesso.motivoEsito === ACCESSO_MOTIVI.TESSERA_NON_VALIDA;
  return {
    id: row.accesso.id,
    mensaId: row.accesso.mensaId,
    mensaNome: row.mensa.nome,
    beneficiarioId: hidePersonal ? null : (row.beneficiario?.id ?? null),
    beneficiarioNome:
      !hidePersonal && row.beneficiario
        ? `${row.beneficiario.nome} ${row.beneficiario.cognome}`
        : null,
    beneficiarioCodice:
      !hidePersonal && row.beneficiario ? row.beneficiario.codice : null,
    mensaPrincipaleId: hidePersonal ? null : (eligibility?.mensa.id ?? null),
    mensaPrincipaleNome: hidePersonal
      ? null
      : (eligibility?.mensa.nome ?? null),
    statoAbilitazione: hidePersonal
      ? null
      : (eligibility?.abilitazione.stato ?? null),
    restrizioniAlimentari:
      !hidePersonal && row.beneficiario
        ? row.beneficiario.restrizioniAlimentari
        : null,
    allergie:
      !hidePersonal && row.beneficiario ? row.beneficiario.allergie : null,
    esito: row.accesso.esito,
    motivoEsito: row.accesso.motivoEsito,
    modalitaAccesso: row.accesso.modalitaAccesso,
    tipoServizio: row.accesso.tipoServizio ?? null,
    temporaneo: row.accesso.autorizzazioneTemporaneaId != null,
    dataOra: row.accesso.dataOra.toISOString(),
    eccezioneId: row.accesso.eccezioneId ?? null,
    eccezionePossibile:
      row.accesso.esito === "negato" &&
      row.accesso.motivoEsito === ACCESSO_MOTIVI.MENSA_NON_AUTORIZZATA &&
      canUseMensaException(
        eligibility?.mensa.cittaId ?? null,
        row.mensa.cittaId,
      ),
  };
}

router.get(
  "/mensa/mense",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const ownCity = callerCittaId(req);
      const requestedCity = optionalPositiveInt(req.query.cittaId, "cittaId");
      if (ownCity != null) {
        conditions.push(eq(menseTable.cittaId, ownCity));
      } else if (requestedCity != null) {
        conditions.push(eq(menseTable.cittaId, requestedCity));
      }
      if (req.query.attiva === "true")
        conditions.push(eq(menseTable.attiva, true));
      if (req.query.attiva === "false")
        conditions.push(eq(menseTable.attiva, false));
      const rows = await db
        .select({
          mensa: menseTable,
          cittaNome: cittaTable.nome,
          magazzino: magazziniTable,
          centroAscoltoNome: centriAscoltoTable.nome,
        })
        .from(menseTable)
        .leftJoin(cittaTable, eq(menseTable.cittaId, cittaTable.id))
        .leftJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
        .leftJoin(
          centriAscoltoTable,
          eq(magazziniTable.centroAscoltoId, centriAscoltoTable.id),
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(menseTable.createdAt), desc(menseTable.id));
      res.json(
        rows.map((row) =>
          formatMensa(
            row.mensa,
            row.cittaNome,
            row.magazzino,
            row.centroAscoltoNome,
          ),
        ),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/mense/:id",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const row = await requireMensa(positiveInt(req.params.id, "id"), req);
      res.json(
        formatMensa(
          row.mensa,
          row.cittaNome,
          row.magazzino,
          row.centroAscoltoNome,
        ),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/mense",
  requirePermission("mensa.manage"),
  async (req, res) => {
    try {
      const providedCodice = optionalText(req.body?.codice, "Il codice", 30);
      const nome = text(req.body?.nome, "Il nome", 160);
      const ownCity = callerCittaId(req);
      const cittaId = ownCity ?? positiveInt(req.body?.cittaId, "cittaId");
      if (
        ownCity != null &&
        req.body?.cittaId != null &&
        Number(req.body.cittaId) !== ownCity
      ) {
        throw new MensaError(403, "La Mensa deve appartenere alla tua area");
      }
      const [area] = await db
        .select({ id: cittaTable.id })
        .from(cittaTable)
        .where(eq(cittaTable.id, cittaId));
      if (!area) throw new MensaError(400, "Area non trovata");

      const ownCenter = callerCentroId(req);
      const centroAscoltoId =
        ownCenter ??
        optionalPositiveInt(req.body?.centroAscoltoId, "centroAscoltoId");
      if (
        ownCenter != null &&
        req.body?.centroAscoltoId != null &&
        Number(req.body.centroAscoltoId) !== ownCenter
      ) {
        throw new MensaError(
          403,
          "La Mensa deve appartenere al tuo Centro di Ascolto",
        );
      }
      if (centroAscoltoId != null) {
        const [centro] = await db
          .select({
            cittaId: centriAscoltoTable.cittaId,
            attivo: centriAscoltoTable.attivo,
          })
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, centroAscoltoId));
        if (!centro) throw new MensaError(400, "Centro di Ascolto non trovato");
        if (!centro.attivo) {
          throw new MensaError(409, "Il Centro di Ascolto non è attivo");
        }
        if (centro.cittaId !== cittaId) {
          throw new MensaError(
            400,
            "Il Centro di Ascolto deve appartenere alla stessa area della Mensa",
          );
        }
      }
      if (req.body?.magazzinoId != null) {
        throw new MensaError(
          400,
          "Non selezionare un'ubicazione logistica: il magazzino Mensa viene creato automaticamente",
        );
      }

      const stato = magazzinoStato(req.body?.stato);
      const indirizzo = optionalText(req.body?.indirizzo, "L'indirizzo", 200);
      const comune = optionalText(req.body?.comune, "Il comune", 80);
      const zona = optionalText(req.body?.zona, "La zona", 80);
      const responsabile = optionalText(
        req.body?.responsabile,
        "Il responsabile",
        120,
      );
      const telefono = optionalText(req.body?.telefono, "Il telefono", 20);
      const email = optionalText(req.body?.email, "L'email", 120);
      const note = optionalText(req.body?.note, "Le note", 4000);

      const MAX_ATTEMPTS = 5;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        const codice = providedCodice ?? (await nextMensaCodice());
        const codiceMagazzino = await nextMagazzinoCodice();
        try {
          const created = await db.transaction(async (tx) => {
            const [warehouse] = await tx
              .insert(magazziniTable)
              .values({
                codice: codiceMagazzino,
                nome,
                cittaId,
                centroAscoltoId,
                indirizzo,
                comune,
                zona,
                responsabile,
                telefono,
                email,
                tipoMagazzino: "mensa",
                stato,
                note,
              })
              .returning();
            const [row] = await tx
              .insert(menseTable)
              .values({
                codice,
                nome,
                cittaId,
                magazzinoId: warehouse.id,
                indirizzo,
                attiva: stato === "attivo",
                note,
                createdBy: req.user!.id,
              })
              .returning();
            await tx.insert(auditConfigurazioniTable).values(
              auditValues(req, `mensa:${row.id}`, "creazione", null, {
                codice,
                nome,
                cittaId,
                centroAscoltoId,
                magazzinoId: warehouse.id,
                codiceMagazzino,
              }),
            );
            return row;
          });
          const loaded = await loadMensa(created.id);
          res
            .status(201)
            .json(
              formatMensa(
                created,
                loaded?.cittaNome ?? null,
                loaded?.magazzino ?? null,
                loaded?.centroAscoltoNome ?? null,
              ),
            );
          return;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          if (providedCodice) {
            throw new MensaError(409, `Codice "${providedCodice}" già in uso`);
          }
          if (attempt === MAX_ATTEMPTS - 1) {
            throw new MensaError(
              409,
              "Impossibile generare codici univoci per la Mensa, riprova",
            );
          }
        }
      }
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/tessere",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const beneficiarioId = positiveInt(
        req.query.beneficiarioId,
        "beneficiarioId",
      );
      const [beneficiario] = await db
        .select({ cittaId: beneficiariTable.cittaId })
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId));
      if (!beneficiario) throw new MensaError(404, "Beneficiario non trovato");
      const ownCity = callerCittaId(req);
      if (ownCity != null && beneficiario.cittaId !== ownCity)
        throw new MensaError(403, "Beneficiario non accessibile");
      const rows = await db
        .select()
        .from(tessereBeneficiariTable)
        .where(eq(tessereBeneficiariTable.beneficiarioId, beneficiarioId))
        .orderBy(desc(tessereBeneficiariTable.createdAt));
      res.json(rows.map(formatTessera));
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/tessere",
  requirePermission("mensa.cards.manage"),
  async (req, res) => {
    try {
      const beneficiarioId = positiveInt(
        req.body?.beneficiarioId,
        "beneficiarioId",
      );
      const [beneficiario] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId));
      if (!beneficiario) throw new MensaError(404, "Beneficiario non trovato");
      if (!beneficiario.attivo)
        throw new MensaError(409, "Il beneficiario non è attivo");
      if (
        beneficiario.statoAnagrafica !== "completa" ||
        beneficiario.centroAscoltoId == null
      )
        throw new MensaError(
          409,
          "Completa l'anagrafica e associa un Centro di Ascolto prima di emettere la tessera",
        );
      const ownCity = callerCittaId(req);
      if (ownCity != null && beneficiario.cittaId !== ownCity)
        throw new MensaError(403, "Beneficiario non accessibile");
      const dataScadenza = dateOnly(req.body?.dataScadenza, "La scadenza");
      const motivoSostituzione = optionalText(
        req.body?.motivoSostituzione,
        "Il motivo della sostituzione",
        1000,
      );
      const created = await issueTesseraBeneficiario({
        beneficiarioId,
        dataScadenza,
        motivoSostituzione,
        operatoreId: req.user!.id,
        ip: req.ip ?? req.socket.remoteAddress ?? null,
        areaAudit: "mensa",
      });
      res.status(201).json(formatTessera(created));
    } catch (error) {
      if (error instanceof TesseraBeneficiarioError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Esiste già una tessera attiva" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/tessere/:id/stato",
  requirePermission("mensa.cards.manage"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const stato = req.body?.stato;
      if (
        typeof stato !== "string" ||
        !TESSERA_STATI.includes(stato as TesseraStato)
      )
        throw new MensaError(400, "Stato tessera non valido");
      const motivo = optionalText(req.body?.motivo, "Il motivo", 1000);
      if (["sospesa", "revocata"].includes(stato) && !motivo)
        throw new MensaError(400, "Il motivo è obbligatorio");
      const version = expectedVersion(req.body?.versione);
      const [current] = await db
        .select({
          tessera: tessereBeneficiariTable,
          cittaId: beneficiariTable.cittaId,
        })
        .from(tessereBeneficiariTable)
        .innerJoin(
          beneficiariTable,
          eq(tessereBeneficiariTable.beneficiarioId, beneficiariTable.id),
        )
        .where(eq(tessereBeneficiariTable.id, id));
      if (!current) throw new MensaError(404, "Tessera non trovata");
      const ownCity = callerCittaId(req);
      if (ownCity != null && current.cittaId !== ownCity)
        throw new MensaError(403, "Tessera non accessibile");
      const updated = await db.transaction(async (tx) => {
        const allowed: Record<TesseraStato, readonly TesseraStato[]> = {
          attiva: ["sospesa", "revocata", "scaduta"],
          sospesa: ["attiva", "revocata", "scaduta"],
          revocata: [],
          scaduta: [],
        };
        if (
          !allowed[current.tessera.stato as TesseraStato]?.includes(
            stato as TesseraStato,
          )
        ) {
          throw new MensaError(
            409,
            `Transizione tessera ${current.tessera.stato} → ${stato} non consentita`,
          );
        }
        const [row] = await tx
          .update(tessereBeneficiariTable)
          .set({
            stato,
            motivoRevoca: ["sospesa", "revocata"].includes(stato)
              ? motivo
              : null,
            dataRevoca: stato === "revocata" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(tessereBeneficiariTable.id, id),
              sql`date_trunc('milliseconds', ${tessereBeneficiariTable.updatedAt}) = ${version}`,
            ),
          )
          .returning();
        if (!row)
          throw new MensaError(
            409,
            "La tessera è stata modificata; ricarica i dati",
          );
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `tessera-beneficiario:${id}`,
              stato,
              formatTessera(current.tessera) as Record<string, unknown>,
              formatTessera(row) as Record<string, unknown>,
              motivo,
            ),
          );
        return row;
      });
      res.json(formatTessera(updated));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Esiste già una tessera attiva" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/accessi/verifica",
  requirePermission("mensa.access.scan"),
  async (req, res) => {
    try {
      const mensaId = positiveInt(req.body?.mensaId, "mensaId");
      const idempotencyKey = text(
        req.body?.idempotencyKey,
        "La chiave di idempotenza",
        80,
      );
      const modalita = req.body?.modalitaAccesso ?? "tessera";
      const tipoServizio = canonicalTipoServizio(
        req.body?.tipoServizio ?? "pranzo",
      );
      if (!["tessera", "manuale"].includes(modalita))
        throw new MensaError(400, "Modalità di accesso non valida");
      if (modalita === "manuale") assertPermission(req, "mensa.access.manual");
      const existing = await db
        .select({ id: mensaAccessiTable.id })
        .from(mensaAccessiTable)
        .where(eq(mensaAccessiTable.idempotencyKey, idempotencyKey))
        .limit(1);
      if (existing[0]) {
        const dto = await loadAccessoDto(existing[0].id);
        res.json({ ...dto, idempotentReplay: true });
        return;
      }
      const mensa = await requireMensa(mensaId, req);
      const now = new Date();
      const today = dataServizioMensa(now);
      let tessera: typeof tessereBeneficiariTable.$inferSelect | null = null;
      let beneficiario: typeof beneficiariTable.$inferSelect | null = null;
      if (modalita === "tessera") {
        const codiceTessera = text(req.body?.codiceTessera, "La tessera", 64);
        [tessera = null] = await db
          .select()
          .from(tessereBeneficiariTable)
          .where(eq(tessereBeneficiariTable.codice, codiceTessera))
          .limit(1);
        if (tessera) {
          [beneficiario = null] = await db
            .select()
            .from(beneficiariTable)
            .where(eq(beneficiariTable.id, tessera.beneficiarioId))
            .limit(1);
        }
      } else {
        const beneficiarioId = positiveInt(
          req.body?.beneficiarioId,
          "beneficiarioId",
        );
        [beneficiario = null] = await db
          .select()
          .from(beneficiariTable)
          .where(eq(beneficiariTable.id, beneficiarioId))
          .limit(1);
      }

      let esito = "negato";
      let motivoEsito: string = ACCESSO_MOTIVI.TESSERA_NON_VALIDA;
      let eligibility: Awaited<ReturnType<typeof activeEligibility>> | null =
        null;
      if (
        !mensa.mensa.attiva ||
        mensa.magazzinoStato !== "attivo" ||
        mensa.magazzinoTipo !== "mensa"
      ) {
        motivoEsito = ACCESSO_MOTIVI.MENSA_NON_ATTIVA;
      } else if (modalita === "tessera" && !tessera) {
        motivoEsito = ACCESSO_MOTIVI.TESSERA_NON_VALIDA;
      } else if (tessera?.stato === "sospesa") {
        motivoEsito = ACCESSO_MOTIVI.TESSERA_SOSPESA;
      } else if (tessera?.stato === "revocata") {
        motivoEsito = ACCESSO_MOTIVI.TESSERA_REVOCATA;
      } else if (
        tessera?.stato === "scaduta" ||
        (tessera?.dataScadenza != null && tessera.dataScadenza < today)
      ) {
        motivoEsito = ACCESSO_MOTIVI.TESSERA_SCADUTA;
      } else if (!beneficiario) {
        motivoEsito = ACCESSO_MOTIVI.TESSERA_NON_VALIDA;
      } else if (beneficiario.cittaId !== mensa.mensa.cittaId) {
        motivoEsito = ACCESSO_MOTIVI.AREA_NON_COMPATIBILE;
      } else if (!beneficiario.attivo) {
        motivoEsito = ACCESSO_MOTIVI.BENEFICIARIO_NON_ATTIVO;
      } else {
        eligibility = await activeEligibility(beneficiario.id, today);
        if (!eligibility) {
          const latest = await latestEligibility(beneficiario.id);
          if (!latest) motivoEsito = ACCESSO_MOTIVI.ABILITAZIONE_NON_PRESENTE;
          else if (latest.abilitazione.stato === "sospesa")
            motivoEsito = ACCESSO_MOTIVI.ABILITAZIONE_SOSPESA;
          else if (latest.abilitazione.stato === "revocata")
            motivoEsito = ACCESSO_MOTIVI.ABILITAZIONE_REVOCATA;
          else motivoEsito = ACCESSO_MOTIVI.ABILITAZIONE_SCADUTA;
        } else if (eligibility.mensa.id !== mensaId) {
          motivoEsito = ACCESSO_MOTIVI.MENSA_NON_AUTORIZZATA;
        } else {
          esito = "consentito";
          motivoEsito = ACCESSO_MOTIVI.CONSENTITO;
        }
      }

      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(mensaAccessiTable)
          .values({
            mensaId,
            beneficiarioId: beneficiario?.id ?? null,
            tesseraId: tessera?.id ?? null,
            dataOra: now,
            esito,
            motivoEsito,
            operatoreId: req.user!.id,
            modalitaAccesso: modalita,
            tipoServizio,
            idempotencyKey,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(req, `mensa-accesso:${row.id}`, "verifica", null, {
            mensaId,
            beneficiarioId: beneficiario?.id ?? null,
            esito,
            motivoEsito,
            modalita,
            tipoServizio,
          }),
        );
        return row;
      });
      res.status(201).json(await loadAccessoDto(created.id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const key =
          typeof req.body?.idempotencyKey === "string"
            ? req.body.idempotencyKey
            : "";
        const [existing] = await db
          .select({ id: mensaAccessiTable.id })
          .from(mensaAccessiTable)
          .where(eq(mensaAccessiTable.idempotencyKey, key));
        if (existing) {
          res.json({
            ...(await loadAccessoDto(existing.id)),
            idempotentReplay: true,
          });
          return;
        }
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/accessi/temporaneo",
  requirePermission("mensa.access.temporary"),
  async (req, res) => {
    try {
      const mensaId = positiveInt(req.body?.mensaId, "mensaId");
      const idempotencyKey = text(
        req.body?.idempotencyKey,
        "La chiave di idempotenza",
        80,
      );
      const tipoServizio = canonicalTipoServizio(
        req.body?.tipoServizio ?? "pranzo",
      );
      const [replay] = await db
        .select({ id: mensaAccessiTable.id })
        .from(mensaAccessiTable)
        .where(eq(mensaAccessiTable.idempotencyKey, idempotencyKey));
      if (replay) {
        res.json({
          ...(await loadAccessoDto(replay.id)),
          idempotentReplay: true,
        });
        return;
      }
      const mensa = await requireMensa(mensaId, req, true);
      const nuovaPersona = req.body?.nuovaPersona as
        | Record<string, unknown>
        | undefined;
      const beneficiarioIdInput = req.body?.beneficiarioId;
      if (!!nuovaPersona === (beneficiarioIdInput != null)) {
        throw new MensaError(
          400,
          "Indicare una nuova persona oppure un beneficiario esistente",
        );
      }
      const motivo =
        optionalText(req.body?.motivo, "Il motivo", 2000) ??
        "Accesso temporaneo autorizzato dalla Postazione Mensa";
      const today = dataServizioMensa(new Date());
      let duplicates: Awaited<ReturnType<typeof searchBeneficiariDuplicates>> =
        [];
      let newPersonValues: Record<string, unknown> | null = null;
      if (nuovaPersona) {
        const nome = text(nuovaPersona.nome, "Il nome", 80);
        const cognome = text(nuovaPersona.cognome, "Il cognome", 80);
        const hasBirthDate =
          typeof nuovaPersona.dataNascita === "string" &&
          nuovaPersona.dataNascita.trim().length > 0;
        const hasEstimatedBand =
          typeof nuovaPersona.fasciaEtaPresunta === "string" &&
          nuovaPersona.fasciaEtaPresunta.trim().length > 0;
        if (hasBirthDate === hasEstimatedBand) {
          throw new MensaError(
            400,
            "Indicare la data di nascita oppure una fascia d'età presunta",
          );
        }
        newPersonValues = {
          nome,
          cognome,
          sesso: nuovaPersona.sesso,
          dataNascita: hasBirthDate ? nuovaPersona.dataNascita : null,
          fasciaEtaPresunta: hasEstimatedBand
            ? nuovaPersona.fasciaEtaPresunta
            : null,
          telefono: optionalText(nuovaPersona.telefono, "Il telefono", 20),
          cittadinanza: optionalText(
            nuovaPersona.cittadinanza,
            "La cittadinanza",
            60,
          ),
          allergie: optionalText(nuovaPersona.allergie, "Le allergie", 4000),
          restrizioniAlimentari: optionalText(
            nuovaPersona.restrizioniAlimentari,
            "Le restrizioni alimentari",
            4000,
          ),
          statoAnagrafica: "provvisoria",
          uds: false,
        };
        duplicates = await searchBeneficiariDuplicates({
          cittaId: mensa.mensa.cittaId,
          search: `${nome} ${cognome}`,
          nome,
          cognome,
          telefono: (newPersonValues.telefono as string | null) ?? "",
          dataNascita: (newPersonValues.dataNascita as string | null) ?? "",
        });
        if (duplicates.length && req.body?.confermaDuplicato !== true) {
          res.status(409).json({
            error:
              "Sono presenti possibili duplicati. Seleziona una persona esistente oppure conferma esplicitamente la nuova registrazione.",
            possibiliDuplicati: duplicates,
          });
          return;
        }
      }

      const createdAccessId = await db.transaction(async (tx) => {
        let beneficiario: typeof beneficiariTable.$inferSelect;
        if (newPersonValues) {
          const created = await createBeneficiarioOne(newPersonValues, req, {
            executor: tx,
            cittaId: mensa.mensa.cittaId,
            centroAscoltoId: null,
            zonaUdsId: null,
            allowSensitiveFields: true,
          });
          if ("error" in created) {
            throw new MensaError(created.status ?? 400, created.error);
          }
          beneficiario = created.row;
          await tx.insert(auditConfigurazioniTable).values({
            ...auditValues(
              req,
              `beneficiario:${beneficiario.id}`,
              "creazione-provvisoria-mensa",
              null,
              {
                beneficiarioId: beneficiario.id,
                cittaId: beneficiario.cittaId,
                statoAnagrafica: beneficiario.statoAnagrafica,
              },
              motivo,
            ),
            area: "beneficiari",
          });
          if (duplicates.length) {
            await tx.insert(auditConfigurazioniTable).values({
              ...auditValues(
                req,
                `beneficiario:${beneficiario.id}`,
                "duplicato-potenziale-confermato",
                { possibiliDuplicatiIds: duplicates.map((item) => item.id) },
                { beneficiarioId: beneficiario.id },
                motivo,
              ),
              area: "beneficiari",
            });
          }
        } else {
          const beneficiarioId = positiveInt(
            beneficiarioIdInput,
            "beneficiarioId",
          );
          const [existing] = await tx
            .select()
            .from(beneficiariTable)
            .where(eq(beneficiariTable.id, beneficiarioId))
            .for("update");
          if (!existing || existing.cittaId !== mensa.mensa.cittaId) {
            throw new MensaError(404, "Beneficiario non disponibile");
          }
          if (!existing.attivo) {
            throw new MensaError(409, "Il beneficiario non è attivo");
          }
          if (await activeEligibility(existing.id, today)) {
            throw new MensaError(
              409,
              "Il beneficiario dispone già di un'abilitazione Mensa valida",
            );
          }
          const latest = await latestEligibility(existing.id);
          if (
            latest?.abilitazione.stato === "sospesa" ||
            latest?.abilitazione.stato === "revocata"
          ) {
            throw new MensaError(
              409,
              `Accesso temporaneo non consentito: abilitazione Mensa ${latest.abilitazione.stato}`,
            );
          }
          beneficiario = existing;
        }
        const [authorization] = await tx
          .insert(mensaAutorizzazioniTemporaneeTable)
          .values({
            beneficiarioId: beneficiario.id,
            mensaId,
            dataServizio: today,
            motivo,
            operatoreId: req.user!.id,
          })
          .returning();
        const [access] = await tx
          .insert(mensaAccessiTable)
          .values({
            mensaId,
            beneficiarioId: beneficiario.id,
            tesseraId: null,
            autorizzazioneTemporaneaId: authorization.id,
            esito: "consentito",
            motivoEsito: ACCESSO_MOTIVI.ACCESSO_TEMPORANEO,
            operatoreId: req.user!.id,
            modalitaAccesso: "temporaneo",
            tipoServizio,
            idempotencyKey,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(
            req,
            `mensa-accesso:${access.id}`,
            "autorizzazione-temporanea",
            null,
            {
              autorizzazioneId: authorization.id,
              beneficiarioId: beneficiario.id,
              mensaId,
              dataServizio: today,
              tipoServizio,
            },
            motivo,
          ),
        );
        return access.id;
      });
      res.status(201).json(await loadAccessoDto(createdAccessId));
    } catch (error) {
      if (isUniqueViolation(error)) {
        const key =
          typeof req.body?.idempotencyKey === "string"
            ? req.body.idempotencyKey
            : "";
        const [existing] = await db
          .select({ id: mensaAccessiTable.id })
          .from(mensaAccessiTable)
          .where(eq(mensaAccessiTable.idempotencyKey, key));
        if (existing) {
          res.json({
            ...(await loadAccessoDto(existing.id)),
            idempotentReplay: true,
          });
          return;
        }
        res.status(409).json({
          error:
            "Esiste già un'autorizzazione temporanea per questa persona nella giornata corrente",
        });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/accessi/:id/eccezione",
  requirePermission("mensa.exceptions.manage"),
  async (req, res) => {
    try {
      const accessoId = positiveInt(req.params.id, "id");
      const motivo = text(req.body?.motivo, "Il motivo", 2000);
      const result = await db.transaction(async (tx) => {
        const [row] = await tx
          .select({
            accesso: mensaAccessiTable,
            destinazione: menseTable,
            magazzinoStato: magazziniTable.stato,
            magazzinoTipo: magazziniTable.tipoMagazzino,
          })
          .from(mensaAccessiTable)
          .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
          .innerJoin(
            magazziniTable,
            eq(menseTable.magazzinoId, magazziniTable.id),
          )
          .where(eq(mensaAccessiTable.id, accessoId))
          .for("update");
        if (!row) throw new MensaError(404, "Accesso non trovato");
        if (!canAccessCitta(row.destinazione.cittaId, callerCittaId(req)))
          throw new MensaError(403, "Accesso non disponibile");
        if (
          !row.destinazione.attiva ||
          row.magazzinoStato !== "attivo" ||
          row.magazzinoTipo !== "mensa"
        )
          throw new MensaError(
            409,
            "La Mensa o il magazzino associato non è attivo",
          );
        if (
          row.accesso.esito !== "negato" ||
          row.accesso.motivoEsito !== ACCESSO_MOTIVI.MENSA_NON_AUTORIZZATA ||
          row.accesso.beneficiarioId == null
        )
          throw new MensaError(409, "Questo accesso non ammette eccezioni");
        const eligibility = await activeEligibility(
          row.accesso.beneficiarioId,
          dataServizioMensa(row.accesso.dataOra),
        );
        if (
          !eligibility ||
          !canUseMensaException(
            eligibility.mensa.cittaId,
            row.destinazione.cittaId,
          )
        )
          throw new MensaError(
            403,
            "L'eccezione è consentita solo nella stessa area territoriale",
          );
        const [exception] = await tx
          .insert(mensaEccezioniTable)
          .values({
            beneficiarioId: row.accesso.beneficiarioId,
            mensaPrincipaleId: eligibility.mensa.id,
            mensaDestinazioneId: row.destinazione.id,
            cittaId: row.destinazione.cittaId,
            motivo,
            operatoreId: req.user!.id,
            accessoMensaId: accessoId,
          })
          .returning();
        const [access] = await tx
          .update(mensaAccessiTable)
          .set({
            esito: "consentito_eccezione",
            motivoEsito: ACCESSO_MOTIVI.ECCEZIONE_STESSA_AREA,
            eccezioneId: exception.id,
          })
          .where(
            and(
              eq(mensaAccessiTable.id, accessoId),
              eq(mensaAccessiTable.esito, "negato"),
              isNull(mensaAccessiTable.eccezioneId),
            ),
          )
          .returning();
        if (!access) throw new MensaError(409, "Accesso già gestito");
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa-accesso:${accessoId}`,
              "eccezione-stessa-area",
              row.accesso as unknown as Record<string, unknown>,
              access as unknown as Record<string, unknown>,
              motivo,
            ),
          );
        return access;
      });
      res.json(await loadAccessoDto(result.id));
    } catch (error) {
      if (isUniqueViolation(error)) {
        res.status(409).json({ error: "Eccezione già registrata" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/accessi",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      if (mensaId != null)
        conditions.push(eq(mensaAccessiTable.mensaId, mensaId));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
      const paging = pagination(req.query);
      const where = conditions.length ? and(...conditions) : undefined;
      const [totalRow] = paging.requested
        ? await db
            .select({ total: count() })
            .from(mensaAccessiTable)
            .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
            .where(where)
        : [{ total: 0 }];
      const rows = await db
        .select({ id: mensaAccessiTable.id })
        .from(mensaAccessiTable)
        .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
        .where(where)
        .orderBy(desc(mensaAccessiTable.dataOra))
        .limit(paging.requested ? paging.pageSize : 200)
        .offset(paging.requested ? paging.offset : 0);
      const results = await Promise.all(
        rows.map((row) => loadAccessoDto(row.id)),
      );
      const items = results.filter(Boolean);
      res.json(
        paging.requested
          ? {
              items,
              page: paging.page,
              pageSize: paging.pageSize,
              total: totalRow?.total ?? 0,
            }
          : items,
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/pasti",
  requirePermission("mensa.meals.create"),
  async (req, res) => {
    try {
      const accessoId = positiveInt(req.body?.accessoMensaId, "accessoMensaId");
      const idempotencyKey = text(
        req.body?.idempotencyKey,
        "La chiave di idempotenza",
        80,
      );
      const tipoServizio = canonicalTipoServizio(req.body?.tipoServizio);
      const override = req.body?.override === true;
      const motivoOverride = optionalText(
        req.body?.motivoOverride,
        "Il motivo dell'override",
        2000,
      );
      if (override) {
        assertPermission(req, "mensa.meals.override");
        if (!motivoOverride)
          throw new MensaError(400, "Il motivo dell'override è obbligatorio");
      }
      const [replay] = await db
        .select()
        .from(mensaPastiTable)
        .where(eq(mensaPastiTable.idempotencyKey, idempotencyKey));
      if (replay) {
        res.json({ ...replay, idempotentReplay: true });
        return;
      }
      const [access] = await db
        .select({
          accesso: mensaAccessiTable,
          mensa: menseTable,
          autorizzazioneTemporanea: mensaAutorizzazioniTemporaneeTable,
        })
        .from(mensaAccessiTable)
        .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
        .leftJoin(
          mensaAutorizzazioniTemporaneeTable,
          eq(
            mensaAccessiTable.autorizzazioneTemporaneaId,
            mensaAutorizzazioniTemporaneeTable.id,
          ),
        )
        .where(eq(mensaAccessiTable.id, accessoId));
      if (!access) throw new MensaError(404, "Accesso non trovato");
      if (
        access.accesso.tipoServizio != null &&
        access.accesso.tipoServizio !== tipoServizio
      ) {
        throw new MensaError(
          409,
          "Il tipo servizio del pasto non corrisponde alla verifica accesso",
        );
      }
      if (!canAccessCitta(access.mensa.cittaId, callerCittaId(req)))
        throw new MensaError(403, "Accesso non disponibile");
      await requireMensa(access.mensa.id, req, true);
      if (
        !["consentito", "consentito_eccezione"].includes(
          access.accesso.esito,
        ) ||
        access.accesso.beneficiarioId == null
      )
        throw new MensaError(409, "Il pasto richiede un accesso consentito");
      const beneficiarioId = access.accesso.beneficiarioId;
      const now = new Date();
      const serviceDate = dataServizioMensa(now);
      if (!stessoGiornoServizioMensa(access.accesso.dataOra, now)) {
        throw new MensaError(
          409,
          "L'accesso Mensa non è valido per la data di servizio corrente",
        );
      }
      if (
        access.accesso.modalitaAccesso === "temporaneo" &&
        (!access.autorizzazioneTemporanea ||
          access.autorizzazioneTemporanea.dataServizio !== serviceDate)
      ) {
        throw new MensaError(
          409,
          "L'autorizzazione temporanea non è valida per la data di servizio corrente",
        );
      }
      const [sameService] = await db
        .select({ id: mensaPastiTable.id })
        .from(mensaPastiTable)
        .where(
          and(
            eq(mensaPastiTable.beneficiarioId, access.accesso.beneficiarioId),
            eq(mensaPastiTable.dataServizio, serviceDate),
            eq(mensaPastiTable.tipoServizio, tipoServizio),
          ),
        );
      if (sameService && !override)
        throw new MensaError(
          409,
          "Servizio già erogato oggi; serve un override autorizzato",
        );
      const created = await db.transaction(async (tx) => {
        const giornata = await getOrCreateGiornataMensa(tx, {
          mensaId: access.accesso.mensaId,
          dataServizio: serviceDate,
          tipoServizio,
          operatoreId: req.user!.id,
        });
        const snapshot = await snapshotBeneficiarioMensa(
          tx,
          beneficiarioId,
          serviceDate,
        );
        const [row] = await tx
          .insert(mensaPastiTable)
          .values({
            mensaId: access.accesso.mensaId,
            beneficiarioId,
            accessoMensaId: accessoId,
            dataOra: now,
            dataServizio: serviceDate,
            tipoServizio,
            giornataServizioId: giornata.id,
            ...snapshot,
            temporaneoSnapshot: access.accesso.modalitaAccesso === "temporaneo",
            operatoreId: req.user!.id,
            eccezioneId: access.accesso.eccezioneId,
            note: optionalText(req.body?.note, "Le note operative", 2000),
            override,
            motivoOverride,
            idempotencyKey,
          })
          .returning();
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa-pasto:${row.id}`,
              override ? "registrazione-override" : "registrazione",
              null,
              row as unknown as Record<string, unknown>,
              motivoOverride,
            ),
          );
        return row;
      });
      res.status(201).json(created);
    } catch (error) {
      if (error instanceof Error && error.message === "GIORNATA_MENSA_CHIUSA") {
        res.status(409).json({ error: "La giornata Mensa è chiusa" });
        return;
      }
      if (isUniqueViolation(error)) {
        const key =
          typeof req.body?.idempotencyKey === "string"
            ? req.body.idempotencyKey
            : "";
        const [existing] = await db
          .select()
          .from(mensaPastiTable)
          .where(eq(mensaPastiTable.idempotencyKey, key));
        if (existing) {
          res.json({ ...existing, idempotentReplay: true });
          return;
        }
        res.status(409).json({ error: "Pasto già registrato" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/pasti",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      const data = dateOnly(req.query.data, "La data");
      const tipo =
        req.query.tipoServizio == null
          ? null
          : canonicalTipoServizio(req.query.tipoServizio);
      if (mensaId != null)
        conditions.push(eq(mensaPastiTable.mensaId, mensaId));
      if (data) conditions.push(eq(mensaPastiTable.dataServizio, data));
      if (tipo) conditions.push(eq(mensaPastiTable.tipoServizio, tipo));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
      const paging = pagination(req.query);
      const where = conditions.length ? and(...conditions) : undefined;
      const [totalRow] = paging.requested
        ? await db
            .select({ total: count() })
            .from(mensaPastiTable)
            .innerJoin(menseTable, eq(mensaPastiTable.mensaId, menseTable.id))
            .where(where)
        : [{ total: 0 }];
      const rows = await db
        .select({
          pasto: mensaPastiTable,
          mensaNome: menseTable.nome,
          beneficiarioNome: beneficiariTable.nome,
          beneficiarioCognome: beneficiariTable.cognome,
          beneficiarioCodice: beneficiariTable.codice,
          operatoreUsername: utentiTable.username,
        })
        .from(mensaPastiTable)
        .innerJoin(menseTable, eq(mensaPastiTable.mensaId, menseTable.id))
        .innerJoin(
          beneficiariTable,
          eq(mensaPastiTable.beneficiarioId, beneficiariTable.id),
        )
        .innerJoin(utentiTable, eq(mensaPastiTable.operatoreId, utentiTable.id))
        .where(where)
        .orderBy(desc(mensaPastiTable.dataOra))
        .limit(paging.requested ? paging.pageSize : 500)
        .offset(paging.requested ? paging.offset : 0);
      const items = rows.map((row) => ({
        id: row.pasto.id,
        mensaId: row.pasto.mensaId,
        mensaNome: row.mensaNome,
        beneficiarioId: row.pasto.beneficiarioId,
        beneficiarioNome: `${row.beneficiarioNome} ${row.beneficiarioCognome}`,
        beneficiarioCodice: row.beneficiarioCodice,
        accessoMensaId: row.pasto.accessoMensaId,
        dataOra: row.pasto.dataOra.toISOString(),
        dataServizio: row.pasto.dataServizio,
        tipoServizio: row.pasto.tipoServizio,
        eccezione: row.pasto.eccezioneId != null,
        override: row.pasto.override,
        operatore: row.operatoreUsername,
      }));
      res.json(
        paging.requested
          ? {
              items,
              page: paging.page,
              pageSize: paging.pageSize,
              total: totalRow?.total ?? 0,
            }
          : items,
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/eccezioni",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const ownCity = callerCittaId(req);
      if (ownCity != null)
        conditions.push(eq(mensaEccezioniTable.cittaId, ownCity));
      const paging = pagination(req.query);
      const where = conditions.length ? and(...conditions) : undefined;
      const [totalRow] = paging.requested
        ? await db
            .select({ total: count() })
            .from(mensaEccezioniTable)
            .where(where)
        : [{ total: 0 }];
      const rows = await db
        .select({
          eccezione: mensaEccezioniTable,
          nome: beneficiariTable.nome,
          cognome: beneficiariTable.cognome,
        })
        .from(mensaEccezioniTable)
        .innerJoin(
          beneficiariTable,
          eq(mensaEccezioniTable.beneficiarioId, beneficiariTable.id),
        )
        .where(where)
        .orderBy(desc(mensaEccezioniTable.dataOra))
        .limit(paging.requested ? paging.pageSize : 500)
        .offset(paging.requested ? paging.offset : 0);
      const items = rows.map(({ eccezione, nome, cognome }) => ({
        ...eccezione,
        beneficiarioNome: `${nome} ${cognome}`,
        dataOra: eccezione.dataOra.toISOString(),
        createdAt: eccezione.createdAt.toISOString(),
      }));
      res.json(
        paging.requested
          ? {
              items,
              page: paging.page,
              pageSize: paging.pageSize,
              total: totalRow?.total ?? 0,
            }
          : items,
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/logistica/magazzini",
  requireMensaPermissionOrLegacy("mensa.transfers.request"),
  async (req, res) => {
    const ids = await visibleMagazzinoIds(
      callerCentroId(req),
      callerCittaId(req),
    );
    const conditions: SQL[] = [eq(magazziniTable.stato, "attivo")];
    const ownCity = callerCittaId(req);
    if (ownCity != null) conditions.push(eq(magazziniTable.cittaId, ownCity));
    if (ids != null)
      conditions.push(
        ids.length ? inArray(magazziniTable.id, ids) : sql`false`,
      );
    const rows = await db
      .select({
        id: magazziniTable.id,
        codice: magazziniTable.codice,
        nome: magazziniTable.nome,
        cittaId: magazziniTable.cittaId,
        tipoMagazzino: magazziniTable.tipoMagazzino,
      })
      .from(magazziniTable)
      .where(and(...conditions))
      .orderBy(asc(magazziniTable.nome));
    res.json(rows);
  },
);

router.get(
  "/mensa/logistica/giacenze",
  requireMensaPermissionOrLegacy("mensa.transfers.request"),
  async (req, res) => {
    try {
      const magazzinoId = positiveInt(req.query.magazzinoId, "magazzinoId");
      await requireMensaLogisticsWarehouse(magazzinoId, req);
      const today = dataServizioMensa(new Date());
      const rows = await db
        .select({
          prodottoId: prodottiTable.id,
          codice: prodottiTable.codice,
          nome: prodottiTable.nome,
          unitaMisura: prodottiTable.unitaMisura,
          giacenzaFisica: sql<string>`sum(${lottiTable.quantitaResidua})`,
          giacenzaDistribuibile: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}) filter (where ${lottiTable.dataScadenza} is null or ${lottiTable.dataScadenza} >= ${today}), 0)`,
        })
        .from(lottiTable)
        .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
        .where(
          and(
            eq(lottiTable.magazzinoId, magazzinoId),
            gt(lottiTable.quantitaResidua, "0"),
          ),
        )
        .groupBy(prodottiTable.id)
        .orderBy(asc(prodottiTable.nome));
      const committed = await calcolaImpegnatoAttivoPerGiacenze(
        rows.map((row) => ({ prodottoId: row.prodottoId, magazzinoId })),
      );
      res.json(
        rows.map((row) => {
          const giacenzaFisica = parseDbNumber(row.giacenzaFisica);
          const giacenzaDistribuibile = parseDbNumber(
            row.giacenzaDistribuibile,
          );
          const impegnato =
            committed.get(
              disponibilitaMagazzinoKey(row.prodottoId, magazzinoId),
            ) ?? 0;
          return {
            ...row,
            quantita: Math.max(0, giacenzaDistribuibile - impegnato),
            giacenzaFisica,
            giacenzaDistribuibile,
            impegnato,
            disponibileReale: Math.max(0, giacenzaDistribuibile - impegnato),
          };
        }),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/trasferimenti",
  requireMensaPermissionOrLegacy("mensa.transfers.request"),
  async (req, res) => {
    try {
      const mensaId = positiveInt(req.body?.mensaId, "mensaId");
      const origineId = positiveInt(
        req.body?.magazzinoOrigineId,
        "magazzinoOrigineId",
      );
      const idempotencyKey = text(
        req.body?.idempotencyKey,
        "La chiave di idempotenza",
        80,
      );
      const mensa = await requireMensa(mensaId, req, true);
      if (origineId === mensa.mensa.magazzinoId)
        throw new MensaError(
          400,
          "Origine e destinazione devono essere diverse",
        );
      await requireMensaLogisticsWarehouse(origineId, req);
      const dataRichiesta = dateOnly(
        req.body?.dataRichiesta,
        "La data richiesta",
        true,
      )!;
      const righe: Array<Record<string, unknown>> = Array.isArray(
        req.body?.righe,
      )
        ? req.body.righe
        : [];
      if (!righe.length)
        throw new MensaError(400, "Indicare almeno un prodotto");
      const normalized = righe.map((row: Record<string, unknown>) => ({
        prodottoId: positiveInt(row.prodottoId, "prodottoId"),
        quantita: Number(row.quantita),
        unitaMisura: text(row.unitaMisura, "L'unità di misura", 20),
        note: optionalText(row.note, "Le note", 1000),
      }));
      if (
        normalized.some(
          (row) => !Number.isFinite(row.quantita) || row.quantita <= 0,
        )
      )
        throw new MensaError(400, "Le quantità devono essere maggiori di zero");
      const [replay] = await db
        .select({ id: trasferimentiTable.id })
        .from(trasferimentiTable)
        .where(eq(trasferimentiTable.idempotencyKey, idempotencyKey));
      if (replay) {
        res.json({ id: replay.id, idempotentReplay: true });
        return;
      }
      const created = await createTransferRequest({
        magazzinoOrigineId: origineId,
        magazzinoDestinoId: mensa.mensa.magazzinoId,
        mensaId,
        idempotencyKey,
        dataRichiesta,
        trasportatoreNome: optionalText(
          req.body?.trasportatoreNome,
          "Il trasportatore",
          120,
        ),
        note: optionalText(req.body?.note, "Le note", 2000),
        operatoreId: req.user!.id,
        righe: normalized,
        afterCreate: async (tx, transfer) => {
          await tx.insert(auditConfigurazioniTable).values(
            auditValues(
              req,
              `mensa-trasferimento:${transfer.id}`,
              "richiesta",
              null,
              {
                mensaId,
                origineId,
                destinazioneId: mensa.mensa.magazzinoId,
                righe: normalized.length,
              },
            ),
          );
        },
      });
      res
        .status(201)
        .json({ id: created.id, codice: created.codice, stato: created.stato });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const key =
          typeof req.body?.idempotencyKey === "string"
            ? req.body.idempotencyKey
            : "";
        const [existing] = await db
          .select({ id: trasferimentiTable.id })
          .from(trasferimentiTable)
          .where(eq(trasferimentiTable.idempotencyKey, key));
        if (existing) {
          res.json({ id: existing.id, idempotentReplay: true });
          return;
        }
        res.status(409).json({ error: "Trasferimento duplicato" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/trasferimenti",
  requireMensaPermissionOrLegacy("mensa.transfers.request"),
  async (req, res) => {
    const conditions: SQL[] = [];
    const ownCity = callerCittaId(req);
    if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
    const paging = pagination(req.query);
    const where = conditions.length ? and(...conditions) : undefined;
    const [totalRow] = paging.requested
      ? await db
          .select({ total: count() })
          .from(trasferimentiTable)
          .innerJoin(menseTable, eq(trasferimentiTable.mensaId, menseTable.id))
          .where(where)
      : [{ total: 0 }];
    const rows = await db
      .select({
        trasferimento: trasferimentiTable,
        mensaNome: menseTable.nome,
        origineNome: magazziniTable.nome,
      })
      .from(trasferimentiTable)
      .innerJoin(menseTable, eq(trasferimentiTable.mensaId, menseTable.id))
      .innerJoin(
        magazziniTable,
        eq(trasferimentiTable.magazzinoOrigineId, magazziniTable.id),
      )
      .where(where)
      .orderBy(desc(trasferimentiTable.dataCreazione))
      .limit(paging.requested ? paging.pageSize : 200)
      .offset(paging.requested ? paging.offset : 0);
    const items = rows.map(({ trasferimento, mensaNome, origineNome }) => ({
      ...trasferimento,
      mensaNome,
      magazzinoOrigineNome: origineNome,
      dataCreazione: trasferimento.dataCreazione.toISOString(),
    }));
    res.json(
      paging.requested
        ? {
            items,
            page: paging.page,
            pageSize: paging.pageSize,
            total: totalRow?.total ?? 0,
          }
        : items,
    );
  },
);

router.get(
  "/mensa/consumi",
  requirePermission("mensa.consumption.manage"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      const data = dateOnly(req.query.data, "La data servizio");
      if (mensaId != null)
        conditions.push(eq(mensaConsumiTable.mensaId, mensaId));
      if (data != null)
        conditions.push(eq(mensaConsumiTable.dataServizio, data));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
      const paging = pagination(req.query);
      const where = conditions.length ? and(...conditions) : undefined;
      const [totalRow] = await db
        .select({ total: count() })
        .from(mensaConsumiTable)
        .innerJoin(menseTable, eq(mensaConsumiTable.mensaId, menseTable.id))
        .where(where);
      const rows = await db
        .select({
          consumo: mensaConsumiTable,
          mensaNome: menseTable.nome,
          prodottoNome: prodottiTable.nome,
          stornatoAt: mensaConsumiStorniTable.createdAt,
          motivoStorno: mensaConsumiStorniTable.motivo,
        })
        .from(mensaConsumiTable)
        .innerJoin(menseTable, eq(mensaConsumiTable.mensaId, menseTable.id))
        .innerJoin(
          prodottiTable,
          eq(mensaConsumiTable.prodottoId, prodottiTable.id),
        )
        .leftJoin(
          mensaConsumiStorniTable,
          eq(mensaConsumiStorniTable.consumoId, mensaConsumiTable.id),
        )
        .where(where)
        .orderBy(desc(mensaConsumiTable.createdAt), desc(mensaConsumiTable.id))
        .limit(paging.requested ? paging.pageSize : 200)
        .offset(paging.requested ? paging.offset : 0);
      const items = rows.map((row) => ({
        ...row.consumo,
        quantita: Number(row.consumo.quantita),
        mensaNome: row.mensaNome,
        prodottoNome: row.prodottoNome,
        stornato: row.stornatoAt != null,
        stornatoAt: row.stornatoAt?.toISOString() ?? null,
        motivoStorno: row.motivoStorno ?? null,
        createdAt: row.consumo.createdAt.toISOString(),
      }));
      res.json(
        paging.requested
          ? {
              items,
              page: paging.page,
              pageSize: paging.pageSize,
              total: totalRow?.total ?? 0,
            }
          : items,
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/consumi",
  requirePermission("mensa.consumption.manage"),
  async (req, res) => {
    const idempotencyKey = text(
      req.body?.idempotencyKey,
      "La chiave di idempotenza",
      80,
    );
    try {
      const [replay] = await db
        .select()
        .from(mensaConsumiTable)
        .where(eq(mensaConsumiTable.idempotencyKey, idempotencyKey));
      if (replay) {
        res.json({
          ...replay,
          quantita: Number(replay.quantita),
          idempotentReplay: true,
        });
        return;
      }
      const mensaId = positiveInt(req.body?.mensaId, "mensaId");
      const prodottoId = positiveInt(req.body?.prodottoId, "prodottoId");
      const dataServizio = dateOnly(
        req.body?.dataServizio,
        "La data servizio",
        true,
      )!;
      const tipoServizio = canonicalTipoServizio(req.body?.tipoServizio);
      const quantita = Number(req.body?.quantita);
      if (!Number.isFinite(quantita) || quantita <= 0) {
        throw new MensaError(400, "La quantità deve essere maggiore di zero");
      }
      const causale = req.body?.causale;
      if (causale !== "consumo" && causale !== "scarto") {
        throw new MensaError(400, "La causale deve essere consumo o scarto");
      }
      const mensa = await requireMensa(mensaId, req, true);
      const [prodotto] = await db
        .select({
          id: prodottiTable.id,
          unitaMisura: prodottiTable.unitaMisura,
          attivo: prodottiTable.attivo,
        })
        .from(prodottiTable)
        .where(eq(prodottiTable.id, prodottoId));
      if (!prodotto || !prodotto.attivo) {
        throw new MensaError(400, "Il prodotto non è disponibile");
      }
      const note = optionalText(req.body?.note, "Le note", 2000);
      const codice = consumoCodice(idempotencyKey);
      const created = await db.transaction(async (tx) => {
        const giornata = await getOrCreateGiornataMensa(tx, {
          mensaId,
          dataServizio,
          tipoServizio,
          operatoreId: req.user!.id,
        });
        const scaricoId = await creaScaricoInventariale(tx, {
          codice,
          magazzinoId: mensa.mensa.magazzinoId,
          centroAscoltoId: mensa.magazzino?.centroAscoltoId ?? null,
          dataScarico: dataServizio,
          causale: "altro",
          causaleAltro:
            causale === "consumo" ? "Consumo Mensa" : "Scarto Mensa",
          note,
          operatoreId: req.user!.id,
          documentoRiferimento: codice,
          righe: [
            { prodottoId, quantita, unitaMisura: prodotto.unitaMisura, note },
          ],
        });
        const [row] = await tx
          .insert(mensaConsumiTable)
          .values({
            giornataServizioId: giornata.id,
            mensaId,
            scaricoId,
            dataServizio,
            tipoServizio,
            prodottoId,
            quantita: quantita.toFixed(2),
            unitaMisura: prodotto.unitaMisura,
            causale,
            note,
            operatoreId: req.user!.id,
            idempotencyKey,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(req, `mensa-consumo:${row.id}`, "registrazione", null, {
            mensaId,
            prodottoId,
            quantita,
            causale,
            scaricoId,
            giornataServizioId: giornata.id,
          }),
        );
        return row;
      });
      res.status(201).json({ ...created, quantita: Number(created.quantita) });
    } catch (error) {
      if (error instanceof InventoryError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message === "GIORNATA_MENSA_CHIUSA") {
        res.status(409).json({ error: "La giornata Mensa è chiusa" });
        return;
      }
      if (isUniqueViolation(error)) {
        const [replay] = await db
          .select()
          .from(mensaConsumiTable)
          .where(eq(mensaConsumiTable.idempotencyKey, idempotencyKey));
        if (replay) {
          res.json({
            ...replay,
            quantita: Number(replay.quantita),
            idempotentReplay: true,
          });
          return;
        }
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/consumi/:id/storno",
  requirePermission("mensa.consumption.manage"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const motivo = text(req.body?.motivo, "Il motivo dello storno", 2000);
      const [current] = await db
        .select({ consumo: mensaConsumiTable, cittaId: menseTable.cittaId })
        .from(mensaConsumiTable)
        .innerJoin(menseTable, eq(mensaConsumiTable.mensaId, menseTable.id))
        .where(eq(mensaConsumiTable.id, id));
      if (!current) throw new MensaError(404, "Consumo non trovato");
      if (!canAccessCitta(current.cittaId, callerCittaId(req))) {
        throw new MensaError(403, "Consumo non accessibile per la tua Area");
      }
      const code = consumoCodice(current.consumo.idempotencyKey);
      await db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: mensaConsumiStorniTable.id })
          .from(mensaConsumiStorniTable)
          .where(eq(mensaConsumiStorniTable.consumoId, id))
          .for("update");
        if (existing)
          throw new MensaError(409, "Il consumo è già stato stornato");
        const giornata = await getOrCreateGiornataMensa(tx, {
          mensaId: current.consumo.mensaId,
          dataServizio: current.consumo.dataServizio,
          tipoServizio: canonicalTipoServizio(current.consumo.tipoServizio),
          operatoreId: req.user!.id,
        });
        await stornaScaricoInventariale(tx, {
          documentoRiferimento: code,
          dataMovimento: current.consumo.dataServizio,
          operatoreId: req.user!.id,
          tipoDettaglio: "errore_registrazione",
          note: `Storno consumo Mensa: ${motivo}`,
        });
        const [storno] = await tx
          .insert(mensaConsumiStorniTable)
          .values({
            consumoId: id,
            motivo,
            operatoreId: req.user!.id,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(req, `mensa-consumo:${id}`, "storno", null, {
            stornoId: storno.id,
            giornataServizioId: giornata.id,
            motivo,
          }),
        );
      });
      res.json({ id, stornato: true });
    } catch (error) {
      if (error instanceof InventoryError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/giornate",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      const data = dateOnly(req.query.data, "La data servizio");
      if (mensaId != null)
        conditions.push(eq(mensaGiornateServizioTable.mensaId, mensaId));
      if (data != null)
        conditions.push(eq(mensaGiornateServizioTable.dataServizio, data));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
      const rows = await db
        .select({
          giornata: mensaGiornateServizioTable,
          mensaNome: menseTable.nome,
        })
        .from(mensaGiornateServizioTable)
        .innerJoin(
          menseTable,
          eq(mensaGiornateServizioTable.mensaId, menseTable.id),
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(
          desc(mensaGiornateServizioTable.dataServizio),
          asc(mensaGiornateServizioTable.tipoServizio),
        );
      res.json(
        rows.map(({ giornata, mensaNome }) => ({ ...giornata, mensaNome })),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/giornate/:id/chiudi",
  requirePermission("mensa.service.close"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const note = optionalText(req.body?.note, "Le note di chiusura", 4000);
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            giornata: mensaGiornateServizioTable,
            cittaId: menseTable.cittaId,
          })
          .from(mensaGiornateServizioTable)
          .innerJoin(
            menseTable,
            eq(mensaGiornateServizioTable.mensaId, menseTable.id),
          )
          .where(eq(mensaGiornateServizioTable.id, id))
          .for("update");
        if (!current) throw new MensaError(404, "Giornata Mensa non trovata");
        if (!canAccessCitta(current.cittaId, callerCittaId(req)))
          throw new MensaError(403, "Giornata non accessibile");
        if (current.giornata.stato !== "aperta")
          throw new MensaError(409, "La giornata è già chiusa");
        const meals = await tx
          .select({
            beneficiarioId: mensaPastiTable.beneficiarioId,
            override: mensaPastiTable.override,
            eccezioneId: mensaPastiTable.eccezioneId,
            sesso: mensaPastiTable.sessoSnapshot,
            fasciaEta: mensaPastiTable.fasciaEtaSnapshot,
            provvisoria: mensaPastiTable.anagraficaProvvisoriaSnapshot,
            temporaneo: mensaPastiTable.temporaneoSnapshot,
          })
          .from(mensaPastiTable)
          .where(eq(mensaPastiTable.giornataServizioId, id));
        const consumi = await tx
          .select({
            causale: mensaConsumiTable.causale,
            quantita: mensaConsumiTable.quantita,
          })
          .from(mensaConsumiTable)
          .leftJoin(
            mensaConsumiStorniTable,
            eq(mensaConsumiStorniTable.consumoId, mensaConsumiTable.id),
          )
          .where(
            and(
              eq(mensaConsumiTable.giornataServizioId, id),
              isNull(mensaConsumiStorniTable.id),
            ),
          );
        const range = intervalloGiornoEuropeRome(current.giornata.dataServizio);
        const [accessi] = await tx
          .select({
            ordinari: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'consentito' and ${mensaAccessiTable.autorizzazioneTemporaneaId} is null)::int`,
            temporanei: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'consentito' and ${mensaAccessiTable.autorizzazioneTemporaneaId} is not null)::int`,
            eccezioni: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'consentito_eccezione')::int`,
            negati: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'negato')::int`,
          })
          .from(mensaAccessiTable)
          .where(
            and(
              eq(mensaAccessiTable.mensaId, current.giornata.mensaId),
              eq(mensaAccessiTable.tipoServizio, current.giornata.tipoServizio),
              gte(mensaAccessiTable.dataOra, range.start),
              lt(mensaAccessiTable.dataOra, range.end),
            ),
          );
        const countBy = (values: Array<string | null>) =>
          values.reduce<Record<string, number>>((acc, value) => {
            const key = value ?? "ND";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {});
        const snapshot = {
          pasti: meals.length,
          beneficiariDistinti: new Set(meals.map((meal) => meal.beneficiarioId))
            .size,
          pastiOrdinari: meals.filter(
            (meal) => !meal.override && meal.eccezioneId == null,
          ).length,
          pastiOverride: meals.filter((meal) => meal.override).length,
          pastiTemporanei: meals.filter((meal) => meal.temporaneo === true)
            .length,
          pastiEccezione: meals.filter((meal) => meal.eccezioneId != null)
            .length,
          accessiOrdinari: accessi?.ordinari ?? 0,
          accessiTemporanei: accessi?.temporanei ?? 0,
          accessiEccezione: accessi?.eccezioni ?? 0,
          accessiNegati: accessi?.negati ?? 0,
          perSesso: countBy(meals.map((meal) => meal.sesso)),
          perFasciaEta: countBy(meals.map((meal) => meal.fasciaEta)),
          consumo: consumi
            .filter((row) => row.causale === "consumo")
            .reduce((sum, row) => sum + Number(row.quantita), 0),
          scarto: consumi
            .filter((row) => row.causale === "scarto")
            .reduce((sum, row) => sum + Number(row.quantita), 0),
        };
        const [updated] = await tx
          .update(mensaGiornateServizioTable)
          .set({
            stato: "chiusa",
            chiusaDa: req.user!.id,
            chiusaAt: new Date(),
            noteChiusura: note,
            snapshot,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mensaGiornateServizioTable.id, id),
              eq(mensaGiornateServizioTable.stato, "aperta"),
            ),
          )
          .returning();
        if (!updated)
          throw new MensaError(
            409,
            "La giornata è stata chiusa da un altro operatore",
          );
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa-giornata:${id}`,
              "chiusura",
              null,
              snapshot,
              note,
            ),
          );
        return updated;
      });
      res.json(result);
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/giornate/:id/riapri",
  requirePermission("mensa.service.reopen"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const motivo = text(req.body?.motivo, "Il motivo della riapertura", 2000);
      const result = await db.transaction(async (tx) => {
        const [current] = await tx
          .select({
            giornata: mensaGiornateServizioTable,
            cittaId: menseTable.cittaId,
          })
          .from(mensaGiornateServizioTable)
          .innerJoin(
            menseTable,
            eq(mensaGiornateServizioTable.mensaId, menseTable.id),
          )
          .where(eq(mensaGiornateServizioTable.id, id))
          .for("update");
        if (!current) throw new MensaError(404, "Giornata Mensa non trovata");
        if (!canAccessCitta(current.cittaId, callerCittaId(req)))
          throw new MensaError(403, "Giornata non accessibile");
        if (current.giornata.stato !== "chiusa")
          throw new MensaError(
            409,
            "Solo una giornata chiusa può essere riaperta",
          );
        const [updated] = await tx
          .update(mensaGiornateServizioTable)
          .set({
            stato: "aperta",
            riapertaDa: req.user!.id,
            riapertaAt: new Date(),
            motivoRiapertura: motivo,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mensaGiornateServizioTable.id, id),
              eq(mensaGiornateServizioTable.stato, "chiusa"),
            ),
          )
          .returning();
        if (!updated)
          throw new MensaError(
            409,
            "La giornata è stata modificata da un altro operatore",
          );
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa-giornata:${id}`,
              "riapertura",
              current.giornata as unknown as Record<string, unknown>,
              updated as unknown as Record<string, unknown>,
              motivo,
            ),
          );
        return updated;
      });
      res.json(result);
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/report",
  requirePermission("mensa.reports.view"),
  async (req, res) => {
    try {
      const dal = dateOnly(req.query.dal, "La data iniziale", true)!;
      const al = dateOnly(req.query.al, "La data finale", true)!;
      if (al < dal) throw new MensaError(400, "Il periodo non è valido");
      const conditions: SQL[] = [
        gte(mensaPastiTable.dataServizio, dal),
        lte(mensaPastiTable.dataServizio, al),
      ];
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      const tipo =
        req.query.tipoServizio == null
          ? null
          : canonicalTipoServizio(req.query.tipoServizio);
      if (mensaId != null)
        conditions.push(eq(mensaPastiTable.mensaId, mensaId));
      if (tipo) conditions.push(eq(mensaPastiTable.tipoServizio, tipo));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
      const distribution = await db
        .select({
          mensaId: menseTable.id,
          mensaNome: menseTable.nome,
          totalePasti: sql<number>`count(${mensaPastiTable.id})::int`,
          beneficiariDistinti: sql<number>`count(distinct ${mensaPastiTable.beneficiarioId})::int`,
          pastiEccezione: sql<number>`count(*) filter (where ${mensaPastiTable.eccezioneId} is not null)::int`,
        })
        .from(mensaPastiTable)
        .innerJoin(menseTable, eq(mensaPastiTable.mensaId, menseTable.id))
        .where(and(...conditions))
        .groupBy(menseTable.id)
        .orderBy(asc(menseTable.nome));
      const [mealTotals] = await db
        .select({
          beneficiariDistinti: sql<number>`count(distinct ${mensaPastiTable.beneficiarioId})::int`,
        })
        .from(mensaPastiTable)
        .innerJoin(menseTable, eq(mensaPastiTable.mensaId, menseTable.id))
        .where(and(...conditions));
      const dimensions = await db
        .select({
          beneficiarioId: mensaPastiTable.beneficiarioId,
          tipoServizio: mensaPastiTable.tipoServizio,
          sesso: mensaPastiTable.sessoSnapshot,
          fasciaEta: mensaPastiTable.fasciaEtaSnapshot,
          provvisoria: mensaPastiTable.anagraficaProvvisoriaSnapshot,
          temporaneo: mensaPastiTable.temporaneoSnapshot,
        })
        .from(mensaPastiTable)
        .innerJoin(menseTable, eq(mensaPastiTable.mensaId, menseTable.id))
        .where(and(...conditions));
      const accessConditions: SQL[] = [
        gte(mensaAccessiTable.dataOra, intervalloGiornoEuropeRome(dal).start),
        lt(mensaAccessiTable.dataOra, intervalloGiornoEuropeRome(al).end),
      ];
      if (mensaId != null)
        accessConditions.push(eq(mensaAccessiTable.mensaId, mensaId));
      if (tipo != null)
        accessConditions.push(eq(mensaAccessiTable.tipoServizio, tipo));
      if (ownCity != null)
        accessConditions.push(eq(menseTable.cittaId, ownCity));
      const [accesses] = await db
        .select({
          ordinari: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'consentito')::int`,
          eccezioni: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'consentito_eccezione')::int`,
          negati: sql<number>`count(*) filter (where ${mensaAccessiTable.esito} = 'negato')::int`,
        })
        .from(mensaAccessiTable)
        .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
        .where(and(...accessConditions));
      const days =
        Math.floor(
          (Date.parse(`${al}T12:00:00Z`) - Date.parse(`${dal}T12:00:00Z`)) /
            86400000,
        ) + 1;
      const total = distribution.reduce((sum, row) => sum + row.totalePasti, 0);
      const distributionFor = (values: Array<string | null>) =>
        Object.entries(
          values.reduce<Record<string, number>>((acc, value) => {
            const key = value ?? "ND";
            acc[key] = (acc[key] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([chiave, totale]) => ({ chiave, totale }));
      const distinctDistributionFor = (
        rows: Array<{ chiave: string | null; beneficiarioId: number }>,
      ) =>
        Array.from(
          rows.reduce<Map<string, Set<number>>>((acc, row) => {
            const key = row.chiave ?? "ND";
            const values = acc.get(key) ?? new Set<number>();
            values.add(row.beneficiarioId);
            acc.set(key, values);
            return acc;
          }, new Map()),
        ).map(([chiave, values]) => ({ chiave, totale: values.size }));
      const consumptionConditions: SQL[] = [
        gte(mensaConsumiTable.dataServizio, dal),
        lte(mensaConsumiTable.dataServizio, al),
        isNull(mensaConsumiStorniTable.id),
      ];
      if (mensaId != null)
        consumptionConditions.push(eq(mensaConsumiTable.mensaId, mensaId));
      if (tipo != null)
        consumptionConditions.push(eq(mensaConsumiTable.tipoServizio, tipo));
      if (ownCity != null)
        consumptionConditions.push(eq(menseTable.cittaId, ownCity));
      const consumption = await db
        .select({
          causale: mensaConsumiTable.causale,
          quantita: mensaConsumiTable.quantita,
        })
        .from(mensaConsumiTable)
        .innerJoin(menseTable, eq(mensaConsumiTable.mensaId, menseTable.id))
        .leftJoin(
          mensaConsumiStorniTable,
          eq(mensaConsumiStorniTable.consumoId, mensaConsumiTable.id),
        )
        .where(and(...consumptionConditions));
      res.json({
        dal,
        al,
        totalePasti: total,
        beneficiariDistinti: mealTotals?.beneficiariDistinti ?? 0,
        accessiOrdinari: accesses?.ordinari ?? 0,
        accessiEccezione: accesses?.eccezioni ?? 0,
        accessiNegati: accesses?.negati ?? 0,
        pastiAnagraficaProvvisoria: dimensions.filter(
          (row) => row.provvisoria === true,
        ).length,
        pastiTemporanei: dimensions.filter((row) => row.temporaneo === true)
          .length,
        pastiOrdinari: dimensions.filter((row) => row.temporaneo === false)
          .length,
        pastiTemporaneitaNonDeterminata: dimensions.filter(
          (row) => row.temporaneo == null,
        ).length,
        distribuzioneSesso: distributionFor(dimensions.map((row) => row.sesso)),
        distribuzioneFasciaEta: distributionFor(
          dimensions.map((row) => row.fasciaEta),
        ),
        distribuzioneTipoServizio: distributionFor(
          dimensions.map((row) => row.tipoServizio),
        ),
        beneficiariDistintiPerSesso: distinctDistributionFor(
          dimensions.map((row) => ({
            chiave: row.sesso,
            beneficiarioId: row.beneficiarioId,
          })),
        ),
        beneficiariDistintiPerFasciaEta: distinctDistributionFor(
          dimensions.map((row) => ({
            chiave: row.fasciaEta,
            beneficiarioId: row.beneficiarioId,
          })),
        ),
        consumoTotale: consumption
          .filter((row) => row.causale === "consumo")
          .reduce((sum, row) => sum + Number(row.quantita), 0),
        scartoTotale: consumption
          .filter((row) => row.causale === "scarto")
          .reduce((sum, row) => sum + Number(row.quantita), 0),
        mediaPastiGiorno: Number((total / days).toFixed(2)),
        distribuzione: distribution,
      });
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.patch(
  "/mensa/mense/:id",
  requirePermission("mensa.manage"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const expected = expectedVersion(req.body?.versione);
      const current = await requireMensa(id, req);
      const updates: Partial<typeof menseTable.$inferInsert> = {
        updatedAt: new Date(),
      };
      if ("nome" in req.body)
        updates.nome = text(req.body.nome, "Il nome", 160);
      if ("indirizzo" in req.body)
        updates.indirizzo = optionalText(
          req.body.indirizzo,
          "L'indirizzo",
          255,
        );
      if ("note" in req.body)
        updates.note = optionalText(req.body.note, "Le note", 4000);
      if ("attiva" in req.body) {
        if (typeof req.body.attiva !== "boolean")
          throw new MensaError(400, "Stato attivo non valido");
        updates.attiva = req.body.attiva;
      }
      const updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(menseTable)
          .set(updates)
          .where(
            and(
              eq(menseTable.id, id),
              sql`date_trunc('milliseconds', ${menseTable.updatedAt}) = ${expected}`,
            ),
          )
          .returning();
        if (!row)
          throw new MensaError(
            409,
            "La Mensa è stata modificata; ricarica i dati",
          );
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa:${id}`,
              updates.attiva === false ? "disattivazione" : "modifica",
              current.mensa as unknown as Record<string, unknown>,
              row as unknown as Record<string, unknown>,
            ),
          );
        return row;
      });
      const loaded = await loadMensa(id);
      res.json(
        formatMensa(
          updated,
          loaded?.cittaNome ?? null,
          loaded?.magazzino ?? null,
          loaded?.centroAscoltoNome ?? null,
        ),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/beneficiari/ricerca",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const search = text(req.query.search, "La ricerca", 120);
      if (search.length < 2)
        throw new MensaError(400, "Inserire almeno 2 caratteri");
      const conditions: SQL[] = [];
      const ownCity = callerCittaId(req);
      if (ownCity != null)
        conditions.push(eq(beneficiariTable.cittaId, ownCity));
      const s = `%${search}%`;
      conditions.push(
        or(
          ilike(beneficiariTable.nome, s),
          ilike(beneficiariTable.cognome, s),
          ilike(beneficiariTable.codice, s),
          ilike(
            sql<string>`trim(${beneficiariTable.nome} || ' ' || ${beneficiariTable.cognome})`,
            s,
          ),
          ilike(
            sql<string>`trim(${beneficiariTable.cognome} || ' ' || ${beneficiariTable.nome})`,
            s,
          ),
        )!,
      );
      const rows = await db
        .select({
          id: beneficiariTable.id,
          nome: beneficiariTable.nome,
          cognome: beneficiariTable.cognome,
          codice: beneficiariTable.codice,
          attivo: beneficiariTable.attivo,
          cittaId: beneficiariTable.cittaId,
        })
        .from(beneficiariTable)
        .where(and(...conditions))
        .orderBy(desc(beneficiariTable.id))
        .limit(20);
      res.json(rows);
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/abilitazioni/riepilogo-beneficiari",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const beneficiarioIds = beneficiarioIdsQuery(req.query.beneficiarioIds);
      res.json(
        await loadRiepilogoAbilitazioniBeneficiari(req, beneficiarioIds),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/abilitazioni",
  requirePermission("mensa.view"),
  async (req, res) => {
    try {
      const conditions: SQL[] = [];
      const beneficiarioId = optionalPositiveInt(
        req.query.beneficiarioId,
        "beneficiarioId",
      );
      const mensaId = optionalPositiveInt(req.query.mensaId, "mensaId");
      if (beneficiarioId != null)
        conditions.push(
          eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId),
        );
      if (mensaId != null)
        conditions.push(eq(mensaAbilitazioniTable.mensaId, mensaId));
      const cityScope = cittaScopeFilter(
        menseTable.cittaId,
        callerCittaId(req),
      );
      if (cityScope) conditions.push(cityScope);
      const rows = await db
        .select({
          abilitazione: mensaAbilitazioniTable,
          mensaNome: menseTable.nome,
          beneficiarioNome: beneficiariTable.nome,
          beneficiarioCognome: beneficiariTable.cognome,
          beneficiarioCodice: beneficiariTable.codice,
        })
        .from(mensaAbilitazioniTable)
        .innerJoin(
          menseTable,
          eq(mensaAbilitazioniTable.mensaId, menseTable.id),
        )
        .innerJoin(
          beneficiariTable,
          eq(mensaAbilitazioniTable.beneficiarioId, beneficiariTable.id),
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(
          desc(mensaAbilitazioniTable.createdAt),
          desc(mensaAbilitazioniTable.id),
        );
      res.json(rows.map(formatAbilitazione));
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/abilitazioni",
  requirePermission("mensa.eligibility.manage"),
  async (req, res) => {
    try {
      const beneficiarioId = positiveInt(
        req.body?.beneficiarioId,
        "beneficiarioId",
      );
      const mensaId = positiveInt(req.body?.mensaId, "mensaId");
      const dataInizio = dateOnly(
        req.body?.dataInizio,
        "La data di inizio",
        true,
      )!;
      const dataFine = dateOnly(req.body?.dataFine, "La data di fine");
      const mensaPrincipale = req.body?.mensaPrincipale !== false;
      if (dataFine && dataFine < dataInizio)
        throw new MensaError(400, "La data di fine precede la data di inizio");
      const mensa = await requireMensa(mensaId, req, true);
      const [beneficiario] = await db
        .select()
        .from(beneficiariTable)
        .where(eq(beneficiariTable.id, beneficiarioId));
      if (!beneficiario) throw new MensaError(404, "Beneficiario non trovato");
      if (!beneficiario.attivo)
        throw new MensaError(409, "Il beneficiario non è attivo");
      if (beneficiario.cittaId !== mensa.mensa.cittaId)
        throw new MensaError(
          400,
          "Beneficiario e Mensa devono appartenere alla stessa area",
        );
      const created = await db.transaction(async (tx) => {
        if (mensaPrincipale) {
          const today = dataServizioMensa();
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`mensa-abilitazione:${beneficiarioId}`}))`,
          );
          await expireEndedPrincipalEligibilities(
            tx,
            beneficiarioId,
            today,
            req,
          );
          const overlapConditions: SQL[] = [
            eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId),
            eq(mensaAbilitazioniTable.stato, "attiva"),
            eq(mensaAbilitazioniTable.mensaPrincipale, true),
            or(
              isNull(mensaAbilitazioniTable.dataFine),
              gte(mensaAbilitazioniTable.dataFine, dataInizio),
            )!,
          ];
          if (dataFine != null) {
            overlapConditions.push(
              lte(mensaAbilitazioniTable.dataInizio, dataFine),
            );
          }
          const [current] = await tx
            .select({ id: mensaAbilitazioniTable.id })
            .from(mensaAbilitazioniTable)
            .where(and(...overlapConditions))
            .limit(1);
          if (current)
            throw new MensaError(
              409,
              "Il periodo si sovrappone a un'abilitazione principale attiva",
            );
        }
        const [row] = await tx
          .insert(mensaAbilitazioniTable)
          .values({
            beneficiarioId,
            mensaId,
            dataInizio,
            dataFine,
            stato: "attiva",
            mensaPrincipale,
            motivo: optionalText(req.body?.motivo, "Il motivo", 2000),
            createdBy: req.user!.id,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(
            req,
            `mensa-abilitazione:${row.id}`,
            "abilitazione",
            null,
            {
              beneficiarioId,
              mensaId,
              dataInizio,
              dataFine,
            },
          ),
        );
        return row;
      });
      const loaded = await loadAbilitazione(created.id);
      res.status(201).json(formatAbilitazione(loaded!));
    } catch (error) {
      if (isUniqueViolation(error) || databaseErrorCode(error) === "23P01") {
        res.status(409).json({
          error: "Il periodo si sovrappone a un'abilitazione principale attiva",
        });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/abilitazioni/:id/stato",
  requirePermission("mensa.eligibility.manage"),
  async (req, res) => {
    try {
      const id = positiveInt(req.params.id, "id");
      const stato = req.body?.stato;
      if (
        typeof stato !== "string" ||
        !ABILITAZIONE_STATI.includes(stato as AbilitazioneStato)
      ) {
        throw new MensaError(400, "Stato abilitazione non valido");
      }
      const motivo = optionalText(req.body?.motivo, "Il motivo", 2000);
      if (["sospesa", "revocata"].includes(stato) && !motivo)
        throw new MensaError(400, "Il motivo è obbligatorio");
      const expected = expectedVersion(req.body?.versione);
      const current = await loadAbilitazione(id);
      if (!current) throw new MensaError(404, "Abilitazione non trovata");
      if (!canAccessCitta(current.cittaId, callerCittaId(req)))
        throw new MensaError(403, "Abilitazione non accessibile");
      const updated = await db.transaction(async (tx) => {
        const allowed: Record<AbilitazioneStato, readonly AbilitazioneStato[]> =
          {
            attiva: ["sospesa", "revocata", "scaduta"],
            sospesa: ["attiva", "revocata"],
            revocata: [],
            scaduta: [],
          };
        const currentState = current.abilitazione.stato as AbilitazioneStato;
        if (!allowed[currentState]?.includes(stato as AbilitazioneStato)) {
          throw new MensaError(
            409,
            `Transizione abilitazione ${currentState} → ${stato} non consentita`,
          );
        }
        if (
          stato === "attiva" &&
          current.abilitazione.dataFine != null &&
          current.abilitazione.dataFine < dataServizioMensa()
        ) {
          throw new MensaError(
            409,
            "Un'abilitazione scaduta non può essere riattivata",
          );
        }
        if (stato === "attiva" && current.abilitazione.mensaPrincipale) {
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`mensa-abilitazione:${current.abilitazione.beneficiarioId}`}))`,
          );
        }
        const [row] = await tx
          .update(mensaAbilitazioniTable)
          .set({ stato, motivo, updatedAt: new Date() })
          .where(
            and(
              eq(mensaAbilitazioniTable.id, id),
              sql`date_trunc('milliseconds', ${mensaAbilitazioniTable.updatedAt}) = ${expected}`,
            ),
          )
          .returning();
        if (!row)
          throw new MensaError(
            409,
            "L'abilitazione è stata modificata; ricarica i dati",
          );
        await tx
          .insert(auditConfigurazioniTable)
          .values(
            auditValues(
              req,
              `mensa-abilitazione:${id}`,
              stato,
              current.abilitazione as unknown as Record<string, unknown>,
              row as unknown as Record<string, unknown>,
              motivo,
            ),
          );
        return row;
      });
      const loaded = await loadAbilitazione(updated.id);
      res.json(formatAbilitazione(loaded!));
    } catch (error) {
      if (isUniqueViolation(error) || databaseErrorCode(error) === "23P01") {
        res
          .status(409)
          .json({ error: "Esiste già un'abilitazione principale attiva" });
        return;
      }
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

export default router;
