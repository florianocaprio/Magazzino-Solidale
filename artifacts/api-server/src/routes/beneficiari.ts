import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { beneficiariTable, nucleoFamiliareTable, interventiTable, consegneTable, centriAscoltoTable, cittaTable } from "@workspace/db";
import { runBulk } from "../lib/bulk";
import { eq, and, ilike, sql, desc, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  callerZonaUdsId,
  centroScopeFilter,
  cittaScopeFilter,
  zonaUdsScopeFilter,
  canAccessCentro,
  canAccessCitta,
  canAccessZonaUds,
  beneficiarioCentroId,
  beneficiarioCittaId,
  beneficiarioZonaUdsId,
} from "../lib/centroScope";

const router: IRouter = Router();

// Normalize a loosely-typed body flag to a real boolean so the città-boundary
// guard checks the same value that gets persisted (avoids `uds:"true"` /
// `uds:1` type-confusion bypasses on the unvalidated body).
function toBool(v: unknown): boolean {
  return v === true || v === "true" || v === "t" || v === "1" || v === 1 || v === "yes";
}

function fmtBenef(r: typeof beneficiariTable.$inferSelect, centroNome?: string | null, cittaNome?: string | null) {
  return {
    id: r.id,
    codice: r.codice,
    codiceFiscale: r.codiceFiscale ?? null,
    soprannome: r.soprannome ?? null,
    cognome: r.cognome,
    nome: r.nome,
    dataNascita: r.dataNascita ?? null,
    sesso: r.sesso ?? null,
    cittadinanza: r.cittadinanza ?? null,
    areaProvenienza: r.areaProvenienza ?? null,
    residenza: r.residenza ?? null,
    domicilio: r.domicilio ?? null,
    comune: r.comune ?? null,
    zonaMunicipio: r.zonaMunicipio ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    statoCivile: r.statoCivile ?? null,
    numComponenti: r.numComponenti,
    numFigliMaschi: r.numFigliMaschi,
    numFiglieFemmine: r.numFiglieFemmine,
    numMinori: r.numMinori,
    numAnziani: r.numAnziani,
    numDisabili: r.numDisabili,
    restrizioniAlimentari: r.restrizioniAlimentari ?? null,
    allergie: r.allergie ?? null,
    notePaccoAlimentare: r.notePaccoAlimentare ?? null,
    priorita: r.priorita,
    consegnaDomicilio: r.consegnaDomicilio,
    motivoConsegnaDomicilio: r.motivoConsegnaDomicilio ?? null,
    centroAscoltoId: r.centroAscoltoId ?? null,
    centroAscoltoNome: centroNome ?? null,
    uds: r.uds,
    cittaId: r.cittaId ?? null,
    cittaNome: cittaNome ?? null,
    zonaUdsId: r.zonaUdsId ?? null,
    attivo: r.attivo,
    dataPresaInCarico: r.dataPresaInCarico ?? null,
    noteInterne: r.noteInterne ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

router.get("/beneficiari", async (req, res) => {
  const { search, priorita, domicilio, centroAscoltoId, cittaId, zonaUdsId, uds, attivo } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (search) {
    conditions.push(ilike(beneficiariTable.cognome, `%${search}%`));
  }
  if (priorita) conditions.push(eq(beneficiariTable.priorita, priorita));
  if (domicilio === "true") conditions.push(eq(beneficiariTable.consegnaDomicilio, true));
  // Città and zona are HARD boundaries when present on the caller; explicit
  // query params let a global caller narrow the result.
  if (cittaId) conditions.push(eq(beneficiariTable.cittaId, parseInt(cittaId)));
  if (zonaUdsId) conditions.push(eq(beneficiariTable.zonaUdsId, parseInt(zonaUdsId)));
  if (uds === "true") conditions.push(eq(beneficiariTable.uds, true));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  const zonaFilter = zonaUdsScopeFilter(beneficiariTable.zonaUdsId, callerZonaUdsId(req));
  if (zonaFilter) conditions.push(zonaFilter);
  if (attivo === "true") conditions.push(eq(beneficiariTable.attivo, true));
  else if (attivo === "false") conditions.push(eq(beneficiariTable.attivo, false));

  const rows = await db
    .select({ b: beneficiariTable, centroNome: centriAscoltoTable.nome, cittaNome: cittaTable.nome })
    .from(beneficiariTable)
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(cittaTable, eq(beneficiariTable.cittaId, cittaTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(beneficiariTable.dataCreazione), desc(beneficiariTable.id));
  res.json(rows.map(r => fmtBenef(r.b, r.centroNome, r.cittaNome)));
});

async function createBeneficiarioOne(
  body: Record<string, unknown>,
  req: Request,
): Promise<{ row: typeof beneficiariTable.$inferSelect } | { error: string }> {
  const b = body as Record<string, any>;
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  // Timestamp + random suffix keeps codes unique even within a tight bulk loop.
  const codice = b.codice || `BEN-${Date.now()}${Math.floor(Math.random() * 46656).toString(36).padStart(3, "0")}`;
  const values: Record<string, any> = { ...b, codice };
  if ("uds" in values) values.uds = toBool(values.uds);
  if (caller != null) values.centroAscoltoId = caller;
  if (cid != null) values.cittaId = cid;
  if (zid != null) values.zonaUdsId = zid;
  // Città is the HARD UDS boundary: a città-global caller must pin a città when
  // creating a UDS person, otherwise the row would be visible across all cities.
  if (values.uds === true && cid == null && values.cittaId == null) {
    return { error: "La città è obbligatoria per una persona UDS" };
  }
  const [row] = await db.insert(beneficiariTable).values(values as typeof beneficiariTable.$inferInsert).returning();
  return { row };
}

router.post("/beneficiari", async (req, res) => {
  const r = await createBeneficiarioOne(req.body, req);
  if ("error" in r) { res.status(400).json({ error: r.error }); return; }
  res.status(201).json(fmtBenef(r.row));
});

router.post("/beneficiari/bulk", async (req, res) => {
  const righe = (req.body?.righe ?? []) as Record<string, unknown>[];
  const result = await runBulk(righe, async (row) => {
    const r = await createBeneficiarioOne(row, req);
    return "error" in r ? { error: r.error } : { ok: true };
  });
  res.json(result);
});

// Fuzzy person-duplicate suggestion (pg_trgm). Scoped HARD to the caller's città
// so a duplicate is never surfaced across cities. Returns candidates ordered by a
// combined similarity score over name(+reversed), soprannome, telefono and an
// exact birthdate boost. MUST stay registered before "/beneficiari/:id" so the
// literal segment is not captured as an id.
router.get("/beneficiari/cerca-simili", async (req, res) => {
  const q = req.query as Record<string, string>;
  const nome = (q.nome ?? "").trim();
  const cognome = (q.cognome ?? "").trim();
  const soprannome = (q.soprannome ?? "").trim().toLowerCase();
  const telefono = (q.telefono ?? "").trim();
  const dataNascita = (q.dataNascita ?? "").trim();
  const full = `${nome} ${cognome}`.trim().toLowerCase();
  const toIntOrNull = (v: string | undefined): number | null => {
    if (!v) return null;
    const n = parseInt(v);
    return Number.isNaN(n) ? null : n;
  };
  const excludeId = toIntOrNull(q.excludeId);

  // Nothing to match on → empty result (avoids returning the whole città).
  if (!full && !soprannome && !telefono && !dataNascita) {
    res.json([]);
    return;
  }

  // Città is the HARD boundary: a scoped caller can only search their own città
  // (or NULL/legacy rows); zona is HARD when present on the caller. Global
  // callers may narrow with ?cittaId / ?zonaUdsId.
  const callerCitta = callerCittaId(req);
  const cittaId = callerCitta != null ? callerCitta : toIntOrNull(q.cittaId);
  const callerZona = callerZonaUdsId(req);
  const zonaId = callerZona != null ? callerZona : toIntOrNull(q.zonaUdsId);

  const result = await db.execute(sql`
    SELECT * FROM (
      SELECT
        b.id, b.codice, b.nome, b.cognome, b.soprannome,
        b.data_nascita::text AS "dataNascita", b.telefono,
        b.citta_id AS "cittaId", c.nome AS "cittaNome",
        b.zona_uds_id AS "zonaUdsId", z.nome AS "zonaUdsNome",
        b.centro_ascolto_id AS "centroAscoltoId", ca.nome AS "centroAscoltoNome",
        b.uds AS "uds",
        (
          GREATEST(
            similarity(lower(coalesce(b.nome, '') || ' ' || coalesce(b.cognome, '')), ${full}),
            similarity(lower(coalesce(b.cognome, '') || ' ' || coalesce(b.nome, '')), ${full})
          )
          + CASE WHEN ${soprannome} <> '' THEN similarity(lower(coalesce(b.soprannome, '')), ${soprannome}) * 0.5 ELSE 0 END
          + CASE WHEN ${telefono} <> '' THEN (CASE WHEN b.telefono = ${telefono} THEN 0.5 ELSE similarity(coalesce(b.telefono, ''), ${telefono}) * 0.3 END) ELSE 0 END
          + CASE WHEN ${dataNascita} <> '' AND b.data_nascita IS NOT NULL AND b.data_nascita::text = ${dataNascita} THEN 0.4 ELSE 0 END
        )::float8 AS score
      FROM beneficiari b
      LEFT JOIN citta c ON c.id = b.citta_id
      LEFT JOIN zone_uds z ON z.id = b.zona_uds_id
      LEFT JOIN centri_di_ascolto ca ON ca.id = b.centro_ascolto_id
      WHERE (${cittaId}::int IS NULL OR b.citta_id = ${cittaId}::int OR b.citta_id IS NULL)
        AND (${zonaId}::int IS NULL OR b.zona_uds_id = ${zonaId}::int)
        AND (${excludeId}::int IS NULL OR b.id <> ${excludeId}::int)
    ) s
    WHERE s.score >= 0.2
    ORDER BY s.score DESC
    LIMIT 10
  `);

  const rows = result.rows as Array<Record<string, unknown>>;
  res.json(rows.map(r => ({
    id: r.id,
    codice: r.codice,
    nome: r.nome,
    cognome: r.cognome,
    soprannome: (r.soprannome as string | null) ?? null,
    dataNascita: (r.dataNascita as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    cittaId: (r.cittaId as number | null) ?? null,
    cittaNome: (r.cittaNome as string | null) ?? null,
    zonaUdsId: (r.zonaUdsId as number | null) ?? null,
    zonaUdsNome: (r.zonaUdsNome as string | null) ?? null,
    centroAscoltoId: (r.centroAscoltoId as number | null) ?? null,
    centroAscoltoNome: (r.centroAscoltoNome as string | null) ?? null,
    uds: Boolean(r.uds),
    score: Math.round(Number(r.score) * 100) / 100,
  })));
});

router.get("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(row.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(row.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }

  let centroNome: string | null = null;
  if (row.centroAscoltoId) {
    const [c] = await db.select({ nome: centriAscoltoTable.nome }).from(centriAscoltoTable).where(eq(centriAscoltoTable.id, row.centroAscoltoId));
    centroNome = c?.nome ?? null;
  }

  const nucleo = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  const interventi = await db.select().from(interventiTable).where(eq(interventiTable.beneficiarioId, id)).limit(20);
  const consegne = await db.select().from(consegneTable).where(eq(consegneTable.beneficiarioId, id)).limit(20);

  res.json({
    ...fmtBenef(row, centroNome),
    nucleo: nucleo.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null })),
    interventi: interventi.map(i => ({
      id: i.id,
      beneficiarioId: i.beneficiarioId,
      beneficiarioNome: `${row.cognome} ${row.nome}`,
      bollaId: i.bollaId ?? null,
      dataIntervento: i.dataIntervento,
      tipoIntervento: i.tipoIntervento,
      descrizione: i.descrizione ?? null,
      esito: i.esito ?? null,
      prossimAzione: i.prossimAzione ?? null,
      note: i.note ?? null,
      dataFollowup: i.dataFollowup ?? null,
      dataCreazione: i.dataCreazione.toISOString(),
    })),
    consegne: consegne.map(c => ({
      id: c.id,
      codice: c.codice,
      beneficiarioId: c.beneficiarioId,
      tipoConsegna: c.tipoConsegna,
      dataPrevista: c.dataPrevista,
      stato: c.stato,
      magazzinoId: c.magazzinoId,
      dataCreazione: c.dataCreazione.toISOString(),
    })),
  });
});

