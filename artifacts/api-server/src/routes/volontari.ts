import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { volontariTable, centriAscoltoTable } from "@workspace/db";
import { eq, getTableColumns } from "drizzle-orm";

const router: IRouter = Router();

type VolontarioRow = typeof volontariTable.$inferSelect & {
  centroAscoltoNome: string | null;
};

const fmt = (r: VolontarioRow) => ({
  id: r.id,
  nome: r.nome,
  cognome: r.cognome,
  centroAscoltoId: r.centroAscoltoId ?? null,
  centroAscoltoNome: r.centroAscoltoNome ?? null,
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

const selectVolontario = () =>
  db
    .select({
      ...getTableColumns(volontariTable),
      centroAscoltoNome: centriAscoltoTable.nome,
    })
    .from(volontariTable)
    .leftJoin(centriAscoltoTable, eq(volontariTable.centroAscoltoId, centriAscoltoTable.id));

router.get("/volontari", async (_req, res) => {
  const rows = await selectVolontario().orderBy(volontariTable.cognome);
  res.json(rows.map(fmt));
});

router.post("/volontari", async (req, res) => {
  const [created] = await db.insert(volontariTable).values(req.body).returning({ id: volontariTable.id });
  const [row] = await selectVolontario().where(eq(volontariTable.id, created.id));
  res.status(201).json(fmt(row));
});

router.get("/volontari/:id", async (req, res) => {
  const [row] = await selectVolontario().where(eq(volontariTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(fmt(row));
});

router.patch("/volontari/:id", async (req, res) => {
  const [updated] = await db.update(volontariTable).set(req.body).where(eq(volontariTable.id, parseInt(req.params.id))).returning({ id: volontariTable.id });
  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  const [row] = await selectVolontario().where(eq(volontariTable.id, updated.id));
  res.json(fmt(row));
});

router.delete("/volontari/:id", async (req, res) => {
  await db.delete(volontariTable).where(eq(volontariTable.id, parseInt(req.params.id)));
  res.status(204).send();
});

export default router;
