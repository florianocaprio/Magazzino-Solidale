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
  AgeaImportError,
  asAgeaImportError,
  confirmAgeaImport,
  correctAgeaImportExpiry,
  correctAgeaImportRow,
  recalculateAgeaImport,
} from "../lib/ageaImportService";
import {
  AGEA_MAX_BYTES,
  AGEA_MAX_LOT_LENGTH,
  AGEA_XLSX_MIME,
  normalizeAgeaKey,
  normalizeAgeaText,
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

const xlsxBody: RequestHandler = express.raw({
  type: AGEA_XLSX_MIME,
  limit: AGEA_MAX_BYTES,
});

router.use("/agea", requireModulo("LOTTI"));

function idParam(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requiredVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

function requiredMotivation(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const motivation = value.trim();
  return motivation.length >= 3 && motivation.length <= 500 ? motivation : null;
}

function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() === Number(match[2]) - 1 &&
    date.getUTCDate() === Number(match[3])
  );
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

async function auditAgeaConflict(
  req: Parameters<RequestHandler>[0],
  target: Record<string, unknown>,
  error: unknown,
) {
  const known = asAgeaImportError(error);
  if (!known || known.status !== 409) return;
  await db.insert(systemLogsTable).values({
    evento: "MAGAZZINO_AGEA_CONFLITTO",
    esito: "FAILURE",
    actorUserId: req.user!.id,
    details: {
      ...target,
      codiceErrore: "code" in known ? known.code : "INVENTORY_ERROR",
      messaggio: known.message,
    },
  });
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

router.get(
  "/agea/importazioni/:id/descrizioni-da-mappare",
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
      .select({
        chiaveDescrizioneNormalizzata:
          importazioniAgeaRigheTable.prodottoNormalizzato,
        descrizioneRawRappresentativa: sql<string>`min(${importazioniAgeaRigheTable.prodottoRaw})`,
        numeroRighe: sql<number>`count(*)::int`,
        fondi: sql<
          string[]
        >`array_remove(array_agg(DISTINCT ${importazioniAgeaRigheTable.fondoNormalizzato} ORDER BY ${importazioniAgeaRigheTable.fondoNormalizzato}), NULL)`,
        mappingId: mappatureProdottiEsterniTable.id,
        mappingAttiva: mappatureProdottiEsterniTable.attiva,
        mappingVersione: mappatureProdottiEsterniTable.versione,
        prodottoId: mappatureProdottiEsterniTable.prodottoId,
        prodottoNome: prodottiTable.nome,
      })
      .from(importazioniAgeaRigheTable)
      .leftJoin(
        mappatureProdottiEsterniTable,
        and(
          eq(mappatureProdottiEsterniTable.fonte, "AGEA_SIFEAD"),
          eq(
            mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
            importazioniAgeaRigheTable.prodottoNormalizzato,
          ),
        ),
      )
      .leftJoin(
        prodottiTable,
        eq(prodottiTable.id, mappatureProdottiEsterniTable.prodottoId),
      )
      .where(eq(importazioniAgeaRigheTable.importazioneId, id))
      .groupBy(
        importazioniAgeaRigheTable.prodottoNormalizzato,
        mappatureProdottiEsterniTable.id,
        prodottiTable.id,
      )
      .orderBy(asc(importazioniAgeaRigheTable.prodottoNormalizzato));
    res.json(rows);
  },
);

router.patch(
  "/agea/importazioni/:id/partite/:partitaId",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const partitaId = idParam(req.params.partitaId);
    const versione = requiredVersion(req.body?.versione);
    const motivazione = requiredMotivation(req.body?.motivazione);
    if (!id || !partitaId || !versione || !motivazione)
      return void res.status(400).json({
        error: "ID, versione o motivazione non validi",
        code: "RICHIESTA_NON_VALIDA",
      });
    if (req.body.dataScadenza !== null && !isCivilDate(req.body.dataScadenza))
      return void res.status(400).json({
        error: "Data scadenza non valida",
        code: "DATA_CIVILE_NON_VALIDA",
      });
    const access = await accessibleImport(req, id);
    if (!access.row)
      return void res.status(404).json({ error: "Importazione non trovata" });
    if (!access.allowed)
      return void res
        .status(403)
        .json({ error: "Importazione non accessibile" });
    try {
      const updated = await db.transaction((tx) =>
        correctAgeaImportExpiry(tx, {
          importId: id,
          partyId: partitaId,
          expectedVersion: versione,
          userId: req.user!.id,
          motivation: motivazione,
          value: req.body.dataScadenza,
        }),
      );
      res.json(updated);
    } catch (error) {
      await auditAgeaConflict(req, { importazioneId: id, partitaId }, error);
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

for (const correction of [
  { path: "data-carico", field: "DATA_CARICO" as const },
  { path: "lotto", field: "LOTTO" as const },
]) {
  router.patch(
    `/agea/importazioni/:id/righe/:rigaId/${correction.path}`,
    requirePermission("magazzino.agea.import"),
    async (req, res) => {
      const id = idParam(req.params.id);
      const rowId = idParam(req.params.rigaId);
      const versione = requiredVersion(req.body?.versione);
      const motivazione = requiredMotivation(req.body?.motivazione);
      const value = req.body?.valore;
      if (
        !id ||
        !rowId ||
        !versione ||
        !motivazione ||
        (value !== null && typeof value !== "string")
      )
        return void res.status(400).json({
          error: "ID, versione, valore o motivazione non validi",
          code: "RICHIESTA_NON_VALIDA",
        });
      if (
        correction.field === "DATA_CARICO" &&
        value !== null &&
        !isCivilDate(value)
      )
        return void res.status(400).json({
          error: "Data carico non valida",
          code: "DATA_CIVILE_NON_VALIDA",
        });
      if (
        correction.field === "LOTTO" &&
        value !== null &&
        (value.trim().length === 0 ||
          (normalizeAgeaText(value)?.length ?? 0) > AGEA_MAX_LOT_LENGTH)
      )
        return void res.status(400).json({
          error: "Lotto non valido",
          code: "LOTTO_NON_VALIDO",
        });
      const access = await accessibleImport(req, id);
      if (!access.row)
        return void res.status(404).json({ error: "Importazione non trovata" });
      if (!access.allowed)
        return void res
          .status(403)
          .json({ error: "Importazione non accessibile" });
      try {
        const updated = await db.transaction((tx) =>
          correctAgeaImportRow(tx, {
            importId: id,
            rowId,
            expectedVersion: versione,
            userId: req.user!.id,
            motivation: motivazione,
            field: correction.field,
            value: value === null ? null : value,
          }),
        );
        res.json(updated);
      } catch (error) {
        await auditAgeaConflict(
          req,
          { importazioneId: id, rigaId: rowId },
          error,
        );
        if (!sendKnownError(res, error)) throw error;
      }
    },
  );
}

router.post(
  "/agea/importazioni/:id/ricalcola",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const versione = requiredVersion(req.body?.versione);
    if (!id || !versione)
      return void res.status(400).json({
        error: "ID o versione non validi",
        code: "VERSIONE_RICHIESTA",
      });
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
          const result = await recalculateAgeaImport(tx, id, versione);
          await tx.insert(systemLogsTable).values({
            evento: "MAGAZZINO_AGEA_PREVIEW_RICALCOLATA",
            esito: result.stato === "BLOCCATA" ? "FAILURE" : "SUCCESS",
            actorUserId: req.user!.id,
            details: {
              importazioneId: result.id,
              magazzinoId: result.magazzinoId,
              stato: result.stato,
              righeBloccanti: result.righeBloccanti,
              versionePrecedente: versione,
              versioneNuova: result.versione,
            },
          });
          return result;
        }),
      );
    } catch (error) {
      await auditAgeaConflict(
        req,
        { importazioneId: id, azione: "RICALCOLA" },
        error,
      );
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/agea/importazioni/:id/conferma",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const versione = requiredVersion(req.body?.versione);
    if (!id || !versione)
      return void res.status(400).json({
        error: "ID o versione non validi",
        code: "VERSIONE_RICHIESTA",
      });
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
          confirmAgeaImport(tx, id, req.user!.id, versione),
        ),
      );
    } catch (error) {
      await auditAgeaConflict(
        req,
        { importazioneId: id, azione: "CONFERMA" },
        error,
      );
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.post(
  "/agea/importazioni/:id/annulla",
  requirePermission("magazzino.agea.import"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const versione = requiredVersion(req.body?.versione);
    if (!id || !versione)
      return void res.status(400).json({
        error: "ID o versione non validi",
        code: "VERSIONE_RICHIESTA",
      });
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
          throw new AgeaImportError(
            409,
            "IMPORTAZIONE_IMMUTABILE",
            "Un'importazione confermata non può essere annullata",
          );
        if (locked.versione !== versione)
          throw new AgeaImportError(
            409,
            "VERSIONE_NON_CORRENTE",
            "La preview è stata aggiornata: ricaricare i dati",
          );
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
            versionePrecedente: versione,
            versioneNuova: result.versione,
          },
        });
        return result;
      });
      res.json(updated);
    } catch (error) {
      await auditAgeaConflict(
        req,
        { importazioneId: id, azione: "ANNULLA" },
        error,
      );
      if (!sendKnownError(res, error)) throw error;
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
    try {
      const created = await db.transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(mappatureProdottiEsterniTable)
          .where(
            and(
              eq(mappatureProdottiEsterniTable.fonte, "AGEA_SIFEAD"),
              eq(
                mappatureProdottiEsterniTable.chiaveDescrizioneNormalizzata,
                key,
              ),
            ),
          )
          .for("update");
        if (previous)
          throw new AgeaImportError(
            409,
            "MAPPATURA_GIA_ESISTENTE",
            "La descrizione è già mappata: usare l'aggiornamento versionato",
          );
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
          .returning();
        await tx.insert(systemLogsTable).values({
          evento: "MAGAZZINO_AGEA_MAPPATURA_SALVATA",
          esito: "SUCCESS",
          actorUserId: req.user!.id,
          details: {
            mappingId: mapping.id,
            valorePrecedente: null,
            valoreNuovo: {
              prodottoId: productId,
              attiva: true,
              versione: mapping.versione,
            },
            fonte: "AGEA_SIFEAD",
          },
        });
        return mapping;
      });
      res.status(201).json(created);
    } catch (error) {
      await auditAgeaConflict(
        req,
        { descrizioneNormalizzata: key, azione: "CREA_MAPPING" },
        error,
      );
      if (!sendKnownError(res, error)) throw error;
    }
  },
);

