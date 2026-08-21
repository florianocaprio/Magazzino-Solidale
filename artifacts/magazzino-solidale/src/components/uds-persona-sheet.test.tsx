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
  linkCandidateMatches: [] as Array<{
    id: number;
    codice: string;
    nome: string;
    cognome: string;
    soprannome: null;
    fasciaEtaCorrente: string;
    versione: number;
    codiceFiscale?: string;
    telefono?: string;
    dataNascita?: string;
    centroAscoltoNome?: string;
  }>,
  linkCandidateFetching: false,
  fullDuplicateOptions: null as null | {
    query?: { enabled?: boolean };
  },
  linkCandidateParams: null as null | {
    search: string;
    areaOperativaId?: number;
  },
  linkCandidateOptions: null as null | {
    query?: { enabled?: boolean };
  },
  user: {
    id: 1,
    isAdmin: true,
    isSuperAdmin: false,
    areaOperativaId: 1,
    zonaUdsId: 10,
    aree: [] as string[],
    permessi: [] as string[],
  },
  update: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getCercaBeneficiariSimiliQueryKey: () => ["beneficiari", "cerca-simili"],
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListAreeOperativeQueryKey: () => ["areaOperativa"],
  getListUdsDirectoryQueryKey: () => ["uds", "directory"],
  getListUdsLinkCandidatesQueryKey: () => ["uds", "link-candidates"],
  useCercaBeneficiariSimili: (
    _params: unknown,
    options: { query?: { enabled?: boolean } },
  ) => {
    mocks.fullDuplicateOptions = options;
    return {
      data: mocks.duplicateMatches,
      isFetching: false,
    };
  },
  useCreateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useListCentriAscolto: () => ({ data: [] }),
  useListAreeOperative: () => ({ data: [{ id: 1, nome: "Roma" }] }),
  useListZoneUds: () => ({ data: [{ id: 10, nome: "Zona test" }] }),
  useListUdsDirectory: () => ({
    data: mocks.directoryMatches,
    isFetching: mocks.directoryFetching,
  }),
  useListUdsLinkCandidates: (
    params: { search: string; areaOperativaId?: number },
    options: { query?: { enabled?: boolean } },
  ) => {
    mocks.linkCandidateParams = params;
    mocks.linkCandidateOptions = options;
    return {
      data: options.query?.enabled ? mocks.linkCandidateMatches : undefined,
      isFetching:
        Boolean(options.query?.enabled) && mocks.linkCandidateFetching,
    };
  },
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
  useAuth: () => ({ user: mocks.user }),
}));

