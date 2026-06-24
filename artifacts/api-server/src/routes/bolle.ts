import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  bolleTable, bollaRigheTable, beneficiariTable, magazziniTable,
  movimentiTable, lottiTable, prodottiTable,
} from "@workspace/db";
import { eq, and, desc, type SQL, sql } from "drizzle-orm";

const router: IRouter = Router();

async function buildDettaglio(id: number) {
  const [row] = await db
    .select({
      b: bolleTable,
      cognome: beneficiariTable.cognome,
      nome: beneficiariTable.nome,
      magazzinoNome: magazziniTable.nome,
    })
    .from(bolleTable)
    .leftJoin(beneficiariTable, eq(bolleTable.beneficiarioId, beneficiariTable.id))
    .leftJoin(magazziniTable, eq(bolleTable.magazzinoId, magazziniTable.id))
    .where(eq(bolleTable.id, id));

  if (!row) return null;

  const righe = await db
    .select({
      r: bollaRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
    })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(bollaRigheTable.lottoId, lottiTable.id))
    .where(eq(bollaRigheTable.bollaId, id));

  return {
    id: row.b.id,
    numeroBolla: row.b.numeroBolla,
    dataBolla: row.b.dataBolla,
    beneficiarioId: row.b.beneficiarioId,
    beneficiarioNome: row.cognome && row.nome ? `${row.cognome} ${row.nome}` : null,
    consegnaId: row.b.consegnaId ?? null,
    magazzinoId: row.b.magazzinoId,
    magazzinoNome: row.magazzinoNome ?? null,
    indirizzoConsegna: row.b.indirizzoConsegna ?? null,
    volontarioConsegnaId: row.b.volontarioConsegnaId ?? null,
    mezzoId: row.b.mezzoId ?? null,
    stato: row.b.stato,
    noteConsegna: row.b.noteConsegna ?? null,
    confermaRicezione: row.b.confermaRicezione,
    noteRicezione: row.b.noteRicezione ?? null,
    dataCreazione: row.b.dataCreazione.toISOString(),
    righe: righe.map(r => ({
      id: r.r.id,
      bollaId: r.r.bollaId,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      lottoId: r.r.lottoId ?? null,
      codiceLotto: r.codiceLotto ?? null,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
  };
}

// ─── LIST ────────────────────────────────────────────────────────────────────

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

// ─── CREATE ──────────────────────────────────────────────────────────────────

router.post("/bolle", async (req, res) => {
  const body = req.body;
  const anno = new Date().getFullYear();
  const existing = await db.select({ n: bolleTable.numeroBolla }).from(bolleTable).orderBy(desc(bolleTable.id)).limit(1);
  const lastNum = existing.length > 0 ? parseInt(existing[0].n.split("-").pop() ?? "0") : 0;
  const numeroBolla = `BOLLA-${anno}-${String(lastNum + 1).padStart(4, "0")}`;
  const dataBolla = body.dataBolla ?? new Date().toISOString().split("T")[0];

  const [row] = await db.insert(bolleTable).values({ ...body, numeroBolla, dataBolla }).returning();
  const det = await buildDettaglio(row.id);
  res.status(201).json(det);
});

// ─── GET BY ID ───────────────────────────────────────────────────────────────

router.get("/bolle/:id", async (req, res) => {
  const det = await buildDettaglio(parseInt(req.params.id));
  if (!det) { res.status(404).json({ error: "Not found" }); return; }
  res.json(det);
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

router.patch("/bolle/:id", async (req, res) => {
  const [row] = await db.update(bolleTable).set(req.body).where(eq(bolleTable.id, parseInt(req.params.id))).returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  const det = await buildDettaglio(row.id);
  res.json(det);
});

// ─── RIGHE ───────────────────────────────────────────────────────────────────

router.get("/bolle/:id/righe", async (req, res) => {
  const id = parseInt(req.params.id);
  const righe = await db
    .select({
      r: bollaRigheTable,
      prodottoNome: prodottiTable.nome,
      codiceLotto: lottiTable.codiceLotto,
    })
    .from(bollaRigheTable)
    .leftJoin(prodottiTable, eq(bollaRigheTable.prodottoId, prodottiTable.id))
    .leftJoin(lottiTable, eq(bollaRigheTable.lottoId, lottiTable.id))
    .where(eq(bollaRigheTable.bollaId, id));

  res.json(righe.map(r => ({
    id: r.r.id,
    bollaId: r.r.bollaId,
    prodottoId: r.r.prodottoId,
    prodottoNome: r.prodottoNome ?? null,
    lottoId: r.r.lottoId ?? null,
    codiceLotto: r.codiceLotto ?? null,
    quantita: parseFloat(r.r.quantita),
    unitaMisura: r.r.unitaMisura,
    note: r.r.note ?? null,
  })));
});

router.post("/bolle/:id/righe", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.stato !== "bozza") {
    res.status(400).json({ error: "Si possono aggiungere prodotti solo a una bolla in bozza" });
    return;
  }

  const { prodottoId, lottoId, quantita, unitaMisura, note } = req.body;

  if (lottoId) {
    const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, lottoId));
    if (!lotto) { res.status(404).json({ error: "Lotto non trovato" }); return; }
    if (parseFloat(lotto.quantitaResidua) < quantita) {
      res.status(400).json({ error: `Disponibilità insufficiente: ${parseFloat(lotto.quantitaResidua)} ${lotto.quantitaResidua}` });
      return;
    }
  }

  const [riga] = await db.insert(bollaRigheTable).values({
    bollaId,
    prodottoId,
    lottoId: lottoId ?? null,
    quantita: quantita.toString(),
    unitaMisura: unitaMisura ?? "pz",
    note: note ?? null,
  }).returning();

  const [prodotto] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, prodottoId));
  const lotto = lottoId ? (await db.select().from(lottiTable).where(eq(lottiTable.id, lottoId)))[0] : null;

  res.status(201).json({
    id: riga.id,
    bollaId: riga.bollaId,
    prodottoId: riga.prodottoId,
    prodottoNome: prodotto?.nome ?? null,
    lottoId: riga.lottoId ?? null,
    codiceLotto: lotto?.codiceLotto ?? null,
    quantita: parseFloat(riga.quantita),
    unitaMisura: riga.unitaMisura,
    note: riga.note ?? null,
  });
});

