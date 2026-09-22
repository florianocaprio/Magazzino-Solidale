import { Router, type IRouter } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { db, entiDestinatariTable } from "@workspace/db";
import { requirePermission } from "../middlewares/auth";
import { requireAllModuli } from "../lib/featureFlags";
import {
  callerAreaOperativaId,
  canAccessAreaOperativa,
} from "../lib/centroScope";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import {
  DocumentCommandError,
  commandRequestHash,
  findDocumentCommand,
  isDocumentCommandError,
  lockDocumentCommand,
  requireExpectedVersion,
  requireIdempotencyKey,
  storeDocumentCommand,
} from "../lib/documentCommand";

const router: IRouter = Router();
router.use(
  "/enti-destinatari",
  requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"]),
);

const cleanText = (value: unknown, max: number): string | null => {
  if (value == null) return null;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
};

router.get(
  "/enti-destinatari",
  requirePermission("enti-destinatari.view"),
  async (req, res) => {
    const activeOnly = req.query.attivo !== "false";
    const area = callerAreaOperativaId(req);
    const conditions = [];
    if (area != null)
      conditions.push(eq(entiDestinatariTable.areaOperativaId, area));
    if (activeOnly) conditions.push(eq(entiDestinatariTable.attivo, true));
    const rows = await db
      .select()
      .from(entiDestinatariTable)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(entiDestinatariTable.denominazione));
    res.json(rows);
  },
);

router.post(
  "/enti-destinatari",
  requirePermission("enti-destinatari.manage"),
  async (req, res) => {
    const denominazione = cleanText(req.body?.denominazione, 200);
    const indirizzo = cleanText(req.body?.indirizzo, 250);
    const telefono = cleanText(req.body?.telefono, 50);
    const email = cleanText(req.body?.email, 200);
    const areaOperativaId = Number(req.body?.areaOperativaId);
    let idempotencyKey: string;
    try {
      idempotencyKey = requireIdempotencyKey(req.body?.idempotencyKey);
    } catch (error) {
      if (isDocumentCommandError(error)) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    if (
      !denominazione ||
      !indirizzo ||
      !Number.isSafeInteger(areaOperativaId) ||
      areaOperativaId <= 0
    ) {
      res.status(400).json({
        error: "Denominazione, indirizzo e Area Operativa sono obbligatori",
      });
      return;
    }
    if (!canAccessAreaOperativa(areaOperativaId, callerAreaOperativaId(req))) {
      res.status(403).json({ error: "Area Operativa non accessibile" });
      return;
    }
    const tipoComando = "ENTE_DESTINATARIO_CREA";
    const requestHash = commandRequestHash({
      denominazione,
      indirizzo,
      telefono,
      email,
      areaOperativaId,
    });
    try {
      const result = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "ente_destinatario",
        });
        if (replay) {
          const [entity] = await tx
            .select()
            .from(entiDestinatariTable)
            .where(eq(entiDestinatariTable.id, replay.aggregatoId));
          if (!entity) throw new Error("COMMAND_RECEIPT_ENTITY_NOT_FOUND");
          if (
            !canAccessAreaOperativa(
              entity.areaOperativaId,
              callerAreaOperativaId(req),
            )
          ) {
            throw new Error("COMMAND_REPLAY_SCOPE_DENIED");
          }
          return { entity, replay: true };
        }

        const [entity] = await tx
          .insert(entiDestinatariTable)
          .values({
            denominazione,
            indirizzo,
            telefono,
            email,
            areaOperativaId,
          })
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "ENTE_DESTINATARIO_CREATO",
          entitaTipo: "ente_destinatario",
          entitaId: entity.id,
          areaOperativaIdSnapshot: entity.areaOperativaId,
          changes: auditFields({ attivo: true }, ["attivo"]),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "ente_destinatario",
          aggregatoId: entity.id,
          versioneRisultante: entity.versione,
          resultSnapshot: { id: entity.id, versione: entity.versione },
          actorUserId: req.user!.id,
        });
        return { entity, replay: false };
      });
      res.status(result.replay ? 200 : 201).json(result.entity);
    } catch (error) {
      if (isDocumentCommandError(error)) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "COMMAND_REPLAY_SCOPE_DENIED"
      ) {
        res.status(403).json({ error: "Ente destinatario non accessibile" });
        return;
      }
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23503"
      ) {
        res.status(400).json({ error: "Area Operativa non valida" });
        return;
      }
      throw error;
    }
  },
);

