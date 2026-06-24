import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export type ExportColumn<T> = {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
};

function cellValue<T>(col: ExportColumn<T>, row: T): string | number {
  const v = col.accessor(row);
  if (v === null || v === undefined) return "";
  return v;
}

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Esporta una lista di oggetti in un file .xlsx scaricabile. */
export function exportToXlsx<T>(
  filename: string,
  sheetName: string,
  rows: T[],
  columns: ExportColumn<T>[],
): void {
  const header = columns.map((c) => c.header);
  const body = rows.map((r) => columns.map((c) => cellValue(c, r)));
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);

  ws["!cols"] = columns.map((c) => {
    const maxLen = Math.max(
      c.header.length,
      ...rows.map((r) => String(cellValue(c, r)).length),
    );
    return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}_${timestamp()}.xlsx`);
}

/** Esporta una lista di oggetti in un file PDF tabellare scaricabile. */
export function exportToPdf<T>(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  rows: T[];
  columns: ExportColumn<T>[];
  orientation?: "portrait" | "landscape";
}): void {
  const { filename, title, subtitle, rows, columns, orientation = "portrait" } = opts;
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const marginX = 40;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, 48);

  doc.setFontSize(9);
  doc.setTextColor(120);
  const meta = subtitle ? `${subtitle}  •  ` : "";
  doc.text(
    `${meta}Generato il ${new Date().toLocaleString("it-IT")}  •  ${rows.length} righe`,
    marginX,
    64,
  );

  autoTable(doc, {
    startY: 80,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(cellValue(c, r)))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    margin: { left: marginX, right: marginX },
  });

  doc.save(`${filename}_${timestamp()}.pdf`);
}
