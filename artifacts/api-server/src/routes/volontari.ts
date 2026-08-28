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
  isVolontarioMatricolaUniqueViolation,
  MATRICOLA_OBBLIGATORIA_MSG,
  matricolaVolontarioDuplicataPayload,
  matricolaVolontarioGiaUsata,
  normalizeVolontarioMatricola,
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
  codiceFiscale: 32,
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
  codiceFiscale: includeSensitive ? (r.codiceFiscale ?? null) : null,
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
    "matricola",
    "telefono",
    "telefonoSecondario",
    "email",
    "luogoNascita",
    "dataNascita",
    "indirizzoResidenza",
    "codiceFiscale",
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
  const textError = validateVolontarioTextFields(values);
  if (textError) return { error: textError, status: 400 };
  if (typeof values.nome !== "string" || typeof values.cognome !== "string") {
    return { error: "Nome e cognome sono obbligatori", status: 400 };
  }
  const matricola = normalizeVolontarioMatricola(values.matricola);
  if (!matricola) return { error: MATRICOLA_OBBLIGATORIA_MSG, status: 400 };
  values.matricola = matricola;
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
  delete values.versione;
  delete values.dataAggiornamento;
  if (await matricolaVolontarioGiaUsata(matricola)) {
    return {
      ...(await matricolaVolontarioDuplicataPayload(matricola)),
      status: 409,
    };
  }
  try {
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(volontariTable)
        .values(values as typeof volontariTable.$inferInsert)
        .returning();
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
    if (isVolontarioMatricolaUniqueViolation(e)) {
      return {
        ...(await matricolaVolontarioDuplicataPayload(matricola)),
        status: 409,
      };
    }
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
    for (const field of [
      "nome",
      "cognome",
      "matricola",
      "tipoVolontario",
      "centroAscoltoId",
      "telefono",
      "telefonoSecondario",
      "email",
      "luogoNascita",
      "dataNascita",
      "indirizzoResidenza",
      "codiceFiscale",
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
    if ("matricola" in updates) {
      const matricola = normalizeVolontarioMatricola(updates.matricola);
      if (!matricola) {
        res.status(400).json({ error: MATRICOLA_OBBLIGATORIA_MSG });
        return;
      }
      if (await matricolaVolontarioGiaUsata(matricola, existing.id)) {
        res
          .status(409)
          .json(
            await matricolaVolontarioDuplicataPayload(matricola, existing.id),
          );
        return;
      }
      updates.matricola = matricola;
    }
    if ("tipoVolontario" in updates) {
      const tipo = String(updates.tipoVolontario).toUpperCase();
      if (tipo !== "PERMANENTE" && tipo !== "TEMPORANEO") {
        res.status(400).json({ error: "tipoVolontario non valido" });
        return;
      }
      updates.tipoVolontario = tipo;
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
      if (isVolontarioMatricolaUniqueViolation(e)) {
        const matricola =
          normalizeVolontarioMatricola(updates.matricola) ??
          existing.matricola ??
          "";
        res
          .status(409)
          .json(
            await matricolaVolontarioDuplicataPayload(matricola, existing.id),
          );
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
