import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { movimentiTable, prodottiTable, magazziniTable } from "@workspace/db";
import { eq, and, gte, lte, desc, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
  canAccessMagazzino,
} from "../lib/centroScope";

const router: IRouter = Router();

router.get("/movimenti", async (req, res) => {
  const { tipo, magazzinoId, prodottoId, centroAscoltoId, da, a } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (tipo) conditions.push(eq(movimentiTable.tipoMovimento, tipo));
  if (magazzinoId) conditions.push(eq(movimentiTable.magazzinoId, parseInt(magazzinoId)));
  if (prodottoId) conditions.push(eq(movimentiTable.prodottoId, parseInt(prodottoId)));
  if (centroAscoltoId) conditions.push(eq(magazziniTable.centroAscoltoId, parseInt(centroAscoltoId)));
  if (da) conditions.push(gte(movimentiTable.dataMovimento, da));
  if (a) conditions.push(lte(movimentiTable.dataMovimento, a));
  const scope = magazzinoScopeFilter(movimentiTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req), callerCittaId(req)));
  if (scope) conditions.push(scope);

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
  if (!(await canAccessMagazzino(body.magazzinoId, callerCentroId(req), callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }
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
