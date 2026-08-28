import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  volontariTable,
  centriAscoltoTable,
  consegneTable,
  bolleTable,
  ruoliVolontariTable,
  turniVolontariTable,
  mezziTable,
  matricoleVolontariTable,
  statiVolontariTable,
} from "@workspace/db";
import { runBulk } from "../lib/bulk";
import {
  eq,
  and,
  ne,
  getTableColumns,
  desc,
  ilike,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  centroScopeFilter,
  canAccessCentro,
  visibleCentroIds,
  idSetScopeFilter,
  inVisibleCentroSet,
  andScoped,
} from "../lib/centroScope";
import {
  assignPermanentVolunteerIdentifier,
  assignTemporaryVolunteerIdentifier,
  isVolontarioCodiceFiscaleUniqueViolation,
  isVolontarioMatricolaUniqueViolation,
  previewPermanentVolunteerIdentifier,
  VolunteerIdentifierError,
  type PermanentIdentifierPreview,
  type MatricolaDuplicataPayload,
} from "../lib/volontariMatricola";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { auditLogistica } from "../lib/logisticaAudit";
import { isFasciaTurno, parseRequiredVersion } from "../lib/logisticaPolicy";
import { fasciaTurnoConsegnaSql } from "../lib/consegneTurni";
import {
  isDateOnly,
  normalizeCodiceFiscale,
  todayRome,
} from "../lib/volontariDomain";
import { operationalStatesForRows } from "../lib/volontariOperational";
import {
  appendVolontarioLedgerEvent,
  buildVolunteerEventSnapshot,
  buildVolunteerRegistrationSnapshot,
} from "../lib/volontariLedger";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));

const actorId = (req: Request): number | null =>
  req.user?.id && req.user.id > 0 ? req.user.id : null;

const VOLONTARIO_TEXT_LIMITS = {
  nome: 80,
  cognome: 80,
  matricola: 40,
  telefono: 20,
  telefonoSecondario: 20,
  email: 120,
  luogoNascita: 120,
  indirizzoResidenza: 240,
  indirizzoDomicilio: 240,
  codiceFiscale: 32,
  codiceFiscaleNota: 240,
} as const;

function validateVolontarioTextFields(
  values: Record<string, unknown>,
): string | null {
  for (const [field, max] of Object.entries(VOLONTARIO_TEXT_LIMITS)) {
    if (values[field] == null) continue;
    if (typeof values[field] !== "string") return `${field} non valido`;
    const normalized = values[field].trim();
    values[field] = normalized || null;
    if (normalized.length > max) {
      return `${field} supera la lunghezza massima di ${max} caratteri`;
    }
  }
  if (
    values.dataNascita != null &&
    (typeof values.dataNascita !== "string" ||
      !isDateOnly(values.dataNascita))
  ) {
    return "dataNascita non valida";
  }
  return null;
}

type VolontarioRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
  ruoloCatalogoNome: string | null;
};

const fmt = (
  r: VolontarioRow,
  operational?: Awaited<
    ReturnType<typeof operationalStatesForRows>
  > extends Map<number, infer T>
    ? T
    : never,
  includeSensitive = true,
) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  matricola: r.matricola ?? null,
  tipoVolontario: r.tipoVolontario,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  telefono: includeSensitive ? (r.telefono ?? null) : null,
  telefonoSecondario: includeSensitive ? (r.telefonoSecondario ?? null) : null,
  email: includeSensitive ? (r.email ?? null) : null,
  luogoNascita: includeSensitive ? (r.luogoNascita ?? null) : null,
  dataNascita: includeSensitive ? (r.dataNascita ?? null) : null,
  indirizzoResidenza: includeSensitive ? (r.indirizzoResidenza ?? null) : null,
  indirizzoDomicilio: includeSensitive ? (r.indirizzoDomicilio ?? null) : null,
  codiceFiscale: includeSensitive ? (r.codiceFiscale ?? null) : null,
  codiceFiscaleNonDisponibile: includeSensitive
    ? r.codiceFiscaleNonDisponibile
    : false,
  codiceFiscaleNota: includeSensitive ? (r.codiceFiscaleNota ?? null) : null,
  dataIscrizione: r.dataIscrizione ?? null,
  progressivoRegistro: r.progressivoRegistro,
  dataInizioImportata: includeSensitive
    ? (r.dataInizioImportata ?? null)
    : null,
  categoriaImportataOriginale: includeSensitive
    ? (r.categoriaImportataOriginale ?? null)
    : null,
  gruppoImportatoOriginale: includeSensitive
    ? (r.gruppoImportatoOriginale ?? null)
    : null,
  ruolo: r.ruolo,
  ruoloVolontarioId: r.ruoloVolontarioId ?? null,
  ruoloCatalogoNome: r.ruoloCatalogoNome ?? null,
  patente: r.patente,
  mezzoPersonale: r.mezzoPersonale,
  maxConsegneTurno: r.maxConsegneTurno,
  attivo: r.attivo,
  abilitatoAmministrativamente: r.attivo,
  operativo: operational?.operativo ?? false,
  motivoNonOperativo: operational?.motivoNonOperativo ?? "STATO_NON_CALCOLATO",
  statoAssicurazione: operational?.statoAssicurazione ?? "MANCANTE",
  scadenzaAssicurazione: operational?.scadenzaAssicurazione ?? null,
  sospesoManualmente: operational?.sospesoManualmente ?? !r.attivo,
  giornataTemporaneaValida: operational?.giornataTemporaneaValida ?? null,
  statoApprovazione: r.statoApprovazione,
  note: includeSensitive ? (r.note ?? null) : null,
  versione: r.versione,
  dataCreazione: r.dataCreazione.toISOString(),
  dataAggiornamento: r.dataAggiornamento.toISOString(),
});

