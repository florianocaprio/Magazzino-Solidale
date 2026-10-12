import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  receive: vi.fn(),
  invalidate: vi.fn(),
  dirty: vi.fn(),
  requests: { items: [], total: 0 },
  queryError: false,
}));
vi.mock("@workspace/api-client-react", () => ({
  useCreateRichiestaMagazzino: () => ({ mutateAsync: mocks.create }),
  useCancelRichiestaMagazzino: () => ({ mutateAsync: vi.fn() }),
  useListRichiesteMagazzino: () => ({
    data: mocks.requests,
    isError: mocks.queryError,
    error: { data: { error: "Scope revocato" } },
  }),
  useListTrasferimentiMensa: () => ({ data: { items: [], total: 0 } }),
  useConfermaTrasferimento: () => ({ mutateAsync: mocks.receive }),
  useSegnalaMancatoArrivoTrasferimento: () => ({ mutateAsync: vi.fn() }),
  useGetTrasferimento: () => ({ data: undefined }),
  getDocumentoTrasferimento: vi.fn(),
  getListRichiesteMagazzinoQueryKey: (p: unknown) => [
    "/api/richieste-magazzino",
    p,
  ],
  getListTrasferimentiMensaQueryKey: (p: unknown) => [
    "/api/mensa/trasferimenti",
    p,
  ],
  getGetTrasferimentoQueryKey: (id: number) => ["/api/trasferimenti", id],
}));
vi.mock("./mensa-operational-context", () => ({
  useMensaContext: () => ({
    areaId: 3,
    mense: [{ id: 7, attiva: true }],
    setDirty: mocks.dirty,
  }),
  MensaSelect: ({ onChange }: { onChange: (id: number) => void }) => {
    useEffect(() => onChange(7), [onChange]);
    return <span>Mensa sintetica</span>;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/lib/bolla-query-invalidation", () => ({
  invalidateRequestWorkflowViews: () => mocks.invalidate(),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasPermission: () => true }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/trasferimento-pdf", () => ({
  generateTrasferimentoPdf: vi.fn(),
}));
import { MensaRifornimenti } from "./mensa-rifornimenti";

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.queryError = false;
  mocks.create.mockReset();
  mocks.create.mockResolvedValue({ id: 1 });
  mocks.invalidate.mockReset();
  mocks.invalidate.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<MensaRifornimenti />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function needs(text: string) {
  await act(async () => {
    const input = host.querySelector<HTMLTextAreaElement>("#mensa-needs")!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

it("RIC-01: solo bisogno, destinazione server, nessun carrello/lotto/origine; obbligatorio rosso", async () => {
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.querySelector("#mensa-needs")?.getAttribute("aria-invalid")).toBe(
    "true",
  );
  await needs("20 kg di riso e 10 litri di olio");
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({
    mensaId: 7,
    areaOperativaId: 3,
    bisogno: "20 kg di riso e 10 litri di olio",
    dataDesiderata: null,
    priorita: "normale",
  });
  for (const field of [
    "righe",
    "magazzinoOrigineId",
    "magazzinoDestinatarioId",
    "lottoId",
  ])
    expect(mocks.create.mock.calls[0][0].data).not.toHaveProperty(field);
  expect(mocks.receive).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLTextAreaElement>("#mensa-needs")!.value).toBe(
    "",
  );
});
it("IDE-01: timeout conserva draft e intenzione; retry non cambia chiave", async () => {
  mocks.create
    .mockRejectedValueOnce(new TypeError("Risposta persa"))
    .mockResolvedValueOnce({ id: 1 });
  await needs("Bisogno da conservare");
  await submit();
  expect(host.textContent).toContain("Risposta persa");
  expect(host.querySelector<HTMLTextAreaElement>("#mensa-needs")!.value).toBe(
    "Bisogno da conservare",
  );
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
});
it("IDE-01: doppio invio pendente esegue un solo comando", async () => {
  let resolve!: (data: unknown) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await needs("Bisogno");
  await submit();
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ id: 1 }));
});
it("ERR-01: errore query distinto da elenco vuoto", async () => {
  mocks.queryError = true;
  await act(async () => root.render(<MensaRifornimenti />));
  expect(host.textContent).toContain("Scope revocato");
  expect(mocks.create).not.toHaveBeenCalled();
});
