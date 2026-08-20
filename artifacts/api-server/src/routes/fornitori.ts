import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { fornitoriTable, areeOperativeTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, desc } from "drizzle-orm";
import {
  callerAreaOperativaId,
  areaOperativaScopeFilter,
  canAccessAreaOperativa,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";

const router: IRouter = Router();

router.use("/fornitori", requireModulo("FORNITORI"));

const FORNITORE_FIELDS = new Set([
  "nome", "tipo", "partitaIva", "codiceFiscale", "indirizzo", "comune",
  "telefono", "email", "referente", "siteWeb", "areaOperativaId", "attivo", "note", "noteOperative",
]);

function fornitoreValues(body: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(body).filter(([key]) => FORNITORE_FIELDS.has(key)));
}

const fmt = (
  r: typeof fornitoriTable.$inferSelect,
  areaOperativaNome: string | null = null,
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
  areaOperativaId: r.areaOperativaId ?? null,
  areaOperativaNome: areaOperativaNome ?? null,
  attivo: r.attivo,
  note: r.note ?? null,
  noteOperative: r.noteOperative ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function areaOperativaNomeOf(areaOperativaId: number | null | undefined): Promise<string | null> {
  if (areaOperativaId == null) return null;
  const [c] = await db.select({ nome: areeOperativeTable.nome }).from(areeOperativeTable).where(eq(areeOperativeTable.id, areaOperativaId));
  return c?.nome ?? null;
}

async function validateActiveArea(areaOperativaId: unknown): Promise<string | null> {
  if (areaOperativaId == null) return null;
  const id = Number(areaOperativaId);
  if (!Number.isSafeInteger(id) || id <= 0) return "Area non valida";
  const [area] = await db.select({ attivo: areeOperativeTable.attivo }).from(areeOperativeTable).where(eq(areeOperativeTable.id, id));
  if (!area) return "Area non trovata";
  if (!area.attivo) return "L'Area Operativa selezionata non è attiva";
  return null;
}

router.get("/fornitori", async (req, res) => {
  const { areaOperativaId } = req.query as Record<string, string>;
  const caller = callerAreaOperativaId(req);
  // Fornitori are scoped by Area Operativa ("Area"). Scoped users are pinned to their
  // area operativa; global users may filter by a chosen area operativa. Either way fornitori
  // "per tutte le area operativa" (NULL) are shown (areaOperativaScopeFilter = own-or-null).
  const effectiveAreaOperativa =
    caller != null ? caller : areaOperativaId ? parseInt(areaOperativaId) : null;
  const rows = await db
    .select({ f: fornitoriTable, areaOperativaNome: areeOperativeTable.nome })
    .from(fornitoriTable)
    .leftJoin(areeOperativeTable, eq(areeOperativeTable.id, fornitoriTable.areaOperativaId))
    .where(areaOperativaScopeFilter(fornitoriTable.areaOperativaId, effectiveAreaOperativa))
    .orderBy(desc(fornitoriTable.id));
  res.json(rows.map((r) => fmt(r.f, r.areaOperativaNome)));
});

async function createFornitoreOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ row: typeof fornitoriTable.$inferSelect } | { error: string }> {
  const caller = callerAreaOperativaId(req);
  const values = fornitoreValues(body);
  // Scoped callers are pinned to their own area operativa; global callers may choose any
  // area operativa (or NULL = valido per tutte le area operativa).
  if (caller != null) values.areaOperativaId = caller;
  if (typeof values.nome !== "string" || !values.nome.trim() || typeof values.tipo !== "string" || !values.tipo.trim()) {
    return { error: "Nome e tipo del Fornitore sono obbligatori" };
  }
  const areaError = await validateActiveArea(values.areaOperativaId);
  if (areaError) return { error: areaError };
  const [row] = await db.insert(fornitoriTable).values(values as typeof fornitoriTable.$inferInsert).returning();
  return { row };
}

router.post("/fornitori", async (req, res) => {
  const r = await createFornitoreOne(req.body, req);
  if ("error" in r) { res.status(400).json({ error: r.error }); return; }
  res.status(201).json(fmt(r.row, await areaOperativaNomeOf(r.row.areaOperativaId)));
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
  const [row] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, Number(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessAreaOperativa(row.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  res.json(fmt(row, await areaOperativaNomeOf(row.areaOperativaId)));
});

router.patch("/fornitori/:id", async (req, res) => {
  const caller = callerAreaOperativaId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, Number(req.params.id)));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessAreaOperativa(existing.areaOperativaId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  if (caller != null && existing.areaOperativaId == null) {
    res.status(403).json({ error: "Un Fornitore condiviso può essere modificato solo da un Admin globale" });
    return;
  }
  const unsupported = Object.keys(req.body ?? {}).filter((key) => !FORNITORE_FIELDS.has(key));
  if (unsupported.length > 0) {
    res.status(400).json({ error: `Campi Fornitore non modificabili: ${unsupported.join(", ")}` });
    return;
  }
  const updates = fornitoreValues(req.body ?? {});
  // Scoped callers cannot move a fornitore to another area operativa.
  if (caller != null) delete updates.areaOperativaId;
  if (updates.areaOperativaId !== undefined && updates.areaOperativaId !== existing.areaOperativaId) {
    const areaError = await validateActiveArea(updates.areaOperativaId);
    if (areaError) { res.status(400).json({ error: areaError }); return; }
  }
  const [row] = await db.update(fornitoriTable).set(updates).where(eq(fornitoriTable.id, Number(req.params.id))).returning();
  res.json(fmt(row, await areaOperativaNomeOf(row.areaOperativaId)));
});

router.delete("/fornitori/:id", async (req, res) => {
  const caller = callerAreaOperativaId(req);
  const [existing] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, Number(req.params.id)));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessAreaOperativa(existing.areaOperativaId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  if (caller != null && existing.areaOperativaId == null) {
    res.status(403).json({ error: "Un Fornitore condiviso può essere disattivato solo da un Admin globale" });
    return;
  }
  const [row] = await db.update(fornitoriTable).set({ attivo: false }).where(eq(fornitoriTable.id, Number(req.params.id))).returning();
  res.json(fmt(row, await areaOperativaNomeOf(row.areaOperativaId)));
});

export default router;
