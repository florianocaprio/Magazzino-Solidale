// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import {
  documentCommandMatches,
  useDocumentoAccess,
} from "./use-documento-access";

type Selection = { tipo: "bolla" | "trasferimento"; id: number };
let client: QueryClient;
let root: Root;
let host: HTMLDivElement;
let read: ReturnType<typeof useDocumentoAccess>;
let status: number;
let fetcher: ReturnType<typeof vi.fn>;
const doc = { tipo: "bolla", id: 7 } as const;
const fail = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });
function Probe({
  selection,
  auth = "session-A",
  enabled = true,
}: {
  selection: Selection;
  auth?: string;
  enabled?: boolean;
}) {
  read = useDocumentoAccess(selection, auth, enabled);
  return read.denied ? (
    <p>denied</p>
  ) : (
    <>
      {read.technicalError && <p>technical error</p>}
      {read.data && <Draft key={read.context} blocked={read.blocked} />}
    </>
  );
}
function Draft({ blocked }: { blocked: boolean }) {
  const [value, setValue] = useState("unsaved draft");
  return (
    <input
      aria-label="draft"
      value={value}
      disabled={blocked}
      onChange={(e) => setValue(e.target.value)}
    />
  );
}
async function mount(
  selection: Selection = doc,
  auth = "session-A",
  enabled = true,
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe selection={selection} auth={auth} enabled={enabled} />
      </QueryClientProvider>,
    ),
  );
}
async function settle(predicate: () => void) {
  await act(async () => {
    await vi.waitFor(predicate);
  });
}
async function command(key = "updateBolla", id = 7, code = 403) {
  await act(async () => {
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: [key],
        mutationFn: async () => {
          throw fail(code);
        },
      })
      .execute({ id })
      .catch(() => {});
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  status = 200;
  fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          status === 200
            ? {
                tipoAggregato: url.includes("trasferimento")
                  ? "trasferimento"
                  : "bolla",
                dettaglio: { id: Number(url.split("/").pop()) },
              }
            : { error: `read ${status}` },
        ),
        { status, headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});

