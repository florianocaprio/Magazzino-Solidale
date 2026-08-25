import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  calls: new Map<string, Mock<(payload: unknown) => void>>(),
  invalidate: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
  eventsParams: vi.fn(),
}));

function spy(name: string): Mock<(payload: unknown) => void> {
  let found = mocks.calls.get(name);
  if (!found) {
    found = vi.fn<(payload: unknown) => void>();
    mocks.calls.set(name, found);
  }
  return found;
}

vi.mock("@workspace/api-client-react", () => {
  const key =
    (name: string) =>
    (...args: unknown[]) => [name, ...args];
  const mutation = (
    name: string,
    options?: { mutation?: { onSuccess?: (value?: unknown) => unknown } },
    value?: unknown,
  ) => ({
    isPending: false,
    mutate: (payload: unknown) => {
      spy(name)(payload);
      void options?.mutation?.onSuccess?.(value);
    },
  });
  return {
    FseExportInputFormatCode: {
      FSE_CANONICAL_AUDIT_XLSX_V1: "FSE_CANONICAL_AUDIT_XLSX_V1",
      SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1:
        "SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1",
    },
    FseResolutionInputAzione: {
      ABBINA: "ABBINA",
      DISABBINA: "DISABBINA",
      ACCETTA_SCOSTAMENTO: "ACCETTA_SCOSTAMENTO",
      SEGNALA_ANOMALIA: "SEGNALA_ANOMALIA",
      RIAPRI: "RIAPRI",
    },
    getGetFseReconciliationQueryKey: key("reconciliation"),
    getGetFseExportQueryKey: key("export"),
    getGetFseReportingPreviewQueryKey: key("preview"),
    getListAgeaImportazioniQueryKey: key("agea"),
    getListFseExportsQueryKey: key("exports"),
    getListFseMonitoringQueryKey: key("monitoring"),
    getListFseReportingEventsQueryKey: key("events"),
    getListFseReportingQualityQueryKey: key("quality"),
    getListFseReconciliationsQueryKey: key("reconciliations"),
    getListFseReconciliationLinesQueryKey: key("reconciliation-lines"),
    useGetFseReportingPreview: () => ({
      data: {
        eventiTotali: 3,
        righeTotali: 4,
        bloccanti: 0,
        eventiArretrati: 1,
        eventiGiaCoperti: 2,
      },
    }),
    useListFseReportingEvents: (params: unknown) => {
      mocks.eventsParams(params);
      return {
        data: { rows: [{ id: 101, status: "ARRETRATO_NON_RENDICONTATO" }] },
      };
    },
    useListFseReportingQuality: () => ({ data: { rows: [] } }),
    useListFseExports: () => ({
      data: {
        rows: [
          {
            id: 201,
            formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
            stato: "PRONTA_PER_INSERIMENTO_MANUALE",
            dataDa: "2026-09-01",
            dataA: "2026-09-30",
          },
          {
            id: 202,
            formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
            stato: "INSERITA_MANUALMENTE",
            dataDa: "2026-08-01",
            dataA: "2026-08-31",
          },
        ],
      },
    }),
    useGetFseExport: (id: number) => ({
      data:
        id > 0
          ? {
              id,
              stato:
                id === 202
                  ? "INSERITA_MANUALMENTE"
                  : "PRONTA_PER_INSERIMENTO_MANUALE",
              righeBloccanti: 0,
              versione: 3,
            }
          : undefined,
    }),
    useListFseReconciliations: () => ({
      data: { rows: [{ id: 301, status: "APERTA", businessKey: "R2-301" }] },
    }),
    useGetFseReconciliation: (id: number) => ({
      data: id > 0 ? { id, stato: "APERTA", versione: 4 } : undefined,
    }),
    useListFseReconciliationLines: (id: number) => ({
      data: {
        rows:
          id > 0
            ? [{ id: 302, status: "SOLO_LOCALE", businessKey: "R2-LINE" }]
            : [],
      },
    }),
    useListFseMonitoring: () => ({
      data: {
        rows: [
          {
            id: 401,
            status: "COMPLETA",
            businessKey: "2026-10/PACCHI",
            versione: 2,
          },
        ],
      },
    }),
    useListAgeaImportazioni: () => ({
      data: [{ id: 501, magazzinoId: 9, stato: "CONFERMATA" }],
    }),
    useCreateFseExport: (options: unknown) =>
      mutation("createExport", options as never),
    useMarkFseExportManuallyEntered: (options: unknown) =>
      mutation("markExport", options as never),
    useCancelFseExport: (options: unknown) =>
      mutation("cancelExport", options as never),
    useCreateFseReconciliation: (options: unknown) =>
      mutation("createReconciliation", options as never, { id: 301 }),
    useResolveFseReconciliationLine: (options: unknown) =>
      mutation("resolveLine", options as never),
    useRecalculateFseReconciliation: (options: unknown) =>
      mutation("recalculate", options as never),
    useCloseFseReconciliation: (options: unknown) =>
      mutation("close", options as never),
    useCancelFseReconciliation: (options: unknown) =>
      mutation("cancelRecon", options as never),
    useCreateFseMonitoring: (options: unknown) =>
      mutation("createMonitoring", options as never),
    useUpdateFseMonitoring: (options: unknown) =>
      mutation("updateMonitoring", options as never),
  };
});

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TabsTrigger: ({ children }: { children: React.ReactNode }) => (
    <span>{children}</span>
  ),
  TabsContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