const selectVolontario = () =>
  db
    .select({
      ...getTableColumns(volontariTable),
      centroAscoltoNome: centriAscoltoTable.nome,
      ruoloCatalogoNome: ruoliVolontariTable.nome,
    })
    .from(volontariTable)
    .leftJoin(
      centriAscoltoTable,
      eq(volontariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(
      ruoliVolontariTable,
      eq(volontariTable.ruoloVolontarioId, ruoliVolontariTable.id),
    );

router.get(
  "/volontari",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const caller = callerCentroId(req);
    const areaOperativaCentroIds = await visibleCentroIds(
      callerAreaOperativaId(req),
    );
    let requestedCentroScope: ReturnType<typeof centroScopeFilter>;
    let searchScope: ReturnType<typeof or>;
    if (req.query.centroAscoltoId != null) {
      const requestedCentroId = Number(req.query.centroAscoltoId);
      if (!Number.isInteger(requestedCentroId) || requestedCentroId <= 0) {
        res.status(400).json({ error: "centroAscoltoId non valido" });
        return;
      }
      if (
        !canAccessCentro(requestedCentroId, caller) ||
        !inVisibleCentroSet(requestedCentroId, areaOperativaCentroIds)
      ) {
        res
          .status(403)
          .json({ error: "Centro non accessibile per il tuo perimetro" });
        return;
      }
      requestedCentroScope = centroScopeFilter(
        volontariTable.centroAscoltoId,
        requestedCentroId,
      );
    }
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search) {
      const pattern = `%${search}%`;
      searchScope = or(
        ilike(volontariTable.nome, pattern),
        ilike(volontariTable.cognome, pattern),
        ilike(volontariTable.matricola, pattern),
        sql`exists (
          select 1 from matricole_volontari mv
          where mv.volontario_id = ${volontariTable.id}
            and mv.matricola ilike ${pattern}
        )`,
      );
    }
    const tipoQuery = req.query.tipoVolontario ?? req.query.tipo;
    const tipo = typeof tipoQuery === "string" ? tipoQuery.toUpperCase() : "";
    if (
      tipo &&
      tipo !== "TUTTI" &&
      tipo !== "PERMANENTE" &&
      tipo !== "TEMPORANEO"
    ) {
      res.status(400).json({ error: "tipo non valido" });
      return;
    }
    const ruoloVolontarioId =
      req.query.ruoloVolontarioId == null
        ? null
        : Number(req.query.ruoloVolontarioId);
    if (
      ruoloVolontarioId != null &&
      (!Number.isSafeInteger(ruoloVolontarioId) || ruoloVolontarioId <= 0)
    ) {
      res.status(400).json({ error: "ruoloVolontarioId non valido" });
      return;
    }
    const dataRiferimento =
      typeof req.query.dataRiferimento === "string"
        ? req.query.dataRiferimento
        : todayRome();
    if (!isDateOnly(dataRiferimento)) {
      res.status(400).json({ error: "dataRiferimento non valida" });
      return;
    }
    const sqlFilters: SQL[] = [];
    if (tipo === "PERMANENTE" || tipo === "TEMPORANEO")
      sqlFilters.push(eq(volontariTable.tipoVolontario, tipo));
    if (ruoloVolontarioId != null)
      sqlFilters.push(eq(volontariTable.ruoloVolontarioId, ruoloVolontarioId));
    const rows = await selectVolontario()
      .where(
        andScoped(
          centroScopeFilter(volontariTable.centroAscoltoId, caller),
          idSetScopeFilter(
            volontariTable.centroAscoltoId,
            areaOperativaCentroIds,
          ),
          requestedCentroScope,
          searchScope,
          ...sqlFilters,
        ),
      )
      .orderBy(desc(volontariTable.id));
    const states = await operationalStatesForRows(db, rows, dataRiferimento);
    let result = rows.map((row) => fmt(row, states.get(row.id), false));
    const stato =
      typeof req.query.stato === "string"
        ? req.query.stato.toLowerCase().replaceAll(" ", "_")
        : "tutti";
    if (!["attivi", "non_attivi", "tutti"].includes(stato)) {
      res.status(400).json({ error: "stato non valido" });
      return;
    }
    if (stato === "attivi") result = result.filter((row) => row.operativo);
    if (stato === "non_attivi") result = result.filter((row) => !row.operativo);
    const assicurazioneQuery =
      req.query.statoAssicurazione ?? req.query.assicurazione;
    const assicurazione =
      typeof assicurazioneQuery === "string"
        ? assicurazioneQuery.toUpperCase()
        : "";
    if (assicurazione) {
      const aliases: Record<string, string[]> = {
        VALIDA: ["VALIDA"],
        IN_SCADENZA: ["IN_SCADENZA"],
        SCADUTA: ["SCADUTA"],
        MANCANTE: ["MANCANTE"],
        NON_ANCORA_VALIDA: ["NON_ANCORA_VALIDA"],
      };
      if (!aliases[assicurazione]) {
        res.status(400).json({ error: "assicurazione non valida" });
        return;
      }
      result = result.filter((row) =>
        aliases[assicurazione].includes(row.statoAssicurazione),
      );
    }
    const scadenzaDa =
      typeof req.query.scadenzaDa === "string" ? req.query.scadenzaDa : null;
    const scadenzaA =
      typeof req.query.scadenzaA === "string" ? req.query.scadenzaA : null;
    if (
      (scadenzaDa && !isDateOnly(scadenzaDa)) ||
      (scadenzaA && !isDateOnly(scadenzaA))
    ) {
      res.status(400).json({ error: "Intervallo scadenza non valido" });
      return;
    }
    if (scadenzaDa)
      result = result.filter(
        (row) =>
          row.scadenzaAssicurazione != null &&
          row.scadenzaAssicurazione >= scadenzaDa,
      );
    if (scadenzaA)
      result = result.filter(
        (row) =>
          row.scadenzaAssicurazione != null &&
          row.scadenzaAssicurazione <= scadenzaA,
      );
    const monthsQuery =
      req.query.scadutiDaMenoDiMesi ?? req.query.scadutiDaMenoMesi;
    const months = monthsQuery == null ? null : Number(monthsQuery);
    if (months != null) {
      if (!Number.isSafeInteger(months) || months <= 0 || months > 120) {
        res.status(400).json({ error: "scadutiDaMenoDiMesi non valido" });
        return;
      }
      const { subtractCalendarMonths } = await import("../lib/volontariDomain");
      const threshold = subtractCalendarMonths(dataRiferimento, months);
      result = result.filter(
        (row) =>
          row.statoAssicurazione === "SCADUTA" &&
          row.scadenzaAssicurazione != null &&
          row.scadenzaAssicurazione >= threshold,
      );
    }
    res.json(result);
  },
);

