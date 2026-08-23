import {
  useGetReportCentroAscolto,
  useGetReportDashboardGenerale,
  useGetReportEmporio,
  useGetReportFsePlusIntegrato,
  useGetReportMagazzinoLogistica,
  useGetReportMensaIntegrato,
  useGetReportPacchi,
  useGetReportUdsIntegrato,
  type GetReportDrilldownParams,
  type ReportingDashboard,
  type ReportingDashboardSection,
} from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReportFilters, type ReportingFilterState } from "@/components/reporting/report-filters";
import { ReportKpiCard } from "@/components/reporting/report-kpi-card";
import { ReportChartCard } from "@/components/reporting/report-chart-card";
import { ReportTable } from "@/components/reporting/report-table";
import { ReportDataQuality } from "@/components/reporting/report-data-quality";
import { ReportExportActions } from "@/components/reporting/report-export-actions";
import { ReportDrilldown } from "@/components/reporting/report-drilldown";
import { ReportEmptyState } from "@/components/reporting/report-empty-state";
import { useAuth } from "@/lib/auth";
import { todayEuropeRome } from "@/lib/europe-rome";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { localizeReportingText } from "@/lib/reporting-text";
import { FseOperations } from "@/components/reporting/fse-operations";

type Section = ReportingDashboardSection;

type CommonParams = {
  da?: string;
  a?: string;
  anno?: number;
  areaOperativaId?: number;
  centroAscoltoId?: number;
  magazzinoId?: number;
  mensaId?: number;
  zonaUdsId?: number;
};

