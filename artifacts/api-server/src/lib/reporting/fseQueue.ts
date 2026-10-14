import { sql, type SQL } from "drizzle-orm";
import { summarizeFseCanonicalQueue } from "../fseCanonicalReporting";
import { reportExecutor } from "./queryContext";
import { rows } from "./sql";
import { kpi, text } from "./shared";
import type { ReportFilters } from "./types";
import { emptyReportPanel, type ReportPanel } from "./requests";

/** Canonical M6.4 preview only: never generates exports or administrative coverage. */
export async function fseQueuePanel(
  filters: ReportFilters,
  warehouseScope: SQL,
  authorized: SQL,
): Promise<ReportPanel> {
  const warehouses = await rows<{ magazzinoId: number }>(sql`
    SELECT mg.id AS "magazzinoId" FROM magazzini mg WHERE ${warehouseScope}`);
  const totals = { assess: 0n, generable: 0n, blocked: 0n, backlog: 0n };
  for (const { magazzinoId } of warehouses) {
    const current = await summarizeFseCanonicalQueue({
      magazzinoId,
      dataDa: filters.da,
      dataA: filters.a,
      executor: reportExecutor(),
      authorizedMovement: authorized,
    });
    for (const key of Object.keys(totals) as Array<keyof typeof totals>)
      totals[key] += BigInt(current[key]);
  }
  const result = emptyReportPanel();
  result.kpi = [
    kpi(
      "fseEventiDaValutare",
      Number(totals.assess),
      "count",
      null,
      "ok",
      String(totals.assess),
    ),
    kpi(
      "fseEventiGenerabili",
      Number(totals.generable),
      "count",
      null,
      "ok",
      String(totals.generable),
    ),
    kpi(
      "fseEventiQualitaBloccante",
      Number(totals.blocked),
      "count",
      null,
      "ok",
      String(totals.blocked),
    ),
    kpi(
      "fseGenerabiliArretrati",
      Number(totals.backlog),
      "count",
      null,
      "ok",
      String(totals.backlog),
    ),
  ];
  result.definitions = [text("fseCanonicalQueue")];
  return result;
}
