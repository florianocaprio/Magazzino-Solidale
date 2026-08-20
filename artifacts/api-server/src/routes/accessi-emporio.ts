import { Router, type IRouter } from "express";
import {
  beneficiariTable,
  centriAscoltoTable,
  consegneTable,
  areeOperativeTable,
  db,
  magazziniTable,
  sessioniCassaEmporioTable,
} from "@workspace/db";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  callerZonaUdsId,
  canAccessMagazzino,
  canUseBeneficiario,
  centroScopeFilter,
  areaOperativaScopeFilter,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
  zonaUdsScopeFilter,
} from "../lib/centroScope";
import {
  EMPORIO_DISABLED_MSG,
  isEmporioEnabled,
} from "../lib/impostazioniModuli";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { auditEmporioTx } from "../lib/emporioAudit";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import { intervalloGiornoEuropeRome } from "../lib/interventiViste";

const router: IRouter = Router();
router.use(
  "/accessi-emporio",
  requireModulo("EMPORIO_SOLIDALE", EMPORIO_DISABLED_MSG),
);

const TIPO_ACCESSO = "accesso_emporio";
const TIPO_CONSEGNA_ACCESSO = "accesso_emporio";
const STATI_ACCESSO = [
  "pianificato",
  "confermato",
  "effettuato",
  "annullato",
  "non_presentato",
] as const;
type StatoAccesso = (typeof STATI_ACCESSO)[number];
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const ACCESS_TRANSITIONS: Readonly<
  Record<StatoAccesso, readonly StatoAccesso[]>
> = {
  pianificato: ["confermato", "annullato", "non_presentato"],
  confermato: ["annullato", "non_presentato"],
  effettuato: [],
  annullato: [],
  non_presentato: [],
};

const MSG_BENEFICIARIO_NON_ATTIVO = "Il beneficiario non è attivo.";
const MSG_CENTRO_RICHIESTO =
  "Per pianificare un Accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.";
const MSG_CREDITO_RICHIESTO =
  "Il beneficiario non è abilitato al Credito Solidale.";
const MSG_CREDITO_NON_ATTIVO =
  "Il Credito Solidale del beneficiario non è attivo.";
const MSG_MAGAZZINO_EMPORIO =
  "Selezionare un magazzino di tipo Emporio o Misto.";
const MSG_DUPLICATO =
  "Esiste già un Accesso Emporio pianificato per questo beneficiario nella data selezionata.";
const MSG_ACCESSO_NON_TROVATO =
  "Accesso Emporio non trovato. Verifica l'accesso selezionato e riprova.";
const MSG_RISORSA_NON_ACCESSIBILE =
  "Risorsa non accessibile per il tuo profilo";

class SpesaAccessoError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function asInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function yyyyMmDd(value: Date): string {
  return dataCivileEuropeRome(value);
}

function isStatoAccesso(value: unknown): value is StatoAccesso {
  return (
    typeof value === "string" && STATI_ACCESSO.includes(value as StatoAccesso)
  );
}

function statoConsegnaFromAccesso(stato: StatoAccesso): string {
  if (stato === "effettuato") return "effettuata";
  if (stato === "annullato") return "annullata";
  if (stato === "non_presentato") return "mancata";
  return "pianificata";
}

async function assertEmporioEnabled(
  res: import("express").Response,
): Promise<boolean> {
  if (await isEmporioEnabled()) return true;
  res.status(403).json({ error: EMPORIO_DISABLED_MSG });
  return false;
}

async function loadBeneficiario(beneficiarioId: number) {
  const [beneficiario] = await db
    .select()
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  return beneficiario ?? null;
}

