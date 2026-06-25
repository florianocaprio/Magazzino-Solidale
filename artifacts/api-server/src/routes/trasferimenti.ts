import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trasferimentiTable, trasferimentoRigheTable, magazziniTable, prodottiTable, lottiTable, movimentiTable, utentiTable, volontariTable } from "@workspace/db";
import { eq, and, desc, inArray, gt, sum, asc, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  visibleMagazzinoIds,
  trasferimentoScopeFilter,
} from "../lib/centroScope";

const router: IRouter = Router();

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Giacenza disponibile per un prodotto in un magazzino (somma quantità residue dei lotti). */
async function giacenzaDisponibile(prodottoId: number, magazzinoId: number): Promise<number> {
  const [res] = await db
    .select({ totale: sum(lottiTable.quantitaResidua) })
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, prodottoId),
        eq(lottiTable.magazzinoId, magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
      ),
    );
  return parseFloat(res?.totale ?? "0");
}

/**
 * Uscita FEFO dal magazzino origine: scala la quantità dai lotti per scadenza
 * crescente e registra un movimento "trasferimento/uscita" per ogni lotto toccato.
 * I movimenti registrano il lotto origine così che la conferma possa ricreare i
 * lotti a destinazione preservando scadenza e provenienza (FEFO).
 */
