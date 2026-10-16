import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SupplyReceipt } from "./supply-receipt";

const state = vi.hoisted(() => ({
  detail: {} as { data?: any; isError?: boolean; error?: unknown },
  mutation: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetApprovvigionamento: () => state.detail,
  useUpdateApprovvigionamento: () => state.mutation,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (s: string) => s }),
}));
vi.mock("@/components/ui/sheet", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Sheet: Box,
    SheetContent: Box,
    SheetHeader: Box,
    SheetTitle: Box,
    SheetDescription: Box,
  };
});
let host: HTMLDivElement, root: Root;
const success = vi.fn(),
  close = vi.fn();
const render = () =>
  act(async () =>
    root.render(<SupplyReceipt id={11} onClose={close} onSuccess={success} />),
  );
const inputs = () => [...host.querySelectorAll("input")];
const submit = () =>
  act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
async function fill(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  state.mutation.isPending = false;
  state.mutation.mutateAsync.mockResolvedValue({});
  state.detail = {
    data: {
      versione: 3,
      righe: [
        {
          id: 7,
          prodottoNome: "Synthetic kg",
          unitaMisura: "kg",
          quantitaResiduaEsatta: "1.000001",
          lottoFisicoObbligatorio: true,
          gestioneScadenza: true,
        },
      ],
    },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

it("keeps six decimal strings and requires physical lot/expiry without fabricated defaults", async () => {
  expect(inputs().map((i) => i.value)).toEqual(["1.000001", "", ""]);
  expect(inputs().every((i) => i.required)).toBe(true);
  expect(host.querySelector("form")!.checkValidity()).toBe(false);
  await fill(inputs()[1], " REAL-LOT ");
  await fill(inputs()[2], "2027-06-01");
  await submit();
  expect(state.mutation.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    id: 11,
    data: {
      versione: 3,
      stato: "completato",
      partite: [
        {
          rigaId: 7,
          quantita: "1.000001",
          codiceLotto: "REAL-LOT",
          dataScadenza: "2027-06-01",
        },
      ],
    },
  });
  expect(success).toHaveBeenCalledTimes(1);
});
it("supports multiple physical parties for the same order line", async () => {
  await act(async () =>
    host.querySelector<HTMLButtonElement>('button[type="button"]')!.click(),
  );
  expect(inputs()).toHaveLength(6);
  await fill(inputs()[0], "0.500001");
  await fill(inputs()[1], "A");
  await fill(inputs()[2], "2027-01-01");
  await fill(inputs()[3], "0.500000");
  await fill(inputs()[4], "B");
  await fill(inputs()[5], "2027-02-01");
  await submit();
  const payload = state.mutation.mutateAsync.mock.calls[0][0];
  expect(payload.data.partite).toEqual([
    {
      rigaId: 7,
      quantita: "0.500001",
      codiceLotto: "A",
      dataScadenza: "2027-01-01",
    },
    {
      rigaId: 7,
      quantita: "0.500000",
      codiceLotto: "B",
      dataScadenza: "2027-02-01",
    },
  ]);
});
it("keeps drafts and the real backend error after failure, without automatic retry", async () => {
  state.mutation.mutateAsync.mockRejectedValue(
    new Error("Somma partite non corretta"),
  );
  await fill(inputs()[1], "DRAFT");
  await submit();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(
    "Somma partite non corretta",
  );
  expect(inputs()[1].value).toBe("DRAFT");
  expect(success).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(state.mutation.mutateAsync).toHaveBeenCalledTimes(1);
});
it("retains the captured version on background refresh, leaving conflict resolution to the server", async () => {
  state.detail.data = { ...state.detail.data, versione: 4 };
  await render();
  await submit();
  expect(state.mutation.mutateAsync.mock.calls[0][0].data.versione).toBe(3);
});
it.each([403, 404])(
  "hides cached receipt after canonical read denies access (%s)",
  async (status) => {
    state.detail = { ...state.detail, isError: true, error: { status } };
    await render();
    expect(host.querySelector("form")).toBeNull();
    expect(host.textContent).not.toContain("Synthetic kg");
    expect(state.mutation.mutateAsync).not.toHaveBeenCalled();
  },
);
it("disables receipt editing and submit while a command is in flight", async () => {
  state.mutation.isPending = true;
  await render();
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  expect(
    host.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled,
  ).toBe(true);
});