async function canAccessAccessoEmporio(
  accesso: Pick<
    typeof consegneTable.$inferSelect,
    "beneficiarioId" | "magazzinoEmporioId"
  >,
  req: import("express").Request,
): Promise<boolean> {
  if (accesso.magazzinoEmporioId == null) return false;
  return (
    (await canUseBeneficiario(
      accesso.beneficiarioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
      callerZonaUdsId(req),
    )) &&
    (await canAccessMagazzino(
      accesso.magazzinoEmporioId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  );
}

function validateBeneficiarioAccesso(
  beneficiario: typeof beneficiariTable.$inferSelect | null,
): string | null {
  if (!beneficiario) return "Beneficiario non trovato.";
  if (!beneficiario.attivo) return MSG_BENEFICIARIO_NON_ATTIVO;
  if (beneficiario.centroAscoltoId == null) return MSG_CENTRO_RICHIESTO;
  if (!beneficiario.creditoSolidaleAbilitato) return MSG_CREDITO_RICHIESTO;
  if (beneficiario.creditoSolidaleStato !== "attivo")
    return MSG_CREDITO_NON_ATTIVO;
  return null;
}

async function validateMagazzinoEmporio(
  id: number,
  req: import("express").Request,
  beneficiario?: typeof beneficiariTable.$inferSelect | null,
): Promise<
  | { error: string; status: number }
  | { magazzino: typeof magazziniTable.$inferSelect }
> {
  const [magazzino] = await db
    .select()
    .from(magazziniTable)
    .where(eq(magazziniTable.id, id));
  if (!magazzino || !["emporio", "misto"].includes(magazzino.tipoMagazzino)) {
    return { error: MSG_MAGAZZINO_EMPORIO, status: 400 };
  }
  if (
    !(await canAccessMagazzino(id, callerCentroId(req), callerAreaOperativaId(req)))
  ) {
    return {
      error: "Magazzino non accessibile per il tuo profilo",
      status: 403,
    };
  }
  if (magazzino.stato !== "attivo")
    return { error: "L'Emporio selezionato non è attivo.", status: 400 };
  if (beneficiario && magazzino.areaOperativaId !== beneficiario.areaOperativaId) {
    return {
      error: "L'Emporio deve appartenere alla stessa Area Operativa del Beneficiario.",
      status: 400,
    };
  }
  return { magazzino };
}

async function hasDuplicateAccesso(
  executor: Tx | typeof db,
  beneficiarioId: number,
  dataOraInizio: Date,
  excludeId?: number,
): Promise<boolean> {
  const { start, end } = intervalloGiornoEuropeRome(
    dataCivileEuropeRome(dataOraInizio),
  );
  const conditions: SQL[] = [
    eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
    eq(consegneTable.beneficiarioId, beneficiarioId),
    gte(consegneTable.dataOraInizio, start),
    lt(consegneTable.dataOraInizio, end),
    ne(consegneTable.statoAccessoEmporio, "annullato"),
    ne(consegneTable.statoAccessoEmporio, "non_presentato"),
  ];
  if (excludeId != null) conditions.push(ne(consegneTable.id, excludeId));
  const rows = await executor
    .select({ id: consegneTable.id })
    .from(consegneTable)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

function databaseErrorCode(error: unknown): unknown {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return candidate?.code ?? candidate?.cause?.code;
}

function formatAccesso(row: {
  c: typeof consegneTable.$inferSelect;
  beneficiarioNome: string | null;
  beneficiarioCognome: string | null;
  beneficiarioCodice: string | null;
  beneficiarioCodiceFiscale: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  areaOperativaId: number | null;
  areaOperativaNome: string | null;
  magazzinoEmporioNome: string | null;
  creditoSolidaleSaldo: string | null;
  creditoSolidaleMensileAssegnato: string | null;
}) {
  return {
    id: row.c.id,
    codice: row.c.codice,
    beneficiarioId: row.c.beneficiarioId,
    beneficiarioNome:
      row.beneficiarioCognome && row.beneficiarioNome
        ? `${row.beneficiarioCognome} ${row.beneficiarioNome}`
        : null,
    beneficiarioCodice: row.beneficiarioCodice,
    beneficiarioCodiceFiscale: row.beneficiarioCodiceFiscale,
    centroAscoltoId: row.centroAscoltoId,
    centroAscoltoNome: row.centroAscoltoNome,
    areaOperativaId: row.areaOperativaId,
    areaOperativaNome: row.areaOperativaNome,
    tipoPianificazione: row.c.tipoPianificazione,
    magazzinoEmporioId: row.c.magazzinoEmporioId,
    magazzinoEmporioNome: row.magazzinoEmporioNome,
    dataOraInizio: row.c.dataOraInizio?.toISOString() ?? null,
    dataOraFine: row.c.dataOraFine?.toISOString() ?? null,
    statoAccessoEmporio: row.c.statoAccessoEmporio,
    motivoAnnullamento: row.c.motivoAnnullamento ?? null,
    noteAccessoEmporio: row.c.noteAccessoEmporio ?? null,
    origineAccesso: row.c.origineAccesso ?? null,
    accessoForzato: row.c.accessoForzato,
    motivoAccessoForzato: row.c.motivoAccessoForzato ?? null,
    dataOraEffettivaAccesso:
      row.c.dataOraEffettivaAccesso?.toISOString() ?? null,
    operatoreAccessoEmporioId: row.c.operatoreAccessoEmporioId ?? null,
    saldoCreditoSolidale: Number(row.creditoSolidaleSaldo ?? "0"),
    quotaMensileAssegnata:
      row.creditoSolidaleMensileAssegnato == null
        ? null
        : Number(row.creditoSolidaleMensileAssegnato),
    dataCreazione: row.c.dataCreazione.toISOString(),
  };
}

function selectAccessi(conditions: SQL[] = []) {
  return db
    .select({
      c: consegneTable,
      beneficiarioNome: beneficiariTable.nome,
      beneficiarioCognome: beneficiariTable.cognome,
      beneficiarioCodice: beneficiariTable.codice,
      beneficiarioCodiceFiscale: beneficiariTable.codiceFiscale,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      areaOperativaId: beneficiariTable.areaOperativaId,
      areaOperativaNome: areeOperativeTable.nome,
      magazzinoEmporioNome: magazziniTable.nome,
      creditoSolidaleSaldo: beneficiariTable.creditoSolidaleSaldo,
      creditoSolidaleMensileAssegnato:
        beneficiariTable.creditoSolidaleMensileAssegnato,
    })
    .from(consegneTable)
    .leftJoin(
      beneficiariTable,
      eq(consegneTable.beneficiarioId, beneficiariTable.id),
    )
    .leftJoin(
      centriAscoltoTable,
      eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(areeOperativeTable, eq(beneficiariTable.areaOperativaId, areeOperativeTable.id))
    .leftJoin(
      magazziniTable,
      eq(consegneTable.magazzinoEmporioId, magazziniTable.id),
    )
    .where(
      and(eq(consegneTable.tipoPianificazione, TIPO_ACCESSO), ...conditions),
    )
    .orderBy(desc(consegneTable.dataOraInizio), desc(consegneTable.id));
}

router.get(
  "/accessi-emporio",
  requirePermission("emporio.access.view"),
  async (req, res) => {
    const q = req.query as Record<string, string>;
    const page = q.page == null ? 1 : Number(q.page);
    const limit = q.limit == null ? 50 : Number(q.limit);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100
    ) {
      res.status(400).json({
        error:
          "Paginazione non valida: page >= 1 e limit compreso tra 1 e 100.",
      });
      return;
    }
    const conditions: SQL[] = [];
    if (q.dataDa)
      conditions.push(
        gte(
          consegneTable.dataOraInizio,
          intervalloGiornoEuropeRome(q.dataDa).start,
        ),
      );
    if (q.dataA)
      conditions.push(
        lt(
          consegneTable.dataOraInizio,
          intervalloGiornoEuropeRome(q.dataA).end,
        ),
      );
    if (q.magazzinoEmporioId)
      conditions.push(
        eq(consegneTable.magazzinoEmporioId, Number(q.magazzinoEmporioId)),
      );
    if (q.statoAccessoEmporio)
      conditions.push(
        eq(consegneTable.statoAccessoEmporio, q.statoAccessoEmporio),
      );
    if (q.beneficiarioId)
      conditions.push(
        eq(consegneTable.beneficiarioId, Number(q.beneficiarioId)),
      );
    if (q.beneficiarioSearch) {
      const s = `%${q.beneficiarioSearch}%`;
      const filter = or(
        ilike(beneficiariTable.nome, s),
        ilike(beneficiariTable.cognome, s),
        ilike(
          sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
          s,
        ),
        ilike(
          sql<string>`trim(coalesce(${beneficiariTable.nome}, '') || ' ' || coalesce(${beneficiariTable.cognome}, ''))`,
          s,
        ),
        ilike(beneficiariTable.codice, s),
        ilike(beneficiariTable.codiceFiscale, s),
      );
      if (filter) conditions.push(filter);
    }
    const caller = callerCentroId(req);
    if (caller != null) {
      const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
      if (f) conditions.push(f);
    } else if (q.centroAscoltoId) {
      conditions.push(
        eq(beneficiariTable.centroAscoltoId, Number(q.centroAscoltoId)),
      );
    }
    const requestedAreaOperativa = q.areaOperativaId ?? q.areaId;
    if (requestedAreaOperativa)
      conditions.push(eq(beneficiariTable.areaOperativaId, Number(requestedAreaOperativa)));
    const areaOperativaFilter = areaOperativaScopeFilter(
      beneficiariTable.areaOperativaId,
      callerAreaOperativaId(req),
    );
    if (areaOperativaFilter) conditions.push(areaOperativaFilter);
    const zonaFilter = zonaUdsScopeFilter(
      beneficiariTable.zonaUdsId,
      callerZonaUdsId(req),
    );
    if (zonaFilter) conditions.push(zonaFilter);
    const magazzinoFilter = magazzinoScopeFilter(
      consegneTable.magazzinoEmporioId,
      await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)),
    );
    if (magazzinoFilter) conditions.push(magazzinoFilter);

    const where = and(
      eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
      ...conditions,
    );
    const [{ total }] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(consegneTable)
      .leftJoin(
        beneficiariTable,
        eq(consegneTable.beneficiarioId, beneficiariTable.id),
      )
      .leftJoin(
        centriAscoltoTable,
        eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
      )
      .leftJoin(areeOperativeTable, eq(beneficiariTable.areaOperativaId, areeOperativeTable.id))
      .leftJoin(
        magazziniTable,
        eq(consegneTable.magazzinoEmporioId, magazziniTable.id),
      )
      .where(where);
    const rows = await selectAccessi(conditions)
      .limit(limit)
      .offset((page - 1) * limit);
    res.setHeader("X-Total-Count", String(total));
    res.json(rows.map(formatAccesso));
  },
);

router.get(
  "/accessi-emporio/beneficiari/ricerca",
  requirePermission("emporio.access.view"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const q = req.query as Record<string, string | undefined>;
    const search = asText(q.search);
    const beneficiarioId = asInt(q.beneficiarioId);
    if (!search && beneficiarioId == null) {
      res.json([]);
      return;
    }

    const conditions: SQL[] = [eq(beneficiariTable.attivo, true)];
    if (beneficiarioId != null)
      conditions.push(eq(beneficiariTable.id, beneficiarioId));
    if (search) {
      const s = `%${search}%`;
      conditions.push(
        or(
          ilike(beneficiariTable.nome, s),
          ilike(beneficiariTable.cognome, s),
          ilike(
            sql<string>`trim(coalesce(${beneficiariTable.cognome}, '') || ' ' || coalesce(${beneficiariTable.nome}, ''))`,
            s,
          ),
          ilike(
            sql<string>`trim(coalesce(${beneficiariTable.nome}, '') || ' ' || coalesce(${beneficiariTable.cognome}, ''))`,
            s,
          ),
          ilike(beneficiariTable.codice, s),
          ilike(beneficiariTable.codiceFiscale, s),
        )!,
      );
    }
    const centroFilter = centroScopeFilter(
      beneficiariTable.centroAscoltoId,
      callerCentroId(req),
    );
    if (centroFilter) conditions.push(centroFilter);
    const areaOperativaFilter = areaOperativaScopeFilter(
      beneficiariTable.areaOperativaId,
      callerAreaOperativaId(req),
    );
    if (areaOperativaFilter) conditions.push(areaOperativaFilter);
    const zonaFilter = zonaUdsScopeFilter(
      beneficiariTable.zonaUdsId,
      callerZonaUdsId(req),
    );
    if (zonaFilter) conditions.push(zonaFilter);

    const rows = await db
      .select({
        beneficiario: beneficiariTable,
        centroAscoltoNome: centriAscoltoTable.nome,
        areaOperativaNome: areeOperativeTable.nome,
        magazzinoEmporioPreferitoNome: magazziniTable.nome,
      })
      .from(beneficiariTable)
      .leftJoin(
        centriAscoltoTable,
        eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id),
      )
      .leftJoin(areeOperativeTable, eq(beneficiariTable.areaOperativaId, areeOperativeTable.id))
      .leftJoin(
        magazziniTable,
        eq(beneficiariTable.magazzinoEmporioPreferitoId, magazziniTable.id),
      )
      .where(and(...conditions))
      .orderBy(asc(beneficiariTable.cognome), asc(beneficiariTable.nome))
      .limit(30);

    res.json(
      rows.map((row) => ({
        beneficiarioId: row.beneficiario.id,
        beneficiarioNome: `${row.beneficiario.cognome} ${row.beneficiario.nome}`,
        beneficiarioCodice: row.beneficiario.codice,
        beneficiarioCodiceFiscale: row.beneficiario.codiceFiscale,
        centroAscoltoId: row.beneficiario.centroAscoltoId,
        centroAscoltoNome: row.centroAscoltoNome,
        areaOperativaId: row.beneficiario.areaOperativaId,
        areaOperativaNome: row.areaOperativaNome,
        creditoSolidaleAbilitato: row.beneficiario.creditoSolidaleAbilitato,
        creditoSolidaleStato: row.beneficiario.creditoSolidaleStato,
        saldoCreditoSolidale: Number(
          row.beneficiario.creditoSolidaleSaldo ?? "0",
        ),
        quotaMensileAssegnata:
          row.beneficiario.creditoSolidaleMensileAssegnato == null
            ? null
            : Number(row.beneficiario.creditoSolidaleMensileAssegnato),
        magazzinoEmporioPreferitoId:
          row.beneficiario.magazzinoEmporioPreferitoId,
        magazzinoEmporioPreferitoNome: row.magazzinoEmporioPreferitoNome,
        attivo: row.beneficiario.attivo,
      })),
    );
  },
);

