import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  duplicateMatches: [] as Array<{
    id: number;
    codice: string;
    nome: string;
    cognome: string;
    soprannome: null;
    dataNascita: null;
    telefono: null;
    areaOperativaId: number;
    areaOperativaNome: string;
    zonaUdsId: null;
    zonaUdsNome: null;
    centroAscoltoId: number;
    centroAscoltoNome: string;
    uds: boolean;
    versione: number;
    score: number;
  }>,
  directoryMatches: [] as Array<{
    id: number;
    nome: string;
    cognome: string;
    soprannome: null;
    zonaUdsId: number;
  }>,
  directoryFetching: false,
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getCercaBeneficiariSimiliQueryKey: () => ["beneficiari", "cerca-simili"],
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListAreeOperativeQueryKey: () => ["areaOperativa"],
  getListUdsDirectoryQueryKey: () => ["uds", "directory"],
  useCercaBeneficiariSimili: () => ({
    data: mocks.duplicateMatches,
    isFetching: false,
  }),
  useCreateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useListCentriAscolto: () => ({ data: [] }),
  useListAreeOperative: () => ({ data: [{ id: 1, nome: "Roma" }] }),
  useListZoneUds: () => ({ data: [{ id: 10, nome: "Zona test" }] }),
  useListUdsDirectory: () => ({
    data: mocks.directoryMatches,
    isFetching: mocks.directoryFetching,
  }),
  useUpdateBeneficiario: () => ({ mutate: mocks.update, isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      isAdmin: true,
      areaOperativaId: 1,
      zonaUdsId: 10,
    },
  }),
}));

import { UdsPersonaSheet } from "./uds-persona-sheet";

