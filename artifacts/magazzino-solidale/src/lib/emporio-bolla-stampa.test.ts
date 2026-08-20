import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBollaStampaSpesaEmporio: vi.fn(),
  getBolla: vi.fn(),
  generateBollaPdf: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getBollaStampaSpesaEmporio: mocks.getBollaStampaSpesaEmporio,
  getBolla: mocks.getBolla,
}));

vi.mock("@/lib/bolla-pdf", () => ({
  generateBollaPdf: mocks.generateBollaPdf,
}));

vi.mock("@/lib/branding-ambiente", () => ({
  loadDocumentBrandingForPdf: () =>
    Promise.resolve({ branding: null, logoDataUrl: null }),
}));

import { downloadBollaEmporioPdf } from "./emporio-bolla-stampa";

describe("stampa Bolla dal dominio Emporio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBollaStampaSpesaEmporio.mockResolvedValue({
      intestazione: "Magazzino Solidale",
      numeroBolla: "B-1",
      numeroSpesa: "S-1",
      dataChiusura: "2026-08-20T10:00:00.000Z",
      beneficiario: "Mario Rossi",
      beneficiarioCodice: "BEN-1",
      beneficiarioCodiceFiscale: null,
      centroAscolto: "Centro A",
      emporio: "Emporio A",
      emporioIndirizzo: null,
      operatore: "OP-1",
      righe: [
        {
          id: 1,
          spesaEmporioId: 10,
          sessioneCassaRigaId: 2,
          prodottoId: 3,
          prodottoNome: "Farina",
          lottoId: 4,
          codiceLotto: "LOT-1",
          codiceProdotto: "PROD-1",
          descrizioneProdotto: "Farina",
          quantita: 0.5,
          unitaMisura: "kg",
          quantitaStornata: 0,
          quantitaStornabile: 0.5,
          creditoUnitario: 2,
          creditoTotale: 1,
          scaricoId: 5,
          bollaRigaId: 6,
        },
      ],
      totaleCreditoConsumati: 1,
      saldoPrima: 20,
      saldoDopo: 19,
      note: null,
    });
  });

  it("usa il DTO Emporio senza chiamare GET /bolle/:id", async () => {
    await downloadBollaEmporioPdf(
      {
        id: 10,
        beneficiarioId: 1,
        magazzinoEmporioId: 2,
        bollaId: 7,
      } as never,
      { template: "standard" },
    );

    expect(mocks.getBollaStampaSpesaEmporio).toHaveBeenCalledWith(10);
    expect(mocks.getBolla).not.toHaveBeenCalled();
    expect(mocks.generateBollaPdf).toHaveBeenCalledWith(
      expect.objectContaining({
        bolla: expect.objectContaining({
          id: 7,
          numeroBolla: "B-1",
          righe: [expect.objectContaining({ unitaMisura: "kg" })],
        }),
      }),
    );
  });
});
