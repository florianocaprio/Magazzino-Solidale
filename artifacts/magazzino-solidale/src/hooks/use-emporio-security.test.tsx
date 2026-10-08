// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  emporioCommandMatches,
  emporioCommandRefreshes,
  emporioReadableData,
  observeEmporioCommands,
  useEmporioSecurity,
  withEmporioSecurity,
} from "./use-emporio-security";

const auth = vi.hoisted(() => ({
  user: {
    id: 1,
    ruoloId: 1,
    areaOperativaId: 1,
    centroAscoltoId: 1,
    permessi: [],
    aree: ["emporio"],
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: auth.user }) }));
let guard: () => boolean;
let resource: number | null = null;
function PrivateDraft() {
  const security = useEmporioSecurity(resource);
  guard = security.isCurrent;
  return <Draft />;
}
const Boundary = withEmporioSecurity(PrivateDraft);

let client: QueryClient,
  root: Root,
  host: HTMLDivElement,
  status: number,
  read: ReturnType<typeof useQuery>,
  fetcher: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
const fail = (code: number) =>
  Object.assign(new Error("Synthetic denial"), { status: code });
const key = (context: string) => ["/api/cassa-emporio/sessioni/7", context];
function Probe({
  context = "A",
  path = "/api/cassa-emporio/sessioni/7",
}: {
  context?: string;
  path?: string;
}) {
  read = useQuery({
    queryKey: [path, context],
    queryFn: fetcher,
    retry: false,
    staleTime: 0,
  });
  const data = emporioReadableData(read);
  return data ? <Draft /> : <p>not readable</p>;
}
function Draft() {
  const [value, setValue] = useState("draft locale");
  return (
    <input
      aria-label="draft"
      value={value}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
async function mount(context = "A", path = "/api/cassa-emporio/sessioni/7") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe context={context} path={path} />
      </QueryClientProvider>,
    ),
  );
}
async function settle(check: () => void) {
  await act(async () => {
    await vi.waitFor(check);
  });
}
async function command(name = "sospendiSessioneCassaEmporio", id = 7) {
  const action = vi.fn(async () => {
    throw fail(403);
  });
  await act(async () => {
    await client
      .getMutationCache()
      .build(client, { mutationKey: [name], mutationFn: action })
      .execute({ id })
      .catch(() => {});
  });
  expect(action).toHaveBeenCalledTimes(1);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  status = 200;
  resource = null;
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  fetcher = vi.fn(async () => {
    if (status !== 200) throw fail(status);
    return { id: 7, nome: "Persona sintetica" };
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
describe("M6.2-A24 — cache e comando separati", () => {
  it("GET precedente tardiva non sovrascrive il diniego canonico nello stesso contesto", async () => {
    client.setQueryData(key("A"), { id: 7, nome: "PII cached" });
    let resolve!: (value: unknown) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const off = observeEmporioCommands(client, "A");
    await mount();
    expect(host.querySelector("input")).not.toBeNull();
    status = 403;
    await command();
    await settle(() => expect(read.isError).toBe(true));
    await act(async () => resolve({ id: 7, nome: "Risposta precedente" }));
    expect(read.isError).toBe(true);
    expect(host.querySelector("input")).toBeNull();
    off();
  });
  it("cambio documento invalida callback già avviate, senza cambiare sessione", async () => {
    resource = 7;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Boundary />
        </QueryClientProvider>,
      ),
    );
    const previous = guard;
    resource = 8;
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Boundary />
        </QueryClientProvider>,
      ),
    );
    expect(previous()).toBe(false);
    expect(guard()).toBe(true);
  });
  it("diniego comando Accesso rivalida anche la lista quando non esiste una GET dettaglio", async () => {
    const off = observeEmporioCommands(client, "A");
    await mount("A", "/api/accessi-emporio");
    await settle(() => expect(read.isSuccess).toBe(true));
    status = 403;
    await command("updateAccessoEmporio", 7);
    await settle(() => expect(read.isError).toBe(true));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(host.querySelector("input")).toBeNull();
    off();
  });
  it("cambio identità elimina anche lo stato locale e ignora callback della vecchia pagina", async () => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Boundary />
        </QueryClientProvider>,
      ),
    );
    const previous = guard,
      node = host.querySelector("input")!;
    node.value = "PII sintetica del draft precedente";
    auth.user = { ...auth.user, id: auth.user.id + 1 };
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Boundary />
        </QueryClientProvider>,
      ),
    );
    expect(host.querySelector("input")).not.toBe(node);
    expect(host.querySelector("input")?.value).toBe("draft locale");
    expect(previous()).toBe(false);
    expect(guard()).toBe(true);
  });
  it("risposta GET tardiva del vecchio contesto non riappare dopo diniego del nuovo", async () => {
    let resolve!: (value: unknown) => void;
    const delayed = new Promise((r) => {
      resolve = r;
    });
    fetcher.mockImplementationOnce(() => delayed);
    await mount("A");
    status = 403;
    await mount("B");
    await settle(() => expect(read.isError).toBe(true));
    await act(async () => resolve({ id: 7, nome: "PII precedente" }));
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).not.toContain("PII precedente");
  });
  it("comando403 + GET200 conserva il draft senza retry dell'azione", async () => {
    const off = observeEmporioCommands(client, "A");
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    const node = host.querySelector("input");
    await command();
    await settle(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(host.querySelector("input")).toBe(node);
    expect(node?.value).toBe("draft locale");
    off();
  });
  it.each([401, 403, 404])(
    "GET%s nasconde i dati precedentemente cached",
    async (code) => {
      const off = observeEmporioCommands(client, "A");
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      status = code;
      await command();
      await settle(() => expect(read.isError).toBe(true));
      expect(read.data).toBeDefined();
      expect(host.querySelector("input")).toBeNull();
      off();
    },
  );
  it("errore altra Spesa/Sessione non contamina la Sessione corrente", async () => {
    const off = observeEmporioCommands(client, "A");
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    await command("stornaSpesaEmporio", 7);
    await command("sospendiSessioneCassaEmporio", 8);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(host.querySelector("input")).not.toBeNull();
    off();
  });
  it("cambio contesto non riusa cache con identità o territorio precedenti", async () => {
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    status = 403;
    await mount("B");
    await settle(() => expect(read.isError).toBe(true));
    expect(host.querySelector("input")).toBeNull();
    expect(client.getQueryData(key("A"))).toBeDefined();
  });
  it("errore di comando iniziato prima del mount non provoca letture nel nuovo contesto", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise((_, r) => {
      reject = r;
    });
    const execution = client
      .getMutationCache()
      .build(client, {
        mutationKey: ["sospendiSessioneCassaEmporio"],
        mutationFn: () => pending,
      })
      .execute({ id: 7 })
      .catch(() => {});
    await act(async () => {});
    const off = observeEmporioCommands(client, "B");
    await mount("B");
    await settle(() => expect(read.isSuccess).toBe(true));
    await act(async () => {
      reject(fail(403));
      await execution;
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    off();
  });
  it("identità tipizzata impedisce collisioni Accesso/Sessione/Spesa", () => {
    expect(
      emporioCommandRefreshes(
        ["/api/accessi-emporio", "A"],
        "updateAccessoEmporio",
        { id: 7 },
      ),
    ).toBe(true);
    expect(
      emporioCommandRefreshes(
        ["/api/accessi-emporio/8", "A"],
        "updateAccessoEmporio",
        { id: 7 },
      ),
    ).toBe(false);
    expect(
      emporioCommandRefreshes(
        ["/api/spese-emporio", "A"],
        "chiudiSessioneCassaEmporio",
        { id: 7 },
      ),
    ).toBe(false);
    expect(
      emporioCommandMatches(
        ["/api/spese-emporio/7", "A"],
        "chiudiSessioneCassaEmporio",
        { id: 7 },
      ),
    ).toBe(false);
    expect(
      emporioCommandMatches(key("A"), "chiudiSessioneCassaEmporio", { id: 7 }),
    ).toBe(true);
    expect(
      emporioCommandMatches(
        ["/api/accessi-emporio/7", "A"],
        "updateAccessoEmporio",
        { id: 7 },
      ),
    ).toBe(true);
  });
});