router.patch("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  const zid = callerZonaUdsId(req);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(existing.zonaUdsId, zid)) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }
  const updates = { ...req.body, dataAggiornamento: new Date() };
  if ("uds" in updates) updates.uds = toBool(updates.uds);
  if (caller != null) delete updates.centroAscoltoId;
  if (cid != null) delete updates.cittaId;
  if (zid != null) updates.zonaUdsId = zid;
  // Mirror the POST città-HARD-boundary guard: a UDS person must never end up
  // with a null città (cross-città visibility leak). A scoped caller auto-pins
  // their own città (even on legacy null-città rows); a global caller must
  // supply one explicitly.
  const resultingUds = "uds" in updates ? updates.uds === true : existing.uds === true;
  const resultingCitta = "cittaId" in updates ? updates.cittaId : existing.cittaId;
  if (resultingUds && resultingCitta == null) {
    if (cid != null) {
      updates.cittaId = cid;
    } else {
      res.status(400).json({ error: "La città è obbligatoria per una persona UDS" });
      return;
    }
  }
  const [row] = await db.update(beneficiariTable).set(updates).where(eq(beneficiariTable.id, id)).returning();
  res.json(fmtBenef(row));
});

router.delete("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(204).send(); return; }
  if (!canAccessCentro(existing.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (!canAccessCitta(existing.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (!canAccessZonaUds(existing.zonaUdsId, callerZonaUdsId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua zona" });
    return;
  }
  await db.delete(beneficiariTable).where(eq(beneficiariTable.id, id));
  res.status(204).send();
});

router.get("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const rows = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  res.json(rows.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null, tagliaVestiti: n.tagliaVestiti ?? null, numeroScarpe: n.numeroScarpe ?? null })));
});

router.post("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const [row] = await db.insert(nucleoFamiliareTable).values({ ...req.body, beneficiarioId: id }).returning();
  res.status(201).json(row);
});

router.delete("/beneficiari/:id/nucleo/:membroId", async (req, res) => {
  const id = parseInt(req.params.id);
  if (
    !canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))
    || !canAccessCitta(await beneficiarioCittaId(id), callerCittaId(req))
    || !canAccessZonaUds(await beneficiarioZonaUdsId(id), callerZonaUdsId(req))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  await db
    .delete(nucleoFamiliareTable)
    .where(and(eq(nucleoFamiliareTable.id, parseInt(req.params.membroId)), eq(nucleoFamiliareTable.beneficiarioId, id)));
  res.status(204).send();
});

export default router;
