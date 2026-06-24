import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trasferimentiTable, trasferimentoRigheTable, magazziniTable, prodottiTable, lottiTable, utentiTable, volontariTable } from "@workspace/db";
import { eq, and, desc, inArray, type SQL } from "drizzle-orm";

const router: IRouter = Router();

type TrasportatoreResult =
  | { ok: true; volontarioId: number | null; nome: string | null }
  | { ok: false; error: string };

// Enforces the contract rule: exactly one of volontario / free name when a
// transporter is being set. Returns normalized columns (the unused one nulled).
function normalizeTrasportatore(body: { trasportatoreVolontarioId?: unknown; trasportatoreNome?: unknown }): TrasportatoreResult {
  const hasVol = body.trasportatoreVolontarioId != null;
  const nome = typeof body.trasportatoreNome === "string" ? body.trasportatoreNome.trim() : "";
  const hasNome = nome.length > 0;
  if (hasVol && hasNome) {
    return { ok: false, error: "Specificare un volontario oppure un nome trasportatore, non entrambi" };
  }
  if (!hasVol && !hasNome) {
    return { ok: false, error: "Indicare un trasportatore: un volontario oppure un nome libero" };
  }
  return { ok: true, volontarioId: hasVol ? Number(body.trasportatoreVolontarioId) : null, nome: hasVol ? null : nome };
}

