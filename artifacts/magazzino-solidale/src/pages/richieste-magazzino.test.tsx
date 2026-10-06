import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import RichiesteMagazzino from "./richieste-magazzino";

const mock = vi.hoisted(() => ({
  row: {} as any,
  take: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ hasArea: () => true, hasPermission: () => true }),
}));
vi.mock("@/lib/use-moduli", () => ({
  useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }),
}));
vi.mock("@/pages/trasferimenti", () => ({
  RigheEditor: () => null,
  newRiga: () => ({}),
}));
vi.mock("@workspace/api-client-react", () => ({
  createRichiestaMagazzino: vi.fn(),
  updateRichiestaMagazzino: vi.fn(),
  createRichiestaMagazzinoDocumento: vi.fn(),
  takeRichiestaMagazzino: (...args: unknown[]) => mock.take(...args),
  cancelRichiestaMagazzino: (...args: unknown[]) => mock.cancel(...args),
  getListRichiesteMagazzinoQueryKey: () => ["requests"],
  getGetRichiestaMagazzinoQueryKey: (id: number) => ["request", id],
  getGetRichiestaMagazzinoStoricoQueryKey: (id: number) => ["history", id],
  getListBeneficiariQueryKey: () => ["people"],
  getGetInterventoQueryKey: () => ["intervention"],
  getListMagazziniQueryKey: () => ["warehouses"],
  getListProdottiQueryKey: () => ["products"],
  useGetIntervento: () => ({ data: undefined }),
  useListBeneficiari: () => ({ data: { items: [] } }),
  useListMagazzini: () => ({
    data: [{ id: 4, nome: "Magazzino", areaOperativaId: 1, stato: "attivo" }],
  }),
  useListProdotti: () => ({ data: [] }),
  useListRichiesteMagazzino: (params: any) =>
    useQuery({
      queryKey: ["requests", params],
      queryFn: async () => ({
        items:
          mock.row.stato === "annullata" && params.stato === "aperte"
            ? []
            : [{ ...mock.row }],
        total: 1,
      }),
    }),
  useGetRichiestaMagazzino: (id: number) =>
    useQuery({
      queryKey: ["request", id],
      enabled: !!id,
      queryFn: async () => ({ ...mock.row }),
    }),
  useGetRichiestaMagazzinoStorico: (id: number) =>
    useQuery({
      queryKey: ["history", id],
      enabled: !!id,
      queryFn: async () => [],
    }),
}));

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/richieste-magazzino?filter=keep");
  mock.row = {
    id: 1,
    codice: "RM-TEST",
    destinatarioNomeSnapshot: "Persona",
    tipoDestinatario: "beneficiario",
    areaOperativaId: 1,
    areaNomeSnapshot: "Area",
    centroNomeSnapshot: "Centro",
    bisogno: "Bisogno test",
    priorita: "normale",
    modalitaPreferita: "ritiro",
    stato: "inviata",
    versione: 1,
    documentoCorrente: null,
  };
  mock.take.mockImplementation(async () => {
    mock.row = { ...mock.row, stato: "presa_in_carico", versione: 2 };
    return mock.row;
  });
  mock.cancel.mockImplementation(async () => {
    mock.row = { ...mock.row, stato: "annullata", versione: 2 };
    return mock.row;
  });
});
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  client?.clear();
  host?.remove();
});
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
async function mount() {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <RichiesteMagazzino />
      </QueryClientProvider>,
    ),
  );
  await settle();
}
function button(text: string, parent: ParentNode = document) {
  const found = [...parent.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.includes(text),
  );
  expect(found, text).toBeTruthy();
  return found!;
}
async function click(text: string, parent: ParentNode = document) {
  await act(async () => button(text, parent).click());
  await settle();
}
function sheet() {
  return document.querySelector<HTMLElement>(
    '[data-testid="richiesta-sheet"]',
  )!;
}
async function open() {
  await click("RM-TEST");
  expect(sheet()).toBeTruthy();
  return sheet();
}
async function input(id: string, value: string) {
  const field = document.getElementById(id) as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
describe("M5C2-A-R1 Sheet richieste", () => {
  it("apre dalla riga e chiude preservando gli altri parametri URL", async () => {
    await mount();
    await open();
    expect(sheet().getAttribute("data-state")).toBe("open");
    expect(sheet().className).toContain("w-full");
    expect(window.location.search).toContain("richiestaId=1");
    expect(sheet().textContent).toContain("Bisogno test");
    expect(host.textContent).not.toContain("Bisogno test");
    await click("Close", sheet());
    expect(sheet()).toBeNull();
    expect(window.location.search).toBe("?filter=keep");
  });
  it("apre deep-link e resta aperto dopo presa in carico con preparazione nello Sheet", async () => {
    window.history.replaceState({}, "", "/richieste-magazzino?richiestaId=1");
    await mount();
    await click("richiesteMagazzino.take", sheet());
    expect(
      sheet().querySelector('[data-testid="m5b-prepare-document"]'),
    ).toBeTruthy();
    expect(sheet().getAttribute("data-state")).toBe("open");
    expect(mock.take).toHaveBeenCalledOnce();
  });
  it("richiede motivo, invia nota separata e conserva il dettaglio terminale", async () => {
    await mount();
    await open();
    await click("richiesteMagazzino.cancelRequest", sheet());
    expect(button("richiesteMagazzino.confirmCancel").disabled).toBe(true);
    await input("rm-cancel-reason", "Motivo");
    await input("rm-cancel-note", "Nota");
    await click("richiesteMagazzino.confirmCancel");
    expect(mock.cancel).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ motivo: "Motivo", nota: "Nota", versione: 1 }),
    );
    expect(sheet().textContent).toContain("richiesteMagazzino.annullata");
  });
  it("dopo uscita espone il rientro senza cancellazione diretta", async () => {
    mock.row.documentoCorrente = {
      codice: "B1",
      tipoDocumento: "bolla",
      statoDocumento: "in_trasporto",
      avanzamento: "in_viaggio",
      percorsoDocumento: "/bolle?id=1",
    };
    await mount();
    await open();
    expect(sheet().textContent).toContain("richiesteMagazzino.cancelAfterExit");
    expect(
      [...sheet().querySelectorAll("button")].some((b) =>
        b.textContent?.includes("richiesteMagazzino.cancelRequest"),
      ),
    ).toBe(false);
    expect(sheet().querySelector('a[href="/bolle?id=1"]')).toBeTruthy();
  });
});
