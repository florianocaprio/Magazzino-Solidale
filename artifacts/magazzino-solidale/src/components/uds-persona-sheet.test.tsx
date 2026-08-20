import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/api-client-react", () => ({
  getCercaBeneficiariSimiliQueryKey: () => ["beneficiari", "cerca-simili"],
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListAreeOperativeQueryKey: () => ["areaOperativa"],
  getListUdsDirectoryQueryKey: () => ["uds", "directory"],
  useCercaBeneficiariSimili: () => ({ data: [], isFetching: false }),
  useCreateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useListCentriAscolto: () => ({ data: [] }),
  useListAreeOperative: () => ({ data: [{ id: 1, nome: "Roma" }] }),
  useListZoneUds: () => ({ data: [{ id: 10, nome: "Zona test" }] }),
  useListUdsDirectory: () => ({ data: [], isFetching: false }),
  useUpdateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: 1, areaOperativaId: 1, zonaUdsId: 10 } }),
}));

import { UdsPersonaSheet } from "./uds-persona-sheet";

describe("UdsPersonaSheet", () => {
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

  it("inizializza il form una sola volta per apertura e permette chiusura e riapertura", async () => {
    const onOpenChange = vi.fn();
    const renderSheet = async (open: boolean, initialZonaUdsId = 10) => {
      await act(async () => {
        root.render(
          <UdsPersonaSheet
            open={open}
            onOpenChange={onOpenChange}
            initialAreaOperativaId={1}
            initialZonaUdsId={initialZonaUdsId}
          />,
        );
      });
    };

    await renderSheet(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await renderSheet(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("udsAnagrafica.newTitle");
    expect(
      document.querySelector("#uds-persona-existing-search"),
    ).toBeInstanceOf(HTMLInputElement);
    expect(
      document.querySelectorAll('[role="combobox"]').length,
    ).toBeGreaterThan(0);
    expect(onOpenChange).not.toHaveBeenCalled();

    const fasciaPreview = document.querySelector(
      '[data-testid="fascia-eta-corrente"]',
    );
    expect(fasciaPreview?.textContent).toContain(
      "udsAnagrafica.fasciaEta.non_determinata",
    );
    expect(fasciaPreview?.textContent).toContain(
      "udsAnagrafica.fasciaEtaOrigine.non_determinata",
    );

    const dataNascitaInput = document.querySelector<HTMLInputElement>(
      'input[name="dataNascita"]',
    );
    expect(dataNascitaInput).not.toBeNull();
    const birthDateAge20 = `${new Date().getFullYear() - 20}-01-01`;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(dataNascitaInput, birthDateAge20);
      dataNascitaInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(fasciaPreview?.textContent).toContain(
      "udsAnagrafica.fasciaEta.18_29",
    );
    expect(fasciaPreview?.textContent).toContain(
      "udsAnagrafica.fasciaEtaOrigine.calcolata",
    );
    expect(fasciaPreview?.textContent).toContain(
      "udsAnagrafica.fasciaEtaCalcolataHint",
    );

    const nomeInput =
      document.querySelector<HTMLInputElement>('input[name="nome"]');
    expect(nomeInput).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(nomeInput, "Mario");
      nomeInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(nomeInput?.value).toBe("Mario");

    await renderSheet(true, 11);
    expect(
      document.querySelector<HTMLInputElement>('input[name="nome"]')?.value,
    ).toBe("Mario");
    expect(onOpenChange).not.toHaveBeenCalled();

    await renderSheet(false, 11);
    await renderSheet(true, 11);
    expect(
      document.querySelector<HTMLInputElement>('input[name="nome"]')?.value,
    ).toBe("");
    expect(
      document.querySelector('[data-testid="fascia-eta-corrente"]')
        ?.textContent,
    ).toContain("udsAnagrafica.fasciaEta.non_determinata");
    expect(onOpenChange).not.toHaveBeenCalled();

    const cancelButtons = Array.from(
      document.querySelectorAll("button"),
    ).filter((button) => button.textContent?.trim() === "common.cancel");
    expect(cancelButtons).toHaveLength(1);
    await act(async () => cancelButtons[0]?.click());
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
