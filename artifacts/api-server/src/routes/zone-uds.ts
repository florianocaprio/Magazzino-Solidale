import { Router, type IRouter } from "express";
import { db, zoneUdsTable, areeOperativeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateZonaUdsBody, UpdateZonaUdsBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import { callerAreaOperativaId, canAccessAreaOperativa } from "../lib/centroScope";
import { canMutateScopedResource } from "../lib/adminScope";
import { requireModulo } from "../lib/featureFlags";
import { UNITA_STRADA_DISABLED_MSG, isUnitaStradaEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

router.use("/zone-uds", requireModulo("UDS"));

type ZonaRow = typeof zoneUdsTable.$inferSelect;

function fmt(r: ZonaRow, areaOperativaNome: string | null = null) {
  return {
    id: r.id,
    areaOperativaId: r.areaOperativaId,
    areaOperativaNome,
    nome: r.nome,
    attivo: r.attivo,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// Zones belong to a area operativa (HARD boundary). A area operativa-scoped caller sees only the
// zones of their own area operativa; a global caller sees all (optionally filtered by
// the areaOperativaId query param).
router.get("/zone-uds", async (req, res) => {
  const areaOperativaId = callerAreaOperativaId(req);
  const queryAreaOperativa = req.query.areaOperativaId ? Number(req.query.areaOperativaId) : null;
  if (queryAreaOperativa != null && (!Number.isInteger(queryAreaOperativa) || queryAreaOperativa <= 0)) {
    res.status(400).json({ error: "Area non valida" });
    return;
  }
  const effectiveAreaOperativa = areaOperativaId ?? queryAreaOperativa;

  const rows = effectiveAreaOperativa == null ? await db.select({ z: zoneUdsTable, areaOperativaNome: areeOperativeTable.nome }).from(zoneUdsTable).leftJoin(areeOperativeTable, eq(zoneUdsTable.areaOperativaId, areeOperativeTable.id)).orderBy(zoneUdsTable.nome) : await db.select({ z: zoneUdsTable, areaOperativaNome: areeOperativeTable.nome }).from(zoneUdsTable).leftJoin(areeOperativeTable, eq(zoneUdsTable.areaOperativaId, areeOperativeTable.id)).where(eq(zoneUdsTable.areaOperativaId, effectiveAreaOperativa)).orderBy(zoneUdsTable.nome);

  res.json(rows.map((r) => fmt(r.z, r.areaOperativaNome ?? null)));
});

router.get("/zone-uds/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [row] = await db.select({ z: zoneUdsTable, areaOperativaNome: areeOperativeTable.nome }).from(zoneUdsTable).leftJoin(areeOperativeTable, eq(zoneUdsTable.areaOperativaId, areeOperativeTable.id)).where(eq(zoneUdsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessAreaOperativa(row.z.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Zona non accessibile per il tuo profilo" });
    return;
  }
  res.json(fmt(row.z, row.areaOperativaNome ?? null));
});

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
  const callerAreaId = callerAreaOperativaId(req);
  if (!canMutateScopedResource(parsed.data.areaOperativaId, callerAreaId)) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const [area] = await db.select({ id: areeOperativeTable.id, attivo: areeOperativeTable.attivo }).from(areeOperativeTable).where(eq(areeOperativeTable.id, parsed.data.areaOperativaId));
  if (!area || !area.attivo) {
    res.status(400).json({ error: "L'Area Operativa selezionata non è disponibile" });
    return;
  }
  const [row] = await db.insert(zoneUdsTable).values(parsed.data).returning();
  res.status(201).json(fmt(row));
});

router.patch("/zone-uds/:id", requireAdmin, async (req, res) => {
  if (!(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(zoneUdsTable).where(eq(zoneUdsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const callerAreaId = callerAreaOperativaId(req);
  if (!canMutateScopedResource(existing.areaOperativaId, callerAreaId)) {
    res.status(403).json({ error: "Zona non modificabile per il tuo profilo" });
    return;
  }
  const parsed = UpdateZonaUdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica zona UDS non valida" });
    return;
  }
  if (parsed.data.areaOperativaId !== undefined && !canMutateScopedResource(parsed.data.areaOperativaId, callerAreaId)) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  if (parsed.data.areaOperativaId !== undefined) {
    const [area] = await db.select({ id: areeOperativeTable.id, attivo: areeOperativeTable.attivo }).from(areeOperativeTable).where(eq(areeOperativeTable.id, parsed.data.areaOperativaId));
    if (!area || !area.attivo) {
      res.status(400).json({ error: "L'Area Operativa selezionata non è disponibile" });
      return;
    }
  }
  const [row] = await db.update(zoneUdsTable).set(parsed.data).where(eq(zoneUdsTable.id, id)).returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/zone-uds/:id", requireAdmin, async (req, res) => {
  if (!(await isUnitaStradaEnabled())) {
    res.status(403).json({ error: UNITA_STRADA_DISABLED_MSG });
    return;
  }
  const id = parseInt(req.params.id as string);
  const [existing] = await db.select().from(zoneUdsTable).where(eq(zoneUdsTable.id, id));
  if (!existing) {
    res.status(204).send();
    return;
  }
  if (!canMutateScopedResource(existing.areaOperativaId, callerAreaOperativaId(req))) {
    res.status(403).json({ error: "Zona non modificabile per il tuo profilo" });
    return;
  }
  await db.update(zoneUdsTable).set({ attivo: false }).where(eq(zoneUdsTable.id, id));
  res.status(204).send();
});

export default router;
