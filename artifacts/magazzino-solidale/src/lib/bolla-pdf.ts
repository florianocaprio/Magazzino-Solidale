import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { BollaDettaglio } from "@workspace/api-client-react";

export type BollaTemplate = "standard" | "moderno" | "minimal";

export const BOLLA_TEMPLATES: { value: BollaTemplate; label: string; description: string }[] = [
  { value: "standard", label: "Standard", description: "Intestazione classica con bordo e logo del centro." },
  { value: "moderno", label: "Moderno", description: "Fascia colorata in testata, stile compatto." },
  { value: "minimal", label: "Minimal", description: "Solo testo, essenziale per stampa veloce." },
];

export interface CentroInfo {
  nome?: string | null;
  indirizzo?: string | null;
  comune?: string | null;
  logoUrl?: string | null;
}

export interface BollaPdfOptions {
  bolla: BollaDettaglio;
  centro?: CentroInfo | null;
  footer?: string | null;
  template: BollaTemplate;
  associationLogoDataUrl?: string | null;
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Carica il logo dell'associazione (public/logo-aim.png) come data URL per jsPDF. */
export async function loadAssociationLogo(): Promise<string | null> {
  const base = import.meta.env.BASE_URL || "/";
  return urlToDataUrl(`${base.replace(/\/$/, "")}/logo-aim.png`);
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = dataUrl;
  });
}

type RGB = [number, number, number];

const ACCENT: Record<BollaTemplate, RGB> = {
  standard: [51, 65, 85], // slate-700
  moderno: [5, 150, 105], // emerald-600
  minimal: [30, 30, 30],
};

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

