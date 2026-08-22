import { Router, type IRouter, type Request } from "express";
import {
  areeOperativeTable,
  auditConfigurazioniTable,
  db,
  zoneUdsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateZonaUdsBody, UpdateZonaUdsBody } from "@workspace/api-zod";
import { requireAdmin, requirePermission } from "../middlewares/auth";
import {
  callerAreaOperativaId,
  canAccessAreaOperativa,
} from "../lib/centroScope";
import { canMutateScopedResource } from "../lib/adminScope";
import { requireModulo } from "../lib/featureFlags";
import {
  UNITA_STRADA_DISABLED_MSG,
  isUnitaStradaEnabled,
} from "../lib/impostazioniModuli";

const router: IRouter = Router();

router.use("/zone-uds", requireModulo("UDS"));

type ZonaRow = typeof zoneUdsTable.$inferSelect;
type ZonaTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function fmt(r: ZonaRow, areaOperativaNome: string | null = null) {
  return {
    id: r.id,
    areaOperativaId: r.areaOperativaId,
    areaOperativaNome,
    nome: r.nome,
    attivo: r.attivo,
    note: r.note ?? null,
    versione: r.versione,
    dataCreazione: r.dataCreazione.toISOString(),
    dataAggiornamento: r.dataAggiornamento.toISOString(),
  };
}

function isUniqueViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current != null && depth < 5; depth += 1) {
    if (
      typeof current === "object" &&
      (current as { code?: unknown }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object"
        ? (current as { cause?: unknown }).cause
        : undefined;
  }
  return false;
}

async function auditZona(
  req: Request,
  input: {
    id: number;
    azione: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown> | null;
  },
  executor: ZonaTx | typeof db = db,
) {
  await executor.insert(auditConfigurazioniTable).values({
    area: "uds",
    chiave: `zona:${input.id}`,
    azione: input.azione,
    valorePrecedente: input.before ?? null,
    valoreNuovo: input.after ?? null,
    utenteId: req.user?.id ?? null,
    ip: req.ip ?? req.socket.remoteAddress ?? null,
  });
}

router.get(
  "/zone-uds",
  requirePermission("uds.directory.view"),
  async (req, res) => {
    const callerArea = callerAreaOperativaId(req);
    const requestedArea = req.query.areaOperativaId
      ? Number(req.query.areaOperativaId)
      : null;
    if (
      requestedArea != null &&
      (!Number.isInteger(requestedArea) || requestedArea <= 0)
    ) {
      res.status(400).json({ error: "Area non valida" });
      return;
    }
    const effectiveArea = callerArea ?? requestedArea;
    const includeInactive =
      req.query.includiInattive === "true" &&
      Boolean(req.user?.isAdmin || req.user?.isSuperAdmin);
    const conditions = [
      effectiveArea == null
        ? undefined
        : eq(zoneUdsTable.areaOperativaId, effectiveArea),
      includeInactive ? undefined : eq(zoneUdsTable.attivo, true),
    ].filter(
      (condition): condition is NonNullable<typeof condition> =>
        condition != null,
    );
    const rows = await db
      .select({ z: zoneUdsTable, areaOperativaNome: areeOperativeTable.nome })
      .from(zoneUdsTable)
      .leftJoin(
        areeOperativeTable,
        eq(zoneUdsTable.areaOperativaId, areeOperativeTable.id),
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(zoneUdsTable.nome, zoneUdsTable.id);
    res.json(rows.map((row) => fmt(row.z, row.areaOperativaNome ?? null)));
  },
);

router.get(
  "/zone-uds/:id",
  requirePermission("uds.directory.view"),
  async (req, res) => {
    const id = Number(req.params.id);
    const [row] = await db
      .select({ z: zoneUdsTable, areaOperativaNome: areeOperativeTable.nome })
      .from(zoneUdsTable)
      .leftJoin(
        areeOperativeTable,
        eq(zoneUdsTable.areaOperativaId, areeOperativeTable.id),
      )
      .where(eq(zoneUdsTable.id, id));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (
      !canAccessAreaOperativa(row.z.areaOperativaId, callerAreaOperativaId(req))
    ) {
      res
        .status(403)
        .json({ error: "Zona non accessibile per il tuo profilo" });
      return;
    }
    res.json(fmt(row.z, row.areaOperativaNome ?? null));
  },
);

router.post("/zone-uds", requireAdmin, async (req, res) => {
  if (!(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  const parsed = CreateZonaUdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Inserimento zona UDS non valido" });
    return;
  }
  if (
    !canMutateScopedResource(
      parsed.data.areaOperativaId,
      callerAreaOperativaId(req),
    )
  ) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const [area] = await db
    .select({ id: areeOperativeTable.id, attivo: areeOperativeTable.attivo })
    .from(areeOperativeTable)
    .where(eq(areeOperativeTable.id, parsed.data.areaOperativaId));
  if (!area || !area.attivo) {
    res.status(400).json({
      error: "L'Area Operativa selezionata non è disponibile",
    });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(zoneUdsTable)
        .values({ ...parsed.data, nome: parsed.data.nome.trim() })
        .returning();
      await auditZona(
        req,
        {
          id: created.id,
          azione: "creazione",
          after: {
            areaOperativaId: created.areaOperativaId,
            nome: created.nome,
            attivo: created.attivo,
            note: created.note,
          },
        },
        tx,
      );
      return created;
    });
    res.status(201).json(fmt(row));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: "Esiste già una Zona UDS attiva con questo nome nell'Area",
      });
      return;
    }
    throw error;
  }
});

