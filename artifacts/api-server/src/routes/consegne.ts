import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  consegneTable,
  beneficiariTable,
  magazziniTable,
  volontariTable,
  bolleTable,
  centriAscoltoTable,
} from "@workspace/db";
import { eq, and, or, gte, lte, desc, inArray, isNull, isNotNull, ilike, sql, type SQL } from "drizzle-orm";
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
  canUseBeneficiario,
  canAccessMagazzino,
} from "../lib/centroScope";
import { sendEmail } from "../lib/emailService";
import { buildIcs } from "../lib/ics";
import { completeBollaDelivery, handleBollaActionError } from "../lib/bollaDelivery";
import { requireAllModuli } from "../lib/featureFlags";
import {
  ConsegnaPlanningError,
  validateConsegnaPlanningTx,
} from "../lib/consegneTurni";
import {
  lockConsegnaPlanningContextTx,
  reconcileConsegnaPlanningTx,
} from "../lib/consegneReconciliation";
import {
  isPlanningConcurrencyError,
  PLANNING_CONCURRENCY_MESSAGE,
} from "../lib/logisticaPolicy";
import {
  beneficiarioAccessScopeFromRequest,
  isBeneficiarioActive,
} from "../lib/beneficiarioPolicy";
import { requirePermission } from "../middlewares/auth";

const TIPO_CONSEGNA_PACCO = "consegna_pacco";

const router: IRouter = Router();

router.use("/consegne", requireAllModuli(["CENTRO_ASCOLTO", "CONSEGNE"]));

function handlePlanningError(error: unknown, res: Response): boolean {
  if (isPlanningConcurrencyError(error)) {
    res.status(409).json({ error: PLANNING_CONCURRENCY_MESSAGE });
    return true;
  }
  if (error instanceof ConsegnaPlanningError) {
    res.status(error.status).json({ error: error.message });
    return true;
  }
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 6; depth += 1) {
    if (typeof current === "object" && (current as { code?: string }).code === "23505") {
      res.status(409).json({ error: "La pianificazione è in conflitto con un'altra operazione" });
      return true;
    }
    current = typeof current === "object" ? (current as { cause?: unknown }).cause : undefined;
  }
  return false;
}

// priorità con cui scegliere la bolla "rappresentativa" di una consegna quando
// ce ne fosse più d'una collegata (le annullate sono ignorate del tutto)
const BOLLA_PRIORITA: Record<string, number> = { consegnato: 3, confermato: 2, bozza: 1 };

function normalizeText(v: unknown): string | null {
  if (typeof v !== "string") return v == null ? null : String(v).trim() || null;
  return v.trim() || null;
}

function normalizeConsegnaPayload(raw: Record<string, any>) {
  const body = { ...raw };
  body.tipoPianificazione = TIPO_CONSEGNA_PACCO;
  delete body.magazzinoEmporioId;
  delete body.dataOraInizio;
  delete body.dataOraFine;
  delete body.statoAccessoEmporio;
  delete body.motivoAnnullamento;
  delete body.noteAccessoEmporio;
  if ("indirizzoConsegna" in body) {
    body.indirizzoConsegna = typeof body.indirizzoConsegna === "string"
      ? body.indirizzoConsegna.trim() || null
      : body.indirizzoConsegna;
  }
  if ("volontarioAltro" in body) {
    body.volontarioAltro = normalizeText(body.volontarioAltro);
    if (body.volontarioAltro) body.volontarioId = null;
  }
  return body;
}

function assertConsegnaAddress(input: { tipoConsegna?: unknown; indirizzoConsegna?: unknown }): void {
  if (input.tipoConsegna !== "domicilio") return;
  if (
    typeof input.indirizzoConsegna !== "string"
    || input.indirizzoConsegna.trim().length === 0
    || input.indirizzoConsegna.trim().length > 200
  ) {
    throw new ConsegnaPlanningError(
      400,
      "Per una consegna a domicilio è obbligatorio un indirizzo valido (massimo 200 caratteri)",
    );
  }
}

