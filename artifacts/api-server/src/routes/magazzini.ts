import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { magazziniTable, centriAscoltoTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  cittaScopeFilter,
  canAccessCentro,
  canAccessCitta,
  andScoped,
} from "../lib/centroScope";

const router: IRouter = Router();

/** True when an error is a Postgres unique-constraint violation (SQLSTATE 23505).
 * Drizzle wraps driver errors, so the pg error may be nested under `.cause`. */
function isUniqueViolation(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; cur != null && depth < 5; depth++) {
    if (typeof cur === "object" && (cur as { code?: string }).code === "23505") return true;
    cur = typeof cur === "object" ? (cur as { cause?: unknown }).cause : undefined;
  }
  return false;
}

/** Computes the next sequential MAG-NNN codice from the current max in the table. */
async function nextMagCodice(): Promise<string> {
  const rows = await db.select({ codice: magazziniTable.codice }).from(magazziniTable);
  let max = 0;
  for (const r of rows) {
    const m = /^MAG-(\d+)$/.exec(r.codice);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `MAG-${String(max + 1).padStart(3, "0")}`;
}

const fmt = (r: typeof magazziniTable.$inferSelect, centroNome?: string | null) => ({
  id: r.id,
  codice: r.codice,
  nome: r.nome,
  indirizzo: r.indirizzo ?? null,
  comune: r.comune ?? null,
  zona: r.zona ?? null,
  responsabile: r.responsabile ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: centroNome ?? null,
  cittaId: r.cittaId ?? null,
  stato: r.stato,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function centroNomeOf(id: number | null): Promise<string | null> {
  if (id == null) return null;
  const [c] = await db
    .select({ nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, id));
  return c?.nome ?? null;
}

router.get("/magazzini", async (req, res) => {
  const rows = await db
    .select({ m: magazziniTable, centroNome: centriAscoltoTable.nome })
    .from(magazziniTable)
    .leftJoin(
      centriAscoltoTable,
      eq(magazziniTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .where(
      andScoped(
        centroScopeFilter(magazziniTable.centroAscoltoId, callerCentroId(req)),
        cittaScopeFilter(magazziniTable.cittaId, callerCittaId(req)),
      ),
    )
    .orderBy(magazziniTable.nome);
  res.json(rows.map((r) => fmt(r.m, r.centroNome)));
});

router.post("/magazzini", async (req, res) => {
  const body = req.body;
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const centroAscoltoId = caller != null ? caller : (body.centroAscoltoId ?? null);
  const cittaId = cid != null ? cid : (body.cittaId ?? null);
  const providedCodice = typeof body.codice === "string" ? body.codice.trim() : "";
  const values = {
    nome: body.nome,
    indirizzo: body.indirizzo,
    comune: body.comune,
    zona: body.zona,
    responsabile: body.responsabile,
    telefono: body.telefono,
    email: body.email,
    centroAscoltoId,
    cittaId,
    stato: body.stato ?? "attivo",
    note: body.note,
  };

  // Caller-provided codice: a duplicate is a clear client error, not a 500.
  if (providedCodice) {
    try {
      const [row] = await db
        .insert(magazziniTable)
        .values({ ...values, codice: providedCodice })
        .returning();
      res.status(201).json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
    } catch (e) {
      if (isUniqueViolation(e)) {
        res.status(409).json({ error: `Codice "${providedCodice}" già in uso` });
        return;
      }
      throw e;
    }
    return;
  }

  // Auto-generated codice: retry on collision so a concurrent create can't crash it.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const codice = await nextMagCodice();
    try {
      const [row] = await db.insert(magazziniTable).values({ ...values, codice }).returning();
      res.status(201).json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
      return;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) continue;
      if (isUniqueViolation(e)) {
        res.status(409).json({ error: "Impossibile generare un codice univoco per il magazzino, riprova" });
        return;
      }
      throw e;
    }
  }
});

router.get("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
});

router.patch("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const [existing] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const updates = { ...req.body };
  // Scoped users cannot reassign a record's centro.
  if (caller != null) delete updates.centroAscoltoId;
  // Scoped users cannot move a record to another città.
  if (cid != null) delete updates.cittaId;
  const [row] = await db.update(magazziniTable).set(updates).where(eq(magazziniTable.id, id)).returning();
  res.json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
});

router.delete("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(magazziniTable).where(eq(magazziniTable.id, id));
  res.status(204).send();
});

export default router;