async function trasferimentoUscitaFEFO(tx: Tx, opts: {
  prodottoId: number;
  magazzinoId: number;
  quantita: number;
  unitaMisura: string;
  dataMovimento: string;
  trasferimentoId: number;
  trasferimentoCodice: string;
}) {
  let rimanente = opts.quantita;
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
      ),
    )
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico));

  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const disp = parseFloat(lotto.quantitaResidua);
    const scala = Math.min(disp, rimanente);

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: (disp - scala).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await tx.insert(movimentiTable).values({
      tipoMovimento: "trasferimento",
      tipoDettaglio: "uscita",
      dataMovimento: opts.dataMovimento,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      lottoId: lotto.id,
      quantita: scala.toFixed(2),
      unitaMisura: opts.unitaMisura,
      fornitoreId: lotto.fornitoreId,
      trasferimentoId: opts.trasferimentoId,
      documentoRiferimento: opts.trasferimentoCodice,
      note: `Trasferimento ${opts.trasferimentoCodice} — uscita`,
    });

    rimanente -= scala;
  }
}

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
    lottoFsePlus: lottiTable.fsePlus,
    prodottoFsePlus: prodottiTable.fsePlus,
  })
    .from(trasferimentoRigheTable)
    .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(trasferimentoRigheTable.lottoId, lottiTable.id))
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
      fsePlus: r.r.lottoId ? !!r.lottoFsePlus : !!r.prodottoFsePlus,
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
  const scope = trasferimentoScopeFilter(
    trasferimentiTable.magazzinoOrigineId,
    trasferimentiTable.magazzinoDestinoId,
    await visibleMagazzinoIds(callerCentroId(req)),
  );
  if (scope) conditions.push(scope);

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
    lottoId: number | null; fsePlus: boolean; quantita: number; unitaMisura: string; note: string | null;
  }>>();
  if (ids.length > 0) {
    const righe = await db.select({
      r: trasferimentoRigheTable,
      prodottoNome: prodottiTable.nome,
      lottoFsePlus: lottiTable.fsePlus,
      prodottoFsePlus: prodottiTable.fsePlus,
    })
      .from(trasferimentoRigheTable)
      .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
      .leftJoin(lottiTable, eq(trasferimentoRigheTable.lottoId, lottiTable.id))
      .where(inArray(trasferimentoRigheTable.trasferimentoId, ids));
    for (const x of righe) {
      const arr = righeByT.get(x.r.trasferimentoId) ?? [];
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        lottoId: x.r.lottoId ?? null,
        fsePlus: x.r.lottoId ? !!x.lottoFsePlus : !!x.prodottoFsePlus,
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
  const visIds = await visibleMagazzinoIds(callerCentroId(req));
  if (visIds != null && (!visIds.includes(body.magazzinoOrigineId) || !visIds.includes(body.magazzinoDestinoId))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
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
  const visIds = await visibleMagazzinoIds(callerCentroId(req));
  if (visIds != null && !visIds.includes(result.magazzinoOrigineId) && !visIds.includes(result.magazzinoDestinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json(result);
});

router.patch("/trasferimenti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body ?? {};

  const [current] = await db.select().from(trasferimentiTable).where(eq(trasferimentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const visIds = await visibleMagazzinoIds(callerCentroId(req));
  if (visIds != null && !visIds.includes(current.magazzinoOrigineId) && !visIds.includes(current.magazzinoDestinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }

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

// Avvia: deduce le quantità dai lotti del magazzino origine (FEFO) e mette il
// trasferimento "in_transito". Da qui in poi le righe non sono più modificabili.
router.post("/trasferimenti/:id/avvia", async (req, res) => {
  const id = parseInt(req.params.id);
  const [current] = await db.select().from(trasferimentiTable).where(eq(trasferimentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const visIds = await visibleMagazzinoIds(callerCentroId(req));
  if (visIds != null && !visIds.includes(current.magazzinoOrigineId) && !visIds.includes(current.magazzinoDestinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (current.stato !== "richiesto" && current.stato !== "preparato") {
    res.status(400).json({ error: "Il trasferimento è già stato avviato" });
    return;
  }

  const righe = await db.select().from(trasferimentoRigheTable).where(eq(trasferimentoRigheTable.trasferimentoId, id));
  if (righe.length === 0) {
    res.status(400).json({ error: "Il trasferimento non ha prodotti da trasferire" });
    return;
  }

  // Nomi prodotto per messaggi di errore leggibili.
  const prodottoIds = [...new Set(righe.map((r) => r.prodottoId))];
  const prodotti = await db
    .select({ id: prodottiTable.id, nome: prodottiTable.nome })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  const prodottoMap = new Map(prodotti.map((p) => [p.id, p.nome]));

  // Valida la disponibilità all'origine sommando per prodotto.
  const richiestaPerProdotto = new Map<number, number>();
  for (const r of righe) {
    richiestaPerProdotto.set(r.prodottoId, (richiestaPerProdotto.get(r.prodottoId) ?? 0) + parseFloat(r.quantita));
  }
  for (const [prodottoId, richiesta] of richiestaPerProdotto) {
    const disp = await giacenzaDisponibile(prodottoId, current.magazzinoOrigineId);
    if (richiesta > disp) {
      res.status(400).json({
        error: `Disponibilità insufficiente all'origine per ${prodottoMap.get(prodottoId) ?? `prodotto #${prodottoId}`}: ${disp} disponibili, richiesti ${richiesta}`,
      });
      return;
    }
  }

  const dataEsecuzione = new Date().toISOString().split("T")[0];

  await db.transaction(async (tx) => {
    for (const r of righe) {
      await trasferimentoUscitaFEFO(tx, {
        prodottoId: r.prodottoId,
        magazzinoId: current.magazzinoOrigineId,
        quantita: parseFloat(r.quantita),
        unitaMisura: r.unitaMisura,
        dataMovimento: dataEsecuzione,
        trasferimentoId: id,
        trasferimentoCodice: current.codice,
      });
    }
    await tx
      .update(trasferimentiTable)
      .set({ stato: "in_transito", dataEsecuzione, operatoreId: req.user!.id })
      .where(eq(trasferimentiTable.id, id));
  });

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

// Conferma: aggiunge le quantità ricevute al magazzino destinazione come nuovi
// lotti, ricostruiti dai movimenti di uscita per preservare scadenza/provenienza.
router.post("/trasferimenti/:id/conferma", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body ?? {};
  const [current] = await db.select().from(trasferimentiTable).where(eq(trasferimentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  const visIds = await visibleMagazzinoIds(callerCentroId(req));
  if (visIds != null && !visIds.includes(current.magazzinoOrigineId) && !visIds.includes(current.magazzinoDestinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (current.stato !== "in_transito") {
    res.status(400).json({ error: "Solo un trasferimento in transito può essere confermato" });
    return;
  }

  const dataConferma = body.dataConferma ?? new Date().toISOString().split("T")[0];

  await db.transaction(async (tx) => {
    // I movimenti di uscita portano il lotto origine: lo si rilegge per copiare
    // scadenza, codice lotto e provenienza nei lotti creati a destinazione.
    const uscite = await tx
      .select({ m: movimentiTable, lotto: lottiTable })
      .from(movimentiTable)
      .leftJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
      .where(
        and(
          eq(movimentiTable.trasferimentoId, id),
          eq(movimentiTable.tipoMovimento, "trasferimento"),
          eq(movimentiTable.tipoDettaglio, "uscita"),
        ),
      );

    for (const u of uscite) {
      const qty = u.m.quantita;
      const [destLotto] = await tx
        .insert(lottiTable)
        .values({
          prodottoId: u.m.prodottoId,
          codiceLotto: u.lotto?.codiceLotto ?? null,
          dataScadenza: u.lotto?.dataScadenza ?? null,
          dataCarico: dataConferma,
          quantitaCaricata: qty,
          quantitaResidua: qty,
          magazzinoId: current.magazzinoDestinoId,
          fornitoreId: u.lotto?.fornitoreId ?? null,
          fsePlus: u.lotto?.fsePlus ?? false,
          note: `Da trasferimento ${current.codice}`,
        })
        .returning();

      await tx.insert(movimentiTable).values({
        tipoMovimento: "trasferimento",
        tipoDettaglio: "entrata",
        dataMovimento: dataConferma,
        magazzinoId: current.magazzinoDestinoId,
        prodottoId: u.m.prodottoId,
        lottoId: destLotto.id,
        quantita: qty,
        unitaMisura: u.m.unitaMisura,
        fornitoreId: u.lotto?.fornitoreId ?? null,
        trasferimentoId: id,
        documentoRiferimento: current.codice,
        note: `Trasferimento ${current.codice} — entrata`,
      });
    }

    await tx
      .update(trasferimentiTable)
      .set({
        stato: "completato",
        dataConfermaRicezione: dataConferma,
        note: body.note,
        operatoreId: req.user!.id,
      })
      .where(eq(trasferimentiTable.id, id));
  });

  const result = await getTrasferimentoWithRighe(id);
  res.json(result);
});

export default router;
