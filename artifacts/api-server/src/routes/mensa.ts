import { Router, type IRouter, type Request } from "express";
import {
  auditConfigurazioniTable,
  beneficiariTable,
  cittaTable,
  db,
  lottiTable,
  magazziniTable,
  mensaAbilitazioniTable,
  mensaAccessiTable,
  mensaAutorizzazioniTemporaneeTable,
  mensaEccezioniTable,
  mensaPastiTable,
  menseTable,
  prodottiTable,
  tessereBeneficiariTable,
  trasferimentiTable,
  trasferimentoRigheTable,
  utentiTable,
} from "@workspace/db";
import {
  and,
  asc,
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
  canAccessCitta,
  canAccessMagazzino,
  cittaScopeFilter,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import { isDateOnly } from "../lib/interventiWorkflow";
import { intervalloGiornoEuropeRome } from "../lib/interventiViste";
import { canUseMensaException, dataServizioMensa, stessoGiornoServizioMensa } from "../lib/mensaWorkflow";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { searchBeneficiariDuplicates } from "../lib/beneficiarioDuplicates";
import { createBeneficiarioOne } from "./beneficiari";
import {
  issueTesseraBeneficiario,
  TesseraBeneficiarioError,
} from "../lib/tesseraBeneficiarioService";

const router: IRouter = Router();
router.use("/mensa", requireModulo("MENSA"));

const ABILITAZIONE_STATI = [
  "attiva",
  "sospesa",
  "revocata",
  "scaduta",
] as const;
const TESSERA_STATI = ["attiva", "sospesa", "revocata", "scaduta"] as const;
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
  magazzinoNome?: string | null,
) {
  return {
    id: row.id,
    codice: row.codice,
    nome: row.nome,
    cittaId: row.cittaId,
    cittaNome: cittaNome ?? null,
    magazzinoId: row.magazzinoId,
    magazzinoNome: magazzinoNome ?? null,
    indirizzo: row.indirizzo ?? null,
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
      magazzinoNome: magazziniTable.nome,
      magazzinoStato: magazziniTable.stato,
      magazzinoTipo: magazziniTable.tipoMagazzino,
    })
    .from(menseTable)
    .leftJoin(cittaTable, eq(menseTable.cittaId, cittaTable.id))
    .leftJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
    .where(eq(menseTable.id, id));
  return row ?? null;
}

