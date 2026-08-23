import { createHash } from "node:crypto";
import {
  db,
  esportazioniFseEventiTable,
  esportazioniFseRigheTable,
  esportazioniFseTable,
  movimentiTable,
  prodottiTable,
  rilevazioniMonitoraggioFseTable,
  riconciliazioniFseRigheTable,
  riconciliazioniFseRisoluzioniTable,
  riconciliazioniFseTable,
  scarichiTable,
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
import {
  calculateFseReconciliation,
  recalculateFseReconciliation,
  refreshReconciliationCounts,
  requireOpenReconciliation,
} from "../lib/fseReconciliation";
import {
  creaScaricoInventariale,
  InventoryError,
  stornaScaricoInventariale,
} from "../lib/scaricoInventory";
import {
  InventoryDecimalError,
  positiveInventoryDecimal,
} from "../lib/inventoryDecimal";
import { requireOperationalMagazzino } from "../lib/inventoryLedger";

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

function pagination(req: Request) {
  const page = positiveId(req.query.page) ?? 1;
  const pageSize = positiveId(req.query.pageSize) ?? 50;
  if (pageSize > 200)
    throw new FseReportingError(400, "Paginazione non valida");
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function period(req: Request) {
  const magazzinoId = positiveId(req.query.magazzinoId);
  const dataDa = String(req.query.dataDa ?? req.query.da ?? "");
  const dataA = String(req.query.dataA ?? req.query.a ?? "");
  const dataAsOf = String(req.query.dataAsOf ?? dataA);
  if (
    !magazzinoId ||
    !DATE.test(dataDa) ||
    !DATE.test(dataA) ||
    !DATE.test(dataAsOf) ||
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
  return {
    magazzinoId,
    dataDa,
    dataA,
    dataAsOf,
    cutoff:
      maxMovimentoId != null && maxOperazioneDistribuzioneId != null
        ? { maxMovimentoId, maxOperazioneDistribuzioneId }
        : undefined,
  };
}

async function requireWarehouse(req: Request, magazzinoId: number) {
  if (
    !(await canAccessMagazzino(
      magazzinoId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  )
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
  if (!(error instanceof FseReportingError)) return false;
  res.status(error.status).json({ error: error.message });
  return true;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as {
    code?: unknown;
    cause?: { code?: unknown };
  } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
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
            bloccanti: report.quality
              .filter((item) => item.blocking)
              .reduce((sum, item) => sum + item.count, 0),
          });
        } else {
          const { pageSize, offset } = pagination(req);
          res.json(report[projection].slice(offset, offset + pageSize));
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
      const { pageSize, offset } = pagination(req);
      const visible = await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      );
      const rows =
        visible == null
          ? await db
              .select()
              .from(esportazioniFseTable)
              .orderBy(desc(esportazioniFseTable.dataCreazione))
              .limit(pageSize)
              .offset(offset)
          : visible.length === 0
            ? []
            : await db
                .select()
                .from(esportazioniFseTable)
                .where(inArray(esportazioniFseTable.magazzinoId, visible))
                .orderBy(desc(esportazioniFseTable.dataCreazione))
                .limit(pageSize)
                .offset(offset);
      res.json(rows);
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
      });
      res
        .status(result.replayed ? 200 : 201)
        .json({ ...result.export, replayed: result.replayed });
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
      res.json(await accessibleExport(req, id));
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
        const { pageSize, offset } = pagination(req);
        if (suffix === "eventi") {
          res.json(
            await db
              .select()
              .from(esportazioniFseEventiTable)
              .where(eq(esportazioniFseEventiTable.esportazioneId, id))
              .orderBy(esportazioniFseEventiTable.id)
              .limit(pageSize)
              .offset(offset),
          );
        } else {
          res.json(
            await db
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
          );
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
      const file = await generateFseExportWorkbook(id);
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
        await deactivateExportCoverage(
          id,
          req.user!.id,
          motivation,
          currentVersion,
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
      const insertedAt = new Date(String(req.body?.data ?? ""));
      if (
        !id ||
        !currentVersion ||
        reference.length < 3 ||
        reference.length > 500 ||
        Number.isNaN(insertedAt.valueOf())
      )
        throw new FseReportingError(
          400,
          "Versione, data o riferimento esterno non validi",
        );
      await accessibleExport(req, id);
      const [updated] = await db
        .update(esportazioniFseTable)
        .set({
          stato: "INSERITA_MANUALMENTE",
          marcatoInseritoDa: req.user!.id,
          dataInserimentoEsterno: insertedAt,
          riferimentoEsterno: reference,
          versione: currentVersion + 1,
        })
        .where(
          and(
            eq(esportazioniFseTable.id, id),
            eq(esportazioniFseTable.versione, currentVersion),
          ),
        )
        .returning();
      if (!updated)
        throw new FseReportingError(409, "Versione esportazione non corrente");
      res.json(updated);
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
      const { pageSize, offset } = pagination(req);
      const visible = await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      );
      const rows =
        visible == null
          ? await db
              .select()
              .from(rilevazioniMonitoraggioFseTable)
              .orderBy(desc(rilevazioniMonitoraggioFseTable.dataRiferimento))
              .limit(pageSize)
              .offset(offset)
          : visible.length === 0
            ? []
            : await db
                .select()
                .from(rilevazioniMonitoraggioFseTable)
                .where(
                  inArray(rilevazioniMonitoraggioFseTable.magazzinoId, visible),
                )
                .orderBy(desc(rilevazioniMonitoraggioFseTable.dataRiferimento))
                .limit(pageSize)
                .offset(offset);
      res.json(rows);
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

router.post(
  "/fse/monitoraggio",
  requirePermission("magazzino.fse.monitoring.manage"),
  async (req, res) => {
    try {
      const magazzinoId = positiveId(req.body?.magazzinoId);
      const annoMese = String(req.body?.annoMese ?? "");
      const canale = String(req.body?.canaleUfficiale ?? "");
      const dataRiferimento = String(req.body?.dataRiferimento ?? "");
      if (
        !magazzinoId ||
        !/^\d{4}-(0[1-9]|1[0-2])$/.test(annoMese) ||
        !["PACCHI", "MENSA", "STRADA"].includes(canale) ||
        !DATE.test(dataRiferimento)
      )
        throw new FseReportingError(400, "Rilevazione mensile non valida");
      await requireWarehouse(req, magazzinoId);
      const [created] = await db
        .insert(rilevazioniMonitoraggioFseTable)
        .values({
          magazzinoId,
          annoMese,
          canaleUfficiale: canale,
          operazioneDistribuzioneId: positiveId(
            req.body?.operazioneDistribuzioneId,
          ),
          dataRiferimento,
          fonte: String(req.body?.fonte ?? "RILEVAZIONE_MANUALE_VERIFICATA"),
          completezza: String(req.body?.completezza ?? "PARZIALE"),
          ...monitoringValues(req.body),
          creatoDa: req.user!.id,
          aggiornatoDa: req.user!.id,
          noteAudit:
            typeof req.body?.noteAudit === "string"
              ? req.body.noteAudit.trim() || null
              : null,
        })
        .returning();
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
      const [current] = await db
        .select()
        .from(rilevazioniMonitoraggioFseTable)
        .where(eq(rilevazioniMonitoraggioFseTable.id, id));
      if (!current) throw new FseReportingError(404, "Rilevazione non trovata");
      await requireWarehouse(req, current.magazzinoId);
      const [updated] = await db
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
        !DATE.test(dataReso) ||
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
      const [existing] = await db
        .select()
        .from(scarichiTable)
        .where(eq(scarichiTable.codice, codice));
      if (existing) {
        const replay = await accessibleReturn(req, existing.id);
        if (
          existing.magazzinoId !== magazzinoId ||
          existing.dataScarico !== dataReso ||
          existing.causaleAltro !== destinazioneOpc ||
          existing.note !== motivazione
        ) {
          throw new FseReportingError(
            409,
            "Idempotency key gia usata con dati diversi",
          );
        }
        res.status(200).json({ ...replay, idempotentReplay: true });
        return;
      }

      let newId: number;
      try {
        newId = await db.transaction(async (tx) => {
          await requireOperationalMagazzino(tx, magazzinoId);
          return creaScaricoInventariale(tx, {
            codice,
            magazzinoId,
            centroAscoltoId: callerCentroId(req),
            dataScarico: dataReso,
            causale: "reso_opc",
            causaleAltro: destinazioneOpc,
            note: motivazione,
            operatoreId: req.user!.id,
            documentoRiferimento: codice,
            lottoPolicy: "qualsiasi",
            allowedFondiOrigine: ["FSE_PLUS", "FONDO_NAZIONALE_COFINANZIATO"],
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
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [concurrent] = await db
          .select({ id: scarichiTable.id })
          .from(scarichiTable)
          .where(eq(scarichiTable.codice, codice));
        if (!concurrent) throw error;
        res.status(200).json({
          ...(await accessibleReturn(req, concurrent.id)),
          idempotentReplay: true,
        });
        return;
      }
      res.status(201).json({
        ...(await accessibleReturn(req, newId)),
        idempotentReplay: false,
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
        !DATE.test(data) ||
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
      await db.transaction((tx) =>
        stornaScaricoInventariale(tx, {
          documentoRiferimento: current.codice,
          dataMovimento: data,
          operatoreId: req.user!.id,
          tipoDettaglio: "storno_reso_opc",
          note: `Storno reso verso OpC: ${motivazione}`,
          rejectAlreadyReversed: true,
        }),
      );
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
      const { pageSize, offset } = pagination(req);
      const visible = await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      );
      const rows =
        visible == null
          ? await db
              .select()
              .from(riconciliazioniFseTable)
              .orderBy(desc(riconciliazioniFseTable.dataCreazione))
              .limit(pageSize)
              .offset(offset)
          : visible.length === 0
            ? []
            : await db
                .select()
                .from(riconciliazioniFseTable)
                .where(inArray(riconciliazioniFseTable.magazzinoId, visible))
                .orderBy(desc(riconciliazioniFseTable.dataCreazione))
                .limit(pageSize)
                .offset(offset);
      res.json(rows);
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
        !importazioneAgeaId ||
        !DATE.test(dataRiferimento) ||
        (req.body?.importazioneAgeaPrecedenteId != null && !previousId) ||
        (req.body?.maxMovimentoId != null && !maxMovimentoId) ||
        (req.body?.maxOperazioneDistribuzioneId != null &&
          !maxOperazioneDistribuzioneId)
      )
        throw new FseReportingError(400, "Input riconciliazione non valido");
      await requireWarehouse(req, magazzinoId);
      const result = await calculateFseReconciliation({
        magazzinoId,
        importazioneAgeaId,
        importazioneAgeaPrecedenteId: previousId,
        dataRiferimento,
        creatoDa: req.user!.id,
        cutoff:
          maxMovimentoId != null && maxOperazioneDistribuzioneId != null
            ? { maxMovimentoId, maxOperazioneDistribuzioneId }
            : undefined,
      });
      res.status(201).json(result.reconciliation);
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
      const rows = await db
        .select()
        .from(riconciliazioniFseRigheTable)
        .where(eq(riconciliazioniFseRigheTable.riconciliazioneId, id))
        .orderBy(riconciliazioniFseRigheTable.id)
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      res.json({ page, pageSize, rows });
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
            id,
            versione: currentVersion,
            actorId: req.user!.id,
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
        const [current] = await tx
          .select()
          .from(riconciliazioniFseRigheTable)
          .where(
            and(
              eq(riconciliazioniFseRigheTable.id, rowId),
              eq(riconciliazioniFseRigheTable.riconciliazioneId, id),
            ),
          )
          .for("update");
        if (!current)
          throw new FseReportingError(404, "Riga riconciliazione non trovata");
        const accepted =
          action === "ABBINA" || action === "ACCETTA_SCOSTAMENTO";
        const next = {
          status: accepted
            ? "RICONCILIATA_ESATTA"
            : action === "DISABBINA"
              ? "IDENTITA_AMBIGUA"
              : "SOLO_LOCALE_DA_RENDICONTARE",
          blocking: !accepted,
          qualityCodesJson: accepted
            ? [`${action}_MANUALE`]
            : [
                action === "DISABBINA"
                  ? "RICONCILIAZIONE_AMBIGUA"
                  : "DA_CORREGGERE_MANUALMENTE",
              ],
        };
        await tx.insert(riconciliazioniFseRisoluzioniTable).values({
          riconciliazioneRigaId: rowId,
          azione: action,
          motivazione: motivation,
          oldStateJson: current,
          newStateJson: next,
          creatoDa: req.user!.id,
        });
        const [updatedRow] = await tx
          .update(riconciliazioniFseRigheTable)
          .set(next)
          .where(eq(riconciliazioniFseRigheTable.id, rowId))
          .returning();
        await refreshReconciliationCounts(tx, id);
        await tx
          .update(riconciliazioniFseTable)
          .set({ versione: header.versione + 1, stato: "DA_RIVEDERE" })
          .where(eq(riconciliazioniFseTable.id, id));
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
      const [updated] = await db
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
      res.json(updated);
    } catch (error) {
      if (!sendFseError(res, error)) throw error;
    }
  },
);

export default router;
