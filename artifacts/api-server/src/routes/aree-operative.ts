import { Router, type IRouter } from "express";
import { db, areeOperativeTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateAreaOperativaBody, UpdateAreaOperativaBody } from "@workspace/api-zod";
import { callerAreaOperativaId } from "../lib/centroScope";
import { requireGlobalAdmin } from "../lib/adminScope";

const router: IRouter = Router();

function fmt(r: typeof areeOperativeTable.$inferSelect) {
  return {
    id: r.id,
    nome: r.nome,
    provincia: r.provincia ?? null,
    sigla: r.sigla ?? null,
    attivo: r.attivo,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  };
}

// L'Area (tabella legacy `areaOperativa`) è un confine rigido: un caller scoped vede solo la propria.
router.get("/aree-operative", async (req, res) => {
  const areaOperativaId = callerAreaOperativaId(req);
  const rows =
    areaOperativaId == null
      ? await db.select().from(areeOperativeTable).orderBy(areeOperativeTable.nome)
      : await db
          .select()
          .from(areeOperativeTable)
          .where(eq(areeOperativeTable.id, areaOperativaId))
          .orderBy(areeOperativeTable.nome);
  res.json(rows.map(fmt));
});

router.get("/aree-operative/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const areaOperativaId = callerAreaOperativaId(req);
  if (areaOperativaId != null && areaOperativaId !== id) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const [row] = await db.select().from(areeOperativeTable).where(eq(areeOperativeTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.post("/aree-operative", requireGlobalAdmin, async (req, res) => {
  const result = CreateAreaOperativaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Inserimento area non valido" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db.insert(areeOperativeTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.patch("/aree-operative/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const result = UpdateAreaOperativaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Modifica area non valida" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db
    .update(areeOperativeTable)
    .set(values)
    .where(eq(areeOperativeTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/aree-operative/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [row] = await db
    .update(areeOperativeTable)
    .set({ attivo: false })
    .where(eq(areeOperativeTable.id, id))
    .returning({ id: areeOperativeTable.id });
  if (!row) {
    res.status(404).json({ error: "Area non trovata" });
    return;
  }
  res.status(204).send();
});

export default router;
