import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
  rilevazioniMonitoraggioFseTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  buildFseCanonicalReport,
  createFseExport,
  deactivateExportCoverage,
  FseReportingError,
  isFseFormat,
} from "../lib/fseCanonicalReporting";
import {
  FSE_XLSX_MIME,
  generateFseExportWorkbook,
} from "../lib/fseExportWorkbook";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessMagazzino,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/fse", requireModulo("LOTTI"));

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function version(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function period(req: Request) {
  const magazzinoId = positiveId(req.query.magazzinoId);
  const dataDa = String(req.query.dataDa ?? req.query.da ?? "");
  const dataA = String(req.query.dataA ?? req.query.a ?? "");
  const dataAsOf = String(req.query.dataAsOf ?? dataA);
  if (!magazzinoId || !DATE.test(dataDa) || !DATE.test(dataA) || !DATE.test(dataAsOf) || dataDa > dataA || dataAsOf < dataA)
    throw new FseReportingError(400, "Magazzino o periodo FSE+ non validi");
  const maxMovimentoId = req.query.maxMovimentoId == null ? null : positiveId(req.query.maxMovimentoId);
  const maxOperazioneDistribuzioneId = req.query.maxOperazioneDistribuzioneId == null
    ? null
    : positiveId(req.query.maxOperazioneDistribuzioneId);
  if ((req.query.maxMovimentoId != null && maxMovimentoId == null) ||
      (req.query.maxOperazioneDistribuzioneId != null && maxOperazioneDistribuzioneId == null))
    throw new FseReportingError(400, "Cutoff non valido");
  return {
    magazzinoId,
    dataDa,
    dataA,
    dataAsOf,
    cutoff: maxMovimentoId != null && maxOperazioneDistribuzioneId != null
      ? { maxMovimentoId, maxOperazioneDistribuzioneId }
      : undefined,
  };
}

async function requireWarehouse(req: Request, magazzinoId: number) {
  if (!(await canAccessMagazzino(magazzinoId, callerCentroId(req), callerAreaOperativaId(req))))
    throw new FseReportingError(403, "Magazzino non accessibile per il profilo");
}

async function accessibleExport(req: Request, id: number) {
  const [row] = await db.select().from(esportazioniFseTable).where(eq(esportazioniFseTable.id, id));
  if (!row) throw new FseReportingError(404, "Esportazione non trovata");
  await requireWarehouse(req, row.magazzinoId);
  return row;
}

function sendFseError(res: Response, error: unknown): boolean {
  if (!(error instanceof FseReportingError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

for (const [path, projection] of [
  ["/fse/rendicontazione/preview", "preview"],
  ["/fse/rendicontazione/eventi", "events"],
  ["/fse/rendicontazione/righe", "lines"],
  ["/fse/rendicontazione/qualita", "quality"],
] as const) {
  router.get(path, requirePermission("magazzino.fse.view"), async (req, res) => {
    try {
      const input = period(req);
      await requireWarehouse(req, input.magazzinoId);
      const report = await buildFseCanonicalReport(input);
      if (projection === "preview") {
        res.json({
          modelVersion: report.modelVersion,
          timezone: report.timezone,
          magazzinoId: report.magazzinoId,
          dataDa: report.dataDa,
          dataA: report.dataA,
          dataAsOf: report.dataAsOf,
          cutoff: report.cutoff,
          canonicalHash: report.canonicalHash,
          eventiTotali: report.events.length,
          righeTotali: report.lines.length,
          bloccanti: report.quality.filter((item) => item.blocking).reduce((sum, item) => sum + item.count, 0),
        });
      } else res.json(report[projection]);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  });
}

router.get("/fse/exportazioni", requirePermission("magazzino.fse.view"), async (req, res) => {
  const visible = await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req));
  const rows = visible == null
    ? await db.select().from(esportazioniFseTable).orderBy(desc(esportazioniFseTable.dataCreazione))
    : visible.length === 0
      ? []
      : await db.select().from(esportazioniFseTable).where(inArray(esportazioniFseTable.magazzinoId, visible)).orderBy(desc(esportazioniFseTable.dataCreazione));
  res.json(rows);
});

router.post("/fse/exportazioni", requirePermission("magazzino.fse.export"), async (req, res) => {
  try {
    const fakeRequest = { ...req, query: req.body ?? {} } as Request;
    const input = period(fakeRequest);
    if (!isFseFormat(req.body?.formatCode)) throw new FseReportingError(400, "formatCode non valido");
    await requireWarehouse(req, input.magazzinoId);
    const result = await createFseExport({
      ...input,
      formatCode: req.body.formatCode,
      creatoDa: req.user!.id,
    });
    res.status(result.replayed ? 200 : 201).json({ ...result.export, replayed: result.replayed });
  } catch (error) {
    if (sendFseError(res, error)) return;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "La copertura è già presente in una esportazione attiva" });
      return;
    }
    throw error;
  }
});

