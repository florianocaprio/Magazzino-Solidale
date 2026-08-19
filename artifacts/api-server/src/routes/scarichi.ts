import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  scarichiTable,
  scaricoRigheTable,
  magazziniTable,
  centriAscoltoTable,
  prodottiTable,
  utentiTable,
  movimentiTable,
  lottiTable,
} from "@workspace/db";
import { eq, and, desc, inArray, sql, type SQL } from "drizzle-orm";
import {
  callerCentroId,
  callerCittaId,
  centroScopeFilter,
  canAccessCentro,
  canAccessMagazzino,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
  andScoped,
} from "../lib/centroScope";
import { calcolaDisponibilitaMagazzino } from "../lib/disponibilitaMagazzino";
import { requireModulo } from "../lib/featureFlags";
import { creaScaricoInventariale, InventoryError } from "../lib/scaricoInventory";
import { requirePermission } from "../middlewares/auth";
import { InventoryLedgerError, requireOperationalMagazzino } from "../lib/inventoryLedger";
import { withDocumentCodeRetry } from "../lib/documentCode";
import { isDateOnly } from "../lib/interventiWorkflow";
import type { LottoSelectionPolicy } from "../lib/lottoPolicy";

const router: IRouter = Router();

router.use("/scarichi", requireModulo("SCARICHI"));

const VALID_CAUSALI = ["deteriorata", "rubata", "scaduta", "altro"] as const;

async function fseBreakdown(codici: string[]) {
  const result = new Map<string, { fse: number; nonFse: number }>();
  if (codici.length === 0) return result;
  const rows = await db.select({
    codice: movimentiTable.documentoRiferimento,
    prodottoId: movimentiTable.prodottoId,
    fsePlus: lottiTable.fsePlus,
    quantita: sql<string>`sum(${movimentiTable.quantita})`,
  })
    .from(movimentiTable)
    .innerJoin(lottiTable, eq(movimentiTable.lottoId, lottiTable.id))
    .where(and(
      inArray(movimentiTable.documentoRiferimento, codici),
      eq(movimentiTable.tipoMovimento, "scarico"),
    ))
    .groupBy(movimentiTable.documentoRiferimento, movimentiTable.prodottoId, lottiTable.fsePlus);
  for (const row of rows) {
    if (!row.codice) continue;
    const key = `${row.codice}:${row.prodottoId}`;
    const current = result.get(key) ?? { fse: 0, nonFse: 0 };
    const quantita = Number(row.quantita ?? 0);
    if (row.fsePlus) current.fse += quantita;
    else current.nonFse += quantita;
    result.set(key, current);
  }
  return result;
}

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
    .leftJoin(
      centriAscoltoTable,
      eq(scarichiTable.centroAscoltoId, centriAscoltoTable.id),
    )
    .leftJoin(utentiTable, eq(scarichiTable.operatoreId, utentiTable.id))
    .where(eq(scarichiTable.id, id));
  if (!s) return null;

  const righe = await db
    .select({
      r: scaricoRigheTable,
      prodottoNome: prodottiTable.nome,
    })
    .from(scaricoRigheTable)
    .leftJoin(prodottiTable, eq(scaricoRigheTable.prodottoId, prodottiTable.id))
    .where(eq(scaricoRigheTable.scaricoId, id));
  const provenance = await fseBreakdown([s.s.codice]);

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
    righe: righe.map((r) => {
      const split = provenance.get(`${s.s.codice}:${r.r.prodottoId}`) ?? { fse: 0, nonFse: 0 };
      return {
      id: r.r.id,
      prodottoId: r.r.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      fsePlus: split.fse > 0 && split.nonFse === 0,
      fsePlusQuantita: split.fse,
      nonFsePlusQuantita: split.nonFse,
      quantita: parseFloat(r.r.quantita),
      unitaMisura: r.r.unitaMisura,
      note: r.r.note ?? null,
      };
    }),
    dataCreazione: s.s.dataCreazione.toISOString(),
  };
}

async function disponibilitaPerScarico(
  prodottoId: number,
  magazzinoId: number,
  dataScarico: string,
  policy: LottoSelectionPolicy,
): Promise<number> {
  const disponibilita = await calcolaDisponibilitaMagazzino(
    prodottoId,
    magazzinoId,
    dataScarico,
  );
  if (policy === "scaduto") return Math.max(0, disponibilita.giacenzaScaduta);
  if (policy === "qualsiasi") {
    return Math.max(0, disponibilita.giacenzaFisica - disponibilita.impegnato);
  }
  return Math.max(0, disponibilita.disponibileReale);
}

