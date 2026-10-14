import type {
  ReportFilters,
  ReportKpi,
  ReportQualityItem,
  ReportSection,
  ReportSeries,
  ReportTable,
  ReportText,
  ReportingDashboard,
} from "./types";
import { publicFilters } from "./types";
import { REPORTING_MODEL_VERSION } from "./version";

/** Keep SQL integer/decimal text alongside the intentionally approximate graph value. */
export function numericMetrics<T extends Record<string, unknown>>(input: T) {
  const exact = Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, String(value ?? "0")]),
  );
  return {
    ...Object.fromEntries(
      Object.entries(exact).map(([key, value]) => [key, Number(value)]),
    ),
    exact,
  } as { [K in keyof T]: number } & { exact: { [K in keyof T]: string } };
}

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
  note: ReportText | null = null,
): ReportQualityItem {
  return { key, count, availability, note };
}

export function text(
  code: string,
  params?: Record<string, string | number>,
): ReportText {
  return params ? { code, params } : { code };
}

export function dashboard(input: {
  section: ReportSection;
  filters: ReportFilters;
  kpi: ReportKpi[];
  series?: ReportSeries[];
  tables?: ReportTable[];
  quality?: ReportQualityItem[];
  definitions: ReportText[];
  excludedSources?: ReportText[];
  exactKpi?: Record<string, string | null>;
}): ReportingDashboard {
  return {
    reportingModelVersion: REPORTING_MODEL_VERSION,
    definitionRevision: "M66_BC_1",
    excludedSources: input.excludedSources ?? [],
    section: input.section,
    filters: publicFilters(input.filters),
    kpi: input.kpi.map((item) =>
      input.exactKpi && Object.hasOwn(input.exactKpi, item.key)
        ? { ...item, exactValue: input.exactKpi[item.key] }
        : item,
    ),
    series: input.series ?? [],
    tables: input.tables ?? [],
    quality: input.quality ?? [],
    definitions: input.definitions,
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Rome",
  };
}
