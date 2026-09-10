import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  FONDI_ORIGINE,
  lottiTable,
  prodottiTable,
  magazziniTable,
  areeOperativeTable,
  type FondoOrigine,
} from "@workspace/db";
import { eq, and, gt, sum, min, sql } from "drizzle-orm";
import {
  callerCentroId,
  callerAreaOperativaId,
  canAccessCentro,
  centroScopeFilter,
  magazzinoScopeFilter,
} from "../lib/centroScope";
import {
  calcolaImpegnatoAttivoPrecisoPerGiacenze,
  disponibilitaMagazzinoKey,
  parseDbNumber,
} from "../lib/disponibilitaMagazzino";
import { requirePermission } from "../middlewares/auth";
import { dataOperativaEuropeRome } from "../lib/lottoPolicy";
import { InventoryDecimal } from "../lib/inventoryDecimal";

const router: IRouter = Router();

function positiveInteger(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
    ? value
    : null;
}

router.get(
  "/giacenze",
  requirePermission("magazzino.view"),
  async (req, res) => {
    const {
      areaOperativaId,
      magazzinoId,
      prodottoId,
      sottoscortaOnly,
      fsePlusOnly,
      fondoOrigine,
      scadenzaDa,
      scadenzaA,
    } = req.query as Record<string, string>;

    const selectedAreaId = positiveInteger(areaOperativaId);
    if (selectedAreaId == null) {
      res.status(400).json({
        error:
          "areaOperativaId è obbligatorio e deve essere un intero positivo",
      });
      return;
    }

    const callerAreaId = callerAreaOperativaId(req);
    if (callerAreaId != null && callerAreaId !== selectedAreaId) {
      res
        .status(403)
        .json({ error: "Area Operativa non accessibile per il tuo profilo" });
      return;
    }

    const [selectedArea] = await db
      .select({ id: areeOperativeTable.id, nome: areeOperativeTable.nome })
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, selectedAreaId));
    if (!selectedArea) {
      res.status(404).json({ error: "Area Operativa inesistente" });
      return;
    }

    const selectedMagazzinoId = magazzinoId
      ? positiveInteger(magazzinoId)
      : null;
    if (magazzinoId && selectedMagazzinoId == null) {
      res
        .status(400)
        .json({ error: "magazzinoId deve essere un intero positivo" });
      return;
    }
    if (sottoscortaOnly === "true" && selectedMagazzinoId == null) {
      res.status(400).json({
        error:
          "Il filtro sottoscorta è disponibile solo selezionando un magazzino",
      });
      return;
    }

    const callerCentro = callerCentroId(req);
    if (selectedMagazzinoId != null) {
      const [selectedMagazzino] = await db
        .select({
          id: magazziniTable.id,
          areaOperativaId: magazziniTable.areaOperativaId,
          centroAscoltoId: magazziniTable.centroAscoltoId,
        })
        .from(magazziniTable)
        .where(eq(magazziniTable.id, selectedMagazzinoId));
      if (!selectedMagazzino) {
        res.status(404).json({ error: "Magazzino non trovato" });
        return;
      }
      if (selectedMagazzino.areaOperativaId !== selectedAreaId) {
        res.status(400).json({
          error:
            "Il magazzino selezionato non appartiene all'Area Operativa richiesta",
        });
        return;
      }
      if (!canAccessCentro(selectedMagazzino.centroAscoltoId, callerCentro)) {
        res
          .status(403)
          .json({ error: "Magazzino non accessibile per il tuo profilo" });
        return;
      }
    }

    const warehouseScope = centroScopeFilter(
      magazziniTable.centroAscoltoId,
      callerCentro,
    );
    const visibleWarehouses = await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(
        and(
          eq(magazziniTable.areaOperativaId, selectedAreaId),
          warehouseScope,
          selectedMagazzinoId == null
            ? undefined
            : eq(magazziniTable.id, selectedMagazzinoId),
        ),
      );

    const conditions = [gt(lottiTable.quantitaResidua, "0")];
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
    if (scadenzaDa)
      conditions.push(sql`${lottiTable.dataScadenza} >= ${scadenzaDa}`);
    if (scadenzaA)
      conditions.push(sql`${lottiTable.dataScadenza} <= ${scadenzaA}`);
    const scope = magazzinoScopeFilter(
      lottiTable.magazzinoId,
      visibleWarehouses.map((warehouse) => warehouse.id),
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

    const impegnatoByKey = await calcolaImpegnatoAttivoPrecisoPerGiacenze(
      rows.map((r) => ({
        prodottoId: r.prodottoId,
        magazzinoId: r.magazzinoId,
      })),
    );

    const result = rows.map((r) => {
      const giacenzaFisicaPrecisa = InventoryDecimal.parse(
        r.quantitaTotale ?? "0",
      );
      const giacenzaFisica = parseDbNumber(giacenzaFisicaPrecisa.toDb());
      const giacenzaScaduta = parseDbNumber(r.giacenzaScaduta);
      const giacenzaDistribuibile = parseDbNumber(r.giacenzaDistribuibile);
      const impegnatoPreciso = InventoryDecimal.parse(
        impegnatoByKey.get(
          disponibilitaMagazzinoKey(r.prodottoId, r.magazzinoId),
        ) ?? "0",
      );
      const giacenzaDistribuibilePrecisa = InventoryDecimal.parse(
        r.giacenzaDistribuibile ?? "0",
      );
      const disponibileRealePreciso =
        giacenzaDistribuibilePrecisa.subtract(impegnatoPreciso);
      const scortaMinimaPrecisa = InventoryDecimal.parse(r.scortaMinima ?? "0");
      const impegnato = parseDbNumber(impegnatoPreciso.toDb());
      const sm = parseDbNumber(scortaMinimaPrecisa.toDb());
      const disponibileReale = parseDbNumber(disponibileRealePreciso.toDb());
      return {
        ambito: "magazzino" as const,
        areaOperativaId: selectedArea.id,
        areaOperativaNome: selectedArea.nome,
        prodottoId: r.prodottoId,
        prodottoNome: r.prodottoNome,
        prodottoCodice: r.prodottoCodice,
        tipoProdotto: r.tipoProdotto,
        unitaMisura: r.unitaMisura,
        magazzinoId: r.magazzinoId,
        magazzinoNome: r.magazzinoNome,
        quantitaTotale: giacenzaFisica,
        quantitaTotalePrecisa: giacenzaFisicaPrecisa.toDb(),
        giacenzaFisica,
        giacenzaFisicaPrecisa: giacenzaFisicaPrecisa.toDb(),
        giacenzaScaduta,
        giacenzaScadutaPrecisa: InventoryDecimal.parse(
          r.giacenzaScaduta ?? "0",
        ).toDb(),
        giacenzaDistribuibile,
        giacenzaDistribuibilePrecisa: giacenzaDistribuibilePrecisa.toDb(),
        impegnato,
        impegnatoPreciso: impegnatoPreciso.toDb(),
        disponibileReale,
        disponibileRealePrecisa: disponibileRealePreciso.toDb(),
        scortaMinima: sm,
        scortaMinimaPrecisa: scortaMinimaPrecisa.toDb(),
        scortaConsigliata: parseDbNumber(r.scortaConsigliata),
        sottoscorta: disponibileRealePreciso.compare(scortaMinimaPrecisa) <= 0,
        lottiAttivi: Number(r.lottiAttivi),
        prossimaScadenza: r.prossimaScadenza ?? null,
      };
    });

    if (selectedMagazzinoId == null) {
      type AreaGiacenza = Omit<
        (typeof result)[number],
        | "ambito"
        | "magazzinoId"
        | "magazzinoNome"
        | "scortaMinima"
        | "scortaMinimaPrecisa"
        | "scortaConsigliata"
        | "sottoscorta"
      > & {
        ambito: "area";
        magazzinoId: null;
        magazzinoNome: null;
        scortaMinima: null;
        scortaMinimaPrecisa: null;
        scortaConsigliata: null;
        sottoscorta: null;
      };
      const aggregate = new Map<string, AreaGiacenza>();
      for (const row of result) {
        const key = `${row.prodottoId}:${row.unitaMisura}`;
        const current = aggregate.get(key);
        if (!current) {
          aggregate.set(key, {
            ...row,
            ambito: "area" as const,
            magazzinoId: null,
            magazzinoNome: null,
            scortaMinima: null,
            scortaMinimaPrecisa: null,
            scortaConsigliata: null,
            sottoscorta: null,
          });
          continue;
        }

        const quantitaTotalePrecisa = InventoryDecimal.parse(
          current.quantitaTotalePrecisa,
        ).add(InventoryDecimal.parse(row.quantitaTotalePrecisa));
        const giacenzaFisicaPrecisa = InventoryDecimal.parse(
          current.giacenzaFisicaPrecisa,
        ).add(InventoryDecimal.parse(row.giacenzaFisicaPrecisa));
        const giacenzaScadutaPrecisa = InventoryDecimal.parse(
          current.giacenzaScadutaPrecisa,
        ).add(InventoryDecimal.parse(row.giacenzaScadutaPrecisa));
        const giacenzaDistribuibilePrecisa = InventoryDecimal.parse(
          current.giacenzaDistribuibilePrecisa,
        ).add(InventoryDecimal.parse(row.giacenzaDistribuibilePrecisa));
        const impegnatoPreciso = InventoryDecimal.parse(
          current.impegnatoPreciso,
        ).add(InventoryDecimal.parse(row.impegnatoPreciso));
        const disponibileRealePreciso = InventoryDecimal.parse(
          current.disponibileRealePrecisa,
          { allowNegative: true },
        ).add(
          InventoryDecimal.parse(row.disponibileRealePrecisa, {
            allowNegative: true,
          }),
        );

        aggregate.set(key, {
          ...current,
          quantitaTotale: parseDbNumber(quantitaTotalePrecisa.toDb()),
          quantitaTotalePrecisa: quantitaTotalePrecisa.toDb(),
          giacenzaFisica: parseDbNumber(giacenzaFisicaPrecisa.toDb()),
          giacenzaFisicaPrecisa: giacenzaFisicaPrecisa.toDb(),
          giacenzaScaduta: parseDbNumber(giacenzaScadutaPrecisa.toDb()),
          giacenzaScadutaPrecisa: giacenzaScadutaPrecisa.toDb(),
          giacenzaDistribuibile: parseDbNumber(
            giacenzaDistribuibilePrecisa.toDb(),
          ),
          giacenzaDistribuibilePrecisa: giacenzaDistribuibilePrecisa.toDb(),
          impegnato: parseDbNumber(impegnatoPreciso.toDb()),
          impegnatoPreciso: impegnatoPreciso.toDb(),
          disponibileReale: parseDbNumber(disponibileRealePreciso.toDb()),
          disponibileRealePrecisa: disponibileRealePreciso.toDb(),
          lottiAttivi: current.lottiAttivi + row.lottiAttivi,
          prossimaScadenza:
            current.prossimaScadenza == null
              ? row.prossimaScadenza
              : row.prossimaScadenza == null
                ? current.prossimaScadenza
                : current.prossimaScadenza < row.prossimaScadenza
                  ? current.prossimaScadenza
                  : row.prossimaScadenza,
        });
      }
      res.json([...aggregate.values()]);
      return;
    }

    const filtered =
      sottoscortaOnly === "true" ? result.filter((r) => r.sottoscorta) : result;
    res.json(filtered);
  },
);

export default router;