import { UdsPersonaSheet } from "./uds-persona-sheet";
import { udsAnagrafica } from "@/lib/i18n/namespaces/udsAnagrafica";

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
    mocks.linkCandidateMatches = [];
    mocks.linkCandidateFetching = false;
    mocks.fullDuplicateOptions = null;
    mocks.linkCandidateParams = null;
    mocks.linkCandidateOptions = null;
    mocks.user = {
      id: 1,
      isAdmin: true,
      isSuperAdmin: false,
      areaOperativaId: 1,
      zonaUdsId: 10,
      aree: [],
      permessi: [],
    };
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

  const usePureUdsUser = () => {
    mocks.user = {
      id: 1,
      isAdmin: false,
      isSuperAdmin: false,
      areaOperativaId: 1,
      zonaUdsId: 10,
      aree: ["uds"],
      permessi: ["uds.directory.view", "beneficiari.manage"],
    };
  };

  const searchExistingPerson = async (search: string): Promise<void> => {
    await setInputValue("#uds-persona-existing-search", search);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
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

  it("un operatore UDS puro usa i link candidates minimizzati e non la full duplicate search", async () => {
    usePureUdsUser();
    mocks.linkCandidateMatches = [
      {
        id: 301,
        codice: "SOC-301",
        nome: "Lucia",
        cognome: "Riservata",
        soprannome: null,
        fasciaEtaCorrente: "30_64",
        versione: 4,
        codiceFiscale: "RSSLCU80A01H501X",
        telefono: "3331234567",
        dataNascita: "1980-01-01",
        centroAscoltoNome: "Centro Sociale Segreto",
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

    await searchExistingPerson("Lucia");

    expect(mocks.fullDuplicateOptions?.query?.enabled).toBe(false);
    expect(mocks.linkCandidateParams).toEqual({ search: "Lucia" });
    expect(mocks.linkCandidateOptions?.query?.enabled).toBe(true);
    expect(document.body.textContent).toContain("Lucia");
    expect(document.body.textContent).toContain("Riservata");
    expect(document.body.textContent).toContain("SOC-301");
    expect(document.body.textContent).toContain(
      "udsAnagrafica.dupStatusShared",
    );
    expect(udsAnagrafica.it.dupStatusShared).toBe(
      "Già presente nel sistema",
    );
    for (const forbidden of [
      "RSSLCU80A01H501X",
      "3331234567",
      "1980-01-01",
      "Centro Sociale Segreto",
    ]) {
      expect(document.body.textContent).not.toContain(forbidden);
    }
    const save = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    );
    expect(save?.hasAttribute("disabled")).toBe(true);
    const continueNew = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.trim() === "udsAnagrafica.dupContinueNew",
    );
    expect(continueNew).toBeDefined();
    await act(async () => continueNew?.click());
    expect(save?.hasAttribute("disabled")).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("collega il candidato minimizzato riutilizzando il PATCH con data di nascita autorevole", async () => {
    usePureUdsUser();
    mocks.linkCandidateMatches = [
      {
        id: 302,
        codice: "SOC-302",
        nome: "Anna",
        cognome: "Esistente",
        soprannome: null,
        fasciaEtaCorrente: "non_determinata",
        versione: 9,
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
    await searchExistingPerson("Anna");
    await selectFormOption("beneficiarioDettaglio.areaProvenienza", "UE");
    await setInputValue('input[name="dataNascita"]', "2000-01-01");

    await openSocialLinkConfirmation();

    expect(mocks.update).toHaveBeenCalledWith(
      {
        id: 302,
        data: {
          uds: true,
          versione: 9,
          zonaUdsId: 10,
          areaProvenienza: "UE",
          dataNascita: "2000-01-01",
          fasciaEtaPresunta: null,
        },
      },
      expect.any(Object),
    );
  });

  it("include il caricamento link-candidates nello stato di verifica duplicati", async () => {
    usePureUdsUser();
    mocks.linkCandidateFetching = true;
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

    await searchExistingPerson("Mario");

    expect(document.body.textContent).toContain(
      "udsAnagrafica.duplicateCheckInProgress",
    );
  });

  it("non richiede override di Area e non mostra candidati esclusi dallo scope server", async () => {
    usePureUdsUser();
    mocks.linkCandidateMatches = [];
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

    await searchExistingPerson("Milano");

    expect(mocks.linkCandidateParams).toEqual({ search: "Milano" });
    expect(
      Array.from(document.querySelectorAll("button")).some(
        (button) => button.textContent?.trim() === "udsAnagrafica.dupAdd",
      ),
    ).toBe(false);
  });

  it("continua a selezionare una persona già UDS dalla directory normale", async () => {
    usePureUdsUser();
    mocks.directoryMatches = [
      {
        id: 401,
        nome: "Persona",
        cognome: "GiaUds",
        soprannome: null,
        zonaUdsId: 10,
      },
    ];
    const onOpenChange = vi.fn();
    const onPersonReady = vi.fn();
    await act(async () => {
      root.render(
        <UdsPersonaSheet
          open
          onOpenChange={onOpenChange}
          initialAreaOperativaId={1}
          initialZonaUdsId={10}
          onPersonReady={onPersonReady}
        />,
      );
    });
    const select = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "udsAnagrafica.dupSelect",
    );
    expect(select).toBeDefined();

    await act(async () => select?.click());

    expect(onPersonReady).toHaveBeenCalledWith(
      {
        id: 401,
        nome: "Persona",
        cognome: "GiaUds",
        soprannome: null,
        zonaUdsId: 10,
      },
      "existing",
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
