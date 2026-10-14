import {
  prepareReportExport,
  type PrepareReportExportParams,
  type ReportingDashboard,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import {
  buildReportingPdf,
  downloadReportingBlob,
  exportReportingWorkbook,
} from "@/lib/export";
import { localizeReportingText } from "@/lib/reporting-text";

export function ReportExportActions({
  report,
}: {
  report: ReportingDashboard;
}) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [includeDetail, setIncludeDetail] = useState(false);
  const [generation, setGeneration] = useState<string | null>(null);
  const currentContext = JSON.stringify([
    user,
    report.section,
    report.filters,
    i18n.resolvedLanguage,
    includeDetail,
  ]);
  const context = useRef(currentContext);
  context.current = currentContext;
  const abort = useRef<AbortController | null>(null);
  const previews = useRef<
    Array<{
      window: Window;
      url: string;
      timer: ReturnType<typeof setInterval>;
    }>
  >([]);
  useEffect(() => {
    setError(null);
    setLoading(false);
    setGeneration(null);
    return () => {
      abort.current?.abort();
      for (const preview of previews.current) {
        preview.window.close();
        URL.revokeObjectURL(preview.url);
        clearInterval(preview.timer);
      }
      previews.current = [];
    };
  }, [currentContext]);
  const title = t(`reporting.sections.${report.section}.title`);
  const filename = `report_${report.section}_${report.filters.da}_${report.filters.a}`;
  const kpiLabel = (key: string) => t(`reporting.kpi.${key}`);
  const unavailable = t("reporting.unavailable");
  const exportLabels = {
    title,
    kpi: kpiLabel,
    table: (key: string) => t(`reporting.tables.${key}`),
    quality: (key: string) => t(`reporting.quality.${key}`),
    column: (key: string) => t(`reporting.columns.${key}`),
    unit: (key: string) => t(`reporting.units.${key}`),
    availability: (key: string) => t(`reporting.availability.${key}`),
    text: localizeReportingText.bind(null, t),
    unavailable,
    locale: i18n.resolvedLanguage ?? i18n.language,
    metadata: {
      from: t("reporting.export.from"),
      to: t("reporting.export.to"),
      areaOperativa: t("reporting.export.areaOperativa"),
      centre: t("reporting.export.centre"),
      warehouse: t("reporting.export.warehouse"),
      mensa: t("reporting.export.mensa"),
      zone: t("reporting.export.zone"),
      allAreeOperative: t("reporting.filters.allAreeOperative"),
      allCentres: t("reporting.filters.allCentres"),
      allWarehouses: t("reporting.filters.allWarehouses"),
      allMense: t("reporting.filters.allMense"),
      allZones: t("reporting.filters.allZones"),
      generatedAt: t("reporting.export.generatedAt"),
      application: t("reporting.export.application"),
      indicator: t("reporting.export.indicator"),
      value: t("reporting.export.value"),
      unit: t("reporting.export.unit"),
      availability: t("reporting.export.availability"),
      definitions: t("reporting.export.definitions"),
      notes: t("reporting.export.notes"),
      rows: t("reporting.export.rows"),
      reportGeneratedBy: t("reporting.export.reportGeneratedBy"),
    },
  };
  const generate = async (kind: "pdf" | "excel" | "print") => {
    // Opening inside the click gesture allows a reliable popup-blocked message.
    const preview = kind === "print" ? window.open("", "_blank") : null;
    if (kind === "print" && !preview) {
      setError(t("reporting.export.popupBlocked"));
      return;
    }
    if (preview) preview.opener = null;
    const started = context.current;
    const controller = new AbortController();
    abort.current = controller;
    const valid = () =>
      !controller.signal.aborted && started === context.current;
    setLoading(true);
    setError(null);
    try {
      const language = (i18n.resolvedLanguage ?? "it").split(
        "-",
      )[0] as PrepareReportExportParams["language"];
      const prepared = await prepareReportExport(
        {
          section: report.section,
          language,
          detail: includeDetail ? "fse-control" : "none",
          da: report.filters.da,
          a: report.filters.a,
          anno: report.filters.anno,
          areaOperativaId: report.filters.areaOperativaId ?? undefined,
          centroAscoltoId: report.filters.centroAscoltoId ?? undefined,
          magazzinoId: report.filters.magazzinoId ?? undefined,
          mensaId: report.filters.mensaId ?? undefined,
          zonaUdsId: report.filters.zonaUdsId ?? undefined,
          operatoreId: report.filters.operatoreId ?? undefined,
          tipoIntervento: report.filters.tipoIntervento ?? undefined,
          tipoServizio: report.filters.tipoServizio ?? undefined,
        },
        { signal: controller.signal },
      );
      if (!valid()) {
        preview?.close();
        return;
      }
      const { options, report: fresh } = prepared;
      setGeneration(`${fresh.generatedAt} · ${prepared.datasetId}`);
      const scopeNames = {
        areaOperativa: options.areeOperative.find(
          (item) => item.id === fresh.filters.areaOperativaId,
        )?.nome,
        centre: options.centres.find(
          (item) => item.id === fresh.filters.centroAscoltoId,
        )?.nome,
        warehouse: options.warehouses.find(
          (item) => item.id === fresh.filters.magazzinoId,
        )?.nome,
        mensa: options.mense.find((item) => item.id === fresh.filters.mensaId)
          ?.nome,
        zone: options.zones.find((item) => item.id === fresh.filters.zonaUdsId)
          ?.nome,
      };
      if (kind === "excel") {
        exportReportingWorkbook(
          `${filename}_${prepared.datasetId}`,
          fresh,
          exportLabels,
          scopeNames,
          prepared.detail,
          prepared.datasetId,
        );
      } else {
        const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
        const blob = await buildReportingPdf({
          title,
          report: fresh,
          labels: exportLabels,
          scopeNames,
          datasetId: prepared.datasetId,
          detail: prepared.detail,
          branding: { ...branding, logoDataUrl },
        });
        if (!valid()) {
          preview?.close();
          return;
        }
        if (preview) {
          if (preview.closed) return;
          const url = URL.createObjectURL(blob);
          // A native PDF viewer is not available in every browser. Keep a real
          // preview document and a download fallback instead of a blank popup.
          preview.document.title = title;
          const link = preview.document.createElement("a");
          link.href = url;
          link.download = `${filename}_${prepared.datasetId}.pdf`;
          link.textContent = t("common.exportPdf");
          link.style.cssText =
            "display:block;padding:12px;font:16px sans-serif";
          const frame = preview.document.createElement("iframe");
          frame.src = url;
          frame.title = title;
          frame.style.cssText = "width:100%;height:calc(100vh - 55px);border:0";
          preview.document.body.replaceChildren(link, frame);
          preview.document.documentElement.dir = i18n.dir();
          const timer = setInterval(() => {
            if (preview.closed) {
              URL.revokeObjectURL(url);
              clearInterval(timer);
              previews.current = previews.current.filter(
                (item) => item.url !== url,
              );
            }
          }, 1000);
          previews.current.push({ window: preview, url, timer });
        } else
          downloadReportingBlob(blob, `${filename}_${prepared.datasetId}.pdf`);
      }
    } catch (cause) {
      preview?.close();
      if (valid())
        setError(
          `${t("reporting.export.failed")}${cause instanceof Error ? `: ${cause.message}` : ""}`,
        );
    } finally {
      if (valid()) setLoading(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {report.section === "fse-plus" && (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeDetail}
            onChange={(event) => setIncludeDetail(event.target.checked)}
          />
          {t("reporting.export.includeDetail")}
        </label>
      )}
      <Button
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={loading || !user}
        onClick={() => void generate("excel")}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
        )}
        {t("common.exportExcel")}
      </Button>
      <Button
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={loading || !user}
        onClick={() => void generate("pdf")}
      >
        {loading ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <FileText className="mr-2 h-4 w-4 text-red-600" />
        )}
        {t("common.exportPdf")}
      </Button>
      <Button
        variant="outline"
        className="min-h-11 min-w-11"
        disabled={loading || !user}
        onClick={() => void generate("print")}
      >
        <Printer className="mr-2 h-4 w-4" />
        {t("reporting.export.print")}
      </Button>
      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
      {generation && (
        <p
          role="status"
          className="w-full break-all text-sm text-muted-foreground"
        >
          {t("reporting.export.newGeneration")}: {generation}
        </p>
      )}
    </div>
  );
}
