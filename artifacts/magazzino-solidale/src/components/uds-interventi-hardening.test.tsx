import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  note: vi.fn(),
  rectify: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  permissions: new Set<string>(),
  createdInterventions: [] as unknown[],
  directoryParams: vi.fn(),
  personaSheetProps: null as null | {
    open: boolean;
    initialZonaUdsId: number | null;
  },
}));

const intervention = {
  id: 31,
  beneficiarioId: 7,
  operatoreId: 2,
  operatoreCodice: "OP-2",
  dataIntervento: "2026-08-21",
  tipoIntervento: "ascolto",
  descrizione: "Incontro",
  note: null,
  noteUds: null,
  stato: "concluso",
  ambito: "uds",
  dataOraPianificata: null,
  dataOraAvvio: null,
  dataOraConclusione: "2026-08-21T10:00:00.000Z",
  dataCreazione: "2026-08-21T10:00:00.000Z",
  dataAggiornamento: "2026-08-21T10:00:00.000Z",
  versione: "2026-08-21T10:00:00.000Z",
  bisogniPianificatiTotale: 0,
  bisogniPianificatiAperti: 0,
  bisogniPianificatiScaduti: 0,
  bisogniPianificatiProssimaScadenza: null,
};

vi.mock("@workspace/api-client-react", () => ({
  getListAreeOperativeQueryKey: () => ["aree"],
  getListInterventiQueryKey: (params: unknown) => ["interventi", params],
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({
    data: [
      { id: 20, nome: "Zona 20" },
      { id: 30, nome: "Zona 30" },
    ],
  }),
  useListUdsDirectory: (params: unknown) => {
    mocks.directoryParams(params);
    return {
      data: [
        {
          id: 7,
          codice: "UDS-7",
          nome: "Mario",
          cognome: "Rossi",
          soprannome: null,
          fasciaEtaCorrente: "30_49",
          zonaUdsId: 30,
          zonaUdsNome: "Zona 30",
          canale: "uds",
          accessoCompleto: false,
        },
      ],
    };
  },
  useListInterventi: () => ({
    data: [
      intervention,
      ...(mocks.createdInterventions as Array<typeof intervention>),
    ],
    isLoading: false,
  }),
  useListTipiIntervento: () => ({
    data: [{ id: 1, nome: "ascolto", attivo: true }],
  }),
  useCreateUdsIntervento: () => ({
    mutate: mocks.create,
    isPending: false,
  }),
  useUpdateUdsInterventoNota: () => ({
    mutate: mocks.note,
    isPending: false,
  }),
  useRectifyUdsIntervento: () => ({
    mutate: mocks.rectify,
    isPending: false,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 2, areaOperativaId: 10, zonaUdsId: 20 },
    hasArea: () => true,
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));
vi.mock("@/components/beneficiario-combobox", () => ({
  BeneficiarioCombobox: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange("7")}>
      seleziona-persona
    </button>
  ),
}));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("@/components/uds-persona-sheet", () => ({
  UdsPersonaSheet: ({
    open,
    onPersonReady,
    initialZonaUdsId,
  }: {
    open: boolean;
    initialZonaUdsId: number | null;
    onPersonReady: (
      person: {
        id: number;
        nome: string;
        cognome: string;
        areaOperativaId: number;
        zonaUdsId: number;
      },
      outcome: string,
    ) => void;
  }) => {
    mocks.personaSheetProps = { open, initialZonaUdsId };
    return open ? (
      <button
        type="button"
        onClick={() =>
          onPersonReady(
            {
              id: 7,
              nome: "Mario",
              cognome: "Rossi",
              areaOperativaId: 10,
              zonaUdsId: 20,
            },
            "created",
          )
        }
      >
        salva-persona-rapida
      </button>
    ) : null;
  },
}));
vi.mock("@/components/bisogni-pianificati-editor", () => ({
  BisogniPianificatiEditor: ({
    onChange,
  }: {
    onChange: (value: Array<Record<string, unknown>>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange([
          {
            clientKey: "quick-need",
            tipo: "richiesta",
            descrizione: "Vestiti taglia L",
            stato: "da_pianificare",
            dataPrevista: "",
            priorita: "normale",
            note: "",
          },
        ])
      }
    >
      aggiungi-bisogno-rapido
    </button>
  ),
}));
vi.mock("@/components/uds-bisogni-dialog", () => ({
  UdsBisogniDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="gestione-bisogni-dialog" /> : null,
}));
vi.mock("@/components/intervento-workflow", () => ({
  InterventoStatoBadge: ({ stato }: { stato: string }) => <span>{stato}</span>,
  interventoDataLabel: () => "21/08/2026",
}));

import UdsInterventi from "@/pages/uds-interventi";
import { udsInterventi } from "@/lib/i18n/namespaces/udsInterventi";

describe("hardening UI Interventi UDS", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.create.mockReset();
    mocks.directoryParams.mockReset();
    mocks.personaSheetProps = null;
    mocks.permissions = new Set([
      "uds.interventi.create",
      "uds.interventi.update",
      "uds.interventi.note",
      "uds.bisogni.manage",
      "beneficiari.manage",
    ]);
    mocks.createdInterventions.length = 0;
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

  async function renderAndSelectPerson() {
    await act(async () => root.render(<UdsInterventi />));
    const select = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "seleziona-persona",
    );
    await act(async () => select?.click());
  }

  it("presenta la descrizione come Sintesi e mantiene separato il materiale", () => {
    expect(udsInterventi.it.fBisogni).toBe("Sintesi dell'incontro");
    expect(udsInterventi.it.fBisogni).not.toMatch(/bisogni rilevati/i);
    expect(udsInterventi.it.fMateriale).toBe("Materiale consegnato");
    expect(udsInterventi.it.bisogniPianificatiTitle).toBe(
      "Bisogni e azioni",
    );
  });

  it("cerca per default in tutta l'Area e propone la zona operatore alla nuova persona", async () => {
    await act(async () => root.render(<UdsInterventi />));

    expect(mocks.directoryParams).toHaveBeenLastCalledWith(
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
    await act(async () => root.render(<UdsInterventi />));
    const zoneFilter =
      document.querySelector<HTMLButtonElement>('[role="combobox"]');
    expect(zoneFilter).not.toBeNull();
    await act(async () => zoneFilter?.click());
    const zone20 = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Zona 20");
    expect(zone20).toBeDefined();
    await act(async () => zone20?.click());
    expect(mocks.directoryParams).toHaveBeenLastCalledWith(
      expect.objectContaining({ zonaUdsId: 20 }),
    );

    await act(async () => zoneFilter?.click());
    const zone30 = Array.from(
      document.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Zona 30");
    expect(zone30).toBeDefined();
    await act(async () => zone30?.click());

    expect(mocks.directoryParams).toHaveBeenLastCalledWith(
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

  it("crea tramite operazione UDS esplicita senza inviare una data autorevole", async () => {
    await renderAndSelectPerson();
    const createButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsInterventi.newIntervento"),
    );
    await act(async () => createButton?.click());
    const form = document.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () =>
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
    expect(mocks.create).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          beneficiarioId: 7,
          tipoIntervento: "ascolto",
        }),
      },
      expect.any(Object),
    );
    expect(mocks.create.mock.calls[0]?.[0].data).not.toHaveProperty(
      "dataIntervento",
    );
    expect(
      document.querySelector('[data-testid="uds-new-intervento-today"]'),
    ).not.toBeNull();
    expect(document.querySelector('input[name="dataIntervento"]')).toBeNull();
  });

  it("copre il percorso da strada con Sintesi e bisogno rapido", async () => {
    mocks.create.mockImplementation(
      (
        input: { data: { descrizione?: string | null } },
        callbacks: { onSuccess: () => void },
      ) => {
        mocks.createdInterventions.push({
          ...intervention,
          id: 32,
          descrizione: input.data.descrizione ?? null,
        });
        callbacks.onSuccess();
      },
    );
    await renderAndSelectPerson();
    const createButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsInterventi.newIntervento"),
    );
    await act(async () => createButton?.click());
    const summary = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="descrizione"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(summary, "Incontrato a Termini");
      summary?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const addNeed = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "aggiungi-bisogno-rapido",
    );
    await act(async () => addNeed?.click());
    await act(async () =>
      document
        .querySelector("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(mocks.create.mock.calls.at(-1)?.[0].data).toMatchObject({
      descrizione: "Incontrato a Termini",
      bisogniPianificati: [
        {
          tipo: "richiesta",
          descrizione: "Vestiti taglia L",
          stato: "da_pianificare",
          dataPrevista: null,
          priorita: "normale",
          note: null,
        },
      ],
    });
    await act(async () => root.render(<UdsInterventi />));
    expect(
      Array.from(
        document.querySelectorAll('[data-testid="uds-intervento-mobile-card"]'),
      ).some((card) => card.textContent?.includes("Incontrato a Termini")),
    ).toBe(true);
  });

  it("seleziona automaticamente la persona appena creata e consente subito l'incontro", async () => {
    await act(async () => root.render(<UdsInterventi />));
    const newPerson = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsAnagrafica.newPerson"),
    );
    await act(async () => newPerson?.click());
    const savePerson = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "salva-persona-rapida",
    );
    await act(async () => savePerson?.click());
    const newIntervention = Array.from(
      document.querySelectorAll("button"),
    ).find((button) =>
      button.textContent?.includes("udsInterventi.newIntervento"),
    );
    expect(newIntervention?.hasAttribute("disabled")).toBe(false);
  });

  it("mantiene tabella desktop e card mobile con azioni touch", async () => {
    await renderAndSelectPerson();
    const mobile = document.querySelector(
      '[data-testid="uds-interventi-mobile"]',
    );
    const desktop = document.querySelector(
      '[data-testid="uds-interventi-desktop"]',
    );
    expect(mobile?.className).toContain("lg:hidden");
    expect(desktop?.className).toContain("hidden lg:block");
    expect(
      mobile?.querySelector('[data-testid="uds-intervento-mobile-card"]'),
    ).not.toBeNull();
    expect(mobile?.textContent).toContain("udsInterventi.manageBisogniAction");
    expect(mobile?.textContent).toContain("udsInterventi.mobileNoteAction");
    expect(mobile?.textContent).toContain("udsInterventi.editAction");
  });

  it("invia la versione alla Nota dedicata e su 409 ricarica lo storico", async () => {
    mocks.note.mockImplementation(
      (_input: unknown, callbacks: { onError: (error: unknown) => void }) =>
        callbacks.onError({ status: 409, data: { error: "Conflitto" } }),
    );
    await renderAndSelectPerson();
    const noteButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("udsInterventi.addNote"),
    );
    await act(async () => noteButton?.click());
    const saveButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "common.save",
    );
    await act(async () => saveButton?.click());
    expect(mocks.note).toHaveBeenCalledWith(
      {
        id: 31,
        data: {
          versione: intervention.dataAggiornamento,
          noteUds: null,
        },
      },
      expect.any(Object),
    );
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "udsInterventi.concurrencyConflict",
        variant: "destructive",
      }),
    );
  });

  it("nasconde create, Nota e rettifica quando mancano i permessi", async () => {
    mocks.permissions = new Set();
    await renderAndSelectPerson();
    expect(document.body.textContent).not.toContain(
      "udsInterventi.newIntervento",
    );
    expect(document.body.textContent).not.toContain("udsInterventi.addNote");
    expect(document.body.textContent).not.toContain(
      "udsInterventi.manageBisogniAction",
    );
    expect(
      document.querySelector('button[title="udsInterventi.editAction"]'),
    ).toBeNull();
  });

  it("espone Gestisci Bisogni sull'Intervento concluso come azione separata", async () => {
    await renderAndSelectPerson();
    const manage = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("udsInterventi.manageBisogniAction"),
    );
    expect(manage).toBeDefined();
    await act(async () => manage?.click());
    expect(
      document.querySelector('[data-testid="gestione-bisogni-dialog"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('button[title="udsInterventi.editAction"]'),
    ).not.toBeNull();
  });
});