async function createVolontarioOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ id: number } | (MatricolaDuplicataPayload & { status?: number })> {
  const caller = callerCentroId(req);
  const values: Record<string, unknown> = {};
  const textFields = [
    "nome",
    "cognome",
    "telefono",
    "telefonoSecondario",
    "email",
    "luogoNascita",
    "dataNascita",
    "indirizzoResidenza",
    "indirizzoDomicilio",
    "codiceFiscale",
    "codiceFiscaleNota",
    "note",
  ] as const;
  for (const field of textFields) {
    if (body[field] !== undefined) {
      values[field] =
        typeof body[field] === "string"
          ? body[field].trim() || null
          : body[field];
    }
  }
  for (const field of [
    "centroAscoltoId",
    "ruoloVolontarioId",
    "maxConsegneTurno",
    "tipoVolontario",
  ] as const) {
    if (body[field] !== undefined) values[field] = body[field];
  }
  for (const field of ["patente", "mezzoPersonale"] as const) {
    if (typeof body[field] === "boolean") values[field] = body[field];
  }
  if (typeof body.codiceFiscaleNonDisponibile === "boolean")
    values.codiceFiscaleNonDisponibile = body.codiceFiscaleNonDisponibile;
  const textError = validateVolontarioTextFields(values);
  if (textError) return { error: textError, status: 400 };
  if (typeof values.nome !== "string" || typeof values.cognome !== "string") {
    return { error: "Nome e cognome sono obbligatori", status: 400 };
  }
  if (body.matricola != null && String(body.matricola).trim()) {
    return {
      error: "La matricola viene generata automaticamente dal sistema",
      status: 400,
    };
  }
  const tipoVolontario =
    values.tipoVolontario == null
      ? "PERMANENTE"
      : String(values.tipoVolontario).toUpperCase();
  if (tipoVolontario !== "PERMANENTE" && tipoVolontario !== "TEMPORANEO") {
    return { error: "tipoVolontario non valido", status: 400 };
  }
  values.tipoVolontario = tipoVolontario;
  const codiceFiscaleNormalizzato = normalizeCodiceFiscale(
    values.codiceFiscale,
  );
  values.codiceFiscale = codiceFiscaleNormalizzato;
  values.codiceFiscaleNormalizzato = codiceFiscaleNormalizzato;
  const codiceFiscaleNonDisponibile = values.codiceFiscaleNonDisponibile === true;
  if (codiceFiscaleNormalizzato && codiceFiscaleNonDisponibile) {
    return {
      error: "Il codice fiscale non può essere presente e segnato come non disponibile",
      status: 400,
    };
  }
  if (!codiceFiscaleNormalizzato && !codiceFiscaleNonDisponibile) {
    return {
      error: "Inserisci il codice fiscale oppure dichiaralo non disponibile",
      status: 400,
    };
  }
  if (
    codiceFiscaleNonDisponibile &&
    (typeof values.codiceFiscaleNota !== "string" || !values.codiceFiscaleNota)
  ) {
    return {
      error: "Indica il motivo per cui il codice fiscale non è disponibile",
      status: 400,
    };
  }
  for (const required of [
    ["luogoNascita", "Luogo di nascita"],
    ["dataNascita", "Data di nascita"],
    ["indirizzoResidenza", "Indirizzo di residenza"],
  ] as const) {
    if (typeof values[required[0]] !== "string" || !values[required[0]])
      return { error: `${required[1]} obbligatorio`, status: 400 };
  }
  if (codiceFiscaleNormalizzato) {
    const [duplicateCf] = await db
      .select({ id: volontariTable.id })
      .from(volontariTable)
      .where(
        eq(volontariTable.codiceFiscaleNormalizzato, codiceFiscaleNormalizzato),
      )
      .limit(1);
    if (duplicateCf)
      return {
        error: "Il codice fiscale è già associato a un altro volontario",
        status: 409,
      };
  }
  const areaId = callerAreaOperativaId(req);
  const visibleIds = await visibleCentroIds(areaId);
  if (caller != null) values.centroAscoltoId = caller;
  else if (areaId != null && values.centroAscoltoId == null) {
    return {
      error: "Seleziona un Centro della tua Area Operativa",
      status: 400,
    };
  } else if (values.centroAscoltoId != null) {
    const centroAscoltoId = Number(values.centroAscoltoId);
    if (!Number.isSafeInteger(centroAscoltoId) || centroAscoltoId <= 0) {
      return { error: "centroAscoltoId non valido", status: 400 };
    }
    if (!inVisibleCentroSet(centroAscoltoId, visibleIds)) {
      return {
        error: "Centro non accessibile per la tua area operativa",
        status: 403,
      };
    }
    values.centroAscoltoId = centroAscoltoId;
  }
  const ruoloVolontarioId = Number(values.ruoloVolontarioId);
  if (!Number.isInteger(ruoloVolontarioId) || ruoloVolontarioId <= 0) {
    return { error: "ruoloVolontarioId obbligatorio", status: 400 };
  }
  const [ruolo] = await db
    .select({ id: ruoliVolontariTable.id, nome: ruoliVolontariTable.nome })
    .from(ruoliVolontariTable)
    .where(
      and(
        eq(ruoliVolontariTable.id, ruoloVolontarioId),
        eq(ruoliVolontariTable.attivo, true),
      ),
    );
  if (!ruolo)
    return { error: "Ruolo volontario non attivo o non valido", status: 400 };
  const maxConsegneTurno = Number(values.maxConsegneTurno ?? 5);
  if (!Number.isInteger(maxConsegneTurno) || maxConsegneTurno < 0) {
    return {
      error: "maxConsegneTurno deve essere maggiore o uguale a zero",
      status: 400,
    };
  }
  values.ruoloVolontarioId = ruolo.id;
  values.ruolo = ruolo.nome;
  values.maxConsegneTurno = maxConsegneTurno;
  values.statoApprovazione = "in_attesa";
  values.attivo = false;
  values.dataIscrizione = todayRome();
  delete values.versione;
  delete values.dataAggiornamento;
  try {
    const [created] = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(volontariTable)
        .values(values as typeof volontariTable.$inferInsert)
        .returning();
      const matricola =
        tipoVolontario === "TEMPORANEO"
          ? await assignTemporaryVolunteerIdentifier(
              tx,
              inserted.id,
              todayRome(),
              actorId(req),
            )
          : await assignPermanentVolunteerIdentifier(
              tx,
              inserted.id,
              inserted.centroAscoltoId,
              todayRome(),
              actorId(req),
            );
      const row = { ...inserted, matricola };
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: row.id,
        azione: "creazione",
        nuovo: {
          statoApprovazione: "in_attesa",
          attivo: false,
          versione: row.versione,
        },
      });
      await appendVolontarioLedgerEvent(tx, {
        sezione: tipoVolontario,
        tipoEvento: "REGISTRAZIONE",
        volontarioId: row.id,
        centroAscoltoId:
          (values.centroAscoltoId as number | null | undefined) ?? null,
        dataEffettiva: todayRome(),
        snapshot: await buildVolunteerRegistrationSnapshot(tx, row, {
          origine: "MANUALE",
          dataInizio: todayRome(),
        }),
        utenteId: actorId(req),
      });
      return [row];
    });
    return { id: created.id };
  } catch (e) {
    if (isVolontarioCodiceFiscaleUniqueViolation(e))
      return {
        error: "Il codice fiscale è già associato a un altro volontario",
        status: 409,
      };
    if (isVolontarioMatricolaUniqueViolation(e))
      return { error: "Conflitto durante la generazione della matricola", status: 409 };
    if (e instanceof VolunteerIdentifierError)
      return { error: e.message, status: 422 };
    throw e;
  }
}

