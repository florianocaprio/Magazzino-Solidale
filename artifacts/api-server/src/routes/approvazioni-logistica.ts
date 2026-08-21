import { Router, type IRouter, type Request } from "express";
import { db } from "@workspace/db";
import { volontariTable, mezziTable, centriAscoltoTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  andScoped,
  callerCentroId,
  callerAreaOperativaId,
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
import {
  isModuloAttivo,
  requireAnyModulo,
  requireModulo,
} from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import {
  effectiveAreaOperativaFilter,
  effectiveMezzoCentroExpr,
  effectiveCentroFilter,
  effectiveCentroMezzoTx,
  parseRequiredVersion,
} from "../lib/logisticaPolicy";
import { auditLogistica } from "../lib/logisticaAudit";

const router: IRouter = Router();

router.use(
  "/approvazioni-logistica",
  requireAnyModulo(["VOLONTARI", "MEZZI"]),
);

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
  versione: number;
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
  versione: r.versione,
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
  versione: number;
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
  versione: r.versione,
  dataCreazione: r.dataCreazione.toISOString(),
});

async function ensureVisibleCentro(rowCentroId: number | null, req: Request) {
  if (!canAccessCentro(rowCentroId, callerCentroId(req))) return false;
  return inVisibleCentroSet(rowCentroId, await visibleCentroIds(callerAreaOperativaId(req)));
}

router.get("/approvazioni-logistica", requirePermission("logistica.approvazioni.view"), async (req, res) => {
  const [volontariAttivi, mezziAttivi] = await Promise.all([
    isModuloAttivo("VOLONTARI"),
    isModuloAttivo("MEZZI"),
  ]);
  const areaOperativaCentroIds = await visibleCentroIds(callerAreaOperativaId(req));
  const scope = andScoped(
    centroScopeFilter(volontariTable.centroAscoltoId, callerCentroId(req)),
    idSetScopeFilter(volontariTable.centroAscoltoId, areaOperativaCentroIds),
  );
  const volontari = volontariAttivi ? await db
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
      versione: volontariTable.versione,
      dataCreazione: volontariTable.dataCreazione,
    })
    .from(volontariTable)
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id))
    .where(andScoped(eq(volontariTable.statoApprovazione, PENDING), scope))
    .orderBy(desc(volontariTable.dataCreazione)) : [];

  const mezzoScope = andScoped(
    effectiveCentroFilter(callerCentroId(req)),
    effectiveAreaOperativaFilter(areaOperativaCentroIds),
  );
  const mezzi = mezziAttivi ? await db
    .select({
      id: mezziTable.id,
      codice: mezziTable.codice,
      tipo: mezziTable.tipo,
      targa: mezziTable.targa,
      proprieta: mezziTable.proprieta,
      proprietarioNome: mezziTable.proprietarioNome,
      centroAscoltoId: effectiveMezzoCentroExpr,
      centroAscoltoNome: centriAscoltoTable.nome,
      descrizione: mezziTable.descrizione,
      stato: mezziTable.stato,
      statoApprovazione: mezziTable.statoApprovazione,
      note: mezziTable.note,
      dataCreazione: mezziTable.dataCreazione,
      versione: mezziTable.versione,
    })
    .from(mezziTable)
    .leftJoin(volontariTable, eq(mezziTable.volontarioId, volontariTable.id))
    .leftJoin(centriAscoltoTable, sql`${centriAscoltoTable.id} = ${effectiveMezzoCentroExpr}`)
    .where(andScoped(eq(mezziTable.statoApprovazione, PENDING), mezzoScope))
    .orderBy(desc(mezziTable.dataCreazione)) : [];

  res.json({ volontari: volontari.map(fmtVolontario), mezzi: mezzi.map(fmtMezzo) });
});

router.post("/approvazioni-logistica/volontari/:id/approva", requireModulo("VOLONTARI"), requirePermission("logistica.approvazioni.manage"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  if (existing.statoApprovazione !== PENDING) { res.status(409).json({ error: "Transizione di approvazione non consentita" }); return; }
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
    const [updated] = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(volontariTable)
        .set({ matricola, statoApprovazione: "approvato", attivo: true, versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date() })
        .where(and(eq(volontariTable.id, id), eq(volontariTable.versione, versione), eq(volontariTable.statoApprovazione, PENDING)))
        .returning({ versione: volontariTable.versione });
      if (!row) return [];
      await auditLogistica(tx, req, { entita: "volontario", id, azione: "approvazione", precedente: { statoApprovazione: PENDING, versione }, nuovo: { statoApprovazione: "approvato", attivo: true, versione: row.versione } });
      return [row];
    });
    if (!updated) { res.status(409).json({ error: "La richiesta è stata aggiornata da un altro operatore" }); return; }
    res.json({ ok: true, versione: updated.versione });
  } catch (e) {
    if (isVolontarioMatricolaUniqueViolation(e)) {
      res.status(409).json(await matricolaVolontarioDuplicataPayload(matricola, id));
      return;
    }
    throw e;
  }
});

