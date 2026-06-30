import { Router, type IRouter, type Request } from "express";
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
import {
  isVolontarioMatricolaUniqueViolation,
  matricolaVolontarioDuplicataPayload,
  matricolaVolontarioGiaUsata,
} from "../lib/volontariMatricola";

const router: IRouter = Router();

type VolInput = { volontarioId: number; ruolo?: string | null };

function toIntOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function trimText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

async function resolveCentroAscoltoId(
  req: Request,
  rawCentroAscoltoId: unknown,
): Promise<{ centroAscoltoId: number } | { status: number; error: string }> {
  const caller = callerCentroId(req);
  const centroAscoltoId = caller ?? toIntOrNull(rawCentroAscoltoId);
  if (centroAscoltoId == null) {
    return { status: 400, error: "centroAscoltoId obbligatorio" };
  }
  if (
    caller == null &&
    !inVisibleCentroSet(centroAscoltoId, await visibleCentroIds(callerCittaId(req)))
  ) {
    return { status: 403, error: "Centro non accessibile per la tua città" };
  }
  return { centroAscoltoId };
}

async function centroNome(centroAscoltoId: number): Promise<string | null> {
  const [centro] = await db
    .select({ nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centroAscoltoId));
  return centro?.nome ?? null;
}

async function nextMezzoCodice(): Promise<string> {
  const rows = await db.select({ codice: mezziTable.codice }).from(mezziTable);
  let max = 0;
  for (const r of rows) {
    const m = /^MEZ-(\d+)$/.exec(r.codice);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `MEZ-${String(max + 1).padStart(3, "0")}`;
}

async function buildTurno(id: number) {
  const [t] = await db
    .select({
      t: turniTable,
      centroNome: centriAscoltoTable.nome,
      mezzoCodice: mezziTable.codice,
      mezzoTipo: mezziTable.tipo,
      mezzoStatoApprovazione: mezziTable.statoApprovazione,
    })
    .from(turniTable)
    .leftJoin(centriAscoltoTable, eq(turniTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(mezziTable, eq(turniTable.mezzoId, mezziTable.id))
    .where(eq(turniTable.id, id));
  if (!t) return null;
  const vols = await db
    .select({
      v: turniVolontariTable,
      nome: volontariTable.nome,
      cognome: volontariTable.cognome,
      statoApprovazione: volontariTable.statoApprovazione,
    })
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
    mezzoStatoApprovazione: t.mezzoStatoApprovazione ?? null,
    volontari: vols.map((r) => ({
      volontarioId: r.v.volontarioId,
      volontarioNome: r.nome && r.cognome ? `${r.cognome} ${r.nome}` : null,
      volontarioStatoApprovazione: r.statoApprovazione ?? null,
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
      mezzoStatoApprovazione: mezziTable.statoApprovazione,
    })
    .from(turniTable)
    .leftJoin(centriAscoltoTable, eq(turniTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(mezziTable, eq(turniTable.mezzoId, mezziTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(turniTable.data));

  const ids = turni.map((r) => r.t.id);
  const vols = ids.length
    ? await db
        .select({
          v: turniVolontariTable,
          nome: volontariTable.nome,
          cognome: volontariTable.cognome,
          statoApprovazione: volontariTable.statoApprovazione,
        })
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
      mezzoStatoApprovazione: r.mezzoStatoApprovazione ?? null,
      volontari: vols
        .filter((x) => x.v.turnoId === r.t.id)
        .map((x) => ({
          volontarioId: x.v.volontarioId,
          volontarioNome: x.nome && x.cognome ? `${x.cognome} ${x.nome}` : null,
          volontarioStatoApprovazione: x.statoApprovazione ?? null,
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
      .select({
        id: mezziTable.id,
        centroAscoltoId: mezziTable.centroAscoltoId,
        statoApprovazione: mezziTable.statoApprovazione,
      })
      .from(mezziTable)
      .where(eq(mezziTable.id, mezzoId));
    if (
      !m ||
      m.statoApprovazione === "respinto" ||
      (m.centroAscoltoId != null && m.centroAscoltoId !== centroAscoltoId)
    ) {
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
      .select({
        id: volontariTable.id,
        centroAscoltoId: volontariTable.centroAscoltoId,
        statoApprovazione: volontariTable.statoApprovazione,
      })
      .from(volontariTable)
      .where(inArray(volontariTable.id, volIds));
    const okIds = new Set(
      found
        .filter((v) =>
          v.statoApprovazione !== "respinto" &&
          (v.centroAscoltoId == null || v.centroAscoltoId === centroAscoltoId)
        )
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
    } else if (mezzoId == null) {
      // No volunteers and no mezzo left -> drop the empty slot.
      await tx.delete(turniTable).where(eq(turniTable.id, id));
    }
    return id;
  });

  if (volontari.length || mezzoId != null) {
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
    mezzoStatoApprovazione: null,
    volontari: [],
  });
});

router.post("/turni/volontari-pending", async (req, res) => {
  const resolved = await resolveCentroAscoltoId(req, req.body?.centroAscoltoId);
  if ("error" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const nome = trimText(req.body?.nome);
  const cognome = trimText(req.body?.cognome);
  const matricola = trimText(req.body?.matricola);
  if (!nome || !cognome || !matricola) {
    res.status(400).json({ error: "nome, cognome e matricola sono obbligatori" });
    return;
  }
  if (await matricolaVolontarioGiaUsata(matricola)) {
    res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola));
    return;
  }
  let created: typeof volontariTable.$inferSelect | null = null;
  try {
    [created] = await db
      .insert(volontariTable)
      .values({
        nome,
        cognome,
        matricola,
        centroAscoltoId: resolved.centroAscoltoId,
        telefono: trimText(req.body?.telefono) || null,
        email: trimText(req.body?.email) || null,
        ruolo: trimText(req.body?.ruolo) || "volontario",
        patente: Boolean(req.body?.patente),
        mezzoPersonale: false,
        maxConsegneTurno: 5,
        attivo: false,
        statoApprovazione: "in_attesa",
        note: trimText(req.body?.note) || "Inserito da pianificazione turni",
      })
      .returning();
  } catch (e) {
    if (isVolontarioMatricolaUniqueViolation(e)) {
      res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola));
      return;
    }
    throw e;
  }
  if (!created) {
    res.status(500).json({ error: "Creazione volontario non riuscita" });
    return;
  }
  res.status(201).json({
    id: created.id,
    nome: created.nome,
    cognome: created.cognome,
    matricola: created.matricola ?? null,
    centroAscoltoId: created.centroAscoltoId ?? null,
    centroAscoltoNome: await centroNome(resolved.centroAscoltoId),
    telefono: created.telefono ?? null,
    email: created.email ?? null,
    ruolo: created.ruolo,
    patente: created.patente,
    mezzoPersonale: created.mezzoPersonale,
    maxConsegneTurno: created.maxConsegneTurno,
    attivo: created.attivo,
    statoApprovazione: created.statoApprovazione,
    note: created.note ?? null,
    dataCreazione: created.dataCreazione.toISOString(),
  });
});

router.post("/turni/mezzi-pending", async (req, res) => {
  const resolved = await resolveCentroAscoltoId(req, req.body?.centroAscoltoId);
  if ("error" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const tipo = trimText(req.body?.tipo);
  if (!tipo) {
    res.status(400).json({ error: "tipo è obbligatorio" });
    return;
  }
  const codice = trimText(req.body?.codice) || await nextMezzoCodice();
  const [created] = await db
    .insert(mezziTable)
    .values({
      codice,
      tipo,
      targa: trimText(req.body?.targa) || null,
      proprieta: trimText(req.body?.proprieta) || "associazione",
      proprietarioNome: trimText(req.body?.proprietarioNome) || null,
      centroAscoltoId: resolved.centroAscoltoId,
      capacitaColli: toIntOrNull(req.body?.capacitaColli),
      capacitaKg: req.body?.capacitaKg != null && req.body.capacitaKg !== "" ? String(req.body.capacitaKg) : null,
      descrizione: trimText(req.body?.descrizione) || null,
      stato: "non_disponibile",
      statoApprovazione: "in_attesa",
      note: trimText(req.body?.note) || "Inserito da pianificazione turni",
    })
    .returning();
  const nomeCentro = await centroNome(resolved.centroAscoltoId);
  res.status(201).json({
    id: created.id,
    codice: created.codice,
    tipo: created.tipo,
    targa: created.targa ?? null,
    proprieta: created.proprieta,
    proprietarioNome: created.proprietarioNome ?? null,
    volontarioId: created.volontarioId ?? null,
    volontarioNome: null,
    centroAscoltoId: created.centroAscoltoId ?? null,
    effectiveCentroId: created.centroAscoltoId ?? null,
    effectiveCentroNome: nomeCentro,
    capacitaColli: created.capacitaColli ?? null,
    capacitaKg: created.capacitaKg ? parseFloat(created.capacitaKg) : null,
    descrizione: created.descrizione ?? null,
    stato: created.stato,
    statoApprovazione: created.statoApprovazione,
    scadenzaAssicurazione: created.scadenzaAssicurazione ?? null,
    scadenzaRevisione: created.scadenzaRevisione ?? null,
    note: created.note ?? null,
    dataCreazione: created.dataCreazione.toISOString(),
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
