import { Router, type IRouter, type Request } from "express";
import {
  corsiDeiVolontariTable,
  corsiVolontariCatalogoTable,
  corsiVolontariRuoliTable,
  db,
  qualificheDeiVolontariTable,
  qualificheVolontariCatalogoTable,
  qualificheVolontariRuoliTable,
  volontariTable,
} from "@workspace/db";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessCentro,
  inVisibleCentroSet,
  visibleCentroIds,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { auditLogistica } from "../lib/logisticaAudit";
import { parseRequiredVersion } from "../lib/logisticaPolicy";
import { addCalendarMonthsClamped, isDateOnly } from "../lib/volontariDomain";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/volontari", requireModulo("VOLONTARI"));
const actorId = (req: Request): number | null =>
  req.user?.id && req.user.id > 0 ? req.user.id : null;

function clean(value: unknown, max: number): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result ? result.slice(0, max) : null;
}

function positiveMonths(value: unknown): number | null | undefined {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 240 ? parsed : undefined;
}

function roles(value: unknown): Array<{ ruoloVolontarioId: number; livello: "OBBLIGATORIO" | "CONSIGLIATO" }> | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const result = value.map((item) => ({
    ruoloVolontarioId: Number(item?.ruoloVolontarioId),
    livello: String(item?.livello ?? "CONSIGLIATO").toUpperCase(),
  }));
  if (result.some((item) => !Number.isSafeInteger(item.ruoloVolontarioId) || item.ruoloVolontarioId <= 0 || !["OBBLIGATORIO", "CONSIGLIATO"].includes(item.livello))) return null;
  return [...new Map(result.map((item) => [item.ruoloVolontarioId, item])).values()] as Array<{ ruoloVolontarioId: number; livello: "OBBLIGATORIO" | "CONSIGLIATO" }>;
}

async function scopedVolunteer(req: Request) {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return { status: 400, error: "Volontario non valido" } as const;
  const [row] = await db.select().from(volontariTable).where(eq(volontariTable.id, id));
  if (!row) return { status: 404, error: "Volontario non trovato" } as const;
  if (!canAccessCentro(row.centroAscoltoId, callerCentroId(req)) || !inVisibleCentroSet(row.centroAscoltoId, await visibleCentroIds(callerAreaOperativaId(req)))) {
    return { status: 403, error: "Volontario non accessibile" } as const;
  }
  return { row } as const;
}

router.get("/volontari/formazione/corsi", requirePermission("logistica.volontari.view"), async (_req, res) => {
  const [catalog, links] = await Promise.all([
    db.select().from(corsiVolontariCatalogoTable).orderBy(asc(corsiVolontariCatalogoTable.titolo)),
    db.select().from(corsiVolontariRuoliTable),
  ]);
  res.json(catalog.map((item) => ({ ...item, ruoli: links.filter((link) => link.corsoId === item.id) })));
});

router.post("/volontari/formazione/corsi", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const codice = clean(req.body?.codice, 40)?.toUpperCase();
  const titolo = clean(req.body?.titolo, 160);
  const ore = Number(req.body?.ore ?? 0);
  const validitaMesi = positiveMonths(req.body?.validitaMesi);
  const roleLinks = roles(req.body?.ruoli);
  if (!codice || !titolo || !Number.isSafeInteger(ore) || ore < 0 || validitaMesi === undefined || !roleLinks) {
    res.status(400).json({ error: "Dati del corso non validi" }); return;
  }
  const created = await db.transaction(async (tx) => {
    const [course] = await tx.insert(corsiVolontariCatalogoTable).values({
      codice, titolo, descrizione: clean(req.body?.descrizione, 4_000), ore,
      enteDocente: clean(req.body?.enteDocente, 160), validitaMesi,
      attivo: req.body?.attivo !== false,
    }).returning();
    if (roleLinks.length) await tx.insert(corsiVolontariRuoliTable).values(roleLinks.map((link) => ({ corsoId: course.id, ...link })));
    return course;
  });
  res.status(201).json(created);
});

