import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  error: false,
  allowed: true,
  fetch: vi.fn(),
  pdf: vi.fn(),
  branding: vi.fn(),
  rows: [
    {
      id: 1,
      beneficiarioId: 7,
      beneficiarioNome: "Persona sintetica",
      numeroIntervento: 2,
      primoIntervento: false,
      dataIntervento: "2026-08-14",
      tipoIntervento: "ascolto",
      stato: "concluso",
      descrizione: "Sintesi distinta",
      note: "Coperte",
      noteUds: "Nota distinta",
      bisogniPianificati: [
        {
          id: 1,
          tipo: "azione",
          descrizione: "Appuntamento futuro",
          stato: "pianificato",
          priorita: "alta",
          dataPrevista: "2026-09-01",
        },
      ],
    },
  ],
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, areaOperativaId: 10 },
    hasArea: () => m.allowed,
    hasPermission: () => m.allowed,
  }),
}));
vi.mock("@/lib/use-moduli", () => ({
  useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useReportUdsInterventiGiornalieri: () => ({
    data: m.rows,
    isError: m.error,
    isFetching: false,
    isLoading: false,
  }),
  reportUdsInterventiGiornalieri: m.fetch,
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
  getListZoneUdsQueryKey: () => ["zones"],
  getReportUdsInterventiGiornalieriQueryKey: () => ["daily"],
}));
vi.mock("@/lib/branding-ambiente", () => ({
  loadDocumentBrandingForPdf: m.branding,
}));
vi.mock("@/lib/uds-report-pdf", () => ({
  exportUdsReportGiornalieroPdf: m.pdf,
}));
import Page from "./uds-report-giornaliero";
describe("report operativo UDS", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    m.error = false;
    m.allowed = true;
    m.pdf.mockReset();
    m.fetch.mockReset().mockResolvedValue(m.rows);
    m.branding
      .mockReset()
      .mockResolvedValue({ branding: {}, logoDataUrl: null });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const exportButton = () =>
    Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("udsReportGiornaliero.exportPdf"),
    );
  it("mostra contenuti separati e PDF ricavato dai dati autorizzati ricaricati", async () => {
    await act(async () => root.render(<Page />));
    expect(container.textContent).toContain("Sintesi distinta");
    expect(container.textContent).toContain("Appuntamento futuro");
    expect(container.textContent).toContain(
      "udsReportGiornaliero.currentNeeds",
    );
    await act(async () => exportButton()?.click());
    expect(m.fetch).toHaveBeenCalled();
    expect(m.pdf).toHaveBeenCalledOnce();
    expect(
      m.pdf.mock.calls[0][0].rows[0].sections.map(
        (s: { text: string }) => s.text,
      ),
    ).toEqual(
      expect.arrayContaining(["Sintesi distinta", "Coperte", "Nota distinta"]),
    );
  });
  it("errore e revoca non espongono cache né permettono esportazioni", async () => {
    m.error = true;
    await act(async () => root.render(<Page />));
    expect(container.textContent).not.toContain("Sintesi distinta");
    expect(exportButton()?.disabled).toBe(true);
    m.error = false;
    m.allowed = false;
    await act(async () => root.render(<Page />));
    expect(container.textContent).not.toContain("Sintesi distinta");
    expect(exportButton()?.disabled).toBe(true);
  });
  it("un errore di lettura fresca impedisce il PDF", async () => {
    m.fetch.mockRejectedValue(new Error("Accesso revocato"));
    await act(async () => root.render(<Page />));
    await act(async () => exportButton()?.click());
    expect(m.pdf).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Accesso revocato");
  });
});
