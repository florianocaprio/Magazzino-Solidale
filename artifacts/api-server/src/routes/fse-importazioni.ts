import express, { Router, type IRouter, type Response } from "express";
import {
  db,
  fseImportFilesTable,
  fseImportRowsTable,
  fseImportSessionsTable,
  fseImportStockRowsTable,
  fseSourceRegistriesTable,
  prodottiTable,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessMagazzino,
} from "../lib/centroScope";
import { AGEA_MAX_BYTES, AgeaParserError } from "../lib/ageaSifeadParser";
import {
  FsePracticeImportError,
  acquireFseFile,
  addFseRowsToPractice,
  mapFseProduct,
  reviseFseImportRow,
  totalStockPieces,
} from "../lib/fsePracticeImportService";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/fse-importazioni", requireModulo("LOTTI"));

const binaryBody = express.raw({ type: () => true, limit: AGEA_MAX_BYTES });

function positiveId(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new FsePracticeImportError(
      400,
      "ID_NON_VALIDO",
      `${field} non valido`,
    );
  return parsed;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim())
    throw new FsePracticeImportError(
      400,
      "CAMPO_OBBLIGATORIO",
      `${field} è obbligatorio`,
    );
  const result = value.trim();
  if (result.length > max)
    throw new FsePracticeImportError(
      400,
      "CAMPO_TROPPO_LUNGO",
      `${field} supera ${max} caratteri`,
    );
  return result;
}

function sendKnownError(res: Response, error: unknown) {
  if (error instanceof FsePracticeImportError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return true;
  }
  if (error instanceof AgeaParserError) {
    res.status(400).json({ error: error.message, code: error.code });
    return true;
  }
  let current: unknown = error;
  let pg: { code?: string; constraint?: string } | undefined;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (candidate.code) {
      pg = candidate;
      break;
    }
    current = candidate.cause;
  }
  if (pg?.code === "23505") {
    res.status(409).json({
      error: "La riga esterna è già stata presa in carico",
      code:
        pg.constraint === "fse_source_registries_codice_unique"
          ? "SORGENTE_DUPLICATA"
          : pg.constraint === "fse_movement_claims_identity_active_unique"
            ? "IDENTITA_GIA_PRESA_IN_CARICO"
            : (pg.constraint ?? "DUPLICATO"),
    });
    return true;
  }
  return false;
}

async function assertWarehouseAccess(
  req: Parameters<typeof callerCentroId>[0],
  warehouseId: number,
) {
  if (
    !(await canAccessMagazzino(
      warehouseId,
      callerCentroId(req),
      callerAreaOperativaId(req),
    ))
  )
    throw new FsePracticeImportError(
      403,
      "MAGAZZINO_NON_ACCESSIBILE",
      "Magazzino non accessibile per il tuo profilo",
    );
}

async function accessibleSession(
  req: Parameters<typeof callerCentroId>[0],
  id: number,
) {
  const [session] = await db
    .select()
    .from(fseImportSessionsTable)
    .where(eq(fseImportSessionsTable.id, id));
  if (!session)
    throw new FsePracticeImportError(
      404,
      "SESSIONE_NON_TROVATA",
      "Procedura non trovata",
    );
  await assertWarehouseAccess(req, session.magazzinoId);
  return session;
}

function assertInitialBalancePermission(
  req: Parameters<typeof callerCentroId>[0],
  session: typeof fseImportSessionsTable.$inferSelect,
) {
  if (
    session.modalita === "SALDO_INIZIALE" &&
    !req.user!.isAdmin &&
    !req.user!.isSuperAdmin &&
    !req.user!.permessi.includes("magazzino.agea.bootstrap")
  )
    throw new FsePracticeImportError(
      403,
      "PERMESSO_SALDO_RICHIESTO",
      "Permesso amministrativo richiesto",
    );
}

router.get(
  "/fse-importazioni/sorgenti",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const area = callerAreaOperativaId(req);
    const rows = await db
      .select()
      .from(fseSourceRegistriesTable)
      .where(
        area == null
          ? eq(fseSourceRegistriesTable.attiva, 1)
          : and(
              eq(fseSourceRegistriesTable.attiva, 1),
              eq(fseSourceRegistriesTable.areaOperativaId, area),
            ),
      )
      .orderBy(fseSourceRegistriesTable.descrizione);
    res.json(rows);
  },
);

