import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { fornitoriTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq } from "drizzle-orm";
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

const fmt = (r: typeof fornitoriTable.$inferSelect) => ({
  id: r.id,
  nome: r.nome,
  tipo: r.tipo,
  partitaIva: r.partitaIva ?? null,
  codiceFiscale: r.codiceFiscale ?? null,
  indirizzo: r.indirizzo ?? null,
  comune: r.comune ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  referente: r.referente ?? null,
  siteWeb: r.siteWeb ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  attivo: r.attivo,
  note: r.note ?? null,
  noteOperative: r.noteOperative ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

router.get("/fornitori", async (req, res) => {
  const { centroAscoltoId } = req.query as Record<string, string>;
  const caller = callerCentroId(req);
  // Scoped users are forced to their centro; global users may filter by a
  // chosen centro. Either way, fornitori "per tutti i centri" (null) are shown.
  const effectiveCentro =
    caller != null ? caller : centroAscoltoId ? parseInt(centroAscoltoId) : null;
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const rows = await db
    .select()
    .from(fornitoriTable)
    .where(
      andScoped(
        centroScopeFilter(fornitoriTable.centroAscoltoId, effectiveCentro),
        idSetScopeFilter(fornitoriTable.centroAscoltoId, cittaCentroIds),
      ),
    )
    .orderBy(fornitoriTable.nome);
  res.json(rows.map(fmt));
});

async function createFornitoreOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ row: typeof fornitoriTable.$inferSelect } | { error: string }> {
  const caller = callerCentroId(req);
  const values = { ...body };
  if (caller != null) values.centroAscoltoId = caller;
  if (
    caller == null &&
    values.centroAscoltoId != null &&
    !inVisibleCentroSet(values.centroAscoltoId as number, await visibleCentroIds(callerCittaId(req)))
  ) {
    return { error: "Centro non accessibile per la tua città" };
  }
  const [row] = await db.insert(fornitoriTable).values(values as typeof fornitoriTable.$inferInsert).returning();
  return { row };
}

router.post("/fornitori", async (req, res) => {
  const r = await createFornitoreOne(req.body, req);
  if ("error" in r) { res.status(403).json({ error: r.error }); return; }
  res.status(201).json(fmt(r.row));
});

router.post("/fornitori/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createFornitoreOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

router.get("/fornitori/:id", async (req, res) => {
  const [row] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
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

router.patch("/fornitori/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
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
  if (caller != null) delete updates.centroAscoltoId;
  const [row] = await db.update(fornitoriTable).set(updates).where(eq(fornitoriTable.id, parseInt(req.params.id))).returning();
  res.json(fmt(row));
});

router.delete("/fornitori/:id", async (req, res) => {
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(existing.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
