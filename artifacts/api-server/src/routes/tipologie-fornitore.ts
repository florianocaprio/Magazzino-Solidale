import { Router, type IRouter } from "express";
import { db, tipologieFornitoreTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateTipologiaFornitoreBody,
  UpdateTipologiaFornitoreBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function fmt(r: typeof tipologieFornitoreTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    attivo: r.attivo,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// Supplier types are a GLOBAL configurable lookup (no città/centro scoping),
// readable by logistica staff (to fill the fornitori form) and editable only by
// admins (mutations are guarded with requireAdmin).
router.get("/tipologie-fornitore", async (_req, res) => {
  const rows = await db
    .select()
    .from(tipologieFornitoreTable)
    .orderBy(tipologieFornitoreTable.nome);
  res.json(rows.map(fmt));
});

router.post("/tipologie-fornitore", requireAdmin, async (req, res) => {
  const parsed = CreateTipologiaFornitoreBody.parse(req.body);
  const nome = parsed.nome.trim();
  if (!nome) {
    res.status(400).json({ error: "Nome obbligatorio" });
    return;
  }
  const [existing] = await db
    .select({ id: tipologieFornitoreTable.id })
    .from(tipologieFornitoreTable)
    .where(eq(tipologieFornitoreTable.nome, nome));
  if (existing) {
    res.status(409).json({ error: "Tipologia fornitore già esistente" });
    return;
  }
  const [row] = await db
    .insert(tipologieFornitoreTable)
    .values({ ...parsed, nome })
    .returning();
  res.status(201).json(fmt(row));
});

router.patch("/tipologie-fornitore/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const parsed = UpdateTipologiaFornitoreBody.parse(req.body);
  const updates: Partial<typeof tipologieFornitoreTable.$inferInsert> = { ...parsed };
  if (typeof updates.nome === "string") {
    updates.nome = updates.nome.trim();
    if (!updates.nome) {
      res.status(400).json({ error: "Nome obbligatorio" });
      return;
    }
    const [clash] = await db
      .select({ id: tipologieFornitoreTable.id })
      .from(tipologieFornitoreTable)
      .where(eq(tipologieFornitoreTable.nome, updates.nome));
    if (clash && clash.id !== id) {
      res.status(409).json({ error: "Tipologia fornitore già esistente" });
      return;
    }
  }
  const [row] = await db
    .update(tipologieFornitoreTable)
    .set(updates)
    .where(eq(tipologieFornitoreTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/tipologie-fornitore/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // `fornitori.tipo` stores the type NAME as free text (no FK), so removing a
  // type simply retires the option; existing suppliers keep their stored value.
  await db.delete(tipologieFornitoreTable).where(eq(tipologieFornitoreTable.id, id));
  res.status(204).send();
});

export default router;
