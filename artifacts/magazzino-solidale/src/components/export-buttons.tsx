import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { exportToXlsx, exportToPdf, type ExportColumn } from "@/lib/export";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";

type ExportButtonsProps<T> = {
  rows: T[];
  columns: ExportColumn<T>[];
  filename: string;
  title: string;
  subtitle?: string;
  sheetName?: string;
  orientation?: "portrait" | "landscape";
  disabled?: boolean;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "secondary";
  loadRows?: () => Promise<T[]>;
  beforeExport?: (format: "xlsx" | "pdf", exportRows: T[]) => Promise<void>;
};

export function ExportButtons<T>({
  rows,
  columns,
  filename,
  title,
  subtitle,
  sheetName,
  orientation,
  disabled,
  size = "sm",
  variant = "outline",
  loadRows,
  beforeExport,
}: ExportButtonsProps<T>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [exportLoading, setExportLoading] = useState(false);
  const generatedBy = user ? `${user.nome ?? ""} ${user.cognome ?? ""}`.trim() || user.username : undefined;
  const empty = disabled || (rows.length === 0 && !loadRows);
  const resolveRows = () => loadRows ? loadRows() : Promise.resolve(rows);
  const handlePdfExport = async () => {
    setExportLoading(true);
    try {
      const exportRows = await resolveRows();
      if (exportRows.length === 0) return;
      await beforeExport?.("pdf", exportRows);
      const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
      await exportToPdf({
        filename,
        title,
        subtitle,
        rows: exportRows,
        columns,
        orientation,
        generatedBy,
        branding: { ...branding, logoDataUrl },
      });
    } finally {
      setExportLoading(false);
    }
  };

  const handleXlsxExport = async () => {
    setExportLoading(true);
    try {
      const exportRows = await resolveRows();
      if (exportRows.length === 0) return;
      await beforeExport?.("xlsx", exportRows);
      exportToXlsx(filename, sheetName ?? title, exportRows, columns);
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={empty || exportLoading} className="gap-2">
          <Download className="h-4 w-4" /> {t("common.export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => void handleXlsxExport()}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> {t("common.exportExcel")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={exportLoading}
          onClick={() => void handlePdfExport()}
        >
          <FileText className="h-4 w-4 mr-2 text-red-600" /> {t("common.exportPdf")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