router.patch("/volontari/formazione/corsi/:catalogoId", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const id = Number(req.params.catalogoId);
  const versione = parseRequiredVersion(req.body?.versione);
  const roleLinks = req.body?.ruoli === undefined ? undefined : roles(req.body.ruoli);
  const validitaMesi = req.body?.validitaMesi === undefined ? undefined : positiveMonths(req.body.validitaMesi);
  const nextTitolo = req.body?.titolo === undefined ? undefined : clean(req.body.titolo, 160);
  const nextCodice = req.body?.codice === undefined ? undefined : clean(req.body.codice, 40)?.toUpperCase();
  if (!Number.isSafeInteger(id) || id <= 0 || versione == null || roleLinks === null || validitaMesi === undefined && req.body?.validitaMesi !== undefined || nextTitolo === null || nextCodice === null) {
    res.status(400).json({ error: "Modifica corso non valida" }); return;
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(corsiVolontariCatalogoTable).set({
      ...(nextCodice !== undefined ? { codice: nextCodice } : {}),
      ...(nextTitolo !== undefined ? { titolo: nextTitolo } : {}),
      ...(req.body?.descrizione !== undefined ? { descrizione: clean(req.body.descrizione, 4_000) } : {}),
      ...(req.body?.ore !== undefined ? { ore: Number(req.body.ore) } : {}),
      ...(req.body?.enteDocente !== undefined ? { enteDocente: clean(req.body.enteDocente, 160) } : {}),
      ...(req.body?.validitaMesi !== undefined ? { validitaMesi: validitaMesi ?? null } : {}),
      ...(typeof req.body?.attivo === "boolean" ? { attivo: req.body.attivo } : {}),
      versione: sql`${corsiVolontariCatalogoTable.versione} + 1`, dataAggiornamento: new Date(),
    }).where(and(eq(corsiVolontariCatalogoTable.id, id), eq(corsiVolontariCatalogoTable.versione, versione))).returning();
    if (!row) return null;
    if (roleLinks) {
      await tx.delete(corsiVolontariRuoliTable).where(eq(corsiVolontariRuoliTable.corsoId, id));
      if (roleLinks.length) await tx.insert(corsiVolontariRuoliTable).values(roleLinks.map((link) => ({ corsoId: id, ...link })));
    }
    return row;
  });
  if (!updated) { res.status(409).json({ error: "Il corso è stato aggiornato da un altro operatore" }); return; }
  res.json(updated);
});

router.post("/volontari/:id/corsi", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const scoped = await scopedVolunteer(req);
  if (!("row" in scoped) || !scoped.row) { res.status(scoped.status).json({ error: scoped.error }); return; }
  const volunteer = scoped.row;
  const corsoId = Number(req.body?.corsoId);
  const dataCompletamento = req.body?.dataCompletamento;
  const [catalog] = Number.isSafeInteger(corsoId) ? await db.select().from(corsiVolontariCatalogoTable).where(eq(corsiVolontariCatalogoTable.id, corsoId)) : [];
  if (!catalog || !isDateOnly(dataCompletamento)) { res.status(400).json({ error: "Corso o data completamento non validi" }); return; }
  const ore = Number(req.body?.ore ?? catalog.ore);
  if (!Number.isSafeInteger(ore) || ore < 0) { res.status(400).json({ error: "Ore non valide" }); return; }
  const dataScadenza = req.body?.dataScadenza == null
    ? (catalog.validitaMesi ? addCalendarMonthsClamped(dataCompletamento, catalog.validitaMesi) : null)
    : req.body.dataScadenza;
  if (dataScadenza != null && !isDateOnly(dataScadenza)) { res.status(400).json({ error: "Data scadenza non valida" }); return; }
  const [created] = await db.insert(corsiDeiVolontariTable).values({
    volontarioId: volunteer.id, corsoId, dataCompletamento,
    esito: clean(req.body?.esito, 30) ?? "COMPLETATO", ore, dataScadenza,
    numeroAttestato: clean(req.body?.numeroAttestato, 100),
    riferimentoDocumento: clean(req.body?.riferimentoDocumento, 255),
    note: clean(req.body?.note, 4_000), verificatoDa: actorId(req),
  }).returning();
  await db.transaction(async (tx) => auditLogistica(tx, req, { entita: "volontario", id: volunteer.id, azione: "corso_registrato", nuovo: { corsoVolontarioId: created.id, corsoId } }));
  res.status(201).json(created);
});

router.get("/volontari/formazione/qualifiche", requirePermission("logistica.volontari.view"), async (_req, res) => {
  const [catalog, links] = await Promise.all([
    db.select().from(qualificheVolontariCatalogoTable).orderBy(asc(qualificheVolontariCatalogoTable.nome)),
    db.select().from(qualificheVolontariRuoliTable),
  ]);
  res.json(catalog.map((item) => ({ ...item, ruoli: links.filter((link) => link.qualificaId === item.id) })));
});

router.post("/volontari/formazione/qualifiche", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const codice = clean(req.body?.codice, 40)?.toUpperCase();
  const nome = clean(req.body?.nome, 160);
  const validitaMesi = positiveMonths(req.body?.validitaMesi);
  const roleLinks = roles(req.body?.ruoli);
  if (!codice || !nome || validitaMesi === undefined || !roleLinks) { res.status(400).json({ error: "Dati qualifica non validi" }); return; }
  const created = await db.transaction(async (tx) => {
    const [qualification] = await tx.insert(qualificheVolontariCatalogoTable).values({
      codice, nome, descrizione: clean(req.body?.descrizione, 4_000), validitaMesi,
      attivo: req.body?.attivo !== false,
    }).returning();
    if (roleLinks.length) await tx.insert(qualificheVolontariRuoliTable).values(roleLinks.map((link) => ({ qualificaId: qualification.id, ...link })));
    return qualification;
  });
  res.status(201).json(created);
});