async function canAccessConsegna(
  req: Request,
  consegna: typeof consegneTable.$inferSelect,
): Promise<boolean> {
  const [beneficiario] = await db
    .select({
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      areaOperativaId: beneficiariTable.areaOperativaId,
      zonaUdsId: beneficiariTable.zonaUdsId,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, consegna.beneficiarioId));
  if (!beneficiario) return false;

  // Le consegne concluse mantengono lo scope storico registrato al momento
  // del completamento; i record legacy senza snapshot usano il fallback
  // esplicito all'anagrafica corrente. La Zona non ha uno snapshot dedicato.
  const terminale = consegna.stato === "effettuata";
  const centroId = terminale
    ? (consegna.centroAscoltoIdSnapshot ?? beneficiario.centroAscoltoId)
    : beneficiario.centroAscoltoId;
  const areaId = terminale
    ? (consegna.areaOperativaIdSnapshot ?? beneficiario.areaOperativaId)
    : beneficiario.areaOperativaId;

  return canAccessCentro(centroId, callerCentroId(req))
    && canAccessAreaOperativa(areaId, callerAreaOperativaId(req))
    && canAccessZonaUds(beneficiario.zonaUdsId, callerZonaUdsId(req));
}

/** Ritorna, per ogni consegnaId, la bolla collegata più rilevante (non annullata). */
async function bollePerConsegne(consegnaIds: number[]) {
  const map = new Map<number, { id: number; numeroBolla: string; stato: string }>();
  if (consegnaIds.length === 0) return map;
  const rows = await db
    .select({ id: bolleTable.id, numeroBolla: bolleTable.numeroBolla, stato: bolleTable.stato, consegnaId: bolleTable.consegnaId })
    .from(bolleTable)
    .where(inArray(bolleTable.consegnaId, consegnaIds));
  for (const r of rows) {
    if (r.consegnaId == null || r.stato === "annullato") continue;
    const current = map.get(r.consegnaId);
    if (!current || (BOLLA_PRIORITA[r.stato] ?? 0) > (BOLLA_PRIORITA[current.stato] ?? 0)) {
      map.set(r.consegnaId, { id: r.id, numeroBolla: r.numeroBolla, stato: r.stato });
    }
  }
  return map;
}

type ConsegneListOptions = { page: number; pageSize: number } | null;

function historicalScopeFilter(
  snapshotColumn: Parameters<typeof isNull>[0],
  snapshotScope: SQL | undefined,
  currentScope: SQL | undefined,
): SQL | undefined {
  if (!snapshotScope || !currentScope) return undefined;
  return or(
    and(
      eq(consegneTable.stato, "effettuata"),
      or(
        and(isNotNull(snapshotColumn), snapshotScope),
        and(isNull(snapshotColumn), currentScope),
      ),
    ),
    and(sql`${consegneTable.stato} <> 'effettuata'`, currentScope),
  );
}

function selectedCentroFilter(centroAscoltoId: number): SQL {
  return or(
    and(
      eq(consegneTable.stato, "effettuata"),
      or(
        eq(consegneTable.centroAscoltoIdSnapshot, centroAscoltoId),
        and(
          isNull(consegneTable.centroAscoltoIdSnapshot),
          eq(beneficiariTable.centroAscoltoId, centroAscoltoId),
        ),
      ),
    ),
    and(
      sql`${consegneTable.stato} <> 'effettuata'`,
      eq(beneficiariTable.centroAscoltoId, centroAscoltoId),
    ),
  )!;
}

