import { sql } from "drizzle-orm";
import { InventoryDecimal } from "../inventoryDecimal";
import {
  calcolaImpegnatoAttivoPrecisoPerGiacenze,
  disponibilitaMagazzinoKey,
} from "../disponibilitaMagazzino";
import { dataOperativaEuropeRome } from "../lottoPolicy";
import { reportExecutor, isReportModuleActive } from "./queryContext";
import { andSql, reportScope, rows } from "./sql";
import { kpi, text } from "./shared";
import { emptyReportPanel, type ReportPanel } from "./requests";
import type { ReportFilters } from "./types";

export async function availableStockPanel(
  filters: ReportFilters,
): Promise<ReportPanel> {
  if (
    !filters.callerIsAdmin &&
    !filters.callerPermissions.includes("magazzino.view")
  )
    return emptyReportPanel();
  if (
    !(await isReportModuleActive("MAGAZZINO_SOLIDALE")) ||
    !(await isReportModuleActive("LOTTI"))
  )
    return emptyReportPanel();
  const reference = dataOperativaEuropeRome();
  const data = await rows<{
    prodottoId: number;
    magazzinoId: number;
    prodotto: string;
    magazzino: string;
    unita: string;
    fisica: string;
    distribuibile: string;
    soglia: string;
  }>(sql`
    SELECT p.id AS "prodottoId",mg.id AS "magazzinoId",p.nome AS prodotto,mg.nome AS magazzino,
      p.unita_misura AS unita,SUM(l.quantita_residua)::text AS fisica,
      COALESCE(SUM(l.quantita_residua) FILTER (WHERE l.data_scadenza IS NULL OR l.data_scadenza >= ${reference}),0)::text AS distribuibile,
      p.scorta_minima::text AS soglia
    FROM lotti l JOIN prodotti p ON p.id=l.prodotto_id JOIN magazzini mg ON mg.id=l.magazzino_id
    WHERE l.quantita_residua>0 AND mg.area_operativa_id IS NOT NULL AND ${andSql(reportScope(filters, { areaOperativa: sql`mg.area_operativa_id`, centro: sql`mg.centro_ascolto_id`, magazzino: sql`mg.id` }, { sharedCentro: true }))}
    GROUP BY p.id,mg.id ORDER BY p.id,mg.id
  `);
  const reserved = await calcolaImpegnatoAttivoPrecisoPerGiacenze(
    data,
    reportExecutor(),
    reference,
  );
  const stock = data.map((row) => {
    const impegnato =
      reserved.get(
        disponibilitaMagazzinoKey(row.prodottoId, row.magazzinoId),
      ) ?? "0";
    const disponibile = InventoryDecimal.parse(row.distribuibile).subtract(
      InventoryDecimal.parse(impegnato),
    );
    return {
      ...row,
      impegnato,
      disponibile: disponibile.toDb(),
      sottoscorta:
        disponibile.compare(InventoryDecimal.parse(row.soglia ?? "0")) <= 0,
    };
  });
  return {
    kpi: [
      kpi(
        "coppieSottoscortaDisponibile",
        stock.filter((r) => r.sottoscorta).length,
      ),
    ],
    tables: [
      {
        key: "disponibilitaCorrente",
        columns: [
          "prodotto",
          "magazzino",
          "unita",
          "fisica",
          "distribuibile",
          "impegnato",
          "disponibile",
          "soglia",
          "sottoscorta",
        ],
        rows: stock,
      },
    ],
    quality: [],
    definitions: [text("availableStockCurrent", { date: reference })],
  };
}
