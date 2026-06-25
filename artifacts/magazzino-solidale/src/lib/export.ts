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

export type SchedaLabelValue = { label: string; value: string | number | null | undefined };

export type SchedaSection = {
  title: string;
  headers: string[];
  rows: (string | number | null | undefined)[][];
  emptyText?: string;
};

function toCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** Esporta la scheda di un beneficiario (anagrafica + sezioni tabellari) in un .xlsx multi-foglio. */
export function exportSchedaXlsx(opts: {
  filename: string;
  anagraficaSheetName: string;
  campoHeader: string;
  valoreHeader: string;
  anagrafica: SchedaLabelValue[];
  sections: SchedaSection[];
}): void {
  const { filename, anagraficaSheetName, campoHeader, valoreHeader, anagrafica, sections } = opts;
  const wb = XLSX.utils.book_new();

  const anagAoa: (string | number)[][] = [
    [campoHeader, valoreHeader],
    ...anagrafica.map((r) => [r.label, toCell(r.value)]),
  ];
  const anagWs = XLSX.utils.aoa_to_sheet(anagAoa);
  anagWs["!cols"] = [{ wch: 28 }, { wch: 50 }];
  XLSX.utils.book_append_sheet(wb, anagWs, anagraficaSheetName.slice(0, 31));

  const usedNames = new Set<string>([anagraficaSheetName.slice(0, 31)]);
  for (const sec of sections) {
    const aoa: (string | number)[][] = [
      sec.headers,
      ...sec.rows.map((row) => row.map(toCell)),
    ];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = sec.headers.map((h, i) => {
      const maxLen = Math.max(h.length, ...sec.rows.map((r) => toCell(r[i]).length));
      return { wch: Math.min(Math.max(maxLen + 2, 10), 50) };
    });
    let name = sec.title.slice(0, 31);
    let n = 2;
    while (usedNames.has(name)) {
      name = `${sec.title.slice(0, 28)}_${n}`.slice(0, 31);
      n++;
    }
    usedNames.add(name);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  XLSX.writeFile(wb, `${filename}_${timestamp()}.xlsx`);
}

/** Esporta la scheda di un beneficiario (anagrafica + sezioni tabellari) in un PDF. */
export function exportSchedaPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  anagraficaTitle: string;
  campoHeader: string;
  valoreHeader: string;
  anagrafica: SchedaLabelValue[];
  sections: SchedaSection[];
}): void {
  const { filename, title, subtitle, anagraficaTitle, campoHeader, valoreHeader, anagrafica, sections } = opts;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const marginX = 40;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, 48);

  doc.setFontSize(9);
  doc.setTextColor(120);
  const meta = subtitle ? `${subtitle}  •  ` : "";
  doc.text(`${meta}Generato il ${new Date().toLocaleString("it-IT")}`, marginX, 64);

  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(anagraficaTitle, marginX, 88);

  autoTable(doc, {
    startY: 96,
    head: [[campoHeader, valoreHeader]],
    body: anagrafica.map((r) => [r.label, toCell(r.value)]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: { 0: { cellWidth: 160, fontStyle: "bold" } },
    margin: { left: marginX, right: marginX },
  });

  for (const sec of sections) {
    let y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24;
    if (y > doc.internal.pageSize.getHeight() - 80) {
      doc.addPage();
      y = 48;
    }
    doc.setFontSize(12);
    doc.setTextColor(20);
    doc.text(sec.title, marginX, y);

    if (sec.rows.length === 0) {
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(sec.emptyText ?? "-", marginX, y + 16);
      autoTable(doc, {
        startY: y + 22,
        head: [[""]],
        body: [],
        margin: { left: marginX, right: marginX },
        styles: { fontSize: 1, cellPadding: 0 },
        tableLineWidth: 0,
      });
      continue;
    }

    autoTable(doc, {
      startY: y + 8,
      head: [sec.headers],
      body: sec.rows.map((row) => row.map(toCell)),
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [51, 65, 85], textColor: 255 },
      alternateRowStyles: { fillColor: [241, 245, 249] },
      margin: { left: marginX, right: marginX },
    });
  }

  doc.save(`${filename}_${timestamp()}.pdf`);
}