router.get("/scarichi", requirePermission("magazzino.view"), async (req, res) => {
  const page = req.query.page == null ? 1 : Number(req.query.page);
  const limit = req.query.limit == null ? 50 : Number(req.query.limit);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    res.status(400).json({ error: "Paginazione non valida: page >= 1 e limit tra 1 e 100" });
    return;
  }
  // Centro is enforced via scarichi's own column; città is enforced via the
  // scarico's magazzino (scarichi carry no direct cittaId).
  const cittaMagazzini = await visibleMagazzinoIds(null, callerCittaId(req));
  const where = andScoped(
    centroScopeFilter(scarichiTable.centroAscoltoId, callerCentroId(req)),
    magazzinoScopeFilter(scarichiTable.magazzinoId, cittaMagazzini),
    callerCentroId(req) == null && req.query.centroAscoltoId != null
      ? eq(scarichiTable.centroAscoltoId, Number(req.query.centroAscoltoId))
      : undefined,
  );
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(scarichiTable).where(where);
  const rows = await db
    .select()
    .from(scarichiTable)
    .where(
      where,
    )
    .orderBy(desc(scarichiTable.dataCreazione))
    .limit(limit)
    .offset((page - 1) * limit);

  const magazzini = await db
    .select({ id: magazziniTable.id, nome: magazziniTable.nome })
    .from(magazziniTable);
  const magMap = new Map(magazzini.map((m) => [m.id, m.nome]));

  const centri = await db
    .select({ id: centriAscoltoTable.id, nome: centriAscoltoTable.nome })
    .from(centriAscoltoTable);
  const centroMap = new Map(centri.map((c) => [c.id, c.nome]));

  const operatoreIds = [
    ...new Set(
      rows.map((r) => r.operatoreId).filter((x): x is number => x != null),
    ),
  ];
  const opMap = new Map<number, string | null>();
  if (operatoreIds.length > 0) {
    const utenti = await db
      .select({
        id: utentiTable.id,
        matricola: utentiTable.matricola,
        username: utentiTable.username,
      })
      .from(utentiTable)
      .where(inArray(utentiTable.id, operatoreIds));
    for (const u of utenti) opMap.set(u.id, u.matricola ?? u.username ?? null);
  }

  const ids = rows.map((r) => r.id);
  const codiceByScarico = new Map(rows.map((r) => [r.id, r.codice]));
  const provenance = await fseBreakdown(rows.map((r) => r.codice));
  const righeByS = new Map<
    number,
    Array<{
      id: number;
      prodottoId: number;
      prodottoNome: string | null;
      fsePlus: boolean;
      fsePlusQuantita: number;
      nonFsePlusQuantita: number;
      quantita: number;
      unitaMisura: string;
      note: string | null;
    }>
  >();
  if (ids.length > 0) {
    const righe = await db
      .select({
        r: scaricoRigheTable,
        prodottoNome: prodottiTable.nome,
      })
      .from(scaricoRigheTable)
      .leftJoin(
        prodottiTable,
        eq(scaricoRigheTable.prodottoId, prodottiTable.id),
      )
      .where(inArray(scaricoRigheTable.scaricoId, ids));
    for (const x of righe) {
      const arr = righeByS.get(x.r.scaricoId) ?? [];
      const split = provenance.get(`${codiceByScarico.get(x.r.scaricoId)}:${x.r.prodottoId}`) ?? { fse: 0, nonFse: 0 };
      arr.push({
        id: x.r.id,
        prodottoId: x.r.prodottoId,
        prodottoNome: x.prodottoNome ?? null,
        fsePlus: split.fse > 0 && split.nonFse === 0,
        fsePlusQuantita: split.fse,
        nonFsePlusQuantita: split.nonFse,
        quantita: parseFloat(x.r.quantita),
        unitaMisura: x.r.unitaMisura,
        note: x.r.note ?? null,
      });
      righeByS.set(x.r.scaricoId, arr);
    }
  }

  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Page", String(page));
  res.setHeader("X-Page-Size", String(limit));
  res.json(
    rows.map((r) => ({
      id: r.id,
      codice: r.codice,
      magazzinoId: r.magazzinoId,
      magazzinoNome: magMap.get(r.magazzinoId) ?? null,
      centroAscoltoId: r.centroAscoltoId ?? null,
      centroAscoltoNome:
        r.centroAscoltoId != null
          ? (centroMap.get(r.centroAscoltoId) ?? null)
          : null,
      dataScarico: r.dataScarico,
      causale: r.causale,
      causaleAltro: r.causaleAltro ?? null,
      note: r.note ?? null,
      operatoreId: r.operatoreId ?? null,
      operatoreCodice:
        r.operatoreId != null ? (opMap.get(r.operatoreId) ?? null) : null,
      righe: righeByS.get(r.id) ?? [],
      dataCreazione: r.dataCreazione.toISOString(),
    })),
  );
});

