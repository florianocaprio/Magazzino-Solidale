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
} from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, and, ne, getTableColumns, desc, ilike, or, sql } from "drizzle-orm";
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

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));

type VolontarioRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
  ruoloCatalogoNome: string | null;
};

const fmt = (r: VolontarioRow) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  matricola: r.matricola ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  ruolo: r.ruolo,
  ruoloVolontarioId: r.ruoloVolontarioId ?? null,
  ruoloCatalogoNome: r.ruoloCatalogoNome ?? null,
  patente: r.patente,
  mezzoPersonale: r.mezzoPersonale,
  maxConsegneTurno: r.maxConsegneTurno,
  attivo: r.attivo,
  statoApprovazione: r.statoApprovazione,
  note: r.note ?? null,
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
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(ruoliVolontariTable, eq(volontariTable.ruoloVolontarioId, ruoliVolontariTable.id));

router.get("/volontari", requirePermission("logistica.volontari.view"), async (req, res) => {
  const caller = callerCentroId(req);
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  let requestedCentroScope: ReturnType<typeof centroScopeFilter>;
  let searchScope: ReturnType<typeof or>;
  if (req.query.centroAscoltoId != null) {
    const requestedCentroId = Number(req.query.centroAscoltoId);
    if (!Number.isInteger(requestedCentroId) || requestedCentroId <= 0) {
      res.status(400).json({ error: "centroAscoltoId non valido" });
      return;
    }
    if (!canAccessCentro(requestedCentroId, caller) || !inVisibleCentroSet(requestedCentroId, areaOperativaCentroIds)) {
      res.status(403).json({ error: "Centro non accessibile per il tuo perimetro" });
      return;
    }
    requestedCentroScope = centroScopeFilter(volontariTable.centroAscoltoId, requestedCentroId);
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
  if (search) {
    const pattern = `%${search}%`;
    searchScope = or(
      ilike(volontariTable.nome, pattern),
      ilike(volontariTable.cognome, pattern),
      ilike(volontariTable.matricola, pattern),
    );
  }
  const rows = await selectVolontario()
    .where(
      andScoped(
        centroScopeFilter(volontariTable.centroAscoltoId, caller),
        idSetScopeFilter(volontariTable.centroAscoltoId, areaOperativaCentroIds),
        requestedCentroScope,
        searchScope,
      ),
    )
    .orderBy(desc(volontariTable.id));
  res.json(rows.map(fmt));
});

async function createVolontarioOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ id: number } | (MatricolaDuplicataPayload & { status?: number })> {
  const caller = callerCentroId(req);
  const values = { ...body };
  const matricola = normalizeVolontarioMatricola(values.matricola);
  if (!matricola) return { error: MATRICOLA_OBBLIGATORIA_MSG, status: 400 };
  values.matricola = matricola;
  const areaId = callerAreaOperativaId(req);
  const visibleIds = await visibleCentroIds(areaId);
  if (caller != null) values.centroAscoltoId = caller;
  else if (areaId != null && values.centroAscoltoId == null) {
    return { error: "Seleziona un Centro della tua Area Operativa", status: 400 };
  } else if (
    values.centroAscoltoId != null &&
    !inVisibleCentroSet(values.centroAscoltoId as number, visibleIds)
  ) {
    return { error: "Centro non accessibile per la tua area operativa", status: 403 };
  }
  const ruoloVolontarioId = Number(values.ruoloVolontarioId);
  if (!Number.isInteger(ruoloVolontarioId) || ruoloVolontarioId <= 0) {
    return { error: "ruoloVolontarioId obbligatorio", status: 400 };
  }
  const [ruolo] = await db
    .select({ id: ruoliVolontariTable.id, nome: ruoliVolontariTable.nome })
    .from(ruoliVolontariTable)
    .where(and(eq(ruoliVolontariTable.id, ruoloVolontarioId), eq(ruoliVolontariTable.attivo, true)));
  if (!ruolo) return { error: "Ruolo volontario non attivo o non valido", status: 400 };
  const maxConsegneTurno = Number(values.maxConsegneTurno ?? 5);
  if (!Number.isInteger(maxConsegneTurno) || maxConsegneTurno < 0) {
    return { error: "maxConsegneTurno deve essere maggiore o uguale a zero", status: 400 };
  }
  values.ruoloVolontarioId = ruolo.id;
  values.ruolo = ruolo.nome;
  values.maxConsegneTurno = maxConsegneTurno;
  values.statoApprovazione = "in_attesa";
  values.attivo = false;
  delete values.versione;
  delete values.dataAggiornamento;
  if (await matricolaVolontarioGiaUsata(matricola)) {
    return { ...(await matricolaVolontarioDuplicataPayload(matricola)), status: 409 };
  }
  try {
    const [created] = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(volontariTable)
        .values(values as typeof volontariTable.$inferInsert)
        .returning({ id: volontariTable.id, versione: volontariTable.versione });
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: row.id,
        azione: "creazione",
        nuovo: { statoApprovazione: "in_attesa", attivo: false, versione: row.versione },
      });
      return [row];
    });
    return { id: created.id };
  } catch (e) {
    if (isVolontarioMatricolaUniqueViolation(e)) {
      return { ...(await matricolaVolontarioDuplicataPayload(matricola)), status: 409 };
    }
    throw e;
  }
}

