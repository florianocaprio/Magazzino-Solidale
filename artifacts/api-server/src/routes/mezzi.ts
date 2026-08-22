import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  mezziTable,
  volontariTable,
  centriAscoltoTable,
  consegneTable,
  bolleTable,
  turniTable,
} from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { and, eq, sql, desc } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  canAccessCentro,
  visibleCentroIds,
  inVisibleCentroSet,
  andScoped,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { validateCapacita } from "../lib/bug5Validation";
import { requirePermission } from "../middlewares/auth";
import {
  effectiveAreaOperativaFilter,
  effectiveCentroFilter,
  effectiveCentroFromMezzo,
  loadAndLockEffectiveMezzoTx,
  LogisticaPolicyError,
  normalizeTarga,
  parseRequiredVersion,
  STATI_MEZZO,
} from "../lib/logisticaPolicy";
import { auditLogistica } from "../lib/logisticaAudit";

const router: IRouter = Router();
router.use("/mezzi", requireModulo("MEZZI"));

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

/** Computes the next sequential MEZ-NNN codice from the current max in the table. */
async function nextMezCodice(): Promise<string> {
  const rows = await db.select({ codice: mezziTable.codice }).from(mezziTable);
  let max = 0;
  for (const r of rows) {
    const m = /^MEZ-(\d+)$/.exec(r.codice);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `MEZ-${String(max + 1).padStart(3, "0")}`;
}

type MezzoJoinRow = {
  m: typeof mezziTable.$inferSelect;
  volNome: string | null;
  volCognome: string | null;
  volCentroId: number | null;
};

/**
 * Effective centro of a mezzo: the owning volontario's centro when the vehicle
 * is volontario-owned (`volontarioId` set), otherwise the mezzo's own
 * `centroAscoltoId`. NULL on either path = visible to all centri.
 */
function effectiveCentroOf(r: MezzoJoinRow): number | null {
  return effectiveCentroFromMezzo(r.m, r.volCentroId);
}

const baseSelect = () =>
  db
    .select({
      m: mezziTable,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
      volCentroId: volontariTable.centroAscoltoId,
    })
    .from(mezziTable)
    .leftJoin(volontariTable, eq(mezziTable.volontarioId, volontariTable.id));

const fmt = (r: MezzoJoinRow, centroNome: string | null) => {
  const effectiveCentroId = effectiveCentroOf(r);
  return {
    id: r.m.id,
    codice: r.m.codice,
    tipo: r.m.tipo,
    targa: r.m.targa ?? null,
    proprieta: r.m.proprieta,
    proprietarioNome: r.m.proprietarioNome ?? null,
    volontarioId: r.m.volontarioId ?? null,
    volontarioNome: r.volNome ? `${r.volNome} ${r.volCognome ?? ""}`.trim() : null,
    centroAscoltoId: r.m.centroAscoltoId ?? null,
    effectiveCentroId,
    effectiveCentroNome: centroNome,
    capacitaColli: r.m.capacitaColli ?? null,
    capacitaKg: r.m.capacitaKg ? parseFloat(r.m.capacitaKg) : null,
    descrizione: r.m.descrizione ?? null,
    stato: r.m.stato,
    statoApprovazione: r.m.statoApprovazione,
    scadenzaAssicurazione: r.m.scadenzaAssicurazione ?? null,
    scadenzaRevisione: r.m.scadenzaRevisione ?? null,
    note: r.m.note ?? null,
    versione: r.m.versione,
    dataCreazione: r.m.dataCreazione.toISOString(),
    dataAggiornamento: r.m.dataAggiornamento.toISOString(),
  };
};

async function centroNomeOf(id: number | null): Promise<string | null> {
  if (id == null) return null;
  const [c] = await db
    .select({ nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, id));
  return c?.nome ?? null;
}

async function loadMezzo(id: number): Promise<ReturnType<typeof fmt> | null> {
  const [r] = await baseSelect().where(eq(mezziTable.id, id));
  if (!r) return null;
  return fmt(r, await centroNomeOf(effectiveCentroOf(r)));
}

/** Centro of a volontario (for inheritance/validation), or null. */
async function volontarioCentroId(volontarioId: number): Promise<{ exists: boolean; centroId: number | null }> {
  const [v] = await db
    .select({ c: volontariTable.centroAscoltoId })
    .from(volontariTable)
    .where(eq(volontariTable.id, volontarioId));
  return { exists: Boolean(v), centroId: v?.c ?? null };
}

router.get("/mezzi", requirePermission("logistica.mezzi.view"), async (req, res) => {
  const caller = callerCentroId(req);
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  const rows = await baseSelect()
    .where(
      andScoped(
        effectiveCentroFilter(caller),
        effectiveAreaOperativaFilter(areaOperativaCentroIds),
      ),
    )
    .orderBy(desc(mezziTable.id));
  const centri = await db
    .select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable);
  const centroMap = new Map(centri.map((c) => [c.id, c.nome]));
  res.json(
    rows.map((r) => {
      const eff = effectiveCentroOf(r);
      return fmt(r, eff != null ? (centroMap.get(eff) ?? null) : null);
    }),
  );
});

