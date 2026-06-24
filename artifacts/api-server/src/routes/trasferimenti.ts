import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { trasferimentiTable, trasferimentoRigheTable, magazziniTable, prodottiTable, lottiTable } from "@workspace/db";
import { eq, and, desc, inArray, type SQL } from "drizzle-orm";

const router: IRouter = Router();

async function getTrasferimentoWithRighe(id: number) {
  const [t] = await db.select({
    t: trasferimentiTable,
    origineNome: magazziniTable.nome,
  })
    .from(trasferimentiTable)
    .leftJoin(magazziniTable, eq(trasferimentiTable.magazzinoOrigineId, magazziniTable.id))
    .where(eq(trasferimentiTable.id, id));
  if (!t) return null;

  const [destRow] = await db.select({ nome: magazziniTable.nome })
    .from(magazziniTable).where(eq(magazziniTable.id, t.t.magazzinoDestinoId));

  const righe = await db.select({
    r: trasferimentoRigheTable,
    prodottoNome: prodottiTable.nome,
  })
    .from(trasferimentoRigheTable)
    .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(trasferimentoRigheTable.trasferimentoId, id));

  return {
    id: t.t.id,
    codice: t.t.codice,
    magazzinoOrigineId: t.t.magazzinoOrigineId,
    magazzinoOrigineNome: t.origineNome ?? null,
    magazzinoDestinoId: t.t.magazzinoDestinoId,
    magazzinoDestinoNome: destRow?.nome ?? null,
    dataRichiesta: t.t.dataRichiesta,
    dataEsecuzione: t.t.dataEsecuzione ?? null,
    dataConfermaRicezione: t.t.dataConfermaRicezione ?? null,
    stato: t.t.stato,
    note: t.t.note ?? null,
    righe: righe.map(r => ({
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      lottoId: r.r.lottoId ?? null,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
    dataCreazione: t.t.dataCreazione.toISOString(),
  };
}

router.get("/trasferimenti", async (req, res) => {
  const { stato } = req.query as Record<string, string>;
  const conditions: SQL[] = [];
  if (stato) conditions.push(eq(trasferimentiTable.stato, stato));

  const rows = await db
    .select()
    .from(trasferimentiTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(trasferimentiTable.dataCreazione))
    .limit(100);

  const magazzini = await db.select({ id: magazziniTable.id, nome: magazziniTable.nome }).from(magazziniTable);
  const magMap = new Map(magazzini.map(m => [m.id, m.nome]));

  const ids = rows.map(r => r.id);
  const righeByT = new Map<number, Array<{
    id: number; prodottoId: number; prodottoNome: string | null;
    lottoId: number | null; quantita: number; unitaMisura: string; note: string | null;
  }>>();
  if (ids.length > 0) {
    const righe = await db.select({
      r: trasferimentoRigheTable,
      prodottoNome: prodottiTable.nome,
    })
      .from(trasferimentoRigheTable)
      .leftJoin(prodottiTable, eq(trasferimentoRigheTable.prodottoId, prodottiTable.id))
      .where(inArray(trasferimentoRigheTable.trasferimentoId, ids));
    for (const x of righe) {
      const arr = righeByT.get(x.r.trasferimentoId) ?? [];
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        lottoId: x.r.lottoId ?? null,
        quantita: parseFloat(x.r.quantita),
        unitaMisura: x.r.unitaMisura,
        note: x.r.note ?? null,
      });
      righeByT.set(x.r.trasferimentoId, arr);
    }
  }

  res.json(rows.map(r => ({
    id: r.id,
    codice: r.codice,
    magazzinoOrigineId: r.magazzinoOrigineId,
    magazzinoOrigineNome: magMap.get(r.magazzinoOrigineId) ?? null,
    magazzinoDestinoId: r.magazzinoDestinoId,
    magazzinoDestinoNome: magMap.get(r.magazzinoDestinoId) ?? null,
    dataRichiesta: r.dataRichiesta,
    dataEsecuzione: r.dataEsecuzione ?? null,
    dataConfermaRicezione: r.dataConfermaRicezione ?? null,
    stato: r.stato,
    note: r.note ?? null,
    righe: righeByT.get(r.id) ?? [],
    dataCreazione: r.dataCreazione.toISOString(),
  })));
});

router.post("/trasferimenti", async (req, res) => {
  const body = req.body;
  if (body.magazzinoOrigineId === body.magazzinoDestinoId) {
    res.status(400).json({ error: "Origine e destinazione devono essere diverse" });
    return;
  }
  const righeInput: Array<{ quantita: number }> = body.righe ?? [];
  if (righeInput.some((r) => !(r.quantita > 0))) {
    res.status(400).json({ error: "Le quantità devono essere maggiori di zero" });
    return;
  }
  const codice = `TRASM-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
  const [t] = await db.insert(trasferimentiTable).values({
    codice,
    magazzinoOrigineId: body.magazzinoOrigineId,
    magazzinoDestinoId: body.magazzinoDestinoId,
    dataRichiesta: body.dataRichiesta,
    note: body.note,
  }).returning();

  if (body.righe?.length) {
    await db.insert(trasferimentoRigheTable).values(
      body.righe.map((r: { prodottoId: number; lottoId?: number; quantita: number; unitaMisura: string; note?: string }) => ({
        trasferimentoId: t.id,
        prodottoId: r.prodottoId,
        lottoId: r.lottoId,
        quantita: r.quantita.toString(),
        unitaMisura: r.unitaMisura,
        note: r.note,
      }))
    );
  }

  const result = await getTrasferimentoWithRighe(t.id);
  res.status(201).json(result);
});

router.get("/trasferimenti/:id", async (req, res) => {
  const result = await getTrasferimentoWithRighe(parseInt(req.params.id));
  if (!result) { res.status(404).json({ error: "Not found" }); return; }
  res.json(result);
});

router.patch("/trasferimenti/:id", async (req, res) => {
  const [row] = await db.update(trasferimentiTable).set(req.body).where(eq(trasferimentiTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getTrasferimentoWithRighe(row.id);
  res.json(result);
});

router.post("/trasferimenti/:id/avvia", async (req, res) => {
  const [row] = await db.update(trasferimentiTable)
    .set({ stato: "in_transito", dataEsecuzione: new Date().toISOString().split("T")[0] })
    .where(eq(trasferimentiTable.id, parseInt(req.params.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getTrasferimentoWithRighe(row.id);
  res.json(result);
});

router.post("/trasferimenti/:id/conferma", async (req, res) => {
  const body = req.body;
  const [row] = await db.update(trasferimentiTable)
    .set({
      stato: "completato",
      dataConfermaRicezione: body.dataConferma ?? new Date().toISOString().split("T")[0],
      note: body.note,
    })
    .where(eq(trasferimentiTable.id, parseInt(req.params.id)))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const result = await getTrasferimentoWithRighe(row.id);
  res.json(result);
});

export default router;
