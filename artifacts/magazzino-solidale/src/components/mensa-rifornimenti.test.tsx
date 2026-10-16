import React, { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  focused: { data: undefined as unknown, isError: false, isFetching: false },
  search: "",
  create: vi.fn(),
  receive: vi.fn(),
  invalidate: vi.fn(),
  dirty: vi.fn(),
  requests: {
    items: [] as Array<{
      id: number;
      codice: string;
      stato: string;
      bisogno: string;
      versione: number;
      documentoCorrente?: {
        corrente: boolean;
        tipoDocumento: string;
        statoDocumento: string;
      };
    }>,
    total: 0,
  },
  areaInteraction: 0,
  listParams: vi.fn(),
  queryError: false,
  suppliersError: false,
  suppliers: [{ id: 11, nome: "Deposito richiesto", areaOperativaId: 3 }],
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetRichiestaMagazzino: () => mocks.focused,
  getGetRichiestaMagazzinoQueryKey: (id: number) => [
    "/api/richieste-magazzino",
    id,
  ],
  useCreateRichiestaMagazzino: () => ({ mutateAsync: mocks.create }),
  useCancelRichiestaMagazzino: () => ({ mutateAsync: vi.fn() }),
  useListRichiesteMagazzino: (params: unknown) => {
    mocks.listParams(params);
    return {
      data: mocks.requests,
      isError: mocks.queryError,
      error: { data: { error: "Scope revocato" } },
    };
  },
  useListTrasferimentiMensa: () => ({ data: { items: [], total: 0 } }),
  useListMagazziniMensa: () => ({
    data: mocks.suppliers,
    isError: mocks.suppliersError,
    error: { data: { error: "Magazzini non accessibili" } },
  }),
  getListMagazziniMensaQueryKey: (p: unknown) => [
    "/api/mensa/logistica/magazzini",
    p,
  ],
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
vi.mock("wouter", () => ({
  useSearch: () => mocks.search,
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("./mensa-operational-context", () => ({
  useMensaContext: () => ({
    areaId: 3,
    mense: [{ id: 7, attiva: true }],
    setDirty: mocks.dirty,
    areaInteraction: mocks.areaInteraction,
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
  mocks.search = "";
  mocks.focused = { data: undefined, isError: false, isFetching: false };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.queryError = false;
  mocks.areaInteraction = 0;
  mocks.requests = { items: [], total: 0 };
  mocks.suppliersError = false;
  mocks.suppliers = [
    { id: 11, nome: "Deposito richiesto", areaOperativaId: 3 },
  ];
  mocks.create.mockReset();
  mocks.create.mockResolvedValue({
    id: 1,
    codice: "RM-TEST",
    stato: "inviata",
    versione: 1,
  });
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

async function supplier() {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>("#mensa-supplier")!;
    select.value = "11";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("RIC-01: bisogno e preferenza obbligatori, destinazione server, nessun carrello/lotto/origine effettiva", async () => {
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.querySelector("#mensa-needs")?.getAttribute("aria-invalid")).toBe(
    "true",
  );
  await needs("20 kg di riso e 10 litri di olio");
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(
    host.querySelector("#mensa-supplier")?.getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    host
      .querySelector("#mensa-supplier")
      ?.classList.contains("border-destructive"),
  ).toBe(true);
  await supplier();
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(1);
  expect(mocks.create.mock.calls[0][0].data).toMatchObject({
    mensaId: 7,
    magazzinoRichiestoId: 11,
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
  expect(host.querySelector("#mensa-needs")).toBeNull();
  expect(host.querySelector("h2")?.textContent).toBe("mensa.requestSent");
  expect(host.textContent).toContain("RM-TEST");
});
it("IDE-01: timeout conserva draft e intenzione; retry non cambia chiave", async () => {
  mocks.create
    .mockRejectedValueOnce(new TypeError("Risposta persa"))
    .mockResolvedValueOnce({ id: 1 });
  await needs("Bisogno da conservare");
  await supplier();
  await submit();
  expect(host.textContent).toContain("Risposta persa");
  expect(host.querySelector("h2")).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>("#mensa-needs")!.value).toBe(
    "Bisogno da conservare",
  );
  await submit();
  expect(mocks.create).toHaveBeenCalledTimes(2);
  expect(mocks.create.mock.calls[1][0]).toEqual(mocks.create.mock.calls[0][0]);
});

it("Conferma persistente: aggiornare non la chiude; clic Area ripristina il modulo vuoto", async () => {
  await needs("Bisogno");
  await supplier();
  await submit();
  await act(async () => root.render(<MensaRifornimenti />));
  expect(host.querySelector("h2")?.textContent).toBe("mensa.requestSent");
  mocks.areaInteraction++;
  await act(async () => root.render(<MensaRifornimenti />));
  expect(host.querySelector("h2")).toBeNull();
  expect(host.querySelector<HTMLTextAreaElement>("#mensa-needs")!.value).toBe(
    "",
  );
  expect(mocks.create).toHaveBeenCalledTimes(1);
});

it("Il riquadro conferma è chiudibile da tastiera; cambio menu non conserva la conferma", async () => {
  await needs("Bisogno");
  await supplier();
  await submit();
  const button = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "mensa.newRequest",
  )!;
  await act(async () => button.click());
  expect(host.querySelector("h2")).toBeNull();
  await needs("Nuovo bisogno");
  await supplier();
  await submit();
  await act(async () => root.render(<div>Altro menu</div>));
  await act(async () => root.render(<MensaRifornimenti />));
  expect(host.querySelector("h2")).toBeNull();
  expect(host.querySelector("form")).not.toBeNull();
});

it("Invio dalla seconda pagina torna alla prima; riepilogo mostra etichette e colori degli stati reali", async () => {
  const stati = ["inviata", "presa_in_carico", "chiusa", "annullata"];
  mocks.requests = {
    total: 21,
    items: stati.map((stato, i) => ({
      id: i + 1,
      codice: `RM-${i}`,
      stato,
      bisogno: "Richiesta salvata",
      versione: 1,
    })),
  };
  await act(async () => root.render(<MensaRifornimenti />));
  const next = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "common.next",
  )!;
  await act(async () => next.click());
  expect(mocks.listParams).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 2 }),
  );
  await needs("Bisogno");
  await supplier();
  await submit();
  expect(mocks.listParams).toHaveBeenLastCalledWith(
    expect.objectContaining({ page: 1 }),
  );
  for (const [i, color] of ["blue", "amber", "emerald", "slate"].entries()) {
    const article = host.querySelector(`article[aria-label="RM-${i}"]`)!;
    expect(article.textContent).toContain(`mensa.requestStatus.${stati[i]}`);
    expect(article.querySelector(`[class*="bg-${color}-"]`)).not.toBeNull();
  }
});

it("Errore nel riepilogo dopo salvataggio non nasconde l'invio riuscito né ripete il comando", async () => {
  mocks.invalidate.mockRejectedValueOnce(
    new Error("Riepilogo non disponibile"),
  );
  await needs("Bisogno");
  await supplier();
  await submit();
  expect(host.querySelector("h2")?.textContent).toBe("mensa.requestSent");
  expect(host.textContent).toContain("Riepilogo non disponibile");
  expect(mocks.create).toHaveBeenCalledTimes(1);
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
  await supplier();
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
it("Preferenza: errore con cache non consente invio e non mostra magazzini cached", async () => {
  await needs("Bisogno");
  await supplier();
  mocks.suppliersError = true;
  await act(async () => root.render(<MensaRifornimenti />));
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Magazzini non accessibili");
  expect(host.textContent).not.toContain("Deposito richiesto");
  expect(host.querySelector<HTMLSelectElement>("#mensa-supplier")!.value).toBe(
    "",
  );
});

it.each([
  ["presa_in_carico", true, "trasferimento", "completato", "chiusa"],
  ["presa_in_carico", true, "trasferimento", "in_transito", "presa_in_carico"],
  ["presa_in_carico", false, "trasferimento", "completato", "presa_in_carico"],
  ["presa_in_carico", true, "trasferimento", "stornato", "presa_in_carico"],
  ["presa_in_carico", true, "bolla", "completato", "presa_in_carico"],
  ["annullata", true, "trasferimento", "completato", "annullata"],
] as const)(
  "Badge %s/%s/%s/%s: usa la fornitura corrente reale, senza mutare la richiesta",
  async (stato, corrente, tipoDocumento, statoDocumento, expected) => {
    mocks.requests = {
      total: 1,
      items: [
        {
          id: 1,
          codice: "RM-CORRENTE",
          stato,
          bisogno: "Bisogno",
          versione: 1,
          documentoCorrente: { corrente, tipoDocumento, statoDocumento },
        },
      ],
    };
    await act(async () => root.render(<MensaRifornimenti />));
    expect(host.querySelector("article")?.textContent).toContain(
      `mensa.requestStatus.${expected}`,
    );
    expect(mocks.requests.items[0].stato).toBe(stato);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.receive).not.toHaveBeenCalled();
  },
);
it("Preferenza: elenco vuoto e deposito non più autorizzato non lasciano una selezione valida", async () => {
  await needs("Bisogno");
  await supplier();
  mocks.suppliers = [];
  await act(async () => root.render(<MensaRifornimenti />));
  await submit();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(host.textContent).toContain("mensa.noSupplyWarehouses");
  expect(host.querySelector<HTMLSelectElement>("#mensa-supplier")!.value).toBe(
    "",
  );
});

it("M67-12 opens the exact canonical request outside the list page and retains report filters", async () => {
  mocks.search =
    "richiestaId=93&returnTo=%2Freport%2Fmensa%3Fda%3D2026-01-01%26mensaId%3D7";
  mocks.focused.data = {
    id: 93,
    mensaId: 7,
    codice: "RM-EXACT",
    stato: "inviata",
    bisogno: "Richiesta selezionata",
    versione: 1,
  };
  await act(async () => root.render(<MensaRifornimenti />));
  expect(
    host.querySelector('article[aria-label="RM-EXACT"]')?.textContent,
  ).toContain("Richiesta selezionata");
  expect(host.querySelector("a")?.getAttribute("href")).toBe(
    "/report/mensa?da=2026-01-01&mensaId=7",
  );
  expect(host.querySelector("#mensa-needs")).toBeNull();
  expect(mocks.create).not.toHaveBeenCalled();
});
it.each(["denied", "revalidating", "different-mensa", "different-request"])(
  "M67-12 does not show protected cached data: %s",
  async (cause) => {
    mocks.search = "richiestaId=93";
    mocks.focused.data = {
      id: cause === "different-request" ? 94 : 93,
      mensaId: cause === "different-mensa" ? 8 : 7,
      codice: "RM-HIDDEN",
      stato: "inviata",
      bisogno: "Confidential",
      versione: 1,
    };
    mocks.focused.isError = cause === "denied";
    mocks.focused.isFetching = cause === "revalidating";
    await act(async () => root.render(<MensaRifornimenti />));
    expect(host.textContent).not.toContain("Confidential");
    expect(host.querySelector("article")).toBeNull();
  },
);
it("M67-12 rejects external return links and malformed request IDs", async () => {
  mocks.search = "richiestaId=invalid&returnTo=https%3A%2F%2Fexample.com";
  await act(async () => root.render(<MensaRifornimenti />));
  expect(host.querySelector("a")).toBeNull();
  expect(host.textContent).toContain("mensa.requestUnavailable");
});
