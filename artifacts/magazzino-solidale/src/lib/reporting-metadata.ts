import type {
  ReportingDashboard,
  ReportSeries,
} from "@workspace/api-client-react";
import type { ReportingExportLabels, ReportingScopeNames } from "./export";

/** Shared by PDF and XLSX: use the applied server filters, never the pending form. */
export function reportingFilterRows(
  report: ReportingDashboard,
  labels: ReportingExportLabels,
  names: ReportingScopeNames = {},
): string[][] {
  const f = report.filters;
  const value = (
    id: number | null | undefined,
    name: string | null | undefined,
    all: string,
  ) => name ?? (id == null ? all : String(id));
  return [
    [
      labels.metadata.areaOperativa,
      value(
        f.areaOperativaId,
        names.areaOperativa,
        labels.metadata.allAreeOperative,
      ),
    ],
    [
      labels.metadata.centre,
      value(f.centroAscoltoId, names.centre, labels.metadata.allCentres),
    ],
    [
      labels.metadata.warehouse,
      value(f.magazzinoId, names.warehouse, labels.metadata.allWarehouses),
    ],
    [
      labels.metadata.mensa,
      value(f.mensaId, names.mensa, labels.metadata.allMense),
    ],
    [
      labels.metadata.zone,
      value(f.zonaUdsId, names.zone, labels.metadata.allZones),
    ],
    ...(f.operatoreId == null
      ? []
      : [[labels.column("operatore"), String(f.operatoreId)]]),
    ...(f.tipoIntervento == null
      ? []
      : [[labels.column("tipoIntervento"), f.tipoIntervento]]),
    ...(f.tipoServizio == null
      ? []
      : [[labels.column("tipoServizio"), f.tipoServizio]]),
  ];
}

export function reportingSeriesLabel(
  series: ReportSeries,
  secondary: boolean,
  labels: Pick<ReportingExportLabels, "column" | "unit"> & {
    metadata: Pick<ReportingExportLabels["metadata"], "value">;
  },
): string {
  const measure = secondary ? series.secondary : series.primary;
  if (measure) {
    const unit = labels.unit(measure.unit);
    return unit
      ? `${labels.column(measure.label)} (${unit})`
      : labels.column(measure.label);
  }
  return secondary ? labels.column("valoreSecondario") : labels.metadata.value;
}
