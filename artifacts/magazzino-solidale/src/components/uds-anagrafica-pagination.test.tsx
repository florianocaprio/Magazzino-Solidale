import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  exportDirectory: vi.fn(),
  exportProps: null as null | { loadRows: () => Promise<unknown> },
  permissions: new Set<string>(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListAreeOperativeQueryKey: () => ["aree"],
  exportUdsDirectory: (...args: unknown[]) => mocks.exportDirectory(...args),
  useListUdsDirectory: (params: unknown) => mocks.list(params),
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
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
    user: { id: 1, areaOperativaId: 1, zonaUdsId: null },
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
  UdsPersonaSheet: () => null,
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