describe("UdsPersonaSheet", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.duplicateMatches = [];
    mocks.directoryMatches = [];
    mocks.directoryFetching = false;
    mocks.update.mockReset();
    mocks.toast.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  const setInputValue = async (
    selector: string,
    value: string,
  ): Promise<HTMLInputElement> => {
    const input = document.querySelector<HTMLInputElement>(selector);
    expect(input).not.toBeNull();
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    return input!;
  };

  const selectFormOption = async (
    labelText: string,
    optionText: string,
  ): Promise<void> => {
    const label = Array.from(document.querySelectorAll("label")).find((item) =>
      item.textContent?.includes(labelText),
    );
    const trigger =
      label?.parentElement?.querySelector<HTMLButtonElement>(
        '[role="combobox"]',
      );
    expect(trigger).not.toBeNull();
    await act(async () => trigger?.click());
    const option = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((item) => item.textContent?.trim() === optionText);
    expect(option).toBeDefined();
    await act(async () => option?.click());
  };

  const openSocialLinkConfirmation = async (): Promise<void> => {
    const add = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "udsAnagrafica.dupAdd",
    );
    expect(add).toBeDefined();
    await act(async () => add?.click());
    expect(document.body.textContent).toContain(
      "udsAnagrafica.dupConfirmTitle",
    );
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim() === "udsAnagrafica.dupConfirmAction",
    );
    expect(confirm).toBeDefined();
    await act(async () => confirm?.click());
  };

  const renderWithSocialCandidate = async (
    onOpenChange = vi.fn(),
  ): Promise<typeof onOpenChange> => {
    mocks.duplicateMatches = [
      {
        id: 91,
        codice: "SOC-91",
        nome: "Maria",
        cognome: "Rossi",
        soprannome: null,
        dataNascita: null,
        telefono: null,
        areaOperativaId: 1,
        areaOperativaNome: "Roma",
        zonaUdsId: null,
        zonaUdsNome: null,
        centroAscoltoId: 22,
        centroAscoltoNome: "Centro Sociale",
        uds: false,
        versione: 7,
        score: 90,
      },
    ];
    await act(async () => {
      root.render(
        <UdsPersonaSheet
          open
          onOpenChange={onOpenChange}
          initialAreaOperativaId={1}
          initialZonaUdsId={10}
        />,
      );
    });
    return onOpenChange;
  };

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
    const optionalData = Array.from(document.querySelectorAll("details")).find(
      (details) =>
        details.textContent?.includes("udsAnagrafica.optionalDataTitle"),
    );
    expect(optionalData).not.toBeUndefined();
    expect(optionalData?.open).toBe(false);
    expect(document.body.textContent).not.toContain("beneficiari.udsToggle");
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

  it("spiega che senza data di nascita serve la fascia d'età", async () => {
    await act(async () => {
      root.render(
        <UdsPersonaSheet
          open
          onOpenChange={vi.fn()}
          initialAreaOperativaId={1}
          initialZonaUdsId={10}
        />,
      );
    });
    const form = document.querySelector("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(document.body.textContent).toContain(
      "udsAnagrafica.ageClassificationRequired",
    );
  });

  it("spiega la verifica duplicati e permette di continuare consapevolmente", async () => {
    mocks.directoryMatches = [
      {
        id: 77,
        nome: "Mario",
        cognome: "Rossi",
        soprannome: null,
        zonaUdsId: 10,
      },
    ];
    await act(async () => {
      root.render(
        <UdsPersonaSheet
          open
          onOpenChange={vi.fn()}
          initialAreaOperativaId={1}
          initialZonaUdsId={10}
        />,
      );
    });
    expect(document.body.textContent).toContain(
      "udsAnagrafica.dupTitle",
    );
    const continueNew = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("udsAnagrafica.dupContinueNew"),
    );
    expect(continueNew).toBeDefined();
    const save = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    );
    expect(save?.hasAttribute("disabled")).toBe(true);
    await act(async () => continueNew?.click());
    expect(save?.hasAttribute("disabled")).toBe(false);
  });

  it("mostra lo stato mentre verifica le persone già presenti", async () => {
    mocks.directoryFetching = true;
    await act(async () => {
      root.render(
        <UdsPersonaSheet
          open
          onOpenChange={vi.fn()}
          initialAreaOperativaId={1}
          initialZonaUdsId={10}
        />,
      );
    });
    expect(document.body.textContent).toContain(
      "udsAnagrafica.duplicateCheckInProgress",
    );
  });

  it("trasferisce area di provenienza e data di nascita nel collegamento Social-UDS", async () => {
    await renderWithSocialCandidate();
    await selectFormOption("beneficiarioDettaglio.areaProvenienza", "UE");
    await setInputValue('input[name="dataNascita"]', "2000-01-01");

    await openSocialLinkConfirmation();

    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.update.mock.calls[0]?.[0]).toEqual({
      id: 91,
      data: {
        uds: true,
        versione: 7,
        zonaUdsId: 10,
        areaProvenienza: "UE",
        dataNascita: "2000-01-01",
        fasciaEtaPresunta: null,
      },
    });
  });

  it("trasferisce area di provenienza e fascia presunta nel collegamento Social-UDS", async () => {
    await renderWithSocialCandidate();
    await selectFormOption("beneficiarioDettaglio.areaProvenienza", "Extra-UE");
    await selectFormOption(
      "udsAnagrafica.fasciaEtaLabel",
      "udsAnagrafica.fasciaEta.30_64",
    );

    await openSocialLinkConfirmation();

    expect(mocks.update.mock.calls[0]?.[0]).toEqual({
      id: 91,
      data: {
        uds: true,
        versione: 7,
        zonaUdsId: 10,
        areaProvenienza: "Extra-UE",
        fasciaEtaPresunta: "30_64",
      },
    });
  });

  it("mantiene aperto il form e i dati inseriti se manca l'area di provenienza", async () => {
    const onOpenChange = await renderWithSocialCandidate();
    const dataNascitaInput = await setInputValue(
      'input[name="dataNascita"]',
      "2000-01-01",
    );
    mocks.update.mockImplementationOnce((_input, callbacks) => {
      callbacks.onError({
        data: {
          error:
            "Per aggiungere la persona all'Unità di Strada indica l'Area di provenienza.",
        },
      });
    });

    await openSocialLinkConfirmation();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(dataNascitaInput.value).toBe("2000-01-01");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Per aggiungere la persona all'Unità di Strada indica l'Area di provenienza.",
        variant: "destructive",
      }),
    );
  });

  it("mantiene aperto il form e l'area inserita se manca la classificazione di età", async () => {
    const onOpenChange = await renderWithSocialCandidate();
    await selectFormOption("beneficiarioDettaglio.areaProvenienza", "UE");
    mocks.update.mockImplementationOnce((_input, callbacks) => {
      callbacks.onError({
        data: {
          error:
            "Se non conosci la data di nascita, seleziona la fascia d'età.",
        },
      });
    });

    await openSocialLinkConfirmation();

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain("UE");
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description:
          "Se non conosci la data di nascita, seleziona la fascia d'età.",
        variant: "destructive",
      }),
    );
  });
});
