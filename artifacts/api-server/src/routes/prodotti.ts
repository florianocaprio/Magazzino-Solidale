import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { prodottiTable } from "@workspace/db";
import { eq, ilike, and, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/prodotti", async (req, res) => {
  const { tipo, search } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (tipo) conditions.push(eq(prodottiTable.tipoProdotto, tipo));
  if (search) conditions.push(ilike(prodottiTable.nome, `%${search}%`));
  const rows = await db.select().from(prodottiTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(prodottiTable.nome);
  res.json(rows.map(r => ({
    id: r.id,
    codice: r.codice,
    nome: r.nome,
    descrizione: r.descrizione ?? null,
    tipoProdotto: r.tipoProdotto,
    unitaMisura: r.unitaMisura,
    codiceBarre: r.codiceBarre ?? null,
    gestioneLotto: r.gestioneLotto,
    gestioneScadenza: r.gestioneScadenza,
    scortaMinima: parseFloat(r.scortaMinima ?? "0"),
    scortaConsigliata: parseFloat(r.scortaConsigliata ?? "0"),
    conservazione: r.conservazione ?? null,
    taglia: r.taglia ?? null,
    genere: r.genere ?? null,
    stagione: r.stagione ?? null,
    condizione: r.condizione ?? null,
    attivo: r.attivo,
    note: r.note ?? null,
    fornitoreId: r.fornitoreId ?? null,
    dataCreazione: r.dataCreazione.toISOString(),
  })));
});

router.post("/prodotti", async (req, res) => {
  const body = req.body;
  const [row] = await db.insert(prodottiTable).values({
    codice: body.codice,
    nome: body.nome,
    descrizione: body.descrizione,
    tipoProdotto: body.tipoProdotto,
    unitaMisura: body.unitaMisura,
    codiceBarre: body.codiceBarre,
    gestioneLotto: body.gestioneLotto ?? false,
    gestioneScadenza: body.gestioneScadenza ?? false,
    scortaMinima: body.scortaMinima?.toString() ?? "0",
    scortaConsigliata: body.scortaConsigliata?.toString() ?? "0",
    conservazione: body.conservazione,
    taglia: body.taglia,
    genere: body.genere,
    stagione: body.stagione,
    condizione: body.condizione,
    attivo: body.attivo ?? true,
    note: body.note,
    fornitoreId: body.fornitoreId,
  }).returning();
  res.status(201).json({ ...row, scortaMinima: parseFloat(row.scortaMinima ?? "0"), scortaConsigliata: parseFloat(row.scortaConsigliata ?? "0"), dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const [row] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, scortaMinima: parseFloat(row.scortaMinima ?? "0"), scortaConsigliata: parseFloat(row.scortaConsigliata ?? "0"), dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  const body = req.body;
  const update: Record<string, unknown> = { ...body };
  if (body.scortaMinima !== undefined) update.scortaMinima = body.scortaMinima.toString();
  if (body.scortaConsigliata !== undefined) update.scortaConsigliata = body.scortaConsigliata.toString();
  const [row] = await db.update(prodottiTable).set(update).where(eq(prodottiTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, scortaMinima: parseFloat(row.scortaMinima ?? "0"), scortaConsigliata: parseFloat(row.scortaConsigliata ?? "0"), dataCreazione: row.dataCreazione.toISOString() });
});

router.delete("/prodotti/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  await db.delete(prodottiTable).where(eq(prodottiTable.id, id));
  res.status(204).send();
});

export default router;
