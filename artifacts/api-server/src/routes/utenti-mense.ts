import { Router } from "express";
import { db, utentiTable, menseTable, utentiMenseTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/auth";
import {
  auditContextFromRequest,
  auditFields,
  recordAuditEvent,
} from "../lib/auditEvent";
import { currentMensaIds } from "../lib/mensaScope";

const router = Router();
router.use("/utenti/:utenteId/mense", requireAdmin);
router.get("/utenti/:utenteId/mense", async (req, res) => {
  const id = Number(req.params.utenteId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(400).json({ error: "Utente non valido" });
    return;
  }
  res.json(
    await db
      .select()
      .from(utentiMenseTable)
      .where(eq(utentiMenseTable.utenteId, id))
      .orderBy(utentiMenseTable.mensaId),
  );
});
router.put("/utenti/:utenteId/mense/:mensaId", async (req, res) => {
  const utenteId = Number(req.params.utenteId),
    mensaId = Number(req.params.mensaId);
  if (
    ![utenteId, mensaId].every((id) => Number.isSafeInteger(id) && id > 0) ||
    typeof req.body?.attiva !== "boolean"
  ) {
    res.status(400).json({ error: "Assegnazione non valida" });
    return;
  }
  const motivo =
    typeof req.body.motivo === "string" ? req.body.motivo.trim() : "";
  if (!motivo || motivo.length > 500) {
    res
      .status(400)
      .json({ error: "Motivo obbligatorio (massimo 500 caratteri)" });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      const admin = await currentMensaIds(tx, req.user!.id);
      if (!admin.role.isAdmin) throw new Error("FORBIDDEN");
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`mensa-assignment:${utenteId}:${mensaId}`}, 0))`,
      );
      const [user] = await tx
        .select()
        .from(utentiTable)
        .where(eq(utentiTable.id, utenteId))
        .for("share");
      const [mensa] = await tx
        .select()
        .from(menseTable)
        .where(eq(menseTable.id, mensaId));
      if (!user || !mensa) throw new Error("NOT_FOUND");
      if (
        req.body.attiva &&
        (!user.attivo || user.areaOperativaId !== mensa.areaOperativaId)
      )
        throw new Error("SCOPE_INVALID");
      const [previous] = await tx
        .select()
        .from(utentiMenseTable)
        .where(
          and(
            eq(utentiMenseTable.utenteId, utenteId),
            eq(utentiMenseTable.mensaId, mensaId),
          ),
        )
        .for("update");
      if (previous?.attiva === req.body.attiva) return previous;
      if (!previous && !req.body.attiva) throw new Error("NOT_FOUND");
      const values = req.body.attiva
        ? {
            attiva: true,
            assegnataDa: req.user!.id,
            assegnataAt: new Date(),
            revocataDa: null,
            revocataAt: null,
          }
        : { attiva: false, revocataDa: req.user!.id, revocataAt: new Date() };
      const [updated] = previous
        ? await tx
            .update(utentiMenseTable)
            .set(values)
            .where(eq(utentiMenseTable.id, previous.id))
            .returning()
        : await tx
            .insert(utentiMenseTable)
            .values({ utenteId, mensaId, assegnataDa: req.user!.id })
            .returning();
      await recordAuditEvent(tx, {
        command: auditContextFromRequest(req),
        azione: req.body.attiva
          ? "MENSA_OPERATORE_ASSEGNATO"
          : "MENSA_OPERATORE_REVOCATO",
        entitaTipo: "utente_mensa",
        entitaId: updated.id,
        areaOperativaIdSnapshot: mensa.areaOperativaId,
        magazzinoIdSnapshot: mensa.magazzinoId,
        motivo,
        changes: auditFields({ utenteId, mensaId, attiva: updated.attiva }, [
          "utenteId",
          "mensaId",
          "attiva",
        ]),
      });
      return updated;
    });
    res.json(row);
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["FORBIDDEN", "NOT_FOUND", "SCOPE_INVALID"].includes(code)) {
      res
        .status(code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 409)
        .json({
          error:
            code === "SCOPE_INVALID"
              ? "Assegna prima un'Area coerente all'operatore"
              : "Assegnazione non disponibile",
        });
      return;
    }
    throw error;
  }
});
export default router;
