import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { volontariTable, centriAscoltoTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, getTableColumns, desc } from "drizzle-orm";
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
