import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsPDF } from "jspdf";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 30;
const FONT_FILE = "NotoSans-Regular.ttf";
let cachedFontBase64: string | null = null;

function fontBase64(): string {
  if (cachedFontBase64) return cachedFontBase64;
  const candidates = [
    path.resolve(process.cwd(), "assets", FONT_FILE),
    path.resolve(process.cwd(), "artifacts/api-server/assets", FONT_FILE),
    fileURLToPath(new URL(`../../assets/${FONT_FILE}`, import.meta.url)),
    fileURLToPath(new URL(`../assets/${FONT_FILE}`, import.meta.url)),
  ];
  const fontPath = candidates.find((candidate) => existsSync(candidate));
  if (!fontPath) {
    throw new Error(`Font Unicode ${FONT_FILE} non disponibile`);
  }
  cachedFontBase64 = readFileSync(fontPath).toString("base64");
  return cachedFontBase64;
}

export function buildSimpleLandscapePdf(
  title: string,
  lines: string[],
): Buffer {
  const documentId = createHash("sha256")
    .update(JSON.stringify({ title, lines }))
    .digest("hex")
    .slice(0, 32)
    .toUpperCase();
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
    compress: false,
    putOnlyUsedFonts: true,
  });
  doc.addFileToVFS(FONT_FILE, fontBase64());
  doc.addFont(FONT_FILE, "NotoSans", "normal");
  doc.setFont("NotoSans", "normal");
  doc.setFileId(documentId);
  doc.setCreationDate(new Date("2000-01-01T00:00:00.000Z"));
  doc.setProperties({
    title,
    subject: "Registro ufficiale volontari",
    author: "Magazzino Solidale",
    creator: "Magazzino Solidale",
  });

  doc.setFontSize(14);
  doc.text(title, MARGIN, MARGIN + 12);
  doc.setFontSize(7);
  let y = MARGIN + 34;
  for (const line of lines) {
    const wrapped = doc.splitTextToSize(
      line,
      PAGE_WIDTH - MARGIN * 2,
    ) as string[];
    for (const part of wrapped.length ? wrapped : [""]) {
      if (y > PAGE_HEIGHT - MARGIN) {
        doc.addPage("a4", "landscape");
        doc.setFont("NotoSans", "normal");
        doc.setFontSize(7);
        y = MARGIN;
      }
      doc.text(part, MARGIN, y);
      y += 10;
    }
    y += 3;
  }

  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("NotoSans", "normal");
    doc.setFontSize(7);
    doc.text(
      `Pagina ${page} di ${pageCount}`,
      PAGE_WIDTH - MARGIN,
      PAGE_HEIGHT - 12,
      { align: "right" },
    );
  }
  return Buffer.from(doc.output("arraybuffer"));
}