function listConditions(req: Request): SQL[] | null {
  const {
    stato,
    data,
    dataInizio,
    dataFine,
    beneficiarioId,
    centroAscoltoId,
    q,
  } = req.query as Record<string, string>;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  for (const [name, val] of [["data", data], ["dataInizio", dataInizio], ["dataFine", dataFine]] as const) {
    if (val && !dateRe.test(val)) {
      return null;
    }
  }
  const conditions: SQL[] = [];
  conditions.push(eq(consegneTable.tipoPianificazione, TIPO_CONSEGNA_PACCO));
  if (stato) conditions.push(eq(consegneTable.stato, stato));
  if (data) conditions.push(eq(consegneTable.dataPrevista, data));
  if (dataInizio) conditions.push(gte(consegneTable.dataPrevista, dataInizio));
  if (dataFine) conditions.push(lte(consegneTable.dataPrevista, dataFine));
  if (beneficiarioId) {
    const id = Number(beneficiarioId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    conditions.push(eq(consegneTable.beneficiarioId, id));
  }
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = historicalScopeFilter(
      consegneTable.centroAscoltoIdSnapshot,
      centroScopeFilter(consegneTable.centroAscoltoIdSnapshot, caller),
      centroScopeFilter(beneficiariTable.centroAscoltoId, caller),
    );
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    const id = Number(centroAscoltoId);
    if (!Number.isSafeInteger(id) || id < 1) return null;
    conditions.push(selectedCentroFilter(id));
  }
  const areaOperativaFilter = historicalScopeFilter(
    consegneTable.areaOperativaIdSnapshot,
    areaOperativaScopeFilter(consegneTable.areaOperativaIdSnapshot, callerAreaOperativaId(req)),
    areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req)),
  );
  if (areaOperativaFilter) conditions.push(areaOperativaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);
  const search = q?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(
      ilike(consegneTable.codice, pattern),
      ilike(beneficiariTable.cognome, pattern),
      ilike(beneficiariTable.nome, pattern),
      ilike(consegneTable.indirizzoConsegna, pattern),
    )!);
  }
  return conditions;
}

async function loadConsegne(req: Request, options: ConsegneListOptions) {
  const conditions = listConditions(req);
  if (!conditions) return null;
  const where = and(...conditions);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .where(where);

  let query = db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(where)
    .orderBy(desc(consegneTable.dataCreazione), desc(consegneTable.id));
  if (options) {
    query = query.limit(options.pageSize).offset((options.page - 1) * options.pageSize) as typeof query;
  }
  const rows = await query;

  const bolle = await bollePerConsegne(rows.map(r => r.c.id));
  const effectiveCentroIds = [...new Set(rows.map((r) =>
    r.c.stato === "effettuata" && r.c.centroAscoltoIdSnapshot != null
      ? r.c.centroAscoltoIdSnapshot
      : r.centroAscoltoId,
  ).filter((id): id is number => id != null))];
  const effectiveCentri = effectiveCentroIds.length === 0
    ? []
    : await db.select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome })
        .from(centriAscoltoTable)
        .where(inArray(centriAscoltoTable.id, effectiveCentroIds));
  const centroNames = new Map(effectiveCentri.map((centro) => [centro.id, centro.nome]));

  const items = rows.map(r => {
    const bolla = bolle.get(r.c.id) ?? null;
    const effectiveCentroId = r.c.stato === "effettuata" && r.c.centroAscoltoIdSnapshot != null
      ? r.c.centroAscoltoIdSnapshot
      : r.centroAscoltoId;
    return {
      id: r.c.id,
      codice: r.c.codice,
      beneficiarioId: r.c.beneficiarioId,
      beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
      tipoPianificazione: r.c.tipoPianificazione,
      tipoConsegna: r.c.tipoConsegna,
      dataPrevista: r.c.dataPrevista,
      fasciaOraria: r.c.fasciaOraria ?? null,
      indirizzoConsegna: r.c.indirizzoConsegna ?? null,
      zona: r.c.zona ?? null,
      magazzinoId: r.c.magazzinoId,
      magazzinoNome: r.magazzinoNome ?? null,
      centroAscoltoId: effectiveCentroId ?? null,
      centroAscoltoNome: effectiveCentroId == null ? null : (centroNames.get(effectiveCentroId) ?? null),
      volontarioId: r.c.volontarioId ?? null,
      volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
      volontarioAltro: r.c.volontarioAltro ?? null,
      mezzoId: r.c.mezzoId ?? null,
      mezzoAltro: r.c.mezzoAltro ?? false,
      stato: r.c.stato,
      bollaId: bolla?.id ?? null,
      bollaNumero: bolla?.numeroBolla ?? null,
      bollaStato: bolla?.stato ?? null,
      noteOperative: r.c.noteOperative ?? null,
      dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
      dataCreazione: r.c.dataCreazione.toISOString(),
    };
  });
  return { items, total: Number(total) };
}

