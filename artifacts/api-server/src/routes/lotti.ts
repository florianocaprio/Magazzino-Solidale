import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { lottiTable, prodottiTable, magazziniTable, fornitoriTable } from "@workspace/db";
import { eq, and, lte, gt, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  callerCentroId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
} from "../lib/centroScope";

const router: IRouter = Router();

router.get("/lotti", async (req, res) => {
  const { prodottoId, magazzinoId, inScadenza } = req.query as Record<string, string>;
  const conditions: SQL[] = [gt(lottiTable.quantitaResidua, "0")];
  if (prodottoId) conditions.push(eq(lottiTable.prodottoId, parseInt(prodottoId)));
  if (magazzinoId) conditions.push(eq(lottiTable.magazzinoId, parseInt(magazzinoId)));
  const scope = magazzinoScopeFilter(lottiTable.magazzinoId, await visibleMagazzinoIds(callerCentroId(req)));
  if (scope) conditions.push(scope);
  if (inScadenza === "true") {
    const in30 = new Date();
    in30.setDate(in30.getDate() + 30);
    conditions.push(lte(lottiTable.dataScadenza, in30.toISOString().split("T")[0]));
  }

  const rows = await db
    .select({
      lotto: lottiTable,
      prodottoNome: prodottiTable.nome,
      magazzinoNome: magazziniTable.nome,
      fornitoreNome: fornitoriTable.nome,
    })
    .from(lottiTable)
    .leftJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
    .leftJoin(magazziniTable, eq(lottiTable.magazzinoId, magazziniTable.id))
    .leftJoin(fornitoriTable, eq(lottiTable.fornitoreId, fornitoriTable.id))
    .where(and(...conditions))
    .orderBy(lottiTable.dataScadenza);

  res.json(rows.map(r => ({
    id: r.lotto.id,
    prodottoId: r.lotto.prodottoId,
    prodottoNome: r.prodottoNome ?? null,
    codiceLotto: r.lotto.codiceLotto ?? null,
    dataScadenza: r.lotto.dataScadenza ?? null,
    dataCarico: r.lotto.dataCarico,
    quantitaCaricata: parseFloat(r.lotto.quantitaCaricata),
    quantitaResidua: parseFloat(r.lotto.quantitaResidua),
    magazzinoId: r.lotto.magazzinoId,
    magazzinoNome: r.magazzinoNome ?? null,
    fornitoreId: r.lotto.fornitoreId ?? null,
    fornitoreNome: r.fornitoreNome ?? null,
    fsePlus: r.lotto.fsePlus,
    documentoCarico: r.lotto.documentoCarico ?? null,
    note: r.lotto.note ?? null,
    dataCreazione: r.lotto.dataCreazione.toISOString(),
  })));
});

router.post("/lotti", async (req, res) => {
  const body = req.body;
  const ids = await visibleMagazzinoIds(callerCentroId(req));
  if (ids != null && !ids.includes(body.magazzinoId)) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const fsePlus = body.fsePlus ?? false;
  if (fsePlus && body.fornitoreId != null) {
    res.status(400).json({ error: "Un lotto FSE+ non può avere anche un fornitore" });
    return;
  }
  if (!fsePlus && body.fornitoreId == null) {
    res.status(400).json({ error: "Specificare la provenienza del lotto: FSE+ o un fornitore" });
    return;
  }
  const [row] = await db.insert(lottiTable).values({
    prodottoId: body.prodottoId,
    codiceLotto: body.codiceLotto,
    dataScadenza: body.dataScadenza,
    dataCarico: body.dataCarico,
    quantitaCaricata: body.quantitaCaricata.toString(),
    quantitaResidua: body.quantitaCaricata.toString(),
    magazzinoId: body.magazzinoId,
    fornitoreId: body.fornitoreId,
    fsePlus: body.fsePlus ?? false,
    documentoCarico: body.documentoCarico,
    note: body.note,
  }).returning();
  res.status(201).json({ ...row, quantitaCaricata: parseFloat(row.quantitaCaricata), quantitaResidua: parseFloat(row.quantitaResidua), dataCreazione: row.dataCreazione.toISOString() });
});

router.get("/lotti/:id", async (req, res) => {
  const [row] = await db.select().from(lottiTable).where(eq(lottiTable.id, parseInt(req.params.id)));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const ids = await visibleMagazzinoIds(callerCentroId(req));
  if (ids != null && !ids.includes(row.magazzinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  res.json({ ...row, quantitaCaricata: parseFloat(row.quantitaCaricata), quantitaResidua: parseFloat(row.quantitaResidua), dataCreazione: row.dataCreazione.toISOString() });
});

router.patch("/lotti/:id", async (req, res) => {
  const body = req.body;
  const id = parseInt(req.params.id);
  const [existing] = await db.select().from(lottiTable).where(eq(lottiTable.id, id));
  if (!existing) { res.status(404).json({ error: "Not found" }); return; }
  const ids = await visibleMagazzinoIds(callerCentroId(req));
  if (ids != null && !ids.includes(existing.magazzinoId)) {
    res.status(403).json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (ids != null && body.magazzinoId != null && body.magazzinoId !== existing.magazzinoId
      && !ids.includes(body.magazzinoId)) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo centro" });
    return;
  }
  const update: Record<string, unknown> = { ...body };
  if (body.quantitaResidua !== undefined) update.quantitaResidua = body.quantitaResidua.toString();
  const [row] = await db.update(lottiTable).set(update).where(eq(lottiTable.id, id)).returning();
  res.json({ ...row, quantitaCaricata: parseFloat(row.quantitaCaricata), quantitaResidua: parseFloat(row.quantitaResidua), dataCreazione: row.dataCreazione.toISOString() });
});

export default router;
