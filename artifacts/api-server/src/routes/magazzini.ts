import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { areeOperativeTable, magazziniTable, centriAscoltoTable, menseTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateMagazzinoBody, UpdateMagazzinoBody } from "@workspace/api-zod";
import { callerCentroId, callerAreaOperativaId, centroScopeFilter, areaOperativaScopeFilter, canAccessCentro, canAccessAreaOperativa, andScoped } from "../lib/centroScope";
import { requireAdmin } from "../middlewares/auth";
import { canMutateScopedResource } from "../lib/adminScope";
import { EMPORIO_DISABLED_MSG, isEmporioEnabled } from "../lib/impostazioniModuli";
import { nextMagazzinoCodice } from "../lib/magazzinoCodice";
import { magazzinoDeletionBlockReason } from "../lib/magazzinoDeletion";
import { syncMensaFromMagazzino } from "../lib/mensaMagazzinoSync";
import { mensaHasOperationalHistory } from "../lib/mensaOperationalHistory";

const router: IRouter = Router();

const TIPI_MAGAZZINO = ["logistico", "emporio", "misto", "mensa"] as const;
type TipoMagazzino = (typeof TIPI_MAGAZZINO)[number];

function paramId(v: string | string[]): number {
  return parseInt(Array.isArray(v) ? v[0] : v, 10);
}

function parseTipoMagazzino(value: unknown, fallback?: TipoMagazzino): TipoMagazzino | null {
  if (value == null || value === "") return fallback ?? null;
  return typeof value === "string" && TIPI_MAGAZZINO.includes(value as TipoMagazzino) ? (value as TipoMagazzino) : null;
}

function isTipoEmporio(tipo: TipoMagazzino): boolean {
  return tipo === "emporio" || tipo === "misto";
}

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
  areaOperativaId: r.areaOperativaId ?? null,
  tipoMagazzino: r.tipoMagazzino ?? "logistico",
  stato: r.stato,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function centroNomeOf(id: number | null): Promise<string | null> {
  if (id == null) return null;
  const [c] = await db.select({ nome: centriAscoltoTable.nome }).from(centriAscoltoTable).where(eq(centriAscoltoTable.id, id));
  return c?.nome ?? null;
}

async function validateMagazzinoAssignment(
  areaOperativaId: number | null,
  centroAscoltoId: number | null,
  requireArea: boolean,
): Promise<string | null> {
  if (requireArea && areaOperativaId == null) {
    return "Seleziona un'Area valida per la Mensa.";
  }
  if (areaOperativaId != null) {
    const [area] = await db
      .select({ id: areeOperativeTable.id, attivo: areeOperativeTable.attivo })
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, areaOperativaId));
    if (!area || !area.attivo) return "L'Area Operativa selezionata non è disponibile.";
  }

  if (centroAscoltoId == null) return null;
  const [centro] = await db
    .select({
      areaOperativaId: centriAscoltoTable.areaOperativaId,
      attivo: centriAscoltoTable.attivo,
    })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoId));
  if (!centro) return "Il Centro di Ascolto selezionato non esiste.";
  if (!centro.attivo) return "Il Centro di Ascolto selezionato non è attivo.";
  if (centro.areaOperativaId !== areaOperativaId) {
    return "Il Centro di Ascolto deve appartenere alla stessa Area Operativa del Magazzino.";
  }
  return null;
}

router.get("/magazzini", async (req, res) => {
  const rows = await db
    .select({ m: magazziniTable, centroNome: centriAscoltoTable.nome })
    .from(magazziniTable)
    .leftJoin(centriAscoltoTable, eq(magazziniTable.centroAscoltoId, centriAscoltoTable.id))
    .where(andScoped(centroScopeFilter(magazziniTable.centroAscoltoId, callerCentroId(req)), areaOperativaScopeFilter(magazziniTable.areaOperativaId, callerAreaOperativaId(req))))
    .orderBy(magazziniTable.nome);
  res.json(rows.map((r) => fmt(r.m, r.centroNome)));
});

router.post("/magazzini", requireAdmin, async (req, res) => {
  const parsed = CreateMagazzinoBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.nome.trim()) {
    res.status(400).json({ error: "Inserimento magazzino non valido" });
    return;
  }
  const body = parsed.data;
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  if (cid != null && body.areaOperativaId != null && body.areaOperativaId !== cid) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const centroAscoltoId = caller != null ? caller : (body.centroAscoltoId ?? null);
  const areaOperativaId = cid != null ? cid : (body.areaOperativaId ?? null);
  const tipoMagazzino = parseTipoMagazzino(body.tipoMagazzino, "logistico");
  if (!tipoMagazzino) {
    res.status(400).json({ error: "Tipo magazzino non valido." });
    return;
  }
  if (isTipoEmporio(tipoMagazzino) && !(await isEmporioEnabled())) {
    res.status(403).json({ error: EMPORIO_DISABLED_MSG });
    return;
  }
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
    areaOperativaId,
    tipoMagazzino,
    stato: body.stato ?? "attivo",
    note: body.note,
  };
  const assignmentError = await validateMagazzinoAssignment(areaOperativaId, centroAscoltoId, tipoMagazzino === "mensa");
  if (assignmentError) {
    res.status(400).json({ error: assignmentError });
    return;
  }

  // Caller-provided codice: a duplicate is a clear client error, not a 500.
  if (providedCodice) {
    try {
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(magazziniTable)
          .values({ ...values, codice: providedCodice })
          .returning();
        if (created.tipoMagazzino === "mensa") {
          await syncMensaFromMagazzino(tx, created, req.user?.id ?? null);
        }
        return created;
      });
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
    const codice = await nextMagazzinoCodice();
    try {
      const row = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(magazziniTable)
          .values({ ...values, codice })
          .returning();
        if (created.tipoMagazzino === "mensa") {
          await syncMensaFromMagazzino(tx, created, req.user?.id ?? null);
        }
        return created;
      });
      res.status(201).json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
      return;
    } catch (e) {
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) continue;
      if (isUniqueViolation(e)) {
        res.status(409).json({
          error: "Impossibile generare un codice univoco per il magazzino, riprova",
        });
        return;
      }
      throw e;
    }
  }
});

