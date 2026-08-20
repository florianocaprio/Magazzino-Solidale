import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  consegneTable,
  bolleTable,
  bollaRigheTable,
  prodottiTable,
  lottiTable,
  magazziniTable,
  beneficiariTable,
  prenotazioniMagazzinoTable,
} from "@workspace/db";
import { eq, and, ne, gt, sum, inArray, countDistinct, asc } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  visibleMagazzinoIds,
  magazzinoScopeFilter,
  andScoped,
} from "../lib/centroScope";
import { PRENOTAZIONE_MAGAZZINO_ATTIVA, parseDbNumber } from "../lib/disponibilitaMagazzino";
import { requireModulo } from "../lib/featureFlags";
import { requirePermission } from "../middlewares/auth";
import { lottoDistribuibileCondition } from "../lib/lottoPolicy";

const router: IRouter = Router();

router.use(
  "/preparazione-consegne",
  requireModulo("MAGAZZINO_SOLIDALE"),
);

/**
 * Goods to prepare for the PLANNED deliveries of a warehouse.
 *
 * The user picks a area operativa (narrows the magazzino list client-side) and a
 * magazzino di riferimento; the endpoint aggregates, from every planned
 * (`consegne.stato='pianificata'`) delivery whose non-annullato bolla ships
 * from the selected warehouse(s), how much of each product must be prepared,
 * alongside the current stock available there and the list of deliveries
 * included. Area Operativa/centro HARD scoping is enforced server-side via the visible
 * warehouse set, regardless of the optional query filters.
 */