router.patch(
  "/enti-destinatari/:id",
  requirePermission("enti-destinatari.manage"),
  async (req, res) => {
    const id = Number(req.params.id);
    let idempotencyKey: string;
    let expectedVersion: number;
    try {
      idempotencyKey = requireIdempotencyKey(req.body?.idempotencyKey);
      expectedVersion = requireExpectedVersion(req.body?.versione);
    } catch (error) {
      if (isDocumentCommandError(error)) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
    const [current] = await db
      .select()
      .from(entiDestinatariTable)
      .where(eq(entiDestinatariTable.id, id));
    if (!current) {
      res.status(404).json({ error: "Ente destinatario non trovato" });
      return;
    }
    if (
      !canAccessAreaOperativa(
        current.areaOperativaId,
        callerAreaOperativaId(req),
      )
    ) {
      res.status(403).json({ error: "Ente destinatario non accessibile" });
      return;
    }
    const updates: Partial<typeof entiDestinatariTable.$inferInsert> = {};
    for (const [field, max] of [
      ["denominazione", 200],
      ["indirizzo", 250],
      ["telefono", 50],
      ["email", 200],
    ] as const) {
      if (field in (req.body ?? {})) {
        const value = cleanText(req.body[field], max);
        if ((field === "denominazione" || field === "indirizzo") && !value) {
          res.status(400).json({ error: `${field} non valido` });
          return;
        }
        if (field === "denominazione" && value) updates.denominazione = value;
        else if (field === "indirizzo" && value) updates.indirizzo = value;
        else if (field === "telefono") updates.telefono = value;
        else if (field === "email") updates.email = value;
      }
    }
    if (typeof req.body?.attivo === "boolean") updates.attivo = req.body.attivo;
    updates.dataAggiornamento = new Date();
    const hashUpdates = { ...updates, dataAggiornamento: undefined };
    const tipoComando = "ENTE_DESTINATARIO_MODIFICA";
    const requestHash = commandRequestHash({
      id,
      versione: expectedVersion,
      updates: hashUpdates,
    });
    try {
      const updated = await db.transaction(async (tx) => {
        await lockDocumentCommand(tx, tipoComando, idempotencyKey);
        const replay = await findDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          actorUserId: req.user!.id,
          aggregatoTipo: "ente_destinatario",
          aggregatoId: id,
        });
        if (replay) {
          const [entity] = await tx
            .select()
            .from(entiDestinatariTable)
            .where(eq(entiDestinatariTable.id, id));
          if (!entity) throw new Error("COMMAND_RECEIPT_ENTITY_NOT_FOUND");
          if (
            !canAccessAreaOperativa(
              entity.areaOperativaId,
              callerAreaOperativaId(req),
            )
          ) {
            throw new Error("COMMAND_REPLAY_SCOPE_DENIED");
          }
          return entity;
        }

        const [locked] = await tx
          .select()
          .from(entiDestinatariTable)
          .where(eq(entiDestinatariTable.id, id))
          .for("update");
        if (!locked) throw new Error("ENTE_DESTINATARIO_NOT_FOUND");
        if (
          !canAccessAreaOperativa(
            locked.areaOperativaId,
            callerAreaOperativaId(req),
          )
        ) {
          throw new Error("COMMAND_REPLAY_SCOPE_DENIED");
        }
        if (locked.versione !== expectedVersion) {
          throw new DocumentCommandError(
            409,
            "Versione non aggiornata; ricaricare i dati",
          );
        }
        const [entity] = await tx
          .update(entiDestinatariTable)
          .set({
            ...updates,
            versione: sql`${entiDestinatariTable.versione} + 1`,
          })
          .where(eq(entiDestinatariTable.id, id))
          .returning();
        await recordAuditEvent(tx, {
          command: auditContextFromRequest(req, {
            operationKey: `m4a:${tipoComando}:${idempotencyKey}`,
          }),
          azione: "ENTE_DESTINATARIO_MODIFICATO",
          entitaTipo: "ente_destinatario",
          entitaId: id,
          areaOperativaIdSnapshot: locked.areaOperativaId,
          changes: auditFields(
            { attivoPrecedente: locked.attivo, attivoNuovo: entity.attivo },
            ["attivoPrecedente", "attivoNuovo"],
          ),
        });
        await storeDocumentCommand(tx, {
          tipoComando,
          idempotencyKey,
          requestHash,
          aggregatoTipo: "ente_destinatario",
          aggregatoId: id,
          versioneRichiesta: expectedVersion,
          versioneRisultante: entity.versione,
          resultSnapshot: { id: entity.id, versione: entity.versione },
          actorUserId: req.user!.id,
        });
        return entity;
      });
      res.json(updated);
    } catch (error) {
      if (isDocumentCommandError(error)) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "ENTE_DESTINATARIO_NOT_FOUND"
      ) {
        res.status(404).json({ error: "Ente destinatario non trovato" });
        return;
      }
      if (
        error instanceof Error &&
        error.message === "COMMAND_REPLAY_SCOPE_DENIED"
      ) {
        res.status(403).json({ error: "Ente destinatario non accessibile" });
        return;
      }
      throw error;
    }
  },
);

export default router;