export async function generateBollaPdf(opts: BollaPdfOptions): Promise<void> {
  const { bolla, centro, footer, associationLogoDataUrl } = opts;
  const template: BollaTemplate = opts.template in ACCENT ? opts.template : "standard";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 14;
  const accent = ACCENT[template];

  let y = margin;

  // ---- Header ----
  if (template === "moderno") {
    doc.setFillColor(accent[0], accent[1], accent[2]);
    doc.rect(0, 0, pageW, 32, "F");
    let textX = margin;
    if (centro?.logoUrl) {
      const drawn = await drawImageFit(doc, centro.logoUrl, margin, 6, 20, 20);
      if (drawn) textX = margin + 24;
    }
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(centro?.nome || "Magazzino Solidale", textX, 13);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const addr = [centro?.indirizzo, centro?.comune].filter(Boolean).join(" — ");
    if (addr) doc.text(addr, textX, 19);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("BOLLA DI CONSEGNA", pageW - margin, 13, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(bolla.numeroBolla, pageW - margin, 19, { align: "right" });
    doc.text(format(new Date(bolla.dataBolla), "dd/MM/yyyy", { locale: it }), pageW - margin, 25, { align: "right" });
    doc.setTextColor(0, 0, 0);
    y = 40;
  } else {
    let textX = margin;
    if (centro?.logoUrl && template === "standard") {
      const drawn = await drawImageFit(doc, centro.logoUrl, margin, y, 22, 22);
      if (drawn) textX = margin + 26;
    }
    doc.setTextColor(accent[0], accent[1], accent[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text(centro?.nome || "Magazzino Solidale", textX, y + 5);
    doc.setTextColor(60, 60, 60);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const addr = [centro?.indirizzo, centro?.comune].filter(Boolean).join(" — ");
    if (addr) doc.text(addr, textX, y + 11);

    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("BOLLA DI CONSEGNA", pageW - margin, y + 5, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`N. ${bolla.numeroBolla}`, pageW - margin, y + 11, { align: "right" });
    doc.text(
      `Data: ${format(new Date(bolla.dataBolla), "dd/MM/yyyy", { locale: it })}`,
      pageW - margin,
      y + 16,
      { align: "right" },
    );
    y += 22;
    if (template === "standard") {
      doc.setDrawColor(accent[0], accent[1], accent[2]);
      doc.setLineWidth(0.5);
      doc.line(margin, y, pageW - margin, y);
      y += 6;
    } else {
      y += 4;
    }
  }

  // ---- Recipient / delivery info ----
  const colLeftX = margin;
  const colRightX = pageW / 2 + 4;
  const colWidth = pageW / 2 - margin - 6;

  doc.setFontSize(9);
  doc.setTextColor(110, 110, 110);
  doc.text("DESTINATARIO", colLeftX, y);
  doc.text("CONSEGNA", colRightX, y);
  y += 5;

  const rowY = y;

  // Left column: recipient (name, address, phone)
  let leftY = rowY;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(bolla.beneficiarioNome || `Beneficiario #${bolla.beneficiarioId}`, colLeftX, leftY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  leftY += 5;
  const indirizzoDest = bolla.indirizzoConsegna || bolla.beneficiarioIndirizzo;
  if (indirizzoDest) {
    const lines = doc.splitTextToSize(indirizzoDest, colWidth) as string[];
    doc.text(lines, colLeftX, leftY);
    leftY += lines.length * 4.5;
  }
  if (bolla.beneficiarioTelefono) {
    doc.text(`Cell: ${bolla.beneficiarioTelefono}`, colLeftX, leftY);
    leftY += 5;
  }

  // Right column: warehouse (name + address) and transporter
  let rightY = rowY;
  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(`Magazzino: ${bolla.magazzinoNome || "—"}`, colRightX, rightY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  rightY += 5;
  const magAddr = [bolla.magazzinoIndirizzo, bolla.magazzinoComune].filter(Boolean).join(" — ");
  if (magAddr) {
    const lines = doc.splitTextToSize(magAddr, colWidth) as string[];
    doc.text(lines, colRightX, rightY);
    rightY += lines.length * 4.5;
  }
  const trasportatore = bolla.volontarioNome || bolla.trasportatoreNome
    || (bolla.noteConsegna ? "Presso il centro" : "—");
  doc.text(`Trasportatore: ${trasportatore}`, colRightX, rightY);
  rightY += 5;

  y = Math.max(leftY, rightY) + 4;

  // ---- Products table ----
  autoTable(doc, {
    startY: y,
    head: [["#", "Prodotto", "Lotto", "Quantità", "U.M."]],
    body: bolla.righe.map((r, i) => [
      String(i + 1),
      r.prodottoNome ?? `Prodotto #${r.prodottoId}`,
      r.codiceLotto ?? "—",
      String(r.quantita),
      r.unitaMisura,
    ]),
    theme: template === "minimal" ? "plain" : "striped",
    headStyles: {
      fillColor: template === "minimal" ? undefined : accent,
      textColor: template === "minimal" ? 0 : 255,
      fontStyle: "bold",
    },
    styles: { fontSize: 9, cellPadding: 2.5 },
    columnStyles: {
      0: { cellWidth: 10, halign: "right" },
      3: { halign: "right" },
      4: { cellWidth: 18 },
    },
    margin: { left: margin, right: margin },
  });

  // @ts-expect-error lastAutoTable is added by the autotable plugin
  let afterTableY: number = doc.lastAutoTable?.finalY ?? y + 20;
  afterTableY += 6;
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Totale articoli: ${bolla.righe.length}`,
    pageW - margin,
    afterTableY,
    { align: "right" },
  );

  // ---- Signatures ----
  const pageH = doc.internal.pageSize.getHeight();
  let sigY = Math.max(afterTableY + 22, pageH - 50);
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.3);
  const colW = (pageW - margin * 2 - 10) / 2;
  doc.line(margin, sigY, margin + colW, sigY);
  doc.line(pageW - margin - colW, sigY, pageW - margin, sigY);
  doc.setFontSize(8);
  doc.setTextColor(110, 110, 110);
  doc.text("Firma incaricato consegna", margin, sigY + 4);
  doc.text("Firma destinatario", pageW - margin - colW, sigY + 4);

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

  doc.save(`${bolla.numeroBolla}.pdf`);
}
