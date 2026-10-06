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
  list: vi.fn(),
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
vi.mock("@/components/documento-operativo", () => ({
  DocumentoOperativoDettaglioComune: ({ selection, onBackToRequest }: any) => (
    <div data-testid="contextual-document">
      {selection.tipo}:{selection.id}
      <button onClick={onBackToRequest}>back-to-request</button>
    </div>
  ),
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
  useListRichiesteMagazzino: (params: any) => {
    mock.list(params);
    return useQuery({
      queryKey: ["requests", params],
      queryFn: async () => {
        const visible =
          params.stato === "aperte"
            ? ["inviata", "presa_in_carico"].includes(mock.row.stato)
            : mock.row.stato === params.stato;
        return {
          items: visible ? [{ ...mock.row }] : [],
          total: visible ? (params.page === 3 ? 61 : 1) : 0,
        };
      },
    });
  },
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
  it("separa le tre viste, preserva il deep-link e azzera la pagina al cambio vista", async () => {
    window.history.replaceState(
      {},
      "",
      "/richieste-magazzino?filter=keep&page=3&vista=chiusa",
    );
    mock.row.stato = "chiusa";
    await mount();
    expect(host.textContent).toContain("RM-TEST");
    expect(host.textContent).toContain("3 · 61");
    expect(mock.list).toHaveBeenCalledWith(
      expect.objectContaining({ stato: "chiusa", page: 3 }),
    );
    await click("richiesteMagazzino.cancelled");
    expect(window.location.search).toContain("vista=annullata");
    expect(window.location.search).toContain("filter=keep");
    expect(window.location.search).not.toContain("page=");
    expect(host.textContent).not.toContain("RM-TEST");
    expect(host.textContent).toContain("1 · 0");
    expect(mock.list).toHaveBeenCalledWith(
      expect.objectContaining({ stato: "annullata", page: 1 }),
    );
    mock.row.stato = "annullata";
    await client.invalidateQueries({ queryKey: ["requests"] });
    await settle();
    expect(host.textContent).toContain("RM-TEST");
    expect(host.textContent).toContain("1 · 1");
    await click("richiesteMagazzino.open");
    expect(host.textContent).not.toContain("RM-TEST");
    expect(mock.list).toHaveBeenCalledWith(
      expect.objectContaining({ stato: "aperte", page: 1 }),
    );
  });
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
      percorsoDocumento: "/bolle?documento=bolla%3A1",
    };
    await mount();
    await open();
    expect(sheet().textContent).toContain("richiesteMagazzino.cancelAfterExit");
    expect(
      [...sheet().querySelectorAll("button")].some((b) =>
        b.textContent?.includes("richiesteMagazzino.cancelRequest"),
      ),
    ).toBe(false);
    await click("richiesteMagazzino.openDocument", sheet());
    expect(window.location.pathname).toBe("/richieste-magazzino");
    expect(new URLSearchParams(window.location.search).get("documento")).toBe(
      "bolla:1",
    );
    expect(
      sheet().querySelector('[data-testid="contextual-document"]')?.textContent,
    ).toContain("bolla:1");
    await click("back-to-request", sheet());
    expect(sheet().textContent).toContain("richiesteMagazzino.cancelAfterExit");
  });
});