router.patch(
  "/agea/mappature-prodotti/:id",
  requirePermission("magazzino.agea.mapping.manage"),
  async (req, res) => {
    const id = idParam(req.params.id);
    const productId = Number(req.body.prodottoId);
    const versione = requiredVersion(req.body?.versione);
    if (!id || !versione || !Number.isSafeInteger(productId) || productId <= 0)
      return void res.status(400).json({
        error: "ID, prodotto o versione non validi",
        code: "VERSIONE_RICHIESTA",
      });
    const [product] = await db
      .select()
      .from(prodottiTable)
      .where(eq(prodottiTable.id, productId));
    if (!product?.attivo)
      return void res
        .status(400)
        .json({ error: "Prodotto non trovato o non attivo" });
    let updated: typeof mappatureProdottiEsterniTable.$inferSelect | null;
    try {
      updated = await db.transaction(async (tx) => {
        const [previous] = await tx
          .select()
          .from(mappatureProdottiEsterniTable)
          .where(eq(mappatureProdottiEsterniTable.id, id))
          .for("update");
        if (!previous) return null;
        if (previous.versione !== versione)
          throw new AgeaImportError(
            409,
            "VERSIONE_NON_CORRENTE",
            "La mappatura è stata aggiornata: ricaricare i dati",
          );
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
        await tx.insert(systemLogsTable).values({
          evento: "MAGAZZINO_AGEA_MAPPATURA_MODIFICATA",
          esito: "SUCCESS",
          actorUserId: req.user!.id,
          details: {
            mappingId: mapping.id,
            valorePrecedente: {
              prodottoId: previous.prodottoId,
              attiva: previous.attiva,
              versione: previous.versione,
            },
            valoreNuovo: {
              prodottoId: mapping.prodottoId,
              attiva: mapping.attiva,
              versione: mapping.versione,
            },
            fonte: "AGEA_SIFEAD",
          },
        });
        return mapping;
      });
    } catch (error) {
      await auditAgeaConflict(
        req,
        { mappingId: id, azione: "AGGIORNA_MAPPING" },
        error,
      );
      if (!sendKnownError(res, error)) throw error;
      return;
    }
    if (!updated)
      return void res.status(404).json({ error: "Mappatura non trovata" });
    res.json(updated);
  },
);

export default router;
