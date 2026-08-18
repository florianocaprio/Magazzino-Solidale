import { Router, type IRouter } from "express";
import { db, zoneUdsTable, cittaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateZonaUdsBody, UpdateZonaUdsBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import { callerCittaId, canAccessCitta } from "../lib/centroScope";
import { canMutateScopedResource } from "../lib/adminScope";
import { requireModulo } from "../lib/featureFlags";
import { UNITA_STRADA_DISABLED_MSG, isUnitaStradaEnabled } from "../lib/impostazioniModuli";

const router: IRouter = Router();

router.use("/zone-uds", requireModulo("UDS"));

type ZonaRow = typeof zoneUdsTable.$inferSelect;

function fmt(r: ZonaRow, cittaNome: string | null = null) {
  return {
    id: r.id,
    cittaId: r.cittaId,
    cittaNome,
    nome: r.nome,
    attivo: r.attivo,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// Zones belong to a città (HARD boundary). A città-scoped caller sees only the
// zones of their own città; a global caller sees all (optionally filtered by
// the cittaId query param).
router.get("/zone-uds", async (req, res) => {
  const cittaId = callerCittaId(req);
  const queryCitta = req.query.cittaId ? Number(req.query.cittaId) : null;
  if (queryCitta != null && (!Number.isInteger(queryCitta) || queryCitta <= 0)) {
    res.status(400).json({ error: "Area non valida" });
    return;
  }
  const effectiveCitta = cittaId ?? queryCitta;

  const rows = effectiveCitta == null ? await db.select({ z: zoneUdsTable, cittaNome: cittaTable.nome }).from(zoneUdsTable).leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id)).orderBy(zoneUdsTable.nome) : await db.select({ z: zoneUdsTable, cittaNome: cittaTable.nome }).from(zoneUdsTable).leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id)).where(eq(zoneUdsTable.cittaId, effectiveCitta)).orderBy(zoneUdsTable.nome);

  res.json(rows.map((r) => fmt(r.z, r.cittaNome ?? null)));
});

router.get("/zone-uds/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [row] = await db.select({ z: zoneUdsTable, cittaNome: cittaTable.nome }).from(zoneUdsTable).leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id)).where(eq(zoneUdsTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessCitta(row.z.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Zona non accessibile per il tuo profilo" });
    return;
  }
  res.json(fmt(row.z, row.cittaNome ?? null));
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
  const callerAreaId = callerCittaId(req);
  if (!canMutateScopedResource(parsed.data.cittaId, callerAreaId)) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const [area] = await db.select({ id: cittaTable.id, attivo: cittaTable.attivo }).from(cittaTable).where(eq(cittaTable.id, parsed.data.cittaId));
  if (!area || !area.attivo) {
    res.status(400).json({ error: "L'Area selezionata non è disponibile" });
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
  const callerAreaId = callerCittaId(req);
  if (!canMutateScopedResource(existing.cittaId, callerAreaId)) {
    res.status(403).json({ error: "Zona non modificabile per il tuo profilo" });
    return;
  }
  const parsed = UpdateZonaUdsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica zona UDS non valida" });
    return;
  }
  if (parsed.data.cittaId !== undefined && !canMutateScopedResource(parsed.data.cittaId, callerAreaId)) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  if (parsed.data.cittaId !== undefined) {
    const [area] = await db.select({ id: cittaTable.id, attivo: cittaTable.attivo }).from(cittaTable).where(eq(cittaTable.id, parsed.data.cittaId));
    if (!area || !area.attivo) {
      res.status(400).json({ error: "L'Area selezionata non è disponibile" });
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
  if (!canMutateScopedResource(existing.cittaId, callerCittaId(req))) {
    res.status(403).json({ error: "Zona non modificabile per il tuo profilo" });
    return;
  }
  await db.update(zoneUdsTable).set({ attivo: false }).where(eq(zoneUdsTable.id, id));
  res.status(204).send();
});

export default router;
