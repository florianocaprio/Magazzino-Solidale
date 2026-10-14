import type { ReportFilters } from "../../src/lib/reporting/types";

/** Builder oracle for facts produced by the real workflow tests. This does not
 * certify HTTP authorization; that is covered by persisted-session SEC tests. */
export function reportingOracleFilters(
  date: string,
  scope: Partial<ReportFilters>,
): ReportFilters {
  return {
    da: date,
    a: date,
    anno: Number(date.slice(0, 4)),
    areaOperativaId: null,
    centroAscoltoId: null,
    magazzinoId: null,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: null,
    tipoIntervento: null,
    tipoServizio: null,
    areaOperativaMode: "query",
    centroMode: "all",
    zonaMode: "all",
    callerAreas: ["analisi", "magazzino", "logistica", "mensa", "emporio"],
    callerPermissions: [],
    callerIsAdmin: true,
    ...scope,
  };
}