/**
 * Resolves the own `centroAscoltoId` to persist and validates that the resulting
 * effective centro is accessible to the caller. Returns the own centro to store,
 * or a 403 error message string.
 */
async function resolveCentro(
  body: { volontarioId?: number | null; centroAscoltoId?: number | null },
  caller: number | null,
  areaOperativaCentroIds: number[] | null,
): Promise<{ ownCentro: number | null } | { error: string; status: number }> {
  let ownCentro: number | null = body.centroAscoltoId ?? null;
  if (body.volontarioId != null) {
    // Volontario-owned: own centro is ignored/derived from the volontario.
    ownCentro = null;
  } else if (caller != null) {
    // Scoped, non-volontario-owned: lock to caller's centro.
    ownCentro = caller;
  }
  const owner = body.volontarioId != null ? await volontarioCentroId(body.volontarioId) : null;
  if (owner && !owner.exists) return { error: "Volontario proprietario non trovato", status: 400 };
  const effective = effectiveCentroFromMezzo(
    { volontarioId: body.volontarioId ?? null, centroAscoltoId: ownCentro },
    owner?.centroId ?? null,
  );
  if (caller == null && areaOperativaCentroIds != null && effective == null) {
    return { error: "Seleziona un Centro della tua Area Operativa", status: 400 };
  }
  if (!canAccessCentro(effective, caller)) {
    return { error: "Mezzo non accessibile per il tuo centro", status: 403 };
  }
  if (!inVisibleCentroSet(effective, areaOperativaCentroIds)) {
    return { error: "Mezzo non accessibile per la tua area operativa", status: 403 };
  }
  return { ownCentro };
}

async function createMezzoOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ id: number } | { error: string; status?: number }> {
  const b = body as Record<string, any>;
  const capacitaError = validateCapacita(b);
  if (capacitaError) return { error: capacitaError, status: 400 };
  const caller = callerCentroId(req);
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  const resolved = await resolveCentro(b, caller, areaOperativaCentroIds);
  if ("error" in resolved) return { error: resolved.error, status: resolved.status };
  const baseValues = {
    ...(b as typeof mezziTable.$inferInsert),
    centroAscoltoId: resolved.ownCentro,
    capacitaKg: b.capacitaKg?.toString(),
    targa: normalizeTarga(b.targa),
    stato: "non_disponibile",
    statoApprovazione: "in_attesa",
  };
  delete (baseValues as Record<string, unknown>).versione;
  delete (baseValues as Record<string, unknown>).dataAggiornamento;
  const providedCodice = typeof b.codice === "string" ? b.codice.trim() : "";
  const insertWithLockedScope = async (
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    codice: string,
  ) => {
    const requestedOwnerId = b.volontarioId != null ? Number(b.volontarioId) : null;
    const [owner] = requestedOwnerId != null
      ? await tx.select().from(volontariTable).where(eq(volontariTable.id, requestedOwnerId)).for("update")
      : [];
    if (requestedOwnerId != null && !owner) throw new LogisticaPolicyError(400, "Volontario proprietario non trovato");
    const effectiveCentroId = effectiveCentroFromMezzo(
      { volontarioId: requestedOwnerId, centroAscoltoId: resolved.ownCentro },
      owner?.centroAscoltoId ?? null,
    );
    if (caller == null && areaOperativaCentroIds != null && effectiveCentroId == null) {
      throw new LogisticaPolicyError(400, "Seleziona un Centro della tua Area Operativa");
    }
    if (!canAccessCentro(effectiveCentroId, caller) || !inVisibleCentroSet(effectiveCentroId, areaOperativaCentroIds)) {
      throw new LogisticaPolicyError(403, "Mezzo non accessibile per il tuo perimetro");
    }
    const [row] = await tx
      .insert(mezziTable)
      .values({ ...baseValues, codice })
      .returning({ id: mezziTable.id, versione: mezziTable.versione });
    await auditLogistica(tx, req, { entita: "mezzo", id: row.id, azione: "creazione", nuovo: { statoApprovazione: "in_attesa", stato: "non_disponibile", versione: row.versione } });
    return row;
  };

  // Caller-provided codice: a duplicate is a clear client error, not a 500.
  if (providedCodice) {
    const codice = providedCodice.toUpperCase();
    try {
      const [created] = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtext('mezzo-codice'), hashtext(${codice})
        )`);
        const [duplicate] = await tx
          .select({ id: mezziTable.id })
          .from(mezziTable)
          .where(sql`upper(trim(${mezziTable.codice})) = ${codice}`)
          .limit(1);
        if (duplicate) throw new Error("DUPLICATE_MEZZO_CODICE");
        return [await insertWithLockedScope(tx, codice)];
      });
      return { id: created.id };
    } catch (e) {
      if (e instanceof Error && e.message === "DUPLICATE_MEZZO_CODICE") {
        return { error: `Codice "${providedCodice}" già in uso`, status: 409 };
      }
      if (e instanceof LogisticaPolicyError) return { error: e.message, status: e.status };
      if (isUniqueViolation(e)) return { error: `Codice "${providedCodice}" già in uso`, status: 409 };
      throw e;
    }
  }

  // Empty codice: auto-generate MEZ-NNN, retrying on collision under concurrency.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const codice = await nextMezCodice();
    try {
      const [created] = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtext('mezzo-codice'), hashtext(${codice})
        )`);
        const [duplicate] = await tx
          .select({ id: mezziTable.id })
          .from(mezziTable)
          .where(eq(mezziTable.codice, codice))
          .limit(1);
        if (duplicate) throw new Error("AUTO_MEZZO_CODICE_COLLISION");
        return [await insertWithLockedScope(tx, codice)];
      });
      return { id: created.id };
    } catch (e) {
      if (e instanceof Error && e.message === "AUTO_MEZZO_CODICE_COLLISION") {
        if (attempt < MAX_ATTEMPTS - 1) continue;
        return { error: "Impossibile generare un codice univoco per il mezzo, riprova", status: 409 };
      }
      if (e instanceof LogisticaPolicyError) return { error: e.message, status: e.status };
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) continue;
      if (isUniqueViolation(e)) return { error: "Impossibile generare un codice univoco per il mezzo, riprova", status: 409 };
      throw e;
    }
  }
  return { error: "Impossibile generare un codice univoco per il mezzo, riprova", status: 409 };
}

