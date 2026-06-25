import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";

export type UdsReportPdfRow = {
  numeroIntervento: number;
  primoIntervento: boolean;
  persona: string;
  zona: string;
  tipo: string;
  note: string;
  operatore: string;
};

export type UdsReportPdfLabels = {
  colN: string;
  colPersona: string;
  colZona: string;
  colTipo: string;
  colNote: string;
  colOperatore: string;
  legend: string;
  metaDate: string;
  metaCity: string;
  metaZone: string;
};

export type UdsReportPdfMeta = {
  date: string;
  city?: string;
  zone?: string;
};

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Dedicated PDF for the UDS daily report: a tabular export where the per-person
 * intervention number is printed in RED whenever it is that person's first-ever
 * intervention (primoIntervento). The generic exportToPdf cannot color cells, so
 * this uses autoTable's didParseCell hook to override the first column's text color.
 */
export function exportUdsReportGiornalieroPdf(opts: {
  filename: string;
  title: string;
  meta: UdsReportPdfMeta;
  labels: UdsReportPdfLabels;
  rows: UdsReportPdfRow[];
}): void {
  const { filename, title, meta, labels, rows } = opts;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const marginX = 40;

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, 48);

  const metaParts = [`${labels.metaDate}: ${meta.date}`];
  if (meta.city) metaParts.push(`${labels.metaCity}: ${meta.city}`);
  if (meta.zone) metaParts.push(`${labels.metaZone}: ${meta.zone}`);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `${metaParts.join("  •  ")}  •  ${new Date().toLocaleString("it-IT")}  •  ${rows.length}`,
    marginX,
    64,
  );

  doc.setTextColor(200, 30, 30);
  doc.text(labels.legend, marginX, 78);

  autoTable(doc, {
    startY: 90,
    head: [[
      labels.colN,
      labels.colPersona,
      labels.colZona,
      labels.colTipo,
      labels.colNote,
      labels.colOperatore,
    ]],
    body: rows.map((r) => [
      String(r.numeroIntervento),
      r.persona,
      r.zona,
      r.tipo,
      r.note,
      r.operatore,
    ]),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [51, 65, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [241, 245, 249] },
    columnStyles: {
      0: { halign: "center", cellWidth: 32, fontStyle: "bold" },
      4: { cellWidth: 240 },
    },
    margin: { left: marginX, right: marginX },
    didParseCell: (data: CellHookData) => {
      if (data.section === "body" && data.column.index === 0) {
        const row = rows[data.row.index];
        if (row?.primoIntervento) {
          data.cell.styles.textColor = [200, 30, 30];
        }
      }
    },
  });

  doc.save(`${filename}_${timestamp()}.pdf`);
}
