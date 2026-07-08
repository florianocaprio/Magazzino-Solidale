import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { approvvigionamentiTable, approvvigionamentoRigheTable, fornitoriTable, prodottiTable, magazziniTable, centriAscoltoTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
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

const router: IRouter = Router();
router.use("/approvvigionamenti", requireModulo("APPROVVIGIONAMENTI"));

async function getWithRighe(id: number) {
  const [a] = await db.select({
    a: approvvigionamentiTable,
    fornitoreNome: fornitoriTable.nome,
    magazzinoNome: magazziniTable.nome,
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
    codice: a.a.codice,
    fornitoreId: a.a.fornitoreId ?? null,
    fornitoreNome: a.fornitoreNome ?? null,
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

router.get("/approvvigionamenti", async (req, res) => {
  const { stato, magazzinoId, centroAscoltoId } = req.query as Record<string, string>;
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

  const rows = await db
    .select({
      a: approvvigionamentiTable,
      fornitoreNome: fornitoriTable.nome,
      magazzinoNome: magazziniTable.nome,
      centroAscoltoNome: centriAscoltoTable.nome,
    })
    .from(approvvigionamentiTable)
    .leftJoin(fornitoriTable, eq(approvvigionamentiTable.fornitoreId, fornitoriTable.id))
    .leftJoin(magazziniTable, eq(approvvigionamentiTable.magazzinoId, magazziniTable.id))
    .leftJoin(centriAscoltoTable, eq(approvvigionamentiTable.centroAscoltoId, centriAscoltoTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(approvvigionamentiTable.dataCreazione))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.a.id,
    codice: r.a.codice,
    fornitoreId: r.a.fornitoreId ?? null,
    fornitoreNome: r.fornitoreNome ?? null,
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

router.post("/approvvigionamenti", async (req, res) => {
  const body = req.body;
  const caller = callerCentroId(req);
  if (body.magazzinoId != null && !(await canAccessMagazzino(body.magazzinoId, caller, callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }
  if (caller == null && body.centroAscoltoId != null
      && !inVisibleCentroSet(body.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const codice = `APP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const [a] = await db.insert(approvvigionamentiTable).values({
    codice,
    fornitoreId: body.fornitoreId,
    magazzinoId: body.magazzinoId,
    centroAscoltoId: caller != null ? caller : body.centroAscoltoId,
    dataRichiesta: body.dataRichiesta,
    dataPrevista: body.dataPrevista,
    stato: "bozza",
    note: body.note,
  }).returning();

  if (body.righe?.length) {
    await db.insert(approvvigionamentoRigheTable).values(
      body.righe.map((r: { prodottoId: number; quantitaRichiesta: number; unitaMisura: string; note?: string }) => ({
        approvvigionamentoId: a.id,
        prodottoId: r.prodottoId,
        quantitaRichiesta: r.quantitaRichiesta.toString(),
        quantitaRicevuta: "0",
        unitaMisura: r.unitaMisura,
        note: r.note,
      }))
    );
  }

  const result = await getWithRighe(a.id);
  res.status(201).json(result);
});

router.get("/approvvigionamenti/:id", async (req, res) => {
  const result = await getWithRighe(parseInt(req.params.id));
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
  const id = parseInt(req.params.id);
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
    const [row] = await db.update(approvvigionamentiTable).set({ stato: "completato" }).where(eq(approvvigionamentiTable.id, id)).returning();
    const result = await getWithRighe(row.id);
    res.json(result);
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
  const updates = { ...req.body };
  if (caller != null) delete updates.centroAscoltoId;
  if (caller == null && updates.centroAscoltoId != null && updates.centroAscoltoId !== current.centroAscoltoId
      && !inVisibleCentroSet(updates.centroAscoltoId, await visibleCentroIds(callerCittaId(req)))) {
    res.status(403).json({ error: "Centro non accessibile per la tua città" });
    return;
  }
  const [row] = await db.update(approvvigionamentiTable).set(updates).where(eq(approvvigionamentiTable.id, id)).returning();
  const result = await getWithRighe(row.id);
  res.json(result);
});

router.post("/approvvigionamenti/:id/sottometti", async (req, res) => {
  const id = parseInt(req.params.id);
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
    .set({ stato: "sottomesso" })
    .where(eq(approvvigionamentiTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }

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
router.post("/approvvigionamenti/:id/invia-email", async (req, res) => {
  const id = parseInt(req.params.id);
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