router.get("/consegne", requirePermission("consegne.view"), async (req, res) => {
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const pageSize = req.query.pageSize == null ? 25 : Number(req.query.pageSize);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e pageSize tra 1 e 100" });
    return;
  }
  const result = await loadConsegne(req, { page, pageSize });
  if (!result) {
    res.status(400).json({ error: "Filtri Consegne non validi" });
    return;
  }
  res.json({
    items: result.items,
    page,
    pageSize,
    total: result.total,
    totalPages: Math.ceil(result.total / pageSize),
  });
});

router.get("/consegne/export", requirePermission("consegne.export"), async (req, res) => {
  const result = await loadConsegne(req, null);
  if (!result) {
    res.status(400).json({ error: "Filtri Consegne non validi" });
    return;
  }
  res.json({ items: result.items, total: result.total });
});

router.post("/consegne", requirePermission("consegne.manage"), async (req, res) => {
  const body = normalizeConsegnaPayload(req.body);
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  if (body.volontarioId != null && body.volontarioAltro) {
    res.status(400).json({ error: "Indicare un volontario censito oppure Altro, non entrambi" });
    return;
  }
  if ((caller != null || cid != null || zid != null) && !(await canUseBeneficiario(body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if (!(await isBeneficiarioActive(body.beneficiarioId))) {
    res.status(400).json({ error: "Il Beneficiario deve essere attivo per creare una nuova Consegna." });
    return;
  }
  if ((caller != null || cid != null) && body.magazzinoId != null
      && !(await canAccessMagazzino(body.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const codice = `CON-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  try {
    const row = await db.transaction(async (tx) => {
      assertConsegnaAddress(body);
      const planningInput = {
        beneficiarioId: Number(body.beneficiarioId),
        dataPrevista: String(body.dataPrevista),
        fasciaOraria: body.fasciaOraria ?? null,
        volontarioId: body.volontarioId ?? null,
        mezzoId: body.mezzoId ?? null,
        mezzoAltro: Boolean(body.mezzoAltro),
      };
      const planning = await lockConsegnaPlanningContextTx(tx, null, planningInput);
      await validateConsegnaPlanningTx(tx, planningInput, { context: planning.nuovo ?? undefined });
      const [created] = await tx.insert(consegneTable).values({ ...body, codice, tipoPianificazione: TIPO_CONSEGNA_PACCO } as typeof consegneTable.$inferInsert).returning();
      await reconcileConsegnaPlanningTx(tx, null, created, req, planning.nuovo);
      return created;
    });
    res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
  } catch (error) {
    if (handlePlanningError(error, res)) return;
    throw error;
  }
});

router.get("/consegne/:id", requirePermission("consegne.view"), async (req, res) => {
  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (row.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessConsegna(req, row))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/consegne/:id", requirePermission("consegne.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(consegneTable).where(eq(consegneTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const zid = callerZonaUdsId(req);
  if (!(await canAccessConsegna(req, existing))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null || zid != null) && req.body.beneficiarioId != null && req.body.beneficiarioId !== existing.beneficiarioId
      && !(await canUseBeneficiario(req.body.beneficiarioId, caller, cid, zid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && req.body.magazzinoId != null && req.body.magazzinoId !== existing.magazzinoId
      && !(await canAccessMagazzino(req.body.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const body = normalizeConsegnaPayload(req.body);
  const nextVol = body.volontarioId !== undefined ? body.volontarioId : existing.volontarioId;
  const nextAltro = body.volontarioAltro !== undefined ? body.volontarioAltro : existing.volontarioAltro;
  if (nextVol != null && nextAltro) {
    res.status(400).json({ error: "Indicare un volontario censito oppure Altro, non entrambi" });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(consegneTable).where(eq(consegneTable.id, id)).for("update");
      if (!locked) throw new ConsegnaPlanningError(404, "Not found");
      const next = { ...locked, ...body };
      assertConsegnaAddress(next);
      const planning = await lockConsegnaPlanningContextTx(tx, locked, next);
      await validateConsegnaPlanningTx(tx, next, { excludeConsegnaId: id, context: planning.nuovo ?? undefined });
      const [updated] = await tx.update(consegneTable).set(body).where(eq(consegneTable.id, id)).returning();
      await reconcileConsegnaPlanningTx(tx, locked, updated, req, planning.nuovo);
      return updated;
    });
    res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
  } catch (error) {
    if (handlePlanningError(error, res)) return;
    throw error;
  }
});

// ─── ANNULLA (ELIMINA) PIANIFICAZIONE ────────────────────────────────────────
// Annulla un'intera pianificazione di consegna: scollega le eventuali bolle
// (il documento merce resta in archivio) ed elimina la riga consegna.
router.delete("/consegne/:id", requirePermission("consegne.cancel"), async (req, res) => {
  const id = Number(req.params.id);
  const [existing] = await db.select().from(consegneTable).where(eq(consegneTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (existing.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessConsegna(req, existing))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (existing.stato !== "pianificata") {
    res.status(409).json({ error: "Una consegna conclusa non può essere eliminata" });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(consegneTable).where(eq(consegneTable.id, id)).for("update");
      if (!locked) throw new ConsegnaPlanningError(404, "Not found");
      await lockConsegnaPlanningContextTx(tx, locked, null);
      await reconcileConsegnaPlanningTx(tx, locked, null, req);
      await tx.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, id));
      await tx.delete(consegneTable).where(eq(consegneTable.id, id));
    });
    res.status(204).end();
  } catch (error) {
    if (handlePlanningError(error, res)) return;
    throw error;
  }
});

// ─── ASSOCIA / DISSOCIA BOLLA ────────────────────────────────────────────────
// Collega una bolla alla consegna (o la scollega passando bollaId null).
// La "prontezza" della consegna deriva dallo stato della bolla:
//   bozza = in preparazione · confermato = pronta · consegnato = consegnata
router.post("/consegne/:id/associa-bolla", requirePermission("consegne.manage"), async (req, res) => {
  const consegnaId = Number(req.params.id);
  const { bollaId } = req.body ?? {};

  const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!consegna) { res.status(404).json({ error: "Consegna non trovata" }); return; }
  if (consegna.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Consegna non trovata" }); return; }
  if (!(await canAccessConsegna(req, consegna))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  // scollega: rimuovi il legame da tutte le bolle puntate a questa consegna
  if (bollaId == null) {
    await db.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, consegnaId));
    res.json(await dettaglioConsegna(consegnaId));
    return;
  }

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.beneficiarioId !== consegna.beneficiarioId) {
    res.status(400).json({ error: "La bolla appartiene a un altro beneficiario" });
    return;
  }
  if (bolla.stato === "annullato") {
    res.status(400).json({ error: "Non è possibile associare una bolla annullata" });
    return;
  }
  if (bolla.consegnaId != null && bolla.consegnaId !== consegnaId) {
    res.status(400).json({ error: "La bolla è già associata a un'altra consegna" });
    return;
  }
  if (bolla.ritiroNonEffettuatoAt != null && bolla.consegnaId == null) {
    res.status(409).json({
      error: "Per un ritiro non effettuato usa la conversione in consegna domiciliare dalla bolla",
    });
    return;
  }

  // una sola bolla per consegna: scollega le altre, poi collega quella scelta
  await db.update(bolleTable).set({ consegnaId: null }).where(eq(bolleTable.consegnaId, consegnaId));
  await db.update(bolleTable).set({ consegnaId }).where(eq(bolleTable.id, bollaId));

  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.post("/consegne/:id/completa", requirePermission("consegne.complete"), async (req, res) => {
  const consegnaId = Number(req.params.id);

  const [consegna] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!consegna) { res.status(404).json({ error: "Not found" }); return; }
  if (consegna.tipoPianificazione !== TIPO_CONSEGNA_PACCO) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  if (!(await canAccessConsegna(req, consegna))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  // serve una bolla pronta (confermata) o già consegnata, dello stesso beneficiario
  const bolle = await db.select().from(bolleTable).where(eq(bolleTable.consegnaId, consegnaId));
  const bollaPronta = bolle.find(b =>
    (b.stato === "confermato" || b.stato === "consegnato") && b.beneficiarioId === consegna.beneficiarioId
  );
  if (!bollaPronta) {
    res.status(400).json({ error: "Associa prima una bolla pronta: la merce non risulta ancora preparata." });
    return;
  }
  if (!(await canAccessMagazzino(bollaPronta.magazzinoId, caller, cid))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }

  try {
    await completeBollaDelivery({
      bollaId: bollaPronta.id,
      userId: req.user!.id,
      confermaRicezione: true,
      allowAlreadyConsegnata: true,
      beneficiaryAccessScope: beneficiarioAccessScopeFromRequest(req),
    });
  } catch (err) {
    if (handleBollaActionError(err, res)) return;
    throw err;
  }

  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, consegnaId));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

/** Costruisce la rappresentazione della consegna con info bolla (per le risposte delle azioni). */
async function dettaglioConsegna(id: number) {
  const [r] = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      centroAscoltoId: beneficiariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(eq(consegneTable.id, id));
  if (!r) return null;
  const bolla = (await bollePerConsegne([id])).get(id) ?? null;
  return {
    id: r.c.id,
    codice: r.c.codice,
    beneficiarioId: r.c.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    tipoConsegna: r.c.tipoConsegna,
    dataPrevista: r.c.dataPrevista,
    fasciaOraria: r.c.fasciaOraria ?? null,
    indirizzoConsegna: r.c.indirizzoConsegna ?? null,
    zona: r.c.zona ?? null,
    magazzinoId: r.c.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: r.centroAscoltoNome ?? null,
    volontarioId: r.c.volontarioId ?? null,
    volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
    volontarioAltro: r.c.volontarioAltro ?? null,
    mezzoId: r.c.mezzoId ?? null,
    mezzoAltro: r.c.mezzoAltro ?? false,
    stato: r.c.stato,
    bollaId: bolla?.id ?? null,
    bollaNumero: bolla?.numeroBolla ?? null,
    bollaStato: bolla?.stato ?? null,
    noteOperative: r.c.noteOperative ?? null,
    dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
    dataCreazione: r.c.dataCreazione.toISOString(),
  };
}

// ─── REMINDER EMAIL (con ICS) ────────────────────────────────────────────────
type EmailDestinatario = "beneficiario" | "volontario";

async function caricaConsegnaPerEmail(consegnaId: number) {
  const [r] = await db
    .select({
      c: consegneTable,
      benNome: beneficiariTable.nome,
      benCognome: beneficiariTable.cognome,
      benEmail: beneficiariTable.email,
      magazzinoNome: magazziniTable.nome,
      magazzinoIndirizzo: magazziniTable.indirizzo,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
      volEmail: volontariTable.email,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(eq(consegneTable.id, consegnaId));
  return r ?? null;
}

function luogoConsegna(r: NonNullable<Awaited<ReturnType<typeof caricaConsegnaPerEmail>>>): string {
  if (r.c.tipoConsegna === "domicilio") {
    return r.c.indirizzoConsegna?.trim() || "Domicilio del beneficiario";
  }
  return [r.magazzinoNome, r.magazzinoIndirizzo].filter(Boolean).join(" — ") || "Magazzino";
}

async function inviaReminderConsegna(req: import("express").Request, res: import("express").Response, destinatario: EmailDestinatario) {
  const consegnaId = parseInt(req.params.id as string);
  const r = await caricaConsegnaPerEmail(consegnaId);
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await canAccessConsegna(req, r.c))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

  const benNomeCompleto = r.benNome && r.benCognome ? `${r.benCognome} ${r.benNome}` : "il beneficiario";
  const volNomeCompleto = r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null;
  const luogo = luogoConsegna(r);
  const fascia = r.c.fasciaOraria?.trim();
  const dataFmt = r.c.dataPrevista;

  let to: string | null;
  let subject: string;
  let text: string;
  if (destinatario === "beneficiario") {
    to = r.benEmail?.trim() || null;
    if (!to) { res.json({ sent: false, error: "Il beneficiario non ha un indirizzo email" }); return; }
    subject = `Promemoria consegna — ${dataFmt}`;
    text = [
      `Gentile ${benNomeCompleto},`,
      ``,
      `le ricordiamo la consegna prevista per il giorno ${dataFmt}${fascia ? ` (${fascia})` : ""}.`,
      `Luogo: ${luogo}.`,
      ``,
      `In allegato trova l'evento da aggiungere al suo calendario.`,
      ``,
      `Magazzino Solidale AIM`,
    ].join("\n");
  } else {
    to = r.volEmail?.trim() || null;
    if (r.c.volontarioId == null) { res.json({ sent: false, error: "Nessun volontario assegnato a questa consegna" }); return; }
    if (!to) { res.json({ sent: false, error: "Il volontario non ha un indirizzo email" }); return; }
    subject = `Promemoria consegna da effettuare — ${dataFmt}`;
    text = [
      `Ciao ${volNomeCompleto ?? ""},`.trim(),
      ``,
      `ti ricordiamo la consegna assegnata per il giorno ${dataFmt}${fascia ? ` (${fascia})` : ""}.`,
      `Beneficiario: ${benNomeCompleto}.`,
      `Luogo: ${luogo}.`,
      ``,
      `In allegato trovi l'evento da aggiungere al tuo calendario.`,
      ``,
      `Magazzino Solidale AIM`,
    ].join("\n");
  }

  const ics = buildIcs({
    uid: `consegna-${consegnaId}-${destinatario}@magazzino-solidale`,
    date: dataFmt,
    summary: destinatario === "beneficiario" ? "Consegna prevista" : `Consegna a ${benNomeCompleto}`,
    description: fascia ? `Fascia oraria: ${fascia}` : undefined,
    location: luogo,
  });

  try {
    await sendEmail({
      to,
      subject,
      text,
      attachments: [{ filename: "consegna.ics", content: ics, contentType: "text/calendar; charset=utf-8" }],
    });
    res.json({ sent: true, error: null });
  } catch (err) {
    req.log.error({ err }, `Invio email consegna (${destinatario}) fallito`);
    res.json({ sent: false, error: err instanceof Error ? err.message : "Invio fallito" });
  }
}

router.post("/consegne/:id/invia-email-beneficiario", requirePermission("consegne.manage"), (req, res) => inviaReminderConsegna(req, res, "beneficiario"));
router.post("/consegne/:id/invia-email-volontario", requirePermission("consegne.manage"), (req, res) => inviaReminderConsegna(req, res, "volontario"));

export default router;
