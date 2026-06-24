import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  scarichiTable,
  scaricoRigheTable,
  magazziniTable,
  centriAscoltoTable,
  prodottiTable,
  lottiTable,
  movimentiTable,
  utentiTable,
} from "@workspace/db";
import { eq, and, desc, inArray, gt, sum, asc, type SQL } from "drizzle-orm";

const router: IRouter = Router();

const VALID_CAUSALI = ["deteriorata", "rubata", "scaduta", "altro"] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function getScaricoWithRighe(id: number) {
  const [s] = await db
    .select({
      s: scarichiTable,
      magazzinoNome: magazziniTable.nome,
      centroAscoltoNome: centriAscoltoTable.nome,
      operatoreMatricola: utentiTable.matricola,
      operatoreUsername: utentiTable.username,
    })
    .from(scarichiTable)
    .leftJoin(magazziniTable, eq(scarichiTable.magazzinoId, magazziniTable.id))
    .leftJoin(centriAscoltoTable, eq(scarichiTable.centroAscoltoId, centriAscoltoTable.id))
    .leftJoin(utentiTable, eq(scarichiTable.operatoreId, utentiTable.id))
    .where(eq(scarichiTable.id, id));
  if (!s) return null;

  const righe = await db
    .select({ r: scaricoRigheTable, prodottoNome: prodottiTable.nome, prodottoFsePlus: prodottiTable.fsePlus })
    .from(scaricoRigheTable)
    .leftJoin(prodottiTable, eq(scaricoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(scaricoRigheTable.scaricoId, id));

  return {
    id: s.s.id,
    codice: s.s.codice,
    magazzinoId: s.s.magazzinoId,
    magazzinoNome: s.magazzinoNome ?? null,
    centroAscoltoId: s.s.centroAscoltoId ?? null,
    centroAscoltoNome: s.centroAscoltoNome ?? null,
    dataScarico: s.s.dataScarico,
    causale: s.s.causale,
    causaleAltro: s.s.causaleAltro ?? null,
    note: s.s.note ?? null,
    operatoreId: s.s.operatoreId ?? null,
    operatoreCodice: s.operatoreMatricola ?? s.operatoreUsername ?? null,
    righe: righe.map((r) => ({
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      fsePlus: !!r.prodottoFsePlus,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
    })),
    dataCreazione: s.s.dataCreazione.toISOString(),
  };
}

/** Giacenza disponibile per un prodotto in un magazzino */
async function giacenzaDisponibile(prodottoId: number, magazzinoId: number): Promise<number> {
  const [res] = await db
    .select({ totale: sum(lottiTable.quantitaResidua) })
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, prodottoId),
        eq(lottiTable.magazzinoId, magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
      ),
    );
  return parseFloat(res?.totale ?? "0");
}

/** Scarico FEFO: scala quantità dai lotti per scadenza crescente e registra i movimenti */
async function scaricoFEFO(tx: Tx, opts: {
  prodottoId: number;
  magazzinoId: number;
  quantita: number;
  unitaMisura: string;
  causale: string;
  dataScarico: string;
  scaricoCodice: string;
  note: string | null;
}) {
  let rimanente = opts.quantita;
  const lotti = await tx
    .select()
    .from(lottiTable)
    .where(
      and(
        eq(lottiTable.prodottoId, opts.prodottoId),
        eq(lottiTable.magazzinoId, opts.magazzinoId),
        gt(lottiTable.quantitaResidua, "0"),
      ),
    )
    .orderBy(asc(lottiTable.dataScadenza), asc(lottiTable.dataCarico));

  for (const lotto of lotti) {
    if (rimanente <= 0) break;
    const disp = parseFloat(lotto.quantitaResidua);
    const scala = Math.min(disp, rimanente);

    await tx
      .update(lottiTable)
      .set({ quantitaResidua: (disp - scala).toFixed(2) })
      .where(eq(lottiTable.id, lotto.id));

    await tx.insert(movimentiTable).values({
      tipoMovimento: "scarico",
      tipoDettaglio: opts.causale,
      dataMovimento: opts.dataScarico,
      magazzinoId: opts.magazzinoId,
      prodottoId: opts.prodottoId,
      lottoId: lotto.id,
      quantita: scala.toFixed(2),
      unitaMisura: opts.unitaMisura,
      note: `Scarico ${opts.scaricoCodice}${opts.note ? ` — ${opts.note}` : ""}`,
    });

    rimanente -= scala;
  }
}

