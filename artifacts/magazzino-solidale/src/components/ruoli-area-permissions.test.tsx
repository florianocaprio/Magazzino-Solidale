import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListRuoliQueryKey: () => ["ruoli"],
  useListRuoli: () => ({ data: [], isLoading: false }),
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
});