router.get("/fse/exportazioni/:id", requirePermission("magazzino.fse.view"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) throw new FseReportingError(400, "ID non valido");
    res.json(await accessibleExport(req, id));
  } catch (error) {
    if (!sendFseError(res, error)) throw error;
  }
});

for (const suffix of ["eventi", "righe"] as const) {
  router.get(`/fse/exportazioni/:id/${suffix}`, requirePermission("magazzino.fse.view"), async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      await accessibleExport(req, id);
      if (suffix === "eventi") {
        res.json(await db.select().from(esportazioniFseEventiTable).where(eq(esportazioniFseEventiTable.esportazioneId, id)).orderBy(esportazioniFseEventiTable.id));
      } else {
        res.json(await db.select({ line: esportazioniFseRigheTable, eventKey: esportazioniFseEventiTable.eventKey })
          .from(esportazioniFseRigheTable)
          .innerJoin(esportazioniFseEventiTable, eq(esportazioniFseRigheTable.esportazioneEventoId, esportazioniFseEventiTable.id))
          .where(eq(esportazioniFseEventiTable.esportazioneId, id))
          .orderBy(esportazioniFseRigheTable.id));
      }
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  });
}

router.get("/fse/exportazioni/:id/download", requirePermission("magazzino.fse.view"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    if (!id) throw new FseReportingError(400, "ID non valido");
    await accessibleExport(req, id);
    const file = await generateFseExportWorkbook(id);
    res.setHeader("Content-Type", FSE_XLSX_MIME);
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.send(file.buffer);
  } catch (error) {
    if (!sendFseError(res, error)) throw error;
  }
});

router.post("/fse/exportazioni/:id/annulla", requirePermission("magazzino.fse.export"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const currentVersion = version(req.body?.versione);
    const motivation = typeof req.body?.motivazione === "string" ? req.body.motivazione.trim() : "";
    if (!id || !currentVersion || motivation.length < 3 || motivation.length > 500)
      throw new FseReportingError(400, "ID, versione o motivazione non validi");
    await accessibleExport(req, id);
    res.json(await deactivateExportCoverage(id, req.user!.id, motivation, currentVersion));
  } catch (error) {
    if (!sendFseError(res, error)) throw error;
  }
});

router.post("/fse/exportazioni/:id/marca-inserita", requirePermission("magazzino.fse.export"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const currentVersion = version(req.body?.versione);
    const reference = typeof req.body?.riferimentoEsterno === "string" ? req.body.riferimentoEsterno.trim() : "";
    const insertedAt = new Date(String(req.body?.data ?? ""));
    if (!id || !currentVersion || reference.length < 3 || reference.length > 500 || Number.isNaN(insertedAt.valueOf()))
      throw new FseReportingError(400, "Versione, data o riferimento esterno non validi");
    await accessibleExport(req, id);
    const [updated] = await db.update(esportazioniFseTable).set({
      stato: "INSERITA_MANUALMENTE",
      marcatoInseritoDa: req.user!.id,
      dataInserimentoEsterno: insertedAt,
      riferimentoEsterno: reference,
      versione: currentVersion + 1,
    }).where(and(eq(esportazioniFseTable.id, id), eq(esportazioniFseTable.versione, currentVersion))).returning();
    if (!updated) throw new FseReportingError(409, "Versione esportazione non corrente");
    res.json(updated);
  } catch (error) {
    if (!sendFseError(res, error)) throw error;
  }
});

