import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  FONDI_ORIGINE,
  lottiTable,
  prodottiTable,
  magazziniTable,
  fornitoriTable,
  type FondoOrigine,
} from "@workspace/db";
import { eq, and, lte, gt, type SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
  canAccessMagazzino,
} from "../lib/centroScope";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import {
  creaCaricoInventariale,
  InventoryLedgerError,
  rettificaInventariale,
  RETTIFICA_CAUSALI,
} from "../lib/inventoryLedger";
import { addDaysToCivilDate, dataCivileEuropeRome, isDateOnly } from "../lib/interventiWorkflow";

const router: IRouter = Router();

router.use("/lotti", requireModulo("LOTTI"));

const lottoJson = (row: typeof lottiTable.$inferSelect) => ({
  ...row,
  quantitaCaricata: parseFloat(row.quantitaCaricata),
  quantitaResidua: parseFloat(row.quantitaResidua),
  quantitaCaricataPrecisa: row.quantitaCaricata,
  quantitaResiduaPrecisa: row.quantitaResidua,
  dataCreazione: row.dataCreazione.toISOString(),
});

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

router.get("/lotti", requirePermission("magazzino.view"), async (req, res) => {
  const {
    prodottoId,
    magazzinoId,
    inScadenza,
    fondoOrigine,
    origineCaricoPresente,
  } = req.query as Record<string, string>;
  const conditions: SQL[] = [gt(lottiTable.quantitaResidua, "0")];
  if (prodottoId)
    conditions.push(eq(lottiTable.prodottoId, parseInt(prodottoId)));
  if (magazzinoId)
    conditions.push(eq(lottiTable.magazzinoId, parseInt(magazzinoId)));
  if (fondoOrigine) {
    if (!FONDI_ORIGINE.includes(fondoOrigine as FondoOrigine)) {
      res.status(400).json({ error: "fondoOrigine non valido" });
      return;
    }
    conditions.push(eq(lottiTable.fondoOrigine, fondoOrigine));
  }
  if (origineCaricoPresente) {
    conditions.push(sql`exists (
      select 1
      from ${carichiMagazzinoRigheTable} cr
      join ${carichiMagazzinoTable} c on c.id = cr.carico_magazzino_id
      where cr.lotto_id = ${lottiTable.id}
        and c.origine_carico = ${origineCaricoPresente}
    )`);
  }
  const scope = magazzinoScopeFilter(
    lottiTable.magazzinoId,
    await visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req)),
  );
  if (scope) conditions.push(scope);
  if (inScadenza === "true") {
    const in30 = addDaysToCivilDate(dataCivileEuropeRome(), 30);
    conditions.push(lte(lottiTable.dataScadenza, in30));
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

  res.json(
    rows.map((r) => ({
      id: r.lotto.id,
      prodottoId: r.lotto.prodottoId,
      prodottoNome: r.prodottoNome ?? null,
      codiceLotto: r.lotto.codiceLotto ?? null,
      dataScadenza: r.lotto.dataScadenza ?? null,
      dataCarico: r.lotto.dataCarico,
      quantitaCaricata: parseFloat(r.lotto.quantitaCaricata),
      quantitaResidua: parseFloat(r.lotto.quantitaResidua),
      quantitaCaricataPrecisa: r.lotto.quantitaCaricata,
      quantitaResiduaPrecisa: r.lotto.quantitaResidua,
      magazzinoId: r.lotto.magazzinoId,
      magazzinoNome: r.magazzinoNome ?? null,
      fornitoreId: r.lotto.fornitoreId ?? null,
      fornitoreNome: r.fornitoreNome ?? null,
      fsePlus: r.lotto.fsePlus,
      fondoOrigine: r.lotto.fondoOrigine,
      codiceLottoNormalizzato: r.lotto.codiceLottoNormalizzato,
      dataUltimoCarico: r.lotto.dataUltimoCarico,
      fattoreKgLtPezzo: r.lotto.fattoreKgLtPezzo,
      documentoCarico: r.lotto.documentoCarico ?? null,
      note: r.lotto.note ?? null,
      dataCreazione: r.lotto.dataCreazione.toISOString(),
    })),
  );
});

