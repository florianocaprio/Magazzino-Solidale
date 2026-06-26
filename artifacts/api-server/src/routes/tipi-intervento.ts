import { Router, type IRouter } from "express";
import { db, tipiInterventoTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateTipoInterventoBody,
  UpdateTipoInterventoBody,
} from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/auth";

const router: IRouter = Router();

function fmt(r: typeof tipiInterventoTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    attivo: r.attivo,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// Intervention types are a GLOBAL configurable lookup (no città/centro scoping),
// readable by sociale/uds staff (to fill the interventi forms) and editable only
// by admins (mutations are guarded with requireAdmin).
router.get("/tipi-intervento", async (_req, res) => {
  const rows = await db
    .select()
    .from(tipiInterventoTable)
    .orderBy(tipiInterventoTable.nome);
  res.json(rows.map(fmt));
});

router.post("/tipi-intervento", requireAdmin, async (req, res) => {
  const parsed = CreateTipoInterventoBody.parse(req.body);
  const nome = parsed.nome.trim();
  if (!nome) {
    res.status(400).json({ error: "Nome obbligatorio" });
    return;
  }
  const [existing] = await db
    .select({ id: tipiInterventoTable.id })
    .from(tipiInterventoTable)
    .where(eq(tipiInterventoTable.nome, nome));
  if (existing) {
    res.status(409).json({ error: "Tipo di intervento già esistente" });
    return;
  }
  const [row] = await db
    .insert(tipiInterventoTable)
    .values({ ...parsed, nome })
    .returning();
  res.status(201).json(fmt(row));
});

router.patch("/tipi-intervento/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const parsed = UpdateTipoInterventoBody.parse(req.body);
  const updates: Partial<typeof tipiInterventoTable.$inferInsert> = { ...parsed };
  if (typeof updates.nome === "string") {
    updates.nome = updates.nome.trim();
    if (!updates.nome) {
      res.status(400).json({ error: "Nome obbligatorio" });
      return;
    }
    const [clash] = await db
      .select({ id: tipiInterventoTable.id })
      .from(tipiInterventoTable)
      .where(eq(tipiInterventoTable.nome, updates.nome));
    if (clash && clash.id !== id) {
      res.status(409).json({ error: "Tipo di intervento già esistente" });
      return;
    }
  }
  const [row] = await db
    .update(tipiInterventoTable)
    .set(updates)
    .where(eq(tipiInterventoTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/tipi-intervento/:id", requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // `interventi.tipoIntervento` stores the type NAME as free text (no FK), so
  // removing a type simply retires the option; existing interventions keep their
  // stored value.
  await db.delete(tipiInterventoTable).where(eq(tipiInterventoTable.id, id));
  res.status(204).send();
});

export default router;
