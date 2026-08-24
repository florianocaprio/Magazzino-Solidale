import type {
  ReportFilters,
  ReportKpi,
  ReportQualityItem,
  ReportSection,
  ReportSeries,
  ReportTable,
  ReportingDashboard,
} from "./types";
import { publicFilters } from "./types";
import { REPORTING_MODEL_VERSION } from "./version";

export function kpi(
  key: string,
  value: number | null,
  unit: ReportKpi["unit"] = "count",
  drilldownMetric: string | null = null,
  availability: ReportKpi["availability"] = value == null ? "missing" : "ok",
  exactValue: string | null = value == null ? null : String(value),
): ReportKpi {
  return { key, value, exactValue, unit, drilldownMetric, availability };
}

export function quality(
  key: string,
  count: number | null,
  availability: ReportQualityItem["availability"] = "ok",
  note: string | null = null,
): ReportQualityItem {
  return { key, count, availability, note };
}

export function dashboard(input: {
  section: ReportSection;
  filters: ReportFilters;
  kpi: ReportKpi[];
  series?: ReportSeries[];
  tables?: ReportTable[];
  quality?: ReportQualityItem[];
  definitions: string[];
}): ReportingDashboard {
  return {
    reportingModelVersion: REPORTING_MODEL_VERSION,
    section: input.section,
    filters: publicFilters(input.filters),
    kpi: input.kpi,
    series: input.series ?? [],
    tables: input.tables ?? [],
    quality: input.quality ?? [],
    definitions: input.definitions,
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Rome",
  };
}