router.get(
  "/accessi-emporio/:id",
  requirePermission("emporio.access.view"),
  async (req, res) => {
    const id = Number(req.params.id);
    const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
    if (rows.length === 0) {
      res.status(404).json({ error: MSG_ACCESSO_NON_TROVATO });
      return;
    }
    const row = rows[0];
    if (!(await canAccessAccessoEmporio(row.c, req))) {
      res.status(403).json({ error: MSG_RISORSA_NON_ACCESSIBILE });
      return;
    }
    res.json(formatAccesso(row));
  },
);

router.post(
  "/accessi-emporio",
  requirePermission("emporio.access.manage"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const beneficiarioId = asInt(req.body?.beneficiarioId);
    const magazzinoEmporioId = asInt(req.body?.magazzinoEmporioId);
    const dataOraInizio = parseDateTime(req.body?.dataOraInizio);
    const dataOraFine = parseDateTime(req.body?.dataOraFine);
    if (
      req.body?.statoAccessoEmporio != null &&
      req.body.statoAccessoEmporio !== "pianificato"
    ) {
      res.status(400).json({
        error: "Un nuovo Accesso Emporio deve nascere nello stato pianificato.",
      });
      return;
    }
    if (
      beneficiarioId == null ||
      magazzinoEmporioId == null ||
      dataOraInizio == null
    ) {
      res.status(400).json({
        error: "Beneficiario, Emporio e data/ora inizio sono obbligatori.",
      });
      return;
    }
    if (dataOraFine != null && dataOraFine <= dataOraInizio) {
      res
        .status(400)
        .json({ error: "L'ora fine deve essere successiva all'ora inizio." });
      return;
    }
    if (
      !(await canUseBeneficiario(
        beneficiarioId,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Beneficiario non accessibile per il tuo profilo" });
      return;
    }
    const beneficiario = await loadBeneficiario(beneficiarioId);
    const beneficiarioError = validateBeneficiarioAccesso(beneficiario);
    if (beneficiarioError) {
      res.status(400).json({ error: beneficiarioError });
      return;
    }
    const emporio = await validateMagazzinoEmporio(
      magazzinoEmporioId,
      req,
      beneficiario,
    );
    if ("error" in emporio) {
      res.status(emporio.status).json({ error: emporio.error });
      return;
    }
    let created: { id: number };
    try {
      created = await db.transaction(async (tx) => {
        const civilDay = yyyyMmDd(dataOraInizio);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('accesso-emporio'), hashtext(${`${beneficiarioId}:${civilDay}`}))`,
        );
        if (await hasDuplicateAccesso(tx, beneficiarioId, dataOraInizio)) {
          throw new Error(MSG_DUPLICATO);
        }
        const [row] = await tx
          .insert(consegneTable)
          .values({
            codice: `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            beneficiarioId,
            tipoPianificazione: TIPO_ACCESSO,
            tipoConsegna: TIPO_CONSEGNA_ACCESSO,
            dataPrevista: civilDay,
            magazzinoId: magazzinoEmporioId,
            magazzinoEmporioId,
            dataOraInizio,
            dataOraFine,
            stato: statoConsegnaFromAccesso("pianificato"),
            statoAccessoEmporio: "pianificato",
            noteAccessoEmporio: asText(req.body?.noteAccessoEmporio),
          })
          .returning({ id: consegneTable.id });
        await auditEmporioTx(tx, {
          entityType: "accesso",
          entityId: row.id,
          action: "creazione",
          operatoreId: req.user?.id,
          ip: req.ip,
          after: {
            beneficiarioId,
            magazzinoEmporioId,
            civilDay,
            stato: "pianificato",
          },
        });
        return row;
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === MSG_DUPLICATO ||
          databaseErrorCode(error) === "23505")
      ) {
        res.status(409).json({ error: MSG_DUPLICATO });
        return;
      }
      throw error;
    }
    const rows = await selectAccessi([eq(consegneTable.id, created.id)]).limit(
      1,
    );
    res.status(201).json(formatAccesso(rows[0]));
  },
);

