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
};

export type ReportKpi = {
  key: string;
  value: number | null;
  unit: "count" | "quantity" | "kg" | "credit" | "days" | "average";
  availability: ReportAvailability;
  drilldownMetric: string | null;
};

export type ReportSeriesPoint = {
  label: string;
  value: number;
  secondaryValue?: number | null;
};

export type ReportSeries = {
  key: string;
  points: ReportSeriesPoint[];
};

export type ReportCell = string | number | boolean | null;

export type ReportTable = {
  key: string;
  columns: string[];
  rows: Array<Record<string, ReportCell>>;
};

export type ReportQualityItem = {
  key: string;
  count: number | null;
  availability: ReportAvailability;
  note: string | null;
};

export type ReportingDashboard = {
  section: ReportSection;
  filters: Omit<
    ReportFilters,
    | "areaOperativaMode"
    | "centroMode"
    | "zonaMode"
    | "callerAreas"
    | "callerPermissions"
    | "callerIsAdmin"
  >;
  kpi: ReportKpi[];
  series: ReportSeries[];
  tables: ReportTable[];
  quality: ReportQualityItem[];
  definitions: string[];
  generatedAt: string;
  timezone: "Europe/Rome";
};

export type ReportDrilldown = {
  section: ReportSection;
  metric: string;
  page: number;
  pageSize: number;
  total: number;
  columns: string[];
  rows: Array<Record<string, ReportCell>>;
};

export function publicFilters(filters: ReportFilters): ReportingDashboard["filters"] {
  const {
    areaOperativaMode: _areaOperativaMode,
    centroMode: _centroMode,
    zonaMode: _zonaMode,
    callerAreas: _callerAreas,
    callerPermissions: _callerPermissions,
    callerIsAdmin: _callerIsAdmin,
    ...result
  } = filters;
  return result;
}