async function getTrasferimentoWithRighe(id: number) {
  const [t] = await db.select({
    t: trasferimentiTable,
    origineNome: magazziniTable.nome,
    origineIndirizzo: magazziniTable.indirizzo,
    origineComune: magazziniTable.comune,
    origineZona: magazziniTable.zona,
    operatoreMatricola: utentiTable.matricola,
    operatoreUsername: utentiTable.username,
  })
    .from(trasferimentiTable)
    .leftJoin(magazziniTable, eq(trasferimentiTable.magazzinoOrigineId, magazziniTable.id))
    .leftJoin(utentiTable, eq(trasferimentiTable.operatoreId, utentiTable.id))
    .where(eq(trasferimentiTable.id, id));
  if (!t) return null;

  const [destRow] = await db.select({
    nome: magazziniTable.nome,
    indirizzo: magazziniTable.indirizzo,
    comune: magazziniTable.comune,
    zona: magazziniTable.zona,
  })
    .from(magazziniTable).where(eq(magazziniTable.id, t.t.magazzinoDestinoId));

  let trasportatoreVolontarioNome: string | null = null;
  if (t.t.trasportatoreVolontarioId != null) {
    const [v] = await db.select({ nome: volontariTable.nome, cognome: volontariTable.cognome })
      .from(volontariTable).where(eq(volontariTable.id, t.t.trasportatoreVolontarioId));
    if (v) trasportatoreVolontarioNome = `${v.nome} ${v.cognome}`.trim();
  }

  const righe = await db.select({
    r: trasferimentoRigheTable,
    prodottoNome: prodottiTable.nome,
  })
    .from(trasferimentoRigheTable)
    .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(trasferimentoRigheTable.trasferimentoId, id));

  return {
    id: t.t.id,
    codice: t.t.codice,
    magazzinoOrigineId: t.t.magazzinoOrigineId,
    magazzinoOrigineNome: t.origineNome ?? null,
    magazzinoOrigineIndirizzo: t.origineIndirizzo ?? null,
    magazzinoOrigineComune: t.origineComune ?? null,
    magazzinoOrigineZona: t.origineZona ?? null,
    magazzinoDestinoId: t.t.magazzinoDestinoId,
    magazzinoDestinoNome: destRow?.nome ?? null,
    magazzinoDestinoIndirizzo: destRow?.indirizzo ?? null,
    magazzinoDestinoComune: destRow?.comune ?? null,
    magazzinoDestinoZona: destRow?.zona ?? null,
    trasportatoreVolontarioId: t.t.trasportatoreVolontarioId ?? null,
    trasportatoreVolontarioNome,
    trasportatoreNome: t.t.trasportatoreNome ?? null,
    dataRichiesta: t.t.dataRichiesta,
    dataEsecuzione: t.t.dataEsecuzione ?? null,
    dataConfermaRicezione: t.t.dataConfermaRicezione ?? null,
    stato: t.t.stato,
    note: t.t.note ?? null,
    operatoreId: t.t.operatoreId ?? null,
    operatoreCodice: t.operatoreMatricola ?? t.operatoreUsername ?? null,
    righe: righe.map(r => ({
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      lottoId: r.r.lottoId ?? null,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
    dataCreazione: t.t.dataCreazione.toISOString(),
  };
}

router.get("/trasferimenti", async (req, res) => {
  const { stato } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(trasferimentiTable.stato, stato));

  const rows = await db
    .select()
    .from(trasferimentiTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(trasferimentiTable.dataCreazione))
    .limit(100);

  const magazzini = await db.select({
    id: magazziniTable.id,
    nome: magazziniTable.nome,
    indirizzo: magazziniTable.indirizzo,
    comune: magazziniTable.comune,
    zona: magazziniTable.zona,
  }).from(magazziniTable);
  const magMap = new Map(magazzini.map(m => [m.id, m]));

  const volontariRows = await db.select({ id: volontariTable.id, nome: volontariTable.nome, cognome: volontariTable.cognome }).from(volontariTable);
  const volMap = new Map(volontariRows.map(v => [v.id, `${v.nome} ${v.cognome}`.trim()]));

  const operatoreIds = [...new Set(rows.map(r => r.operatoreId).filter((x): x is number => x != null))];
  const opMap = new Map<number, string | null>();
  if (operatoreIds.length > 0) {
    const utenti = await db.select({ id: utentiTable.id, matricola: utentiTable.matricola, username: utentiTable.username })
      .from(utentiTable).where(inArray(utentiTable.id, operatoreIds));
    for (const u of utenti) opMap.set(u.id, u.matricola ?? u.username ?? null);
  }

  const ids = rows.map(r => r.id);
  const righeByT = new Map<number, Array<{
    id: number; prodottoId: number; prodottoNome: string | null;
    lottoId: number | null; quantita: number; unitaMisura: string; note: string | null;
  }>>();
  if (ids.length > 0) {
    const righe = await db.select({
      r: trasferimentoRigheTable,
      prodottoNome: prodottiTable.nome,
    })
      .from(trasferimentoRigheTable)
      .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
      .where(inArray(trasferimentoRigheTable.trasferimentoId, ids));
    for (const x of righe) {
      const arr = righeByT.get(x.r.trasferimentoId) ?? [];
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        lottoId: x.r.lottoId ?? null,
        quantita: parseFloat(x.r.quantita),
        unitaMisura: x.r.unitaMisura,
        note: x.r.note ?? null,
      });
      righeByT.set(x.r.trasferimentoId, arr);
    }
  }

  res.json(rows.map(r => {
    const orig = magMap.get(r.magazzinoOrigineId);
    const dest = magMap.get(r.magazzinoDestinoId);
    return {
      id: r.id,
      codice: r.codice,
      magazzinoOrigineId: r.magazzinoOrigineId,
      magazzinoOrigineNome: orig?.nome ?? null,
      magazzinoOrigineIndirizzo: orig?.indirizzo ?? null,
      magazzinoOrigineComune: orig?.comune ?? null,
      magazzinoOrigineZona: orig?.zona ?? null,
      magazzinoDestinoId: r.magazzinoDestinoId,
      magazzinoDestinoNome: dest?.nome ?? null,
      magazzinoDestinoIndirizzo: dest?.indirizzo ?? null,
      magazzinoDestinoComune: dest?.comune ?? null,
      magazzinoDestinoZona: dest?.zona ?? null,
      trasportatoreVolontarioId: r.trasportatoreVolontarioId ?? null,
      trasportatoreVolontarioNome: r.trasportatoreVolontarioId != null ? (volMap.get(r.trasportatoreVolontarioId) ?? null) : null,
      trasportatoreNome: r.trasportatoreNome ?? null,
      dataRichiesta: r.dataRichiesta,
      dataEsecuzione: r.dataEsecuzione ?? null,
      dataConfermaRicezione: r.dataConfermaRicezione ?? null,
      stato: r.stato,
      note: r.note ?? null,
      operatoreId: r.operatoreId ?? null,
      operatoreCodice: r.operatoreId != null ? (opMap.get(r.operatoreId) ?? null) : null,
      righe: righeByT.get(r.id) ?? [],
      dataCreazione: r.dataCreazione.toISOString(),
    };
  }));
});