router.post(
  "/volontari",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const r = await createVolontarioOne(req.body, req);
    if ("error" in r) {
      res.status(r.status ?? 403).json({
        error: r.error,
        ...(r.matricolaSuggerita
          ? { matricolaSuggerita: r.matricolaSuggerita }
          : {}),
      });
      return;
    }
    const [row] = await selectVolontario().where(eq(volontariTable.id, r.id));
    const state = (await operationalStatesForRows(db, [row], todayRome())).get(
      row.id,
    );
    res.status(201).json(fmt(row, state));
  },
);

router.post(
  "/volontari/bulk",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
    const result = await runBulk(righe, async (row) => {
      const r = await createVolontarioOne(row, req);
      return "error" in r ? { error: r.error } : { ok: true };
    });
    res.json(result);
  },
);

// Carico per volontario nello slot canonico data+fascia. Conta solo le consegne
// ancora operative; le bolle non costituiscono una seconda unità di carico.
router.get(
  "/volontari/carico",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const { data, fascia, excludeConsegnaId } = req.query as Record<
      string,
      string
    >;
    if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      res
        .status(400)
        .json({
          error: "Parametro 'data' non valido (formato atteso: YYYY-MM-DD)",
        });
      return;
    }
    if (!isFasciaTurno(fascia)) {
      res.status(400).json({ error: "Parametro 'fascia' non valido" });
      return;
    }
    const exclConsegna =
      excludeConsegnaId != null ? parseInt(excludeConsegnaId) : NaN;
    const counts = new Map<number, number>();

    // Il conteggio dello slot resta globale tra i centri: una risorsa condivisa
    // non può superare il proprio limite data+fascia distribuendo le consegne.
    const consegneConds = [
      eq(consegneTable.dataPrevista, data),
      ne(consegneTable.stato, "annullata"),
      eq(fasciaTurnoConsegnaSql(), fascia),
    ];
    if (Number.isInteger(exclConsegna))
      consegneConds.push(ne(consegneTable.id, exclConsegna));
    const cons = await db
      .select({ volontarioId: consegneTable.volontarioId })
      .from(consegneTable)
      .where(and(...consegneConds));
    for (const r of cons) {
      if (r.volontarioId != null)
        counts.set(r.volontarioId, (counts.get(r.volontarioId) ?? 0) + 1);
    }

    // Le RIGHE restituite sono però limitate ai volontari visibili al chiamante
    // (confine centro + area operativa HARD): il conteggio resta globale, ma non si espone
    // l'attività di volontari fuori perimetro.
    const areaOperativaCentroIds = await visibleCentroIds(
      callerAreaOperativaId(req),
    );
    const visibili = await db
      .select({ id: volontariTable.id })
      .from(volontariTable)
      .where(
        andScoped(
          centroScopeFilter(
            volontariTable.centroAscoltoId,
            callerCentroId(req),
          ),
          idSetScopeFilter(
            volontariTable.centroAscoltoId,
            areaOperativaCentroIds,
          ),
        ),
      );
    const visibileSet = new Set(visibili.map((v) => v.id));

    res.json(
      [...counts.entries()]
        .filter(([volontarioId]) => visibileSet.has(volontarioId))
        .map(([volontarioId, count]) => ({ volontarioId, count })),
    );
  },
);

