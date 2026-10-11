import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  recover: vi.fn(),
  close: vi.fn(),
}));
vi.mock("@workspace/api-client-react", () => ({
  createCreditoSolidaleRettifica: mocks.post,
  getCreditoSolidaleRettificaEsito: mocks.recover,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
import { CreditoRettificaDialog } from "./credito-rettifica-dialog";
let root: Root, host: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  sessionStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.post.mockReset();
  mocks.recover.mockReset();
  mocks.close.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(() =>
    root.render(
      <QueryClientProvider client={client}>
        <CreditoRettificaDialog
          beneficiarioId={1}
          saldo={210}
          onClose={mocks.close}
        />
      </QueryClientProvider>,
    ),
  );
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  client.clear();
});
const submit = () =>
  act(async () => {
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
const control = (name: string) =>
  document.querySelector(`[name="${name}"]`) as HTMLInputElement;
async function fill(name: string, value: string) {
  const field = control(name),
    proto =
      name === "motivo" || name === "note"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
  await act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("R01/V01/V02 nessuna operazione preselezionata; errori insieme, note facoltative", async () => {
  expect(
    document
      .querySelector('[role="combobox"]')
      ?.getAttribute("data-placeholder"),
  ).not.toBeNull();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  await submit();
  expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(3);
  expect(control("note").getAttribute("aria-invalid")).toBe("false");
  expect(mocks.post).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  for (const element of document.querySelectorAll('[aria-invalid="true"]'))
    expect(
      document.getElementById(
        element.getAttribute("aria-describedby")!.split(" ").at(-1)!,
      )?.textContent,
    ).toBeTruthy();
});
it("V03 errore sparisce quando corretto, draft conservato", async () => {
  await submit();
  await fill("motivo", "Motivo persistente");
  expect(control("motivo").getAttribute("aria-invalid")).toBe("false");
  await fill("quantita", "12");
  expect(control("quantita").getAttribute("aria-invalid")).toBe("false");
  expect(control("motivo").value).toBe("Motivo persistente");
  expect(mocks.close).not.toHaveBeenCalled();
});
it.each(["-12", "0", "1.5", "100000000", " "])(
  "R07 quantità %s non convertita né arrotondata",
  async (value) => {
    await fill("quantita", value);
    await submit();
    expect(control("quantita").getAttribute("aria-invalid")).toBe("true");
    expect(control("quantita").value).toBe(value);
    expect(mocks.post).not.toHaveBeenCalled();
  },
);
