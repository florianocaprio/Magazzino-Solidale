import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ReportingDashboard } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  user: { id: 1 } as { id: number } | null,
  prepare: vi.fn(),
  pdf: vi.fn(),
  download: vi.fn(),
  excel: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  prepareReportExport: mocks.prepare,
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { resolvedLanguage: "it", language: "it", dir: () => "ltr" },
  }),
}));
vi.mock("@/lib/branding-ambiente", () => ({
  loadDocumentBrandingForPdf: async () => ({ branding: {}, logoDataUrl: null }),
}));
vi.mock("@/lib/export", () => ({
  buildReportingPdf: mocks.pdf,
  downloadReportingBlob: mocks.download,
  exportReportingWorkbook: mocks.excel,
}));
import { ReportExportActions } from "./report-export-actions";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const report = {
  reportingModelVersion: "REPORTING_2_0_V1",
  section: "pacchi",
  filters: {
    da: "2026-01-01",
    a: "2026-01-31",
    anno: 2026,
    areaOperativaId: 1,
    centroAscoltoId: null,
    magazzinoId: null,
    mensaId: null,
    zonaUdsId: null,
    operatoreId: null,
    tipoIntervento: null,
    tipoServizio: null,
  },
  kpi: [],
  series: [],
  tables: [],
  quality: [],
  definitions: [],
  generatedAt: "2026-01-31T12:00:00Z",
  timezone: "Europe/Rome",
} satisfies ReportingDashboard;
const prepared = {
  datasetId: "synthetic-dataset",
  report,
  options: {
    areeOperative: [],
    centres: [],
    warehouses: [],
    mense: [],
    zones: [],
  },
  detail: null,
};
let root: Root, container: HTMLDivElement;
const render = async (value: ReportingDashboard = report) => {
  await act(async () => root.render(<ReportExportActions report={value} />));
};
const click = async (label: string) => {
  const buttons = [...container.querySelectorAll("button")].filter(
    (b) => b.textContent === label,
  );
  expect(buttons).toHaveLength(1);
  await act(async () => buttons[0].click());
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.user = { id: 1 };
  mocks.prepare.mockResolvedValue(prepared);
  mocks.pdf.mockResolvedValue(new Blob(["synthetic PDF lifecycle fixture"]));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(["filter", "logout", "user"] as const)(
  "PDF-07/08 %s during preparation aborts and never exports the late dataset",
  async (change) => {
    const pending = deferred<typeof prepared>();
    mocks.prepare.mockReturnValueOnce(pending.promise);
    await click("common.exportPdf");
    const signal = mocks.prepare.mock.calls[0][1].signal as AbortSignal;
    if (change !== "filter")
      mocks.user = change === "logout" ? null : { id: 2 };
    await render(
      change === "filter"
        ? { ...report, filters: { ...report.filters, areaOperativaId: 2 } }
        : report,
    );
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(prepared));
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
    expect(mocks.excel).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  },
);

it.each(["filter", "logout", "user"] as const)(
  "PDF-07/08 %s during PDF rendering prevents the stale download",
  async (change) => {
    const pending = deferred<Blob>();
    mocks.pdf.mockReturnValueOnce(pending.promise);
    await click("common.exportPdf");
    expect(mocks.pdf).toHaveBeenCalledTimes(1);
    if (change !== "filter")
      mocks.user = change === "logout" ? null : { id: 2 };
    await render(
      change === "filter"
        ? { ...report, filters: { ...report.filters, areaOperativaId: 2 } }
        : report,
    );
    await act(async () => pending.resolve(new Blob(["old-user-content"])));
    expect(mocks.download).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')).toBeNull();
  },
);

it.each([401, 403, 413])(
  "PDF-08/13 prepare %i preserves the error and produces no partial document or retry",
  async (status) => {
    mocks.prepare.mockRejectedValueOnce(new Error(`HTTP ${status}`));
    await click("common.exportPdf");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      `HTTP ${status}`,
    );
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.download).not.toHaveBeenCalled();
  },
);

it("PDF-04 print shares the PDF blob and releases only a closed preview", async () => {
  vi.useFakeTimers();
  const preview = {
    document: document.implementation.createHTMLDocument(),
    closed: false,
    opener: {},
    close: vi.fn(),
  };
  vi.spyOn(window, "open").mockReturnValue(preview as unknown as Window);
  // Happy DOM does not implement a browser's blob-backed PDF viewer. Observe
  // the actual nodes handed to the preview without launching a fake network load.
  // The real popup/viewer remains covered by the browser reporting E2E.
  const replace = vi
    .spyOn(preview.document.body, "replaceChildren")
    .mockImplementation(() => {});
  const create = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:report-fixture");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  await click("reporting.export.print");
  const blob = await mocks.pdf.mock.results[0].value;
  expect(create).toHaveBeenCalledWith(blob);
  expect(replace).toHaveBeenCalledTimes(1);
  const [link, frame] = replace.mock.calls[0] as [
    HTMLAnchorElement,
    HTMLIFrameElement,
  ];
  expect(link.tagName).toBe("A");
  expect(frame.tagName).toBe("IFRAME");
  expect(link.getAttribute("href")).toBe("blob:report-fixture");
  expect(frame.getAttribute("src")).toBe("blob:report-fixture");
  expect(revoke).not.toHaveBeenCalled();
  preview.closed = true;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:report-fixture");
});

it("PDF-04 blocked popup performs no preparation and reports the problem", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  await click("reporting.export.print");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "reporting.export.popupBlocked",
  );
  expect(mocks.prepare).not.toHaveBeenCalled();
});
