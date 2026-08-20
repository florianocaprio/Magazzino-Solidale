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
  useListZoneUds: () => ({ data: [] }),
  useListUdsDirectory: () => ({
    data: [
      {
        id: 7,
        codice: "UDS-7",
        nome: "Mario",
        cognome: "Rossi",
        soprannome: null,
        fasciaEtaCorrente: "30_49",
        zonaUdsId: 11,
        zonaUdsNome: "Zona B",
        canale: "uds",
        accessoCompleto: false,
      },
    ],
  }),
  useListInterventi: () => ({ data: [intervention], isLoading: false }),
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
    user: { id: 2, areaOperativaId: 1, zonaUdsId: 11 },
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
  UdsPersonaSheet: () => null,
}));
vi.mock("@/components/bisogni-pianificati-editor", () => ({
  BisogniPianificatiEditor: () => null,
}));
vi.mock("@/components/intervento-workflow", () => ({
  InterventoStatoBadge: ({ stato }: { stato: string }) => <span>{stato}</span>,
  interventoDataLabel: () => "21/08/2026",
}));

import UdsInterventi from "@/pages/uds-interventi";

describe("hardening UI Interventi UDS", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.permissions = new Set([
      "uds.interventi.create",
      "uds.interventi.update",
      "uds.interventi.note",
      "uds.bisogni.manage",
    ]);
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
    expect(
      document.querySelector('button[title="udsInterventi.editAction"]'),
    ).toBeNull();
  });
});
