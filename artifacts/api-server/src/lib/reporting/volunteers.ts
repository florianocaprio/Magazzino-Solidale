import { volunteerAreaFilter, volunteerContextFilter } from "../volontariArea";
import { volontariTable } from "@workspace/db";
import { and } from "drizzle-orm";
import { operationalStatesForRows } from "../volontariOperational";
import { todayRome } from "../volontariDomain";
import { isReportModuleActive, reportExecutor } from "./queryContext";
import { ReportingError } from "./filters";
import { kpi, text } from "./shared";
import { emptyReportPanel, type ReportPanel } from "./requests";
import type { ReportFilters } from "./types";

export async function volunteerReportPanel(
  filters: ReportFilters,
): Promise<ReportPanel> {
  if (
    (!filters.callerIsAdmin &&
      !filters.callerPermissions.includes("logistica.volontari.view")) ||
    !(await isReportModuleActive("VOLONTARI"))
  )
    return emptyReportPanel();
  const executor = reportExecutor();
  const people = await executor
    .select({
      id: volontariTable.id,
      statoApprovazione: volontariTable.statoApprovazione,
      attivo: volontariTable.attivo,
      tipoVolontario: volontariTable.tipoVolontario,
      areaOperativaId: volontariTable.areaOperativaId,
    })
    .from(volontariTable)
    .where(
      and(
        volunteerAreaFilter(filters.areaOperativaId),
        filters.centroAscoltoId == null ? undefined : volunteerContextFilter(filters.centroAscoltoId),
      ),
    )
    .limit(10001);
  if (people.length > 10000)
    throw new ReportingError(
      413,
      "Registro troppo ampio: restringere lo scope",
    );
  const reference = todayRome(); // Administrative current values are NOT an as-of snapshot.
  const states = await operationalStatesForRows(
    executor,
    people,
    reference,
    filters.centroAscoltoId,
  );
  const panel = emptyReportPanel();
  panel.kpi = [
    kpi("volontariIscritti", people.length),
    kpi("volontariAttiviAmministrativi", people.filter((p) => p.attivo).length),
    kpi(
      "volontariOperativi",
      [...states.values()].filter((s) => s.operativo).length,
    ),
    kpi(
      "volontariAssicurazioneCritica",
      [...states.values()].filter((s) =>
        ["MANCANTE", "SCADUTA", "NON_ANCORA_VALIDA", "IN_SCADENZA"].includes(
          s.statoAssicurazione,
        ),
      ).length,
    ),
  ];
  panel.definitions = [text("volunteersCurrent", { date: reference })];
  return panel;
}