router.post("/volontari", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const r = await createVolontarioOne(req.body, req);
  if ("error" in r) {
    res.status(r.status ?? 403).json({
      error: r.error,
      ...(r.matricolaSuggerita ? { matricolaSuggerita: r.matricolaSuggerita } : {}),
    });
    return;
  }
  const [row] = await selectVolontario().where(eq(volontariTable.id, r.id));
  res.status(201).json(fmt(row));
});

router.post("/volontari/bulk", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createVolontarioOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

// Carico per volontario nello slot canonico data+fascia. Conta solo le consegne
// ancora operative; le bolle non costituiscono una seconda unità di carico.
router.get("/volontari/carico", requirePermission("logistica.volontari.view"), async (req, res) => {
  const { data, fascia, excludeConsegnaId } = req.query as Record<string, string>;
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    res.status(400).json({ error: "Parametro 'data' non valido (formato atteso: YYYY-MM-DD)" });
    return;
  }
  if (!isFasciaTurno(fascia)) {
    res.status(400).json({ error: "Parametro 'fascia' non valido" });
    return;
  }
  const exclConsegna = excludeConsegnaId != null ? parseInt(excludeConsegnaId) : NaN;
  const counts = new Map<number, number>();

  // Il conteggio dello slot resta globale tra i centri: una risorsa condivisa
  // non può superare il proprio limite data+fascia distribuendo le consegne.
  const consegneConds = [
    eq(consegneTable.dataPrevista, data),
    ne(consegneTable.stato, "annullata"),
    eq(fasciaTurnoConsegnaSql(), fascia),
  ];
  if (Number.isInteger(exclConsegna)) consegneConds.push(ne(consegneTable.id, exclConsegna));
  const cons = await db
    .select({ volontarioId: consegneTable.volontarioId })
    .from(consegneTable)
    .where(and(...consegneConds));
  for (const r of cons) {
    if (r.volontarioId != null) counts.set(r.volontarioId, (counts.get(r.volontarioId) ?? 0) + 1);
  }

  // Le RIGHE restituite sono però limitate ai volontari visibili al chiamante
  // (confine centro + area operativa HARD): il conteggio resta globale, ma non si espone
  // l'attività di volontari fuori perimetro.
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  const visibili = await db
    .select({ id: volontariTable.id })
    .from(volontariTable)
    .where(
      andScoped(
        centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
        idSetScopeFilter(volontariTable.centroAscoltoId, areaOperativaCentroIds),
      ),
    );
  const visibileSet = new Set(visibili.map((v) => v.id));

  res.json(
    [...counts.entries()]
      .filter(([volontarioId]) => visibileSet.has(volontarioId))
      .map(([volontarioId, count]) => ({ volontarioId, count })),
  );
});

