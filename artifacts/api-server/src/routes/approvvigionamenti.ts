import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { approvvigionamentiTable, approvvigionamentoRigheTable, fornitoriTable, prodottiTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";

const router: IRouter = Router();

async function getWithRighe(id: number) {
  const [a] = await db.select({
    a: approvvigionamentiTable,
    fornitoreNome: fornitoriTable.nome,
  })
    .from(approvvigionamentiTable)
    .leftJoin(fornitoriTable, eq(approvvigionamentiTable.fornitoreId, fornitoriTable.id))
    .where(eq(approvvigionamentiTable.id, id));
  if (!a) return null;

  const righe = await db.select({
    r: approvvigionamentoRigheTable,
    prodottoNome: prodottiTable.nome,
  })
    .from(approvvigionamentoRigheTable)
    .leftJoin(prodottiTable, eq(approvvigionamentoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(approvvigionamentoRigheTable.approvvigionamentoId, id));

  return {
    id: a.a.id,
    codice: a.a.codice,
    fornitoreId: a.a.fornitoreId ?? null,
    fornitoreNome: a.fornitoreNome ?? null,
    dataRichiesta: a.a.dataRichiesta,
    dataPrevista: a.a.dataPrevista ?? null,
    stato: a.a.stato,
    note: a.a.note ?? null,
    righe: righe.map(r => ({
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      quantitaRichiesta: parseFloat(r.r.quantitaRichiesta),
      quantitaRicevuta: parseFloat(r.r.quantitaRicevuta ?? "0"),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
    dataCreazione: a.a.dataCreazione.toISOString(),
  };
}

router.get("/approvvigionamenti", async (req, res) => {
  const { stato } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(approvvigionamentiTable.stato, stato));

  const rows = await db
    .select({
      a: approvvigionamentiTable,
      fornitoreNome: fornitoriTable.nome,
    })
    .from(approvvigionamentiTable)
    .leftJoin(fornitoriTable, eq(approvvigionamentiTable.fornitoreId, fornitoriTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(approvvigionamentiTable.dataCreazione))
    .limit(100);

  res.json(rows.map(r => ({
    id: r.a.id,
    codice: r.a.codice,
    fornitoreId: r.a.fornitoreId ?? null,
    fornitoreNome: r.fornitoreNome ?? null,
    dataRichiesta: r.a.dataRichiesta,
    dataPrevista: r.a.dataPrevista ?? null,
    stato: r.a.stato,
    note: r.a.note ?? null,
    righe: [],
    dataCreazione: r.a.dataCreazione.toISOString(),
  })));
});

router.post("/approvvigionamenti", async (req, res) => {
  const body = req.body;
  const codice = `APP-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const [a] = await db.insert(approvvigionamentiTable).values({
    codice,
    fornitoreId: body.fornitoreId,
    dataRichiesta: body.dataRichiesta,
    dataPrevista: body.dataPrevista,
    stato: "bozza",
    note: body.note,
  }).returning();

  if (body.righe?.length) {
    await db.insert(approvvigionamentoRigheTable).values(
      body.righe.map((r: { prodottoId: number; quantitaRichiesta: number; unitaMisura: string; note?: string }) => ({
        approvvigionamentoId: a.id,
        prodottoId: r.prodottoId,
        quantitaRichiesta: r.quantitaRichiesta.toString(),
        quantitaRicevuta: "0",
        unitaMisura: r.unitaMisura,
        note: r.note,
      }))
    );
  }

  const result = await getWithRighe(a.id);
  res.status(201).json(result);
});

router.get("/approvvigionamenti/:id", async (req, res) => {
  const result = await getWithRighe(parseInt(req.params.id));
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result);
});

router.patch("/approvvigionamenti/:id", async (req, res) => {
  const [row] = await db.update(approvvigionamentiTable).set(req.body).where(eq(approvvigionamentiTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getWithRighe(row.id);
  res.json(result);
});

export default router;
