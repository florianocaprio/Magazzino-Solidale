import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { fornitoriTable, cittaTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, desc } from "drizzle-orm";
import {
  callerCittaId,
  cittaScopeFilter,
  canAccessCitta,
} from "../lib/centroScope";

const router: IRouter = Router();

const fmt = (
  r: typeof fornitoriTable.$inferSelect,
  cittaNome: string | null = null,
) => ({
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
  cittaId: r.cittaId ?? null,
  cittaNome: cittaNome ?? null,
  attivo: r.attivo,
  note: r.note ?? null,
  noteOperative: r.noteOperative ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function cittaNomeOf(cittaId: number | null | undefined): Promise<string | null> {
  if (cittaId == null) return null;
  const [c] = await db.select({ nome: cittaTable.nome }).from(cittaTable).where(eq(cittaTable.id, cittaId));
  return c?.nome ?? null;
}

router.get("/fornitori", async (req, res) => {
  const { cittaId } = req.query as Record<string, string>;
  const caller = callerCittaId(req);
  // Fornitori are scoped by Città ("Area"). Scoped users are pinned to their
  // città; global users may filter by a chosen città. Either way fornitori
  // "per tutte le città" (NULL) are shown (cittaScopeFilter = own-or-null).
  const effectiveCitta =
    caller != null ? caller : cittaId ? parseInt(cittaId) : null;
  const rows = await db
    .select({ f: fornitoriTable, cittaNome: cittaTable.nome })
    .from(fornitoriTable)
    .leftJoin(cittaTable, eq(cittaTable.id, fornitoriTable.cittaId))
    .where(cittaScopeFilter(fornitoriTable.cittaId, effectiveCitta))
    .orderBy(desc(fornitoriTable.id));
  res.json(rows.map((r) => fmt(r.f, r.cittaNome)));
});

async function createFornitoreOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ row: typeof fornitoriTable.$inferSelect } | { error: string }> {
  const caller = callerCittaId(req);
  const values = { ...body };
  // Legacy column no longer used for scoping; never set from the client.
  delete values.centroAscoltoId;
  // Scoped callers are pinned to their own città; global callers may choose any
  // città (or NULL = valido per tutte le città).
  if (caller != null) values.cittaId = caller;
  const [row] = await db.insert(fornitoriTable).values(values as typeof fornitoriTable.$inferInsert).returning();
  return { row };
}

router.post("/fornitori", async (req, res) => {
  const r = await createFornitoreOne(req.body, req);
  if ("error" in r) { res.status(403).json({ error: r.error }); return; }
  res.status(201).json(fmt(r.row, await cittaNomeOf(r.row.cittaId)));
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
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(fmt(row, await cittaNomeOf(row.cittaId)));
});

router.patch("/fornitori/:id", async (req, res) => {
  const caller = callerCittaId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCitta(existing.cittaId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const updates = { ...req.body };
  delete updates.centroAscoltoId;
  // Scoped callers cannot move a fornitore to another città.
  if (caller != null) delete updates.cittaId;
  const [row] = await db.update(fornitoriTable).set(updates).where(eq(fornitoriTable.id, parseInt(req.params.id))).returning();
  res.json(fmt(row, await cittaNomeOf(row.cittaId)));
});

router.delete("/fornitori/:id", async (req, res) => {
  const caller = callerCittaId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCitta(existing.cittaId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