router.patch(
  "/accessi-emporio/:id",
  requirePermission("emporio.access.manage"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(consegneTable)
      .where(
        and(
          eq(consegneTable.id, id),
          eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: MSG_ACCESSO_NON_TROVATO });
      return;
    }
    if (!(await canAccessAccessoEmporio(existing, req))) {
      res.status(403).json({ error: MSG_RISORSA_NON_ACCESSIBILE });
      return;
    }

    if ("statoAccessoEmporio" in (req.body ?? {})) {
      res.status(400).json({
        error:
          "Usare l'endpoint di transizione stato per modificare lo stato dell'Accesso.",
      });
      return;
    }

    const beneficiarioId =
      asInt(req.body?.beneficiarioId) ?? existing.beneficiarioId;
    const magazzinoEmporioId =
      asInt(req.body?.magazzinoEmporioId) ?? existing.magazzinoEmporioId;
    const dataOraInizio =
      "dataOraInizio" in req.body
        ? parseDateTime(req.body.dataOraInizio)
        : existing.dataOraInizio;
    const dataOraFine =
      "dataOraFine" in req.body
        ? parseDateTime(req.body.dataOraFine)
        : existing.dataOraFine;
    if (magazzinoEmporioId == null || dataOraInizio == null) {
      res
        .status(400)
        .json({ error: "Emporio e data/ora inizio sono obbligatori." });
      return;
    }
    if (dataOraFine != null && dataOraFine <= dataOraInizio) {
      res
        .status(400)
        .json({ error: "L'ora fine deve essere successiva all'ora inizio." });
      return;
    }
    if (
      !(await canUseBeneficiario(
        beneficiarioId,
        callerCentroId(req),
        callerAreaOperativaId(req),
        callerZonaUdsId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Beneficiario non accessibile per il tuo profilo" });
      return;
    }
    const beneficiario = await loadBeneficiario(beneficiarioId);
    const beneficiarioError = validateBeneficiarioAccesso(beneficiario);
    if (beneficiarioError) {
      res.status(400).json({ error: beneficiarioError });
      return;
    }
    const emporio = await validateMagazzinoEmporio(
      magazzinoEmporioId,
      req,
      beneficiario,
    );
    if ("error" in emporio) {
      res.status(emporio.status).json({ error: emporio.error });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM ${consegneTable} WHERE ${consegneTable.id} = ${id} FOR UPDATE`,
        );
        const [locked] = await tx
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, id));
        if (!locked) throw new SpesaAccessoError(404, MSG_ACCESSO_NON_TROVATO);
        if (!(await canAccessAccessoEmporio(locked, req)))
          throw new SpesaAccessoError(403, MSG_RISORSA_NON_ACCESSIBILE);
        const [linkedSession] = await tx
          .select({ id: sessioniCassaEmporioTable.id })
          .from(sessioniCassaEmporioTable)
          .where(eq(sessioniCassaEmporioTable.accessoEmporioId, id))
          .limit(1);
        if (
          linkedSession &&
          (beneficiarioId !== locked.beneficiarioId ||
            magazzinoEmporioId !== locked.magazzinoEmporioId ||
            dataOraInizio.getTime() !==
              (locked.dataOraInizio?.getTime() ?? null) ||
            (dataOraFine?.getTime() ?? null) !==
              (locked.dataOraFine?.getTime() ?? null))
        ) {
          throw new SpesaAccessoError(
            409,
            "Beneficiario, Emporio e data/ora non sono modificabili dopo l'apertura della Sessione Cassa.",
          );
        }
        const civilDay = yyyyMmDd(dataOraInizio);
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext('accesso-emporio'), hashtext(${`${beneficiarioId}:${civilDay}`}))`,
        );
        if (await hasDuplicateAccesso(tx, beneficiarioId, dataOraInizio, id)) {
          throw new SpesaAccessoError(409, MSG_DUPLICATO);
        }
        const updates: Partial<typeof consegneTable.$inferInsert> = {
          beneficiarioId,
          magazzinoId: magazzinoEmporioId,
          magazzinoEmporioId,
          dataOraInizio,
          dataOraFine,
          dataPrevista: civilDay,
          noteAccessoEmporio:
            "noteAccessoEmporio" in req.body
              ? asText(req.body.noteAccessoEmporio)
              : locked.noteAccessoEmporio,
        };
        await tx
          .update(consegneTable)
          .set(updates)
          .where(eq(consegneTable.id, id));
        await auditEmporioTx(tx, {
          entityType: "accesso",
          entityId: id,
          action: "modifica",
          operatoreId: req.user?.id,
          ip: req.ip,
          before: {
            beneficiarioId: locked.beneficiarioId,
            magazzinoEmporioId: locked.magazzinoEmporioId,
            dataOraInizio: locked.dataOraInizio?.toISOString() ?? null,
          },
          after: {
            beneficiarioId,
            magazzinoEmporioId,
            dataOraInizio: dataOraInizio.toISOString(),
          },
        });
      });
    } catch (error) {
      if (error instanceof SpesaAccessoError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (databaseErrorCode(error) === "23505") {
        res.status(409).json({ error: MSG_DUPLICATO });
        return;
      }
      throw error;
    }
    const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
    res.json(formatAccesso(rows[0]));
  },
);

