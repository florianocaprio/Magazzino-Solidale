import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InterventiSocialiFilters } from "@/lib/interventi-sociali-filters";
import Interventi from "./interventi";

const state = vi.hoisted(() => ({
  created: null as null | {
    id: number;
    stato: string;
    dataAggiornamento: string;
  },
  createCalls: 0,
  transitionCalls: 0,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 4, areaOperativaId: 3, centroAscoltoId: 12 },
    hasPermission: () => true,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({}) }));
vi.mock("@/lib/interventi-sociali-cache", () => ({
  invalidateInterventiSociali: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));
vi.mock("@/components/interventi-sociali-workspace", () => ({
  InterventiSocialiWorkspace: ({
    filters,
    onFiltersChange,
  }: {
    filters: InterventiSocialiFilters;
    onFiltersChange: (next: InterventiSocialiFilters) => void;
  }) => (
    <div>
      <span data-testid="vista">{filters.vista}</span>
      <span data-testid="area">{filters.areaOperativaId}</span>
      <span data-testid="centro">{filters.centroAscoltoId}</span>
      <span data-testid="search">{filters.ricerca}</span>
      <button
        type="button"
        onClick={() => onFiltersChange({ ...filters, priorita: "alta" })}
      >
        cambia filtro
      </button>
    </div>
  ),
}));
vi.mock("@/components/intervento-sociale-form-sheet", () => ({
  InterventoSocialeFormSheet: ({
    open,
    mode,
    onSubmit,
  }: {
    open: boolean;
    mode: "da_pianificare" | "pianificato" | "gia_effettuato";
    onSubmit: (data: { stato: string }) => void;
  }) =>
    open ? (
      <button type="button" onClick={() => onSubmit({ stato: mode })}>
        salva intervento
      </button>
    ) : null,
}));
vi.mock("@/components/intervento-sociale-detail-sheet", () => ({
  InterventoSocialeDetailSheet: ({
    open,
    intervento,
    onPianifica,
    onOpenChange,
  }: {
    open: boolean;
    intervento?: { id: number };
    onPianifica: (input: {
      dataOraPianificata: string;
      priorita: "normale";
      sede: null;
      operatoreId: number;
    }) => void;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="detail">
        <span data-testid="detail-id">{intervento?.id}</span>
        <span>Richiesta al Magazzino</span>
        <button
          type="button"
          onClick={() =>
            onPianifica({
              dataOraPianificata: "2026-10-01T09:00:00Z",
              priorita: "normale",
              sede: null,
              operatoreId: 4,
            })
          }
        >
          Pianifica
        </button>
        <button type="button" onClick={() => onOpenChange(false)}>
          chiudi
        </button>
      </div>
    ) : null,
}));
vi.mock("@workspace/api-client-react", () => {
  const key = () => [];
  const empty = () => ({ data: [], isLoading: false, isError: false });
  const mutation = () => ({ isPending: false, mutate: vi.fn() });
  return {
    getGetInterventiRiepilogoVisteQueryKey: key,
    getGetInterventoOperativitaQueryKey: key,
    getGetInterventoQueryKey: key,
    getListBeneficiariQueryKey: key,
    getListBisogniPianificatiQueryKey: key,
    getListInterventiOperatoriQueryKey: key,
    getListInterventiQueryKey: key,
    getListInterventoStoricoStatiQueryKey: key,
    getListAreeOperativeQueryKey: key,
    useGetInterventiRiepilogoViste: () => ({ data: {} }),
    useGetIntervento: () => ({ data: state.created, isLoading: false }),
    useGetInterventoOperativita: () => ({ data: {}, isLoading: false }),
    useListInterventoStoricoStati: empty,
    useListBisogniPianificati: empty,
    useListBeneficiari: empty,
    useListCentriAscolto: empty,
    useListAreeOperative: empty,
    useListInterventi: empty,
    useListInterventiOperatori: empty,
    useListTipiIntervento: empty,
    useCreateIntervento: () => ({
      isPending: false,
      mutate: (
        input: { data: { stato: string } },
        callbacks: { onSuccess: (created: typeof state.created) => void },
      ) => {
        state.createCalls += 1;
        state.created = {
          id: 71,
          stato: input.data.stato,
          dataAggiornamento: "2026-09-29T09:00:00Z",
        };
        callbacks.onSuccess(state.created);
      },
    }),
    useAnnullaIntervento: mutation,
    useAvviaIntervento: mutation,
    useConcludiIntervento: mutation,
    useSalvaInterventoOperativita: mutation,
    useRegistraMancataPresentazione: mutation,
    updateIntervento: async () => ({
      ...state.created,
      dataAggiornamento: "2026-09-29T09:01:00Z",
    }),
    transitionIntervento: async () => {
      state.transitionCalls += 1;
      if (state.created)
        state.created = { ...state.created, stato: "pianificato" };
    },
  };
});

describe("M5C1-R1 continuità pagina Interventi", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    state.created = null;
    state.createCalls = 0;
    state.transitionCalls = 0;
    window.history.replaceState(
      null,
      "",
      "/interventi?vista=annullati&q=rossi&areaOperativa=3&centro=12&stato=annullato",
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const renderPage = async () => {
    await act(async () => root.render(<Interventi />));
  };

  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes(label),
    );
    expect(button, label).toBeTruthy();
    await act(async () => button?.click());
  };

  it("da Annullati apre il nuovo da pianificare, normalizza filtri e mantiene territorio/deep-link", async () => {
    await renderPage();
    await click("interventi.form.actions.da_pianificare");
    await click("salva intervento");
    expect(state.createCalls).toBe(1);
    expect(container.querySelector('[data-testid="vista"]')?.textContent).toBe(
      "da_pianificare",
    );
    expect(
      container.querySelector('[data-testid="detail-id"]')?.textContent,
    ).toBe("71");
    expect(container.textContent).toContain("Richiesta al Magazzino");
    expect(window.location.search).toContain("interventoId=71");
    expect(window.location.search).toContain("vista=da_pianificare");
    expect(window.location.search).toContain("areaOperativa=3");
    expect(window.location.search).toContain("centro=12");
    expect(window.location.search).not.toContain("q=rossi");
    expect(window.location.search).not.toContain("stato=annullato");
  });

  it("apre il pianificato e conserva il dettaglio dopo il cambio filtri", async () => {
    await renderPage();
    await click("interventi.form.actions.pianificato");
    await click("salva intervento");
    expect(container.querySelector('[data-testid="vista"]')?.textContent).toBe(
      "pianificati",
    );
    expect(
      container.querySelector('[data-testid="detail-id"]')?.textContent,
    ).toBe("71");
    await click("cambia filtro");
    expect(window.location.search).toContain("interventoId=71");
    await click("chiudi");
    expect(window.location.search).toContain("vista=pianificati");
    expect(window.location.search).not.toContain("interventoId");
  });

  it("dopo Pianifica passa alla vista Pianificati senza chiudere il dettaglio", async () => {
    await renderPage();
    await click("interventi.form.actions.da_pianificare");
    await click("salva intervento");
    await click("Pianifica");
    expect(state.transitionCalls).toBe(1);
    expect(container.querySelector('[data-testid="vista"]')?.textContent).toBe(
      "pianificati",
    );
    expect(
      container.querySelector('[data-testid="detail-id"]')?.textContent,
    ).toBe("71");
    expect(window.location.search).toContain("interventoId=71");
    expect(window.location.search).toContain("vista=pianificati");
    await click("chiudi");
    expect(window.location.search).not.toContain("interventoId");
  });
});