router.post("/approvazioni-logistica/volontari/:id/respingi", requireModulo("VOLONTARI"), requirePermission("logistica.approvazioni.manage"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  if (!(await ensureVisibleCentro(existing.centroAscoltoId ?? null, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  if (existing.statoApprovazione !== PENDING) { res.status(409).json({ error: "Transizione di approvazione non consentita" }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(volontariTable).set({ statoApprovazione: "respinto", attivo: false, versione: sql`${volontariTable.versione} + 1`, dataAggiornamento: new Date() }).where(and(eq(volontariTable.id, id), eq(volontariTable.versione, versione), eq(volontariTable.statoApprovazione, PENDING))).returning({ versione: volontariTable.versione });
    if (!row) return [];
    await auditLogistica(tx, req, { entita: "volontario", id, azione: "rifiuto", precedente: { statoApprovazione: PENDING, versione }, nuovo: { statoApprovazione: "respinto", attivo: false, versione: row.versione } });
    return [row];
  });
  if (!updated) { res.status(409).json({ error: "La richiesta è stata aggiornata da un altro operatore" }); return; }
  res.json({ ok: true, versione: updated.versione });
});

router.post("/approvazioni-logistica/mezzi/:id/approva", requireModulo("MEZZI"), requirePermission("logistica.approvazioni.manage"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(mezziTable).where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const effectiveCentro = await db.transaction((tx) => effectiveCentroMezzoTx(tx, existing));
  if (!(await ensureVisibleCentro(effectiveCentro, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  if (existing.statoApprovazione !== PENDING) { res.status(409).json({ error: "Transizione di approvazione non consentita" }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(mezziTable).set({ statoApprovazione: "approvato", stato: "disponibile", versione: sql`${mezziTable.versione} + 1`, dataAggiornamento: new Date() }).where(and(eq(mezziTable.id, id), eq(mezziTable.versione, versione), eq(mezziTable.statoApprovazione, PENDING))).returning({ versione: mezziTable.versione });
    if (!row) return [];
    await auditLogistica(tx, req, { entita: "mezzo", id, azione: "approvazione", precedente: { statoApprovazione: PENDING, versione }, nuovo: { statoApprovazione: "approvato", stato: "disponibile", versione: row.versione } });
    return [row];
  });
  if (!updated) { res.status(409).json({ error: "La richiesta è stata aggiornata da un altro operatore" }); return; }
  res.json({ ok: true, versione: updated.versione });
});

router.post("/approvazioni-logistica/mezzi/:id/respingi", requireModulo("MEZZI"), requirePermission("logistica.approvazioni.manage"), async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(mezziTable).where(eq(mezziTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const effectiveCentro = await db.transaction((tx) => effectiveCentroMezzoTx(tx, existing));
  if (!(await ensureVisibleCentro(effectiveCentro, req))) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo perimetro" });
    return;
  }
  const versione = parseRequiredVersion(req.body?.versione);
  if (versione == null) { res.status(400).json({ error: "versione obbligatoria e valida" }); return; }
  if (existing.statoApprovazione !== PENDING) { res.status(409).json({ error: "Transizione di approvazione non consentita" }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(mezziTable).set({ statoApprovazione: "respinto", stato: "respinto", versione: sql`${mezziTable.versione} + 1`, dataAggiornamento: new Date() }).where(and(eq(mezziTable.id, id), eq(mezziTable.versione, versione), eq(mezziTable.statoApprovazione, PENDING))).returning({ versione: mezziTable.versione });
    if (!row) return [];
    await auditLogistica(tx, req, { entita: "mezzo", id, azione: "rifiuto", precedente: { statoApprovazione: PENDING, versione }, nuovo: { statoApprovazione: "respinto", stato: "respinto", versione: row.versione } });
    return [row];
  });
  if (!updated) { res.status(409).json({ error: "La richiesta è stata aggiornata da un altro operatore" }); return; }
  res.json({ ok: true, versione: updated.versione });
});

export default router;