import { FseOperations } from "./fse-operations";

const filters = {
  da: "2026-09-01",
  a: "2026-10-31",
  areaOperativaId: null,
  centroAscoltoId: null,
  magazzinoId: 9,
  mensaId: null,
  zonaUdsId: null,
};

describe("FSE operations — interazioni R2", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    mocks.calls.clear();
    mocks.invalidate.mockClear();
    mocks.eventsParams.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(<FseOperations filters={filters} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (item) => item.textContent?.trim() === label,
    ) as HTMLButtonElement;

  const selectRecord = async (id: number) => {
    const found = [...container.querySelectorAll("button")].find(
      (item) =>
        item.textContent?.trim() === "fseOperations.select" &&
        item.parentElement?.parentElement?.textContent?.includes(`#${id}`),
    ) as HTMLButtonElement;
    expect(found).toBeTruthy();
    await act(async () => found.click());
  };

  const change = async (
    element: HTMLInputElement | HTMLSelectElement,
    value: string,
  ) => {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        element instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("gestisce export e snapshot con preview, arretrato e download", async () => {
    expect(container.textContent).toContain("ARRETRATO_NON_RENDICONTATO");
    expect(container.textContent).toContain("eventiTotali");
    expect(
      container.querySelectorAll('a[href*="representation="]'),
    ).toHaveLength(4);

    await change(
      container.querySelector(
        'select[aria-label="fseOperations.queueFilter"]',
      ) as HTMLSelectElement,
      "ARRETRATO_NON_RENDICONTATO",
    );
    expect(mocks.eventsParams).toHaveBeenLastCalledWith(
      expect.objectContaining({
        statoRendicontazione: "ARRETRATO_NON_RENDICONTATO",
      }),
    );

    await act(async () => button("fseOperations.generate").click());
    await act(async () => button("fseOperations.generate").click());
    expect(spy("createExport")).toHaveBeenCalledTimes(2);
    expect(spy("createExport")).toHaveBeenCalledWith({
      data: expect.objectContaining({ magazzinoId: 9, includeArretrati: true }),
    });

    await selectRecord(201);
    const motivation = container.querySelector(
      'input[placeholder="fseOperations.motivation"]',
    ) as HTMLInputElement;
    await change(motivation, "SIFEAD R2");
    await act(async () => button("fseOperations.markEntered").click());
    await act(async () => button("fseOperations.cancelExport").click());
    expect(spy("markExport")).toHaveBeenCalledWith({
      id: 201,
      data: expect.objectContaining({
        versione: 3,
        riferimentoEsterno: "SIFEAD R2",
      }),
    });
    expect(spy("cancelExport")).toHaveBeenCalledWith({
      id: 201,
      data: { versione: 3, motivazione: "SIFEAD R2" },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["exports"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["export", 201],
    });

    await selectRecord(202);
    expect(button("fseOperations.markEntered").disabled).toBe(true);
    expect(button("fseOperations.cancelExport").disabled).toBe(true);
  });

  it("distingue null/zero e invia la versione nel monitoraggio", async () => {
    await act(async () => button("fseOperations.createMonitoring").click());
    expect(spy("createMonitoring")).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ totaleSaltuari: null }),
    });
    const total = container.querySelector(
      'input[placeholder="fseOperations.monitoringTotalPlaceholder"]',
    ) as HTMLInputElement;
    await change(total, "0");
    await act(async () => button("fseOperations.createMonitoring").click());
    expect(spy("createMonitoring")).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ totaleSaltuari: 0 }),
    });
    await selectRecord(401);
    await act(async () => button("fseOperations.updateMonitoring").click());
    expect(spy("updateMonitoring")).toHaveBeenCalledWith({
      id: 401,
      data: { versione: 2, totaleSaltuari: 0 },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["monitoring"] });
  });

  it("esercita tutte le risoluzioni e le transizioni della riconciliazione", async () => {
    await act(async () => button("fseOperations.calculate").click());
    expect(spy("createReconciliation")).toHaveBeenCalledWith({
      data: expect.objectContaining({
        importazioneAgeaId: 501,
        magazzinoId: 9,
      }),
    });
    await selectRecord(301);

    const action = container.querySelector(
      'select[aria-label="fseOperations.action"]',
    ) as HTMLSelectElement;
    for (const name of [
      "ACCETTA_SCOSTAMENTO",
      "SEGNALA_ANOMALIA",
      "DISABBINA",
      "RIAPRI",
      "ABBINA",
    ]) {
      await selectRecord(302);
      await change(action, name);
      if (name === "ABBINA") {
        await change(
          container.querySelector(
            'input[placeholder="fseOperations.targetMovement"]',
          ) as HTMLInputElement,
          "71",
        );
        await change(
          container.querySelector(
            'input[placeholder="fseOperations.targetAgeaRow"]',
          ) as HTMLInputElement,
          "81",
        );
      }
      const motivation = container.querySelector(
        'input[aria-label="fseOperations.motivation"]',
      ) as HTMLInputElement;
      await change(motivation, `azione ${name}`);
      await act(async () => button("fseOperations.resolve").click());
    }
    expect(spy("resolveLine")).toHaveBeenCalledTimes(5);
    expect(spy("resolveLine")).toHaveBeenLastCalledWith({
      id: 301,
      rigaId: 302,
      data: expect.objectContaining({
        versione: 4,
        azione: "ABBINA",
        movimentoId: 71,
        importazioneAgeaRigaId: 81,
      }),
    });

    await act(async () => button("fseOperations.recalculate").click());
    await act(async () => button("fseOperations.closeExact").click());
    await change(
      container.querySelector(
        'input[aria-label="fseOperations.motivation"]',
      ) as HTMLInputElement,
      "chiusura con scostamenti",
    );
    await act(async () => button("fseOperations.closeWithDifferences").click());
    await act(async () => button("fseOperations.cancelReconciliation").click());
    expect(spy("recalculate")).toHaveBeenCalledWith({
      id: 301,
      data: { versione: 4 },
    });
    expect(spy("close")).toHaveBeenCalledTimes(2);
    expect(spy("cancelRecon")).toHaveBeenCalledWith({
      id: 301,
      data: { versione: 4 },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["reconciliation-lines", 301, { pageSize: 200 }],
    });
  });
});