router.delete("/bolle/:id/righe/:rigaId", async (req, res) => {
  const bollaId = parseInt(req.params.id);
  const rigaId = parseInt(req.params.rigaId);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.stato !== "bozza") {
    res.status(400).json({ error: "Non è possibile modificare una bolla già confermata" });
    return;
  }

  await db.delete(bollaRigheTable).where(
    and(eq(bollaRigheTable.id, rigaId), eq(bollaRigheTable.bollaId, bollaId))
  );
  res.status(204).end();
});

// ─── CONFERMA (bozza → confermato + scarico magazzino) ───────────────────────

router.post("/bolle/:id/conferma", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.stato !== "bozza") {
    res.status(400).json({ error: "La bolla non è in stato bozza" });
    return;
  }

  const righe = await db.select().from(bollaRigheTable).where(eq(bollaRigheTable.bollaId, bollaId));
  if (righe.length === 0) {
    res.status(400).json({ error: "Impossibile confermare una bolla senza prodotti" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];

  for (const riga of righe) {
    if (riga.lottoId) {
      const [lotto] = await db.select().from(lottiTable).where(eq(lottiTable.id, riga.lottoId));
      if (!lotto) {
        res.status(400).json({ error: `Lotto ${riga.lottoId} non trovato` });
        return;
      }
      const disponibile = parseFloat(lotto.quantitaResidua);
      const richiesta = parseFloat(riga.quantita);
      if (disponibile < richiesta) {
        const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, riga.prodottoId));
        res.status(400).json({
          error: `Disponibilità insufficiente per ${prod?.nome ?? `prodotto #${riga.prodottoId}`}: disponibile ${disponibile}, richiesto ${richiesta}`,
        });
        return;
      }

      await db.update(lottiTable)
        .set({ quantitaResidua: (disponibile - richiesta).toFixed(2) })
        .where(eq(lottiTable.id, riga.lottoId));
    }

    const [prod] = await db.select().from(prodottiTable).where(eq(prodottiTable.id, riga.prodottoId));

    await db.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: "consegna_beneficiario",
      dataMovimento: today,
      magazzinoId: bolla.magazzinoId,
      prodottoId: riga.prodottoId,
      lottoId: riga.lottoId ?? undefined,
      quantita: riga.quantita,
      unitaMisura: riga.unitaMisura,
      beneficiarioId: bolla.beneficiarioId,
      bollaId: bollaId,
      documentoRiferimento: bolla.numeroBolla,
      note: riga.note ?? undefined,
    });
  }

  await db.update(bolleTable).set({ stato: "confermato" }).where(eq(bolleTable.id, bollaId));

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

// ─── CONSEGNA (confermato → consegnato) ──────────────────────────────────────

router.post("/bolle/:id/consegna", async (req, res) => {
  const bollaId = parseInt(req.params.id);

  const [bolla] = await db.select().from(bolleTable).where(eq(bolleTable.id, bollaId));
  if (!bolla) { res.status(404).json({ error: "Bolla non trovata" }); return; }
  if (bolla.stato !== "confermato") {
    res.status(400).json({ error: "La bolla deve essere in stato confermato per essere consegnata" });
    return;
  }

  const { noteRicezione, confermaRicezione } = req.body ?? {};

  await db.update(bolleTable).set({
    stato: "consegnato",
    confermaRicezione: confermaRicezione ?? true,
    noteRicezione: noteRicezione ?? null,
  }).where(eq(bolleTable.id, bollaId));

  const det = await buildDettaglio(bollaId);
  res.json(det);
});

export default router;
