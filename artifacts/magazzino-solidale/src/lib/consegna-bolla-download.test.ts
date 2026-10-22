import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  settings: vi.fn(),
  pdf: vi.fn(),
  saved: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  getBollaTrasportoConsegna: mocks.read,
  getStampaOperativa: mocks.settings,
}));
vi.mock("./bolla-pdf", () => ({ generateBollaPdf: mocks.pdf }));
vi.mock("./branding-ambiente", () => ({
  loadDocumentBrandingForPdf: async () => ({
    branding: null,
    logoDataUrl: null,
  }),
}));
import { downloadConsegnaBolla } from "./consegna-bolla-download";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ id: 9, versione: 2, numeroBolla: "TR-9" });
  mocks.settings.mockResolvedValue({
    templateBolla: "standard",
    footerBolla: "Footer",
  });
  mocks.pdf.mockImplementation(async ({ beforeSave }) => {
    await beforeSave();
    mocks.saved();
  });
});
describe("download bolla dalla sola consegna", () => {
  it("usa l'endpoint circoscritto e ricontrolla il permesso prima di salvare il PDF", async () => {
    await downloadConsegnaBolla(7);
    expect(mocks.read.mock.calls).toEqual([[7], [7]]);
    expect(mocks.settings).toHaveBeenCalledWith({ contesto: "consegne" });
    expect(mocks.saved).toHaveBeenCalledOnce();
  });
  it("una revoca durante la preparazione impedisce il salvataggio", async () => {
    mocks.read
      .mockResolvedValueOnce({ id: 9, versione: 2 })
      .mockRejectedValueOnce(new Error("403"));
    await expect(downloadConsegnaBolla(7)).rejects.toThrow("403");
    expect(mocks.saved).not.toHaveBeenCalled();
  });
  it("un documento aggiornato richiede un nuovo download", async () => {
    mocks.read
      .mockResolvedValueOnce({ id: 9, versione: 2 })
      .mockResolvedValueOnce({ id: 9, versione: 3 });
    await expect(downloadConsegnaBolla(7)).rejects.toThrow(
      "La bolla è cambiata",
    );
    expect(mocks.saved).not.toHaveBeenCalled();
  });
});
