import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { format, type Locale } from "date-fns";
import { it } from "date-fns/locale";
import type { BrandingAmbiente } from "@/lib/branding-ambiente";

export interface TesseraBeneficiario {
  codice: string;
  nome: string;
  cognome: string;
  codiceFiscale?: string | null;
}

export interface TesseraLabels {
  title: string;
  subtitle: string;
  cardLabel: string;
  cfLabel: string;
  codeLabel: string;
  issuedLabel: string;
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

async function drawImageRightBottom(
  doc: jsPDF,
  dataUrl: string,
  rightX: number,
  bottomY: number,
  maxW: number,
  maxH: number,
): Promise<void> {
  const { w, h } = await imageSize(dataUrl);
  if (!w || !h) return;
  const ratio = Math.min(maxW / w, maxH / h);
  const drawW = w * ratio;
  const drawH = h * ratio;
  const x = rightX - drawW;
  const y = bottomY - drawH;
  try {
    doc.addImage(dataUrl, "PNG", x, y, drawW, drawH);
  } catch {
    try {
      doc.addImage(dataUrl, "JPEG", x, y, drawW, drawH);
    } catch {
      // ignore failures to keep the card generation resilient
    }
  }
}

function qrDataUrl(text: string): Promise<string | null> {
  return QRCode.toDataURL(text, { margin: 1, width: 240 }).catch(() => null);
}

function barcodeDataUrl(text: string): string | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, text, {
      format: "CODE128",
      displayValue: true,
      fontSize: 26,
      height: 70,
      margin: 4,
      textMargin: 2,
    });
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/** Costruisce le etichette tradotte della tessera da una funzione t(). */
export function buildTesseraLabels(t: (k: string) => string): TesseraLabels {
  return {
    title: t("tessera.title"),
    subtitle: t("tessera.subtitle"),
    cardLabel: t("tessera.cardLabel"),
    cfLabel: t("tessera.cf"),
    codeLabel: t("tessera.code"),
    issuedLabel: t("tessera.issued"),
  };
}

export interface TesseraPdfOptions {
  beneficiario: TesseraBeneficiario;
  labels: TesseraLabels;
  associationLogoDataUrl?: string | null;
  branding?: BrandingAmbiente | null;
  locale?: Locale;
}

function drawCenteredFitText(
  doc: jsPDF,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  maxFontSize: number,
  minFontSize: number,
): void {
  let fontSize = maxFontSize;
  doc.setFontSize(fontSize);
  while (fontSize > minFontSize && doc.getTextWidth(text) > maxWidth) {
    fontSize -= 0.5;
    doc.setFontSize(fontSize);
  }
  doc.text(text, x, y, { align: "center" });
}

/** Genera una tessera beneficiario formato CR80 (85.6 x 54 mm) con QR e codice a barre. */
export async function generateTesseraPdf(opts: TesseraPdfOptions): Promise<void> {
  const { beneficiario: b, labels, associationLogoDataUrl, branding } = opts;
  const locale = opts.locale ?? it;
  const W = 85.6;
  const H = 54;
  const doc = new jsPDF({ unit: "mm", format: [W, H], orientation: "landscape" });

  // Card background + border
  doc.setFillColor(255, 255, 255);
  doc.rect(0, 0, W, H, "F");
  // Left accent stripe
  doc.setFillColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.rect(0, 0, 5, H, "F");
  // Outer border
  doc.setDrawColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setLineWidth(0.4);
  doc.rect(0.5, 0.5, W - 1, H - 1);

  const leftX = 9;
  let y = 6;

  // Header — title + subtitle centered in the area left of the top-right QR
  const headerCenterX = (5 + (W - 24)) / 2;
  const title = branding?.nomeAssociazione ?? labels.title;
  const subtitle = branding?.nomeAmbiente ?? labels.subtitle;
  doc.setTextColor(ACCENT[0], ACCENT[1], ACCENT[2]);
  doc.setFont("helvetica", "bold");
  drawCenteredFitText(doc, title, headerCenterX, 8, W - 34, 10, 7.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  drawCenteredFitText(doc, subtitle, headerCenterX, 12.5, W - 34, 7, 5.5);

  // Beneficiary details
  y = 22;
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`${b.cognome} ${b.nome}`.toUpperCase(), leftX, y);

  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(60, 60, 60);
  if (b.codiceFiscale) {
    doc.text(`${labels.cfLabel}: ${b.codiceFiscale}`, leftX, y);
    y += 4.5;
  }
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 20, 20);
  doc.text(`${labels.codeLabel}: ${b.codice}`, leftX, y);

  // QR code (top-right)
  const qr = await qrDataUrl(b.codice);
  if (qr) {
    doc.addImage(qr, "PNG", W - 22, 5, 17, 17);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.5);
    doc.setTextColor(120, 120, 120);
    doc.text(labels.cardLabel, W - 22 + 8.5, 23.5, { align: "center" });
  }

  // Barcode (bottom, full width)
  const bc = barcodeDataUrl(b.codice);
  if (bc) {
    doc.addImage(bc, "PNG", leftX, 38, 48, 12);
  }

  // Issue date (right side, moved up to leave room for the logo below)
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(110, 110, 110);
  const issued = `${labels.issuedLabel}: ${format(new Date(), "dd/MM/yyyy", { locale })}`;
  doc.text(issued, W - 4, 29, { align: "right" });

  // Association logo (bottom-right, below the issue date)
  if (associationLogoDataUrl) {
    await drawImageRightBottom(doc, associationLogoDataUrl, W - 4, H - 4, 22, 18);
  }

  doc.save(`tessera-${b.codice}.pdf`);
}
