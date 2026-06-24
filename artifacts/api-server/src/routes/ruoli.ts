import { Router, type IRouter } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, ruoliTable, utentiTable } from "@workspace/db";
import { CreateRuoloBody, UpdateRuoloBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { ALL_AREA_KEYS } from "../lib/areas";

const router: IRouter = Router();

router.use("/ruoli", requireAuth, requireAdmin);

const fmt = (r: typeof ruoliTable.$inferSelect) => ({
  id: r.id,
  nome: r.nome,
  descrizione: r.descrizione ?? null,
  aree: r.aree ?? [],
  isAdmin: r.isAdmin,
  dataCreazione: r.dataCreazione.toISOString(),
});

function sanitizeAree(aree: string[] | undefined): string[] {
  if (!aree) return [];
  return aree.filter((a) => ALL_AREA_KEYS.includes(a));
}

async function roleHasActiveUsers(ruoloId: number): Promise<boolean> {
  const rows = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(and(eq(utentiTable.ruoloId, ruoloId), eq(utentiTable.attivo, true)));
  return rows.length > 0;
}

async function otherActiveAdminViaOtherRole(
  excludeRoleId: number,
): Promise<boolean> {
  const rows = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .innerJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(
      and(
        eq(utentiTable.attivo, true),
        eq(ruoliTable.isAdmin, true),
        ne(ruoliTable.id, excludeRoleId),
      ),
    );
  return rows.length > 0;
}

router.get("/ruoli", async (_req, res): Promise<void> => {
  const rows = await db.select().from(ruoliTable).orderBy(ruoliTable.nome);
  res.json(rows.map(fmt));
});

router.post("/ruoli", async (req, res): Promise<void> => {
  const parsed = CreateRuoloBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { nome, descrizione, aree, isAdmin } = parsed.data;

  const [existing] = await db
    .select({ id: ruoliTable.id })
    .from(ruoliTable)
    .where(eq(ruoliTable.nome, nome));
  if (existing) {
    res.status(409).json({ error: "Nome ruolo già esistente" });
    return;
  }

  const [row] = await db
    .insert(ruoliTable)
    .values({
      nome,
      descrizione: descrizione ?? null,
      aree: sanitizeAree(aree),
      isAdmin: isAdmin ?? false,
    })
    .returning();
  res.status(201).json(fmt(row));
});

router.get("/ruoli/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );
  const [row] = await db.select().from(ruoliTable).where(eq(ruoliTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Ruolo non trovato" });
    return;
  }
  res.json(fmt(row));
});

router.patch("/ruoli/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );
  const parsed = UpdateRuoloBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const body = parsed.data;

  const [current] = await db
    .select()
    .from(ruoliTable)
    .where(eq(ruoliTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Ruolo non trovato" });
    return;
  }

  if (body.isAdmin === false && current.isAdmin) {
    if (
      (await roleHasActiveUsers(id)) &&
      !(await otherActiveAdminViaOtherRole(id))
    ) {
      res.status(409).json({
        error: "Deve restare almeno un amministratore attivo",
      });
      return;
    }
  }

  const updates: Partial<typeof ruoliTable.$inferInsert> = {};
  if (body.nome !== undefined) updates.nome = body.nome;
  if (body.descrizione !== undefined)
    updates.descrizione = body.descrizione ?? null;
  if (body.aree !== undefined) updates.aree = sanitizeAree(body.aree);
  if (body.isAdmin !== undefined) updates.isAdmin = body.isAdmin;

  const [row] = await db
    .update(ruoliTable)
    .set(updates)
    .where(eq(ruoliTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Ruolo non trovato" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/ruoli/:id", async (req, res): Promise<void> => {
  const id = parseInt(
    Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    10,
  );

  const [inUse] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .where(eq(utentiTable.ruoloId, id));
  if (inUse) {
    res
      .status(409)
      .json({ error: "Ruolo ancora assegnato a uno o più utenti" });
    return;
  }

  const [row] = await db
    .delete(ruoliTable)
    .where(eq(ruoliTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Ruolo non trovato" });
    return;
  }
  res.status(204).send();
});

export default router;
