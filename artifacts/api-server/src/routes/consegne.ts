import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { consegneTable, beneficiariTable, magazziniTable, volontariTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/consegne", async (req, res) => {
  const { stato, data, beneficiarioId } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(consegneTable.stato, stato));
  if (beneficiarioId) conditions.push(eq(consegneTable.beneficiarioId, parseInt(beneficiarioId)));

  const rows = await db
    .select({
      c: consegneTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      magazzinoNome: magazziniTable.nome,
      volNome: volontariTable.nome,
      volCognome: volontariTable.cognome,
    })
    .from(consegneTable)
    .leftJoin(beneficiariTable, eq(consegneTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(consegneTable.magazzinoId, magazziniTable.id))
    .leftJoin(volontariTable, eq(consegneTable.volontarioId, volontariTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(consegneTable.dataPrevista))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.c.id,
    codice: r.c.codice,
    beneficiarioId: r.c.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    tipoConsegna: r.c.tipoConsegna,
    dataPrevista: r.c.dataPrevista,
    fasciaOraria: r.c.fasciaOraria ?? null,
    indirizzoConsegna: r.c.indirizzoConsegna ?? null,
    zona: r.c.zona ?? null,
    magazzinoId: r.c.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    volontarioId: r.c.volontarioId ?? null,
    volontarioNome: r.volNome && r.volCognome ? `${r.volCognome} ${r.volNome}` : null,
    mezzoId: r.c.mezzoId ?? null,
    stato: r.c.stato,
    noteOperative: r.c.noteOperative ?? null,
    dataEffettuata: r.c.dataEffettuata?.toISOString() ?? null,
    dataCreazione: r.c.dataCreazione.toISOString(),
  })));
});

router.post("/consegne", async (req, res) => {
  const body = req.body;
  const codice = `CON-${Date.now()}`;
  const [row] = await db.insert(consegneTable).values({ ...body, codice }).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/consegne/:id", async (req, res) => {
  const [row] = await db.select().from(consegneTable).where(eq(consegneTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/consegne/:id", async (req, res) => {
  const [row] = await db.update(consegneTable).set(req.body).where(eq(consegneTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.post("/consegne/:id/completa", async (req, res) => {
  const [row] = await db.update(consegneTable)
    .set({ stato: "effettuata", dataEffettuata: new Date() })
    .where(eq(consegneTable.id, parseInt(req.params.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
