import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { beneficiariTable, nucleoFamiliareTable, interventiTable, consegneTable, centriAscoltoTable } from "@workspace/db";
import { eq, and, ilike, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  centroScopeFilter,
  canAccessCentro,
  beneficiarioCentroId,
} from "../lib/centroScope";

const router: IRouter = Router();

function fmtBenef(r: typeof beneficiariTable.$inferSelect, centroNome?: string | null) {
  return {
    id: r.id,
    codice: r.codice,
    codiceFiscale: r.codiceFiscale ?? null,
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
    attivo: r.attivo,
    dataPresaInCarico: r.dataPresaInCarico ?? null,
    noteInterne: r.noteInterne ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

router.get("/beneficiari", async (req, res) => {
  const { search, priorita, domicilio, centroAscoltoId, attivo } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (search) {
    conditions.push(ilike(beneficiariTable.cognome, `%${search}%`));
  }
  if (priorita) conditions.push(eq(beneficiariTable.priorita, priorita));
  if (domicilio === "true") conditions.push(eq(beneficiariTable.consegnaDomicilio, true));
  const caller = callerCentroId(req);
  if (caller != null) {
    const f = centroScopeFilter(beneficiariTable.centroAscoltoId, caller);
    if (f) conditions.push(f);
  } else if (centroAscoltoId) {
    conditions.push(eq(beneficiariTable.centroAscoltoId, parseInt(centroAscoltoId)));
  }
  if (attivo === "true") conditions.push(eq(beneficiariTable.attivo, true));
  else if (attivo === "false") conditions.push(eq(beneficiariTable.attivo, false));

  const rows = await db
    .select({ b: beneficiariTable, centroNome: centriAscoltoTable.nome })
    .from(beneficiariTable)
    .leftJoin(centriAscoltoTable, eq(beneficiariTable.centroAscoltoId, centriAscoltoTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(beneficiariTable.cognome);
  res.json(rows.map(r => fmtBenef(r.b, r.centroNome)));
});

router.post("/beneficiari", async (req, res) => {
  const body = req.body;
  const caller = callerCentroId(req);
  const codice = body.codice || `BEN-${Date.now()}`;
  const values = { ...body, codice };
  if (caller != null) values.centroAscoltoId = caller;
  const [row] = await db.insert(beneficiariTable).values(values).returning();
  res.status(201).json(fmtBenef(row));
});

router.get("/beneficiari/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
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
  const [existing] = await db.select().from(beneficiariTable).where(eq(beneficiariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!canAccessCentro(existing.centroAscoltoId, caller)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const updates = { ...req.body, dataAggiornamento: new Date() };
  if (caller != null) delete updates.centroAscoltoId;
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
  await db.delete(beneficiariTable).where(eq(beneficiariTable.id, id));
  res.status(204).send();
});

router.get("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const rows = await db.select().from(nucleoFamiliareTable).where(eq(nucleoFamiliareTable.beneficiarioId, id));
  res.json(rows.map(n => ({ ...n, dataNascita: n.dataNascita ?? null, sesso: n.sesso ?? null, tagliaVestiti: n.tagliaVestiti ?? null, numeroScarpe: n.numeroScarpe ?? null })));
});

router.post("/beneficiari/:id/nucleo", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  const [row] = await db.insert(nucleoFamiliareTable).values({ ...req.body, beneficiarioId: id }).returning();
  res.status(201).json(row);
});

router.delete("/beneficiari/:id/nucleo/:membroId", async (req, res) => {
  const id = parseInt(req.params.id);
  if (!canAccessCentro(await beneficiarioCentroId(id), callerCentroId(req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  await db
    .delete(nucleoFamiliareTable)
    .where(and(eq(nucleoFamiliareTable.id, parseInt(req.params.membroId)), eq(nucleoFamiliareTable.beneficiarioId, id)));
  res.status(204).send();
});

export default router;
