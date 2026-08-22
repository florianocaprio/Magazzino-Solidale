import { Router, type IRouter } from "express";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  db,
  fornitoriTable,
  lottiTable,
  magazziniTable,
  prodottiTable,
  ORIGINI_CARICO,
  ORIGINI_CARICO_MANUALI,
  type OrigineCarico,
} from "@workspace/db";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  callerAreaOperativaId,
  callerCentroId,
  canAccessMagazzino,
  magazzinoScopeFilter,
  visibleMagazzinoIds,
} from "../lib/centroScope";
import {
  createWarehouseLoad,
  InventoryLedgerError,
  type WarehouseLoadResult,
} from "../lib/inventoryLedger";
import { InventoryDecimal } from "../lib/inventoryDecimal";
import { canonicalInventoryFactor } from "../lib/inventoryQuantityDimensions";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";

const router: IRouter = Router();
router.use("/carichi", requireModulo("LOTTI"));

function caricoJson(result: WarehouseLoadResult) {
  const { requestHash: _requestHash, ...publicCarico } = result.carico;
  return {
    ...publicCarico,
    dataCreazione: result.carico.dataCreazione.toISOString(),
    replay: result.replay,
    righe: result.righe.map(({ riga, lotto, prodottoNome }) => ({
      ...riga,
      dataCreazione: riga.dataCreazione.toISOString(),
      prodottoNome: prodottoNome ?? null,
      codiceLotto: lotto.codiceLotto,
      codiceLottoNormalizzato: lotto.codiceLottoNormalizzato,
      quantitaOperativa: InventoryDecimal.parse(riga.quantitaOperativa).toDb(),
      quantitaPezzi:
        riga.quantitaPezzi == null
          ? null
          : InventoryDecimal.parse(riga.quantitaPezzi).toDb(),
      quantitaKgLt:
        riga.quantitaKgLt == null
          ? null
          : InventoryDecimal.parse(riga.quantitaKgLt).toDb(),
      fattoreKgLtPezzo: canonicalInventoryFactor(riga.fattoreKgLtPezzo),
      partitaQuantitaCaricata: InventoryDecimal.parse(
        lotto.quantitaCaricata,
      ).toDb(),
      partitaQuantitaResidua: InventoryDecimal.parse(
        lotto.quantitaResidua,
      ).toDb(),
    })),
  };
}

function publicCaricoRow(carico: typeof carichiMagazzinoTable.$inferSelect) {
  const { requestHash: _requestHash, ...publicCarico } = carico;
  return publicCarico;
}

async function getCarico(id: number): Promise<WarehouseLoadResult | null> {
  const [carico] = await db
    .select()
    .from(carichiMagazzinoTable)
    .where(eq(carichiMagazzinoTable.id, id));
  if (!carico) return null;
  const righe = await db
    .select({
      riga: carichiMagazzinoRigheTable,
      lotto: lottiTable,
      prodottoNome: prodottiTable.nome,
    })
    .from(carichiMagazzinoRigheTable)
    .innerJoin(
      lottiTable,
      eq(carichiMagazzinoRigheTable.lottoId, lottiTable.id),
    )
    .innerJoin(
      prodottiTable,
      eq(carichiMagazzinoRigheTable.prodottoId, prodottiTable.id),
    )
    .where(eq(carichiMagazzinoRigheTable.caricoMagazzinoId, id))
    .orderBy(carichiMagazzinoRigheTable.numeroRiga);
  return { carico, righe, replay: false };
}

