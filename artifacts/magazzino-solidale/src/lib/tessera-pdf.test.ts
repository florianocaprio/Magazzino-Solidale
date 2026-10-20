import { beforeEach, expect, it, vi } from "vitest";
const { text, qr, barcode, save, addImage } = vi.hoisted(() => ({
  text: vi.fn(),
  qr: vi.fn().mockResolvedValue("data:image/png;base64,QR"),
  barcode: vi.fn(),
  save: vi.fn(),
  addImage: vi.fn(),
}));
vi.mock("jspdf", () => ({
  jsPDF: class {
    setFillColor() {}
    rect() {}
    setDrawColor() {}
    setLineWidth() {}
    setTextColor() {}
    setFont() {}
    setFontSize() {}
    getTextWidth(value: string) {
      return value.length;
    }
    text = text;
    addImage = addImage;
    save = save;
  },
}));
vi.mock("qrcode", () => ({ default: { toDataURL: qr } }));
vi.mock("jsbarcode", () => ({ default: barcode }));
import { generateTesseraPdf } from "./tessera-pdf";
const labels = {
  title: "Associazione",
  subtitle: "Magazzino",
  cardLabel: "Tessera",
  cfLabel: "CF",
  codeLabel: "Codice",
  issuedLabel: "Emessa il",
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,BAR",
  );
});
it("stampa il codice anagrafico e la data più in basso, mentre QR e barcode usano il token registrato", async () => {
  await generateTesseraPdf({
    beneficiario: {
      codice: "AIM-RM-B-00001",
      codiceTessera: "MS-TokenCasuale_Sicuro",
      nome: "Mario",
      cognome: "Rossi",
      codiceFiscale: "RSSMRA80A01H501U",
    },
    labels,
    dataEmissione: "2026-10-19T10:00:00.000Z",
  });
  expect(qr).toHaveBeenCalledWith("MS-TokenCasuale_Sicuro", expect.anything());
  expect(barcode).toHaveBeenCalledWith(
    expect.anything(),
    "MS-TokenCasuale_Sicuro",
    expect.objectContaining({ displayValue: false }),
  );
  expect(text).toHaveBeenCalledWith(
    "Codice: AIM-RM-B-00001",
    expect.any(Number),
    32.5,
    expect.anything(),
  );
  expect(text).toHaveBeenCalledWith(
    "Emessa il: 19/10/2026",
    expect.any(Number),
    36,
    expect.anything(),
  );
  expect(
    text.mock.calls.some(([value]) => String(value).includes("MS-Token")),
  ).toBe(false);
  expect(save).toHaveBeenCalledWith("tessera-AIM-RM-B-00001.pdf");
});
it("mantiene la scansione delle tessere legacy anche senza token distinto e normalizza solo il nome del file", async () => {
  await generateTesseraPdf({
    beneficiario: { codice: "LEGACY/RM/01", nome: "Mario", cognome: "Rossi" },
    labels,
    dataEmissione: "2024-01-02T12:00:00.000Z",
  });
  expect(qr).toHaveBeenCalledWith("LEGACY/RM/01", expect.anything());
  expect(save).toHaveBeenCalledWith("tessera-LEGACY-RM-01.pdf");
});
