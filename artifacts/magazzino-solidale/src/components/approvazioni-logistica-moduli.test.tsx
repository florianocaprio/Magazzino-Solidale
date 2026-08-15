import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const moduleState = vi.hoisted(() => ({ activeCodes: new Set<string>() }));
const mutate = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  getListApprovazioniLogisticaQueryKey: () => ["approvazioni-logistica"],
  useListApprovazioniLogistica: () => ({
    data: { volontari: [], mezzi: [] },
    isLoading: false,
  }),
  useApprovaMezzoLogistica: () => ({ mutate, isPending: false }),
  useApprovaVolontarioLogistica: () => ({ mutate, isPending: false }),
  useRespingiMezzoLogistica: () => ({ mutate, isPending: false }),
  useRespingiVolontarioLogistica: () => ({ mutate, isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/use-moduli", () => ({
  useConfigurazioneAmbienteFlags: () => ({
    isModuloAttivo: (codice: string) => moduleState.activeCodes.has(codice),
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import ApprovazioniLogistica from "@/pages/approvazioni-logistica";

function renderPage(...activeCodes: string[]) {
  moduleState.activeCodes = new Set(activeCodes);
  return renderToStaticMarkup(<ApprovazioniLogistica />);
}

describe("Approvazioni Logistica per modulo", () => {
  beforeEach(() => {
    moduleState.activeCodes.clear();
    mutate.mockReset();
  });

  it("mostra solo Volontari quando MEZZI è disattivato", () => {
    const html = renderPage("VOLONTARI");
    expect(html).toContain("approvazioniLogistica.volontariTitle");
    expect(html).not.toContain("approvazioniLogistica.mezziTitle");
  });

  it("mostra solo Mezzi quando VOLONTARI è disattivato", () => {
    const html = renderPage("MEZZI");
    expect(html).not.toContain("approvazioniLogistica.volontariTitle");
    expect(html).toContain("approvazioniLogistica.mezziTitle");
  });

  it("non mostra sezioni operative quando entrambi sono disattivati", () => {
    const html = renderPage();
    expect(html).not.toContain("approvazioniLogistica.volontariTitle");
    expect(html).not.toContain("approvazioniLogistica.mezziTitle");
  });
});
