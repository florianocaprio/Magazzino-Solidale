import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { movimentiTable, prodottiTable, magazziniTable } from "@workspace/db";
import { eq, and, desc, type SQL } from "drizzle-orm";

const router: IRouter = Router();

router.get("/movimenti", async (req, res) => {
  const { tipo, magazzinoId, prodottoId } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (tipo) conditions.push(eq(movimentiTable.tipoMovimento, tipo));
  if (magazzinoId) conditions.push(eq(movimentiTable.magazzinoId, parseInt(magazzinoId)));
  if (prodottoId) conditions.push(eq(movimentiTable.prodottoId, parseInt(prodottoId)));

  const rows = await db
    .select({
      mov: movimentiTable,
      prodottoNome: prodottiTable.nome,
      magazzinoNome: magazziniTable.nome,
    })
    .from(movimentiTable)
    .leftJoin(prodottiTable, eq(movimentiTable.prodottoId, prodottiTable.id))
    .leftJoin(magazziniTable, eq(movimentiTable.magazzinoId, magazziniTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(movimentiTable.dataCreazione))
    .limit(200);

  res.json(rows.map(r => ({
    id: r.mov.id,
    tipoMovimento: r.mov.tipoMovimento,
    tipoDettaglio: r.mov.tipoDettaglio,
    dataMovimento: r.mov.dataMovimento,
    magazzinoId: r.mov.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    prodottoId: r.mov.prodottoId,
    prodottoNome: r.prodottoNome ?? null,
    lottoId: r.mov.lottoId ?? null,
    quantita: parseFloat(r.mov.quantita),
    unitaMisura: r.mov.unitaMisura,
    fornitoreId: r.mov.fornitoreId ?? null,
    beneficiarioId: r.mov.beneficiarioId ?? null,
    documentoRiferimento: r.mov.documentoRiferimento ?? null,
    note: r.mov.note ?? null,
    dataCreazione: r.mov.dataCreazione.toISOString(),
  })));
});

router.post("/movimenti", async (req, res) => {
  const body = req.body;
  const [row] = await db.insert(movimentiTable).values({
    tipoMovimento: body.tipoMovimento,
    tipoDettaglio: body.tipoDettaglio,
    dataMovimento: body.dataMovimento,
    magazzinoId: body.magazzinoId,
    prodottoId: body.prodottoId,
    lottoId: body.lottoId,
    quantita: body.quantita.toString(),
    unitaMisura: body.unitaMisura,
    fornitoreId: body.fornitoreId,
    beneficiarioId: body.beneficiarioId,
    documentoRiferimento: body.documentoRiferimento,
    note: body.note,
  }).returning();
  res.status(201).json({ ...row, quantita: parseFloat(row.quantita), dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