router.post("/scarichi", requirePermission("magazzino.stock.issue"), async (req, res) => {
  const body = req.body ?? {};

  if (!Number.isInteger(body.magazzinoId) || body.magazzinoId <= 0) {
    res.status(400).json({ error: "Magazzino non valido" });
    return;
  }
  const caller = callerCentroId(req);
  if (!(await canAccessMagazzino(body.magazzinoId, caller, callerCittaId(req)))) {
    res.status(403).json({ error: "Magazzino non accessibile per il tuo profilo" });
    return;
  }
  const [magazzino] = await db.select().from(magazziniTable).where(eq(magazziniTable.id, body.magazzinoId));
  if (!magazzino) { res.status(404).json({ error: "Magazzino non trovato" }); return; }
  if (magazzino.stato !== "attivo") {
    res.status(400).json({ error: "Il Magazzino selezionato non è attivo" });
    return;
  }

  if (!VALID_CAUSALI.includes(body.causale)) {
    res.status(400).json({ error: "Causale non valida" });
    return;
  }
  if (!isDateOnly(body.dataScarico)) {
    res.status(400).json({ error: "Data Scarico non valida" });
    return;
  }
  if (body.causale === "altro" && (typeof body.causaleAltro !== "string" || !body.causaleAltro.trim())) {
    res.status(400).json({ error: "Specificare la causale dello Scarico" });
    return;
  }

  const righeInput: Array<{
    prodottoId: number;
    quantita: number;
    unitaMisura: string;
    note?: string;
  }> = body.righe ?? [];
  if (righeInput.length === 0) {
    res.status(400).json({ error: "Aggiungi almeno un prodotto da scaricare" });
    return;
  }
  if (righeInput.some((r) => !(r.quantita > 0))) {
    res
      .status(400)
      .json({ error: "Le quantità devono essere maggiori di zero" });
    return;
  }

  // Carica unità canonica + nome per i prodotti coinvolti (audit consistente)
  const prodottoIds = [...new Set(righeInput.map((r) => r.prodottoId))];
  const prodotti = await db
    .select({
      id: prodottiTable.id,
      nome: prodottiTable.nome,
      unitaMisura: prodottiTable.unitaMisura,
    })
    .from(prodottiTable)
    .where(inArray(prodottiTable.id, prodottoIds));
  const prodottoMap = new Map(prodotti.map((p) => [p.id, p]));

  const prodottoMancante = prodottoIds.find((id) => !prodottoMap.has(id));
  if (prodottoMancante !== undefined) {
    res
      .status(400)
      .json({ error: `Prodotto #${prodottoMancante} non trovato` });
    return;
  }

  // Valida disponibilità per ogni prodotto (somma quantità per prodotto)
  const richiestaPerProdotto = new Map<number, number>();
  for (const r of righeInput) {
    richiestaPerProdotto.set(
      r.prodottoId,
      (richiestaPerProdotto.get(r.prodottoId) ?? 0) + r.quantita,
    );
  }
    const lottoPolicy: LottoSelectionPolicy =
      body.causale === "scaduta" ? "scaduto" : "qualsiasi";
  for (const [prodottoId, richiesta] of richiestaPerProdotto) {
      const disp = await disponibilitaPerScarico(
        prodottoId,
        body.magazzinoId,
        body.dataScarico,
        lottoPolicy,
      );
    if (richiesta > disp) {
      res.status(400).json({
        error: `Disponibilità insufficiente per ${prodottoMap.get(prodottoId)?.nome ?? `prodotto #${prodottoId}`}: ${disp} disponibili, richiesti ${richiesta}`,
      });
      return;
    }
  }

  const centroAscoltoId =
    caller != null ? caller : (body.centroAscoltoId ?? null);

  let newId: number;
  try {
    newId = await withDocumentCodeRetry("SCAR", (codice) => db.transaction(async (tx) => {
      await requireOperationalMagazzino(tx, body.magazzinoId);
      return creaScaricoInventariale(tx, {
      codice,
      magazzinoId: body.magazzinoId,
      centroAscoltoId,
      dataScarico: body.dataScarico,
      causale: body.causale,
      causaleAltro:
        body.causale === "altro" ? (body.causaleAltro ?? null) : null,
      note: body.note ?? null,
      operatoreId: req.user!.id,
            lottoPolicy,
      righe: righeInput.map((r) => ({
        prodottoId: r.prodottoId,
        quantita: r.quantita,
        unitaMisura: prodottoMap.get(r.prodottoId)!.unitaMisura,
        note: r.note ?? null,
      })),
      });
    }));
  } catch (error) {
    if (error instanceof InventoryError) {
      res.status(409).json({ error: error.message });
      return;
    }
    if (error instanceof InventoryLedgerError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    throw error;
  }

  const result = await getScaricoWithRighe(newId);
  res.status(201).json(result);
});

router.get("/scarichi/:id", requirePermission("magazzino.view"), async (req, res) => {
  const result = await getScaricoWithRighe(Number(req.params.id));
  if (!result) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  if (!canAccessCentro(result.centroAscoltoId, callerCentroId(req))) {
    res
      .status(403)
      .json({ error: "Risorsa non accessibile per il tuo centro" });
    return;
  }
  if (
    !(await canAccessMagazzino(
      result.magazzinoId,
      callerCentroId(req),
      callerCittaId(req),
    ))
  ) {
    res.status(403).json({ error: "Risorsa non accessibile per la tua città" });
    return;
  }
  res.json(result);
});

export default router;