async function requireMensa(id: number, req: Request, active = false) {
  const row = await loadMensa(id);
  if (!row) throw new MensaError(404, "Mensa non trovata");
  if (!canAccessCitta(row.mensa.cittaId, callerCittaId(req))) {
    throw new MensaError(403, "Mensa non accessibile per la tua città");
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
    throw new MensaError(403, "Magazzino non accessibile per la tua città");
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
          magazzinoNome: magazziniTable.nome,
        })
        .from(menseTable)
        .leftJoin(cittaTable, eq(menseTable.cittaId, cittaTable.id))
        .leftJoin(magazziniTable, eq(menseTable.magazzinoId, magazziniTable.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(menseTable.createdAt), desc(menseTable.id));
      res.json(
        rows.map((row) =>
          formatMensa(row.mensa, row.cittaNome, row.magazzinoNome),
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
      res.json(formatMensa(row.mensa, row.cittaNome, row.magazzinoNome));
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
      const codice = text(req.body?.codice, "Il codice", 30);
      const nome = text(req.body?.nome, "Il nome", 160);
      const magazzinoId = positiveInt(req.body?.magazzinoId, "magazzinoId");
      const ownCity = callerCittaId(req);
      const cittaId = ownCity ?? positiveInt(req.body?.cittaId, "cittaId");
      if (
        ownCity != null &&
        req.body?.cittaId != null &&
        Number(req.body.cittaId) !== ownCity
      ) {
        throw new MensaError(403, "La Mensa deve appartenere alla tua città");
      }
      const [warehouse] = await db
        .select()
        .from(magazziniTable)
        .where(eq(magazziniTable.id, magazzinoId));
      if (!warehouse) throw new MensaError(400, "Magazzino non trovato");
      if (
        !(await canAccessMagazzino(magazzinoId, callerCentroId(req), ownCity))
      ) {
        throw new MensaError(403, "Magazzino non accessibile");
      }
      if (warehouse.cittaId !== cittaId) {
        throw new MensaError(
          400,
          "Mensa e magazzino devono appartenere alla stessa città",
        );
      }
      if (warehouse.stato !== "attivo") {
        throw new MensaError(
          409,
          "Un magazzino non attivo non può essere associato a una Mensa",
        );
      }
      if (warehouse.tipoMagazzino !== "mensa") {
        throw new MensaError(
          409,
          "Il magazzino deve essere esplicitamente configurato come Mensa",
        );
      }
      const created = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(menseTable)
          .values({
            codice,
            nome,
            cittaId,
            magazzinoId,
            indirizzo: optionalText(req.body?.indirizzo, "L'indirizzo", 255),
            attiva: req.body?.attiva !== false,
            note: optionalText(req.body?.note, "Le note", 4000),
            createdBy: req.user!.id,
          })
          .returning();
        await tx.insert(auditConfigurazioniTable).values(
          auditValues(req, `mensa:${row.id}`, "creazione", null, {
            codice,
            nome,
            cittaId,
            magazzinoId,
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
            loaded?.magazzinoNome ?? null,
          ),
        );
    } catch (error) {
      if (isUniqueViolation(error)) {
        res
          .status(409)
          .json({ error: "Codice o magazzino già associato a una Mensa" });
        return;
      }
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
      if (beneficiario.statoAnagrafica !== "completa" || beneficiario.centroAscoltoId == null)
        throw new MensaError(409, "Completa l'anagrafica e associa un Centro di Ascolto prima di emettere la tessera");
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
        const [row] = await tx
          .update(tessereBeneficiariTable)
          .set({
            stato,
            motivoRevoca: stato === "revocata" ? motivo : null,
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
          attivo: true,
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
          if (latest?.abilitazione.stato === "sospesa" || latest?.abilitazione.stato === "revocata") {
            throw new MensaError(409, `Accesso temporaneo non consentito: abilitazione Mensa ${latest.abilitazione.stato}`);
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
      const rows = await db
        .select({ id: mensaAccessiTable.id })
        .from(mensaAccessiTable)
        .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mensaAccessiTable.dataOra))
        .limit(200);
      const results = await Promise.all(
        rows.map((row) => loadAccessoDto(row.id)),
      );
      res.json(results.filter(Boolean));
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
      const tipoServizio = text(req.body?.tipoServizio, "Il tipo servizio", 40);
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
        .select({ accesso: mensaAccessiTable, mensa: menseTable, autorizzazioneTemporanea: mensaAutorizzazioniTemporaneeTable })
        .from(mensaAccessiTable)
        .innerJoin(menseTable, eq(mensaAccessiTable.mensaId, menseTable.id))
        .leftJoin(mensaAutorizzazioniTemporaneeTable, eq(mensaAccessiTable.autorizzazioneTemporaneaId, mensaAutorizzazioniTemporaneeTable.id))
        .where(eq(mensaAccessiTable.id, accessoId));
      if (!access) throw new MensaError(404, "Accesso non trovato");
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
        throw new MensaError(409, "L'accesso Mensa non è valido per la data di servizio corrente");
      }
      if (access.accesso.modalitaAccesso === "temporaneo"
        && (!access.autorizzazioneTemporanea || access.autorizzazioneTemporanea.dataServizio !== serviceDate)) {
        throw new MensaError(409, "L'autorizzazione temporanea non è valida per la data di servizio corrente");
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
        const [row] = await tx
          .insert(mensaPastiTable)
          .values({
            mensaId: access.accesso.mensaId,
            beneficiarioId,
            accessoMensaId: accessoId,
            dataOra: now,
            dataServizio: serviceDate,
            tipoServizio,
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
      const tipo = optionalText(req.query.tipoServizio, "Il tipo servizio", 40);
      if (mensaId != null)
        conditions.push(eq(mensaPastiTable.mensaId, mensaId));
      if (data) conditions.push(eq(mensaPastiTable.dataServizio, data));
      if (tipo) conditions.push(eq(mensaPastiTable.tipoServizio, tipo));
      const ownCity = callerCittaId(req);
      if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
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
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mensaPastiTable.dataOra))
        .limit(500);
      res.json(
        rows.map((row) => ({
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
        })),
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
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(mensaEccezioniTable.dataOra))
        .limit(500);
      res.json(
        rows.map(({ eccezione, nome, cognome }) => ({
          ...eccezione,
          beneficiarioNome: `${nome} ${cognome}`,
          dataOra: eccezione.dataOra.toISOString(),
          createdAt: eccezione.createdAt.toISOString(),
        })),
      );
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.get(
  "/mensa/logistica/magazzini",
  requirePermission("mensa.transfers.manage"),
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
  requirePermission("mensa.transfers.manage"),
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
          quantita: sql<string>`sum(${lottiTable.quantitaResidua})`,
        })
        .from(lottiTable)
        .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
        .where(
          and(
            eq(lottiTable.magazzinoId, magazzinoId),
            gt(lottiTable.quantitaResidua, "0"),
            or(
              isNull(lottiTable.dataScadenza),
              gte(lottiTable.dataScadenza, today),
            ),
          ),
        )
        .groupBy(prodottiTable.id)
        .orderBy(asc(prodottiTable.nome));
      res.json(rows.map((row) => ({ ...row, quantita: Number(row.quantita) })));
    } catch (error) {
      if (sendMensaError(error, res)) return;
      throw error;
    }
  },
);

router.post(
  "/mensa/trasferimenti",
  requirePermission("mensa.transfers.manage"),
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
      const created = await db.transaction(async (tx) => {
        const [transfer] = await tx
          .insert(trasferimentiTable)
          .values({
            codice: `TRASM-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`,
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
          })
          .returning();
        await tx.insert(trasferimentoRigheTable).values(
          normalized.map((row) => ({
            trasferimentoId: transfer.id,
            prodottoId: row.prodottoId,
            quantita: row.quantita.toFixed(2),
            unitaMisura: row.unitaMisura,
            note: row.note,
          })),
        );
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
        return transfer;
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
  requirePermission("mensa.transfers.manage"),
  async (req, res) => {
    const conditions: SQL[] = [];
    const ownCity = callerCittaId(req);
    if (ownCity != null) conditions.push(eq(menseTable.cittaId, ownCity));
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
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(trasferimentiTable.dataCreazione))
      .limit(200);
    res.json(
      rows.map(({ trasferimento, mensaNome, origineNome }) => ({
        ...trasferimento,
        mensaNome,
        magazzinoOrigineNome: origineNome,
        dataCreazione: trasferimento.dataCreazione.toISOString(),
      })),
    );
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
      const tipo = optionalText(req.query.tipoServizio, "Il tipo servizio", 40);
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
      const accessConditions: SQL[] = [
        gte(mensaAccessiTable.dataOra, intervalloGiornoEuropeRome(dal).start),
        lt(mensaAccessiTable.dataOra, intervalloGiornoEuropeRome(al).end),
      ];
      if (mensaId != null)
        accessConditions.push(eq(mensaAccessiTable.mensaId, mensaId));
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
      res.json({
        dal,
        al,
        totalePasti: total,
        beneficiariDistinti: mealTotals?.beneficiariDistinti ?? 0,
        accessiOrdinari: accesses?.ordinari ?? 0,
        accessiEccezione: accesses?.eccezioni ?? 0,
        accessiNegati: accesses?.negati ?? 0,
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
          loaded?.magazzinoNome ?? null,
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
          "Beneficiario e Mensa devono appartenere alla stessa città",
        );
      const created = await db.transaction(async (tx) => {
        if (mensaPrincipale) {
          const today = dataServizioMensa();
          await expireEndedPrincipalEligibilities(
            tx,
            beneficiarioId,
            today,
            req,
          );
          const [current] = await tx
            .select({ id: mensaAbilitazioniTable.id })
            .from(mensaAbilitazioniTable)
            .where(
              and(
                eq(mensaAbilitazioniTable.beneficiarioId, beneficiarioId),
                eq(mensaAbilitazioniTable.stato, "attiva"),
                eq(mensaAbilitazioniTable.mensaPrincipale, true),
              ),
            )
            .limit(1);
          if (current)
            throw new MensaError(
              409,
              "Esiste già un'abilitazione principale attiva",
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
      if (isUniqueViolation(error)) {
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
      if (isUniqueViolation(error)) {
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