router.get(
  "/volontari/:id/matricole",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [volunteer] = Number.isSafeInteger(id)
      ? await db.select().from(volontariTable).where(eq(volontariTable.id, id))
      : [];
    if (!volunteer) {
      res.status(404).json({ error: "Volontario non trovato" });
      return;
    }
    if (
      !canAccessCentro(volunteer.centroAscoltoId, callerCentroId(req)) ||
      !inVisibleCentroSet(
        volunteer.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
      res.status(403).json({ error: "Volontario non accessibile" });
      return;
    }
    const identifiers = await db
      .select({
        id: matricoleVolontariTable.id,
        matricola: matricoleVolontariTable.matricola,
        tipoIdentificativo: matricoleVolontariTable.tipoIdentificativo,
        stato: matricoleVolontariTable.stato,
        origine: matricoleVolontariTable.origine,
        dataInizioValidita: matricoleVolontariTable.dataInizioValidita,
        dataFineValidita: matricoleVolontariTable.dataFineValidita,
        dataAssegnazione: matricoleVolontariTable.dataAssegnazione,
      })
      .from(matricoleVolontariTable)
      .where(eq(matricoleVolontariTable.volontarioId, id))
      .orderBy(desc(matricoleVolontariTable.dataInizioValidita), desc(matricoleVolontariTable.id));
    res.json(identifiers);
  },
);

