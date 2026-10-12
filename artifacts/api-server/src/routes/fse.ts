import { createHash } from "node:crypto";
import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
  movimentiTable,
  operazioniDistribuzioneMagazzinoTable,
  prodottiTable,
  rilevazioniMonitoraggioFseTable,
  riconciliazioniFseRigheTable,
  riconciliazioniFseRisoluzioniTable,
  riconciliazioniFseTable,
  fseImportSessionsTable,
  fseImportFilesTable,
  fseAdministrativeVersionsTable,
  fseAdministrativeObservationsTable,
  fseAdministrativeLineageTable,
  fseReconciliationRunsTable,
  scarichiTable,
} from "@workspace/db";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  ne,
  sql,
  type SQL,
} from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  buildFseCanonicalReport,
  createFseExport,
  deactivateExportCoverage,
  FSE_CHANNEL_MAP,
  FseReportingError,
  isFseFormat,
  listFseCanonicalPage,
  markFseExportEntered,
} from "../lib/fseCanonicalReporting";
import { FSE_XLSX_MIME } from "../lib/fseExportWorkbook";
import { downloadFseRepresentation } from "../lib/fseExportRepresentation";
import {
  minimizedExportHeader,
  minimizedExportEvent,
  minimizedExportLine,
} from "../lib/fseExportMinimization";
import {
  canAccessFseWarehouse,
  visibleFseWarehouseIds,
  requireCurrentFseWarehouse,
} from "../lib/fseAccess";
import { CurrentCommandActorError } from "../lib/currentCommandActor";
import { auditContextFromRequest, recordAuditEvent } from "../lib/auditEvent";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import {
  calculateFseReconciliation,
  recalculateFseReconciliation,
  refreshReconciliationCounts,
  requireOpenReconciliation,
  compareReconciliationTargets,
} from "../lib/fseReconciliation";
import {
  creaScaricoInventariale,
  InventoryError,
  stornaScaricoInventariale,
  type InventoryTransaction,
} from "../lib/scaricoInventory";
import {
  InventoryDecimal,
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../lib/inventoryDecimal";
import { requireOperationalMagazzino } from "../lib/inventoryLedger";
import { civilMonth, isCivilDate } from "../lib/civilDate";

const router: IRouter = Router();
router.use("/fse", requireModulo("LOTTI"));

function positiveId(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function version(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function pagination(req: Request) {
  const page = positiveId(req.query.page) ?? 1;
  const pageSize = positiveId(req.query.pageSize) ?? 50;
  if (pageSize > 200)
    throw new FseReportingError(400, "Paginazione non valida");
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function optionalCivilDate(value: unknown, field: string): string | null {
  if (value == null || value === "") return null;
  const parsed = String(value);
  if (!isCivilDate(parsed))
    throw new FseReportingError(400, `${field} non valida`);
  return parsed;
}

function period(req: Request) {
  const magazzinoId = positiveId(req.query.magazzinoId);
  const dataDa = String(
    req.query.dataCompetenzaDa ?? req.query.dataDa ?? req.query.da ?? "",
  );
  const dataA = String(
    req.query.dataCompetenzaA ?? req.query.dataA ?? req.query.a ?? "",
  );
  const dataAsOf = String(req.query.dataAsOf ?? dataA);
  if (
    !magazzinoId ||
    !isCivilDate(dataDa) ||
    !isCivilDate(dataA) ||
    !isCivilDate(dataAsOf) ||
    dataDa > dataA ||
    dataAsOf < dataA
  )
    throw new FseReportingError(400, "Magazzino o periodo FSE+ non validi");
  const maxMovimentoId =
    req.query.maxMovimentoId == null
      ? null
      : positiveId(req.query.maxMovimentoId);
  const maxOperazioneDistribuzioneId =
    req.query.maxOperazioneDistribuzioneId == null
      ? null
      : positiveId(req.query.maxOperazioneDistribuzioneId);
  if (
    (req.query.maxMovimentoId != null && maxMovimentoId == null) ||
    (req.query.maxOperazioneDistribuzioneId != null &&
      maxOperazioneDistribuzioneId == null)
  )
    throw new FseReportingError(400, "Cutoff non valido");
  if (
    req.query.includeArretrati != null &&
    !["true", "false"].includes(String(req.query.includeArretrati))
  )
    throw new FseReportingError(400, "includeArretrati non valido");
  return {
    magazzinoId,
    dataDa,
    dataA,
    dataAsOf,
    includeArretrati:
      req.query.includeArretrati == null
        ? true
        : String(req.query.includeArretrati) === "true",
    cutoff:
      maxMovimentoId != null && maxOperazioneDistribuzioneId != null
        ? { maxMovimentoId, maxOperazioneDistribuzioneId }
        : undefined,
  };
}

async function requireWarehouse(req: Request, magazzinoId: number) {
  if (!(await canAccessFseWarehouse(req.user!, magazzinoId)))
    throw new FseReportingError(
      403,
      "Magazzino non accessibile per il profilo",
    );
}

async function accessibleExport(req: Request, id: number) {
  const [row] = await db
    .select()
    .from(esportazioniFseTable)
    .where(eq(esportazioniFseTable.id, id));
  if (!row) throw new FseReportingError(404, "Esportazione non trovata");
  await requireWarehouse(req, row.magazzinoId);
  return row;
}

async function accessibleReconciliation(req: Request, id: number) {
  const [row] = await db
    .select()
    .from(riconciliazioniFseTable)
    .where(eq(riconciliazioniFseTable.id, id));
  if (!row) throw new FseReportingError(404, "Riconciliazione non trovata");
  await requireWarehouse(req, row.magazzinoId);
  return row;
}

function sendFseError(res: Response, error: unknown): boolean {
  if (
    !(error instanceof FseReportingError) &&
    !(error instanceof CurrentCommandActorError)
  )
    return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function returnCode(idempotencyKey: string): string {
  return `ROP-${createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 26)}`;
}

async function accessibleReturn(req: Request, id: number) {
  const [row] = await db
    .select()
    .from(scarichiTable)
    .where(
      and(eq(scarichiTable.id, id), eq(scarichiTable.causale, "reso_opc")),
    );
  if (!row) throw new FseReportingError(404, "Reso verso OpC non trovato");
  await requireWarehouse(req, row.magazzinoId);
  const movements = await db
    .select({ id: movimentiTable.id })
    .from(movimentiTable)
    .where(
      and(
        eq(movimentiTable.documentoRiferimento, row.codice),
        eq(movimentiTable.tipoMovimento, "scarico"),
      ),
    );
  const reversed =
    movements.length === 0
      ? []
      : await db
          .select({ id: movimentiTable.id })
          .from(movimentiTable)
          .where(
            inArray(
              movimentiTable.movimentoOrigineId,
              movements.map((movement) => movement.id),
            ),
          );
  return {
    ...row,
    destinazioneOpc: row.causaleAltro,
    motivazione: row.note,
    stato: reversed.length > 0 ? "STORNATO" : "REGISTRATO",
    versione: reversed.length > 0 ? 2 : 1,
  };
}

for (const [path, projection] of [
  ["/fse/rendicontazione/preview", "preview"],
  ["/fse/rendicontazione/eventi", "events"],
  ["/fse/rendicontazione/righe", "lines"],
  ["/fse/rendicontazione/qualita", "quality"],
] as const) {
  router.get(
    path,
    requirePermission("magazzino.fse.view"),
    async (req, res) => {
      try {
        const input = period(req);
        await requireWarehouse(req, input.magazzinoId);
        if (projection === "preview") {
          const report = await buildFseCanonicalReport(input);
          const generable = await buildFseCanonicalReport({
            ...input,
            cutoff: report.cutoff,
            excludeCovered: true,
          });
          const generableEvents = generable.events.filter(
            (event) => event.coverageEligible,
          );
          const historicalAdministrative = report.events.filter(
            (event) => event.coverageEligible,
          );
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
            eventiDaRendicontare: generableEvents.filter(
              (event) => !event.blocking,
            ).length,
            eventiArretrati: generableEvents.filter(
              (event) => event.arretrato && !event.blocking,
            ).length,
            eventiBloccati: generable.events.filter((event) => event.blocking)
              .length,
            eventiGiaCoperti: Math.max(
              0,
              historicalAdministrative.length - generableEvents.length,
            ),
            righeDaRendicontare: generable.lines.filter(
              (line) => line.coverageEligible,
            ).length,
            bloccanti: report.quality
              .filter((item) => item.blocking)
              .reduce((sum, item) => sum + item.count, 0),
          });
        } else {
          const { page, pageSize, offset } = pagination(req);
          void offset;
          const statoRendicontazione =
            req.query.statoRendicontazione == null
              ? undefined
              : String(req.query.statoRendicontazione);
          if (
            statoRendicontazione != null &&
            ![
              "DA_RENDICONTARE",
              "ARRETRATO_NON_RENDICONTATO",
              "BLOCCATO",
              "CORREZIONE_DA_GESTIRE_MANUALMENTE",
            ].includes(statoRendicontazione)
          )
            throw new FseReportingError(400, "statoRendicontazione non valido");
          const prodottoId =
            req.query.prodottoId == null
              ? undefined
              : positiveId(req.query.prodottoId);
          if (req.query.prodottoId != null && prodottoId == null)
            throw new FseReportingError(400, "prodottoId non valido");
          res.json(
            await listFseCanonicalPage({
              ...input,
              projection,
              page,
              pageSize,
              filters: {
                statoRendicontazione,
                canale:
                  req.query.canale == null
                    ? undefined
                    : String(req.query.canale),
                fondo:
                  req.query.fondo == null ? undefined : String(req.query.fondo),
                prodottoId: prodottoId ?? undefined,
                qualityCode:
                  req.query.qualityCode == null
                    ? undefined
                    : String(req.query.qualityCode),
              },
            }),
          );
        }
      } catch (error) {
        if (!sendFseError(res, error)) throw error;
      }
    },
  );
}

router.get(
  "/fse/exportazioni",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req);
      const visible = await visibleFseWarehouseIds(req.user!);
      const requestedWarehouse =
        req.query.magazzinoId == null
          ? null
          : positiveId(req.query.magazzinoId);
      const dataDa = optionalCivilDate(
        req.query.dataCompetenzaDa ?? req.query.dataDa,
        "dataCompetenzaDa",
      );
      const dataA = optionalCivilDate(
        req.query.dataCompetenzaA ?? req.query.dataA,
        "dataCompetenzaA",
      );
      const stato = req.query.stato == null ? null : String(req.query.stato);
      if (req.query.magazzinoId != null && !requestedWarehouse)
        throw new FseReportingError(400, "magazzinoId non valido");
      if (requestedWarehouse) await requireWarehouse(req, requestedWarehouse);
      const conditions: SQL[] = [];
      if (visible != null)
        conditions.push(
          visible.length === 0
            ? eq(esportazioniFseTable.id, -1)
            : inArray(esportazioniFseTable.magazzinoId, visible),
        );
      if (requestedWarehouse)
        conditions.push(
          eq(esportazioniFseTable.magazzinoId, requestedWarehouse),
        );
      if (dataDa) conditions.push(gte(esportazioniFseTable.dataA, dataDa));
      if (dataA) conditions.push(lte(esportazioniFseTable.dataDa, dataA));
      if (stato) conditions.push(eq(esportazioniFseTable.stato, stato));
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select()
        .from(esportazioniFseTable)
        .where(where)
        .orderBy(
          desc(esportazioniFseTable.dataCreazione),
          desc(esportazioniFseTable.id),
        )
        .limit(pageSize)
        .offset(offset);
      const total = Number(
        (
          await db
            .select({ value: count() })
            .from(esportazioniFseTable)
            .where(where)
        )[0]?.value ?? 0,
      );
      res.json({
        rows: rows.map(minimizedExportHeader),
        page,
        pageSize,
        total,
      });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/exportazioni",
  requirePermission("magazzino.fse.export"),
  async (req, res) => {
    try {
      const fakeRequest = { ...req, query: req.body ?? {} } as Request;
      const input = period(fakeRequest);
      if (!isFseFormat(req.body?.formatCode))
        throw new FseReportingError(400, "formatCode non valido");
      await requireWarehouse(req, input.magazzinoId);
      const result = await createFseExport({
        ...input,
        formatCode: req.body.formatCode,
        creatoDa: req.user!.id,
        audit: auditContextFromRequest(req),
      });
      res.status(result.replayed ? 200 : 201).json({
        ...minimizedExportHeader(result.export),
        replayed: result.replayed,
      });
    } catch (error) {
      if (sendFseError(res, error)) return;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({
          error: "La copertura è già presente in una esportazione attiva",
        });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/fse/exportazioni/:id",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      res.setHeader("Cache-Control", "no-store");
      res.json(minimizedExportHeader(await accessibleExport(req, id)));
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

for (const suffix of ["eventi", "righe"] as const) {
  router.get(
    `/fse/exportazioni/:id/${suffix}`,
    requirePermission("magazzino.fse.view"),
    async (req, res) => {
      try {
        const id = positiveId(req.params.id);
        if (!id) throw new FseReportingError(400, "ID non valido");
        await accessibleExport(req, id);
        const { page, pageSize, offset } = pagination(req);
        if (suffix === "eventi") {
          const [items, totalRows] = await Promise.all([
            db
              .select()
              .from(esportazioniFseEventiTable)
              .where(eq(esportazioniFseEventiTable.esportazioneId, id))
              .orderBy(esportazioniFseEventiTable.id)
              .limit(pageSize)
              .offset(offset),
            db
              .select({ value: count() })
              .from(esportazioniFseEventiTable)
              .where(eq(esportazioniFseEventiTable.esportazioneId, id)),
          ]);
          res.json({
            rows: items.map(minimizedExportEvent),
            page,
            pageSize,
            total: Number(totalRows[0]?.value ?? 0),
          });
        } else {
          const [items, totalRows] = await Promise.all([
            db
              .select({
                line: esportazioniFseRigheTable,
                eventKey: esportazioniFseEventiTable.eventKey,
              })
              .from(esportazioniFseRigheTable)
              .innerJoin(
                esportazioniFseEventiTable,
                eq(
                  esportazioniFseRigheTable.esportazioneEventoId,
                  esportazioniFseEventiTable.id,
                ),
              )
              .where(eq(esportazioniFseEventiTable.esportazioneId, id))
              .orderBy(esportazioniFseRigheTable.id)
              .limit(pageSize)
              .offset(offset),
            db
              .select({ value: count() })
              .from(esportazioniFseRigheTable)
              .innerJoin(
                esportazioniFseEventiTable,
                eq(
                  esportazioniFseRigheTable.esportazioneEventoId,
                  esportazioniFseEventiTable.id,
                ),
              )
              .where(eq(esportazioniFseEventiTable.esportazioneId, id)),
          ]);
          res.json({
            rows: items.map(({ line, eventKey }) => ({
              line: minimizedExportLine(line),
              eventKey,
            })),
            page,
            pageSize,
            total: Number(totalRows[0]?.value ?? 0),
          });
        }
      } catch (error) {
        if (!sendFseError(res, error)) throw error;
      }
    },
  );
}

router.get(
  "/fse/exportazioni/:id/download",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      await accessibleExport(req, id);
      const requestedFormat =
        req.query.representation == null
          ? undefined
          : String(req.query.representation);
      if (requestedFormat != null && !isFseFormat(requestedFormat))
        throw new FseReportingError(400, "representation non valida");
      const file = await downloadFseRepresentation({
        id,
        format: requestedFormat,
        audit: auditContextFromRequest(req),
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-FSE-Variant", file.variant);
      res.setHeader("X-FSE-Artifact-SHA256", file.artifactHash);
      res.setHeader("X-FSE-Semantic-SHA256", file.semanticHash);
      res.setHeader("Content-Type", FSE_XLSX_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.filename}"`,
      );
      res.send(file.buffer);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/exportazioni/:id/originale",
  requirePermission("magazzino.fse.export.original.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (
        !id ||
        typeof req.body?.motivo !== "string" ||
        !req.body.motivo.trim() ||
        req.body.motivo.length > 1000
      )
        throw new FseReportingError(400, "ID e motivo accesso obbligatori");
      if (
        req.body.representation != null &&
        !isFseFormat(req.body.representation)
      )
        throw new FseReportingError(400, "representation non valida");
      const file = await downloadFseRepresentation({
        id,
        format: req.body.representation,
        originalReason: req.body.motivo,
        audit: auditContextFromRequest(req),
      });
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-FSE-Variant", file.variant);
      res.setHeader("X-FSE-Artifact-SHA256", file.artifactHash);
      res.setHeader("Content-Type", FSE_XLSX_MIME);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${file.filename}"`,
      );
      res.send(file.buffer);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/exportazioni/:id/annulla",
  requirePermission("magazzino.fse.export"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      const motivation =
        typeof req.body?.motivazione === "string"
          ? req.body.motivazione.trim()
          : "";
      if (
        !id ||
        !currentVersion ||
        motivation.length < 3 ||
        motivation.length > 500
      )
        throw new FseReportingError(
          400,
          "ID, versione o motivazione non validi",
        );
      await accessibleExport(req, id);
      res.json(
        minimizedExportHeader(
          await deactivateExportCoverage(
            id,
            req.user!.id,
            motivation,
            currentVersion,
            auditContextFromRequest(req),
          ),
        ),
      );
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/exportazioni/:id/marca-inserita",
  requirePermission("magazzino.fse.export"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      const reference =
        typeof req.body?.riferimentoEsterno === "string"
          ? req.body.riferimentoEsterno.trim()
          : "";
      const insertedDate = String(req.body?.data ?? "");
      if (
        !id ||
        !currentVersion ||
        reference.length < 3 ||
        reference.length > 500 ||
        !isCivilDate(insertedDate)
      )
        throw new FseReportingError(
          400,
          "Versione, data o riferimento esterno non validi",
        );
      await accessibleExport(req, id);
      res.json(
        minimizedExportHeader(
          await markFseExportEntered({
            exportId: id,
            actorId: req.user!.id,
            version: currentVersion,
            insertedAt: new Date(`${insertedDate}T12:00:00.000Z`),
            externalReference: reference,
            audit: auditContextFromRequest(req),
          }),
        ),
      );
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/monitoraggio",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req);
      const visible = await visibleFseWarehouseIds(req.user!);
      const requestedWarehouse =
        req.query.magazzinoId == null
          ? null
          : positiveId(req.query.magazzinoId);
      const dataDa = optionalCivilDate(
        req.query.dataCompetenzaDa,
        "dataCompetenzaDa",
      );
      const dataA = optionalCivilDate(
        req.query.dataCompetenzaA,
        "dataCompetenzaA",
      );
      if (req.query.magazzinoId != null && !requestedWarehouse)
        throw new FseReportingError(400, "magazzinoId non valido");
      if (requestedWarehouse) await requireWarehouse(req, requestedWarehouse);
      const conditions: SQL[] = [];
      if (visible != null)
        conditions.push(
          visible.length === 0
            ? eq(rilevazioniMonitoraggioFseTable.id, -1)
            : inArray(rilevazioniMonitoraggioFseTable.magazzinoId, visible),
        );
      if (requestedWarehouse)
        conditions.push(
          eq(rilevazioniMonitoraggioFseTable.magazzinoId, requestedWarehouse),
        );
      if (dataDa)
        conditions.push(
          gte(rilevazioniMonitoraggioFseTable.dataRiferimento, dataDa),
        );
      if (dataA)
        conditions.push(
          lte(rilevazioniMonitoraggioFseTable.dataRiferimento, dataA),
        );
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select()
        .from(rilevazioniMonitoraggioFseTable)
        .where(where)
        .orderBy(
          desc(rilevazioniMonitoraggioFseTable.dataRiferimento),
          desc(rilevazioniMonitoraggioFseTable.id),
        )
        .limit(pageSize)
        .offset(offset);
      const total = Number(
        (
          await db
            .select({ value: count() })
            .from(rilevazioniMonitoraggioFseTable)
            .where(where)
        )[0]?.value ?? 0,
      );
      res.json({ rows, page, pageSize, total });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

const indicatorFields = [
  "minori18",
  "giovani18_29",
  "donne",
  "over65",
  "personeDisabilita",
  "cittadiniPaesiTerzi",
  "origineStranieraMinoranze",
  "senzatettoEsclusioneAbitativa",
  "totaleSaltuari",
] as const;

function monitoringValues(body: Record<string, unknown>) {
  const result: Record<string, number | null> = {};
  for (const field of indicatorFields) {
    const value = body[field];
    if (value == null || value === "") result[field] = null;
    else if (
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    )
      result[field] = value;
    else throw new FseReportingError(400, `${field} non valido`);
  }
  return result;
}

const MONITORING_SOURCES = [
  "RILEVAZIONE_MANUALE_VERIFICATA",
  "DERIVAZIONE_STRUTTURATA",
] as const;
const MONITORING_COMPLETENESS = ["PARZIALE", "COMPLETA"] as const;

async function validateMonitoringOperation(
  input: {
    id: number | null;
    magazzinoId: number;
    annoMese: string;
    canale: string;
  },
  executor: typeof db | InventoryTransaction = db,
) {
  if (input.id == null) return;
  const [operation] = await executor
    .select()
    .from(operazioniDistribuzioneMagazzinoTable)
    .where(eq(operazioniDistribuzioneMagazzinoTable.id, input.id));
  const officialChannel = operation
    ? FSE_CHANNEL_MAP[operation.canaleOperativo as keyof typeof FSE_CHANNEL_MAP]
    : null;
  if (
    !operation ||
    operation.magazzinoId !== input.magazzinoId ||
    civilMonth(operation.dataDistribuzione) !== input.annoMese ||
    officialChannel !== input.canale
  )
    throw new FseReportingError(
      400,
      "Operazione non coerente con magazzino, mese o canale",
    );
}

router.post(
  "/fse/monitoraggio",
  requirePermission("magazzino.fse.monitoring.manage"),
  async (req, res) => {
    try {
      const magazzinoId = positiveId(req.body?.magazzinoId);
      const annoMese = String(req.body?.annoMese ?? "");
      const canale = String(req.body?.canaleUfficiale ?? "");
      const dataRiferimento = String(req.body?.dataRiferimento ?? "");
      const fonte = String(req.body?.fonte ?? "");
      const completezza = String(req.body?.completezza ?? "");
      const operazioneDistribuzioneId =
        req.body?.operazioneDistribuzioneId == null
          ? null
          : positiveId(req.body.operazioneDistribuzioneId);
      if (
        !magazzinoId ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(annoMese) ||
        !["PACCHI", "MENSA", "STRADA"].includes(canale) ||
        !isCivilDate(dataRiferimento) ||
        civilMonth(dataRiferimento) !== annoMese ||
        !MONITORING_SOURCES.includes(
          fonte as (typeof MONITORING_SOURCES)[number],
        ) ||
        !MONITORING_COMPLETENESS.includes(
          completezza as (typeof MONITORING_COMPLETENESS)[number],
        ) ||
        (req.body?.operazioneDistribuzioneId != null &&
          operazioneDistribuzioneId == null)
      )
        throw new FseReportingError(400, "Rilevazione mensile non valida");
      await requireWarehouse(req, magazzinoId);
      const created = await db.transaction(async (tx) => {
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.monitoring.manage",
          magazzinoId,
        );
        await validateMonitoringOperation(
          {
            id: operazioneDistribuzioneId,
            magazzinoId,
            annoMese,
            canale,
          },
          tx,
        );
        const [created] = await tx
          .insert(rilevazioniMonitoraggioFseTable)
          .values({
            magazzinoId,
            annoMese,
            canaleUfficiale: canale,
            operazioneDistribuzioneId,
            dataRiferimento,
            fonte,
            completezza,
            ...monitoringValues(req.body),
            creatoDa: req.user!.id,
            aggiornatoDa: req.user!.id,
            noteAudit:
              typeof req.body?.noteAudit === "string"
                ? req.body.noteAudit.trim() || null
                : null,
          })
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req),
          azione: "FSE_MONITORAGGIO_CREATO",
          entitaTipo: "rilevazione_monitoraggio_fse",
          entitaId: created.id,
          magazzinoIdSnapshot: magazzinoId,
        });
        return created;
      });
      res.status(201).json(created);
    } catch (error) {
      if (sendFseError(res, error)) return;
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        res.status(409).json({ error: "Rilevazione mensile già presente" });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/fse/monitoraggio/:id",
  requirePermission("magazzino.fse.monitoring.manage"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      if (!id || !currentVersion)
        throw new FseReportingError(400, "ID o versione non validi");
      const updated = await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(rilevazioniMonitoraggioFseTable)
          .where(eq(rilevazioniMonitoraggioFseTable.id, id))
          .for("update");
        if (!current)
          throw new FseReportingError(404, "Rilevazione non trovata");
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.monitoring.manage",
          current.magazzinoId,
        );
        const [updated] = await tx
          .update(rilevazioniMonitoraggioFseTable)
          .set({
            ...monitoringValues({
              ...Object.fromEntries(
                indicatorFields.map((field) => [field, current[field]]),
              ),
              ...req.body,
            }),
            versione: currentVersion + 1,
            aggiornatoDa: req.user!.id,
            dataAggiornamento: new Date(),
            noteAudit:
              typeof req.body?.noteAudit === "string"
                ? req.body.noteAudit.trim() || null
                : current.noteAudit,
          })
          .where(
            and(
              eq(rilevazioniMonitoraggioFseTable.id, id),
              eq(rilevazioniMonitoraggioFseTable.versione, currentVersion),
            ),
          )
          .returning();
        if (!updated)
          throw new FseReportingError(409, "Versione rilevazione non corrente");
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req),
          azione: "FSE_MONITORAGGIO_AGGIORNATO",
          entitaTipo: "rilevazione_monitoraggio_fse",
          entitaId: id,
          magazzinoIdSnapshot: current.magazzinoId,
        });
        return updated;
      });
      res.json(updated);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/resi-opc",
  requirePermission("magazzino.fse.return"),
  async (req, res) => {
    try {
      const magazzinoId = positiveId(req.body?.magazzinoId);
      const currentVersion = version(req.body?.versione);
      const dataReso = String(req.body?.dataReso ?? "");
      const destinazioneOpc =
        typeof req.body?.destinazioneOpc === "string"
          ? req.body.destinazioneOpc.trim()
          : "";
      const motivazione =
        typeof req.body?.motivazione === "string"
          ? req.body.motivazione.trim()
          : "";
      const idempotencyKey =
        typeof req.body?.idempotencyKey === "string"
          ? req.body.idempotencyKey.trim()
          : "";
      const modalita = String(req.body?.modalitaSelezione ?? "");
      const righe: Record<string, unknown>[] = Array.isArray(req.body?.righe)
        ? (req.body.righe as Record<string, unknown>[])
        : [];
      if (
        !magazzinoId ||
        currentVersion !== 1 ||
        !isCivilDate(dataReso) ||
        destinazioneOpc.length < 3 ||
        destinazioneOpc.length > 500 ||
        motivazione.length < 3 ||
        motivazione.length > 2000 ||
        idempotencyKey.length < 8 ||
        idempotencyKey.length > 100 ||
        !["FEFO", "PARTITA_ESATTA"].includes(modalita) ||
        righe.length === 0
      ) {
        throw new FseReportingError(400, "Reso verso OpC non valido");
      }
      await requireWarehouse(req, magazzinoId);
      const normalizedRows = righe.map((row: Record<string, unknown>) => ({
        prodottoId: positiveId(row.prodottoId),
        lottoId: row.lottoId == null ? null : positiveId(row.lottoId),
        quantita:
          typeof row.quantita === "string" || typeof row.quantita === "number"
            ? row.quantita
            : "",
      }));
      if (
        normalizedRows.some(
          (row) =>
            !row.prodottoId || (modalita === "PARTITA_ESATTA" && !row.lottoId),
        )
      ) {
        throw new FseReportingError(
          400,
          "Prodotto o Lotto del reso non valido",
        );
      }
      for (const row of normalizedRows) positiveInventoryDecimal(row.quantita);
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            magazzinoId,
            dataReso,
            destinazioneOpc,
            motivazione,
            modalita,
            righe: normalizedRows.map((row) => ({
              ...row,
              quantita: String(row.quantita),
            })),
          }),
        )
        .digest("hex");

      const productIds = [
        ...new Set(normalizedRows.map((row) => row.prodottoId!)),
      ];
      const products = await db
        .select({
          id: prodottiTable.id,
          unitaMisura: prodottiTable.unitaMisura,
        })
        .from(prodottiTable)
        .where(inArray(prodottiTable.id, productIds));
      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );
      if (products.length !== productIds.length)
        throw new FseReportingError(400, "Prodotto del reso non trovato");

      const codice = returnCode(idempotencyKey);
      const command = auditContextFromRequest(req, {
        operationKey: `fse-return:${codice}`,
      });
      const result = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fse-return:${codice}`}, 0))`,
        );
        const [existing] = await tx
          .select()
          .from(scarichiTable)
          .where(eq(scarichiTable.codice, codice))
          .for("update");
        const actor = await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.return",
          magazzinoId,
        );
        if (existing) {
          if (
            existing.magazzinoId !== magazzinoId ||
            existing.causale !== "reso_opc" ||
            existing.fseRequestHash !== requestHash
          )
            throw new FseReportingError(
              409,
              "Idempotency key gia usata con dati diversi",
            );
          return { id: existing.id, replayed: true };
        }
        await requireOperationalMagazzino(tx, magazzinoId);
        const createdId = await creaScaricoInventariale(tx, {
          codice,
          magazzinoId,
          centroAscoltoId: actor.centroAscoltoId,
          dataScarico: dataReso,
          causale: "reso_opc",
          causaleAltro: destinazioneOpc,
          note: motivazione,
          operatoreId: req.user!.id,
          audit: command,
          documentoRiferimento: codice,
          lottoPolicy: "qualsiasi",
          allowedFondiOrigine: ["FSE_PLUS"],
          source: {
            naturaContabile: "RESO",
            dominioOrigine: "FSE",
            entitaOrigineTipo: "reso_opc",
            entitaOrigineId: 0,
          },
          righe: normalizedRows.map((row) => ({
            prodottoId: row.prodottoId!,
            lottoId: modalita === "PARTITA_ESATTA" ? row.lottoId : null,
            quantita: row.quantita,
            unitaMisura: productMap.get(row.prodottoId!)!.unitaMisura,
          })),
        });
        await tx
          .update(scarichiTable)
          .set({
            fseIdempotencyKey: idempotencyKey,
            fseRequestHash: requestHash,
          })
          .where(eq(scarichiTable.id, createdId));
        return { id: createdId, replayed: false };
      });
      res.status(result.replayed ? 200 : 201).json({
        ...(await accessibleReturn(req, result.id)),
        idempotentReplay: result.replayed,
      });
    } catch (error) {
      if (error instanceof InventoryDecimalError) {
        res.status(400).json({ error: error.message });
        return;
      }
      if (error instanceof InventoryError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/resi-opc/:id/storno",
  requirePermission("magazzino.fse.return"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      const data = String(req.body?.data ?? "");
      const motivazione =
        typeof req.body?.motivazione === "string"
          ? req.body.motivazione.trim()
          : "";
      if (
        !id ||
        !currentVersion ||
        !isCivilDate(data) ||
        motivazione.length < 3 ||
        motivazione.length > 2000
      ) {
        throw new FseReportingError(400, "Storno del reso non valido");
      }
      const current = await accessibleReturn(req, id);
      if (data < current.dataScarico) {
        throw new FseReportingError(400, "La data di storno precede il reso");
      }
      if (current.versione !== currentVersion)
        throw new FseReportingError(409, "Versione reso non corrente");
      await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(scarichiTable)
          .where(eq(scarichiTable.id, id))
          .for("update");
        if (!locked || locked.causale !== "reso_opc")
          throw new FseReportingError(404, "Reso non trovato");
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.return",
          locked.magazzinoId,
        );
        if (currentVersion !== 1)
          throw new FseReportingError(409, "Versione reso non corrente");
        await stornaScaricoInventariale(tx, {
          documentoRiferimento: current.codice,
          dataMovimento: data,
          operatoreId: req.user!.id,
          audit: auditContextFromRequest(req, {
            operationKey: `fse-return-storno:${id}`,
          }),
          tipoDettaglio: "storno_reso_opc",
          note: `Storno reso verso OpC: ${motivazione}`,
          rejectAlreadyReversed: true,
        });
      });
      res.json(await accessibleReturn(req, id));
    } catch (error) {
      if (error instanceof InventoryError) {
        res.status(409).json({ error: error.message });
        return;
      }
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/riconciliazioni",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const { page, pageSize, offset } = pagination(req);
      const visible = await visibleFseWarehouseIds(req.user!);
      const requestedWarehouse =
        req.query.magazzinoId == null
          ? null
          : positiveId(req.query.magazzinoId);
      const dataDa = optionalCivilDate(
        req.query.dataCompetenzaDa,
        "dataCompetenzaDa",
      );
      const dataA = optionalCivilDate(
        req.query.dataCompetenzaA,
        "dataCompetenzaA",
      );
      const stato = req.query.stato == null ? null : String(req.query.stato);
      if (req.query.magazzinoId != null && !requestedWarehouse)
        throw new FseReportingError(400, "magazzinoId non valido");
      if (requestedWarehouse) await requireWarehouse(req, requestedWarehouse);
      const conditions: SQL[] = [];
      if (visible != null)
        conditions.push(
          visible.length === 0
            ? eq(riconciliazioniFseTable.id, -1)
            : inArray(riconciliazioniFseTable.magazzinoId, visible),
        );
      if (requestedWarehouse)
        conditions.push(
          eq(riconciliazioniFseTable.magazzinoId, requestedWarehouse),
        );
      if (dataDa)
        conditions.push(gte(riconciliazioniFseTable.dataRiferimento, dataDa));
      if (dataA)
        conditions.push(lte(riconciliazioniFseTable.dataRiferimento, dataA));
      if (stato) conditions.push(eq(riconciliazioniFseTable.stato, stato));
      const where = conditions.length ? and(...conditions) : undefined;
      const rows = await db
        .select()
        .from(riconciliazioniFseTable)
        .where(where)
        .orderBy(
          desc(riconciliazioniFseTable.dataCreazione),
          desc(riconciliazioniFseTable.id),
        )
        .limit(pageSize)
        .offset(offset);
      const total = Number(
        (
          await db
            .select({ value: count() })
            .from(riconciliazioniFseTable)
            .where(where)
        )[0]?.value ?? 0,
      );
      res.json({ rows, page, pageSize, total });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/riconciliazioni",
  requirePermission("magazzino.fse.reconcile"),
  async (req, res) => {
    try {
      const magazzinoId = positiveId(req.body?.magazzinoId);
      const importazioneAgeaId = positiveId(req.body?.importazioneAgeaId);
      const sourceType = req.body?.sourceType ?? "AGEA_LEGACY";
      const sessionId = positiveId(req.body?.sessionId);
      const sessionVersion = version(req.body?.sessionVersion);
      const baselineRunId = positiveId(req.body?.baselineRunId);
      const commandKey =
        typeof req.body?.commandKey === "string"
          ? req.body.commandKey.trim()
          : undefined;
      const previousId =
        req.body?.importazioneAgeaPrecedenteId == null
          ? null
          : positiveId(req.body.importazioneAgeaPrecedenteId);
      const dataRiferimento = String(req.body?.dataRiferimento ?? "");
      const maxMovimentoId =
        req.body?.maxMovimentoId == null
          ? null
          : positiveId(req.body.maxMovimentoId);
      const maxOperazioneDistribuzioneId =
        req.body?.maxOperazioneDistribuzioneId == null
          ? null
          : positiveId(req.body.maxOperazioneDistribuzioneId);
      if (
        !magazzinoId ||
        !["AGEA_LEGACY", "FSE_M3B"].includes(sourceType) ||
        (sourceType === "AGEA_LEGACY"
          ? !importazioneAgeaId || req.body?.sessionId != null
          : !sessionId ||
            !sessionVersion ||
            !commandKey ||
            req.body?.importazioneAgeaId != null ||
            req.body?.importazioneAgeaPrecedenteId != null) ||
        (req.body?.baselineRunId != null && !baselineRunId) ||
        !isCivilDate(dataRiferimento) ||
        (req.body?.importazioneAgeaPrecedenteId != null && !previousId) ||
        (req.body?.maxMovimentoId != null && !maxMovimentoId) ||
        (req.body?.maxOperazioneDistribuzioneId != null &&
          !maxOperazioneDistribuzioneId)
      )
        throw new FseReportingError(400, "Input riconciliazione non valido");
      await requireWarehouse(req, magazzinoId);
      const result = await calculateFseReconciliation({
        audit: auditContextFromRequest(req),
        magazzinoId,
        sourceType,
        sessionId: sessionId ?? undefined,
        sessionVersion: sessionVersion ?? undefined,
        baselineRunId,
        commandKey,
        importazioneAgeaId: importazioneAgeaId ?? undefined,
        importazioneAgeaPrecedenteId: previousId,
        dataRiferimento,
        creatoDa: req.user!.id,
        cutoff:
          maxMovimentoId != null && maxOperazioneDistribuzioneId != null
            ? { maxMovimentoId, maxOperazioneDistribuzioneId }
            : undefined,
      });
      res.status(result.replayed ? 200 : 201).json({
        ...result.reconciliation,
        replayed: result.replayed,
      });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

// Source discovery is scoped to one authorized warehouse; import privileges are
// not a prerequisite for reading the administrative source used in reconciliation.
router.get(
  "/fse/fonti-m3b",
  requirePermission("magazzino.fse.reconcile"),
  async (req, res) => {
    try {
      const magazzinoId = positiveId(req.query.magazzinoId);
      if (!magazzinoId)
        throw new FseReportingError(400, "Magazzino obbligatorio");
      await requireWarehouse(req, magazzinoId);
      const { page, pageSize, offset } = pagination(req);
      const where = and(
        eq(fseImportSessionsTable.magazzinoId, magazzinoId),
        ne(fseImportSessionsTable.stato, "ANNULLATA"),
      );
      const rows = await db
        .select({
          id: fseImportSessionsTable.id,
          sourceRegistryId: fseImportSessionsTable.sourceRegistryId,
          versione: fseImportSessionsTable.versione,
          modalita: fseImportSessionsTable.modalita,
          stato: fseImportSessionsTable.stato,
        })
        .from(fseImportSessionsTable)
        .where(where)
        .orderBy(desc(fseImportSessionsTable.id))
        .limit(pageSize)
        .offset(offset);
      const files = rows.length
        ? await db
            .select({
              sessionId: fseImportFilesTable.sessioneId,
              id: fseImportFilesTable.id,
              role: fseImportFilesTable.profilo,
              sha256: fseImportFilesTable.sha256File,
              referenceDate: fseImportFilesTable.dataRiferimento,
            })
            .from(fseImportFilesTable)
            .where(
              inArray(
                fseImportFilesTable.sessioneId,
                rows.map((r) => r.id),
              ),
            )
            .orderBy(fseImportFilesTable.id)
        : [];
      const summaries = rows.length
        ? (
            await db.execute(sql`SELECT r.sessione_id, count(*)::int AS observations,
      count(*) FILTER (WHERE r.stato='ESCLUSA')::int AS excluded,
      count(*) FILTER (WHERE jsonb_array_length(r.error_codes_json)>0)::int AS anomalous,
      count(*) FILTER (WHERE r.stato='REGISTRATA')::int AS registered
      FROM fse_import_rows r WHERE r.sessione_id IN (${sql.join(
        rows.map((r) => sql`${r.id}`),
        sql`,`,
      )}) GROUP BY r.sessione_id`)
          ).rows
        : [];
      const [{ total }] = await db
        .select({ total: count() })
        .from(fseImportSessionsTable)
        .where(where);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        rows: rows.map((r) => ({
          ...r,
          summary: summaries.find((s) => Number(s.sessione_id) === r.id) ?? {
            observations: 0,
            registered: 0,
            excluded: 0,
            anomalous: 0,
          },
          files: files.filter((f) => f.sessionId === r.id),
        })),
        page,
        pageSize,
        total: Number(total),
      });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/riconciliazioni/:id/fonte",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      const header = await accessibleReconciliation(req, id);
      const [source] =
        header.administrativeVersionId == null
          ? []
          : await db
              .select({
                id: fseAdministrativeVersionsTable.id,
                sourceRegistryId:
                  fseAdministrativeVersionsTable.sourceRegistryId,
                sessionId: fseAdministrativeVersionsTable.sessionId,
                sessionVersion: fseAdministrativeVersionsTable.sessionVersion,
                referenceDate: fseAdministrativeVersionsTable.referenceDate,
                mode: fseAdministrativeVersionsTable.mode,
                manifestHash: fseAdministrativeVersionsTable.manifestHash,
              })
              .from(fseAdministrativeVersionsTable)
              .where(
                eq(
                  fseAdministrativeVersionsTable.id,
                  header.administrativeVersionId,
                ),
              );
      const runs = await db
        .select({
          id: fseReconciliationRunsTable.id,
          headerVersion: fseReconciliationRunsTable.headerVersion,
          administrativeVersionId:
            fseReconciliationRunsTable.administrativeVersionId,
          baselineRunId: fseReconciliationRunsTable.baselineRunId,
          maxMovementId: fseReconciliationRunsTable.maxMovementId,
          maxOperationId: fseReconciliationRunsTable.maxOperationId,
          referenceDate: fseReconciliationRunsTable.referenceDate,
          canonicalHash: fseReconciliationRunsTable.canonicalHash,
        })
        .from(fseReconciliationRunsTable)
        .where(eq(fseReconciliationRunsTable.reconciliationId, id))
        .orderBy(fseReconciliationRunsTable.id);
      res.setHeader("Cache-Control", "no-store");
      res.json({ sourceType: header.sourceType, source: source ?? null, runs });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/riconciliazioni/:id/osservazioni",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      const header = await accessibleReconciliation(req, id);
      const { page, pageSize, offset } = pagination(req);
      if (header.administrativeVersionId == null) {
        res.json({ rows: [], total: 0, page, pageSize });
        return;
      }
      const where = eq(
        fseAdministrativeObservationsTable.versionId,
        header.administrativeVersionId,
      );
      const rows = await db
        .select()
        .from(fseAdministrativeObservationsTable)
        .where(where)
        .orderBy(fseAdministrativeObservationsTable.id)
        .limit(pageSize)
        .offset(offset);
      const lineage = rows.length
        ? await db
            .select()
            .from(fseAdministrativeLineageTable)
            .where(
              inArray(
                fseAdministrativeLineageTable.observationId,
                rows.map((r) => r.id),
              ),
            )
        : [];
      const [{ total }] = await db
        .select({ total: count() })
        .from(fseAdministrativeObservationsTable)
        .where(where);
      res.setHeader("Cache-Control", "no-store");
      res.json({
        rows: rows.map((r) => ({
          ...r,
          lineage: lineage.filter((l) => l.observationId === r.id),
        })),
        total: Number(total),
        page,
        pageSize,
      });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/riconciliazioni/:id",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      if (!id) throw new FseReportingError(400, "ID non valido");
      res.json(await accessibleReconciliation(req, id));
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse/riconciliazioni/:id/righe",
  requirePermission("magazzino.fse.view"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const page = positiveId(req.query.page) ?? 1;
      const pageSize = positiveId(req.query.pageSize) ?? 50;
      if (!id || pageSize > 200)
        throw new FseReportingError(400, "ID o paginazione non validi");
      await accessibleReconciliation(req, id);
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(riconciliazioniFseRigheTable)
          .where(
            and(
              eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
              eq(riconciliazioniFseRigheTable.active, true),
            ),
          )
          .orderBy(riconciliazioniFseRigheTable.id)
          .limit(pageSize)
          .offset((page - 1) * pageSize),
        db
          .select({ value: count() })
          .from(riconciliazioniFseRigheTable)
          .where(
            and(
              eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
              eq(riconciliazioniFseRigheTable.active, true),
            ),
          ),
      ]);
      res.json({
        rows: items,
        page,
        pageSize,
        total: Number(totalRows[0]?.value ?? 0),
      });
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/riconciliazioni/:id/ricalcola",
  requirePermission("magazzino.fse.reconcile"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      if (!id || !currentVersion)
        throw new FseReportingError(400, "ID o versione non validi");
      await accessibleReconciliation(req, id);
      res.json(
        (
          await recalculateFseReconciliation({
            audit: auditContextFromRequest(req),
            id,
            versione: currentVersion,
            actorId: req.user!.id,
            sessionVersion: version(req.body?.sessionVersion) ?? undefined,
          })
        ).reconciliation,
      );
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.patch(
  "/fse/riconciliazioni/:id/righe/:rigaId",
  requirePermission("magazzino.fse.reconcile.manage"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const rowId = positiveId(req.params.rigaId);
      const currentVersion = version(req.body?.versione);
      const action = String(req.body?.azione ?? "");
      const motivation =
        typeof req.body?.motivazione === "string"
          ? req.body.motivazione.trim()
          : "";
      if (
        !id ||
        !rowId ||
        !currentVersion ||
        ![
          "ABBINA",
          "DISABBINA",
          "ACCETTA_SCOSTAMENTO",
          "SEGNALA_DA_CORREGGERE",
          "RIAPRI",
        ].includes(action) ||
        motivation.length < 3 ||
        motivation.length > 500
      )
        throw new FseReportingError(400, "Risoluzione manuale non valida");
      await accessibleReconciliation(req, id);
      const result = await db.transaction(async (tx) => {
        const header = await requireOpenReconciliation(tx, id, currentVersion);
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.reconcile.manage",
          header.magazzinoId,
        );
        const [current] = await tx
          .select()
          .from(riconciliazioniFseRigheTable)
          .where(
            and(
              eq(riconciliazioniFseRigheTable.id, rowId),
              eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
              eq(riconciliazioniFseRigheTable.active, true),
            ),
          )
          .for("update");
        if (!current)
          throw new FseReportingError(404, "Riga riconciliazione non trovata");
        const targetMovementId = positiveId(req.body?.movimentoId);
        const targetAgeaRowId = positiveId(req.body?.importazioneAgeaRigaId);
        const targetObservationId = positiveId(req.body?.observationId);
        let structuredMatch: Record<string, unknown> | null = null;
        if (action === "ABBINA") {
          if (
            !targetMovementId ||
            (header.sourceType === "FSE_M3B"
              ? !targetObservationId || targetAgeaRowId != null
              : !targetAgeaRowId || targetObservationId != null)
          )
            throw new FseReportingError(
              400,
              "ABBINA richiede movimentoId e un riferimento esterno coerente con la fonte",
            );
          const [localTarget] = await tx
            .select()
            .from(riconciliazioniFseRigheTable)
            .where(
              and(
                eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
                eq(riconciliazioniFseRigheTable.movimentoId, targetMovementId),
                eq(riconciliazioniFseRigheTable.active, true),
              ),
            );
          const [externalTarget] = await tx
            .select()
            .from(riconciliazioniFseRigheTable)
            .where(
              and(
                eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
                header.sourceType === "FSE_M3B"
                  ? eq(
                      riconciliazioniFseRigheTable.observationId,
                      targetObservationId!,
                    )
                  : eq(
                      riconciliazioniFseRigheTable.importazioneAgeaRigaId,
                      targetAgeaRowId!,
                    ),
                eq(riconciliazioniFseRigheTable.active, true),
              ),
            );
          if (
            !localTarget ||
            !externalTarget ||
            ![localTarget.id, externalTarget.id].includes(current.id) ||
            localTarget.importazioneAgeaRigaId != null ||
            localTarget.observationId != null ||
            externalTarget.movimentoId != null
          )
            throw new FseReportingError(
              409,
              "Target ABBINA non appartenenti alla riconciliazione",
            );
          const delta = (left: string | null, right: string | null) =>
            left == null || right == null
              ? null
              : InventoryDecimal.parse(left, { allowNegative: true })
                  .subtract(
                    InventoryDecimal.parse(right, { allowNegative: true }),
                  )
                  .toDb();
          const differencePieces = delta(
            localTarget.piecesLocal,
            externalTarget.piecesExternal,
          );
          const differenceKgLt = delta(
            localTarget.kgLtLocal,
            externalTarget.kgLtExternal,
          );
          const comparisonStatus = await compareReconciliationTargets(
            tx,
            header,
            targetMovementId,
            (targetObservationId ?? targetAgeaRowId)!,
          );
          const exact = comparisonStatus === "RICONCILIATA_ESATTA";
          structuredMatch = {
            localEventKey: localTarget.localEventKey,
            localLineKey: localTarget.localLineKey,
            movimentoId: targetMovementId,
            operazioneDistribuzioneId: localTarget.operazioneDistribuzioneId,
            externalMovementId: externalTarget.externalMovementId,
            importazioneAgeaRigaId: targetAgeaRowId,
            observationId: targetObservationId,
            fundLocal: localTarget.fundLocal,
            fundExternal: externalTarget.fundExternal,
            productIdLocal: localTarget.productIdLocal,
            productIdExternal: externalTarget.productIdExternal,
            lotLocal: localTarget.lotLocal,
            lotExternal: externalTarget.lotExternal,
            dateLocal: localTarget.dateLocal,
            dateExternal: externalTarget.dateExternal,
            piecesLocal: localTarget.piecesLocal,
            piecesExternal: externalTarget.piecesExternal,
            kgLtLocal: localTarget.kgLtLocal,
            kgLtExternal: externalTarget.kgLtExternal,
            differencePieces,
            differenceKgLt,
            channelLocal: localTarget.channelLocal,
            channelExternal: externalTarget.channelExternal,
            matchMethod: "ABBINAMENTO_MANUALE_STRUTTURATO",
            status: exact ? "RICONCILIATA_ESATTA" : "ABBINATA_CON_SCOSTAMENTO",
            blocking: !exact,
            exact,
            workflowStatus: "ABBINATO_MANUALMENTE",
            qualityCodesJson: exact
              ? []
              : ["ABBINATA_CON_SCOSTAMENTO", comparisonStatus],
            active: true,
          };
          const resolutionGroupId = createHash("sha256")
            .update(
              `${id}:${header.versione}:${targetMovementId}:${header.sourceType}:${targetObservationId ?? targetAgeaRowId}`,
            )
            .digest("hex");
          await tx
            .update(riconciliazioniFseRigheTable)
            .set({ active: false, resolutionGroupId })
            .where(
              inArray(riconciliazioniFseRigheTable.id, [
                localTarget.id,
                externalTarget.id,
              ]),
            );
          structuredMatch.resolutionGroupId = resolutionGroupId;
        }
        if (action === "DISABBINA") {
          if (
            !current.movimentoId ||
            !(current.importazioneAgeaRigaId || current.observationId)
          )
            throw new FseReportingError(
              409,
              "DISABBINA richiede una riga realmente abbinata",
            );
          const resolutionGroupId = createHash("sha256")
            .update(`${id}:${header.versione}:DISABBINA:${current.id}`)
            .digest("hex");
          await tx
            .update(riconciliazioniFseRigheTable)
            .set({ active: false, resolutionGroupId })
            .where(eq(riconciliazioniFseRigheTable.id, current.id));
          const externalState = {
            ...current,
            id: undefined,
            businessKey: `${current.observationId == null ? "AGEA" : "M3B"}:${current.observationId ?? current.importazioneAgeaRigaId}:DISABBINATO:${header.versione}`,
            localEventKey: null,
            localLineKey: null,
            movimentoId: null,
            operazioneDistribuzioneId: null,
            fundLocal: null,
            productIdLocal: null,
            lotLocal: null,
            dateLocal: null,
            piecesLocal: null,
            kgLtLocal: null,
            channelLocal: null,
            differencePieces: current.piecesExternal,
            differenceKgLt: current.kgLtExternal,
            matchMethod: "DISABBINATO_MANUALMENTE",
            status: "SOLO_AGEA",
            blocking: true,
            exact: false,
            workflowStatus: "DISABBINATO",
            qualityCodesJson: ["SOLO_AGEA_DOPO_DISABBINAMENTO"],
            active: true,
            resolutionGroupId,
            companionRowId: current.id,
          };
          externalState.contentHash = createHash("sha256")
            .update(JSON.stringify(externalState))
            .digest("hex");
          externalState.calculatedStateJson = { ...externalState };
          const [externalCompanion] = await tx
            .insert(riconciliazioniFseRigheTable)
            .values(externalState)
            .returning({ id: riconciliazioniFseRigheTable.id });
          structuredMatch = {
            externalMovementId: null,
            importazioneAgeaRigaId: null,
            observationId: null,
            fundExternal: null,
            productIdExternal: null,
            lotExternal: null,
            dateExternal: null,
            piecesExternal: null,
            kgLtExternal: null,
            channelExternal: null,
            differencePieces: current.piecesLocal,
            differenceKgLt: current.kgLtLocal,
            matchMethod: "DISABBINATO_MANUALMENTE",
            status: "SOLO_LOCALE_DA_RENDICONTARE",
            blocking: true,
            exact: false,
            workflowStatus: "DISABBINATO",
            qualityCodesJson: ["SOLO_LOCALE_DOPO_DISABBINAMENTO"],
            active: true,
            resolutionGroupId,
            companionRowId: externalCompanion.id,
          };
        }
        if (action === "RIAPRI" && current.resolutionGroupId) {
          await tx
            .update(riconciliazioniFseRigheTable)
            .set({ active: false })
            .where(
              and(
                eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
                eq(
                  riconciliazioniFseRigheTable.resolutionGroupId,
                  current.resolutionGroupId,
                ),
                ne(riconciliazioniFseRigheTable.id, current.id),
              ),
            );
        }
        const next =
          structuredMatch ??
          (action === "ACCETTA_SCOSTAMENTO"
            ? {
                status: "SCOSTAMENTO_ACCETTATO",
                blocking: false,
                exact: false,
                workflowStatus: "ACCETTATO_MANUALMENTE",
                qualityCodesJson: ["SCOSTAMENTO_ACCETTATO_MANUALMENTE"],
              }
            : action === "RIAPRI"
              ? {
                  ...current.calculatedStateJson,
                  status: String(
                    current.calculatedStateJson.status ?? current.status,
                  ),
                  blocking: Boolean(
                    current.calculatedStateJson.blocking ?? true,
                  ),
                  exact:
                    current.calculatedStateJson.exact == null
                      ? ["RICONCILIATA_ESATTA", "SALDO_RICONCILIATO"].includes(
                          String(current.calculatedStateJson.status),
                        )
                      : current.calculatedStateJson.exact === true,
                  workflowStatus: "CALCOLATO",
                  active: true,
                  companionRowId: null,
                  qualityCodesJson: Array.isArray(
                    current.calculatedStateJson.qualityCodesJson,
                  )
                    ? (current.calculatedStateJson.qualityCodesJson as string[])
                    : current.qualityCodesJson,
                }
              : {
                  status: "DA_CORREGGERE_MANUALMENTE",
                  blocking: true,
                  exact: false,
                  workflowStatus: "DA_CORREGGERE",
                  qualityCodesJson: ["DA_CORREGGERE_MANUALMENTE"],
                });
        const nextWithHash = {
          ...next,
          contentHash: createHash("sha256")
            .update(JSON.stringify({ ...current, ...next, id: undefined }))
            .digest("hex"),
        };
        await tx.insert(riconciliazioniFseRisoluzioniTable).values({
          riconciliazioneRigaId: rowId,
          azione: action,
          motivazione: motivation,
          oldStateJson: current,
          newStateJson: nextWithHash,
          riconciliazioneId: id,
          targetMovimentoId: current.movimentoId,
          targetImportazioneRigaId: current.importazioneAgeaRigaId,
          targetObservationId: current.observationId,
          headerVersionBefore: header.versione,
          headerVersionAfter: header.versione + 1,
          creatoDa: req.user!.id,
        });
        const [updatedRow] = await tx
          .update(riconciliazioniFseRigheTable)
          .set(nextWithHash)
          .where(eq(riconciliazioniFseRigheTable.id, rowId))
          .returning();
        await refreshReconciliationCounts(tx, id);
        await tx
          .update(riconciliazioniFseTable)
          .set({ versione: header.versione + 1, stato: "DA_RIVEDERE" })
          .where(eq(riconciliazioniFseTable.id, id));
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req),
          azione: "FSE_RICONCILIAZIONE_RISOLTA",
          entitaTipo: "riconciliazione_fse",
          entitaId: id,
          magazzinoIdSnapshot: header.magazzinoId,
          motivo: motivation,
        });
        return updatedRow;
      });
      res.json(result);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/riconciliazioni/:id/chiudi",
  requirePermission("magazzino.fse.reconcile.manage"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      const withDifferences = req.body?.conScostamenti === true;
      const motivation =
        typeof req.body?.motivazione === "string"
          ? req.body.motivazione.trim()
          : "";
      if (
        !id ||
        !currentVersion ||
        (withDifferences && (motivation.length < 3 || motivation.length > 500))
      )
        throw new FseReportingError(400, "Chiusura non valida");
      await accessibleReconciliation(req, id);
      const updated = await db.transaction(async (tx) => {
        const header = await requireOpenReconciliation(tx, id, currentVersion);
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.reconcile.manage",
          header.magazzinoId,
        );
        if (
          !withDifferences &&
          (header.bloccanti > 0 || header.scostamenti > 0)
        )
          throw new FseReportingError(
            409,
            "Sono presenti scostamenti o righe bloccanti",
          );
        const [row] = await tx
          .update(riconciliazioniFseTable)
          .set({
            stato: withDifferences ? "CHIUSA_CON_SCOSTAMENTI" : "RICONCILIATA",
            motivazioneChiusura: withDifferences ? motivation : null,
            chiusoDa: req.user!.id,
            dataChiusura: new Date(),
            versione: currentVersion + 1,
          })
          .where(eq(riconciliazioniFseTable.id, id))
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req),
          azione: "FSE_RICONCILIAZIONE_CHIUSA",
          entitaTipo: "riconciliazione_fse",
          entitaId: id,
          magazzinoIdSnapshot: header.magazzinoId,
          motivo: motivation,
        });
        return row;
      });
      res.json(updated);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse/riconciliazioni/:id/annulla",
  requirePermission("magazzino.fse.reconcile.manage"),
  async (req, res) => {
    try {
      const id = positiveId(req.params.id);
      const currentVersion = version(req.body?.versione);
      if (!id || !currentVersion)
        throw new FseReportingError(400, "ID o versione non validi");
      await accessibleReconciliation(req, id);
      const updated = await db.transaction(async (tx) => {
        const [header] = await tx
          .select()
          .from(riconciliazioniFseTable)
          .where(eq(riconciliazioniFseTable.id, id))
          .for("update");
        if (!header)
          throw new FseReportingError(404, "Riconciliazione non trovata");
        await requireCurrentFseWarehouse(
          tx,
          req.user!.id,
          "magazzino.fse.reconcile.manage",
          header.magazzinoId,
        );
        const [updated] = await tx
          .update(riconciliazioniFseTable)
          .set({
            stato: "ANNULLATA",
            annullatoDa: req.user!.id,
            dataAnnullamento: new Date(),
            versione: currentVersion + 1,
          })
          .where(
            and(
              eq(riconciliazioniFseTable.id, id),
              eq(riconciliazioniFseTable.versione, currentVersion),
            ),
          )
          .returning();
        if (!updated)
          throw new FseReportingError(
            409,
            "Versione riconciliazione non corrente",
          );
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req),
          azione: "FSE_RICONCILIAZIONE_ANNULLATA",
          entitaTipo: "riconciliazione_fse",
          entitaId: id,
          magazzinoIdSnapshot: header.magazzinoId,
        });
        return updated;
      });
      res.json(updated);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

export default router;
