import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText } from "lucide-react";
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
  const empty = disabled || rows.length === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant={variant} size={size} disabled={empty} className="gap-2">
          <Download className="h-4 w-4" /> Esporta
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => exportToXlsx(filename, sheetName ?? title, rows, columns)}
        >
          <FileSpreadsheet className="h-4 w-4 mr-2 text-green-600" /> Esporta in Excel (XLSX)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            exportToPdf({ filename, title, subtitle, rows, columns, orientation })
          }
        >
          <FileText className="h-4 w-4 mr-2 text-red-600" /> Esporta in PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