router.get(
  "/volontari/:id/conversione-permanente/preview",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [volunteer] = Number.isSafeInteger(id)
      ? await db.select().from(volontariTable).where(eq(volontariTable.id, id))
      : [];
    if (!volunteer) {
      res.status(404).json({ error: "Volontario non trovato" });
      return;
    }
    if (
      !canAccessCentro(volunteer.centroAscoltoId, callerCentroId(req)) ||
      !inVisibleCentroSet(
        volunteer.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
      res.status(403).json({ error: "Volontario non accessibile" });
      return;
    }
    if (volunteer.tipoVolontario !== "TEMPORANEO") {
      res.status(409).json({ error: "Il volontario è già permanente" });
      return;
    }
    try {
      res.json({
        volontarioId: volunteer.id,
        versioneVolontario: volunteer.versione,
        matricolaAttuale: volunteer.matricola,
        dataConversione: todayRome(),
        preview: await previewPermanentVolunteerIdentifier(volunteer.centroAscoltoId),
      });
    } catch (error) {
      if (error instanceof VolunteerIdentifierError) {
        res.status(422).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  },
);

router.post(
  "/volontari/:id/conversione-permanente",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const id = Number(req.params.id);
    const versione = parseRequiredVersion(req.body?.versioneVolontario ?? req.body?.versione);
    const preview = req.body?.preview as PermanentIdentifierPreview | undefined;
    if (!Number.isSafeInteger(id) || id <= 0 || versione == null || !preview) {
      res.status(400).json({ error: "Conferma conversione non valida" });
      return;
    }
    if (
      typeof preview.matricola !== "string" ||
      typeof preview.matricolaNormalizzata !== "string" ||
      !Number.isSafeInteger(preview.configurazioneId) ||
      !Number.isSafeInteger(preview.configurazioneVersione) ||
      typeof preview.scopeKey !== "string" ||
      !Number.isSafeInteger(preview.versioneProgressivo) ||
      !Number.isSafeInteger(preview.prossimoNumero)
    ) {
      res.status(400).json({ error: "Preview conversione non valida" });
      return;
    }
    try {
      const converted = await db.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(volontariTable)
          .where(eq(volontariTable.id, id))
          .for("update");
        if (!existing) throw new Error("VOLUNTEER_NOT_FOUND");
        if (
          !canAccessCentro(existing.centroAscoltoId, callerCentroId(req)) ||
          !inVisibleCentroSet(
            existing.centroAscoltoId,
            await visibleCentroIds(callerAreaOperativaId(req)),
          )
        )
          throw new Error("VOLUNTEER_FORBIDDEN");
        if (existing.versione !== versione) throw new Error("STALE_VERSION");
        if (existing.tipoVolontario !== "TEMPORANEO")
          throw new Error("ALREADY_PERMANENT");
        const dataConversione = todayRome();
        const nuovaMatricola = await assignPermanentVolunteerIdentifier(
          tx,
          existing.id,
          existing.centroAscoltoId,
          dataConversione,
          actorId(req),
          "CONVERSIONE",
          preview,
        );
        const [row] = await tx
          .update(volontariTable)
          .set({
            tipoVolontario: "PERMANENTE",
            versione: sql`${volontariTable.versione} + 1`,
            dataAggiornamento: new Date(),
          })
          .where(
            and(
              eq(volontariTable.id, existing.id),
              eq(volontariTable.versione, versione),
            ),
          )
          .returning();
        if (!row) throw new Error("STALE_VERSION");
        await appendVolontarioLedgerEvent(tx, {
          sezione: "PERMANENTE",
          tipoEvento: "CONVERSIONE_PERMANENTE",
          volontarioId: row.id,
          centroAscoltoId: row.centroAscoltoId,
          dataEffettiva: dataConversione,
          snapshot: await buildVolunteerEventSnapshot(tx, row, {
            statoPrecedente: "TEMPORANEO",
            nuovoStato: "PERMANENTE",
            motivo: "conversione_volontario",
            dataEffettiva: dataConversione,
            versione: row.versione,
            datiEvento: {
              matricolaPrecedente: existing.matricola,
              nuovaMatricola,
              configurazioneId: preview.configurazioneId,
              configurazioneVersione: preview.configurazioneVersione,
            },
          }),
          utenteId: actorId(req),
        });
        await auditLogistica(tx, req, {
          entita: "volontario",
          id: row.id,
          azione: "conversione_permanente",
          precedente: {
            tipoVolontario: existing.tipoVolontario,
            matricola: existing.matricola,
            versione: existing.versione,
          },
          nuovo: {
            tipoVolontario: "PERMANENTE",
            matricola: nuovaMatricola,
            versione: row.versione,
            dataConversione,
          },
        });
        return row;
      });
      const [row] = await selectVolontario().where(eq(volontariTable.id, converted.id));
      const state = (await operationalStatesForRows(db, [row], todayRome())).get(row.id);
      res.json(fmt(row, state));
    } catch (error) {
      if (error instanceof VolunteerIdentifierError) {
        res.status(error.code === "PREVIEW_CONVERSIONE_SCADUTA" ? 409 : 422).json({
          error: error.message,
          code: error.code,
        });
        return;
      }
      const code = error instanceof Error ? error.message : "";
      if (code === "VOLUNTEER_NOT_FOUND") {
        res.status(404).json({ error: "Volontario non trovato" });
        return;
      }
      if (code === "VOLUNTEER_FORBIDDEN") {
        res.status(403).json({ error: "Volontario non accessibile" });
        return;
      }
      if (code === "STALE_VERSION" || code === "ALREADY_PERMANENT") {
        res.status(409).json({
          error:
            code === "ALREADY_PERMANENT"
              ? "Il volontario è già permanente"
              : "Il volontario è stato modificato: rigenera la preview",
          code,
        });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/volontari/:id",
  requirePermission("logistica.volontari.view"),
  async (req, res) => {
    const [row] = await selectVolontario().where(
      eq(volontariTable.id, parseInt(String(req.params.id))),
    );
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    if (
      !inVisibleCentroSet(
        row.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per la tua area operativa" });
      return;
    }
    const dataRiferimento =
      typeof req.query.dataRiferimento === "string"
        ? req.query.dataRiferimento
        : todayRome();
    if (!isDateOnly(dataRiferimento)) {
      res.status(400).json({ error: "dataRiferimento non valida" });
      return;
    }
    const state = (
      await operationalStatesForRows(db, [row], dataRiferimento)
    ).get(row.id);
    res.json(fmt(row, state));
  },
);

router.patch(
  "/volontari/:id",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const caller = callerCentroId(req);
    const [existing] = await db
      .select()
      .from(volontariTable)
      .where(eq(volontariTable.id, parseInt(String(req.params.id))));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (!canAccessCentro(existing.centroAscoltoId, caller)) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo centro" });
      return;
    }
    if (
      !inVisibleCentroSet(
        existing.centroAscoltoId,
        await visibleCentroIds(callerAreaOperativaId(req)),
      )
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per la tua area operativa" });
      return;
    }
    const versione = parseRequiredVersion(req.body?.versione);
    if (versione == null) {
      res.status(400).json({ error: "versione obbligatoria e valida" });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (req.body?.matricola !== undefined) {
      res.status(400).json({
        error: "La matricola non è modificabile manualmente",
      });
      return;
    }
    if (
      req.body?.codiceFiscaleNonDisponibile !== undefined &&
      typeof req.body.codiceFiscaleNonDisponibile !== "boolean"
    ) {
      res.status(400).json({
        error: "codiceFiscaleNonDisponibile deve essere booleano",
      });
      return;
    }
    for (const field of [
      "nome",
      "cognome",
      "tipoVolontario",
      "centroAscoltoId",
      "telefono",
      "telefonoSecondario",
      "email",
      "luogoNascita",
      "dataNascita",
      "indirizzoResidenza",
      "indirizzoDomicilio",
      "codiceFiscale",
      "codiceFiscaleNonDisponibile",
      "codiceFiscaleNota",
      "ruoloVolontarioId",
      "patente",
      "mezzoPersonale",
      "maxConsegneTurno",
      "attivo",
      "note",
    ] as const) {
      if (req.body?.[field] !== undefined) updates[field] = req.body[field];
    }
    const textError = validateVolontarioTextFields(updates);
    if (
      textError ||
      ("nome" in updates && updates.nome == null) ||
      ("cognome" in updates && updates.cognome == null)
    ) {
      res
        .status(400)
        .json({ error: textError ?? "Nome e cognome non possono essere vuoti" });
      return;
    }
    if ("tipoVolontario" in updates) {
      const tipo = String(updates.tipoVolontario).toUpperCase();
      if (tipo !== "PERMANENTE" && tipo !== "TEMPORANEO") {
        res.status(400).json({ error: "tipoVolontario non valido" });
        return;
      }
      if (tipo !== existing.tipoVolontario) {
        res.status(409).json({
          error:
            existing.tipoVolontario === "TEMPORANEO" && tipo === "PERMANENTE"
              ? "Usa il workflow Converti in permanente"
              : "Il tipo volontario non è modificabile direttamente",
          code: "CONVERSIONE_RICHIESTA",
        });
        return;
      }
      delete updates.tipoVolontario;
    }
    if ("codiceFiscale" in updates) {
      const normalized = normalizeCodiceFiscale(updates.codiceFiscale);
      if (normalized) {
        const [duplicate] = await db
          .select({ id: volontariTable.id })
          .from(volontariTable)
          .where(
            and(
              eq(volontariTable.codiceFiscaleNormalizzato, normalized),
              ne(volontariTable.id, existing.id),
            ),
          )
          .limit(1);
        if (duplicate) {
          res
            .status(409)
            .json({
              error: "Il codice fiscale è già associato a un altro volontario",
            });
          return;
        }
      }
      updates.codiceFiscale = normalized;
      updates.codiceFiscaleNormalizzato = normalized;
    }
    const nextCf =
      "codiceFiscale" in updates
        ? (updates.codiceFiscaleNormalizzato as string | null)
        : existing.codiceFiscaleNormalizzato;
    const nextUnavailable =
      "codiceFiscaleNonDisponibile" in updates
        ? updates.codiceFiscaleNonDisponibile === true
        : existing.codiceFiscaleNonDisponibile;
    const nextCfNote =
      "codiceFiscaleNota" in updates
        ? updates.codiceFiscaleNota
        : existing.codiceFiscaleNota;
    if ((nextCf && nextUnavailable) || (!nextCf && !nextUnavailable)) {
      res.status(400).json({
        error: "Inserisci il codice fiscale oppure dichiaralo non disponibile",
      });
      return;
    }
    if (nextUnavailable && (typeof nextCfNote !== "string" || !nextCfNote.trim())) {
      res.status(400).json({
        error: "Indica il motivo per cui il codice fiscale non è disponibile",
      });
      return;
    }
    const areaId = callerAreaOperativaId(req);
    if (caller != null) delete updates.centroAscoltoId;
    else if (updates.centroAscoltoId !== undefined) {
      if (areaId != null && updates.centroAscoltoId == null) {
        res
          .status(400)
          .json({ error: "Seleziona un Centro della tua Area Operativa" });
        return;
      }
      const centroAscoltoId =
        updates.centroAscoltoId == null
          ? null
          : Number(updates.centroAscoltoId);
      if (
        centroAscoltoId != null &&
        (!Number.isSafeInteger(centroAscoltoId) || centroAscoltoId <= 0)
      ) {
        res.status(400).json({ error: "centroAscoltoId non valido" });
        return;
      }
      if (
        !inVisibleCentroSet(centroAscoltoId, await visibleCentroIds(areaId))
      ) {
        res
          .status(403)
          .json({ error: "Centro non accessibile per la tua area operativa" });
        return;
      }
      updates.centroAscoltoId = centroAscoltoId;
    }
    if (updates.attivo === true && existing.statoApprovazione !== "approvato") {
      res
        .status(409)
        .json({
          error: "La risorsa deve essere approvata prima dell'attivazione",
        });
      return;
    }
    if (updates.ruoloVolontarioId !== undefined) {
      const ruoloId = Number(updates.ruoloVolontarioId);
      const [ruolo] = Number.isInteger(ruoloId)
        ? await db
            .select({
              id: ruoliVolontariTable.id,
              nome: ruoliVolontariTable.nome,
            })
            .from(ruoliVolontariTable)
            .where(
              and(
                eq(ruoliVolontariTable.id, ruoloId),
                eq(ruoliVolontariTable.attivo, true),
              ),
            )
        : [];
      if (!ruolo) {
        res
          .status(400)
          .json({ error: "Ruolo volontario non attivo o non valido" });
        return;
      }
      updates.ruoloVolontarioId = ruolo.id;
      updates.ruolo = ruolo.nome;
    } else {
      delete updates.ruolo;
    }
    if (updates.maxConsegneTurno !== undefined) {
      const max = Number(updates.maxConsegneTurno);
      if (!Number.isInteger(max) || max < 0) {
        res
          .status(400)
          .json({
            error: "maxConsegneTurno deve essere maggiore o uguale a zero",
          });
        return;
      }
      updates.maxConsegneTurno = max;
    }
    try {
      const [updated] = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(volontariTable)
          .set({
            ...updates,
            versione: sql`${volontariTable.versione} + 1`,
            dataAggiornamento: new Date(),
          })
          .where(
            and(
              eq(volontariTable.id, existing.id),
              eq(volontariTable.versione, versione),
            ),
          )
          .returning();
        if (!row) throw new Error("STALE_VERSION");
        await auditLogistica(tx, req, {
          entita: "volontario",
          id: row.id,
          azione:
            updates.attivo === true
              ? "attivazione"
              : updates.attivo === false
                ? "disattivazione"
                : "modifica",
          precedente: { versione: existing.versione, attivo: existing.attivo },
          nuovo: {
            versione: row.versione,
            attivo: updates.attivo ?? existing.attivo,
          },
        });
        const identityFields = [
          "nome",
          "cognome",
          "telefono",
          "telefonoSecondario",
          "email",
          "luogoNascita",
          "dataNascita",
          "indirizzoResidenza",
          "indirizzoDomicilio",
          "codiceFiscale",
          "codiceFiscaleNonDisponibile",
          "codiceFiscaleNota",
          "centroAscoltoId",
          "ruoloVolontarioId",
        ].filter((field) => field in updates);
        if (identityFields.length) {
          const date = todayRome();
          await appendVolontarioLedgerEvent(tx, {
            sezione: existing.tipoVolontario as "PERMANENTE" | "TEMPORANEO",
            tipoEvento: "AGGIORNAMENTO_ANAGRAFICA",
            volontarioId: row.id,
            centroAscoltoId: row.centroAscoltoId,
            dataEffettiva: date,
            snapshot: await buildVolunteerEventSnapshot(tx, row, {
              statoPrecedente: existing.tipoVolontario,
              nuovoStato: row.tipoVolontario,
              motivo: "aggiornamento_anagrafica",
              dataEffettiva: date,
              versione: row.versione,
              datiEvento: {
                campiModificati: identityFields,
              },
            }),
            utenteId: actorId(req),
          });
        }
        if (
          typeof updates.attivo === "boolean" &&
          updates.attivo !== existing.attivo
        ) {
          const date = todayRome();
          await tx.insert(statiVolontariTable).values({
            volontarioId: existing.id,
            tipoEvento: updates.attivo ? "RIATTIVAZIONE" : "SOSPENSIONE",
            dataEffettiva: date,
            motivo: updates.attivo
              ? "riattivazione"
              : "sospensione organizzativa",
            note: "Compatibilità modifica anagrafica",
            creatoDa: actorId(req),
          });
          await appendVolontarioLedgerEvent(tx, {
            sezione: (updates.tipoVolontario ?? existing.tipoVolontario) as
              | "PERMANENTE"
              | "TEMPORANEO",
            tipoEvento: updates.attivo
              ? "RIATTIVAZIONE"
              : "SOSPENSIONE_CESSAZIONE",
            volontarioId: existing.id,
            centroAscoltoId: existing.centroAscoltoId,
            dataEffettiva: date,
            snapshot: await buildVolunteerEventSnapshot(tx, row, {
              statoPrecedente: existing.attivo ? "ATTIVO" : "NON_ATTIVO",
              nuovoStato: updates.attivo ? "ATTIVO" : "SOSPESO",
              motivo: "compatibilita_modifica",
              dataEffettiva: date,
              versione: row.versione,
              datiEvento: { origine: "modifica_anagrafica" },
            }),
            utenteId: actorId(req),
          });
        }
        return [row];
      });
      const [row] = await selectVolontario().where(
        eq(volontariTable.id, updated.id),
      );
      const state = (
        await operationalStatesForRows(db, [row], todayRome())
      ).get(row.id);
      res.json(fmt(row, state));
    } catch (e) {
      if (e instanceof Error && e.message === "STALE_VERSION") {
        res
          .status(409)
          .json({
            error: "La risorsa è stata aggiornata da un altro operatore",
          });
        return;
      }
      if (isVolontarioCodiceFiscaleUniqueViolation(e)) {
        res.status(409).json({
          error: "Il codice fiscale è già associato a un altro volontario",
          code: "CODICE_FISCALE_DUPLICATO",
        });
        return;
      }
      throw e;
    }
  },
);