router.patch(
  "/accessi-emporio/:id/stato",
  requirePermission("emporio.access.manage"),
  async (req, res) => {
    if (!(await assertEmporioEnabled(res))) return;
    const id = Number(req.params.id);
    const stato = req.body?.statoAccessoEmporio ?? req.body?.stato;
    if (!isStatoAccesso(stato)) {
      res.status(400).json({ error: "Stato Accesso Emporio non valido." });
      return;
    }
    const [existing] = await db
      .select()
      .from(consegneTable)
      .where(
        and(
          eq(consegneTable.id, id),
          eq(consegneTable.tipoPianificazione, TIPO_ACCESSO),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: MSG_ACCESSO_NON_TROVATO });
      return;
    }
    if (!(await canAccessAccessoEmporio(existing, req))) {
      res.status(403).json({ error: MSG_RISORSA_NON_ACCESSIBILE });
      return;
    }
    const motivoAnnullamento = asText(req.body?.motivoAnnullamento);
    if (stato === "annullato" && !motivoAnnullamento) {
      res.status(400).json({ error: "Il motivo annullamento è obbligatorio." });
      return;
    }
    try {
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT id FROM ${consegneTable} WHERE ${consegneTable.id} = ${id} FOR UPDATE`,
        );
        const [locked] = await tx
          .select()
          .from(consegneTable)
          .where(eq(consegneTable.id, id));
        if (!locked) throw new SpesaAccessoError(404, MSG_ACCESSO_NON_TROVATO);
        if (!(await canAccessAccessoEmporio(locked, req)))
          throw new SpesaAccessoError(403, MSG_RISORSA_NON_ACCESSIBILE);
        const current = locked.statoAccessoEmporio as StatoAccesso;
        if (
          stato !== current &&
          !ACCESS_TRANSITIONS[current]?.includes(stato)
        ) {
          throw new SpesaAccessoError(
            409,
            `Transizione Accesso Emporio non consentita: ${current} → ${stato}.`,
          );
        }
        await tx
          .update(consegneTable)
          .set({
            statoAccessoEmporio: stato,
            stato: statoConsegnaFromAccesso(stato),
            motivoAnnullamento:
              stato === "annullato"
                ? motivoAnnullamento
                : locked.motivoAnnullamento,
          })
          .where(eq(consegneTable.id, id));
        if (stato !== current) {
          await auditEmporioTx(tx, {
            entityType: "accesso",
            entityId: id,
            action: "cambio-stato",
            operatoreId: req.user?.id,
            ip: req.ip,
            motivo: motivoAnnullamento,
            before: { stato: current },
            after: { stato },
          });
        }
      });
    } catch (error) {
      if (error instanceof SpesaAccessoError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    const rows = await selectAccessi([eq(consegneTable.id, id)]).limit(1);
    res.json(formatAccesso(rows[0]));
  },
);

export default router;
