import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { mezziTable, volontariTable, centriAscoltoTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, sql, inArray, or, desc, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  canAccessCentro,
  visibleCentroIds,
  inVisibleCentroSet,
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
  return r.m.volontarioId != null ? (r.volCentroId ?? null) : (r.m.centroAscoltoId ?? null);
}

/** SQL expression mirroring effectiveCentroOf for use in WHERE clauses. */
const effectiveCentroExpr = sql<number | null>`CASE WHEN ${mezziTable.volontarioId} IS NOT NULL THEN ${volontariTable.centroAscoltoId} ELSE ${mezziTable.centroAscoltoId} END`;

function effectiveCentroFilter(centroId: number | null): SQL | undefined {
  if (centroId == null) return undefined;
  return sql`(${effectiveCentroExpr} IS NULL OR ${effectiveCentroExpr} = ${centroId})`;
}

/**
 * Città boundary applied to the effective centro: the effective centro must be
 * NULL (shared) or belong to the set of centri visible to the caller's città.
 * `null` ids → città-global caller (no filtering); empty ids → only NULL.
 */
function effectiveCittaFilter(cittaCentroIds: number[] | null): SQL | undefined {
  if (cittaCentroIds == null) return undefined;
  if (cittaCentroIds.length === 0) return sql`${effectiveCentroExpr} IS NULL`;
  return or(
    sql`${effectiveCentroExpr} IS NULL`,
    inArray(effectiveCentroExpr, cittaCentroIds),
  );
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
    dataCreazione: r.m.dataCreazione.toISOString(),
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
async function volontarioCentroId(volontarioId: number): Promise<number | null> {
  const [v] = await db
    .select({ c: volontariTable.centroAscoltoId })
    .from(volontariTable)
    .where(eq(volontariTable.id, volontarioId));
  return v?.c ?? null;
}

router.get("/mezzi", async (req, res) => {
  const caller = callerCentroId(req);
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const rows = await baseSelect()
    .where(
      andScoped(
        effectiveCentroFilter(caller),
        effectiveCittaFilter(cittaCentroIds),
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
  cittaCentroIds: number[] | null,
): Promise<{ ownCentro: number | null } | { error: string }> {
  let ownCentro: number | null = body.centroAscoltoId ?? null;
  if (body.volontarioId != null) {
    // Volontario-owned: own centro is ignored/derived from the volontario.
    ownCentro = null;
  } else if (caller != null) {
    // Scoped, non-volontario-owned: lock to caller's centro.
    ownCentro = caller;
  }
  const effective =
    body.volontarioId != null ? await volontarioCentroId(body.volontarioId) : ownCentro;
  if (!canAccessCentro(effective, caller)) {
    return { error: "Mezzo non accessibile per il tuo centro" };
  }
  if (!inVisibleCentroSet(effective, cittaCentroIds)) {
    return { error: "Mezzo non accessibile per la tua città" };
  }
  return { ownCentro };
}

async function createMezzoOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ id: number } | { error: string; status?: number }> {
  const b = body as Record<string, any>;
  const caller = callerCentroId(req);
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const resolved = await resolveCentro(b, caller, cittaCentroIds);
  if ("error" in resolved) return { error: resolved.error, status: 403 };
  const baseValues = {
    ...(b as typeof mezziTable.$inferInsert),
    centroAscoltoId: resolved.ownCentro,
    capacitaKg: b.capacitaKg?.toString(),
  };
  const providedCodice = typeof b.codice === "string" ? b.codice.trim() : "";

  // Caller-provided codice: a duplicate is a clear client error, not a 500.
  if (providedCodice) {
    try {
      const [created] = await db
        .insert(mezziTable)
        .values({ ...baseValues, codice: providedCodice })
        .returning({ id: mezziTable.id });
      return { id: created.id };
    } catch (e) {
      if (isUniqueViolation(e)) return { error: `Codice "${providedCodice}" già in uso`, status: 409 };
      throw e;
    }
  }

  // Empty codice: auto-generate MEZ-NNN, retrying on collision under concurrency.
  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const codice = await nextMezCodice();
    try {
      const [created] = await db
        .insert(mezziTable)
        .values({ ...baseValues, codice })
        .returning({ id: mezziTable.id });
      return { id: created.id };
    } catch (e) {
      if (isUniqueViolation(e) && attempt < MAX_ATTEMPTS - 1) continue;
      if (isUniqueViolation(e)) return { error: "Impossibile generare un codice univoco per il mezzo, riprova", status: 409 };
      throw e;
    }
  }
  return { error: "Impossibile generare un codice univoco per il mezzo, riprova", status: 409 };
}

router.post("/mezzi", async (req, res) => {
  const r = await createMezzoOne(req.body, req);
  if ("error" in r) { res.status(r.status ?? 403).json({ error: r.error }); return; }
  res.status(201).json(await loadMezzo(r.id));
});

router.post("/mezzi/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createMezzoOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

router.get("/mezzi/:id", async (req, res) => {
  const [r] = await baseSelect().where(eq(mezziTable.id, parseInt(req.params.id)));
  if (!r) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(effectiveCentroOf(r), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(effectiveCentroOf(r), await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(fmt(r, await centroNomeOf(effectiveCentroOf(r))));
});

router.patch("/mezzi/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = callerCentroId(req);
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const [existing] = await baseSelect().where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(effectiveCentroOf(existing), caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(effectiveCentroOf(existing), cittaCentroIds)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  const body = req.body;
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
    cittaCentroIds,
  );
  if ("error" in resolved) {
    res.status(403).json({ error: resolved.error });
    return;
  }
  const update = {
    ...body,
    centroAscoltoId: resolved.ownCentro,
    capacitaKg: body.capacitaKg?.toString(),
  };
  await db.update(mezziTable).set(update).where(eq(mezziTable.id, id));
  res.json(await loadMezzo(id));
});

router.delete("/mezzi/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await baseSelect().where(eq(mezziTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(effectiveCentroOf(existing), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!inVisibleCentroSet(effectiveCentroOf(existing), await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(mezziTable).where(eq(mezziTable.id, id));
  res.status(204).send();
});

export default router;
