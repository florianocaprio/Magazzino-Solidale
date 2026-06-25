import { Router, type IRouter } from "express";
import {
  db,
  zoneUdsTable,
  cittaTable,
  beneficiariTable,
  utentiTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateZonaUdsBody, UpdateZonaUdsBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";
import { callerCittaId, canAccessCitta } from "../lib/centroScope";

const router: IRouter = Router();

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
  const queryCitta = req.query.cittaId ? parseInt(req.query.cittaId as string) : null;
  const effectiveCitta = cittaId ?? queryCitta;

  const rows = effectiveCitta == null
    ? await db
        .select({ z: zoneUdsTable, cittaNome: cittaTable.nome })
        .from(zoneUdsTable)
        .leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id))
        .orderBy(zoneUdsTable.nome)
    : await db
        .select({ z: zoneUdsTable, cittaNome: cittaTable.nome })
        .from(zoneUdsTable)
        .leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id))
        .where(eq(zoneUdsTable.cittaId, effectiveCitta))
        .orderBy(zoneUdsTable.nome);

  res.json(rows.map((r) => fmt(r.z, r.cittaNome ?? null)));
});

router.get("/zone-uds/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [row] = await db
    .select({ z: zoneUdsTable, cittaNome: cittaTable.nome })
    .from(zoneUdsTable)
    .leftJoin(cittaTable, eq(zoneUdsTable.cittaId, cittaTable.id))
    .where(eq(zoneUdsTable.id, id));
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
  const parsed = CreateZonaUdsBody.parse(req.body);
  const [row] = await db.insert(zoneUdsTable).values(parsed).returning();
  res.status(201).json(fmt(row));
});

router.patch("/zone-uds/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const parsed = UpdateZonaUdsBody.parse(req.body);
  const [row] = await db
    .update(zoneUdsTable)
    .set(parsed)
    .where(eq(zoneUdsTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/zone-uds/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // Clear FK references before deleting (FKs are RESTRICT by default).
  await db
    .update(beneficiariTable)
    .set({ zonaUdsId: null })
    .where(eq(beneficiariTable.zonaUdsId, id));
  await db
    .update(utentiTable)
    .set({ zonaUdsId: null })
    .where(eq(utentiTable.zonaUdsId, id));
  await db.delete(zoneUdsTable).where(eq(zoneUdsTable.id, id));
  res.status(204).send();
});

export default router;
