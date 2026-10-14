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

// Definition-owned measures, shared by UI and document consumers through the DTO.
const SERIES_MEASURES: Record<string, [string, string, string?, string?]> = {
  attivitaPerMeseArea: ["eventi", "count", "personeMese", "count"],
  pacchiPerMese: ["pacchi", "count", "nuclei", "count"],
  interventiPerMese: ["interventi", "count", "persone", "count"],
  spesePerMese: ["spese", "count", "credito", "credit"],
  pastiPerGiorno: ["pasti", "count", "persone", "count"],
  pastiPerMese: ["pasti", "count", "persone", "count"],
  movimentiPerMese: ["carichi", "count", "scarichi", "count"],
  canali: ["documenti", "count", "nuclei", "count"],
};
function seriesWithMeasures(series: ReportSeries): ReportSeries {
  const definition = SERIES_MEASURES[series.key];
  if (!definition) return series;
  const [label, unit, secondaryLabel, secondaryUnit] = definition;
  return {
    ...series,
    primary: { label, unit },
    ...(secondaryLabel && secondaryUnit
      ? { secondary: { label: secondaryLabel, unit: secondaryUnit } }
      : {}),
  };
}

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
    series: (input.series ?? []).map(seriesWithMeasures),
    tables: input.tables ?? [],
    quality: input.quality ?? [],
    definitions: input.definitions,
    generatedAt: new Date().toISOString(),
    timezone: "Europe/Rome",
  };
}
