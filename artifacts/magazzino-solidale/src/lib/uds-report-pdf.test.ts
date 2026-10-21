import { beforeEach, describe, expect, it, vi } from "vitest";
import type { jsPDF as PDF } from "jspdf";
const mocks = vi.hoisted(() => ({ docs: [] as PDF[], saves: vi.fn() }));
vi.mock("jspdf", async (importOriginal) => {
  const original = await importOriginal<typeof import("jspdf")>();
  const Wrapped = function (
    opts: ConstructorParameters<typeof original.jsPDF>[0],
  ) {
    const doc = new original.jsPDF(opts);
    doc.save = mocks.saves;
    mocks.docs.push(doc);
    return doc;
  };
  Object.assign(Wrapped, { API: original.jsPDF.API });
  return { ...original, jsPDF: Wrapped };
});
import {
  exportUdsReportGiornalieroPdf,
  type UdsReportPdfRow,
} from "./uds-report-pdf";
const labels = {
  colN: "N.",
  colData: "Data",
  colPersona: "Persona",
  colZona: "Zona",
  colTipo: "Tipo",
  colNote: "Dettaglio operativo",
  colOperatore: "Operatore",
  legend: "Stato corrente dei bisogni alla generazione",
  metaDate: "Data",
  metaPeriod: "Periodo",
  metaAreaOperativa: "Area",
  metaZone: "Zona",
};
const row: UdsReportPdfRow = {
  numeroIntervento: 7,
  primoIntervento: false,
  data: "14/08/2026",
  persona: "Persona sintetica",
  zona: "Zona A",
  tipo: "Ascolto",
  operatore: "OP1",
  sections: [
    { label: "Sintesi incontro", text: "Testo sintetico" },
    { label: "Materiale consegnato", text: "Non indicato" },
    {
      label: "Richieste e azioni",
      text: "Richiesta programmata per settembre",
    },
  ],
};
describe("PDF operativo UDS", () => {
  beforeEach(() => {
    mocks.docs.length = 0;
    mocks.saves.mockReset();
  });
  it("mantiene sezioni e contenuti lunghi su più pagine", async () => {
    await exportUdsReportGiornalieroPdf({
      filename: "uds-test",
      title: "Report UDS",
      meta: { period: "14/08/2026" },
      labels,
      rows: Array.from({ length: 12 }, (_, i) => ({
        ...row,
        numeroIntervento: i + 1,
        sections: [
          ...row.sections,
          {
            label: "Note operative",
            text: "Testo lungo con ritorni a capo.\n".repeat(35),
          },
        ],
      })),
      associationLogoDataUrl: null,
    });
    expect(mocks.docs[0].getNumberOfPages()).toBeGreaterThan(2);
    const output = mocks.docs[0].output();
    expect(output).toContain("Materiale consegnato");
    expect(output).toContain("Richiesta programmata per settembre");
    expect(output).toContain("Testo lungo con ritorni a capo.");
    expect(mocks.saves).toHaveBeenCalledOnce();
    if (process.env.C2A_PDF_QA_DIR) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(
        `${process.env.C2A_PDF_QA_DIR}/uds-operativo.pdf`,
        Buffer.from(mocks.docs[0].output("arraybuffer")),
      );
    }
  });
  it("un diniego finale impedisce il download anche dopo generazione e branding", async () => {
    await expect(
      exportUdsReportGiornalieroPdf({
        filename: "uds-test",
        title: "Report",
        meta: {},
        labels,
        rows: [row],
        associationLogoDataUrl: null,
        beforeSave: async () => {
          throw new Error("Accesso revocato");
        },
      }),
    ).rejects.toThrow("Accesso revocato");
    expect(mocks.saves).not.toHaveBeenCalled();
  });
});