router.get("/magazzini/:id", async (req, res) => {
  const id = paramId(req.params.id);
  const [row] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessAreaOperativa(row.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  res.json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
});

router.patch("/magazzini/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const caller = callerCentroId(req);
  const cid = callerAreaOperativaId(req);
  const [existing] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canMutateScopedResource(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Magazzino non modificabile per il tuo centro" });
    return;
  }
  if (!canMutateScopedResource(existing.areaOperativaId, cid)) {
    res.status(403).json({ error: "Magazzino non modificabile per la tua Area" });
    return;
  }
  const parsed = UpdateMagazzinoBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.nome !== undefined && !parsed.data.nome.trim())) {
    res.status(400).json({ error: "Modifica magazzino non valida" });
    return;
  }
  const updates = { ...parsed.data };
  if (cid != null && updates.areaOperativaId !== undefined && updates.areaOperativaId !== cid) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  if ("tipoMagazzino" in updates) {
    const tipoMagazzino = parseTipoMagazzino(updates.tipoMagazzino);
    if (!tipoMagazzino) {
      res.status(400).json({ error: "Tipo magazzino non valido." });
      return;
    }
    if (tipoMagazzino !== existing.tipoMagazzino && isTipoEmporio(tipoMagazzino) && !(await isEmporioEnabled())) {
      res.status(403).json({ error: EMPORIO_DISABLED_MSG });
      return;
    }
    updates.tipoMagazzino = tipoMagazzino;
  }
  if (existing.tipoMagazzino === "mensa" && updates.tipoMagazzino != null && updates.tipoMagazzino !== "mensa") {
    res.status(409).json({
      error: "Un magazzino Mensa non può cambiare tipo. Puoi disattivarlo o eliminarlo se non possiede storico.",
    });
    return;
  }
  // Scoped users cannot reassign a record's centro.
  if (caller != null) delete updates.centroAscoltoId;
  // Scoped users cannot move a record to another area operativa.
  if (cid != null) delete updates.areaOperativaId;
  const targetTipo = (updates.tipoMagazzino ?? existing.tipoMagazzino) as TipoMagazzino;
  const targetAreaOperativaId = updates.areaOperativaId === undefined ? existing.areaOperativaId : updates.areaOperativaId;
  const targetCentroId = updates.centroAscoltoId === undefined ? existing.centroAscoltoId : updates.centroAscoltoId;
  const assignmentChanged = parsed.data.areaOperativaId !== undefined || parsed.data.centroAscoltoId !== undefined || parsed.data.tipoMagazzino !== undefined;
  if (assignmentChanged) {
    const assignmentError = await validateMagazzinoAssignment(targetAreaOperativaId, targetCentroId, targetTipo === "mensa");
    if (assignmentError) {
      res.status(400).json({ error: assignmentError });
      return;
    }
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(magazziniTable).set(updates).where(eq(magazziniTable.id, id)).returning();
    if (updated.tipoMagazzino === "mensa") {
      await syncMensaFromMagazzino(tx, updated, req.user?.id ?? null);
    }
    return updated;
  });
  res.json(fmt(row, await centroNomeOf(row.centroAscoltoId)));
});

router.delete("/magazzini/:id", requireAdmin, async (req, res) => {
  const id = paramId(req.params.id);
  const caller = callerCentroId(req);
  const [existing] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!existing) {
    res.status(204).send();
    return;
  }
  if (!canMutateScopedResource(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Magazzino non modificabile per il tuo centro" });
    return;
  }
  if (!canMutateScopedResource(existing.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Magazzino non modificabile per la tua Area" });
    return;
  }
  const [linkedMensa] = await db.select({ id: menseTable.id }).from(menseTable).where(eq(menseTable.magazzinoId, id));
  if (linkedMensa && (await mensaHasOperationalHistory(linkedMensa.id))) {
    res.status(409).json({
      error: "La Mensa possiede storico operativo e non può essere eliminata. Puoi disattivarla.",
    });
    return;
  }
  const blockReason = await magazzinoDeletionBlockReason(id, linkedMensa ? { ignoreMensaId: linkedMensa.id } : {});
  if (blockReason) {
    res.status(409).json({ error: blockReason });
    return;
  }
  await db.transaction(async (tx) => {
    if (linkedMensa) {
      await tx.delete(menseTable).where(eq(menseTable.id, linkedMensa.id));
    }
    await tx.delete(magazziniTable).where(eq(magazziniTable.id, id));
  });
  res.status(204).send();
});

export default router;
