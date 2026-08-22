import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
  FONDI_ORIGINE,
  lottiTable,
  prodottiTable,
  magazziniTable,
  type FondoOrigine,
} from "@workspace/db";
import { eq, and, gt, sum, min, sql } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import {
  calcolaImpegnatoAttivoPerGiacenze,
  disponibilitaMagazzinoKey,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import { requirePermission } from "../middlewares/auth";
import { dataOperativaEuropeRome } from "../lib/lottoPolicy";

const router: IRouter = Router();

router.get(
  "/giacenze",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const {
      magazzinoId,
      prodottoId,
      sottoscortaOnly,
      fsePlusOnly,
      fondoOrigine,
      provenienza,
      scadenzaDa,
      scadenzaA,
    } = req.query as Record<string, string>;

    const conditions = [gt(lottiTable.quantitaResidua, "0")];
    if (magazzinoId)
      conditions.push(eq(lottiTable.magazzinoId, parseInt(magazzinoId)));
    if (prodottoId)
      conditions.push(eq(lottiTable.prodottoId, parseInt(prodottoId)));
    if (fsePlusOnly === "true")
      conditions.push(eq(lottiTable.fondoOrigine, "FSE_PLUS"));
    if (fondoOrigine) {
      if (!FONDI_ORIGINE.includes(fondoOrigine as FondoOrigine)) {
        res.status(400).json({ error: "fondoOrigine non valido" });
        return;
      }
      conditions.push(eq(lottiTable.fondoOrigine, fondoOrigine));
    }
    if (provenienza) {
      conditions.push(sql`exists (
      select 1
      from ${carichiMagazzinoRigheTable} cr
      join ${carichiMagazzinoTable} c on c.id = cr.carico_magazzino_id
      where cr.lotto_id = ${lottiTable.id}
        and c.origine_carico = ${provenienza}
    )`);
    }
    if (scadenzaDa)
      conditions.push(sql`${lottiTable.dataScadenza} >= ${scadenzaDa}`);
    if (scadenzaA)
      conditions.push(sql`${lottiTable.dataScadenza} <= ${scadenzaA}`);
    const scope = magazzinoScopeFilter(
      lottiTable.magazzinoId,
      await visibleMagazzinoIds(
        callerCentroId(req),
        callerAreaOperativaId(req),
      ),
    );
    if (scope) conditions.push(scope);

    const dataOperativa = dataOperativaEuropeRome();
    const rows = await db
      .select({
        prodottoId: prodottiTable.id,
        prodottoNome: prodottiTable.nome,
        prodottoCodice: prodottiTable.codice,
        tipoProdotto: prodottiTable.tipoProdotto,
        unitaMisura: prodottiTable.unitaMisura,
        scortaMinima: prodottiTable.scortaMinima,
        scortaConsigliata: prodottiTable.scortaConsigliata,
        magazzinoId: magazziniTable.id,
        magazzinoNome: magazziniTable.nome,
        quantitaTotale: sum(lottiTable.quantitaResidua),
        giacenzaScaduta: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}) filter (where ${lottiTable.dataScadenza} < ${dataOperativa}), 0)`,
        giacenzaDistribuibile: sql<string>`coalesce(sum(${lottiTable.quantitaResidua}) filter (where ${lottiTable.dataScadenza} is null or ${lottiTable.dataScadenza} >= ${dataOperativa}), 0)`,
        lottiAttivi: sql<number>`count(${lottiTable.id}) filter (where ${lottiTable.dataScadenza} is null or ${lottiTable.dataScadenza} >= ${dataOperativa})`,
        prossimaScadenza: min(
          sql<string>`case when ${lottiTable.dataScadenza} >= ${dataOperativa} then ${lottiTable.dataScadenza} end`,
        ),
      })
      .from(lottiTable)
      .innerJoin(prodottiTable, eq(lottiTable.prodottoId, prodottiTable.id))
      .innerJoin(magazziniTable, eq(lottiTable.magazzinoId, magazziniTable.id))
      .where(and(...conditions))
      .groupBy(prodottiTable.id, magazziniTable.id)
      .orderBy(prodottiTable.nome);

    const impegnatoByKey = await calcolaImpegnatoAttivoPerGiacenze(
      rows.map((r) => ({
        prodottoId: r.prodottoId,
        magazzinoId: r.magazzinoId,
      })),
    );

    const result = rows.map((r) => {
      const giacenzaFisica = parseDbNumber(r.quantitaTotale);
      const giacenzaScaduta = parseDbNumber(r.giacenzaScaduta);
      const giacenzaDistribuibile = parseDbNumber(r.giacenzaDistribuibile);
      const impegnato =
        impegnatoByKey.get(
          disponibilitaMagazzinoKey(r.prodottoId, r.magazzinoId),
        ) ?? 0;
      const sm = parseDbNumber(r.scortaMinima);
      const disponibileReale = giacenzaDistribuibile - impegnato;
      return {
        prodottoId: r.prodottoId,
        prodottoNome: r.prodottoNome,
        prodottoCodice: r.prodottoCodice,
        tipoProdotto: r.tipoProdotto,
        unitaMisura: r.unitaMisura,
        magazzinoId: r.magazzinoId,
        magazzinoNome: r.magazzinoNome,
        quantitaTotale: giacenzaFisica,
        quantitaTotalePrecisa: r.quantitaTotale ?? "0.000000",
        giacenzaFisica,
        giacenzaFisicaPrecisa: r.quantitaTotale ?? "0.000000",
        giacenzaScaduta,
        giacenzaScadutaPrecisa: r.giacenzaScaduta,
        giacenzaDistribuibile,
        giacenzaDistribuibilePrecisa: r.giacenzaDistribuibile,
        impegnato,
        disponibileReale,
        scortaMinima: sm,
        scortaConsigliata: parseDbNumber(r.scortaConsigliata),
        sottoscorta: disponibileReale <= sm,
        lottiAttivi: Number(r.lottiAttivi),
        prossimaScadenza: r.prossimaScadenza ?? null,
      };
    });

    const filtered =
      sottoscortaOnly === "true" ? result.filter((r) => r.sottoscorta) : result;
    res.json(filtered);
  },
);

export default router;