describe("F7 canonical document read", () => {
  it.each([403, 404])(
    "command %s + GET200 keeps the exact draft node and never retries command",
    async (code) => {
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      const node = host.querySelector("input");
      const mutation = vi.fn(async () => {
        throw fail(code);
      });
      await act(async () => {
        await client
          .getMutationCache()
          .build(client, {
            mutationKey: [code === 404 ? "deleteBollaRiga" : "updateBolla"],
            mutationFn: mutation,
          })
          .execute({ id: 7, rigaId: 99 })
          .catch(() => {});
      });
      await settle(() => expect(fetcher).toHaveBeenCalledTimes(2));
      await settle(() => expect(read.blocked).toBe(false));
      expect(host.querySelector("input")).toBe(node);
      expect(node?.value).toBe("unsaved draft");
      expect(mutation).toHaveBeenCalledTimes(1);
    },
  );
  it.each([401, 403, 404])(
    "canonical GET %s hides previously cached data",
    async (code) => {
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      const invalidate = vi.spyOn(client, "invalidateQueries");
      status = code;
      await command();
      await settle(() => expect(read.denied).toBe(true));
      expect(read.data).toBeDefined();
      expect(host.querySelector("input")).toBeNull();
      if (code === 401)
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: getGetCurrentUserQueryKey(),
        });
      await mount();
      expect(host.querySelector("input")).toBeNull();
    },
  );
  it.each([400, 422, 409])(
    "command %s does not reinterpret authorization or repeat anything",
    async (code) => {
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      await command("updateBolla", 7, code);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(read.denied).toBe(false);
    },
  );
  it.each([500, 503, 0])(
    "read failure %s is technical, draft preserved and actions blocked until read retry",
    async (code) => {
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      const node = host.querySelector("input");
      status = code;
      if (!code)
        fetcher.mockRejectedValueOnce(new TypeError("Network unavailable"));
      await command();
      await settle(() => expect(read.technicalError).toBe(true));
      expect(read.denied).toBe(false);
      expect(host.querySelector("input")).toBe(node);
      expect(node?.disabled).toBe(true);
      status = 200;
      await act(async () => {
        await read.refetch();
      });
      await settle(() => expect(read.blocked).toBe(false));
      expect(host.querySelector("input")).toBe(node);
    },
  );
  it.each([
    ["updateBolla", 8],
    ["updateTrasferimento", 7],
    ["updateBeneficiario", 7],
  ])("unrelated %s/%s cannot contaminate current Bolla", async (key, id) => {
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    await command(String(key), Number(id));
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(read.denied).toBe(false);
  });
  it("transfer same numeric ID is independent from Bolla and revalidates its own command", async () => {
    await mount({ tipo: "trasferimento", id: 7 });
    await settle(() => expect(read.isSuccess).toBe(true));
    await command();
    expect(fetcher).toHaveBeenCalledTimes(1);
    await command("updateTrasferimento");
    await settle(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(
      fetcher.mock.calls.every(([url]) => url.endsWith("/trasferimento/7")),
    ).toBe(true);
  });
  it.each(["document", "auth"])(
    "late command denial from previous %s context is ignored",
    async (change) => {
      await mount();
      await settle(() => expect(read.isSuccess).toBe(true));
      let reject!: (e: Error) => void;
      let pending!: Promise<unknown>;
      await act(async () => {
        pending = client
          .getMutationCache()
          .build(client, {
            mutationKey: ["updateBolla"],
            mutationFn: () =>
              new Promise((_, no) => {
                reject = no;
              }),
          })
          .execute({ id: 7 })
          .catch(() => {});
      });
      await mount(
        change === "document" ? { tipo: "bolla", id: 8 } : doc,
        change === "auth" ? "session-B" : "session-A",
      );
      await settle(() => expect(read.isSuccess).toBe(true));
      const calls = fetcher.mock.calls.length;
      await act(async () => {
        reject(fail(403));
        await pending;
      });
      expect(fetcher).toHaveBeenCalledTimes(calls);
      expect(read.denied).toBe(false);
    },
  );
  it("late old 200 cannot overwrite a newer canonical denial (even transport ignoring abort)", async () => {
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    let resolve!: (r: Response) => void;
    fetcher.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await act(async () => {
      void read.refetch();
    });
    status = 403;
    await command();
    await settle(() => expect(read.denied).toBe(true));
    await act(async () =>
      resolve(
        new Response(
          JSON.stringify({ tipoAggregato: "bolla", dettaglio: { id: 7 } }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    expect(read.denied).toBe(true);
    expect(host.querySelector("input")).toBeNull();
  });
  it("logout hides cached content immediately", async () => {
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    await mount(doc, "session-A", false);
    expect(read.denied).toBe(true);
    expect(host.querySelector("input")).toBeNull();
  });
  it.each(["document", "auth"])(
    "late old GET403 cannot revoke the new %s context",
    async (change) => {
      let resolve!: (r: Response) => void;
      fetcher.mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      );
      await mount();
      await mount(
        change === "document" ? { tipo: "bolla", id: 8 } : doc,
        change === "auth" ? "session-B" : "session-A",
      );
      await settle(() => expect(read.isSuccess).toBe(true));
      await act(async () =>
        resolve(
          new Response(JSON.stringify({ error: "old denied" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      expect(read.denied).toBe(false);
      expect(host.querySelector("input")).not.toBeNull();
    },
  );
  it("command401 also refreshes canonical authentication, never retries the command", async () => {
    await mount();
    await settle(() => expect(read.isSuccess).toBe(true));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await command("updateBolla", 7, 401);
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: getGetCurrentUserQueryKey(),
    });
  });
  it("associaBolla correlates data.bollaId, never the Consegna id", () => {
    expect(
      documentCommandMatches(doc, ["associaBolla"], {
        id: 99,
        data: { bollaId: 7 },
      }),
    ).toBe(true);
    expect(
      documentCommandMatches(doc, ["associaBolla"], {
        id: 7,
        data: { bollaId: 99 },
      }),
    ).toBe(false);
    expect(documentCommandMatches(doc, undefined, { id: 7 })).toBe(false);
  });
});
