import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { magazziniTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

router.get("/magazzini", async (_req, res) => {
  const rows = await db.select().from(magazziniTable).orderBy(magazziniTable.nome);
  res.json(rows.map(r => ({
    id: r.id,
    codice: r.codice,
    nome: r.nome,
    indirizzo: r.indirizzo ?? null,
    comune: r.comune ?? null,
    zona: r.zona ?? null,
    responsabile: r.responsabile ?? null,
    telefono: r.telefono ?? null,
    email: r.email ?? null,
    stato: r.stato,
    note: r.note ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  })));
});

router.post("/magazzini", async (req, res) => {
  const body = req.body;
  let codice = typeof body.codice === "string" ? body.codice.trim() : "";
  if (!codice) {
    const rows = await db.select({ codice: magazziniTable.codice }).from(magazziniTable);
    let max = 0;
    for (const r of rows) {
      const m = /^MAG-(\d+)$/.exec(r.codice);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    codice = `MAG-${String(max + 1).padStart(3, "0")}`;
  }
  const [row] = await db.insert(magazziniTable).values({
    codice,
    nome: body.nome,
    indirizzo: body.indirizzo,
    comune: body.comune,
    zona: body.zona,
    responsabile: body.responsabile,
    telefono: body.telefono,
    email: body.email,
    stato: body.stato ?? "attivo",
    note: body.note,
  }).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.update(magazziniTable).set(req.body).where(eq(magazziniTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.delete("/magazzini/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(magazziniTable).where(eq(magazziniTable.id, id));
  res.status(204).send();
});

export default router;