router.post(
  "/fse-importazioni/sorgenti",
  requirePermission("magazzino.agea.mapping.manage"),
  async (req, res) => {
    try {
      if (!req.user!.isAdmin && !req.user!.isSuperAdmin)
        throw new FsePracticeImportError(
          403,
          "CONFIGURAZIONE_SORGENTE_RISERVATA",
          "Solo un amministratore può configurare una nuova sorgente esterna",
        );
      const areaOperativaId = positiveId(
        req.body?.areaOperativaId,
        "areaOperativaId",
      );
      const callerArea = callerAreaOperativaId(req);
      if (callerArea != null && callerArea !== areaOperativaId)
        throw new FsePracticeImportError(
          403,
          "AREA_NON_ACCESSIBILE",
          "Area non accessibile",
        );
      const codice = text(req.body?.codice, "codice", 80);
      const descrizione = text(req.body?.descrizione, "descrizione", 500);
      const command = auditContextFromRequest(req);
      const source = await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended('fse-agea-writer-transition', 0))`,
        );
        const [created] = await tx
          .insert(fseSourceRegistriesTable)
          .values({
            codice,
            descrizione,
            areaOperativaId,
            creatoDa: req.user!.id,
          })
          .returning();
        await recordAuditEvent(tx, {
          command,
          azione: "FSE_SORGENTE_CREATA",
          entitaTipo: "fse_source_registry",
          entitaId: created.id,
          areaOperativaIdSnapshot: areaOperativaId,
          changes: auditFields({ codice }, ["codice"]),
        });
        return created;
      });
      res.status(201).json(source);
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse-importazioni/analizza",
  requirePermission("magazzino.agea.import"),
  binaryBody,
  async (req, res) => {
    try {
      const sourceRegistryId = positiveId(
        req.query.sourceRegistryId,
        "sourceRegistryId",
      );
      const areaOperativaId = positiveId(
        req.query.areaOperativaId,
        "areaOperativaId",
      );
      const magazzinoId = positiveId(req.query.magazzinoId, "magazzinoId");
      const lottoLogicoId = positiveId(
        req.query.lottoLogicoId,
        "lottoLogicoId",
      );
      const profile = String(req.query.profilo ?? "") as
        | "REGISTRO"
        | "GIACENZE";
      const modalita = String(req.query.modalita ?? "") as
        | "NUOVI_CARICHI"
        | "SALDO_INIZIALE";
      if (!(["REGISTRO", "GIACENZE"] as const).includes(profile))
        throw new FsePracticeImportError(
          400,
          "PROFILO_NON_VALIDO",
          "Profilo file non valido",
        );
      if (!(["NUOVI_CARICHI", "SALDO_INIZIALE"] as const).includes(modalita))
        throw new FsePracticeImportError(
          400,
          "MODALITA_NON_VALIDA",
          "Modalità non valida",
        );
      if (
        modalita === "SALDO_INIZIALE" &&
        !req.user!.isAdmin &&
        !req.user!.isSuperAdmin &&
        !req.user!.permessi.includes("magazzino.agea.bootstrap")
      )
        throw new FsePracticeImportError(
          403,
          "PERMESSO_SALDO_RICHIESTO",
          "Permesso amministrativo richiesto",
        );
      if (!Buffer.isBuffer(req.body))
        throw new FsePracticeImportError(400, "FILE_MANCANTE", "File mancante");
      await assertWarehouseAccess(req, magazzinoId);
      const callerArea = callerAreaOperativaId(req);
      if (callerArea != null && callerArea !== areaOperativaId)
        throw new FsePracticeImportError(
          403,
          "AREA_NON_ACCESSIBILE",
          "Area non accessibile",
        );
      const command = auditContextFromRequest(req);
      const result = await db.transaction((tx) =>
        acquireFseFile(tx, {
          buffer: req.body as Buffer,
          nomeFile: text(
            req.query.nomeFile ?? "import-fse",
            "nomeFile",
            255,
          ).replace(/[^\p{L}\p{N}._ -]/gu, "_"),
          mimeType: req.get("content-type"),
          profile,
          sheetName:
            typeof req.query.sheetName === "string"
              ? req.query.sheetName
              : undefined,
          referenceDate:
            typeof req.query.dataRiferimento === "string"
              ? req.query.dataRiferimento
              : undefined,
          sessionId:
            req.query.sessionId == null
              ? undefined
              : positiveId(req.query.sessionId, "sessionId"),
          sourceRegistryId,
          areaOperativaId,
          magazzinoId,
          lottoLogicoId,
          caricoPraticaId:
            req.query.caricoPraticaId == null
              ? undefined
              : positiveId(req.query.caricoPraticaId, "caricoPraticaId"),
          modalita,
          actorId: req.user!.id,
          audit: command,
        }),
      );
      res.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.get(
  "/fse-importazioni/sessioni",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const warehouseId = positiveId(req.query.magazzinoId, "magazzinoId");
    await assertWarehouseAccess(req, warehouseId);
    const rows = await db
      .select()
      .from(fseImportSessionsTable)
      .where(eq(fseImportSessionsTable.magazzinoId, warehouseId))
      .orderBy(desc(fseImportSessionsTable.dataAggiornamento));
    res.json(rows);
  },
);

router.get(
  "/fse-importazioni/sessioni/:id",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    try {
      const session = await accessibleSession(
        req,
        positiveId(req.params.id, "id"),
      );
      const [files, rows, stockRows] = await Promise.all([
        db
          .select()
          .from(fseImportFilesTable)
          .where(eq(fseImportFilesTable.sessioneId, session.id))
          .orderBy(fseImportFilesTable.id),
        db
          .select({
            id: fseImportRowsTable.id,
            numeroRiga: fseImportRowsTable.numeroRiga,
            tipoMovimento: fseImportRowsTable.tipoMovimento,
            fondoOrigine: fseImportRowsTable.fondoOrigine,
            prodottoEsterno: fseImportRowsTable.prodottoEsterno,
            lottoFisico: fseImportRowsTable.lottoFisico,
            numeroDocumento: fseImportRowsTable.numeroDocumento,
            dataDocumento: fseImportRowsTable.dataDocumento,
            dataOperativaProposta: fseImportRowsTable.dataOperativaProposta,
            dataOperativaFonte: fseImportRowsTable.dataOperativaFonte,
            quantitaPezzi: fseImportRowsTable.quantitaPezzi,
            quantitaKgLt: fseImportRowsTable.quantitaKgLt,
            prodottoId: fseImportRowsTable.prodottoId,
            quantitaOperativa: fseImportRowsTable.quantitaOperativa,
            dataScadenza: fseImportRowsTable.dataScadenza,
            fattoreKgLtPezzo: fseImportRowsTable.fattoreKgLtPezzo,
            disambiguatore: fseImportRowsTable.disambiguatore,
            stato: fseImportRowsTable.stato,
            errorCodes: fseImportRowsTable.errorCodesJson,
            warningCodes: fseImportRowsTable.warningCodesJson,
          })
          .from(fseImportRowsTable)
          .where(eq(fseImportRowsTable.sessioneId, session.id))
          .orderBy(fseImportRowsTable.numeroRiga),
        db
          .select({
            id: fseImportStockRowsTable.id,
            numeroRiga: fseImportStockRowsTable.numeroRiga,
            fondoOrigine: fseImportStockRowsTable.fondoOrigine,
            prodottoEsterno: fseImportStockRowsTable.prodottoEsterno,
            lottoFisico: fseImportStockRowsTable.lottoFisico,
            giacenzaPezzi: fseImportStockRowsTable.giacenzaPezzi,
            giacenzaPesoVolume: fseImportStockRowsTable.giacenzaPesoVolume,
            pesoUnita: fseImportStockRowsTable.pesoUnita,
            dataScadenza: fseImportStockRowsTable.dataScadenza,
            prodottoId: fseImportStockRowsTable.prodottoId,
            quantitaOperativa: fseImportStockRowsTable.quantitaOperativa,
            stato: fseImportStockRowsTable.stato,
            errorCodes: fseImportStockRowsTable.errorCodesJson,
            warningCodes: fseImportStockRowsTable.warningCodesJson,
          })
          .from(fseImportStockRowsTable)
          .where(eq(fseImportStockRowsTable.sessioneId, session.id))
          .orderBy(fseImportStockRowsTable.numeroRiga),
      ]);
      const productIds = [
        ...new Set(
          [...rows, ...stockRows]
            .map((row) => row.prodottoId)
            .filter((id): id is number => id != null),
        ),
      ];
      const products =
        productIds.length === 0
          ? []
          : await db
              .select({
                id: prodottiTable.id,
                codice: prodottiTable.codice,
                nome: prodottiTable.nome,
                unitaMisura: prodottiTable.unitaMisura,
              })
              .from(prodottiTable)
              .where(inArray(prodottiTable.id, productIds));
      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );
      const decorate = <T extends { prodottoId: number | null }>(row: T) => ({
        ...row,
        prodotto:
          row.prodottoId == null
            ? null
            : (productMap.get(row.prodottoId) ?? null),
      });
      res.json({
        ...session,
        files,
        rows: rows.map(decorate),
        stockRows: stockRows.map(decorate),
        summary: {
          total: rows.length,
          ready: rows.filter((row) => row.stato === "PRONTO").length,
          needsMapping: rows.filter((row) => row.stato === "DA_ASSOCIARE")
            .length,
          needsReview: rows.filter((row) =>
            ["DA_VERIFICARE", "DATO_MODIFICATO"].includes(row.stato),
          ).length,
          errors: rows.filter((row) => row.stato === "ERRORE").length,
          known: rows.filter((row) =>
            ["GIA_REGISTRATO", "GIA_NELLA_PRATICA", "COPERTO_SALDO"].includes(
              row.stato,
            ),
          ).length,
          referenceOnly: rows.filter((row) => row.stato === "RIFERIMENTO")
            .length,
          stockRows: stockRows.length,
          stockPieces: totalStockPieces(stockRows),
        },
      });
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse-importazioni/sessioni/:id/associa-prodotto",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    try {
      const session = await accessibleSession(
        req,
        positiveId(req.params.id, "id"),
      );
      assertInitialBalancePermission(req, session);
      const command = auditContextFromRequest(req);
      const result = await db.transaction((tx) =>
        mapFseProduct(tx, {
          sessionId: session.id,
          version: positiveId(req.body?.versione, "versione"),
          externalDescription: text(
            req.body?.descrizioneEsterna,
            "descrizioneEsterna",
            4000,
          ),
          productId: positiveId(req.body?.prodottoId, "prodottoId"),
          actorId: req.user!.id,
          reason: text(req.body?.motivo, "motivo", 1000),
          acceptDateFallback: req.body?.accettaFallbackData === true,
          audit: command,
        }),
      );
      res.json(result);
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.patch(
  "/fse-importazioni/sessioni/:id/righe/:rigaId",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    try {
      const session = await accessibleSession(
        req,
        positiveId(req.params.id, "id"),
      );
      assertInitialBalancePermission(req, session);
      const optionalString = (value: unknown, field: string) => {
        if (value === undefined || value === null) return value;
        if (typeof value !== "string")
          throw new FsePracticeImportError(
            400,
            "CAMPO_NON_VALIDO",
            `${field} non valido`,
          );
        return value;
      };
      const command = auditContextFromRequest(req);
      const result = await db.transaction((tx) =>
        reviseFseImportRow(tx, {
          sessionId: session.id,
          rowId: positiveId(req.params.rigaId, "rigaId"),
          version: positiveId(req.body?.versione, "versione"),
          quantity: optionalString(req.body?.quantita, "quantita") ?? undefined,
          documentNumber: optionalString(
            req.body?.numeroDocumento,
            "numeroDocumento",
          ),
          documentDate: optionalString(
            req.body?.dataDocumento,
            "dataDocumento",
          ),
          operationalDate: optionalString(
            req.body?.dataOperativa,
            "dataOperativa",
          ),
          physicalLot: optionalString(req.body?.lottoFisico, "lottoFisico"),
          expiryDate: optionalString(req.body?.dataScadenza, "dataScadenza"),
          factor: optionalString(
            req.body?.fattoreKgLtPezzo,
            "fattoreKgLtPezzo",
          ),
          disambiguator: optionalString(
            req.body?.disambiguatore,
            "disambiguatore",
          ),
          acceptDateFallback: req.body?.accettaFallbackData === true,
          reason: text(req.body?.motivo, "motivo", 1000),
          actorId: req.user!.id,
          audit: command,
        }),
      );
      res.json(result);
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/fse-importazioni/sessioni/:id/aggiungi-pratica",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    try {
      const session = await accessibleSession(
        req,
        positiveId(req.params.id, "id"),
      );
      assertInitialBalancePermission(req, session);
      const command = auditContextFromRequest(req, {
        operationKey: `m3b:${text(req.body?.idempotencyKey, "idempotencyKey", 100)}`,
      });
      const result = await db.transaction((tx) =>
        addFseRowsToPractice(tx, {
          sessionId: session.id,
          version: positiveId(req.body?.versione, "versione"),
          practiceVersion:
            req.body?.versionePratica == null
              ? undefined
              : positiveId(req.body.versionePratica, "versionePratica"),
          rowIds: Array.isArray(req.body?.rigaIds)
            ? req.body.rigaIds.map((id: unknown) => positiveId(id, "rigaId"))
            : undefined,
          idempotencyKey: text(req.body?.idempotencyKey, "idempotencyKey", 100),
          historicalCoverageConfirmed:
            req.body?.confermaCoperturaStorica === true,
          actorId: req.user!.id,
          audit: command,
        }),
      );
      res.status(result.replay ? 200 : 201).json(result);
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

export default router;
