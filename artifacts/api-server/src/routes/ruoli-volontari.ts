import { Router, type IRouter } from "express";
import { db, ruoliVolontariTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateRuoloVolontarioBody,
  UpdateRuoloVolontarioBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function fmt(r: typeof ruoliVolontariTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    attivo: r.attivo,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// Volunteer roles are a GLOBAL configurable lookup (no città/centro scoping),
// readable by logistica staff (to fill the volontari form) and editable only by
// admins (mutations are guarded with requireAdmin).
router.get("/ruoli-volontari", async (_req, res) => {
  const rows = await db
    .select()
    .from(ruoliVolontariTable)
    .orderBy(ruoliVolontariTable.nome);
  res.json(rows.map(fmt));
});

router.post("/ruoli-volontari", requireAdmin, async (req, res) => {
  const parsed = CreateRuoloVolontarioBody.parse(req.body);
  const nome = parsed.nome.trim();
  if (!nome) {
    res.status(400).json({ error: "Nome obbligatorio" });
    return;
  }
  const [existing] = await db
    .select({ id: ruoliVolontariTable.id })
    .from(ruoliVolontariTable)
    .where(eq(ruoliVolontariTable.nome, nome));
  if (existing) {
    res.status(409).json({ error: "Ruolo già esistente" });
    return;
  }
  const [row] = await db
    .insert(ruoliVolontariTable)
    .values({ ...parsed, nome })
    .returning();
  res.status(201).json(fmt(row));
});

router.patch("/ruoli-volontari/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const parsed = UpdateRuoloVolontarioBody.parse(req.body);
  const updates: Partial<typeof ruoliVolontariTable.$inferInsert> = { ...parsed };
  if (typeof updates.nome === "string") {
    updates.nome = updates.nome.trim();
    if (!updates.nome) {
      res.status(400).json({ error: "Nome obbligatorio" });
      return;
    }
    const [clash] = await db
      .select({ id: ruoliVolontariTable.id })
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.nome, updates.nome));
    if (clash && clash.id !== id) {
      res.status(409).json({ error: "Ruolo già esistente" });
      return;
    }
  }
  const [row] = await db
    .update(ruoliVolontariTable)
    .set(updates)
    .where(eq(ruoliVolontariTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/ruoli-volontari/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // `volontari.ruolo` stores the role NAME as free text (no FK), so removing a
  // role simply retires the option; existing volunteers keep their stored value.
  await db.delete(ruoliVolontariTable).where(eq(ruoliVolontariTable.id, id));
  res.status(204).send();
});

export default router;
