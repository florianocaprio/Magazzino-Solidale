const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 30;

function ascii(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrap(line: string, width = 132): string[] {
  const words = ascii(line).split(/\s+/);
  const result: string[] = [];
  let current = "";
  for (const word of words) {
    if (`${current} ${word}`.trim().length > width && current) {
      result.push(current);
      current = word;
    } else current = `${current} ${word}`.trim();
  }
  if (current) result.push(current);
  return result.length ? result : [""];
}

export function buildSimpleLandscapePdf(title: string, lines: string[]): Buffer {
  const allLines = [title, "", ...lines.flatMap((line) => wrap(line))];
  const perPage = 44;
  const pages = Array.from({ length: Math.max(1, Math.ceil(allLines.length / perPage)) }, (_, index) =>
    allLines.slice(index * perPage, (index + 1) * perPage),
  );
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalogId = add("");
  const pagesId = add("");
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
  const pageIds: number[] = [];
  for (const pageLines of pages) {
    let content = `BT /F1 9 Tf ${MARGIN} ${PAGE_HEIGHT - MARGIN} Td 11 TL\n`;
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) content += "T*\n";
      content += `(${ascii(line)}) Tj\n`;
    });
    content += "ET";
    const contentId = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageId = add(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }
  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "ascii");
}
