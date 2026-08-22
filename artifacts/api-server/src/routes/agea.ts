import express, { Router, type IRouter, type RequestHandler } from "express";
import {
  AGEA_IMPORT_MODES,
  db,
  importazioniAgeaPartiteTable,
  importazioniAgeaRigheTable,
  importazioniAgeaTable,
  mappatureProdottiEsterniTable,
  prodottiTable,
  systemLogsTable,
  type AgeaImportMode,
} from "@workspace/db";
import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";
import {
  analyzeAgeaImport,
  asAgeaImportError,
  confirmAgeaImport,
  recalculateAgeaImport,
} from "../lib/ageaImportService";
import {
  AGEA_MAX_BYTES,
  AGEA_XLSX_MIME,
  normalizeAgeaKey,
} from "../lib/ageaSifeadParser";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessMagazzino,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
class AgeaImportCancellationError extends Error {}

const xlsxBody: RequestHandler = express.raw({
  type: AGEA_XLSX_MIME,
  limit: AGEA_MAX_BYTES,
});

router.use("/agea", requireModulo("LOTTI"));

function idParam(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function pageParams(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1);
  const pageSize = Number(query.pageSize ?? 50);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200
  )
    throw new Error("Paginazione non valida");
  return { page, pageSize, offset: (page - 1) * pageSize };
}

async function accessibleImport(
  req: Parameters<RequestHandler>[0],
  id: number,
) {
  const [row] = await db
    .select()
    .from(importazioniAgeaTable)
    .where(eq(importazioniAgeaTable.id, id));
  if (!row) return { row: null, allowed: false };
  const allowed = await canAccessMagazzino(
    row.magazzinoId,
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  return { row, allowed };
}

function sendKnownError(
  res: Parameters<RequestHandler>[1],
  error: unknown,
): boolean {
  const known = asAgeaImportError(error);
  if (!known) return false;
  res.status(known.status).json({
    error: known.message,
    code: "code" in known ? known.code : "INVENTORY_ERROR",
  });
  return true;
}

router.get(
  "/agea/importazioni",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const visible = await visibleMagazzinoIds(
      callerCentroId(req),
      callerAreaOperativaId(req),
    );
    const scope = magazzinoScopeFilter(
      importazioniAgeaTable.magazzinoId,
      visible,
    );
    const rows = await db
      .select()
      .from(importazioniAgeaTable)
      .where(scope)
      .orderBy(desc(importazioniAgeaTable.dataCreazione));
    res.json(rows);
  },
);

