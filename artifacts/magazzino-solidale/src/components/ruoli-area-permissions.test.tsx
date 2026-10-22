import type { Ruolo } from "@workspace/api-client-react";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roles: [] as Ruolo[],
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListRuoliQueryKey: () => ["ruoli"],
  useListRuoli: () => ({ data: mocks.roles, isLoading: false }),
  useListAree: () => ({
    data: [
      { key: "generale", label: "Generale", permessi: [] },
      {
        key: "magazzino",
        label: "Magazzino",
        permessi: ["magazzino.view", "magazzino.stock.adjust", "bolle.view"],
      },
      {
        key: "sociale",
        label: "Sociale",
        permessi: ["sociale.interventi.view", "bolle.view"],
      },
      { key: "amministrazione", label: "Amministrazione", permessi: [] },
    ],
  }),
  useListPermessi: () => ({
    data: [
      { key: "magazzino.view", label: "Magazzino: consultazione" },
      {
        key: "magazzino.stock.adjust",
        label: "Magazzino: rettifiche inventariali",
      },
      { key: "bolle.view", label: "Bolle: consultazione" },
      {
        key: "sociale.interventi.view",
        label: "Interventi Sociali: consultazione",
      },
    ],
  }),
  useCreateRuolo: () => ({ mutate: mocks.create, isPending: false }),
  useUpdateRuolo: () => ({ mutate: mocks.update, isPending: false }),
  useDeleteRuolo: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Exercise the role form and its actions; menu portal mechanics are tested separately.
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: React.ReactNode; onClick?: () => void; disabled?: boolean }) => <button disabled={disabled} onClick={onClick}>{children}</button>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n", () => ({
  default: { t: (key: string) => key },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { isSuperAdmin: false } }),
}));

import Ruoli from "@/pages/ruoli";

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Pulsante non trovato: ${text}`);
  }
  return button;
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("pagina Ruoli: suggerimenti Area -> permessi", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.roles = [];
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

  it("preseleziona, personalizza, conserva i condivisi e invia il payload esplicito", async () => {
    await act(async () => root.render(<Ruoli />));
    await act(async () => buttonByText("ruoli.newRole").click());

    const name = document.querySelector<HTMLInputElement>("#r-nome");
    expect(name).not.toBeNull();
    await act(async () => setInputValue(name!, "Demo Completo"));

    const magazzino =
      document.querySelector<HTMLButtonElement>("#area-magazzino")!;
    await act(async () => magazzino.click());

    expect(magazzino.dataset.state).toBe("checked");
    expect(
      document.querySelector<HTMLElement>('[id="permission-magazzino.view"]')
        ?.dataset.state,
    ).toBe("checked");
    const stockAdjust = document.querySelector<HTMLButtonElement>(
      '[id="permission-magazzino.stock.adjust"]',
    )!;
    expect(stockAdjust.dataset.state).toBe("checked");
    expect(
      document.querySelector<HTMLElement>('[id="permission-bolle.view"]')
        ?.dataset.state,
    ).toBe("checked");

    await act(async () => stockAdjust.click());
    expect(stockAdjust.dataset.state).toBe("unchecked");
    expect(magazzino.dataset.state).toBe("indeterminate");

    const sociale = document.querySelector<HTMLButtonElement>("#area-sociale")!;
    await act(async () => sociale.click());
    await act(async () => magazzino.click());
    expect(magazzino.dataset.state).toBe("checked"); // complete the partial ordinary selection
    await act(async () => magazzino.click());

    expect(magazzino.dataset.state).toBe("unchecked");
    expect(sociale.dataset.state).toBe("checked");
    expect(
      document.querySelector<HTMLElement>('[id="permission-bolle.view"]')
        ?.dataset.state,
    ).toBe("checked");

    await act(async () => buttonByText("ruoli.createRole").click());

    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0][0]).toEqual({
      data: {
        nome: "Demo Completo",
        descrizione: undefined,
        aree: ["sociale"],
        permessi: ["bolle.view", "sociale.interventi.view"],
        isAdmin: false,
      },
    });
  });

  it("mantiene il flusso admin separato dalle Aree standard", async () => {
    await act(async () => root.render(<Ruoli />));
    await act(async () => buttonByText("ruoli.newRole").click());

    expect(document.querySelector("#area-amministrazione")).toBeNull();
    const name = document.querySelector<HTMLInputElement>("#r-nome")!;
    await act(async () => setInputValue(name, "Amministratore locale"));
    await act(async () =>
      document.querySelector<HTMLButtonElement>("#r-admin")!.click(),
    );

    expect(document.querySelector("#area-magazzino")).toBeNull();
    expect(
      document.querySelector('[id="permission-magazzino.view"]'),
    ).toBeNull();

    await act(async () => buttonByText("ruoli.createRole").click());
    expect(mocks.create.mock.calls[0][0]).toEqual({
      data: {
        nome: "Amministratore locale",
        descrizione: undefined,
        aree: [],
        permessi: [],
        isAdmin: true,
      },
    });
  });
  it("apre e salva un ruolo senza cambiare aree, ordine dei grant o chiavi persistite sconosciute", async () => {
    const role = { id: 91, nome: " Custom ", descrizione: " Note conservate ", aree: ["sociale", "legacy.area"], permessi: ["legacy.grant", "bolle.view"], isAdmin: false, dataCreazione: "2026-10-22" };
    mocks.roles = [role];
    await act(async () => root.render(<Ruoli />));
    await act(async () => buttonByText("common.edit").click());
    await act(async () => buttonByText("ruoli.saveChanges").click());
    expect(mocks.update.mock.calls[0][0]).toEqual({ id: 91, data: {
      nome: role.nome, descrizione: role.descrizione, aree: role.aree, permessi: role.permessi, isAdmin: false,
    } });
  });

  it("crea una copia personalizzata senza aggiornare il ruolo originale", async () => {
    const role = { id: 92, nome: "Operatore", descrizione: null, aree: ["sociale"], permessi: ["bolle.view"], isAdmin: false, dataCreazione: "2026-10-22" };
    mocks.roles = [role];
    await act(async () => root.render(<Ruoli />));
    await act(async () => buttonByText("Crea ruolo personalizzato da questo").click());
    await act(async () => buttonByText("ruoli.createRole").click());
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ nome: "Operatore - copia", aree: role.aree, permessi: role.permessi, isAdmin: false });
    expect(role.nome).toBe("Operatore");
  });

});
