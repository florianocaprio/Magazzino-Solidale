import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { bolleTable, beneficiariTable, magazziniTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/bolle", async (req, res) => {
  const { stato } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(bolleTable.stato, stato));

  const rows = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      magazzinoNome: magazziniTable.nome,
    })
    .from(bolleTable)
    .leftJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(bolleTable.dataCreazione))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.b.id,
    numeroBolla: r.b.numeroBolla,
    dataBolla: r.b.dataBolla,
    beneficiarioId: r.b.beneficiarioId,
    beneficiarioNome: r.cognome && r.nome ? `${r.cognome} ${r.nome}` : null,
    consegnaId: r.b.consegnaId ?? null,
    magazzinoId: r.b.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    indirizzoConsegna: r.b.indirizzoConsegna ?? null,
    volontarioConsegnaId: r.b.volontarioConsegnaId ?? null,
    mezzoId: r.b.mezzoId ?? null,
    stato: r.b.stato,
    noteConsegna: r.b.noteConsegna ?? null,
    confermaRicezione: r.b.confermaRicezione,
    noteRicezione: r.b.noteRicezione ?? null,
    dataCreazione: r.b.dataCreazione.toISOString(),
  })));
});

router.post("/bolle", async (req, res) => {
  const body = req.body;
  const anno = new Date().getFullYear();
  const existing = await db.select({ n: bolleTable.numeroBolla }).from(bolleTable).orderBy(desc(bolleTable.id)).limit(1);
  const lastNum = existing.length > 0 ? parseInt(existing[0].n.split("-").pop() ?? "0") : 0;
  const numeroBolla = `BOLLA-${anno}-${String(lastNum + 1).padStart(4, "0")}`;
  const dataBolla = body.dataBolla ?? new Date().toISOString().split("T")[0];

  const [row] = await db.insert(bolleTable).values({ ...body, numeroBolla, dataBolla }).returning();
  res.status(201).json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/bolle/:id", async (req, res) => {
  const [row] = await db.select().from(bolleTable).where(eq(bolleTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/bolle/:id", async (req, res) => {
  const [row] = await db.update(bolleTable).set(req.body).where(eq(bolleTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json({ ...row, dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
