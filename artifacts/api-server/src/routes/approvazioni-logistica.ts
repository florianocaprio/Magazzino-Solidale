import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { volontariTable, mezziTable, centriAscoltoTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import {
  andScoped,
  callerCentroId,
  callerCittaId,
  canAccessCentro,
  centroScopeFilter,
  idSetScopeFilter,
  inVisibleCentroSet,
  visibleCentroIds,
} from "../lib/centroScope";
import {
  isVolontarioMatricolaUniqueViolation,
  MATRICOLA_OBBLIGATORIA_MSG,
  matricolaVolontarioDuplicataPayload,
  matricolaVolontarioGiaUsata,
  normalizeVolontarioMatricola,
} from "../lib/volontariMatricola";

const router: IRouter = Router();

const PENDING = "in_attesa";

const fmtVolontario = (r: {
  id: number;
  nome: string;
  cognome: string;
  matricola: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  telefono: string | null;
  email: string | null;
  ruolo: string;
  attivo: boolean;
  statoApprovazione: string;
  note: string | null;
  dataCreazione: Date;
}) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  matricola: r.matricola ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  ruolo: r.ruolo,
  attivo: r.attivo,
  statoApprovazione: r.statoApprovazione,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

const fmtMezzo = (r: {
  id: number;
  codice: string;
  tipo: string;
  targa: string | null;
  proprieta: string;
  proprietarioNome: string | null;
  centroAscoltoId: number | null;
  centroAscoltoNome: string | null;
  descrizione: string | null;
  stato: string;
  statoApprovazione: string;
  note: string | null;
  dataCreazione: Date;
}) => ({
  id: r.id,
  codice: r.codice,
  tipo: r.tipo,
  targa: r.targa ?? null,
  proprieta: r.proprieta,
  proprietarioNome: r.proprietarioNome ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
  descrizione: r.descrizione ?? null,
  stato: r.stato,
  statoApprovazione: r.statoApprovazione,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function ensureVisibleCentro(rowCentroId: number | null, req: Request) {
  if (!canAccessCentro(rowCentroId, callerCentroId(req))) return false;
  return inVisibleCentroSet(rowCentroId, await visibleCentroIds(callerCittaId(req)));
}

router.get("/approvazioni-logistica", async (req, res) => {
  const cittaCentroIds = await visibleCentroIds(callerCittaId(req));
  const scope = andScoped(
    centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
    idSetScopeFilter(volontariTable.centroAscoltoId, cittaCentroIds),
  );
  const volontari = await db
    .select({
      id: volontariTable.id,
      nome: volontariTable.nome,
      cognome: volontariTable.cognome,
      matricola: volontariTable.matricola,
      centroAscoltoId: volontariTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      telefono: volontariTable.telefono,
      email: volontariTable.email,
      ruolo: volontariTable.ruolo,
      attivo: volontariTable.attivo,
      statoApprovazione: volontariTable.statoApprovazione,
      note: volontariTable.note,
      dataCreazione: volontariTable.dataCreazione,
    })
    .from(volontariTable)
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id))
    .where(andScoped(eq(volontariTable.statoApprovazione, PENDING), scope))
    .orderBy(desc(volontariTable.dataCreazione));

  const mezzoScope = andScoped(
    centroScopeFilter(mezziTable.centroAscoltoId, callerCentroId(req)),
    idSetScopeFilter(mezziTable.centroAscoltoId, cittaCentroIds),
  );
  const mezzi = await db
    .select({
      id: mezziTable.id,
      codice: mezziTable.codice,
      tipo: mezziTable.tipo,
      targa: mezziTable.targa,
      proprieta: mezziTable.proprieta,
      proprietarioNome: mezziTable.proprietarioNome,
      centroAscoltoId: mezziTable.centroAscoltoId,
      centroAscoltoNome: centriAscoltoTable.nome,
      descrizione: mezziTable.descrizione,
      stato: mezziTable.stato,
      statoApprovazione: mezziTable.statoApprovazione,
      note: mezziTable.note,
      dataCreazione: mezziTable.dataCreazione,
    })
    .from(mezziTable)
    .leftJoin(centriAscoltoTable, eq(mezziTable.centroAscoltoId, centriAscoltoTable.id))
    .where(andScoped(eq(mezziTable.statoApprovazione, PENDING), mezzoScope))
    .orderBy(desc(mezziTable.dataCreazione));

  res.json({ volontari: volontari.map(fmtVolontario), mezzi: mezzi.map(fmtMezzo) });
});

router.post("/approvazioni-logistica/volontari/:id/approva", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  const matricola = normalizeVolontarioMatricola(existing.matricola);
  if (!matricola) {
    res.status(400).json({ error: MATRICOLA_OBBLIGATORIA_MSG });
    return;
  }
  if (await matricolaVolontarioGiaUsata(matricola, id)) {
    res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola, id));
    return;
  }
  try {
    await db
      .update(volontariTable)
      .set({ matricola, statoApprovazione: "approvato", attivo: true })
      .where(eq(volontariTable.id, id));
  } catch (e) {
    if (isVolontarioMatricolaUniqueViolation(e)) {
      res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola, id));
      return;
    }
    throw e;
  }
  res.json({ ok: true });
});

router.post("/approvazioni-logistica/volontari/:id/respingi", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  await db
    .update(volontariTable)
    .set({ statoApprovazione: "respinto", attivo: false })
    .where(eq(volontariTable.id, id));
  res.json({ ok: true });
});

router.post("/approvazioni-logistica/mezzi/:id/approva", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(mezziTable).where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  await db
    .update(mezziTable)
    .set({ statoApprovazione: "approvato", stato: "disponibile" })
    .where(eq(mezziTable.id, id));
  res.json({ ok: true });
});

router.post("/approvazioni-logistica/mezzi/:id/respingi", async (req, res) => {
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(mezziTable).where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  await db
    .update(mezziTable)
    .set({ statoApprovazione: "respinto", stato: "respinto" })
    .where(eq(mezziTable.id, id));
  res.json({ ok: true });
});

export default router;