router.get("/fse/monitoraggio", requirePermission("magazzino.fse.view"), async (req, res) => {
  const visible = await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req));
  const rows = visible == null
    ? await db.select().from(rilevazioniMonitoraggioFseTable).orderBy(desc(rilevazioniMonitoraggioFseTable.dataRiferimento))
    : visible.length === 0 ? [] : await db.select().from(rilevazioniMonitoraggioFseTable).where(inArray(rilevazioniMonitoraggioFseTable.magazzinoId, visible)).orderBy(desc(rilevazioniMonitoraggioFseTable.dataRiferimento));
  res.json(rows);
});

const indicatorFields = [
  "minori18", "giovani18_29", "donne", "over65", "personeDisabilita",
  "cittadiniPaesiTerzi", "origineStranieraMinoranze",
  "senzatettoEsclusioneAbitativa", "totaleSaltuari",
] as const;

function monitoringValues(body: Record<string, unknown>) {
  const result: Record<string, number | null> = {};
  for (const field of indicatorFields) {
    const value = body[field];
    if (value == null || value === "") result[field] = null;
    else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) result[field] = value;
    else throw new FseReportingError(400, `${field} non valido`);
  }
  return result;
}

router.post("/fse/monitoraggio", requirePermission("magazzino.fse.monitoring.manage"), async (req, res) => {
  try {
    const magazzinoId = positiveId(req.body?.magazzinoId);
    const annoMese = String(req.body?.annoMese ?? "");
    const canale = String(req.body?.canaleUfficiale ?? "");
    const dataRiferimento = String(req.body?.dataRiferimento ?? "");
    if (!magazzinoId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(annoMese) || !["PACCHI", "MENSA", "STRADA"].includes(canale) || !DATE.test(dataRiferimento))
      throw new FseReportingError(400, "Rilevazione mensile non valida");
    await requireWarehouse(req, magazzinoId);
    const [created] = await db.insert(rilevazioniMonitoraggioFseTable).values({
      magazzinoId, annoMese, canaleUfficiale: canale,
      operazioneDistribuzioneId: positiveId(req.body?.operazioneDistribuzioneId),
      dataRiferimento, fonte: String(req.body?.fonte ?? "RILEVAZIONE_MANUALE_VERIFICATA"),
      completezza: String(req.body?.completezza ?? "PARZIALE"),
      ...monitoringValues(req.body), creatoDa: req.user!.id, aggiornatoDa: req.user!.id,
      noteAudit: typeof req.body?.noteAudit === "string" ? req.body.noteAudit.trim() || null : null,
    }).returning();
    res.status(201).json(created);
  } catch (error) {
    if (sendFseError(res, error)) return;
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      res.status(409).json({ error: "Rilevazione mensile già presente" }); return;
    }
    throw error;
  }
});

router.patch("/fse/monitoraggio/:id", requirePermission("magazzino.fse.monitoring.manage"), async (req, res) => {
  try {
    const id = positiveId(req.params.id);
    const currentVersion = version(req.body?.versione);
    if (!id || !currentVersion) throw new FseReportingError(400, "ID o versione non validi");
    const [current] = await db.select().from(rilevazioniMonitoraggioFseTable).where(eq(rilevazioniMonitoraggioFseTable.id, id));
    if (!current) throw new FseReportingError(404, "Rilevazione non trovata");
    await requireWarehouse(req, current.magazzinoId);
    const [updated] = await db.update(rilevazioniMonitoraggioFseTable).set({
      ...monitoringValues({ ...Object.fromEntries(indicatorFields.map((field) => [field, current[field]])), ...req.body }),
      versione: currentVersion + 1,
      aggiornatoDa: req.user!.id,
      dataAggiornamento: new Date(),
      noteAudit: typeof req.body?.noteAudit === "string" ? req.body.noteAudit.trim() || null : current.noteAudit,
    }).where(and(eq(rilevazioniMonitoraggioFseTable.id, id), eq(rilevazioniMonitoraggioFseTable.versione, currentVersion))).returning();
    if (!updated) throw new FseReportingError(409, "Versione rilevazione non corrente");
    res.json(updated);
  } catch (error) {
    if (!sendFseError(res, error)) throw error;
  }
});

export default router;
