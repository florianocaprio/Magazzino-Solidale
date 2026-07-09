import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";
import { loadDocumentLogoDataUrl, resolveBrandingAmbiente, type BrandingAmbiente } from "@/lib/branding-ambiente";

export type UdsReportPdfRow = {
  numeroIntervento: number;
  primoIntervento: boolean;
  data: string;
  persona: string;
  zona: string;
  tipo: string;
  note: string;
  operatore: string;
};

export type UdsReportPdfLabels = {
  colN: string;
  colData: string;
  colPersona: string;
  colZona: string;
  colTipo: string;
  colNote: string;
  colOperatore: string;
  legend: string;
  metaDate: string;
  metaPeriod: string;
  metaCity: string;
  metaZone: string;
};

export type UdsReportPdfMeta = {
  /** Single day (formatted) — set this OR period. */
  date?: string;
  /** Range (formatted "dd/mm/yyyy – dd/mm/yyyy") — set this OR date. */
  period?: string;
  city?: string;
  zone?: string;
};

function timestamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

/**
 * Dedicated PDF for the UDS report: a tabular export where the per-person
 * intervention number is printed in RED whenever it is that person's first-ever
 * intervention (primoIntervento). The generic exportToPdf cannot color cells, so
 * this uses autoTable's didParseCell hook to override the first column's text color.
 * The document logo is drawn at the top-right.
 */
export async function exportUdsReportGiornalieroPdf(opts: {
  filename: string;
  title: string;
  meta: UdsReportPdfMeta;
  labels: UdsReportPdfLabels;
  rows: UdsReportPdfRow[];
  branding?: BrandingAmbiente | null;
  associationLogoDataUrl?: string | null;
}): Promise<void> {
  const { filename, title, meta, labels, rows } = opts;
  const branding = opts.branding ?? resolveBrandingAmbiente(null);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 40;

  // ---- Document logo (top-right) ----
  const logo = opts.associationLogoDataUrl === undefined
    ? await loadDocumentLogoDataUrl(branding)
    : opts.associationLogoDataUrl;
  if (logo) {
    const { w, h } = await imageSize(logo);
    if (w && h) {
      const maxW = 90;
      const maxH = 44;
      const ratio = Math.min(maxW / w, maxH / h);
      const drawW = w * ratio;
      const drawH = h * ratio;
      try {
        doc.addImage(logo, "PNG", pageW - marginX - drawW, 26, drawW, drawH);
      } catch {
        try {
          doc.addImage(logo, "JPEG", pageW - marginX - drawW, 26, drawW, drawH);
        } catch {
          /* ignore logo failure */
        }
      }
    }
  }

  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.setFont("helvetica", "bold");
  doc.text(branding.nomeDocumento, marginX, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  if (branding.sottotitoloDocumento) {
    doc.text(branding.sottotitoloDocumento, marginX, 47);
  }

  doc.setFontSize(16);
  doc.setTextColor(20);
  doc.text(title, marginX, 66);

  const metaParts: string[] = [];
  if (meta.period) metaParts.push(`${labels.metaPeriod}: ${meta.period}`);
  else if (meta.date) metaParts.push(`${labels.metaDate}: ${meta.date}`);
  if (meta.city) metaParts.push(`${labels.metaCity}: ${meta.city}`);
  if (meta.zone) metaParts.push(`${labels.metaZone}: ${meta.zone}`);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `${metaParts.join("  •  ")}  •  ${new Date().toLocaleString("it-IT")}  •  ${rows.length}`,
    marginX,
    82,
  );

  doc.setTextColor(200, 30, 30);
  doc.text(labels.legend, marginX, 96);

  autoTable(doc, {
    startY: 108,
    head: [[
      labels.colN,
      labels.colData,
      labels.colPersona,
      labels.colZona,
      labels.colTipo,
      labels.colNote,
      labels.colOperatore,
    ]],
    body: rows.map((r) => [
      String(r.numeroIntervento),
      r.data,
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
      0: { halign: "center", cellWidth: 28, fontStyle: "bold" },
      1: { cellWidth: 64 },
      5: { cellWidth: 220 },
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
