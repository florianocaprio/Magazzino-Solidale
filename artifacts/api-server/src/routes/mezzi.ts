import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { mezziTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

const fmt = (r: typeof mezziTable.$inferSelect) => ({
  id: r.id,
  codice: r.codice,
  tipo: r.tipo,
  targa: r.targa ?? null,
  proprieta: r.proprieta,
  proprietarioNome: r.proprietarioNome ?? null,
  capacitaColli: r.capacitaColli ?? null,
  capacitaKg: r.capacitaKg ? parseFloat(r.capacitaKg) : null,
  stato: r.stato,
  scadenzaAssicurazione: r.scadenzaAssicurazione ?? null,
  scadenzaRevisione: r.scadenzaRevisione ?? null,
  note: r.note ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

router.get("/mezzi", async (_req, res) => {
  const rows = await db.select().from(mezziTable).orderBy(mezziTable.codice);
  res.json(rows.map(fmt));
});

router.post("/mezzi", async (req, res) => {
  const body = req.body;
  const [row] = await db.insert(mezziTable).values({
    ...body,
    capacitaKg: body.capacitaKg?.toString(),
  }).returning();
  res.status(201).json(fmt(row));
});

router.get("/mezzi/:id", async (req, res) => {
  const [row] = await db.select().from(mezziTable).where(eq(mezziTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.patch("/mezzi/:id", async (req, res) => {
  const body = req.body;
  const update = { ...body, capacitaKg: body.capacitaKg?.toString() };
  const [row] = await db.update(mezziTable).set(update).where(eq(mezziTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.delete("/mezzi/:id", async (req, res) => {
  await db.delete(mezziTable).where(eq(mezziTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
