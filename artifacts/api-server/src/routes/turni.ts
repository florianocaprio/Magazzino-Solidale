import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  turniTable,
  turniVolontariTable,
  volontariTable,
  centriAscoltoTable,
  mezziTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray, asc, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  canAccessCentro,
  visibleCentroIds,
  inVisibleCentroSet,
  idSetScopeFilter,
} from "../lib/centroScope";

const router: IRouter = Router();

type VolInput = { volontarioId: number; ruolo?: string | null };

async function buildTurno(id: number) {
  const [t] = await db
    .select({
      t: turniTable,
      centroNome: centriAscoltoTable.nome,
      mezzoCodice: mezziTable.codice,
      mezzoTipo: mezziTable.tipo,
    })
    .from(turniTable)
    .leftJoin(centriAscoltoTable, eq(turniTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(mezziTable, eq(turniTable.mezzoId, mezziTable.id))
    .where(eq(turniTable.id, id));
  if (!t) return null;
  const vols = await db
    .select({ v: turniVolontariTable, nome: volontariTable.nome, cognome: volontariTable.cognome })
    .from(turniVolontariTable)
    .leftJoin(volontariTable, eq(turniVolontariTable.volontarioId, volontariTable.id))
    .where(eq(turniVolontariTable.turnoId, id));
  return {
    id: t.t.id,
    centroAscoltoId: t.t.centroAscoltoId,
    centroAscoltoNome: t.centroNome ?? null,
    data: t.t.data,
    fascia: t.t.fascia,
    mezzoId: t.t.mezzoId ?? null,
    mezzoCodice: t.mezzoCodice ?? null,
    mezzoTipo: t.mezzoTipo ?? null,
    volontari: vols.map((r) => ({
      volontarioId: r.v.volontarioId,
      volontarioNome: r.nome && r.cognome ? `${r.cognome} ${r.nome}` : null,
      ruolo: r.v.ruolo ?? null,
    })),
  };
}

router.get("/turni", async (req, res) => {
  const { da, a, centroAscoltoId } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (da) conditions.push(gte(turniTable.data, da));
  if (a) conditions.push(lte(turniTable.data, a));

  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(turniTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(turniTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  // Città axis: a turno's città derives from its centro (centro is NOT NULL here).
  const cittaFilter = idSetScopeFilter(
    turniTable.centroAscoltoId,
    await visibleCentroIds(callerCittaId(req)),
  );
  if (cittaFilter) conditions.push(cittaFilter);

  const turni = await db
    .select({
      t: turniTable,
      centroNome: centriAscoltoTable.nome,
      mezzoCodice: mezziTable.codice,
      mezzoTipo: mezziTable.tipo,
    })
    .from(turniTable)
    .leftJoin(centriAscoltoTable, eq(turniTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(mezziTable, eq(turniTable.mezzoId, mezziTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(turniTable.data));

  const ids = turni.map((r) => r.t.id);
  const vols = ids.length
    ? await db
        .select({ v: turniVolontariTable, nome: volontariTable.nome, cognome: volontariTable.cognome })
        .from(turniVolontariTable)
        .leftJoin(volontariTable, eq(turniVolontariTable.volontarioId, volontariTable.id))
        .where(inArray(turniVolontariTable.turnoId, ids))
    : [];

  res.json(
    turni.map((r) => ({
      id: r.t.id,
      centroAscoltoId: r.t.centroAscoltoId,
      centroAscoltoNome: r.centroNome ?? null,
      data: r.t.data,
      fascia: r.t.fascia,
      mezzoId: r.t.mezzoId ?? null,
      mezzoCodice: r.mezzoCodice ?? null,
      mezzoTipo: r.mezzoTipo ?? null,
      volontari: vols
        .filter((x) => x.v.turnoId === r.t.id)
        .map((x) => ({
          volontarioId: x.v.volontarioId,
          volontarioNome: x.nome && x.cognome ? `${x.cognome} ${x.nome}` : null,
          ruolo: x.v.ruolo ?? null,
        })),
    })),
  );
});

router.put("/turni", async (req, res) => {
  const body = req.body as {
    centroAscoltoId?: number;
    data?: string;
    fascia?: string;
    mezzoId?: number | null;
    volontari?: VolInput[];
  };
  const caller = callerCentroId(req);
  const centroAscoltoId = caller != null ? caller : body.centroAscoltoId;
  if (centroAscoltoId == null || !body.data || !body.fascia) {
    res.status(400).json({ error: "centroAscoltoId, data e fascia sono obbligatori" });
    return;
  }
  if (caller == null
      && !inVisibleCentroSet(centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const mezzoId = Number.isInteger(body.mezzoId) ? (body.mezzoId as number) : null;
  // IDOR guard: the assigned mezzo must be universal (centroAscoltoId NULL) OR
  // belong to the turno's centro — mirror the volontari guard so a scoped caller
  // can't attach an out-of-scope vehicle and read its codice/tipo back via GET.
  if (mezzoId != null) {
    const [m] = await db
      .select({ id: mezziTable.id, centroAscoltoId: mezziTable.centroAscoltoId })
      .from(mezziTable)
      .where(eq(mezziTable.id, mezzoId));
    if (!m || (m.centroAscoltoId != null && m.centroAscoltoId !== centroAscoltoId)) {
      res.status(403).json({ error: "Mezzo non assegnabile a questo centro" });
      return;
    }
    // Anti-doppia-prenotazione: lo stesso mezzo non può essere usato in due turni
    // nella stessa data + fascia (anche se di centri diversi). Il turno che si sta
    // aggiornando è quello con stesso (centro, data, fascia), quindi un conflitto è
    // un QUALSIASI altro turno con quel mezzo nello slot — lo individuo per centro
    // diverso (lo slot è unico per centro+data+fascia).
    const sameSlot = await db
      .select({ id: turniTable.id, centroAscoltoId: turniTable.centroAscoltoId })
      .from(turniTable)
      .where(
        and(
          eq(turniTable.data, body.data!),
          eq(turniTable.fascia, body.fascia!),
          eq(turniTable.mezzoId, mezzoId),
        ),
      );
    if (sameSlot.some((s) => s.centroAscoltoId !== centroAscoltoId)) {
      res.status(409).json({ error: "Mezzo già assegnato a un altro turno in questa data e fascia" });
      return;
    }
  }
  const rawVolontari = Array.isArray(body.volontari) ? body.volontari : [];
  // Dedupe by volontarioId (last ruolo wins) so the same volunteer can't be
  // listed twice in one turno.
  const dedupMap = new Map<number, VolInput>();
  for (const v of rawVolontari) {
    if (Number.isInteger(v.volontarioId)) dedupMap.set(v.volontarioId, v);
  }
  const volontari = [...dedupMap.values()];
  const volIds = [...dedupMap.keys()];

  // IDOR guard: every assigned volontario must be assignable to this centro —
  // i.e. universal (centroAscoltoId NULL) OR belonging to the turno's centro.
  // Without this a scoped caller could attach out-of-scope volunteers and read
  // their names back via GET /turni (which joins volontari).
  if (volIds.length) {
    const found = await db
      .select({ id: volontariTable.id, centroAscoltoId: volontariTable.centroAscoltoId })
      .from(volontariTable)
      .where(inArray(volontariTable.id, volIds));
    const okIds = new Set(
      found
        .filter((v) => v.centroAscoltoId == null || v.centroAscoltoId === centroAscoltoId)
        .map((v) => v.id),
    );
    if (volIds.some((id) => !okIds.has(id))) {
      res.status(403).json({ error: "Uno o più volontari non sono assegnabili a questo centro" });
      return;
    }
  }

  // Find-or-create the (centro, data, fascia) slot and replace its volunteer set
  // atomically so a double-submit can't leave a partial state.
  const turnoId = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(turniTable)
      .where(
        and(
          eq(turniTable.centroAscoltoId, centroAscoltoId),
          eq(turniTable.data, body.data!),
          eq(turniTable.fascia, body.fascia!),
        ),
      );

    let id: number;
    if (existing) {
      id = existing.id;
      await tx.update(turniTable).set({ mezzoId }).where(eq(turniTable.id, id));
    } else {
      const [created] = await tx
        .insert(turniTable)
        .values({ centroAscoltoId, data: body.data!, fascia: body.fascia!, mezzoId })
        .returning();
      id = created.id;
    }

    await tx.delete(turniVolontariTable).where(eq(turniVolontariTable.turnoId, id));
    if (volontari.length) {
      await tx.insert(turniVolontariTable).values(
        volontari.map((v) => ({ turnoId: id, volontarioId: v.volontarioId, ruolo: v.ruolo ?? null })),
      );
    } else {
      // No volunteers left → drop the empty slot.
      await tx.delete(turniTable).where(eq(turniTable.id, id));
    }
    return id;
  });

  if (volontari.length) {
    res.json(await buildTurno(turnoId));
    return;
  }

  const [centro] = await db
    .select({ nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoId));
  res.json({
    id: turnoId,
    centroAscoltoId,
    centroAscoltoNome: centro?.nome ?? null,
    data: body.data,
    fascia: body.fascia,
    mezzoId: null,
    mezzoCodice: null,
    mezzoTipo: null,
    volontari: [],
  });
});

router.delete("/turni/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [current] = await db.select().from(turniTable).where(eq(turniTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(current.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (callerCentroId(req) == null
      && !inVisibleCentroSet(current.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  await db.delete(turniVolontariTable).where(eq(turniVolontariTable.turnoId, id));
  await db.delete(turniTable).where(eq(turniTable.id, id));
  res.status(204).end();
});

export default router;