router.post(
  "/agea/importazioni/analizza",
  requirePermission("magazzino.agea.import"),
  xlsxBody,
  async (req, res) => {
    const magazzinoId = Number(req.query.magazzinoId);
    const modalita = String(req.query.modalita ?? "") as AgeaImportMode;
    if (
      !Number.isSafeInteger(magazzinoId) ||
      magazzinoId <= 0 ||
      !AGEA_IMPORT_MODES.includes(modalita)
    ) {
      res.status(400).json({ error: "magazzinoId o modalità non validi" });
      return;
    }
    if (
      req.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      AGEA_XLSX_MIME
    ) {
      res.status(415).json({
        error: "Content-Type XLSX richiesto",
        code: "MIME_XLSX_NON_VALIDO",
      });
      return;
    }
    if (
      modalita === "PRIMA_ACQUISIZIONE" &&
      !req.user!.permessi.includes("magazzino.agea.bootstrap") &&
      !req.user!.isAdmin &&
      !req.user!.isSuperAdmin
    ) {
      res.status(403).json({ error: "Permesso bootstrap AGEA richiesto" });
      return;
    }
    if (
      !(await canAccessMagazzino(
        magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Magazzino non accessibile per il tuo profilo" });
      return;
    }
    const rawName = String(req.query.nomeFile ?? "registro-agea.xlsx");
    const nomeFile = rawName.replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 255);
    if (
      !nomeFile.toLowerCase().endsWith(".xlsx") ||
      !Buffer.isBuffer(req.body)
    ) {
      res.status(400).json({
        error: "È richiesto un file .xlsx",
        code: "ESTENSIONE_XLSX_NON_VALIDA",
      });
      return;
    }
    try {
      const result = await db.transaction((tx) =>
        analyzeAgeaImport(tx, {
          buffer: req.body as Buffer,
          magazzinoId,
          modalita,
          nomeFile,
          creatoDa: req.user!.id,
        }),
      );
      res.status(201).json(result);
    } catch (error) {
      if (sendKnownError(res, error)) return;
      if (error instanceof Error && "code" in error) {
        res
          .status(400)
          .json({ error: error.message, code: String(error.code) });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/agea/importazioni/:id",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    res.json(access.row);
  },
);

router.get(
  "/agea/importazioni/:id/righe",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    let paging;
    try {
      paging = pageParams(req.query);
    } catch {
      return void res.status(400).json({ error: "Paginazione non valida" });
    }
    const conditions: SQL[] = [
      eq(importazioniAgeaRigheTable.importazioneId, id),
    ];
    if (req.query.stato)
      conditions.push(
        eq(importazioniAgeaRigheTable.statoRiga, String(req.query.stato)),
      );
    if (req.query.fondo)
      conditions.push(
        eq(
          importazioniAgeaRigheTable.fondoNormalizzato,
          String(req.query.fondo),
        ),
      );
    if (req.query.tipo)
      conditions.push(
        eq(
          importazioniAgeaRigheTable.tipoMovimentoEsterno,
          String(req.query.tipo),
        ),
      );
    if (req.query.q) {
      const q = `%${String(req.query.q).slice(0, 100)}%`;
      conditions.push(
        sql`(${importazioniAgeaRigheTable.prodottoRaw} ILIKE ${q} OR ${importazioniAgeaRigheTable.lottoRaw} ILIKE ${q} OR ${importazioniAgeaRigheTable.numeroDocumentoRaw} ILIKE ${q})`,
      );
    }
    const where = and(...conditions);
    const [countRow] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(importazioniAgeaRigheTable)
      .where(where);
    const items = await db
      .select()
      .from(importazioniAgeaRigheTable)
      .where(where)
      .orderBy(asc(importazioniAgeaRigheTable.numeroRiga))
      .limit(paging.pageSize)
      .offset(paging.offset);
    res.json({
      items,
      total: countRow.total,
      page: paging.page,
      pageSize: paging.pageSize,
    });
  },
);

router.get(
  "/agea/importazioni/:id/partite",
  requirePermission("magazzino.agea.view"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    const rows = await db
      .select()
      .from(importazioniAgeaPartiteTable)
      .where(eq(importazioniAgeaPartiteTable.importazioneId, id))
      .orderBy(asc(importazioniAgeaPartiteTable.id));
    res.json(rows);
  },
);

router.patch(
  "/agea/importazioni/:id/partite/:partitaId",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const partitaId = idParam(req.params.partitaId);
    if (
      !id ||
      !partitaId ||
      (req.body.dataScadenza != null &&
        !/^\d{4}-\d{2}-\d{2}$/.test(req.body.dataScadenza))
    )
      return void res
        .status(400)
        .json({ error: "ID o data scadenza non validi" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    if (["CONFERMATA", "ANNULLATA"].includes(access.row.stato))
      return void res
        .status(409)
        .json({ error: "L'importazione non è più modificabile" });
    const [updated] = await db
      .update(importazioniAgeaPartiteTable)
      .set({
        dataScadenzaRisolta: req.body.dataScadenza ?? null,
        dataScadenzaFonte: req.body.dataScadenza ? "INSERIMENTO_MANUALE" : null,
        dataAggiornamento: new Date(),
      })
      .where(
        and(
          eq(importazioniAgeaPartiteTable.id, partitaId),
          eq(importazioniAgeaPartiteTable.importazioneId, id),
        ),
      )
      .returning();
    if (!updated)
      return void res
        .status(404)
        .json({ error: "Partita preview non trovata" });
    res.json(updated);
  },
);

router.post(
  "/agea/importazioni/:id/ricalcola",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    try {
      res.json(
        await db.transaction(async (tx) => {
          const result = await recalculateAgeaImport(tx, id);
          await tx.insert(systemLogsTable).values({
            evento: "MAGAZZINO_AGEA_PREVIEW_RICALCOLATA",
            esito: result.stato === "BLOCCATA" ? "FAILURE" : "SUCCESS",
            actorUserId: req.user!.id,
            details: {
              importazioneId: result.id,
              magazzinoId: result.magazzinoId,
              stato: result.stato,
              righeBloccanti: result.righeBloccanti,
            },
          });
          return result;
        }),
      );
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/agea/importazioni/:id/conferma",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    if (
      access.row.modalita === "PRIMA_ACQUISIZIONE" &&
      !req.user!.permessi.includes("magazzino.agea.bootstrap") &&
      !req.user!.isAdmin &&
      !req.user!.isSuperAdmin
    )
      return void res
        .status(403)
        .json({ error: "Permesso bootstrap AGEA richiesto" });
    try {
      res.json(
        await db.transaction((tx) =>
          confirmAgeaImport(tx, id, req.user!.id, req.body?.versione),
        ),
      );
    } catch (error) {
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/agea/importazioni/:id/annulla",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    if (!id) return void res.status(400).json({ error: "ID non valido" });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    try {
      const updated = await db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(importazioniAgeaTable)
          .where(eq(importazioniAgeaTable.id, id))
          .for("update");
        if (!locked)
          throw new Error("Importazione non trovata durante l'annullamento");
        if (locked.stato === "CONFERMATA")
          throw new AgeaImportCancellationError();
        if (locked.stato === "ANNULLATA") return locked;
        const [result] = await tx
          .update(importazioniAgeaTable)
          .set({
            stato: "ANNULLATA",
            versione: locked.versione + 1,
            annullatoDa: req.user!.id,
            dataAnnullamento: new Date(),
          })
          .where(eq(importazioniAgeaTable.id, id))
          .returning();
        await tx.insert(systemLogsTable).values({
          evento: "MAGAZZINO_AGEA_IMPORT_ANNULLATA",
          esito: "SUCCESS",
          actorUserId: req.user!.id,
          details: {
            importazioneId: result.id,
            magazzinoId: result.magazzinoId,
          },
        });
        return result;
      });
      res.json(updated);
    } catch (error) {
      if (error instanceof AgeaImportCancellationError)
        return void res.status(409).json({
          error: "Un'importazione confermata non può essere annullata",
        });
      throw error;
    }
  },
);