router.post("/mezzi", requirePermission("logistica.mezzi.manage"), async (req, res) => {
  const r = await createMezzoOne(req.body, req);
  if ("error" in r) { res.status(r.status ?? 403).json({ error: r.error }); return; }
  res.status(201).json(await loadMezzo(r.id));
});

router.post("/mezzi/bulk", requirePermission("logistica.mezzi.manage"), async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createMezzoOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

router.get("/mezzi/:id", requirePermission("logistica.mezzi.view"), async (req, res) => {
  const [r] = await baseSelect().where(eq(mezziTable.id, parseInt(String(req.params.id))));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(effectiveCentroOf(r), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(effectiveCentroOf(r), await visibleCentroIds(callerAreaOperativaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  res.json(fmt(r, await centroNomeOf(effectiveCentroOf(r))));
});

router.patch("/mezzi/:id", requirePermission("logistica.mezzi.manage"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const caller = callerCentroId(req);
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  const [existing] = await baseSelect().where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(effectiveCentroOf(existing), caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(effectiveCentroOf(existing), areaOperativaCentroIds)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  const body = req.body;
  const versione = parseRequiredVersion(body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  const capacitaError = validateCapacita(body);
  if (capacitaError) { res.status(400).json({ error: capacitaError }); return; }
  if (body.stato !== undefined && !STATI_MEZZO.includes(body.stato)) {
    res.status(400).json({ error: "Stato mezzo non valido" });
    return;
  }
  // Determine the post-update owner link to recompute the effective centro.
  const volontarioId =
    body.volontarioId !== undefined ? body.volontarioId : existing.m.volontarioId;
  const resolved = await resolveCentro(
    {
      volontarioId,
      centroAscoltoId:
        body.centroAscoltoId !== undefined ? body.centroAscoltoId : existing.m.centroAscoltoId,
    },
    caller,
    areaOperativaCentroIds,
  );
  if ("error" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const update = {
    ...body,
    centroAscoltoId: resolved.ownCentro,
    capacitaKg: body.capacitaKg === null ? null : body.capacitaKg === undefined ? undefined : body.capacitaKg.toString(),
    targa: body.targa === undefined ? undefined : normalizeTarga(body.targa),
  };
  delete update.versione;
  delete update.codice;
  delete update.statoApprovazione;
  delete update.dataCreazione;
  delete update.dataAggiornamento;
  if (body.stato === "disponibile" && existing.m.statoApprovazione !== "approvato") {
    res.status(409).json({ error: "Il mezzo deve essere approvato prima di diventare disponibile" });
    return;
  }
  let changed;
  try {
    [changed] = await db.transaction(async (tx) => {
    const requestedOwnerId = volontarioId != null ? Number(volontarioId) : null;
    const locked = await loadAndLockEffectiveMezzoTx(tx, id, requestedOwnerId != null ? [requestedOwnerId] : []);
    if (!canAccessCentro(locked.effectiveCentroId, caller) || !inVisibleCentroSet(locked.effectiveCentroId, areaOperativaCentroIds)) {
      throw new LogisticaPolicyError(403, "Risorsa non accessibile per il tuo perimetro");
    }
    if (requestedOwnerId != null && !locked.owners.has(requestedOwnerId)) throw new LogisticaPolicyError(400, "Volontario proprietario non trovato");
    const effectiveNext = effectiveCentroFromMezzo(
      { volontarioId: requestedOwnerId, centroAscoltoId: resolved.ownCentro },
      requestedOwnerId == null ? null : locked.owners.get(requestedOwnerId)!.centroAscoltoId,
    );
    if (!canAccessCentro(effectiveNext, caller) || !inVisibleCentroSet(effectiveNext, areaOperativaCentroIds)) {
      throw new LogisticaPolicyError(403, "Mezzo non accessibile per il tuo perimetro");
    }
    if (body.stato === "disponibile" && locked.mezzo.statoApprovazione !== "approvato") throw new LogisticaPolicyError(409, "Il mezzo deve essere approvato prima di diventare disponibile");
    const [row] = await tx.update(mezziTable).set({
      ...update,
      versione: sql`${mezziTable.versione} + 1`,
      dataAggiornamento: new Date(),
    }).where(and(eq(mezziTable.id, id), eq(mezziTable.versione, versione))).returning({ id: mezziTable.id, versione: mezziTable.versione });
    if (!row) return [];
    await auditLogistica(tx, req, {
      entita: "mezzo",
      id,
      azione: body.stato !== undefined ? "disponibilita" : body.volontarioId !== undefined || body.centroAscoltoId !== undefined ? "cambio_proprietario_centro" : "modifica",
      precedente: { versione: existing.m.versione, stato: existing.m.stato, volontarioId: existing.m.volontarioId, centroAscoltoId: existing.m.centroAscoltoId },
      nuovo: { versione: row.versione, stato: body.stato ?? existing.m.stato, volontarioId, centroAscoltoId: resolved.ownCentro },
    });
    return [row];
  });
  } catch (error) {
    if (error instanceof LogisticaPolicyError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
  if (!changed) { res.status(409).json({ error: "La risorsa è stata aggiornata da un altro operatore" }); return; }
  res.json(await loadMezzo(id));
});

router.delete("/mezzi/:id", requirePermission("logistica.mezzi.manage"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const caller = callerCentroId(req);
  const visibleIds = await visibleCentroIds(callerAreaOperativaId(req));
  try {
    const result = await db.transaction(async (tx) => {
      let locked;
      try { locked = await loadAndLockEffectiveMezzoTx(tx, id); }
      catch (error) { if (error instanceof LogisticaPolicyError && error.status === 404) return null; throw error; }
      if (!canAccessCentro(locked.effectiveCentroId, caller) || !inVisibleCentroSet(locked.effectiveCentroId, visibleIds)) throw new LogisticaPolicyError(403, "Risorsa non accessibile per il tuo perimetro");
      const versione = parseRequiredVersion(req.body?.versione);
      if (versione == null) throw new LogisticaPolicyError(400, "versione obbligatoria e valida");
      const [row] = await tx.update(mezziTable).set({ stato: "ritirato", versione: sql`${mezziTable.versione} + 1`, dataAggiornamento: new Date() })
        .where(and(eq(mezziTable.id, id), eq(mezziTable.versione, versione))).returning({ id: mezziTable.id, versione: mezziTable.versione });
      if (!row) throw new LogisticaPolicyError(409, "La risorsa è stata aggiornata da un altro operatore");
      await auditLogistica(tx, req, { entita: "mezzo", id, azione: "ritiro", precedente: { versione: locked.mezzo.versione, stato: locked.mezzo.stato }, nuovo: { versione: row.versione, stato: "ritirato" } });
      return row;
    });
    if (!result) { res.status(204).send(); return; }
    res.status(200).json({ ritirato: true, versione: result.versione });
  } catch (error) {
    if (error instanceof LogisticaPolicyError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

export default router;
