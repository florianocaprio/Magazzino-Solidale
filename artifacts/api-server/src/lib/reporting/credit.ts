import { sql } from "drizzle-orm";
import { andSql, reportScope, rows, utcTimestampRomeDate } from "./sql";
import { kpi, quality, text } from "./shared";
import type { ReportFilters } from "./types";
import type { ReportPanel } from "./requests";

export async function creditFlowPanel(
  filters: ReportFilters,
): Promise<ReportPanel> {
  if (filters.magazzinoId != null)
    return {
      kpi: [],
      tables: [],
      quality: [quality("creditoMagazzinoNonDisponibile", null, "missing")],
      definitions: [text("creditFlowBasis")],
    };
  const flows = await rows<Record<string, string>>(sql`
    SELECT cm.tipo_movimento AS tipo,COUNT(*)::text AS eventi,
      SUM(cm.variazione_credito)::text AS variazione,
      COUNT(*) FILTER (WHERE cm.variazione_credito <> trunc(cm.variazione_credito))::text AS frazionari
    FROM credito_solidale_movimenti cm
    WHERE ${utcTimestampRomeDate(sql`cm.data_movimento`)} BETWEEN ${filters.da} AND ${filters.a}
      AND ${andSql(reportScope(filters, { areaOperativa: sql`cm.area_operativa_id`, centro: sql`cm.centro_ascolto_id` }))}
    GROUP BY cm.tipo_movimento ORDER BY cm.tipo_movimento
  `);
  return {
    kpi: [kpi("creditoSaldoAsOf", null, "credit")],
    tables: [
      {
        key: "creditoFlussiPeriodo",
        columns: ["tipo", "eventi", "variazione", "frazionari"],
        rows: flows,
      },
    ],
    quality: [],
    definitions: [text("creditFlowBasis")],
  };
}
