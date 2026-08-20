import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { todayEuropeRome } from "@/lib/europe-rome";

const mocks = vi.hoisted(() => ({
  moduloAttivo: true,
  areas: new Set<string>(),
  permissions: new Set<string>(),
  history: [] as Array<Record<string, unknown>>,
  historyLoading: false,
  historyError: false,
  mense: [{ id: 12, nome: "Mensa Roma", attiva: true }],
  historyHook: vi.fn(),
  menseHook: vi.fn(),
  createMutate: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListMensaAbilitazioniQueryKey: (params: unknown) => [
    "mensa-abilitazioni",
    params,
  ],
  getListMenseQueryKey: (params: unknown) => ["mense", params],
  useListMensaAbilitazioni: (params: unknown, options: unknown) => {
    mocks.historyHook(params, options);
    return {
      data: mocks.history,
      isLoading: mocks.historyLoading,
      isError: mocks.historyError,
    };
  },
  useListMense: (params: unknown, options: unknown) => {
    mocks.menseHook(params, options);
    return { data: mocks.mense, isLoading: false };
  },
  useCreateMensaAbilitazione: () => ({
    mutate: mocks.createMutate,
    isPending: false,
  }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    hasArea: (area: string) => mocks.areas.has(area),
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock("@/lib/use-moduli", () => ({
  useModuloFlags: () => ({ mensaAbilitato: mocks.moduloAttivo }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await import("react");
  const SelectContext = ReactModule.createContext<
    ((value: string) => void) | null
  >(null);
  return {
    Select: ({
      onValueChange,
      children,
    }: {
      onValueChange: (value: string) => void;
      children: React.ReactNode;
    }) =>
      ReactModule.createElement(
        SelectContext.Provider,
        { value: onValueChange },
        children,
      ),
    SelectTrigger: ({
      children,
      ...props
    }: React.HTMLAttributes<HTMLButtonElement>) =>
      ReactModule.createElement(
        "button",
        { type: "button", ...props },
        children,
      ),
    SelectValue: ({ placeholder }: { placeholder?: string }) =>
      ReactModule.createElement("span", null, placeholder),
    SelectContent: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement("div", null, children),
    SelectItem: ({
      value,
      children,
    }: {
      value: string;
      children: React.ReactNode;
    }) => {
      const onValueChange = ReactModule.useContext(SelectContext);
      return ReactModule.createElement(
        "button",
        { type: "button", onClick: () => onValueChange?.(value) },
        children,
      );
    },
  };
});

import { BeneficiarioMensaSection } from "./beneficiario-mensa-card";

const beneficiario = {
  id: 42,
  attivo: true,
  statoAnagrafica: "completa" as const,
  areaOperativaId: 1,
};

const activeEligibility = {
  id: 7,
  beneficiarioId: 42,
  mensaId: 12,
  mensaNome: "Mensa Roma",
  dataInizio: "2026-01-01",
  dataFine: null,
  stato: "attiva",
  mensaPrincipale: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  versione: "2026-01-01T00:00:00.000Z",
};

describe("Mensa nella scheda Beneficiario", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.moduloAttivo = true;
    mocks.areas = new Set(["mensa"]);
    mocks.permissions = new Set(["mensa.view"]);
    mocks.history = [];
    mocks.historyLoading = false;
    mocks.historyError = false;
    mocks.mense = [{ id: 12, nome: "Mensa Roma", attiva: true }];
    mocks.createMutate.mockReset();
    mocks.invalidateQueries.mockClear();
    mocks.toast.mockClear();
    mocks.historyHook.mockClear();
    mocks.menseHook.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const renderSection = async () => {
    await act(async () =>
      root.render(<BeneficiarioMensaSection beneficiario={beneficiario} />),
    );
  };

  it("non monta la card e non avvia query Mensa se il modulo è disabilitato", async () => {
    mocks.moduloAttivo = false;
    await renderSection();

    expect(
      document.querySelector('[data-testid="beneficiario-mensa-card"]'),
    ).toBeNull();
    expect(mocks.historyHook).not.toHaveBeenCalled();
    expect(mocks.menseHook).not.toHaveBeenCalled();
  });

  it("non monta la card senza mensa.view", async () => {
    mocks.permissions.clear();
    await renderSection();

    expect(
      document.querySelector('[data-testid="beneficiario-mensa-card"]'),
    ).toBeNull();
    expect(mocks.historyHook).not.toHaveBeenCalled();
  });

  it("non monta la card e non avvia query senza area Mensa", async () => {
    mocks.areas.clear();
    mocks.permissions = new Set(["mensa.view", "mensa.eligibility.manage"]);
    await renderSection();

    expect(
      document.querySelector('[data-testid="beneficiario-mensa-card"]'),
    ).toBeNull();
    expect(mocks.historyHook).not.toHaveBeenCalled();
    expect(mocks.menseHook).not.toHaveBeenCalled();
  });

  it("non espone gestione con manage senza mensa.view", async () => {
    mocks.permissions = new Set(["mensa.eligibility.manage"]);
    await renderSection();

    expect(
      document.querySelector('[data-testid="beneficiario-mensa-card"]'),
    ).toBeNull();
    expect(mocks.historyHook).not.toHaveBeenCalled();
  });

  it("con mensa.view mostra stato, Mensa principale e validità senza azioni", async () => {
    mocks.history = [activeEligibility];
    await renderSection();

    expect(document.body.textContent).toContain("Abilitazione Mensa attiva");
    expect(document.body.textContent).toContain("Mensa Roma");
    expect(document.body.textContent).toContain("01/01/2026");
    expect(document.body.textContent).toContain("senza scadenza");
    expect(document.body.textContent).not.toContain("Abilita alla Mensa");
  });

  it("mostra PROGRAMMATA per un'abilitazione attiva con inizio futuro", async () => {
    mocks.history = [
      {
        ...activeEligibility,
        dataInizio: "2999-01-01",
      },
    ];
    await renderSection();

    expect(document.body.textContent).toContain(
      "Abilitazione Mensa programmata",
    );
    expect(document.body.textContent).toContain("PROGRAMMATA");
    expect(document.body.textContent).not.toContain("Non abilitato alla Mensa");
  });

  it("riusa la stessa gestione nella variante compatta della modifica rapida", async () => {
    mocks.permissions.add("mensa.eligibility.manage");
    await act(async () =>
      root.render(
        <BeneficiarioMensaSection beneficiario={beneficiario} compact />,
      ),
    );

    expect(
      document.querySelector('[data-testid="beneficiario-mensa-card"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain("NON ABILITATO");
    expect(document.body.textContent).toContain("Abilita alla Mensa");
  });

  it("non propone una seconda abilitazione quando ne esiste già una attiva", async () => {
    mocks.permissions.add("mensa.eligibility.manage");
    mocks.history = [activeEligibility];
    await renderSection();

    expect(document.body.textContent).not.toContain("Abilita alla Mensa");
  });

  it("mostra lo stato storico e consente al gestore di creare una nuova principale", async () => {
    mocks.permissions.add("mensa.eligibility.manage");
    mocks.history = [
      {
        ...activeEligibility,
        stato: "sospesa",
        dataFine: "2026-06-30",
      },
    ];
    mocks.createMutate.mockImplementation(
      (_input: unknown, options?: { onSuccess?: () => Promise<void> }) =>
        void options?.onSuccess?.(),
    );
    await renderSection();

    expect(document.body.textContent).toContain("Non abilitato alla Mensa");
    expect(document.body.textContent).toContain("SOSPESA");
    const open = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Abilita alla Mensa"),
    );
    await act(async () => open?.click());

    expect(mocks.menseHook).toHaveBeenLastCalledWith(
      { attiva: true, areaOperativaId: 1 },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(
      (document.querySelector("#mensa-data-inizio") as HTMLInputElement).value,
    ).toBe(todayEuropeRome());
    const mensaOption = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Mensa Roma",
    );
    await act(async () => mensaOption?.click());
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Conferma abilitazione"),
    );
    await act(async () => confirm?.click());

    expect(mocks.createMutate).toHaveBeenCalledWith(
      {
        data: {
          beneficiarioId: 42,
          mensaId: 12,
          dataInizio: todayEuropeRome(),
          dataFine: null,
          mensaPrincipale: true,
        },
      },
      expect.any(Object),
    );
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["mensa-abilitazioni", { beneficiarioId: 42 }],
    });
    expect(mocks.toast).toHaveBeenCalledWith({
      title: "Beneficiario abilitato alla Mensa",
    });
  });
});