router.delete(
  "/volontari/:id",
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
    const caller = callerCentroId(req);
    const id = parseInt(String(req.params.id));
    const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(volontariTable)
        .where(eq(volontariTable.id, id))
        .for("update");
      if (!existing) return { status: 204 as const };
      if (
        !canAccessCentro(existing.centroAscoltoId, caller) ||
        !inVisibleCentroSet(existing.centroAscoltoId, visibleIds)
      )
        return { status: 403 as const };
      const versione = parseRequiredVersion(req.body?.versione);
      if (versione == null) return { status: 400 as const };
      const [row] = await tx
        .update(volontariTable)
        .set({
          attivo: false,
          versione: sql`${volontariTable.versione} + 1`,
          dataAggiornamento: new Date(),
        })
        .where(
          and(eq(volontariTable.id, id), eq(volontariTable.versione, versione)),
        )
        .returning({
          id: volontariTable.id,
          versione: volontariTable.versione,
        });
      if (!row) return { status: 409 as const };
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: row.id,
        azione: "disattivazione",
        precedente: { versione: existing.versione, attivo: existing.attivo },
        nuovo: { versione: row.versione, attivo: false },
      });
      const date = todayRome();
      await tx
        .insert(statiVolontariTable)
        .values({
          volontarioId: id,
          tipoEvento: "SOSPENSIONE",
          dataEffettiva: date,
          motivo: "sospensione organizzativa",
          note: "Compatibilità disattivazione",
          creatoDa: actorId(req),
        });
      await appendVolontarioLedgerEvent(tx, {
        sezione: existing.tipoVolontario as "PERMANENTE" | "TEMPORANEO",
        tipoEvento: "SOSPENSIONE_CESSAZIONE",
        volontarioId: id,
        centroAscoltoId: existing.centroAscoltoId,
        dataEffettiva: date,
        snapshot: await buildVolunteerEventSnapshot(tx, existing, {
          statoPrecedente: existing.attivo ? "ATTIVO" : "NON_ATTIVO",
          nuovoStato: "SOSPESO",
          motivo: "sospensione_organizzativa",
          dataEffettiva: date,
          versione: row.versione,
          datiEvento: { origine: "disattivazione_compatibilita" },
        }),
        utenteId: actorId(req),
      });
      return { status: 200 as const, versione: row.versione };
    });
    if (result.status === 204) {
      res.status(204).send();
      return;
    }
    if (result.status === 403) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo perimetro" });
      return;
    }
    if (result.status === 400) {
      res.status(400).json({ error: "versione obbligatoria e valida" });
      return;
    }
    if (result.status === 409) {
      res
        .status(409)
        .json({ error: "La risorsa è stata aggiornata da un altro operatore" });
      return;
    }
    res.status(200).json({ disattivato: true, versione: result.versione });
  },
);

export default router;