router.get("/scarichi", async (_req, res) => {
  const rows = await db
    .select()
    .from(scarichiTable)
    .orderBy(desc(scarichiTable.dataCreazione))
    .limit(100);

  const magazzini = await db
    .select({ id: magazziniTable.id, nome: magazziniTable.nome })
    .from(magazziniTable);
  const magMap = new Map(magazzini.map((m) => [m.id, m.nome]));

  const centri = await db
    .select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable);
  const centroMap = new Map(centri.map((c) => [c.id, c.nome]));

  const operatoreIds = [...new Set(rows.map((r) => r.operatoreId).filter((x): x is number => x != null))];
  const opMap = new Map<number, string | null>();
  if (operatoreIds.length > 0) {
    const utenti = await db
      .select({ id: utentiTable.id, matricola: utentiTable.matricola, username: utentiTable.username })
      .from(utentiTable)
      .where(inArray(utentiTable.id, operatoreIds));
    for (const u of utenti) opMap.set(u.id, u.matricola ?? u.username ?? null);
  }

  const ids = rows.map((r) => r.id);
  const righeByS = new Map<
    number,
    Array<{
      id: number;
      prodottoId: number;
      prodottoNome: string | null;
      fsePlus: boolean;
      quantita: number;
      unitaMisura: string;
      note: string | null;
    }>
  >();
  if (ids.length > 0) {
    const righe = await db
      .select({ r: scaricoRigheTable, prodottoNome: prodottiTable.nome, prodottoFsePlus: prodottiTable.fsePlus })
      .from(scaricoRigheTable)
      .leftJoin(prodottiTable, eq(scaricoRigheTable.prodottoId, prodottiTable.id))
      .where(inArray(scaricoRigheTable.scaricoId, ids));
    for (const x of righe) {
      const arr = righeByS.get(x.r.scaricoId) ?? [];
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        fsePlus: !!x.prodottoFsePlus,
        quantita: parseFloat(x.r.quantita),
        unitaMisura: x.r.unitaMisura,
        note: x.r.note ?? null,
      });
      righeByS.set(x.r.scaricoId, arr);
    }
  }

  res.json(
    rows.map((r) => ({
      id: r.id,
      codice: r.codice,
      magazzinoId: r.magazzinoId,
      magazzinoNome: magMap.get(r.magazzinoId) ?? null,
      centroAscoltoId: r.centroAscoltoId ?? null,
      centroAscoltoNome: r.centroAscoltoId != null ? (centroMap.get(r.centroAscoltoId) ?? null) : null,
      dataScarico: r.dataScarico,
      causale: r.causale,
      causaleAltro: r.causaleAltro ?? null,
      note: r.note ?? null,
      operatoreId: r.operatoreId ?? null,
      operatoreCodice: r.operatoreId != null ? (opMap.get(r.operatoreId) ?? null) : null,
      righe: righeByS.get(r.id) ?? [],
      dataCreazione: r.dataCreazione.toISOString(),
    })),
  );
});

router.post("/scarichi", async (req, res) => {
  const body = req.body;

  if (!VALID_CAUSALI.includes(body.causale)) {
    res.status(400).json({ error: "Causale non valida" });
    return;
  }

  const righeInput: Array<{ prodottoId: number; quantita: number; unitaMisura: string; note?: string }> =
    body.righe ?? [];
  if (righeInput.length === 0) {
    res.status(400).json({ error: "Aggiungi almeno un prodotto da scaricare" });
    return;
  }
  if (righeInput.some((r) => !(r.quantita > 0))) {
    res.status(400).json({ error: "Le quantità devono essere maggiori di zero" });
    return;
  }

  // Carica unità canonica + nome per i prodotti coinvolti (audit consistente)
  const prodottoIds = [...new Set(righeInput.map((r) => r.prodottoId))];
  const prodotti = await db
    .select({ id: prodottiTable.id, nome: prodottiTable.nome, unitaMisura: prodottiTable.unitaMisura })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  const prodottoMap = new Map(prodotti.map((p) => [p.id, p]));

  const prodottoMancante = prodottoIds.find((id) => !prodottoMap.has(id));
  if (prodottoMancante !== undefined) {
    res.status(400).json({ error: `Prodotto #${prodottoMancante} non trovato` });
    return;
  }

  // Valida disponibilità per ogni prodotto (somma quantità per prodotto)
  const richiestaPerProdotto = new Map<number, number>();
  for (const r of righeInput) {
    richiestaPerProdotto.set(r.prodottoId, (richiestaPerProdotto.get(r.prodottoId) ?? 0) + r.quantita);
  }
  for (const [prodottoId, richiesta] of richiestaPerProdotto) {
    const disp = await giacenzaDisponibile(prodottoId, body.magazzinoId);
    if (richiesta > disp) {
      res.status(400).json({
        error: `Disponibilità insufficiente per ${prodottoMap.get(prodottoId)?.nome ?? `prodotto #${prodottoId}`}: ${disp} disponibili, richiesti ${richiesta}`,
      });
      return;
    }
  }

  const codice = `SCAR-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;

  const newId = await db.transaction(async (tx) => {
    const [s] = await tx
      .insert(scarichiTable)
      .values({
        codice,
        magazzinoId: body.magazzinoId,
        centroAscoltoId: body.centroAscoltoId ?? null,
        dataScarico: body.dataScarico,
        causale: body.causale,
        causaleAltro: body.causale === "altro" ? body.causaleAltro ?? null : null,
        note: body.note ?? null,
        operatoreId: req.user!.id,
      })
      .returning();

    await tx.insert(scaricoRigheTable).values(
      righeInput.map((r) => ({
        scaricoId: s.id,
        prodottoId: r.prodottoId,
        quantita: r.quantita.toString(),
        unitaMisura: prodottoMap.get(r.prodottoId)!.unitaMisura,
        note: r.note ?? null,
      })),
    );

    // Scala lo stock (FEFO) e registra i movimenti di scarico
    for (const r of righeInput) {
      await scaricoFEFO(tx, {
        prodottoId: r.prodottoId,
        magazzinoId: body.magazzinoId,
        quantita: r.quantita,
        unitaMisura: prodottoMap.get(r.prodottoId)!.unitaMisura,
        causale: body.causale,
        dataScarico: body.dataScarico,
        scaricoCodice: codice,
        note: r.note ?? null,
      });
    }

    return s.id;
  });

  const result = await getScaricoWithRighe(newId);
  res.status(201).json(result);
});

router.get("/scarichi/:id", async (req, res) => {
  const result = await getScaricoWithRighe(parseInt(req.params.id));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(result);
});

export default router;
