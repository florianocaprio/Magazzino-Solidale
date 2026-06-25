import { jsPDF } from "jspdf";
import JsBarcode from "jsbarcode";

export interface ProdottoBarcodeItem {
  nome: string;
  tipo: string;
  um: string;
  code: string;
}

export interface ProdottiBarcodeLabels {
  title: string;
  tipoLabel: string;
  umLabel: string;
}

interface BarcodeImage {
  url: string;
  w: number;
  h: number;
}

function makeBarcode(text: string): BarcodeImage | null {
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, text, {
      format: "CODE128",
      displayValue: true,
      fontSize: 34,
      fontOptions: "bold",
      height: 90,
      width: 3,
      margin: 24,
      textMargin: 4,
    });
    if (!canvas.width || !canvas.height) return null;
    return { url: canvas.toDataURL("image/png"), w: canvas.width, h: canvas.height };
  } catch {
    return null;
  }
}

export function generateProdottiBarcodePdf(
  items: ProdottoBarcodeItem[],
  labels: ProdottiBarcodeLabels,
) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const PAGE_W = 210;
  const PAGE_H = 297;
  const margin = 12;
  const cols = 2;
  const gutter = 8;
  const colW = (PAGE_W - margin * 2 - gutter * (cols - 1)) / cols;
  const cardH = 46;
  const rowGap = 4;
  const headerH = 14;
  const contentTop = margin + headerH;
  const usableH = PAGE_H - margin - contentTop;
  const rows = Math.max(1, Math.floor(usableH / (cardH + rowGap)));
  const perPage = rows * cols;

  const cache = new Map<string, BarcodeImage | null>();
  const getBarcode = (code: string) => {
    if (!cache.has(code)) cache.set(code, makeBarcode(code));
    return cache.get(code) ?? null;
  };

  const drawHeader = (page: number, totalPages: number) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(20, 20, 20);
    doc.text(labels.title, margin, margin + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(120, 120, 120);
    const dateStr = new Date().toLocaleDateString();
    doc.text(`${dateStr}    ${page}/${totalPages}`, PAGE_W - margin, margin + 6, {
      align: "right",
    });
    doc.setDrawColor(210, 210, 210);
    doc.setLineWidth(0.3);
    doc.line(margin, margin + 9, PAGE_W - margin, margin + 9);
  };

  const totalPages = Math.max(1, Math.ceil(items.length / perPage));

  items.forEach((item, index) => {
    const onPage = index % perPage;
    if (index > 0 && onPage === 0) doc.addPage();
    if (onPage === 0) drawHeader(Math.floor(index / perPage) + 1, totalPages);

    const row = Math.floor(onPage / cols);
    const col = onPage % cols;
    const x = margin + col * (colW + gutter);
    const y = contentTop + row * (cardH + rowGap);

    doc.setDrawColor(225, 225, 225);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, colW, cardH, 2, 2);

    const pad = 4;
    const innerW = colW - pad * 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(20, 20, 20);
    const nameLines = doc.splitTextToSize(item.nome, innerW) as string[];
    let nameText = nameLines[0] ?? "";
    if (nameLines.length > 1 && nameText.length > 1) {
      const trimmed = nameText.replace(/\s*\S*$/, "");
      nameText = (trimmed || nameText.slice(0, -1)) + "…";
    }
    doc.text(nameText, x + pad, y + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(110, 110, 110);
    const meta = `${labels.tipoLabel}: ${item.tipo}   ·   ${labels.umLabel}: ${item.um}`;
    doc.text(doc.splitTextToSize(meta, innerW)[0] ?? meta, x + pad, y + 12.5);

    const bc = getBarcode(item.code);
    const boxTop = y + 15;
    const boxH = cardH - 15 - 3;
    const maxW = innerW;
    if (bc) {
      // width:3 px per module → cap printed module width at ~0.5mm for a uniform,
      // comfortably-scannable result on normal codes; shrink to fit only when the
      // code is too long to fit the column (best effort), never exceeding the box.
      const targetK = 0.5 / 3;
      const ratio = Math.min(targetK, maxW / bc.w, boxH / bc.h);
      const drawW = bc.w * ratio;
      const drawH = bc.h * ratio;
      const imgX = x + (colW - drawW) / 2;
      const imgY = boxTop + (boxH - drawH) / 2;
      doc.addImage(bc.url, "PNG", imgX, imgY, drawW, drawH);
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(150, 150, 150);
      doc.text(item.code, x + colW / 2, boxTop + boxH / 2, { align: "center" });
    }
  });

  doc.save("prodotti-codici-a-barre.pdf");
}