router.patch("/volontari/formazione/qualifiche/:catalogoId", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const id = Number(req.params.catalogoId);
  const versione = parseRequiredVersion(req.body?.versione);
  const roleLinks = req.body?.ruoli === undefined ? undefined : roles(req.body.ruoli);
  const validitaMesi = req.body?.validitaMesi === undefined ? undefined : positiveMonths(req.body.validitaMesi);
  const nextNome = req.body?.nome === undefined ? undefined : clean(req.body.nome, 160);
  const nextCodice = req.body?.codice === undefined ? undefined : clean(req.body.codice, 40)?.toUpperCase();
  if (!Number.isSafeInteger(id) || id <= 0 || versione == null || roleLinks === null || validitaMesi === undefined && req.body?.validitaMesi !== undefined || nextNome === null || nextCodice === null) {
    res.status(400).json({ error: "Modifica qualifica non valida" }); return;
  }
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(qualificheVolontariCatalogoTable).set({
      ...(nextCodice !== undefined ? { codice: nextCodice } : {}),
      ...(nextNome !== undefined ? { nome: nextNome } : {}),
      ...(req.body?.descrizione !== undefined ? { descrizione: clean(req.body.descrizione, 4_000) } : {}),
      ...(req.body?.validitaMesi !== undefined ? { validitaMesi: validitaMesi ?? null } : {}),
      ...(typeof req.body?.attivo === "boolean" ? { attivo: req.body.attivo } : {}),
      versione: sql`${qualificheVolontariCatalogoTable.versione} + 1`, dataAggiornamento: new Date(),
    }).where(and(eq(qualificheVolontariCatalogoTable.id, id), eq(qualificheVolontariCatalogoTable.versione, versione))).returning();
    if (!row) return null;
    if (roleLinks) {
      await tx.delete(qualificheVolontariRuoliTable).where(eq(qualificheVolontariRuoliTable.qualificaId, id));
      if (roleLinks.length) await tx.insert(qualificheVolontariRuoliTable).values(roleLinks.map((link) => ({ qualificaId: id, ...link })));
    }
    return row;
  });
  if (!updated) { res.status(409).json({ error: "La qualifica è stata aggiornata da un altro operatore" }); return; }
  res.json(updated);
});

router.post("/volontari/:id/qualifiche", requirePermission("logistica.volontari.manage"), async (req, res) => {
  const scoped = await scopedVolunteer(req);
  if (!("row" in scoped) || !scoped.row) { res.status(scoped.status).json({ error: scoped.error }); return; }
  const volunteer = scoped.row;
  const qualificaId = Number(req.body?.qualificaId);
  const dataOttenimento = req.body?.dataOttenimento;
  const [catalog] = Number.isSafeInteger(qualificaId) ? await db.select().from(qualificheVolontariCatalogoTable).where(eq(qualificheVolontariCatalogoTable.id, qualificaId)) : [];
  if (!catalog || !isDateOnly(dataOttenimento)) { res.status(400).json({ error: "Qualifica o data ottenimento non validi" }); return; }
  const dataScadenza = req.body?.dataScadenza == null
    ? (catalog.validitaMesi ? addCalendarMonthsClamped(dataOttenimento, catalog.validitaMesi) : null)
    : req.body.dataScadenza;
  const stato = String(req.body?.stato ?? "VALIDA").toUpperCase();
  if ((dataScadenza != null && !isDateOnly(dataScadenza)) || !["VALIDA", "SCADUTA", "SOSPESA", "REVOCATA"].includes(stato)) {
    res.status(400).json({ error: "Scadenza o stato qualifica non validi" }); return;
  }
  const corsoOrigineId = req.body?.corsoOrigineId == null ? null : Number(req.body.corsoOrigineId);
  if (corsoOrigineId != null) {
    const [course] = await db.select({ id: corsiDeiVolontariTable.id }).from(corsiDeiVolontariTable)
      .where(and(eq(corsiDeiVolontariTable.id, corsoOrigineId), eq(corsiDeiVolontariTable.volontarioId, volunteer.id)));
    if (!course) { res.status(400).json({ error: "Il corso origine non appartiene al volontario" }); return; }
  }
  const [created] = await db.insert(qualificheDeiVolontariTable).values({
    volontarioId: volunteer.id, qualificaId, dataOttenimento, dataScadenza, stato,
    riferimentoDocumento: clean(req.body?.riferimentoDocumento, 255), corsoOrigineId,
    note: clean(req.body?.note, 4_000),
  }).returning();
  await db.transaction(async (tx) => auditLogistica(tx, req, { entita: "volontario", id: volunteer.id, azione: "qualifica_registrata", nuovo: { qualificaVolontarioId: created.id, qualificaId } }));
  res.status(201).json(created);
});

export default router;
