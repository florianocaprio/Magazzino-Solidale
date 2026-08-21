import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  batch: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
  needs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@workspace/api-client-react", () => ({
  getListBisogniPianificatiQueryKey: (id: number) => ["bisogni", id],
  useListBisogniPianificati: () => ({
    data: mocks.needs,
    isLoading: false,
    refetch: mocks.refetch,
  }),
  useUpdateIntervento: () => ({
    mutateAsync: mocks.batch,
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
vi.mock("./bisogni-pianificati-editor", () => ({
  BisogniPianificatiEditor: ({
    value,
    onChange,
  }: {
    value: Array<Record<string, unknown>>;
    onChange: (value: Array<Record<string, unknown>>) => void;
  }) => (
    <div>
      <span data-testid="loaded-needs">{value.length}</span>
      <button
        type="button"
        onClick={() =>
          onChange(
            value.map((item, index) =>
              index === 0 ? { ...item, stato: "completato" } : item,
            ),
          )
        }
      >
        completa
      </button>
      <button
        type="button"
        onClick={() =>
          onChange(
            value.map((item, index) =>
              index === 0 ? { ...item, stato: "da_pianificare" } : item,
            ),
          )
        }
      >
        riapri
      </button>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...value,
            {
              clientKey: "new",
              tipo: "azione",
              descrizione: "Nuovo bisogno",
              stato: "da_pianificare",
              dataPrevista: "",
              priorita: "alta",
              note: "",
            },
          ])
        }
      >
        nuovo
      </button>
    </div>
  ),
}));

import { UdsBisogniDialog } from "./uds-bisogni-dialog";

const need = (stato = "pianificato") => ({
  id: 9,
  interventoId: 31,
  tipo: "azione",
  descrizione: "Contatto",
  stato,
  dataPrevista: "2026-08-30",
  priorita: "normale",
  note: null,
  versione: 3,
  dataCompletamento: stato === "completato" ? "2026-08-21T10:00:00Z" : null,
  dataCreazione: "2026-08-20T10:00:00Z",
  dataAggiornamento: "2026-08-20T10:00:00Z",
});

describe("dialog Gestisci Bisogni UDS", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.needs = [need()];
    mocks.batch.mockResolvedValue({});
    mocks.refetch.mockResolvedValue({ data: mocks.needs });
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

  async function renderDialog() {
    await act(async () =>
      root.render(
        <UdsBisogniDialog
          interventoId={31}
          interventoVersione="2026-08-21T10:00:00.000Z"
          open
          onOpenChange={vi.fn()}
          onChanged={vi.fn()}
        />,
      ),
    );
  }

  async function click(label: string) {
    const button = Array.from(document.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === label,
    );
    await act(async () => button?.click());
  }

  it("carica la lista e completa con una sola mutation batch versionata", async () => {
    await renderDialog();
    expect(
      document.querySelector('[data-testid="loaded-needs"]')?.textContent,
    ).toBe("1");
    await click("completa");
    await click("common.save");
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch).toHaveBeenCalledWith({
      id: 31,
      data: {
        versione: "2026-08-21T10:00:00.000Z",
        bisogniPianificati: [
          expect.objectContaining({
            id: 9,
            versione: 3,
            stato: "completato",
          }),
        ],
      },
    });
  });

  it("riapre e crea un nuovo Bisogno sull'Intervento concluso", async () => {
    mocks.needs = [need("completato")];
    await renderDialog();
    await click("riapri");
    await click("nuovo");
    await click("common.save");
    expect(mocks.batch).toHaveBeenCalledTimes(1);
    expect(mocks.batch.mock.calls[0]?.[0].data.bisogniPianificati).toEqual([
      expect.objectContaining({
        id: 9,
        versione: 3,
        stato: "da_pianificare",
      }),
      expect.objectContaining({ descrizione: "Nuovo bisogno" }),
    ]);
  });

  it("su 409 invalida, ricarica e non sovrascrive", async () => {
    mocks.batch.mockRejectedValue({ status: 409 });
    await renderDialog();
    await click("completa");
    await click("common.save");
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["bisogni", 31],
    });
    expect(mocks.refetch).toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "udsInterventi.concurrencyConflict",
        variant: "destructive",
      }),
    );
  });
});
