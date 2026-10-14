import { sql, type SQL } from "drizzle-orm";
import { buildFseCanonicalReport } from "../fseCanonicalReporting";
import { reportExecutor } from "./queryContext";
import { rows } from "./sql";
import { ReportingError } from "./filters";
import { kpi, text } from "./shared";
import type { ReportFilters } from "./types";
import { emptyReportPanel, type ReportPanel } from "./requests";

/** Canonical M6.4 preview only: never generates exports or administrative coverage. */
export async function fseQueuePanel(
  filters: ReportFilters,
  warehouseScope: SQL,
  authorized: SQL,
): Promise<ReportPanel> {
  const source = await rows<{ id: number; magazzinoId: number }>(sql`
    SELECT mv.id,mv.magazzino_id AS "magazzinoId" FROM movimenti mv
    LEFT JOIN movimenti original ON original.id=mv.movimento_origine_id
    JOIN magazzini mg ON mg.id=mv.magazzino_id
    WHERE mv.fondo_origine='FSE_PLUS' AND mv.data_movimento<=${filters.a}
      AND ${warehouseScope} AND ${authorized}
    ORDER BY mv.magazzino_id,mv.id LIMIT 10001`);
  if (source.length > 10000)
    throw new ReportingError(
      413,
      "Coda FSE troppo ampia: selezionare un Magazzino o un periodo più stretto",
    );
  const byWarehouse = new Map<number, number[]>();
  for (const row of source) {
    const ids = byWarehouse.get(row.magazzinoId) ?? [];
    ids.push(row.id);
    byWarehouse.set(row.magazzinoId, ids);
  }
  const totals = { assess: 0, generable: 0, blocked: 0, backlog: 0 };
  for (const [magazzinoId, movementIds] of byWarehouse) {
    const current = await buildFseCanonicalReport({
      magazzinoId,
      movementIds,
      dataDa: filters.da,
      dataA: filters.a,
      dataAsOf: filters.a,
      includeArretrati: true,
      excludeCovered: true,
      executor: reportExecutor(),
    });
    totals.assess += current.events.length;
    totals.generable += current.events.filter(
      (event) => event.coverageEligible && !event.blocking,
    ).length;
    totals.blocked += current.events.filter((event) => event.blocking).length;
    totals.backlog += current.events.filter(
      (event) => event.coverageEligible && !event.blocking && event.arretrato,
    ).length;
  }
  const result = emptyReportPanel();
  result.kpi = [
    kpi("fseEventiDaValutare", totals.assess),
    kpi("fseEventiGenerabili", totals.generable),
    kpi("fseEventiQualitaBloccante", totals.blocked),
    kpi("fseGenerabiliArretrati", totals.backlog),
  ];
  result.definitions = [text("fseCanonicalQueue")];
  return result;
}