router.get(
  "/carichi",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const { magazzinoId, origineCarico, da, a } = req.query as Record<
      string,
      string
    >;
    const conditions: SQL[] = [];
    if (magazzinoId != null) {
      const id = Number(magazzinoId);
      if (!Number.isSafeInteger(id) || id <= 0) {
        res.status(400).json({ error: "magazzinoId non valido" });
        return;
      }
      conditions.push(eq(carichiMagazzinoTable.magazzinoId, id));
    }
    if (origineCarico != null) {
      if (!ORIGINI_CARICO.includes(origineCarico as OrigineCarico)) {
        res.status(400).json({ error: "origineCarico non valida" });
        return;
      }
      conditions.push(eq(carichiMagazzinoTable.origineCarico, origineCarico));
    }
    if (da) conditions.push(gte(carichiMagazzinoTable.dataCarico, da));
    if (a) conditions.push(lte(carichiMagazzinoTable.dataCarico, a));
    const scope = magazzinoScopeFilter(
      carichiMagazzinoTable.magazzinoId,
      await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      ),
    );
    if (scope) conditions.push(scope);

    const rows = await db
      .select({
        carico: carichiMagazzinoTable,
        magazzinoNome: magazziniTable.nome,
        fornitoreNome: fornitoriTable.nome,
        numeroRighe: sql<number>`count(${carichiMagazzinoRigheTable.id})::int`,
      })
      .from(carichiMagazzinoTable)
      .innerJoin(
        magazziniTable,
        eq(carichiMagazzinoTable.magazzinoId, magazziniTable.id),
      )
      .leftJoin(
        fornitoriTable,
        eq(carichiMagazzinoTable.fornitoreId, fornitoriTable.id),
      )
      .leftJoin(
        carichiMagazzinoRigheTable,
        eq(
          carichiMagazzinoRigheTable.caricoMagazzinoId,
          carichiMagazzinoTable.id,
        ),
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .groupBy(
        carichiMagazzinoTable.id,
        magazziniTable.nome,
        fornitoriTable.nome,
      )
      .orderBy(
        desc(carichiMagazzinoTable.dataCarico),
        desc(carichiMagazzinoTable.id),
      );

    res.json(
      rows.map((row) => ({
        ...publicCaricoRow(row.carico),
        magazzinoNome: row.magazzinoNome,
        fornitoreNome: row.fornitoreNome,
        numeroRighe: row.numeroRighe,
        dataCreazione: row.carico.dataCreazione.toISOString(),
      })),
    );
  },
);

router.post(
  "/carichi",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    const body = req.body ?? {};
    if (
      !Number.isSafeInteger(body.magazzinoId) ||
      body.magazzinoId <= 0 ||
      typeof body.origineCarico !== "string" ||
      !ORIGINI_CARICO.includes(body.origineCarico as OrigineCarico) ||
      typeof body.dataCarico !== "string" ||
      !Array.isArray(body.righe)
    ) {
      res.status(400).json({ error: "Testata o righe del carico non valide" });
      return;
    }
    if (
      !ORIGINI_CARICO_MANUALI.includes(
        body.origineCarico as (typeof ORIGINI_CARICO_MANUALI)[number],
      )
    ) {
      res.status(403).json({
        error: "Provenienza riservata a un processo interno di sistema",
      });
      return;
    }
    if (
      !(await canAccessMagazzino(
        body.magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Magazzino non accessibile per il tuo profilo" });
      return;
    }
    try {
      const result = await db.transaction((tx) =>
        createWarehouseLoad(tx, {
          magazzinoId: body.magazzinoId,
          origineCarico: body.origineCarico,
          numeroDocumento: body.numeroDocumento,
          dataDocumento: body.dataDocumento,
          dataCarico: body.dataCarico,
          descrizione: body.descrizione,
          fornitoreId: body.fornitoreId,
          note: body.note,
          idempotencyKey: body.idempotencyKey,
          executionContext: "manual",
          creatoDa: req.user!.id,
          righe: body.righe,
        }),
      );
      res.status(result.replay ? 200 : 201).json(caricoJson(result));
    } catch (error) {
      if (error instanceof InventoryLedgerError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

router.get(
  "/carichi/:id/righe",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const result = await getCarico(Number(req.params.id));
    if (!result) {
      res.status(404).json({ error: "Carico non trovato" });
      return;
    }
    if (
      !(await canAccessMagazzino(
        result.carico.magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo profilo" });
      return;
    }
    res.json(caricoJson(result).righe);
  },
);

router.get(
  "/carichi/:id",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const result = await getCarico(Number(req.params.id));
    if (!result) {
      res.status(404).json({ error: "Carico non trovato" });
      return;
    }
    if (
      !(await canAccessMagazzino(
        result.carico.magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo profilo" });
      return;
    }
    res.json(caricoJson(result));
  },
);

export default router;