router.get(
  "/agea/mappature-prodotti",
  requirePermission("magazzino.agea.view"),
  async (_req, res) => {
    const rows = await db
      .select({
        mapping: mappatureProdottiEsterniTable,
        prodotto: prodottiTable,
      })
      .from(mappatureProdottiEsterniTable)
      .innerJoin(
        prodottiTable,
        eq(mappatureProdottiEsterniTable.prodottoId, prodottiTable.id),
      )
      .where(eq(mappatureProdottiEsterniTable.fonte, "AGEA_SIFEAD"))
      .orderBy(asc(mappatureProdottiEsterniTable.descrizioneEsterna));
    res.json(rows.map(({ mapping, prodotto }) => ({ ...mapping, prodotto })));
  },
);

router.post(
  "/agea/mappature-prodotti",
  requirePermission("magazzino.agea.mapping.manage"),
  async (req, res) => {
    const description =
      typeof req.body.descrizioneEsterna === "string"
        ? req.body.descrizioneEsterna.trim()
        : "";
    const key = normalizeAgeaKey(description);
    const productId = Number(req.body.prodottoId);
    if (!key || !Number.isSafeInteger(productId) || productId <= 0)
      return void res
        .status(400)
        .json({ error: "Descrizione o prodotto non validi" });
    const [product] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.id, productId));
    if (!product?.attivo)
      return void res
        .status(400)
        .json({ error: "Prodotto non trovato o non attivo" });
    const created = await db.transaction(async (tx) => {
      const [mapping] = await tx
        .insert(mappatureProdottiEsterniTable)
        .values({
          fonte: "AGEA_SIFEAD",
          descrizioneEsterna: description,
          chiaveDescrizioneNormalizzata: key,
          prodottoId: productId,
          creatoDa: req.user!.id,
          aggiornatoDa: req.user!.id,
        })
        .onConflictDoUpdate({
          target: [
            mappatureProdottiEsterniTable.fonte,
            mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
          ],
          set: {
            descrizioneEsterna: description,
            prodottoId: productId,
            attiva: true,
            aggiornatoDa: req.user!.id,
            dataUltimoAggiornamento: new Date(),
            dataUltimoRiscontro: new Date(),
            versione: sql`${mappatureProdottiEsterniTable.versione} + 1`,
          },
        })
        .returning();
      await tx.insert(systemLogsTable).values({
        evento: "MAGAZZINO_AGEA_MAPPATURA_SALVATA",
        esito: "SUCCESS",
        actorUserId: req.user!.id,
        details: {
          mappingId: mapping.id,
          prodottoId: productId,
          fonte: "AGEA_SIFEAD",
        },
      });
      return mapping;
    });
    res.status(201).json(created);
  },
);

router.patch(
  "/agea/mappature-prodotti/:id",
  requirePermission("magazzino.agea.mapping.manage"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const productId = Number(req.body.prodottoId);
    if (!id || !Number.isSafeInteger(productId) || productId <= 0)
      return void res.status(400).json({ error: "ID o prodotto non validi" });
    const [product] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.id, productId));
    if (!product?.attivo)
      return void res
        .status(400)
        .json({ error: "Prodotto non trovato o non attivo" });
    const updated = await db.transaction(async (tx) => {
      const [mapping] = await tx
        .update(mappatureProdottiEsterniTable)
        .set({
          prodottoId: productId,
          attiva: req.body.attiva ?? true,
          aggiornatoDa: req.user!.id,
          dataUltimoAggiornamento: new Date(),
          versione: sql`${mappatureProdottiEsterniTable.versione} + 1`,
        })
        .where(eq(mappatureProdottiEsterniTable.id, id))
        .returning();
      if (!mapping) return null;
      await tx.insert(systemLogsTable).values({
        evento: "MAGAZZINO_AGEA_MAPPATURA_MODIFICATA",
        esito: "SUCCESS",
        actorUserId: req.user!.id,
        details: {
          mappingId: mapping.id,
          prodottoId: productId,
          attiva: mapping.attiva,
          fonte: "AGEA_SIFEAD",
        },
      });
      return mapping;
    });
    if (!updated)
      return void res.status(404).json({ error: "Mappatura non trovata" });
    res.json(updated);
  },
);

export default router;