router.get("/volontari/:id", requirePermission("logistica.volontari.view"), async (req, res) => {
  const [row] = await selectVolontario().where(eq(volontariTable.id, parseInt(String(req.params.id))));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(row.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  res.json(fmt(row));
});

router.patch("/volontari/:id", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(String(req.params.id))));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  const updates = { ...req.body };
  delete updates.versione;
  delete updates.statoApprovazione;
  delete updates.dataCreazione;
  delete updates.dataAggiornamento;
  if ("matricola" in updates) {
    const matricola = normalizeVolontarioMatricola(updates.matricola);
    if (!matricola) { res.status(400).json({ error: MATRICOLA_OBBLIGATORIA_MSG }); return; }
    if (await matricolaVolontarioGiaUsata(matricola, existing.id)) {
      res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola, existing.id));
      return;
    }
    updates.matricola = matricola;
  }
  const areaId = callerAreaOperativaId(req);
  if (caller != null) delete updates.centroAscoltoId;
  else if (updates.centroAscoltoId !== undefined) {
    if (areaId != null && updates.centroAscoltoId == null) {
      res.status(400).json({ error: "Seleziona un Centro della tua Area Operativa" });
      return;
    }
    if (!inVisibleCentroSet(updates.centroAscoltoId, await visibleCentroIds(areaId))) {
      res.status(403).json({ error: "Centro non accessibile per la tua area operativa" });
      return;
    }
  }
  if (updates.attivo === true && existing.statoApprovazione !== "approvato") {
    res.status(409).json({ error: "La risorsa deve essere approvata prima dell'attivazione" });
    return;
  }
  if (updates.ruoloVolontarioId !== undefined) {
    const ruoloId = Number(updates.ruoloVolontarioId);
    const [ruolo] = Number.isInteger(ruoloId) ? await db
      .select({ id: ruoliVolontariTable.id, nome: ruoliVolontariTable.nome })
      .from(ruoliVolontariTable)
      .where(and(eq(ruoliVolontariTable.id, ruoloId), eq(ruoliVolontariTable.attivo, true))) : [];
    if (!ruolo) { res.status(400).json({ error: "Ruolo volontario non attivo o non valido" }); return; }
    updates.ruoloVolontarioId = ruolo.id;
    updates.ruolo = ruolo.nome;
  } else {
    delete updates.ruolo;
  }
  if (updates.maxConsegneTurno !== undefined) {
    const max = Number(updates.maxConsegneTurno);
    if (!Number.isInteger(max) || max < 0) {
      res.status(400).json({ error: "maxConsegneTurno deve essere maggiore o uguale a zero" });
      return;
    }
    updates.maxConsegneTurno = max;
  }
  try {
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx.update(volontariTable).set({
        ...updates,
        versione: sql`${volontariTable.versione} + 1`,
        dataAggiornamento: new Date(),
      }).where(and(eq(volontariTable.id, existing.id), eq(volontariTable.versione, versione))).returning({ id: volontariTable.id, versione: volontariTable.versione });
      if (!row) throw new Error("STALE_VERSION");
      await auditLogistica(tx, req, {
        entita: "volontario",
        id: row.id,
        azione: updates.attivo === true ? "attivazione" : updates.attivo === false ? "disattivazione" : "modifica",
        precedente: { versione: existing.versione, attivo: existing.attivo },
        nuovo: { versione: row.versione, attivo: updates.attivo ?? existing.attivo },
      });
      return [row];
    });
    const [row] = await selectVolontario().where(eq(volontariTable.id, updated.id));
    res.json(fmt(row));
  } catch (e) {
    if (e instanceof Error && e.message === "STALE_VERSION") {
      res.status(409).json({ error: "La risorsa è stata aggiornata da un altro operatore" });
      return;
    }
    if (isVolontarioMatricolaUniqueViolation(e)) {
      const matricola = normalizeVolontarioMatricola(updates.matricola) ?? existing.matricola ?? "";
      res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola, existing.id));
      return;
    }
    throw e;
  }
});

router.delete("/volontari/:id", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const caller = callerCentroId(req);
  const id = parseInt(String(req.params.id));
  const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(volontariTable).where(eq(volontariTable.id, id)).for("update");
    if (!existing) return { status: 204 as const };
    if (!canAccessCentro(existing.centroAscoltoId, caller) || !inVisibleCentroSet(existing.centroAscoltoId, visibleIds)) return { status: 403 as const };
    const versione = parseRequiredVersion(req.body?.versione);
    if (versione == null) return { status: 400 as const };
    const [row] = await tx.update(volontariTable).set({ attivo: false, versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date() })
      .where(and(eq(volontariTable.id, id), eq(volontariTable.versione, versione)))
      .returning({ id: volontariTable.id, versione: volontariTable.versione });
    if (!row) return { status: 409 as const };
    await auditLogistica(tx, req, { entita: "volontario", id: row.id, azione: "disattivazione", precedente: { versione: existing.versione, attivo: existing.attivo }, nuovo: { versione: row.versione, attivo: false } });
    return { status: 200 as const, versione: row.versione };
  });
  if (result.status === 204) { res.status(204).send(); return; }
  if (result.status === 403) { res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" }); return; }
  if (result.status === 400) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  if (result.status === 409) { res.status(409).json({ error: "La risorsa è stata aggiornata da un altro operatore" }); return; }
  res.status(200).json({ disattivato: true, versione: result.versione });
});

export default router;