router.post(
  "/lotti",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    const body = req.body ?? {};
    if (
      !positiveInteger(body.prodottoId) ||
      !positiveInteger(body.magazzinoId)
    ) {
      res
        .status(400)
        .json({ error: "Prodotto e Magazzino devono essere validi" });
      return;
    }
    const quantita = body.quantitaCaricata;
    if (
      (typeof quantita !== "string" && typeof quantita !== "number") ||
      !isDateOnly(body.dataCarico)
    ) {
      res.status(400).json({ error: "Quantità e data di carico non valide" });
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
    const fsePlus = body.fsePlus === true;
    const causale = fsePlus
      ? "fse_plus"
      : body.causale === "acquisto"
        ? "acquisto"
        : "donazione";
    try {
      const row = await db.transaction((tx) =>
        creaCaricoInventariale(tx, {
          prodottoId: body.prodottoId,
          codiceLotto:
            typeof body.codiceLotto === "string"
              ? body.codiceLotto.trim() || null
              : null,
          dataScadenza: isDateOnly(body.dataScadenza)
            ? body.dataScadenza
            : null,
          dataCarico: body.dataCarico,
          quantita,
          magazzinoId: body.magazzinoId,
          fornitoreId: positiveInteger(body.fornitoreId)
            ? body.fornitoreId
            : null,
          fsePlus,
          documentoCarico:
            typeof body.documentoCarico === "string"
              ? body.documentoCarico.trim() || null
              : null,
          causale,
          note: typeof body.note === "string" ? body.note.trim() || null : null,
          operatoreId: req.user!.id,
        }),
      );
      res.status(201).json(lottoJson(row));
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
  "/lotti/:id",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const [row] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, Number(req.params.id)));
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    if (
      !(await canAccessMagazzino(
        row.magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo profilo" });
      return;
    }
    res.json(lottoJson(row));
  },
);

router.patch(
  "/lotti/:id",
  requirePermission("magazzino.stock.receive"),
  async (req, res) => {
    const body = req.body ?? {};
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const ids = await visibleMagazzinoIds(
      callerCentroId(req),
      callerAreaOperativaId(req),
    );
    if (ids != null && !ids.includes(existing.magazzinoId)) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo profilo" });
      return;
    }
    const allowed = new Set(["note"]);
    const unsupported = Object.keys(body).filter((key) => !allowed.has(key));
    if (unsupported.length > 0) {
      res.status(400).json({
        error: `Campi non modificabili dal PATCH Lotto: ${unsupported.join(", ")}. Usa la rettifica inventariale per cambiare la giacenza`,
      });
      return;
    }
    const update: Partial<typeof lottiTable.$inferInsert> = {};
    if ("note" in body) {
      if (body.note != null && typeof body.note !== "string") {
        res.status(400).json({ error: "note non valide" });
        return;
      }
      update.note =
        typeof body.note === "string" ? body.note.trim() || null : null;
    }
    const [row] = await db
      .update(lottiTable)
      .set(update)
      .where(eq(lottiTable.id, id))
      .returning();
    res.json(lottoJson(row));
  },
);

router.post(
  "/lotti/:id/rettifica",
  requirePermission("magazzino.stock.adjust"),
  async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body ?? {};
    const delta = body.delta;
    if (
      !positiveInteger(id) ||
      (typeof delta !== "string" && typeof delta !== "number")
    ) {
      res.status(400).json({ error: "ID Lotto o delta non valido" });
      return;
    }
    if (!RETTIFICA_CAUSALI.includes(body.causale)) {
      res.status(400).json({ error: "Causale di rettifica non valida" });
      return;
    }
    const [existing] = await db
      .select()
      .from(lottiTable)
      .where(eq(lottiTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Lotto non trovato" });
      return;
    }
    if (
      !(await canAccessMagazzino(
        existing.magazzinoId,
        callerCentroId(req),
        callerAreaOperativaId(req),
      ))
    ) {
      res
        .status(403)
        .json({ error: "Risorsa non accessibile per il tuo profilo" });
      return;
    }
    try {
      const row = await db.transaction((tx) =>
        rettificaInventariale(tx, {
          lottoId: id,
          delta,
          causale: body.causale,
          motivazione:
            typeof body.motivazione === "string" ? body.motivazione : null,
          note: typeof body.note === "string" ? body.note : null,
          dataMovimento: isDateOnly(body.dataMovimento)
            ? body.dataMovimento
            : dataCivileEuropeRome(new Date()),
          operatoreId: req.user!.id,
        }),
      );
      res.json(lottoJson(row));
    } catch (error) {
      if (error instanceof InventoryLedgerError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      throw error;
    }
  },
);

export default router;