router.get("/preparazione-consegne", requirePermission("magazzino.view"), async (req, res) => {
  const { areaOperativaId, magazzinoId } = req.query as Record<string, string>;

  const areaOperativaIdNum = areaOperativaId ? parseInt(areaOperativaId) : undefined;
  const magazzinoIdNum = magazzinoId ? parseInt(magazzinoId) : undefined;
  if (
    (areaOperativaIdNum !== undefined && Number.isNaN(areaOperativaIdNum)) ||
    (magazzinoIdNum !== undefined && Number.isNaN(magazzinoIdNum))
  ) {
    res
      .status(400)
      .json({ message: "areaOperativaId e magazzinoId devono essere numerici" });
    return;
  }

  // 1) Resolve the eligible warehouse ids: optional area operativa/magazzino filters
  //    intersected with the caller's visible (centro + area operativa) warehouse set.
  const visible = await visibleMagazzinoIds(
    callerCentroId(req),
    callerAreaOperativaId(req),
  );
  const magConds = [
    areaOperativaIdNum !== undefined
      ? eq(magazziniTable.areaOperativaId, areaOperativaIdNum)
      : undefined,
    magazzinoIdNum !== undefined
      ? eq(magazziniTable.id, magazzinoIdNum)
      : undefined,
    magazzinoScopeFilter(magazziniTable.id, visible),
  ];
  const magRows = await db
    .select({ id: magazziniTable.id })
    .from(magazziniTable)
    .where(andScoped(...magConds));
  const magIds = magRows.map((m) => m.id);

  if (magIds.length === 0) {
    res.json({ righe: [], consegne: [] });
    return;
  }

  // 2) Aggregate the goods required across planned deliveries' bolla righe.
  const righeRows = await db
    .select({
      prodottoId: bollaRigheTable.prodottoId,
      prodottoNome: prodottiTable.nome,
      prodottoCodice: prodottiTable.codice,
      unitaMisura: prodottiTable.unitaMisura,
      quantitaRichiesta: sum(bollaRigheTable.quantita),
      numConsegne: countDistinct(consegneTable.id),
    })
    .from(consegneTable)
    .innerJoin(
      bolleTable,
      and(
        eq(bolleTable.consegnaId, consegneTable.id),
        ne(bolleTable.stato, "annullato"),
      ),
    )
    .innerJoin(bollaRigheTable, eq(bollaRigheTable.bollaId, bolleTable.id))
    .innerJoin(prodottiTable, eq(prodottiTable.id, bollaRigheTable.prodottoId))
    .where(
      and(
        eq(consegneTable.stato, "pianificata"),
        inArray(bolleTable.magazzinoId, magIds),
      ),
    )
    .groupBy(bollaRigheTable.prodottoId, prodottiTable.id)
    .orderBy(asc(prodottiTable.nome));

  // 3) Current stock per product across the same warehouse(s).
  const stockRows = await db
    .select({
      prodottoId: lottiTable.prodottoId,
      giacenzaFisica: sum(lottiTable.quantitaResidua),
    })
    .from(lottiTable)
    .where(
      and(
        inArray(lottiTable.magazzinoId, magIds),
        gt(lottiTable.quantitaResidua, "0"),
          lottoDistribuibileCondition(),
      ),
    )
    .groupBy(lottiTable.prodottoId);
  const stockMap = new Map(
    stockRows.map((s) => [s.prodottoId, parseDbNumber(s.giacenzaFisica)]),
  );

  const impegnatoRows = await db
    .select({
      prodottoId: prenotazioniMagazzinoTable.prodottoId,
      impegnato: sum(prenotazioniMagazzinoTable.quantita),
    })
    .from(prenotazioniMagazzinoTable)
      .innerJoin(
        lottiTable,
        eq(prenotazioniMagazzinoTable.lottoId, lottiTable.id),
      )
    .where(
      and(
        inArray(prenotazioniMagazzinoTable.magazzinoId, magIds),
        eq(prenotazioniMagazzinoTable.stato, PRENOTAZIONE_MAGAZZINO_ATTIVA),
          lottoDistribuibileCondition(),
      ),
    )
    .groupBy(prenotazioniMagazzinoTable.prodottoId);
  const impegnatoMap = new Map(
    impegnatoRows.map((p) => [p.prodottoId, parseDbNumber(p.impegnato)]),
  );

  // 4) The deliveries included (one row per non-annullato bolla of a planned consegna).
  const consRows = await db
    .select({
      consegnaId: consegneTable.id,
      codice: consegneTable.codice,
      beneficiarioId: consegneTable.beneficiarioId,
      beneficiarioNome: beneficiariTable.nome,
      beneficiarioCognome: beneficiariTable.cognome,
      dataPrevista: consegneTable.dataPrevista,
      tipoConsegna: consegneTable.tipoConsegna,
      bollaId: bolleTable.id,
      bollaNumero: bolleTable.numeroBolla,
    })
    .from(consegneTable)
    .innerJoin(
      bolleTable,
      and(
        eq(bolleTable.consegnaId, consegneTable.id),
        ne(bolleTable.stato, "annullato"),
      ),
    )
    .innerJoin(
      beneficiariTable,
      eq(beneficiariTable.id, consegneTable.beneficiarioId),
    )
    .where(
      and(
        eq(consegneTable.stato, "pianificata"),
        inArray(bolleTable.magazzinoId, magIds),
      ),
    )
    .orderBy(asc(consegneTable.dataPrevista));

  const righe = righeRows.map((r) => {
    const richiesta = parseFloat(r.quantitaRichiesta ?? "0");
    const giacenzaFisica = stockMap.get(r.prodottoId) ?? 0;
    const impegnato = impegnatoMap.get(r.prodottoId) ?? 0;
    const disponibile = Math.max(0, giacenzaFisica - impegnato);
    return {
      prodottoId: r.prodottoId,
      prodottoNome: r.prodottoNome,
      prodottoCodice: r.prodottoCodice,
      unitaMisura: r.unitaMisura,
      quantitaRichiesta: richiesta,
      numConsegne: Number(r.numConsegne),
      quantitaDisponibile: disponibile,
      sufficiente: disponibile >= richiesta,
    };
  });

  const consegne = consRows.map((c) => ({
    consegnaId: c.consegnaId,
    codice: c.codice,
    beneficiarioId: c.beneficiarioId,
    beneficiarioNome: `${c.beneficiarioCognome ?? ""} ${c.beneficiarioNome ?? ""}`.trim(),
    dataPrevista: c.dataPrevista ?? null,
    tipoConsegna: c.tipoConsegna,
    bollaId: c.bollaId,
    bollaNumero: c.bollaNumero,
  }));

  res.json({ righe, consegne });
});

export default router;
