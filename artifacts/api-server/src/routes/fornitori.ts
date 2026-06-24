import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { fornitoriTable } from "@workspace/db";
import { eq, or, isNull } from "drizzle-orm";

const router: IRouter = Router();

const fmt = (r: typeof fornitoriTable.$inferSelect) => ({
  id: r.id,
  nome: r.nome,
  tipo: r.tipo,
  partitaIva: r.partitaIva ?? null,
  codiceFiscale: r.codiceFiscale ?? null,
  indirizzo: r.indirizzo ?? null,
  comune: r.comune ?? null,
  telefono: r.telefono ?? null,
  email: r.email ?? null,
  referente: r.referente ?? null,
  siteWeb: r.siteWeb ?? null,
  centroAscoltoId: r.centroAscoltoId ?? null,
  attivo: r.attivo,
  note: r.note ?? null,
  noteOperative: r.noteOperative ?? null,
  dataCreazione: r.dataCreazione.toISOString(),
});

router.get("/fornitori", async (req, res) => {
  const { centroAscoltoId } = req.query as Record<string, string>;
  // Un fornitore associato a un centro è visibile filtrando per quel centro;
  // i fornitori "per tutti i centri" (centroAscoltoId null) sono sempre inclusi.
  const where = centroAscoltoId
    ? or(eq(fornitoriTable.centroAscoltoId, parseInt(centroAscoltoId)), isNull(fornitoriTable.centroAscoltoId))
    : undefined;
  const rows = await db.select().from(fornitoriTable).where(where).orderBy(fornitoriTable.nome);
  res.json(rows.map(fmt));
});

router.post("/fornitori", async (req, res) => {
  const [row] = await db.insert(fornitoriTable).values(req.body).returning();
  res.status(201).json(fmt(row));
});

router.get("/fornitori/:id", async (req, res) => {
  const [row] = await db.select().from(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.patch("/fornitori/:id", async (req, res) => {
  const [row] = await db.update(fornitoriTable).set(req.body).where(eq(fornitoriTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.delete("/fornitori/:id", async (req, res) => {
  await db.delete(fornitoriTable).where(eq(fornitoriTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