router.post("/trasferimenti", async (req, res) => {
  const body = req.body;
  if (body.magazzinoOrigineId === body.magazzinoDestinoId) {
    res.status(400).json({ error: "Origine e destinazione devono essere diverse" });
    return;
  }
  const righeInput: Array<{ quantita: number }> = body.righe ?? [];
  if (righeInput.some((r) => !(r.quantita > 0))) {
    res.status(400).json({ error: "Le quantità devono essere maggiori di zero" });
    return;
  }
  const trasportatore = normalizeTrasportatore(body);
  if (!trasportatore.ok) {
    res.status(400).json({ error: trasportatore.error });
    return;
  }
  const codice = `TRASM-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const [t] = await db.insert(trasferimentiTable).values({
    codice,
    magazzinoOrigineId: body.magazzinoOrigineId,
    magazzinoDestinoId: body.magazzinoDestinoId,
    dataRichiesta: body.dataRichiesta,
    trasportatoreVolontarioId: trasportatore.volontarioId,
    trasportatoreNome: trasportatore.nome,
    note: body.note,
    operatoreId: req.user!.id,
  }).returning();

  if (body.righe?.length) {
    await db.insert(trasferimentoRigheTable).values(
      body.righe.map((r: { prodottoId: number; lottoId?: number; quantita: number; unitaMisura: string; note?: string }) => ({
        trasferimentoId: t.id,
        prodottoId: r.prodottoId,
        lottoId: r.lottoId,
        quantita: r.quantita.toString(),
        unitaMisura: r.unitaMisura,
        note: r.note,
      }))
    );
  }

  const result = await getTrasferimentoWithRighe(t.id);
  res.status(201).json(result);
});

router.get("/trasferimenti/:id", async (req, res) => {
  const result = await getTrasferimentoWithRighe(parseInt(req.params.id));
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result);
});

router.patch("/trasferimenti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body ?? {};

  const [current] = await db.select().from(trasferimentiTable).where(eq(trasferimentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }

  const updates: Partial<typeof trasferimentiTable.$inferInsert> = {};
  if ("stato" in body) updates.stato = body.stato;
  if ("dataEsecuzione" in body) updates.dataEsecuzione = body.dataEsecuzione;
  if ("note" in body) updates.note = body.note;

  // Normalize transporter only when the request touches either field, so that
  // a transporter switch (volontario <-> "Altro") always clears the opposite column.
  if ("trasportatoreVolontarioId" in body || "trasportatoreNome" in body) {
    const trasportatore = normalizeTrasportatore(body);
    if (!trasportatore.ok) {
      res.status(400).json({ error: trasportatore.error });
      return;
    }
    updates.trasportatoreVolontarioId = trasportatore.volontarioId;
    updates.trasportatoreNome = trasportatore.nome;
  }

  // Item rows can only be edited before the transfer is started ("avvia"
  // deducts stock from the origin lots, so rewriting righe afterwards would
  // desync giacenze). Allowed states: richiesto / preparato.
  const editRighe = "righe" in body;
  let righeInput: Array<{ prodottoId: number; lottoId?: number; quantita: number; unitaMisura: string; note?: string }> = [];
  if (editRighe) {
    if (current.stato !== "richiesto" && current.stato !== "preparato") {
      res.status(400).json({ error: "Le righe possono essere modificate solo prima dell'avvio del trasferimento" });
      return;
    }
    righeInput = body.righe ?? [];
    if (righeInput.length === 0) {
      res.status(400).json({ error: "Indicare almeno un prodotto da trasferire" });
      return;
    }
    if (righeInput.some((r) => !(r.quantita > 0))) {
      res.status(400).json({ error: "Le quantità devono essere maggiori di zero" });
      return;
    }
  }

  if (Object.keys(updates).length === 0 && !editRighe) {
    const cur = await getTrasferimentoWithRighe(id);
    res.json(cur);
    return;
  }

  // Stamp the operator who performed this mutation alongside the allow-listed updates.
  updates.operatoreId = req.user!.id;
  await db.update(trasferimentiTable).set(updates).where(eq(trasferimentiTable.id, id));

  if (editRighe) {
    // Replace-all: the editor sends the full desired set of rows.
    await db.delete(trasferimentoRigheTable).where(eq(trasferimentoRigheTable.trasferimentoId, id));
    await db.insert(trasferimentoRigheTable).values(
      righeInput.map((r) => ({
        trasferimentoId: id,
        prodottoId: r.prodottoId,
        lottoId: r.lottoId,
        quantita: r.quantita.toString(),
        unitaMisura: r.unitaMisura,
        note: r.note,
      }))
    );
  }

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

router.post("/trasferimenti/:id/avvia", async (req, res) => {
  const [row] = await db.update(trasferimentiTable)
    .set({ stato: "in_transito", dataEsecuzione: new Date().toISOString().split("T")[0], operatoreId: req.user!.id })
    .where(eq(trasferimentiTable.id, parseInt(req.params.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getTrasferimentoWithRighe(row.id);
  res.json(result);
});

router.post("/trasferimenti/:id/conferma", async (req, res) => {
  const body = req.body;
  const [row] = await db.update(trasferimentiTable)
    .set({
      stato: "completato",
      dataConfermaRicezione: body.dataConferma ?? new Date().toISOString().split("T")[0],
      note: body.note,
      operatoreId: req.user!.id,
    })
    .where(eq(trasferimentiTable.id, parseInt(req.params.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getTrasferimentoWithRighe(row.id);
  res.json(result);
});

export default router;
