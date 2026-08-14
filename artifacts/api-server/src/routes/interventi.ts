import { Router, type IRouter, type Request } from "express";
import {
  beneficiariTable,
  bisogniPianificatiTable,
  db,
  interventiTable,
  utentiTable,
  type BisognoPianificato,
} from "@workspace/db";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
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
  canUseBeneficiario,
} from "../lib/centroScope";

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

function isDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function oggiEuropeRome(referenceDate = new Date()): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Rome",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(referenceDate)
      .map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
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
) {
  return {
    id: row.id,
    beneficiarioId: row.beneficiarioId,
    beneficiarioNome,
    bollaId: row.bollaId ?? null,
    operatoreId: row.operatoreId ?? null,
    operatoreCodice,
    dataIntervento: row.dataIntervento,
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
    dataCreazione: row.dataCreazione.toISOString(),
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

async function canUseUdsBeneficiarioInCallerCitta(
  beneficiarioId: number,
  req: Request,
): Promise<boolean> {
  const cittaId = callerCittaId(req);
  if (cittaId == null || !Number.isInteger(beneficiarioId)) return false;
  const [beneficiario] = await db
    .select({ uds: beneficiariTable.uds, cittaId: beneficiariTable.cittaId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId))
    .limit(1);
  return beneficiario?.uds === true && beneficiario.cittaId === cittaId;
}

async function canManageBisogniForBeneficiario(
  beneficiarioId: number,
  req: Request,
): Promise<boolean> {
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
  if (result.uds !== true || result.cittaId == null) {
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

router.get("/interventi", async (req, res) => {
  const { beneficiarioId, tipo, centroAscoltoId, cittaId, bisogni } =
    req.query as Record<string, string>;
  const conditions: SQL[] = [];
  const requestedBeneficiarioId = beneficiarioId
    ? parsePositiveInteger(beneficiarioId)
    : null;
  if (beneficiarioId && requestedBeneficiarioId == null) {
    res.status(400).json({ error: "beneficiarioId non valido" });
    return;
  }
  if (requestedBeneficiarioId != null) {
    conditions.push(eq(interventiTable.beneficiarioId, requestedBeneficiarioId));
  }
  const udsBeneficiarioInCallerCitta =
    requestedBeneficiarioId != null &&
    (await canUseUdsBeneficiarioInCallerCitta(requestedBeneficiarioId, req));
  const caller = callerCentroId(req);
  if (!udsBeneficiarioInCallerCitta && caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (!udsBeneficiarioInCallerCitta && centroAscoltoId) {
    const parsedCentro = parsePositiveInteger(centroAscoltoId);
    if (parsedCentro == null) {
      res.status(400).json({ error: "centroAscoltoId non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.centroAscoltoId, parsedCentro));
  }
  const callerCitta = callerCittaId(req);
  if (callerCitta == null && cittaId) {
    const parsedCitta = parsePositiveInteger(cittaId);
    if (parsedCitta == null) {
      res.status(400).json({ error: "cittaId non valido" });
      return;
    }
    conditions.push(eq(beneficiariTable.cittaId, parsedCitta));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCitta);
  if (cittaFilter) conditions.push(cittaFilter);
  if (!udsBeneficiarioInCallerCitta) {
    const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
    if (zonaFilter) conditions.push(zonaFilter);
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

  const rows = await db
    .select({
      i: interventiTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(interventiTable)
    .leftJoin(beneficiariTable, eq(interventiTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(utentiTable, eq(interventiTable.operatoreId, utentiTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(interventiTable.dataIntervento))
    .limit(200);

  const summaries = await summariesFor(rows.map((row) => row.i.id));
  res.json(
    rows.map((row) =>
      formatIntervento(
        row.i,
        summaries.get(row.i.id) ?? emptySummary(),
        row.cognome && row.nome ? `${row.cognome} ${row.nome}` : null,
        row.operatoreMatricola ?? row.operatoreUsername ?? null,
      ),
    ),
  );
});

router.post("/interventi", async (req, res) => {
  const body = req.body as Record<string, unknown>;
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
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  const canUseUdsInCitta = await canUseUdsBeneficiarioInCallerCitta(
    beneficiarioId,
    req,
  );
  if (
    (caller != null || cid != null || zid != null) &&
    !canUseUdsInCitta &&
    !(await canUseBeneficiario(beneficiarioId, caller, cid, zid))
  ) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if (
    normalizedBisogni.length > 0 &&
    !(await canManageBisogniForBeneficiario(beneficiarioId, req))
  ) {
    res
      .status(403)
      .json({
        error:
          "I Bisogni Pianificati richiedono una persona UDS con città accessibile",
      });
    return;
  }

  const { intervento, bisogniCreati } = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(interventiTable)
      .values({
        ...cleanInterventoBody(body),
        beneficiarioId,
        operatoreId: req.user!.id,
      } as never)
      .returning();
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
  const [row] = await db
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const canUseUdsInCitta = await canUseUdsBeneficiarioInCallerCitta(
    row.beneficiarioId,
    req,
  );
  if (
    !canUseUdsInCitta &&
    (!canAccessCentro(
      await beneficiarioCentroId(row.beneficiarioId),
      callerCentroId(req),
    ) ||
      !canAccessCitta(
        await beneficiarioCittaId(row.beneficiarioId),
        callerCittaId(req),
      ) ||
      !canAccessZonaUds(
        await beneficiarioZonaUdsId(row.beneficiarioId),
        callerZonaUdsId(req),
      ))
  ) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const needs = await orderedBisogni([row.id]);
  res.json(formatIntervento(row, summarizeBisogni(needs)));
});

router.patch("/interventi/:id", async (req, res) => {
  const id = parsePositiveInteger(req.params.id);
  if (id == null) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const [existing] = await db
    .select()
    .from(interventiTable)
    .where(eq(interventiTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const bisogniInput = body.bisogniPianificati;
  if (bisogniInput != null && !Array.isArray(bisogniInput)) {
    res.status(400).json({ error: "Bisogni Pianificati non validi" });
    return;
  }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  const canUseExistingUdsInCitta = await canUseUdsBeneficiarioInCallerCitta(existing.beneficiarioId, req);
  if (!canUseExistingUdsInCitta && (!canAccessCentro(await beneficiarioCentroId(existing.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(existing.beneficiarioId), cid)
      || !canAccessZonaUds(await beneficiarioZonaUdsId(existing.beneficiarioId), zid))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
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
  const canUseTargetUdsInCitta =
    body.beneficiarioId != null &&
    (await canUseUdsBeneficiarioInCallerCitta(targetBeneficiarioId, req));
  if (
    (caller != null || cid != null || zid != null) &&
    targetBeneficiarioId !== existing.beneficiarioId &&
    !canUseTargetUdsInCitta &&
    !(await canUseBeneficiario(targetBeneficiarioId, caller, cid, zid))
  ) {
    res
      .status(403)
      .json({ error: "Beneficiario non accessibile per il tuo centro" });
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

  try {
    const row = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(interventiTable)
        .set({
          ...cleanInterventoBody(body),
          beneficiarioId: targetBeneficiarioId,
          operatoreId: req.user!.id,
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

router.get(
  "/interventi/:interventoId/bisogni-pianificati",
  async (req, res) => {
    const interventoId = parsePositiveInteger(req.params.interventoId);
    if (interventoId == null) {
      res.status(400).json({ error: "interventoId non valido" });
      return;
    }
    try {
      await requireManageableUdsIntervento(interventoId, req);
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
