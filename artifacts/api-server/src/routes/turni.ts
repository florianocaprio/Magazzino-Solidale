import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import {
  turniTable,
  turniConsegneTable,
  turniVolontariTable,
  volontariTable,
  centriAscoltoTable,
  mezziTable,
  ruoliVolontariTable,
} from "@workspace/db";
import { eq, and, gte, lte, inArray, asc, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
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
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import {
  assertMezzoAssignableTx,
  assertVolontarioAssignableTx,
  isFasciaTurno,
  isLogisticaUniqueViolation,
  LogisticaPolicyError,
  parseRequiredVersion,
} from "../lib/logisticaPolicy";
import { auditLogistica } from "../lib/logisticaAudit";

const router: IRouter = Router();

router.use("/turni", requireModulo("CENTRO_ASCOLTO"));

type VolInput = { volontarioId: number; ruolo?: string | null };

function toIntOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

function trimText(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function isTurnoUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error != null &&
    "code" in error &&
    (error as { code?: string }).code === "23505"
  );
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
    !inVisibleCentroSet(
      centroAscoltoId,
      await visibleCentroIds(callerAreaOperativaId(req)),
    )
  ) {
    return { status: 403, error: "Centro non accessibile per la tua area operativa" };
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
    .leftJoin(
      centriAscoltoTable,
      eq(turniTable.centroAscoltoId, centriAscoltoTable.id),
    )
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
    .leftJoin(
      volontariTable,
      eq(turniVolontariTable.volontarioId, volontariTable.id),
    )
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
    stato: t.t.stato,
    motivoAnnullamento: t.t.motivoAnnullamento ?? null,
    versione: t.t.versione,
    dataAggiornamento: t.t.dataAggiornamento.toISOString(),
    volontari: vols.map((r) => ({
      volontarioId: r.v.volontarioId,
      volontarioNome: r.nome && r.cognome ? `${r.cognome} ${r.nome}` : null,
      volontarioStatoApprovazione: r.statoApprovazione ?? null,
      ruolo: r.v.ruolo ?? null,
    })),
  };
}

