import type { REPORTING_MODEL_VERSION } from "./version";

export type ReportSection =
  | "generale"
  | "pacchi"
  | "centro-ascolto"
  | "emporio"
  | "mensa"
  | "uds"
  | "magazzino-logistica"
  | "fse-plus";

export type ReportAvailability = "ok" | "derivable" | "missing";

export type ReportFilters = {
  da: string;
  a: string;
  anno: number;
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  magazzinoId: number | null;
  mensaId: number | null;
  zonaUdsId: number | null;
  operatoreId: number | null;
  tipoIntervento: string | null;
  tipoServizio: string | null;
  areaOperativaMode: "all" | "caller" | "query";
  centroMode: "all" | "caller" | "query";
  zonaMode: "all" | "caller" | "query";
  callerAreas: string[];
  callerPermissions: string[];
  callerIsAdmin: boolean;
  /** Internal, resolved from current persisted assignments. Never serialized. */
  callerMensaIds?: number[] | null;
  callerUserId?: number;
};

export type ReportKpi = {
  key: string;
  value: number | null;
  exactValue: string | null;
  unit:
    | "count"
    | "pieces"
    | "kgLt"
    | "percentage"
    | "credit"
    | "days"
    | "average"
    | "quantity"
    | "kg";
  availability: ReportAvailability;
  drilldownMetric: string | null;
  numerator?: string;
  denominator?: string;
  presentationDecimals?: number;
};

export type ReportSeriesPoint = {
  label: string;
  value: number;
  secondaryValue?: number | null;
  exactValue?: string;
  exactSecondaryValue?: string | null;
};

export type ReportSeries = {
  key: string;
  points: ReportSeriesPoint[];
};

export type ReportCell = string | number | boolean | null;

export type ReportText = {
  code: string;
  params?: Record<string, string | number>;
};

export type ReportTable = {
  key: string;
  columns: string[];
  rows: Array<Record<string, ReportCell>>;
};

export type ReportQualityItem = {
  key: string;
  count: number | null;
  availability: ReportAvailability;
  note: ReportText | null;
};

export type ReportingDashboard = {
  reportingModelVersion: typeof REPORTING_MODEL_VERSION;
  section: ReportSection;
  filters: Omit<
    ReportFilters,
    | "areaOperativaMode"
    | "centroMode"
    | "zonaMode"
    | "callerAreas"
    | "callerPermissions"
    | "callerIsAdmin"
    | "callerMensaIds"
    | "callerUserId"
  >;
  kpi: ReportKpi[];
  series: ReportSeries[];
  tables: ReportTable[];
  quality: ReportQualityItem[];
  definitions: ReportText[];
  generatedAt: string;
  timezone: "Europe/Rome";
  definitionRevision?: string;
  excludedSources?: ReportText[];
};

export type ReportDrilldown = {
  reportingModelVersion: typeof REPORTING_MODEL_VERSION;
  section: ReportSection;
  metric: string;
  page: number;
  pageSize: number;
  total: number;
  columns: string[];
  rows: Array<Record<string, ReportCell>>;
};

export function publicFilters(
  filters: ReportFilters,
): ReportingDashboard["filters"] {
  const {
    areaOperativaMode: _areaOperativaMode,
    centroMode: _centroMode,
    zonaMode: _zonaMode,
    callerAreas: _callerAreas,
    callerPermissions: _callerPermissions,
    callerIsAdmin: _callerIsAdmin,
    callerMensaIds: _callerMensaIds,
    callerUserId: _callerUserId,
    ...result
  } = filters;
  return result;
}
