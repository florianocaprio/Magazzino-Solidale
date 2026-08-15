import type { ReportingDashboard } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";
import { exportReportingPdf, exportReportingWorkbook } from "@/lib/export";

export function ReportExportActions({ report }: { report: ReportingDashboard }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [pdfLoading, setPdfLoading] = useState(false);
  const title = t(`reporting.sections.${report.section}.title`);
  const filename = `report_${report.section}_${report.filters.da}_${report.filters.a}`;
  const kpiLabel = (key: string) => t(`reporting.kpi.${key}`);
  const unavailable = t("reporting.unavailable");
  const generatedBy = user ? `${user.nome ?? ""} ${user.cognome ?? ""}`.trim() || user.username : undefined;
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" onClick={() => exportReportingWorkbook(filename, report, { title, kpi: kpiLabel, table: (key) => t(`reporting.tables.${key}`), quality: (key) => t(`reporting.quality.${key}`), unavailable })}>
        <FileSpreadsheet className="mr-2 h-4 w-4 text-green-600" />
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
            await exportReportingPdf({ filename, title, report, kpiLabel, unavailable, generatedBy, branding: { ...branding, logoDataUrl } });
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

