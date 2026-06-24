import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { volontariTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const fmt = (r: typeof volontariTable.$inferSelect) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  ruolo: r.ruolo,
  patente: r.patente,
  mezzoPersonale: r.mezzoPersonale,
  maxConsegneTurno: r.maxConsegneTurno,
  attivo: r.attivo,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

router.get("/volontari", async (_req, res) => {
  const rows = await db.select().from(volontariTable).orderBy(volontariTable.cognome);
  res.json(rows.map(fmt));
});

router.post("/volontari", async (req, res) => {
  const [row] = await db.insert(volontariTable).values(req.body).returning();
  res.status(201).json(fmt(row));
});

router.get("/volontari/:id", async (req, res) => {
  const [row] = await db.select().from(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.patch("/volontari/:id", async (req, res) => {
  const [row] = await db.update(volontariTable).set(req.body).where(eq(volontariTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.delete("/volontari/:id", async (req, res) => {
  await db.delete(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