router.get("/turni", requirePermission("logistica.turni.view"), async (req, res) => {
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
  // Area Operativa axis: a turno's area operativa derives from its centro (centro is NOT NULL here).
  const areaOperativaFilter = idSetScopeFilter(
    turniTable.centroAscoltoId,
    await visibleCentroIds(callerAreaOperativaId(req)),
  );
  if (areaOperativaFilter) conditions.push(areaOperativaFilter);

  const turni = await db
    .select({
      t: turniTable,
      centroNome: centriAscoltoTable.nome,
      mezzoCodice: mezziTable.codice,
      mezzoTipo: mezziTable.tipo,
      mezzoStatoApprovazione: mezziTable.statoApprovazione,
    })
    .from(turniTable)
    .leftJoin(
      centriAscoltoTable,
      eq(turniTable.centroAscoltoId, centriAscoltoTable.id),
    )
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
        .leftJoin(
          volontariTable,
          eq(turniVolontariTable.volontarioId, volontariTable.id),
        )
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
      stato: r.t.stato,
      motivoAnnullamento: r.t.motivoAnnullamento ?? null,
      versione: r.t.versione,
      dataAggiornamento: r.t.dataAggiornamento.toISOString(),
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

router.put("/turni", requirePermission("logistica.turni.manage"), async (req, res) => {
  const body = req.body as {
    centroAscoltoId?: number;
    data?: string;
    fascia?: string;
    mezzoId?: number | null;
    volontari?: VolInput[];
    versione?: number;
  };
  const caller = callerCentroId(req);
  const centroAscoltoId = caller != null ? caller : body.centroAscoltoId;
  if (centroAscoltoId == null || !body.data || !body.fascia) {
    res
      .status(400)
      .json({ error: "centroAscoltoId, data e fascia sono obbligatori" });
    return;
  }
  if (!isFasciaTurno(body.fascia)) {
    res.status(400).json({ error: "fascia non valida: usare 09-13, 14-18 o 18-20" });
    return;
  }
  if (
    caller == null &&
    !inVisibleCentroSet(
      centroAscoltoId,
      await visibleCentroIds(callerAreaOperativaId(req)),
    )
  ) {
    res.status(403).json({ error: "Centro non accessibile per la tua area operativa" });
    return;
  }
  const mezzoId = Number.isInteger(body.mezzoId) ? (body.mezzoId as number) : null;
  const rawVolontari = Array.isArray(body.volontari) ? body.volontari : [];
  // Dedupe by volontarioId (last ruolo wins) so the same volunteer can't be
  // listed twice in one turno.
  const dedupMap = new Map<number, VolInput>();
  for (const v of rawVolontari) {
    if (Number.isInteger(v.volontarioId)) dedupMap.set(v.volontarioId, v);
  }

  let turnoId: number | null;
  try {
    turnoId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtext('turno-centro-slot'),
        hashtext(${`${centroAscoltoId}:${body.data}:${body.fascia}`})
      )`);
      const [existing] = await tx
        .select()
        .from(turniTable)
        .where(
          and(
            eq(turniTable.centroAscoltoId, centroAscoltoId),
            eq(turniTable.data, body.data!),
            eq(turniTable.fascia, body.fascia!),
          ),
        )
        .for("update");
      const existingVolontari = existing
        ? await tx
            .select({
              volontarioId: turniVolontariTable.volontarioId,
              ruolo: turniVolontariTable.ruolo,
            })
            .from(turniVolontariTable)
            .where(eq(turniVolontariTable.turnoId, existing.id))
        : [];
      const sources = existing ? await tx.select().from(turniConsegneTable).where(eq(turniConsegneTable.turnoId, existing.id)) : [];
      const effectiveVolontariMap = new Map(dedupMap);
      for (const source of sources) if (source.volontarioId != null && !effectiveVolontariMap.has(source.volontarioId)) {
        effectiveVolontariMap.set(source.volontarioId, { volontarioId: source.volontarioId, ruolo: "Consegna" });
      }
      const effectiveVolontari = [...effectiveVolontariMap.values()];
      const sourceMezzi = [...new Set(sources.flatMap((source) => source.mezzoId == null ? [] : [source.mezzoId]))];
      if (sourceMezzi.length > 1) throw new LogisticaPolicyError(409, "Il turno riceve mezzi diversi da più consegne");
      if (sourceMezzi[0] != null && mezzoId != null && sourceMezzi[0] !== mezzoId) throw new LogisticaPolicyError(409, "Il mezzo richiesto è vincolato da una consegna pianificata");
      const effectiveMezzoId = sourceMezzi[0] ?? mezzoId;

      if (existing?.stato === "completato") {
        throw new LogisticaPolicyError(409, "Un turno completato non può essere riscritto");
      }
      if (existing) {
        const versione = parseRequiredVersion(body.versione);
        if (versione == null) {
          throw new LogisticaPolicyError(400, "versione obbligatoria per aggiornare il turno");
        }
        if (versione !== existing.versione) {
          throw new LogisticaPolicyError(409, "La pianificazione è stata aggiornata da un altro operatore");
        }
      }

      if (effectiveMezzoId != null) {
        await assertMezzoAssignableTx(tx, {
          mezzoId: effectiveMezzoId,
          centroAscoltoId,
          data: body.data!,
          fascia: body.fascia as "09-13" | "14-18" | "18-20",
          excludeTurnoId: existing?.id,
        });
      }
      for (const volontarioId of effectiveVolontariMap.keys()) await assertVolontarioAssignableTx(tx, {
        volontarioId, centroAscoltoId, data: body.data!, fascia: body.fascia as "09-13" | "14-18" | "18-20", excludeTurnoId: existing?.id,
      });

      if (!existing && effectiveVolontari.length === 0 && effectiveMezzoId == null) return null;

      let id: number;
      if (existing) {
        id = existing.id;
        const [updated] = await tx
          .update(turniTable)
          .set({
            mezzoId: effectiveMezzoId,
            mezzoManuale: mezzoId != null,
            stato: effectiveVolontari.length === 0 && effectiveMezzoId == null ? "annullato" : "pianificato",
            motivoAnnullamento:
              effectiveVolontari.length === 0 && effectiveMezzoId == null
                ? "Tutte le assegnazioni sono state rimosse"
                : null,
            versione: sql`${turniTable.versione} + 1`,
            dataAggiornamento: new Date(),
          })
          .where(and(eq(turniTable.id, id), eq(turniTable.versione, existing.versione)))
          .returning({ versione: turniTable.versione });
        if (!updated) {
          throw new LogisticaPolicyError(409, "La pianificazione è stata aggiornata da un altro operatore");
        }
      } else {
        const [created] = await tx
          .insert(turniTable)
          .values({
            centroAscoltoId,
            data: body.data!,
            fascia: body.fascia!,
            mezzoId: effectiveMezzoId,
            mezzoManuale: mezzoId != null,
            stato: "pianificato",
          })
          .returning();
        id = created.id;
      }

      await tx
        .delete(turniVolontariTable)
        .where(eq(turniVolontariTable.turnoId, id));
      if (effectiveVolontari.length > 0) {
        await tx
          .insert(turniVolontariTable)
          .values(
            effectiveVolontari.map((v) => ({
              turnoId: id,
              volontarioId: v.volontarioId,
              ruolo: v.ruolo ?? null,
              manuale: dedupMap.has(v.volontarioId),
            })),
          );
      }
      await auditLogistica(tx, req, {
        entita: "turno",
        id,
        azione: existing
          ? effectiveVolontari.length === 0 && effectiveMezzoId == null
            ? "annullamento"
            : existing.stato === "annullato"
              ? "riattivazione"
              : "modifica_assegnazioni"
          : "creazione",
        precedente: existing
          ? {
              stato: existing.stato,
              mezzoId: existing.mezzoId,
              volontari: existingVolontari,
              versione: existing.versione,
            }
          : null,
        nuovo: {
          stato: effectiveVolontari.length === 0 && effectiveMezzoId == null ? "annullato" : "pianificato",
          mezzoId: effectiveMezzoId,
          volontari: effectiveVolontari.map((v) => ({ volontarioId: v.volontarioId, ruolo: v.ruolo ?? null })),
          versione: existing ? existing.versione + 1 : 1,
        },
      });
      return id;
    });
  } catch (error) {
    if (error instanceof LogisticaPolicyError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (isTurnoUniqueViolation(error) || isLogisticaUniqueViolation(error)) {
      res.status(409).json({
        error:
          "Slot, mezzo o volontario già assegnato da un'altra operazione concorrente",
      });
      return;
    }
    throw error;
  }

  if (turnoId == null) {
    res.status(204).end();
    return;
  }
  res.json(await buildTurno(turnoId));
});

router.post(
  "/turni/volontari-pending",
  requirePermission("logistica.turni.manage"),
  requirePermission("logistica.volontari.manage"),
  async (req, res) => {
  const resolved = await resolveCentroAscoltoId(req, req.body?.centroAscoltoId);
  if ("error" in resolved) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }
  const nome = trimText(req.body?.nome);
  const cognome = trimText(req.body?.cognome);
  const matricola = trimText(req.body?.matricola);
  if (!nome || !cognome || !matricola) {
    res
      .status(400)
      .json({ error: "nome, cognome e matricola sono obbligatori" });
    return;
  }
  if (await matricolaVolontarioGiaUsata(matricola)) {
    res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola));
    return;
  }
  const ruoloVolontarioId = toIntOrNull(req.body?.ruoloVolontarioId);
  if (ruoloVolontarioId == null) {
    res.status(400).json({ error: "ruoloVolontarioId obbligatorio" });
    return;
  }
  const [ruolo] = await db
    .select({ id: ruoliVolontariTable.id, nome: ruoliVolontariTable.nome })
    .from(ruoliVolontariTable)
    .where(and(eq(ruoliVolontariTable.id, ruoloVolontarioId), eq(ruoliVolontariTable.attivo, true)));
  if (!ruolo) {
    res.status(400).json({ error: "Ruolo volontario non attivo o non valido" });
    return;
  }
  let created: typeof volontariTable.$inferSelect | null = null;
  try {
    created = await db.transaction(async (tx) => {
      const [row] = await tx.insert(volontariTable).values({
        nome,
        cognome,
        matricola,
        centroAscoltoId: resolved.centroAscoltoId,
        telefono: trimText(req.body?.telefono) || null,
        email: trimText(req.body?.email) || null,
        ruolo: ruolo.nome,
        ruoloVolontarioId: ruolo.id,
        patente: Boolean(req.body?.patente),
        mezzoPersonale: false,
        maxConsegneTurno: 5,
        attivo: false,
        statoApprovazione: "in_attesa",
        note: trimText(req.body?.note) || "Inserito da pianificazione turni",
      }).returning();
      await auditLogistica(tx, req, { entita: "volontario", id: row.id, azione: "creazione", nuovo: { origine: "turni", statoApprovazione: "in_attesa", attivo: false, versione: row.versione } });
      return row;
    });
  } catch (e) {
    if (isVolontarioMatricolaUniqueViolation(e)) {
      res
        .status(409)
        .json(await matricolaVolontarioDuplicataPayload(matricola));
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
    ruoloVolontarioId: created.ruoloVolontarioId,
    ruoloCatalogoNome: ruolo.nome,
    patente: created.patente,
    mezzoPersonale: created.mezzoPersonale,
    maxConsegneTurno: created.maxConsegneTurno,
    attivo: created.attivo,
    statoApprovazione: created.statoApprovazione,
    note: created.note ?? null,
    versione: created.versione,
    dataCreazione: created.dataCreazione.toISOString(),
    dataAggiornamento: created.dataAggiornamento.toISOString(),
  });
  },
);

router.post(
  "/turni/mezzi-pending",
  requirePermission("logistica.turni.manage"),
  requirePermission("logistica.mezzi.manage"),
  async (req, res) => {
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
  const codice = trimText(req.body?.codice) || (await nextMezzoCodice());
  const capacitaColli = toIntOrNull(req.body?.capacitaColli);
  const capacitaKg = req.body?.capacitaKg != null && req.body.capacitaKg !== "" ? Number(req.body.capacitaKg) : null;
  if ((capacitaColli != null && capacitaColli < 0) || (capacitaKg != null && (!Number.isFinite(capacitaKg) || capacitaKg < 0))) {
    res.status(400).json({ error: "Le capacità devono essere maggiori o uguali a zero" });
    return;
  }
  let created: typeof mezziTable.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const codiceNormalizzato = codice.toUpperCase();
      await tx.execute(sql`SELECT pg_advisory_xact_lock(
        hashtext('mezzo-codice'), hashtext(${codiceNormalizzato})
      )`);
      const [duplicate] = await tx
        .select({ id: mezziTable.id })
        .from(mezziTable)
        .where(sql`upper(trim(${mezziTable.codice})) = ${codiceNormalizzato}`)
        .limit(1);
      if (duplicate) throw new Error("DUPLICATE_MEZZO_CODICE");
      const [row] = await tx.insert(mezziTable).values({
      codice: codiceNormalizzato,
      tipo,
      targa: trimText(req.body?.targa).toUpperCase().replace(/\s+/g, " ") || null,
      proprieta: trimText(req.body?.proprieta) || "associazione",
      proprietarioNome: trimText(req.body?.proprietarioNome) || null,
      centroAscoltoId: resolved.centroAscoltoId,
      capacitaColli,
      capacitaKg: capacitaKg == null ? null : String(capacitaKg),
      descrizione: trimText(req.body?.descrizione) || null,
      stato: "non_disponibile",
      statoApprovazione: "in_attesa",
      note: trimText(req.body?.note) || "Inserito da pianificazione turni",
      }).returning();
      await auditLogistica(tx, req, { entita: "mezzo", id: row.id, azione: "creazione", nuovo: { origine: "turni", statoApprovazione: "in_attesa", stato: "non_disponibile", versione: row.versione } });
      return row;
    });
  } catch (error) {
    if (error instanceof Error && error.message === "DUPLICATE_MEZZO_CODICE") {
      res.status(409).json({ error: "Codice mezzo già in uso" });
      return;
    }
    if (isLogisticaUniqueViolation(error)) {
      res.status(409).json({ error: "Codice mezzo già in uso" });
      return;
    }
    throw error;
  }
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
    versione: created.versione,
    dataCreazione: created.dataCreazione.toISOString(),
    dataAggiornamento: created.dataAggiornamento.toISOString(),
  });
  },
);

router.patch(
  "/turni/:id/stato",
  requirePermission("logistica.turni.manage"),
  async (req, res) => {
    const id = parseInt(String(req.params.id));
    const target = trimText(req.body?.stato);
    const versione = parseRequiredVersion(req.body?.versione);
    if (versione == null) {
      res.status(400).json({ error: "versione obbligatoria e valida" });
      return;
    }
    const transitions: Record<string, string[]> = {
      pianificato: ["confermato", "annullato"],
      confermato: ["completato", "annullato"],
      completato: [],
      annullato: [],
    };
    try {
      await db.transaction(async (tx) => {
        const [current] = await tx.select().from(turniTable).where(eq(turniTable.id, id)).for("update");
        if (!current) throw new LogisticaPolicyError(404, "Not found");
        if (!canAccessCentro(current.centroAscoltoId, callerCentroId(req))) {
          throw new LogisticaPolicyError(403, "Risorsa non accessibile per il tuo centro");
        }
        if (!inVisibleCentroSet(current.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
          throw new LogisticaPolicyError(403, "Risorsa non accessibile per la tua area operativa");
        }
        if (!transitions[current.stato]?.includes(target)) {
          throw new LogisticaPolicyError(409, "Transizione di stato non consentita");
        }
        if (target === "annullato" && !trimText(req.body?.motivoAnnullamento)) {
          throw new LogisticaPolicyError(400, "motivoAnnullamento obbligatorio");
        }
        if (target === "confermato") {
          const volontari = await tx.select({ volontarioId: turniVolontariTable.volontarioId }).from(turniVolontariTable).where(eq(turniVolontariTable.turnoId, id));
          for (const volontario of volontari) {
            await assertVolontarioAssignableTx(tx, { volontarioId: volontario.volontarioId, centroAscoltoId: current.centroAscoltoId, data: current.data, fascia: current.fascia as "09-13" | "14-18" | "18-20", excludeTurnoId: id });
          }
          if (current.mezzoId != null) {
            await assertMezzoAssignableTx(tx, { mezzoId: current.mezzoId, centroAscoltoId: current.centroAscoltoId, data: current.data, fascia: current.fascia as "09-13" | "14-18" | "18-20", excludeTurnoId: id });
          }
        }
        const [updated] = await tx.update(turniTable).set({
          stato: target,
          mezzoId: target === "annullato" ? null : current.mezzoId,
          motivoAnnullamento: target === "annullato" ? trimText(req.body?.motivoAnnullamento) : null,
          versione: sql`${turniTable.versione} + 1`,
          dataAggiornamento: new Date(),
        }).where(and(eq(turniTable.id, id), eq(turniTable.versione, versione))).returning({ versione: turniTable.versione });
        if (!updated) throw new LogisticaPolicyError(409, "La pianificazione è stata aggiornata da un altro operatore");
        await auditLogistica(tx, req, { entita: "turno", id, azione: target, precedente: { stato: current.stato, versione: current.versione }, nuovo: { stato: target, versione: updated.versione }, note: target === "annullato" ? trimText(req.body?.motivoAnnullamento) : null });
      });
    } catch (error) {
      if (error instanceof LogisticaPolicyError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    res.json(await buildTurno(id));
  },
);

router.delete("/turni/:id", requirePermission("logistica.turni.manage"), async (req, res) => {
  const id = parseInt(String(req.params.id));
  const [current] = await db
    .select()
    .from(turniTable)
    .where(eq(turniTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessCentro(current.centroAscoltoId, callerCentroId(req))) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (
    !inVisibleCentroSet(
      current.centroAscoltoId,
      await visibleCentroIds(callerAreaOperativaId(req)),
    )
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua area operativa" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) {
    res.status(400).json({ error: "versione obbligatoria e valida" });
    return;
  }
  if (current.stato === "completato" || current.stato === "annullato") {
    res.status(409).json({ error: "Transizione di stato non consentita" });
    return;
  }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(turniTable).set({ stato: "annullato", mezzoId: null, motivoAnnullamento: trimText(req.body?.motivoAnnullamento) || "Annullamento operativo", versione: sql`${turniTable.versione} + 1`, dataAggiornamento: new Date() }).where(and(eq(turniTable.id, id), eq(turniTable.versione, versione))).returning({ versione: turniTable.versione });
    if (!row) return [];
    await auditLogistica(tx, req, { entita: "turno", id, azione: "annullamento", precedente: { stato: current.stato, versione: current.versione }, nuovo: { stato: "annullato", versione: row.versione } });
    return [row];
  });
  if (!updated) { res.status(409).json({ error: "La pianificazione è stata aggiornata da un altro operatore" }); return; }
  res.status(200).json(await buildTurno(id));
});

export default router;
