import {
  getReportDrilldown,
  useGetReportFilterOptions,
  type ReportDrilldown,
  type ReportingDashboard,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import { exportReportingPdf, exportReportingWorkbook } from "@/lib/export";
import { localizeReportingText } from "@/lib/reporting-text";

export function ReportExportActions({ report }: { report: ReportingDashboard }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [pdfLoading, setPdfLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const { data: options } = useGetReportFilterOptions({
    section: report.section,
    areaOperativaId: report.filters.areaOperativaId ?? undefined,
  });
  const title = t(`reporting.sections.${report.section}.title`);
  const filename = `report_${report.section}_${report.filters.da}_${report.filters.a}`;
  const kpiLabel = (key: string) => t(`reporting.kpi.${key}`);
  const unavailable = t("reporting.unavailable");
  const scopeNames = {
    areaOperativa: options?.areeOperative.find((item) => item.id === report.filters.areaOperativaId)?.nome,
    centre: options?.centres.find((item) => item.id === report.filters.centroAscoltoId)?.nome,
    warehouse: options?.warehouses.find((item) => item.id === report.filters.magazzinoId)?.nome,
    mensa: options?.mense.find((item) => item.id === report.filters.mensaId)?.nome,
    zone: options?.zones.find((item) => item.id === report.filters.zonaUdsId)?.nome,
  };
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
      from: t("reporting.export.from"), to: t("reporting.export.to"),
      areaOperativa: t("reporting.export.areaOperativa"), centre: t("reporting.export.centre"),
      warehouse: t("reporting.export.warehouse"), mensa: t("reporting.export.mensa"),
      zone: t("reporting.export.zone"), allAreeOperative: t("reporting.filters.allAreeOperative"),
      allCentres: t("reporting.filters.allCentres"), allWarehouses: t("reporting.filters.allWarehouses"),
      allMense: t("reporting.filters.allMense"), allZones: t("reporting.filters.allZones"),
      generatedAt: t("reporting.export.generatedAt"), application: t("reporting.export.application"),
      indicator: t("reporting.export.indicator"), value: t("reporting.export.value"),
      unit: t("reporting.export.unit"), availability: t("reporting.export.availability"),
      definitions: t("reporting.export.definitions"), notes: t("reporting.export.notes"),
      rows: t("reporting.export.rows"), reportGeneratedBy: t("reporting.export.reportGeneratedBy"),
    },
  };
  const generatedBy = user ? `${user.nome ?? ""} ${user.cognome ?? ""}`.trim() || user.username : undefined;

  const loadFseControl = async (): Promise<ReportDrilldown | null> => {
    if (report.section !== "fse-plus") return null;
    const rows: ReportDrilldown["rows"] = [];
    let page = 1;
    let result: ReportDrilldown;
    do {
      result = await getReportDrilldown({
        section: "fse-plus", metric: "prodottiFse", page, pageSize: 100,
        da: report.filters.da, a: report.filters.a, anno: report.filters.anno,
        areaOperativaId: report.filters.areaOperativaId ?? undefined,
        centroAscoltoId: report.filters.centroAscoltoId ?? undefined,
        magazzinoId: report.filters.magazzinoId ?? undefined,
      });
      rows.push(...result.rows);
      page += 1;
    } while (rows.length < result.total);
    return { ...result, page: 1, pageSize: rows.length || 100, rows };
  };
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={excelLoading} onClick={async () => {
        setExcelLoading(true);
        try {
          exportReportingWorkbook(filename, report, exportLabels, scopeNames, await loadFseControl());
        } finally {
          setExcelLoading(false);
        }
      }}>
        {excelLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />}
        {t("common.exportExcel")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={pdfLoading}
        onClick={async () => {
          setPdfLoading(true);
          try {
            const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
            await exportReportingPdf({ filename, title, report, kpiLabel, unavailable, labels: exportLabels, scopeNames, generatedBy, branding: { ...branding, logoDataUrl } });
          } finally {
            setPdfLoading(false);
          }
        }}
      >
        {pdfLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileText className="mr-2 h-4 w-4 text-red-600" />}
        {t("common.exportPdf")}
      </Button>
    </div>
  );
}