function positiveId(params: URLSearchParams, key: string, fallback: number | null) {
  const raw = params.get(key);
  if (raw == null) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function initialFilters(user: ReturnType<typeof useAuth>["user"]): ReportingFilterState {
  const today = todayEuropeRome();
  const params = new URLSearchParams(window.location.search);
  const validDate = (value: string | null, fallback: string) =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
  return {
    da: validDate(params.get("da"), `${today.slice(0, 4)}-01-01`),
    a: validDate(params.get("a"), today),
    areaOperativaId: positiveId(params, "areaOperativaId", user?.areaOperativaId ?? null),
    centroAscoltoId: positiveId(params, "centroAscoltoId", user?.centroAscoltoId ?? null),
    magazzinoId: positiveId(params, "magazzinoId", null),
    mensaId: positiveId(params, "mensaId", null),
    zonaUdsId: positiveId(params, "zonaUdsId", user?.zonaUdsId ?? null),
  };
}

function writeFiltersToUrl(filters: ReportingFilterState) {
  const params = new URLSearchParams();
  params.set("da", filters.da);
  params.set("a", filters.a);
  for (const key of ["areaOperativaId", "centroAscoltoId", "magazzinoId", "mensaId", "zonaUdsId"] as const) {
    if (filters[key] != null) params.set(key, String(filters[key]));
  }
  window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function apiParams(filters: ReportingFilterState): CommonParams {
  return {
    da: filters.da,
    a: filters.a,
    anno: Number(filters.a.slice(0, 4)),
    areaOperativaId: filters.areaOperativaId ?? undefined,
    centroAscoltoId: filters.centroAscoltoId ?? undefined,
    magazzinoId: filters.magazzinoId ?? undefined,
    mensaId: filters.mensaId ?? undefined,
    zonaUdsId: filters.zonaUdsId ?? undefined,
  };
}

function QueryContent({
  section,
  filters,
  query,
}: {
  section: Section;
  filters: ReportingFilterState;
  query: {
    data: ReportingDashboard | undefined;
    isLoading: boolean;
    isError: boolean;
  };
}) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<string | null>(null);
  if (query.isLoading) {
    return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div>;
  }
  if (query.isError) {
    return <Alert variant="destructive"><AlertDescription>{t("reporting.error")}</AlertDescription></Alert>;
  }
  const report = query.data;
  if (!report) return <ReportEmptyState />;
  const drilldownParams: Omit<GetReportDrilldownParams, "page" | "pageSize"> | null = metric
    ? { section, metric, ...apiParams(filters) }
    : null;
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t("reporting.generated", { value: new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short", timeZone: report.timezone }).format(new Date(report.generatedAt)) })}</p>
        <ReportExportActions report={report} />
      </div>
      {report.kpi.length === 0 ? <ReportEmptyState /> : (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {report.kpi.map((item) => <ReportKpiCard key={item.key} item={item} onOpen={item.drilldownMetric ? () => setMetric(item.drilldownMetric) : undefined} />)}
        </section>
      )}
      {report.series.length > 0 && <section className="grid gap-4 xl:grid-cols-2">{report.series.map((series) => <ReportChartCard key={series.key} series={series} />)}</section>}
      {report.tables.length > 0 && <section className="grid gap-4 xl:grid-cols-2">{report.tables.map((table) => <ReportTable key={table.key} table={table} />)}</section>}
      <ReportDataQuality items={report.quality} />
      {report.definitions.length > 0 && (
        <section className="rounded-lg border bg-muted/30 p-4">
          <h2 className="font-semibold">{t("reporting.definitions.title")}</h2>
          <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-muted-foreground">{report.definitions.map((definition) => <li key={definition}>{localizeReportingText(t, definition)}</li>)}</ul>
        </section>
      )}
      <ReportDrilldown open={metric != null} onOpenChange={(open) => { if (!open) setMetric(null); }} params={drilldownParams} />
    </div>
  );
}

function ReportLoader({ section, filters }: { section: Section; filters: ReportingFilterState }) {
  const params = useMemo(() => apiParams(filters), [filters]);
  switch (section) {
    case "generale": return <GeneralLoader section={section} filters={filters} params={params} />;
    case "pacchi": return <PacchiLoader section={section} filters={filters} params={params} />;
    case "centro-ascolto": return <CentroLoader section={section} filters={filters} params={params} />;
    case "emporio": return <EmporioLoader section={section} filters={filters} params={params} />;
    case "mensa": return <MensaLoader section={section} filters={filters} params={params} />;
    case "uds": return <UdsLoader section={section} filters={filters} params={params} />;
    case "magazzino-logistica": return <LogisticaLoader section={section} filters={filters} params={params} />;
    case "fse-plus": return <FseLoader section={section} filters={filters} params={params} />;
  }
}

type LoaderProps = { section: Section; filters: ReportingFilterState; params: CommonParams };
function GeneralLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportDashboardGenerale(p.params)} />; }
function PacchiLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportPacchi(p.params)} />; }
function CentroLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportCentroAscolto(p.params)} />; }
function EmporioLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportEmporio(p.params)} />; }
function MensaLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportMensaIntegrato(p.params)} />; }
function UdsLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportUdsIntegrato(p.params)} />; }
function LogisticaLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportMagazzinoLogistica(p.params)} />; }
function FseLoader(p: LoaderProps) { return <QueryContent {...p} query={useGetReportFsePlusIntegrato(p.params)} />; }

export default function ReportingDashboardPage({ section }: { section: Section }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [filters, setFilters] = useState(() => initialFilters(user));
  useEffect(() => {
    const restore = () => setFilters(initialFilters(user));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [user]);
  const updateFilters = (next: ReportingFilterState) => {
    setFilters(next);
    writeFiltersToUrl(next);
  };
  return (
    <div className="space-y-6 p-4 md:p-8">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t(`reporting.sections.${section}.title`)}</h1>
        <p className="mt-1 text-muted-foreground">{t(`reporting.sections.${section}.description`)}</p>
      </header>
      <ReportFilters section={section} value={filters} onChange={updateFilters} />
      {section === "fse-plus" && <FseOperations filters={filters} />}
      <ReportLoader section={section} filters={filters} />
    </div>
  );
}