router.patch("/zone-uds/:id", requireAdmin, async (req, res) => {
  if (!(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  const id = Number(req.params.id);
  const versione = Number(req.body?.versione);
  if (!Number.isSafeInteger(versione) || versione < 1) {
    res.status(400).json({ error: "La versione è obbligatoria" });
    return;
  }
  const parsed = UpdateZonaUdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica zona UDS non valida" });
    return;
  }
  try {
    const row = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(zoneUdsTable)
        .where(eq(zoneUdsTable.id, id))
        .for("update");
      if (!existing) return null;
      if (
        !canMutateScopedResource(
          existing.areaOperativaId,
          callerAreaOperativaId(req),
        )
      ) {
        throw new Error("scope");
      }
      if (
        parsed.data.areaOperativaId !== undefined &&
        parsed.data.areaOperativaId !== existing.areaOperativaId
      ) {
        throw new Error("immutable-area");
      }
      if (existing.versione !== versione) throw new Error("version");
      const [updated] = await tx
        .update(zoneUdsTable)
        .set({
          ...(parsed.data.nome !== undefined
            ? { nome: parsed.data.nome.trim() }
            : {}),
          ...(parsed.data.note !== undefined ? { note: parsed.data.note } : {}),
          ...(parsed.data.attivo !== undefined
            ? { attivo: parsed.data.attivo }
            : {}),
          versione: existing.versione + 1,
          dataAggiornamento: new Date(),
        })
        .where(
          and(eq(zoneUdsTable.id, id), eq(zoneUdsTable.versione, versione)),
        )
        .returning();
      if (!updated) throw new Error("version");
      const action =
        existing.attivo !== updated.attivo
          ? updated.attivo
            ? "riattivazione"
            : "disattivazione"
          : "modifica";
      await auditZona(
        req,
        {
          id,
          azione: action,
          before: {
            areaOperativaId: existing.areaOperativaId,
            nome: existing.nome,
            attivo: existing.attivo,
            note: existing.note,
            versione: existing.versione,
          },
          after: {
            areaOperativaId: updated.areaOperativaId,
            nome: updated.nome,
            attivo: updated.attivo,
            note: updated.note,
            versione: updated.versione,
          },
        },
        tx,
      );
      return updated;
    });
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(fmt(row));
  } catch (error) {
    if (isUniqueViolation(error)) {
      res.status(409).json({
        error: "Esiste già una Zona UDS attiva con questo nome nell'Area",
      });
      return;
    }
    const reason = error instanceof Error ? error.message : "";
    if (reason === "scope") {
      res
        .status(403)
        .json({ error: "Zona non modificabile per il tuo profilo" });
      return;
    }
    if (reason === "immutable-area") {
      res.status(409).json({
        error: "L'Area Operativa di una Zona UDS è immutabile",
      });
      return;
    }
    if (reason === "version") {
      res
        .status(409)
        .json({ error: "La Zona è stata modificata; ricarica i dati" });
      return;
    }
    throw error;
  }
});

router.delete("/zone-uds/:id", requireAdmin, async (req, res) => {
  if (!(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) {
    res.status(400).json({ error: "id non valido" });
    return;
  }
  const version = Number(req.query.versione ?? req.body?.versione);
  if (!Number.isSafeInteger(version) || version < 1) {
    res.status(400).json({ error: "La versione è obbligatoria" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(zoneUdsTable)
      .where(eq(zoneUdsTable.id, id))
      .for("update");
    if (!existing) return { kind: "missing" as const };
    if (
      !canMutateScopedResource(
        existing.areaOperativaId,
        callerAreaOperativaId(req),
      )
    ) {
      return { kind: "scope" as const };
    }
    if (existing.versione !== version) {
      return { kind: "version" as const };
    }
    const [row] = await tx
      .update(zoneUdsTable)
      .set({
        attivo: false,
        versione: existing.versione + 1,
        dataAggiornamento: new Date(),
      })
      .where(and(eq(zoneUdsTable.id, id), eq(zoneUdsTable.versione, version)))
      .returning();
    if (!row) return { kind: "version" as const };
    await auditZona(
      req,
      {
        id,
        azione: "disattivazione",
        before: { attivo: existing.attivo, versione: existing.versione },
        after: { attivo: false, versione: row.versione },
      },
      tx,
    );
    return { kind: "updated" as const, row };
  });
  if (result.kind === "missing") {
    res.status(204).send();
    return;
  }
  if (result.kind === "scope") {
    res.status(403).json({ error: "Zona non modificabile per il tuo profilo" });
    return;
  }
  if (result.kind === "version") {
    res
      .status(409)
      .json({ error: "La Zona è stata modificata; ricarica i dati" });
    return;
  }
  res.status(204).send();
});

export default router;
