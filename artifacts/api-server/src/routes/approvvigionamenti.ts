import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { approvvigionamentiTable, approvvigionamentoRigheTable, fornitoriTable, prodottiTable, magazziniTable, centriAscoltoTable, cittaTable } from "@workspace/db";
import { eq, and, desc, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  canAccessCentro,
  canAccessMagazzino,
  visibleMagazzinoIds,
  visibleCentroIds,
  inVisibleCentroSet,
  idSetScopeFilter,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import {
  creaCaricoInventariale,
  InventoryLedgerError,
  requireOperationalMagazzino,
} from "../lib/inventoryLedger";
import { dataCivileEuropeRome } from "../lib/interventiWorkflow";
import { withDocumentCodeRetry } from "../lib/documentCode";

const router: IRouter = Router();
router.use("/approvvigionamenti", requireModulo("APPROVVIGIONAMENTI"));

function requestedVersion(body: unknown): number | null {
  const value = (body as { versione?: unknown } | null)?.versione;
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : null;
}

function databaseErrorCode(error: unknown): unknown {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return candidate?.code ?? candidate?.cause?.code;
}

async function validateFornitoreArea(fornitoreId: unknown, cittaId: unknown): Promise<string | null> {
  if (!Number.isInteger(Number(cittaId)) || Number(cittaId) <= 0) return "L'area è obbligatoria";
  if (!Number.isInteger(Number(fornitoreId)) || Number(fornitoreId) <= 0) return "Il fornitore è obbligatorio";
  const [area] = await db.select({ id: cittaTable.id, attivo: cittaTable.attivo }).from(cittaTable).where(eq(cittaTable.id, Number(cittaId)));
  if (!area) return "L'Area selezionata non esiste";
  if (!area.attivo) return "L'Area selezionata non è attiva";
  const [fornitore] = await db.select({ cittaId: fornitoriTable.cittaId, attivo: fornitoriTable.attivo })
    .from(fornitoriTable).where(eq(fornitoriTable.id, Number(fornitoreId)));
  if (!fornitore) return "Il fornitore selezionato non esiste";
  if (!fornitore.attivo) return "Il fornitore selezionato non è attivo";
  if (fornitore.cittaId != null && fornitore.cittaId !== Number(cittaId)) return "Il Fornitore selezionato non è associato all'Area indicata";
  return null;
}

async function getWithRighe(id: number) {
  const [a] = await db.select({
    a: approvvigionamentiTable,
    fornitoreNome: fornitoriTable.nome,
    fornitoreEmail: fornitoriTable.email,
    fornitoreCittaId: fornitoriTable.cittaId,
    magazzinoNome: magazziniTable.nome,
    magazzinoCittaId: magazziniTable.cittaId,
    centroAscoltoNome: centriAscoltoTable.nome,
  })
    .from(approvvigionamentiTable)
    .leftJoin(fornitoriTable, eq(approvvigionamentiTable.fornitoreId, fornitoriTable.id))
    .leftJoin(magazziniTable, eq(approvvigionamentiTable.magazzinoId, magazziniTable.id))
    .leftJoin(centriAscoltoTable, eq(approvvigionamentiTable.centroAscoltoId, centriAscoltoTable.id))
    .where(eq(approvvigionamentiTable.id, id));
  if (!a) return null;

  const righe = await db.select({
    r: approvvigionamentoRigheTable,
    prodottoNome: prodottiTable.nome,
  })
    .from(approvvigionamentoRigheTable)
    .leftJoin(prodottiTable, eq(approvvigionamentoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(approvvigionamentoRigheTable.approvvigionamentoId, id));

  return {
    id: a.a.id,
    versione: a.a.versione,
    codice: a.a.codice,
    fornitoreId: a.a.fornitoreId ?? null,
    fornitoreNome: a.fornitoreNome ?? null,
    fornitoreEmail: a.fornitoreEmail ?? null,
    cittaId: a.magazzinoCittaId ?? null,
    magazzinoId: a.a.magazzinoId ?? null,
    magazzinoNome: a.magazzinoNome ?? null,
    centroAscoltoId: a.a.centroAscoltoId ?? null,
    centroAscoltoNome: a.centroAscoltoNome ?? null,
    dataRichiesta: a.a.dataRichiesta,
    dataPrevista: a.a.dataPrevista ?? null,
    stato: a.a.stato,
    note: a.a.note ?? null,
    righe: righe.map(r => ({
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      quantitaRichiesta: parseFloat(r.r.quantitaRichiesta),
      quantitaRicevuta: parseFloat(r.r.quantitaRicevuta ?? "0"),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
    dataCreazione: a.a.dataCreazione.toISOString(),
  };
}

router.get("/approvvigionamenti", requirePermission("approvvigionamenti.view"), async (req, res) => {
  const { stato, magazzinoId, centroAscoltoId } = req.query as Record<string, string>;
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e limit tra 1 e 100" });
    return;
  }
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(approvvigionamentiTable.stato, stato));
  if (magazzinoId) conditions.push(eq(approvvigionamentiTable.magazzinoId, parseInt(magazzinoId)));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(approvvigionamentiTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(approvvigionamentiTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  // Città axis: derived from the magazzino (approvvigionamenti carry no direct
  // cittaId). magazzinoId is nullable, so NULL stays shared/visible.
  const cittaFilter = idSetScopeFilter(
    approvvigionamentiTable.magazzinoId,
    await visibleMagazzinoIds(null, callerCittaId(req)),
  );
  if (cittaFilter) conditions.push(cittaFilter);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(approvvigionamentiTable).where(where);
  const rows = await db
    .select({
      a: approvvigionamentiTable,
      fornitoreNome: fornitoriTable.nome,
      fornitoreEmail: fornitoriTable.email,
      fornitoreCittaId: fornitoriTable.cittaId,
      magazzinoNome: magazziniTable.nome,
      magazzinoCittaId: magazziniTable.cittaId,
      centroAscoltoNome: centriAscoltoTable.nome,
    })
    .from(approvvigionamentiTable)
    .leftJoin(fornitoriTable, eq(approvvigionamentiTable.fornitoreId, fornitoriTable.id))
    .leftJoin(magazziniTable, eq(approvvigionamentiTable.magazzinoId, magazziniTable.id))
    .leftJoin(centriAscoltoTable, eq(approvvigionamentiTable.centroAscoltoId, centriAscoltoTable.id))
    .where(where)
    .orderBy(desc(approvvigionamentiTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(rows.map(r => ({
    id: r.a.id,
    versione: r.a.versione,
    codice: r.a.codice,
    fornitoreId: r.a.fornitoreId ?? null,
    fornitoreNome: r.fornitoreNome ?? null,
    fornitoreEmail: r.fornitoreEmail ?? null,
    cittaId: r.magazzinoCittaId ?? null,
    magazzinoId: r.a.magazzinoId ?? null,
    magazzinoNome: r.magazzinoNome ?? null,
    centroAscoltoId: r.a.centroAscoltoId ?? null,
    centroAscoltoNome: r.centroAscoltoNome ?? null,
    dataRichiesta: r.a.dataRichiesta,
    dataPrevista: r.a.dataPrevista ?? null,
    stato: r.a.stato,
    note: r.a.note ?? null,
    righe: [],
    dataCreazione: r.a.dataCreazione.toISOString(),
  })));
});

router.post("/approvvigionamenti", requirePermission("approvvigionamenti.manage"), async (req, res) => {
  const body = req.body;
  const callerCitta = callerCittaId(req);
  if (callerCitta != null && Number(body.cittaId) !== callerCitta) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" }); return;
  }
  const relationError = await validateFornitoreArea(body.fornitoreId, body.cittaId);
  if (relationError) { res.status(400).json({ error: relationError }); return; }
  const caller = callerCentroId(req);
  if (body.magazzinoId != null && !(await canAccessMagazzino(body.magazzinoId, caller, callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }
  if (body.magazzinoId == null) { res.status(400).json({ error: "Il Magazzino è obbligatorio" }); return; }
  const [operational] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, body.magazzinoId));
  if (!operational) { res.status(404).json({ error: "Magazzino non trovato" }); return; }
  if (operational.stato !== "attivo") { res.status(400).json({ error: "Il Magazzino selezionato non è attivo" }); return; }
  if (operational.cittaId !== Number(body.cittaId)) {
    res.status(400).json({ error: "Il Magazzino e il Fornitore devono appartenere alla stessa Area" }); return;
  }
  if (caller == null && body.centroAscoltoId != null
      && !inVisibleCentroSet(body.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const righeInput: Array<{ prodottoId: number; quantitaRichiesta: number; unitaMisura: string; note?: string }> = body.righe ?? [];
  if (righeInput.length === 0 || righeInput.some((r) => !Number.isInteger(r.prodottoId) || r.prodottoId <= 0 || !Number.isFinite(r.quantitaRichiesta) || r.quantitaRichiesta <= 0)) {
    res.status(400).json({ error: "Indicare almeno una riga con Prodotto e quantità validi" });
    return;
  }
  let a: typeof approvvigionamentiTable.$inferSelect;
  try {
    a = await withDocumentCodeRetry("APP", (codice) => db.transaction(async (tx) => {
      const [created] = await tx.insert(approvvigionamentiTable).values({
        codice,
        fornitoreId: body.fornitoreId,
        magazzinoId: body.magazzinoId,
        centroAscoltoId: caller != null ? caller : body.centroAscoltoId,
        dataRichiesta: body.dataRichiesta,
        dataPrevista: body.dataPrevista,
        stato: "bozza",
        note: body.note,
      }).returning();
      await tx.insert(approvvigionamentoRigheTable).values(
        righeInput.map((r) => ({
          approvvigionamentoId: created.id,
          prodottoId: r.prodottoId,
          quantitaRichiesta: r.quantitaRichiesta.toString(),
          quantitaRicevuta: "0",
          unitaMisura: r.unitaMisura,
          note: r.note,
        })),
      );
      return created;
    }));
  } catch (error) {
    if (databaseErrorCode(error) === "23503") {
      res.status(400).json({ error: "Una riga indica un Prodotto o una risorsa collegata inesistente" });
      return;
    }
    throw error;
  }

  const result = await getWithRighe(a.id);
  res.status(201).json(result);
});

router.get("/approvvigionamenti/:id", requirePermission("approvvigionamenti.view"), async (req, res) => {
  const result = await getWithRighe(Number(req.params.id));
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(result.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (result.magazzinoId != null && !(await canAccessMagazzino(result.magazzinoId, callerCentroId(req), callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(result);
});

router.patch("/approvvigionamenti/:id", async (req, res) => {
  const id = Number(req.params.id);
  const versione = requestedVersion(req.body);
  if (versione == null) {
    res.status(400).json({ error: "La versione corrente dell'Approvvigionamento è obbligatoria" });
    return;
  }
  const completionRequested = req.body?.stato === "completato";
  const requiredPermission = completionRequested ? "approvvigionamenti.receive" : "approvvigionamenti.manage";
  if (!req.user?.isAdmin && !(req.user?.permessi ?? []).includes(requiredPermission)) {
    res.status(403).json({ error: "Permesso Approvvigionamenti non consentito per il ruolo" });
    return;
  }
  const caller = callerCentroId(req);
  const [current] = await db.select().from(approvvigionamentiTable).where(eq(approvvigionamentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(current.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (current.magazzinoId != null && !(await canAccessMagazzino(current.magazzinoId, caller, callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }

  const targetStato: string | undefined = req.body?.stato;
  const isStatoChange = targetStato !== undefined && targetStato !== current.stato;

  if (isStatoChange) {
    // The only stato transition allowed via PATCH is sottomesso -> completato.
    if (!(current.stato === "sottomesso" && targetStato === "completato")) {
      res.status(409).json({ error: "Transizione di stato non consentita" });
      return;
    }
    if (current.magazzinoId == null || current.fornitoreId == null) {
      res.status(409).json({ error: "La ricezione richiede Magazzino e Fornitore" }); return;
    }
    try {
      await db.transaction(async (tx) => {
        const [claimed] = await tx.update(approvvigionamentiTable)
          .set({ stato: "completato", versione: sql`${approvvigionamentiTable.versione} + 1` })
          .where(and(
            eq(approvvigionamentiTable.id, id),
            eq(approvvigionamentiTable.stato, "sottomesso"),
            eq(approvvigionamentiTable.versione, versione),
          ))
          .returning({ id: approvvigionamentiTable.id });
        if (!claimed) throw new InventoryLedgerError(409, "Approvvigionamento modificato o ricevuto da un altro operatore");
        await requireOperationalMagazzino(tx, current.magazzinoId!);
        const righe = await tx.select().from(approvvigionamentoRigheTable).where(eq(approvvigionamentoRigheTable.approvvigionamentoId, id));
        if (righe.length === 0) throw new InventoryLedgerError(409, "L'Approvvigionamento non contiene righe");
        const dataCarico = dataCivileEuropeRome(new Date());
        for (const riga of righe) {
          const residuo = Number(riga.quantitaRichiesta) - Number(riga.quantitaRicevuta);
          if (residuo <= 0) continue;
          await creaCaricoInventariale(tx, {
            prodottoId: riga.prodottoId,
            dataCarico,
            quantita: residuo,
            magazzinoId: current.magazzinoId!,
            fornitoreId: current.fornitoreId,
            fsePlus: false,
            documentoCarico: current.codice,
            causale: "acquisto",
            note: riga.note,
            operatoreId: req.user!.id,
          });
          await tx.update(approvvigionamentoRigheTable).set({ quantitaRicevuta: riga.quantitaRichiesta }).where(eq(approvvigionamentoRigheTable.id, riga.id));
        }
      });
    } catch (error) {
      if (error instanceof InventoryLedgerError) { res.status(error.status).json({ error: error.message }); return; }
      throw error;
    }
    res.json(await getWithRighe(id));
    return;
  }

  // Field edits are only allowed while the order is still a bozza.
  if (current.stato !== "bozza") {
    res.status(409).json({ error: "Ordine non modificabile: non è più in bozza" });
    return;
  }
  if (req.body.magazzinoId != null && req.body.magazzinoId !== current.magazzinoId
      && !(await canAccessMagazzino(req.body.magazzinoId, caller, callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }
  const targetFornitoreId = req.body.fornitoreId !== undefined ? req.body.fornitoreId : current.fornitoreId;
  const targetMagazzinoId = req.body.magazzinoId !== undefined ? Number(req.body.magazzinoId) : current.magazzinoId;
  if (targetMagazzinoId == null) { res.status(400).json({ error: "Il Magazzino è obbligatorio" }); return; }
  const [targetMagazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, targetMagazzinoId));
  if (!targetMagazzino) { res.status(404).json({ error: "Magazzino non trovato" }); return; }
  if (targetMagazzino.stato !== "attivo") { res.status(400).json({ error: "Il Magazzino selezionato non è attivo" }); return; }
  const targetCittaId = targetMagazzino.cittaId;
  const callerCitta = callerCittaId(req);
  if (callerCitta != null && Number(targetCittaId) !== callerCitta) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" }); return;
  }
  const relationError = await validateFornitoreArea(targetFornitoreId, targetCittaId);
  if (relationError) { res.status(400).json({ error: relationError }); return; }
  const allowed = new Set(["fornitoreId", "magazzinoId", "centroAscoltoId", "dataRichiesta", "dataPrevista", "note", "righe", "versione"]);
  const unsupported = Object.keys(req.body ?? {}).filter((key) => key !== "cittaId" && !allowed.has(key));
  if (unsupported.length > 0) { res.status(400).json({ error: `Campi non modificabili: ${unsupported.join(", ")}` }); return; }
  const updates = Object.fromEntries(Object.entries(req.body ?? {}).filter(([key]) => allowed.has(key) && key !== "righe" && key !== "versione"));
  delete updates.cittaId;
  if (caller != null) delete updates.centroAscoltoId;
  if (caller == null && updates.centroAscoltoId != null && updates.centroAscoltoId !== current.centroAscoltoId
      && !inVisibleCentroSet(Number(updates.centroAscoltoId), await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const righeInput = req.body?.righe as Array<{ prodottoId: number; quantitaRichiesta: number; unitaMisura: string; note?: string }> | undefined;
  if (righeInput && (righeInput.length === 0 || righeInput.some((r) => !(r.quantitaRichiesta > 0)))) {
    res.status(400).json({ error: "Le righe richiedono quantità maggiori di zero" });
    return;
  }
  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(approvvigionamentiTable)
      .set({ ...updates, versione: sql`${approvvigionamentiTable.versione} + 1` })
      .where(and(eq(approvvigionamentiTable.id, id), eq(approvvigionamentiTable.versione, versione)))
      .returning();
    if (!updated) throw new InventoryLedgerError(409, "Approvvigionamento modificato da un altro operatore");
    if (righeInput) {
      await tx.delete(approvvigionamentoRigheTable).where(eq(approvvigionamentoRigheTable.approvvigionamentoId, id));
      await tx.insert(approvvigionamentoRigheTable).values(righeInput.map((r) => ({
        approvvigionamentoId: id, prodottoId: r.prodottoId, quantitaRichiesta: r.quantitaRichiesta.toString(), quantitaRicevuta: "0", unitaMisura: r.unitaMisura, note: r.note,
      })));
    }
    return updated;
  }).catch((error) => {
    if (error instanceof InventoryLedgerError) return error;
    if (databaseErrorCode(error) === "23503") {
      return new InventoryLedgerError(400, "Una riga indica un Prodotto o una risorsa collegata inesistente");
    }
    throw error;
  });
  if (row instanceof InventoryLedgerError) { res.status(row.status).json({ error: row.message }); return; }
  const result = await getWithRighe(row.id);
  res.json(result);
});

router.post("/approvvigionamenti/:id/sottometti", requirePermission("approvvigionamenti.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const versione = requestedVersion(req.body);
  if (versione == null) {
    res.status(400).json({ error: "La versione corrente dell'Approvvigionamento è obbligatoria" });
    return;
  }
  const [current] = await db.select().from(approvvigionamentiTable).where(eq(approvvigionamentiTable.id, id));
  if (!current) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(current.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (current.magazzinoId != null && !(await canAccessMagazzino(current.magazzinoId, callerCentroId(req), callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  if (current.stato !== "bozza") {
    res.status(409).json({ error: "Solo gli ordini in bozza possono essere sottomessi" });
    return;
  }
  const [row] = await db
    .update(approvvigionamentiTable)
    .set({ stato: "sottomesso", versione: sql`${approvvigionamentiTable.versione} + 1` })
    .where(and(eq(approvvigionamentiTable.id, id), eq(approvvigionamentiTable.versione, versione)))
    .returning();
  if (!row) { res.status(409).json({ error: "Approvvigionamento modificato da un altro operatore" }); return; }

  const result = await getWithRighe(id);

  // Email notification to amministrazione (best-effort; does not block submission).
  try {
    const { sendApprovvigionamentoEmail } = await import("../lib/orderEmail.js");
    if (result) await sendApprovvigionamentoEmail(result);
  } catch (err) {
    req.log.error({ err }, "Invio email approvvigionamento fallito");
  }

  res.json(result);
});

// Manually (re)send the order email to amministrazione. Returns {sent, error?}
// instead of failing, so the UI can show a precise outcome toast.
router.post("/approvvigionamenti/:id/invia-email", requirePermission("approvvigionamenti.manage"), async (req, res) => {
  const id = Number(req.params.id);
  const result = await getWithRighe(id);
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(result.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (result.magazzinoId != null && !(await canAccessMagazzino(result.magazzinoId, callerCentroId(req), callerCittaId(req)))) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  try {
    const { sendApprovvigionamentoEmail } = await import("../lib/orderEmail.js");
    await sendApprovvigionamentoEmail(result);
    res.json({ sent: true, error: null });
  } catch (err) {
    req.log.error({ err }, "Invio email approvvigionamento (manuale) fallito");
    res.json({ sent: false, error: err instanceof Error ? err.message : "Invio fallito" });
  }
});

export default router;
