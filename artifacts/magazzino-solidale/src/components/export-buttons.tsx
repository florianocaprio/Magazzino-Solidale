import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/lib/auth";
import { exportToXlsx, exportToPdf, type ExportColumn } from "@/lib/export";

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
}: ExportButtonsProps<T>) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const generatedBy = user ? `${user.nome ?? ""} ${user.cognome ?? ""}`.trim() || user.username : undefined;
  const empty = disabled || rows.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={empty} className="gap-2">
          <Download className="h-4 w-4" /> {t("common.export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => exportToXlsx(filename, sheetName ?? title, rows, columns)}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> {t("common.exportExcel")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            exportToPdf({ filename, title, subtitle, rows, columns, orientation, generatedBy })
          }
        >
          <FileText className="h-4 w-4 mr-2 text-red-600" /> {t("common.exportPdf")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
