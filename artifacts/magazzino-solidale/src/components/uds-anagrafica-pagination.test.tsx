import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  exportDirectory: vi.fn(),
  exportProps: null as null | { loadRows: () => Promise<unknown> },
  permissions: new Set<string>(),
  personaSheetProps: null as null | {
    open: boolean;
    initialZonaUdsId: number | null;
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAreeOperativeQueryKey: () => ["aree"],
  exportUdsDirectory: (...args: unknown[]) => mocks.exportDirectory(...args),
  useListUdsDirectory: (params: unknown) => mocks.list(params),
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({
    data: [
      { id: 20, nome: "Zona 20" },
      { id: 30, nome: "Zona 30" },
    ],
  }),
  useUpdateBeneficiarioStato: () => ({ mutate: vi.fn(), isPending: false }),
  useAuthorizeBeneficiariExport: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, areaOperativaId: 10, zonaUdsId: 20 },
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));
vi.mock("@/components/export-buttons", () => ({
  ExportButtons: (props: { loadRows: () => Promise<unknown> }) => {
    mocks.exportProps = props;
    return <button data-testid="uds-export">Export</button>;
  },
}));
vi.mock("@/components/uds-persona-sheet", () => ({
  UdsPersonaSheet: ({
    open,
    initialZonaUdsId,
  }: {
    open: boolean;
    initialZonaUdsId: number | null;
  }) => {
    mocks.personaSheetProps = { open, initialZonaUdsId };
    return null;
  },
}));
vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import UdsAnagrafica from "@/pages/uds-anagrafica";

const pageRows = (page: number) =>
  Array.from({ length: 50 }, (_, index) => ({
    id: page * 100 + index,
    codice: `UDS-${page}-${index}`,
    cognome: `Cognome ${page}-${index}`,
    nome: "Persona",
    soprannome: null,
    fasciaEtaCorrente: null,
    zonaUdsId: null,
    zonaUdsNome: null,
    canale: "uds" as const,
    accessoCompleto: index !== 0,
  }));

describe("paginazione UDS Anagrafica", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.list.mockImplementation((params: { page?: number }) => ({
      data: pageRows(params.page ?? 1),
      isLoading: false,
    }));
    mocks.permissions = new Set(["beneficiari.export", "beneficiari.manage"]);
    mocks.exportDirectory.mockResolvedValue([]);
    mocks.exportProps = null;
    mocks.personaSheetProps = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("naviga avanti/indietro e resetta pagina al cambio ricerca", async () => {
    await act(async () => root.render(<UdsAnagrafica />));
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, limit: 50 }),
    );
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ uds: true }),
    );
    expect(document.querySelector(`a[href="/beneficiari/${100}"]`)).toBeNull();

    const next = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Successiva",
    );
    await act(async () => next?.click());
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );

    const previous = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Precedente",
    );
    await act(async () => previous?.click());
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    await act(async () => next?.click());
    const search = document.querySelector<HTMLInputElement>(
      'input[placeholder="udsAnagrafica.searchPlaceholder"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "Mario");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, search: "Mario" }),
    );
  });

  it("cerca per default in tutta l'Area e propone la zona operatore alla nuova persona", async () => {
    await act(async () => root.render(<UdsAnagrafica />));

    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ zonaUdsId: expect.anything() }),
    );
    const newPerson = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsAnagrafica.newPerson"),
    );
    await act(async () => newPerson?.click());
    expect(mocks.personaSheetProps).toEqual({
      open: true,
      initialZonaUdsId: 20,
    });
  });

  it("applica la zona scelta esplicitamente anche alla nuova persona", async () => {
    await act(async () => root.render(<UdsAnagrafica />));
    const zoneFilter =
      document.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(zoneFilter).not.toBeNull();
    await act(async () => zoneFilter?.click());
    const zone20 = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Zona 20");
    expect(zone20).toBeDefined();
    await act(async () => zone20?.click());
    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ zonaUdsId: 20 }),
    );

    await act(async () => zoneFilter?.click());
    const zone30 = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Zona 30");
    expect(zone30).toBeDefined();
    await act(async () => zone30?.click());

    expect(mocks.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ zonaUdsId: 30 }),
    );
    const newPerson = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsAnagrafica.newPerson"),
    );
    await act(async () => newPerson?.click());
    expect(mocks.personaSheetProps).toEqual({
      open: true,
      initialZonaUdsId: 30,
    });
  });

  it("usa l'endpoint export dedicato e nasconde il comando senza permesso", async () => {
    await act(async () => root.render(<UdsAnagrafica />));
    expect(document.querySelector('[data-testid="uds-export"]')).not.toBeNull();
    await act(async () => {
      await mocks.exportProps?.loadRows();
    });
    expect(mocks.exportDirectory).toHaveBeenCalledWith({});

    mocks.permissions.delete("beneficiari.export");
    await act(async () => root.render(<UdsAnagrafica />));
    expect(document.querySelector('[data-testid="uds-export"]')).toBeNull();
  });
});
