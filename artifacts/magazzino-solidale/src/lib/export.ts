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

export type PdfExportBranding = {
  nomeDocumento: string;
  sottotitoloDocumento?: string | null;
  contattiDocumento?: string | null;
  footerDocumenti?: string | null;
  logoDataUrl?: string | null;
};

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

async function drawImageFit(
  doc: jsPDF,
  dataUrl: string,
  x: number,
  y: number,
  maxW: number,
  maxH: number,
): Promise<number> {
  const { w, h } = await imageSize(dataUrl);
  if (!w || !h) return 0;
  const ratio = Math.min(maxW / w, maxH / h);
  const drawW = w * ratio;
  const drawH = h * ratio;
  try {
    doc.addImage(dataUrl, "PNG", x, y, drawW, drawH);
  } catch {
    try {
      doc.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
    } catch {
      return 0;
    }
  }
  return drawH;
}

async function drawBrandingHeader(doc: jsPDF, branding: PdfExportBranding | null | undefined, marginX: number): Promise<number> {
  if (!branding) return 32;
  const pageW = doc.internal.pageSize.getWidth();
  const textWidth = pageW - marginX * 2 - 110;

  if (branding.logoDataUrl) {
    await drawImageFit(doc, branding.logoDataUrl, pageW - marginX - 90, 24, 90, 38);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(doc.splitTextToSize(branding.nomeDocumento, textWidth)[0] ?? branding.nomeDocumento, marginX, 34);

  let y = 47;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  if (branding.sottotitoloDocumento) {
    doc.text(doc.splitTextToSize(branding.sottotitoloDocumento, textWidth)[0] ?? branding.sottotitoloDocumento, marginX, y);
    y += 11;
  }
  if (branding.contattiDocumento) {
    doc.text(doc.splitTextToSize(branding.contattiDocumento, textWidth)[0] ?? branding.contattiDocumento, marginX, y);
    y += 11;
  }

  return Math.max(y + 6, 58);
}

function drawBrandingFooters(doc: jsPDF, branding: PdfExportBranding | null | undefined, marginX: number): void {
  if (!branding?.footerDocumenti) return;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.3);
    doc.line(marginX, pageH - 28, pageW - marginX, pageH - 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(110);
    const lines = doc.splitTextToSize(branding.footerDocumenti, pageW - marginX * 2) as string[];
    doc.text(lines.slice(0, 2), marginX, pageH - 18);
  }
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
export async function exportToPdf<T>(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  rows: T[];
  columns: ExportColumn<T>[];
  orientation?: "portrait" | "landscape";
  generatedBy?: string;
  branding?: PdfExportBranding | null;
}): Promise<void> {
  const { filename, title, subtitle, rows, columns, orientation = "portrait", generatedBy, branding } = opts;
  const doc = new jsPDF({ orientation, unit: "pt", format: "a4" });
  const marginX = 40;
  const headerBottomY = await drawBrandingHeader(doc, branding, marginX);
  const titleY = branding ? headerBottomY : 48;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, titleY);

  doc.setFontSize(9);
  doc.setTextColor(120);
  const meta = subtitle ? `${subtitle}  •  ` : "";
  const by = generatedBy ? `  •  Report generato da: ${generatedBy}` : "";
  const metaY = titleY + 16;
  doc.text(
    `${meta}Generato il ${new Date().toLocaleString("it-IT")}  •  ${rows.length} righe${by}`,
    marginX,
    metaY,
  );

  autoTable(doc, {
    startY: metaY + 16,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(cellValue(c, r)))),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    margin: { left: marginX, right: marginX, bottom: branding?.footerDocumenti ? 42 : 20 },
  });

  drawBrandingFooters(doc, branding, marginX);
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
export async function exportSchedaPdf(opts: {
  filename: string;
  title: string;
  subtitle?: string;
  anagraficaTitle: string;
  campoHeader: string;
  valoreHeader: string;
  anagrafica: SchedaLabelValue[];
  sections: SchedaSection[];
  branding?: PdfExportBranding | null;
}): Promise<void> {
  const { filename, title, subtitle, anagraficaTitle, campoHeader, valoreHeader, anagrafica, sections, branding } = opts;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const marginX = 40;
  const headerBottomY = await drawBrandingHeader(doc, branding, marginX);
  const titleY = branding ? headerBottomY : 48;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, titleY);

  doc.setFontSize(9);
  doc.setTextColor(120);
  const meta = subtitle ? `${subtitle}  •  ` : "";
  const metaY = titleY + 16;
  doc.text(`${meta}Generato il ${new Date().toLocaleString("it-IT")}`, marginX, metaY);

  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(anagraficaTitle, marginX, metaY + 24);

  autoTable(doc, {
    startY: metaY + 32,
    head: [[campoHeader, valoreHeader]],
    body: anagrafica.map((r) => [r.label, toCell(r.value)]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: { 0: { cellWidth: 160, fontStyle: "bold" } },
    margin: { left: marginX, right: marginX, bottom: branding?.footerDocumenti ? 42 : 20 },
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
        margin: { left: marginX, right: marginX, bottom: branding?.footerDocumenti ? 42 : 20 },
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
      margin: { left: marginX, right: marginX, bottom: branding?.footerDocumenti ? 42 : 20 },
    });
  }

  drawBrandingFooters(doc, branding, marginX);
  doc.save(`${filename}_${timestamp()}.pdf`);
}
