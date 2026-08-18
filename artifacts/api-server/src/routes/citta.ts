import { Router, type IRouter } from "express";
import { db, cittaTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { CreateCittaBody, UpdateCittaBody } from "@workspace/api-zod";
import { callerCittaId } from "../lib/centroScope";
import { requireGlobalAdmin } from "../lib/adminScope";

const router: IRouter = Router();

function fmt(r: typeof cittaTable.$inferSelect) {
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

// L'Area (tabella legacy `citta`) è un confine rigido: un caller scoped vede solo la propria.
router.get("/citta", async (req, res) => {
  const cittaId = callerCittaId(req);
  const rows =
    cittaId == null
      ? await db.select().from(cittaTable).orderBy(cittaTable.nome)
      : await db
          .select()
          .from(cittaTable)
          .where(eq(cittaTable.id, cittaId))
          .orderBy(cittaTable.nome);
  res.json(rows.map(fmt));
});

router.get("/citta/:id", async (req, res) => {
  const id = parseInt(req.params.id as string);
  const cittaId = callerCittaId(req);
  if (cittaId != null && cittaId !== id) {
    res.status(403).json({ error: "Area non accessibile per il tuo profilo" });
    return;
  }
  const [row] = await db.select().from(cittaTable).where(eq(cittaTable.id, id));
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.post("/citta", requireGlobalAdmin, async (req, res) => {
  const result = CreateCittaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Inserimento area non valido" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db.insert(cittaTable).values(values).returning();
  res.status(201).json(fmt(row));
});

router.patch("/citta/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const result = UpdateCittaBody.safeParse(req.body);
  if (!result.success) {
    res.status(400).json({ error: "Modifica area non valida" });
    return;
  }
  const values = result.data;
  if (values.sigla) values.sigla = values.sigla.toUpperCase();
  const [row] = await db
    .update(cittaTable)
    .set(values)
    .where(eq(cittaTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(fmt(row));
});

router.delete("/citta/:id", requireGlobalAdmin, async (req, res) => {
  const id = parseInt(req.params.id as string);
  const [row] = await db
    .update(cittaTable)
    .set({ attivo: false })
    .where(eq(cittaTable.id, id))
    .returning({ id: cittaTable.id });
  if (!row) {
    res.status(404).json({ error: "Area non trovata" });
    return;
  }
  res.status(204).send();
});

export default router;
