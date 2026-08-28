import { Router, type IRouter } from "express";
import { db, ruoliVolontariTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  CreateRuoloVolontarioBody,
  UpdateRuoloVolontarioBody,
} from "@workspace/api-zod";
import { requireGlobalAdmin } from "../lib/adminScope";
import { requireModulo } from "../lib/featureFlags";
import { normalizeRoleName } from "../lib/volontariDomain";

const router: IRouter = Router();

router.use("/ruoli-volontari", requireModulo("VOLONTARI"));

function fmt(r: typeof ruoliVolontariTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    nomeNormalizzato: r.nomeNormalizzato ?? normalizeRoleName(r.nome),
    descrizione: r.descrizione ?? null,
    attivo: r.attivo,
    dataCreazione: r.dataCreazione.toISOString(),
    dataAggiornamento: r.dataAggiornamento.toISOString(),
  };
}

// Volunteer roles are a GLOBAL configurable lookup (no area operativa/centro scoping),
// readable by logistica staff (to fill the volontari form) and editable only by
// admins (mutations are guarded with requireAdmin).
router.get("/ruoli-volontari", async (_req, res) => {
  const rows = await db
    .select()
    .from(ruoliVolontariTable)
    .orderBy(ruoliVolontariTable.nome);
  res.json(rows.map(fmt));
});

router.post("/ruoli-volontari", requireGlobalAdmin, async (req, res) => {
  const parsed = CreateRuoloVolontarioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Inserimento ruolo volontario non valido" });
    return;
  }
  const nome = parsed.data.nome.trim();
  if (!nome) {
    res.status(400).json({ error: "Nome obbligatorio" });
    return;
  }
  const nomeNormalizzato = normalizeRoleName(nome);
  const [existing] = await db
    .select({ id: ruoliVolontariTable.id })
    .from(ruoliVolontariTable)
    .where(eq(ruoliVolontariTable.nomeNormalizzato, nomeNormalizzato));
  if (existing) {
    res.status(409).json({ error: "Ruolo già esistente" });
    return;
  }
  const [row] = await db
    .insert(ruoliVolontariTable)
    .values({ ...parsed.data, nome, nomeNormalizzato })
    .returning();
  res.status(201).json(fmt(row));
});

router.patch("/ruoli-volontari/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const parsed = UpdateRuoloVolontarioBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Modifica ruolo volontario non valida" });
    return;
  }
  const updates: Partial<typeof ruoliVolontariTable.$inferInsert> = {
    ...parsed.data,
  };
  if (typeof updates.nome === "string") {
    updates.nome = updates.nome.trim();
    if (!updates.nome) {
      res.status(400).json({ error: "Nome obbligatorio" });
      return;
    }
    const nomeNormalizzato = normalizeRoleName(updates.nome);
    const [clash] = await db
      .select({ id: ruoliVolontariTable.id })
      .from(ruoliVolontariTable)
      .where(eq(ruoliVolontariTable.nomeNormalizzato, nomeNormalizzato));
    if (clash && clash.id !== id) {
      res.status(409).json({ error: "Ruolo già esistente" });
      return;
    }
    updates.nomeNormalizzato = nomeNormalizzato;
  }
  updates.dataAggiornamento = new Date();
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

router.delete("/ruoli-volontari/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  // Il catalogo è referenziato dai nuovi volontari: il delete ordinario ritira
  // l'opzione senza cancellare il ruolo storico o rompere la FK.
  await db
    .update(ruoliVolontariTable)
    .set({ attivo: false })
    .where(eq(ruoliVolontariTable.id, id));
  res.status(204).send();
});

export default router;
