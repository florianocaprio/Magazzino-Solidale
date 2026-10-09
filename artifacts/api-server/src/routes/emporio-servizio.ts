import { Router, type RequestHandler } from "express";
import {
  db,
  beneficiariTable,
  emporioAbilitazioniTable,
  magazziniTable,
  areeOperativeTable,
  centriAscoltoTable,
} from "@workspace/db";
import { and, eq, inArray, asc } from "drizzle-orm";
import { requireModulo } from "../lib/featureFlags";
import {
  requirePermission,
  currentEmporioActor,
  requireEmporioCommandTx,
  EmporioScopeError,
  emporioScopeErrorHandler,
  emporioEligibilityState,
} from "../lib/emporioScope";
import { centroScopeFilter, zonaUdsScopeFilter } from "../lib/centroScope";
import { auditEmporioTx } from "../lib/emporioAudit";
import type { PermissionKey } from "../lib/permissions";

const router = Router();
router.use("/emporio", requireModulo("EMPORIO_SOLIDALE"));
const readPermission: RequestHandler = (req, res, next) => {
  const keys: PermissionKey[] = [
    "emporio.access.view",
    "emporio.cassa.view",
    "credito.view",
    "emporio.eligibility.manage",
    "beneficiari.view",
  ];
  const key = keys.find(
    (k) => req.user?.isAdmin || req.user?.permessi.includes(k),
  );
  if (!key) {
    res.status(403).json({ error: "Consultazione Emporio non autorizzata." });
    return;
  }
  return requirePermission(key)(req, res, next);
};
router.get("/emporio/magazzini", readPermission, async (req, res) => {
  const rows = await db.transaction(async (tx) => {
    // Rilettura grant/Area anche nella query operativa; nessuna lista Magazzini generale.
    const key = (
      req.user!.isAdmin
        ? "emporio.access.view"
        : req.user!.permessi.find((p) =>
            ["emporio.access.view", "emporio.cassa.view"].includes(p),
          )
    )!;
    if (!key) throw new EmporioScopeError(403);
    const actor = await currentEmporioActor(tx, req.user!.id, key);
    return tx
      .select({
        id: magazziniTable.id,
        nome: magazziniTable.nome,
        areaOperativaId: magazziniTable.areaOperativaId,
      })
      .from(magazziniTable)
      .innerJoin(
        areeOperativeTable,
        eq(magazziniTable.areaOperativaId, areeOperativeTable.id),
      )
      .where(
        and(
          eq(magazziniTable.stato, "attivo"),
          inArray(magazziniTable.tipoMagazzino, ["emporio", "misto"]),
          eq(areeOperativeTable.attivo, true),
          actor.areaOperativaId == null
            ? undefined
            : eq(magazziniTable.areaOperativaId, actor.areaOperativaId),
        ),
      )
      .orderBy(asc(magazziniTable.nome));
  });
  res.json(rows);
});
router.get(
  "/emporio/abilitazioni/riepilogo-beneficiari",
  requirePermission("beneficiari.view"),
  async (req, res) => {
    const raw =
      typeof req.query.beneficiarioIds === "string"
        ? req.query.beneficiarioIds.split(",")
        : [];
    const ids = [...new Set(raw.map(Number))];
    if (
      !ids.length ||
      raw.length > 100 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    ) {
      res
        .status(400)
        .json({ error: "Indicare da 1 a 100 beneficiari validi." });
      return;
    }
    const rows = await db.transaction(async (tx) => {
      const actor = await currentEmporioActor(
        tx,
        req.user!.id,
        "beneficiari.view",
      );
      // Riepilogo della directory Sociale: non amplia lo scope della lista.
      return tx
        .select({
          beneficiarioId: beneficiariTable.id,
          areaOperativaId: beneficiariTable.areaOperativaId,
          stato: emporioEligibilityState(),
        })
        .from(beneficiariTable)
        .leftJoin(
          emporioAbilitazioniTable,
          and(
            eq(emporioAbilitazioniTable.beneficiarioId, beneficiariTable.id),
            eq(
              emporioAbilitazioniTable.areaOperativaId,
              beneficiariTable.areaOperativaId,
            ),
          ),
        )
        .where(
          and(
            inArray(beneficiariTable.id, ids),
            actor.areaOperativaId == null
              ? undefined
              : eq(beneficiariTable.areaOperativaId, actor.areaOperativaId),
            centroScopeFilter(
              beneficiariTable.centroAscoltoId,
              actor.centroAscoltoId,
            ),
            zonaUdsScopeFilter(beneficiariTable.zonaUdsId, actor.zonaUdsId),
          ),
        );
    });
    res.json(rows);
  },
);
router.get(
  "/emporio/beneficiari/:beneficiarioId/abilitazione",
  readPermission,
  async (req, res) => {
    const id = Number(req.params.beneficiarioId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Beneficiario non valido." });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const key = (
        req.user!.isAdmin
          ? "emporio.access.view"
          : req.user!.permessi.find((p) =>
              [
                "emporio.access.view",
                "emporio.cassa.view",
                "credito.view",
                "emporio.eligibility.manage",
                "beneficiari.view",
              ].includes(p),
            )
      )!;
      const { actor, beneficiary } = await requireEmporioCommandTx(
        tx,
        req.user!.id,
        key,
        { beneficiarioId: id },
        false,
      );
      const [right] = await tx
        .select({
          right: emporioAbilitazioniTable,
          statoEffettivo: emporioEligibilityState(),
        })
        .from(emporioAbilitazioniTable)
        .where(
          and(
            eq(emporioAbilitazioniTable.beneficiarioId, id),
            eq(
              emporioAbilitazioniTable.areaOperativaId,
              beneficiary.areaOperativaId ?? -1,
            ),
          ),
        );
      return {
        beneficiarioId: id,
        areaOperativaId: beneficiary.areaOperativaId,
        stato: right?.right.stato ?? "non_abilitato",
        statoEffettivo: right?.statoEffettivo ?? "non_abilitato",
        dataEffetto: right?.right.dataEffetto.toISOString() ?? null,
        motivo:
          actor.isAdmin ||
          (actor.permessi.includes("emporio.eligibility.manage") &&
            actor.aree.includes("sociale") &&
            (actor.centroAscoltoId == null ||
              actor.centroAscoltoId === beneficiary.centroAscoltoId))
            ? (right?.right.motivo ?? null)
            : null,
      };
    });
    res.json(result);
  },
);
router.post(
  "/emporio/beneficiari/:beneficiarioId/abilitazione",
  requirePermission("emporio.eligibility.manage"),
  async (req, res) => {
    const stato = req.body?.stato,
      motivo =
        typeof req.body?.motivo === "string" ? req.body.motivo.trim() : "";
    if (
      !["attivo", "sospeso", "revocato"].includes(stato) ||
      !motivo ||
      motivo.length > 1000
    ) {
      res
        .status(400)
        .json({ error: "Stato e motivo dell'abilitazione sono obbligatori." });
      return;
    }
    const id = Number(req.params.beneficiarioId);
    if (!Number.isSafeInteger(id) || id <= 0) {
      res.status(400).json({ error: "Beneficiario non valido." });
      return;
    }
    const result = await db.transaction(async (tx) => {
      const { actor, beneficiary: b } = await requireEmporioCommandTx(
        tx,
        req.user!.id,
        "emporio.eligibility.manage",
        { beneficiarioId: id },
        false,
      );
      if (
        !actor.isAdmin &&
        (!actor.aree.includes("sociale") ||
          (actor.centroAscoltoId != null &&
            actor.centroAscoltoId !== b.centroAscoltoId))
      )
        throw new EmporioScopeError(
          403,
          "Gestione abilitazioni riservata agli operatori sociali autorizzati.",
        );
      const [area] = await tx
        .select()
        .from(areeOperativeTable)
        .where(eq(areeOperativeTable.id, b.areaOperativaId ?? -1))
        .for("share");
      const [center] = await tx
        .select()
        .from(centriAscoltoTable)
        .where(eq(centriAscoltoTable.id, b.centroAscoltoId ?? -1))
        .for("share");
      if (
        !b.attivo ||
        !area?.attivo ||
        !center?.attivo ||
        center.areaOperativaId !== b.areaOperativaId
      )
        throw new EmporioScopeError(
          400,
          "Beneficiario, Area o Centro non disponibile/coerente.",
        );
      const [before] = await tx
        .select()
        .from(emporioAbilitazioniTable)
        .where(
          and(
            eq(emporioAbilitazioniTable.beneficiarioId, id),
            eq(emporioAbilitazioniTable.areaOperativaId, area.id),
          ),
        )
        .for("update");
      const transitions: Record<string, string[]> = {
        non_abilitato: ["attivo"],
        attivo: ["sospeso", "revocato"],
        sospeso: ["attivo", "revocato"],
        revocato: ["attivo"],
      };
      if (!transitions[before?.stato ?? "non_abilitato"]?.includes(stato))
        throw new EmporioScopeError(
          409,
          "Transizione di abilitazione non consentita.",
        );
      const values = {
        beneficiarioId: id,
        areaOperativaId: area.id,
        stato,
        dataEffetto: new Date(),
        operatoreId: actor.id,
        motivo,
      };
      const [after] = before
        ? await tx
            .update(emporioAbilitazioniTable)
            .set(values)
            .where(eq(emporioAbilitazioniTable.id, before.id))
            .returning()
        : await tx.insert(emporioAbilitazioniTable).values(values).returning();
      await auditEmporioTx(tx, {
        entityType: "abilitazione",
        entityId: after.id,
        action: stato,
        operatoreId: actor.id,
        ip: req.ip,
        motivo,
        before: before
          ? { stato: before.stato, areaOperativaId: before.areaOperativaId }
          : null,
        after: {
          beneficiarioId: id,
          areaOperativaId: area.id,
          stato,
          dataEffetto: after.dataEffetto.toISOString(),
        },
      });
      return {
        ...after,
        statoEffettivo: after.stato,
        dataEffetto: after.dataEffetto.toISOString(),
      };
    });
    res.json(result);
  },
);
router.use(emporioScopeErrorHandler);
export default router;
