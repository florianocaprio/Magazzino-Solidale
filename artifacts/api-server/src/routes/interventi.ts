import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { interventiTable, beneficiariTable, utentiTable } from "@workspace/db";
import { eq, and, desc, or, ilike, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  cittaScopeFilter,
  canAccessCentro,
  canAccessCitta,
  beneficiarioCentroId,
  beneficiarioCittaId,
  canUseBeneficiario,
} from "../lib/centroScope";

const router: IRouter = Router();

router.get("/interventi", async (req, res) => {
  const { beneficiarioId, tipo, centroAscoltoId } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (beneficiarioId) conditions.push(eq(interventiTable.beneficiarioId, parseInt(beneficiarioId)));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  const cittaFilter = cittaScopeFilter(beneficiariTable.cittaId, callerCittaId(req));
  if (cittaFilter) conditions.push(cittaFilter);
  // tipoIntervento può essere una lista di etichette separate da virgola
  // (es. "pacco_alimentare,igiene"): il filtro deve trovare anche i valori multipli
  if (tipo) {
    const tokenMatch = or(
      eq(interventiTable.tipoIntervento, tipo),
      ilike(interventiTable.tipoIntervento, `${tipo},%`),
      ilike(interventiTable.tipoIntervento, `%,${tipo}`),
      ilike(interventiTable.tipoIntervento, `%,${tipo},%`),
    );
    if (tokenMatch) conditions.push(tokenMatch);
  }

  const rows = await db
    .select({
      i: interventiTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(interventiTable)
    .leftJoin(beneficiariTable, eq(interventiTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(utentiTable, eq(interventiTable.operatoreId, utentiTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(interventiTable.dataIntervento))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.i.id,
    beneficiarioId: r.i.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    operatoreId: r.i.operatoreId ?? null,
    operatoreCodice: r.operatoreMatricola ?? r.operatoreUsername ?? null,
    dataIntervento: r.i.dataIntervento,
    tipoIntervento: r.i.tipoIntervento,
    descrizione: r.i.descrizione ?? null,
    esito: r.i.esito ?? null,
    prossimAzione: r.i.prossimAzione ?? null,
    note: r.i.note ?? null,
    dataFollowup: r.i.dataFollowup ?? null,
    scadenzaIsee: r.i.scadenzaIsee ?? null,
    scadenzaRinnovo: r.i.scadenzaRinnovo ?? null,
    scadenzaAutodichiarazioneIndigenza: r.i.scadenzaAutodichiarazioneIndigenza ?? null,
    dataCreazione: r.i.dataCreazione.toISOString(),
  })));
});

router.post("/interventi", async (req, res) => {
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  if ((caller != null || cid != null) && !(await canUseBeneficiario(req.body.beneficiarioId, caller, cid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  const [row] = await db.insert(interventiTable).values({ ...req.body, operatoreId: req.user!.id }).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/interventi/:id", async (req, res) => {
  const [row] = await db.select().from(interventiTable).where(eq(interventiTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(await beneficiarioCentroId(row.beneficiarioId), callerCentroId(req))
      || !canAccessCitta(await beneficiarioCittaId(row.beneficiarioId), callerCittaId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/interventi/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(interventiTable).where(eq(interventiTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const caller = callerCentroId(req);
  const cid = callerCittaId(req);
  if (!canAccessCentro(await beneficiarioCentroId(existing.beneficiarioId), caller)
      || !canAccessCitta(await beneficiarioCittaId(existing.beneficiarioId), cid)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if ((caller != null || cid != null) && req.body.beneficiarioId != null && req.body.beneficiarioId !== existing.beneficiarioId
      && !(await canUseBeneficiario(req.body.beneficiarioId, caller, cid))) {
    res.status(403).json({ error: "Beneficiario non accessibile per il tuo centro" });
    return;
  }
  const [row] = await db.update(interventiTable).set({ ...req.body, operatoreId: req.user!.id }).where(eq(interventiTable.id, id)).returning();
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
