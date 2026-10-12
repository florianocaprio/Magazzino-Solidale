import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  version: 3,
  denied: false,
  params: vi.fn(),
  download: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@workspace/api-client-react", () => ({
  getListFseAdministrativeSourcesQueryKey: () => ["sources"],
  useListFseAdministrativeSources: (
    params: { page: number },
    options: unknown,
  ) => {
    state.params(params, options);
    return {
      isError: state.denied,
      error: new Error("Forbidden"),
      data: {
        total: 51,
        rows: Array.from({ length: 51 }, (_, i) => ({
          id: i + 1,
          versione: state.version,
          modalita: "NUOVI_CARICHI",
          stato: "IN_ANALISI",
          files: [
            {
              role: "REGISTRO",
              referenceDate: "2026-09-17",
              sha256: "a".repeat(64),
            },
          ],
          summary: {
            observations: 10,
            registered: 2,
            excluded: 1,
            anomalous: 1,
          },
        })).slice((params.page - 1) * 20, params.page * 20),
      },
    };
  },
  getGetFseReconciliationSourceQueryKey: (id: number) => ["source", id],
  getListFseAdministrativeObservationsQueryKey: (id: number) => [
    "observations",
    id,
  ],
  useGetFseReconciliationSource: () => ({
    data: { sourceType: "FSE_M3B" },
    isError: state.denied,
  }),
  useListFseAdministrativeObservations: (
    _id: number,
    params: { page: number },
  ) => ({
    isError: state.denied,
    data: {
      total: 201,
      rows: Array.from({ length: 201 }, (_, i) => ({ id: i + 1 })).slice(
        (params.page - 1) * 20,
        params.page * 20,
      ),
    },
  }),
  downloadFseOriginal: state.download,
}));
import {
  FseAdministrativeSourceForm,
  FseAdministrativeProvenance,
  FseOriginalDownload,
} from "./fse-administrative-source";
let container: HTMLDivElement, root: Root;
const calculate = vi.fn();
const renderForm = async (key = "scope-1") =>
  act(async () =>
    root.render(
      <FseAdministrativeSourceForm
        key={key}
        warehouseId={1}
        referenceDate="2026-09-17"
        scopeKey={key}
        pending={false}
        onCalculate={calculate}
      />,
    ),
  );
const button = (key: string) =>
  [...container.querySelectorAll("button")].find(
    (b) => b.textContent === `fseOperations.${key}`,
  )!;
async function change(selector: string, value: string) {
  const el = container.querySelector<HTMLInputElement | HTMLSelectElement>(
    selector,
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      el.tagName === "SELECT"
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      "value",
    )!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
beforeEach(() => {
  state.version = 3;
  state.denied = false;
  state.params.mockClear();
  state.download.mockReset();
  calculate.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it("D02/D20: explicit version and summary, one stable command key per intention", async () => {
  await renderForm();
  await act(async () => button("calculate").click());
  expect(calculate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(container.querySelector("#m3b-source"));
  expect(
    container.querySelector("#m3b-source")?.getAttribute("aria-invalid"),
  ).toBe("true");
  await change("#m3b-source", "1");
  expect(container.textContent).toContain("fseOperations.sourceregistered");
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await act(async () => button("calculate").click());
  await act(async () => button("calculate").click());
  expect(calculate).toHaveBeenCalledTimes(2);
  expect(calculate.mock.calls[0][0]).toEqual(calculate.mock.calls[1][0]);
  expect(calculate.mock.calls[0][0]).toMatchObject({
    sourceType: "FSE_M3B",
    sessionId: 1,
    sessionVersion: 3,
    magazzinoId: 1,
    baselineRunId: null,
  });
});
it("D11/D32: refetch cannot replace a confirmed version or baseline; context resets", async () => {
  await renderForm();
  await change("#m3b-source", "1");
  await change("#m3b-baseline", "77");
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  state.version = 4;
  await renderForm();
  await act(async () => button("calculate").click());
  expect(calculate).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(container.querySelector("#m3b-source"));
  expect(
    container.querySelector<HTMLInputElement>("#m3b-baseline")!.value,
  ).toBe("77");
  await renderForm("scope-2");
  expect(
    container.querySelector<HTMLInputElement>("#m3b-baseline")!.value,
  ).toBe("");
  expect(container.querySelector<HTMLSelectElement>("#m3b-source")!.value).toBe(
    "",
  );
});
it("D32: page 3 actually reaches source 51 and a denial does not expose cached options", async () => {
  await renderForm();
  for (let n = 0; n < 2; n++) await act(async () => button("nextPage").click());
  expect(container.querySelector('option[value="51"]')).not.toBeNull();
  expect(state.params).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 3 }),
    expect.anything(),
  );
  state.denied = true;
  await renderForm();
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("D32: frozen observations reach row 201, not merely a total counter", async () => {
  await act(async () =>
    root.render(<FseAdministrativeProvenance id={1} scopeKey="scope" />),
  );
  for (let p = 2; p <= 11; p++)
    await act(async () => button("nextPage").click());
  expect(container.textContent).toContain('"id": 201');
  expect(button("nextPage").disabled).toBe(true);
});
it("D27: original requires a trimmed reason in the POST body, error preserves the draft", async () => {
  await act(async () => root.render(<FseOriginalDownload id={4} />));
  await act(async () => button("originalDownload").click());
  expect(state.download).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(
    container.querySelector("#fse-original-reason"),
  );
  await change("#fse-original-reason", "   ");
  await act(async () => button("originalDownload").click());
  expect(state.download).not.toHaveBeenCalled();
  expect(
    container
      .querySelector("#fse-original-reason")
      ?.getAttribute("aria-invalid"),
  ).toBe("true");
  state.download.mockRejectedValue(new Error("Forbidden"));
  await change("#fse-original-reason", " Motivo sintetico ");
  await act(async () => button("originalDownload").click());
  expect(state.download).toHaveBeenCalledOnce();
  expect(state.download).toHaveBeenCalledWith(
    4,
    { motivo: "Motivo sintetico" },
    expect.objectContaining({
      cache: "no-store",
      signal: expect.any(AbortSignal),
    }),
  );
  expect(
    container.querySelector<HTMLInputElement>("#fse-original-reason")!.value,
  ).toBe(" Motivo sintetico ");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("D32: changing document aborts and ignores a late original download", async () => {
  let complete!: (blob: Blob) => void;
  state.download.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        complete = resolve;
      }),
  );
  const create = vi.spyOn(URL, "createObjectURL");
  await act(async () => root.render(<FseOriginalDownload id={4} />));
  await change("#fse-original-reason", "Motivo sintetico");
  await act(async () => button("originalDownload").click());
  const signal = state.download.mock.calls[0][2].signal;
  await act(async () => root.render(<FseOriginalDownload id={5} />));
  expect(signal.aborted).toBe(true);
  await act(async () => complete(new Blob(["private"])));
  expect(create).not.toHaveBeenCalled();
  expect(
    container.querySelector<HTMLInputElement>("#fse-original-reason")!.value,
  ).toBe("");
});
