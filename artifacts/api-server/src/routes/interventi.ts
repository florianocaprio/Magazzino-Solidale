import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { interventiTable, beneficiariTable } from "@workspace/db";
import { eq, and, desc, or, ilike, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/interventi", async (req, res) => {
  const { beneficiarioId, tipo } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (beneficiarioId) conditions.push(eq(interventiTable.beneficiarioId, parseInt(beneficiarioId)));
  // tipoIntervento può essere una lista di etichette separate da virgola
  // (es. "pacco_alimentare,igiene"): il filtro deve trovare anche i valori multipli
  if (tipo) {
    const tokenMatch = or(
      eq(interventiTable.tipoIntervento, tipo),
      ilike(interventiTable.tipoIntervento, `${tipo},%`),
      ilike(interventiTable.tipoIntervento, `%,${tipo}`),
      ilike(interventiTable.tipoIntervento, `%,${tipo},%`),
    );
    if (tokenMatch) conditions.push(tokenMatch);
  }

  const rows = await db
    .select({
      i: interventiTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
    })
    .from(interventiTable)
    .leftJoin(beneficiariTable, eq(interventiTable.beneficiarioId, beneficiariTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(interventiTable.dataIntervento))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.i.id,
    beneficiarioId: r.i.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    dataIntervento: r.i.dataIntervento,
    tipoIntervento: r.i.tipoIntervento,
    descrizione: r.i.descrizione ?? null,
    esito: r.i.esito ?? null,
    prossimAzione: r.i.prossimAzione ?? null,
    dataFollowup: r.i.dataFollowup ?? null,
    dataCreazione: r.i.dataCreazione.toISOString(),
  })));
});

router.post("/interventi", async (req, res) => {
  const [row] = await db.insert(interventiTable).values(req.body).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/interventi/:id", async (req, res) => {
  const [row] = await db.select().from(interventiTable).where(eq(interventiTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/interventi/:id", async (req, res) => {
  const [row] = await db.update(interventiTable).set(req.body).where(eq(interventiTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
