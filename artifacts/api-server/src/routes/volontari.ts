import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { volontariTable, centriAscoltoTable, consegneTable, bolleTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, and, ne, isNull, getTableColumns, desc } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  canAccessCentro,
  visibleCentroIds,
  idSetScopeFilter,
  inVisibleCentroSet,
  andScoped,
} from "../lib/centroScope";

const router: IRouter = Router();

type VolontarioRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
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
  patente: r.patente,
  mezzoPersonale: r.mezzoPersonale,
  maxConsegneTurno: r.maxConsegneTurno,
  attivo: r.attivo,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const selectVolontario = () =>
  db
    .select({
      ...getTableColumns(volontariTable),
      centroAscoltoNome: centriAscoltoTable.nome,
    })
    .from(volontariTable)
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id));

router.get("/volontari", async (req, res) => {
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const rows = await selectVolontario()
    .where(
      andScoped(
        centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
        idSetScopeFilter(volontariTable.centroAscoltoId, cittaCentroIds),
      ),
    )
    .orderBy(desc(volontariTable.id));
  res.json(rows.map(fmt));
});

function normalizeMatricola(v: unknown): string | undefined {
  return typeof v === "string" ? v.trim() : undefined;
}

async function createVolontarioOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ id: number } | { error: string }> {
  const caller = callerCentroId(req);
  const values = { ...body };
  const matricola = normalizeMatricola(values.matricola);
  if (!matricola) return { error: "Matricola obbligatoria" };
  values.matricola = matricola;
  if (caller != null) values.centroAscoltoId = caller;
  if (
    caller == null &&
    values.centroAscoltoId != null &&
    !inVisibleCentroSet(values.centroAscoltoId as number, await visibleCentroIds(callerCittaId(req)))
  ) {
    return { error: "Centro non accessibile per la tua città" };
  }
  const [created] = await db
    .insert(volontariTable)
    .values(values as typeof volontariTable.$inferInsert)
    .returning({ id: volontariTable.id });
  return { id: created.id };
}

router.post("/volontari", async (req, res) => {
  const r = await createVolontarioOne(req.body, req);
  if ("error" in r) {
    res.status(r.error === "Matricola obbligatoria" ? 400 : 403).json({ error: r.error });
    return;
  }
  const [row] = await selectVolontario().where(eq(volontariTable.id, r.id));
  res.status(201).json(fmt(row));
});

router.post("/volontari/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createVolontarioOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

// Carico per volontario in un turno (= un giorno): consegne assegnate per quella
// data + bolle assegnate per quella data non collegate a una consegna (no doppioni),
// escluse le bolle annullate. Usato dalla UI per disabilitare i volontari al limite.
router.get("/volontari/carico", async (req, res) => {
  const { data, excludeConsegnaId, excludeBollaId } = req.query as Record<string, string>;
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) {
    res.status(400).json({ error: "Parametro 'data' non valido (formato atteso: YYYY-MM-DD)" });
    return;
  }
  const exclConsegna = excludeConsegnaId != null ? parseInt(excludeConsegnaId) : NaN;
  const exclBolla = excludeBollaId != null ? parseInt(excludeBollaId) : NaN;
  const counts = new Map<number, number>();

  // I conteggi restano GLOBALI: il limite di un volontario è giornaliero su tutti
  // i centri (un volontario universale consegna ovunque), quindi il carico va
  // sommato senza scoping per ottenere un limite corretto.
  const consegneConds = [eq(consegneTable.dataPrevista, data)];
  if (Number.isInteger(exclConsegna)) consegneConds.push(ne(consegneTable.id, exclConsegna));
  const cons = await db
    .select({ volontarioId: consegneTable.volontarioId })
    .from(consegneTable)
    .where(and(...consegneConds));
  for (const r of cons) {
    if (r.volontarioId != null) counts.set(r.volontarioId, (counts.get(r.volontarioId) ?? 0) + 1);
  }

  const bolleConds = [eq(bolleTable.dataBolla, data), isNull(bolleTable.consegnaId), ne(bolleTable.stato, "annullato")];
  if (Number.isInteger(exclBolla)) bolleConds.push(ne(bolleTable.id, exclBolla));
  const bol = await db
    .select({ volontarioId: bolleTable.volontarioConsegnaId })
    .from(bolleTable)
    .where(and(...bolleConds));
  for (const r of bol) {
    if (r.volontarioId != null) counts.set(r.volontarioId, (counts.get(r.volontarioId) ?? 0) + 1);
  }

  // Le RIGHE restituite sono però limitate ai volontari visibili al chiamante
  // (confine centro + città HARD): il conteggio resta globale, ma non si espone
  // l'attività di volontari fuori perimetro.
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const visibili = await db
    .select({ id: volontariTable.id })
    .from(volontariTable)
    .where(
      andScoped(
        centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
        idSetScopeFilter(volontariTable.centroAscoltoId, cittaCentroIds),
      ),
    );
  const visibileSet = new Set(visibili.map((v) => v.id));

  res.json(
    [...counts.entries()]
      .filter(([volontarioId]) => visibileSet.has(volontarioId))
      .map(([volontarioId, count]) => ({ volontarioId, count })),
  );
});

router.get("/volontari/:id", async (req, res) => {
  const [row] = await selectVolontario().where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(row.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(fmt(row));
});

router.patch("/volontari/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const updates = { ...req.body };
  if ("matricola" in updates) {
    const matricola = normalizeMatricola(updates.matricola);
    if (!matricola) { res.status(400).json({ error: "Matricola obbligatoria" }); return; }
    updates.matricola = matricola;
  }
  if (caller != null) delete updates.centroAscoltoId;
  const [updated] = await db.update(volontariTable).set(updates).where(eq(volontariTable.id, parseInt(req.params.id))).returning({ id: volontariTable.id });
  const [row] = await selectVolontario().where(eq(volontariTable.id, updated.id));
  res.json(fmt(row));
});

router.delete("/volontari/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
