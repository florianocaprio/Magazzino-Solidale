import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { movimentiTable, prodottiTable, magazziniTable } from "@workspace/db";
import { eq, and, gte, lte, desc, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();

router.get("/movimenti", requirePermission("magazzino.view"), async (req, res) => {
  const { tipo, magazzinoId, prodottoId, centroAscoltoId, da, a } = req.query as Record<string, string>;
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e limit tra 1 e 100" });
    return;
  }
  for (const [name, raw] of [["magazzinoId", magazzinoId], ["prodottoId", prodottoId], ["centroAscoltoId", centroAscoltoId]] as const) {
    if (raw != null && (!Number.isSafeInteger(Number(raw)) || Number(raw) <= 0)) {
      res.status(400).json({ error: `${name} non valido` });
      return;
    }
  }
  const conditions: SQL[] = [];
  if (tipo) conditions.push(eq(movimentiTable.tipoMovimento, tipo));
  if (magazzinoId) conditions.push(eq(movimentiTable.magazzinoId, parseInt(magazzinoId)));
  if (prodottoId) conditions.push(eq(movimentiTable.prodottoId, parseInt(prodottoId)));
  if (centroAscoltoId) conditions.push(eq(magazziniTable.centroAscoltoId, parseInt(centroAscoltoId)));
  if (da) conditions.push(gte(movimentiTable.dataMovimento, da));
  if (a) conditions.push(lte(movimentiTable.dataMovimento, a));
  const scope = magazzinoScopeFilter(movimentiTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req), callerCittaId(req)));
  if (scope) conditions.push(scope);

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(movimentiTable)
    .leftJoin(magazziniTable, eq(movimentiTable.magazzinoId, magazziniTable.id))
    .where(where);
  const rows = await db
    .select({
      mov: movimentiTable,
      prodottoNome: prodottiTable.nome,
      magazzinoNome: magazziniTable.nome,
    })
    .from(movimentiTable)
    .leftJoin(prodottiTable, eq(movimentiTable.prodottoId, prodottiTable.id))
    .leftJoin(magazziniTable, eq(movimentiTable.magazzinoId, magazziniTable.id))
    .where(where)
    .orderBy(desc(movimentiTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
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
    movimentoOrigineId: r.mov.movimentoOrigineId ?? null,
    operatoreId: r.mov.operatoreId ?? null,
    documentoRiferimento: r.mov.documentoRiferimento ?? null,
    note: r.mov.note ?? null,
    dataCreazione: r.mov.dataCreazione.toISOString(),
  })));
});

router.post("/movimenti", requirePermission("magazzino.stock.adjust"), (_req, res) => {
  res.status(405).json({
    error: "Il giornale Movimenti è append-only: usa Carico, Scarico, Trasferimento o Rettifica",
  });
});

export default router;
