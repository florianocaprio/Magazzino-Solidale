import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { Trasferimento } from "@workspace/api-client-react";
import { loadAssociationLogo } from "./bolla-pdf";

export { loadAssociationLogo };

export interface TrasferimentoPdfOptions {
  trasferimento: Trasferimento;
  footer?: string | null;
  associationLogoDataUrl?: string | null;
}

const ACCENT: [number, number, number] = [5, 150, 105]; // emerald-600

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

export async function generateTrasferimentoPdf(opts: TrasferimentoPdfOptions): Promise<void> {
  const { trasferimento: t, footer, associationLogoDataUrl } = opts;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;
  const righe = t.righe ?? [];

  let y = margin;

  // ---- Header ----
  let textX = margin;
  if (associationLogoDataUrl) {
    const drawn = await drawImageFit(doc, associationLogoDataUrl, margin, y, 22, 22);
    if (drawn) textX = margin + 26;
  }
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("Magazzino Solidale AIM", textX, y + 5);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("BOLLA DI TRASFERIMENTO", pageW - margin, y + 5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("Trasferimento interno tra magazzini", textX, y + 11);
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.text(`N. ${t.codice}`, pageW - margin, y + 11, { align: "right" });
  doc.text(
    `Data: ${format(new Date(t.dataRichiesta), "dd/MM/yyyy", { locale: it })}`,
    pageW - margin,
    y + 16,
    { align: "right" },
  );
  y += 24;
  doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 6;

  // ---- Origine / Destinazione ----
  const colDestX = pageW / 2 + 4;
  const addrLines = (
    indirizzo?: string | null,
    comune?: string | null,
    zona?: string | null,
  ): string[] => {
    const lines: string[] = [];
    if (indirizzo) lines.push(indirizzo);
    if (comune) lines.push(comune);
    if (zona) lines.push(`Zona: ${zona}`);
    return lines;
  };
  const origineAddr = addrLines(t.magazzinoOrigineIndirizzo, t.magazzinoOrigineComune, t.magazzinoOrigineZona);
  const destinoAddr = addrLines(t.magazzinoDestinoIndirizzo, t.magazzinoDestinoComune, t.magazzinoDestinoZona);

  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("MAGAZZINO ORIGINE", margin, y);
  doc.text("MAGAZZINO DESTINAZIONE", colDestX, y);
  y += 5;
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(t.magazzinoOrigineNome || `Magazzino #${t.magazzinoOrigineId}`, margin, y);
  doc.text(t.magazzinoDestinoNome || `Magazzino #${t.magazzinoDestinoId}`, colDestX, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(80, 80, 80);
  let addrY = y + 5;
  origineAddr.forEach((line, i) => doc.text(line, margin, addrY + i * 4.5));
  destinoAddr.forEach((line, i) => doc.text(line, colDestX, addrY + i * 4.5));
  doc.setTextColor(0, 0, 0);
  const addrRows = Math.max(origineAddr.length, destinoAddr.length);
  y = addrY + addrRows * 4.5 + 4;

  // ---- Trasportatore ----
  const trasportatore = t.trasportatoreVolontarioNome || t.trasportatoreNome || "—";
  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("TRASPORTATORE", margin, y);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(trasportatore, margin + 36, y);
  doc.setFont("helvetica", "normal");
  y += 9;

  // ---- Tabella prodotti ----
  autoTable(doc, {
    startY: y,
    head: [["#", "Prodotto", "Quantità", "U.M."]],
    body: righe.map((r, i) => [
      String(i + 1),
      `${r.prodottoNome ?? `Prodotto #${r.prodottoId}`}${r.fsePlus ? " *" : ""}`,
      String(r.quantita),
      r.unitaMisura,
    ]),
    theme: "striped",
    headStyles: { fillColor: ACCENT, textColor: 255, fontStyle: "bold" },
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: "right" },
      2: { halign: "right" },
      3: { cellWidth: 18 },
    },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error lastAutoTable is added by the autotable plugin
  let afterTableY: number = doc.lastAutoTable?.finalY ?? y + 20;
  afterTableY += 6;
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(`Totale articoli: ${righe.length}`, pageW - margin, afterTableY, { align: "right" });
  if (righe.some(r => r.fsePlus)) {
    doc.setFontSize(8);
    doc.setTextColor(90, 90, 90);
    doc.text("* Prodotto FSE+ (Fondo Sociale Europeo Plus)", margin, afterTableY);
    doc.setTextColor(0, 0, 0);
  }

  if (t.note) {
    afterTableY += 8;
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    const lines = doc.splitTextToSize(`Note: ${t.note}`, pageW - margin * 2);
    doc.text(lines, margin, afterTableY);
  }

  if (t.operatoreCodice) {
    afterTableY += 8;
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(`Operatore: ${t.operatoreCodice}`, margin, afterTableY);
  }

  // ---- Firme ----
  const sigY = Math.max(afterTableY + 22, pageH - 50);
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  const colW = (pageW - margin * 2 - 10) / 2;
  doc.line(margin, sigY, margin + colW, sigY);
  doc.line(pageW - margin - colW, sigY, pageW - margin, sigY);
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text("Firma magazzino origine", margin, sigY + 4);
  doc.text("Firma magazzino destinazione", pageW - margin - colW, sigY + 4);

  // ---- Footer ----
  const footerY = pageH - 16;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 4, pageW - margin, footerY - 4);

  let footerTextX = margin;
  if (associationLogoDataUrl) {
    const drawn = await drawImageFit(doc, associationLogoDataUrl, margin, footerY - 2, 12, 10);
    if (drawn) footerTextX = margin + 16;
  }
  if (footer) {
    doc.setFontSize(8);
    doc.setTextColor(110, 110, 110);
    const lines = doc.splitTextToSize(footer, pageW - footerTextX - margin);
    doc.text(lines, footerTextX, footerY + 1);
  }

  doc.save(`${t.codice}.pdf`);
}
