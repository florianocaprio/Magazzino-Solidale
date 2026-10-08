import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DocumentoOperativoDettaglioComune } from "./documento-operativo";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, isAdmin: true, aree: ["magazzino"], permessi: [] },
    hasPermission: () => true,
  }),
  authUserCanOperateBolle: () => true,
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "it" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

let client: QueryClient;
let root: Root;
let host: HTMLDivElement;
let code: number;
let secondaryCode: number;
const dirty = vi.fn();
const bolla = {
  id: 7,
  numeroBolla: "F7-PROTETTA",
  dataBolla: "2026-10-08",
  stato: "bozza",
  tipoDestinatario: "beneficiario",
  beneficiarioId: 1,
  beneficiarioNome: "F7 Persona protetta",
  versione: 1,
  righe: [],
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  code = 200;
  secondaryCode = 200;
  dirty.mockClear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const canonical = url === "/api/documenti-operativi/bolla/7";
      const secondary = url.endsWith("/richiesta");
      const status = canonical ? code : secondary ? secondaryCode : 200;
      const data =
        status !== 200
          ? { error: "denied" }
          : canonical
            ? { tipoAggregato: "bolla", dettaglio: bolla }
            : secondary
              ? {
                  richiesta: {
                    id: 3,
                    codice: "LINK-PROTETTO",
                    percorso: "/richieste-magazzino?richiestaId=3",
                  },
                }
              : url === "/api/bolle/7"
                ? bolla
                : [];
      return new Response(JSON.stringify(data), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DocumentoOperativoDettaglioComune
          selection={{ tipo: "bolla", id: 7 }}
          onClose={() => {}}
          onDraftDirtyChange={dirty}
        />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await vi.waitFor(() => expect(host.textContent).toContain("F7-PROTETTA"));
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
  vi.unstubAllGlobals();
});
async function deny() {
  await act(async () => {
    await client
      .getMutationCache()
      .build(client, {
        mutationKey: ["updateBolla"],
        mutationFn: async () => {
          throw Object.assign(new Error("action denied"), { status: 403 });
        },
      })
      .execute({ id: 7 })
      .catch(() => {});
  });
  await act(async () => {
    await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  });
}
it("the real shared component retains its draft and dirty callback after a command403 / GET200", async () => {
  const button = Array.from(host.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("bolle.annullaBolla"),
  )!;
  await act(async () => button.click());
  await act(async () => {
    await vi.waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  });
  const input = document.querySelector(
    "[role=alertdialog] input, [role=alertdialog] textarea",
  );
  expect(input).not.toBeNull();
  dirty.mockClear();
  await deny();
  expect(host.textContent).toContain("F7-PROTETTA");
  expect(
    document.querySelector(
      "[role=alertdialog] input, [role=alertdialog] textarea",
    ),
  ).toBe(input);
  expect(dirty).not.toHaveBeenCalledWith(false);
});
it.each([403, 404, 401])(
  "canonical %s hides real cached detail and its open portal",
  async (status) => {
    const button = Array.from(host.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("bolle.annullaBolla"),
    )!;
    await act(async () => button.click());
    code = status;
    await deny();
    await act(async () => {
      await vi.waitFor(() =>
        expect(host.textContent).not.toContain("F7-PROTETTA"),
      );
    });
    expect(host.textContent).not.toContain("F7 Persona protetta");
    expect(document.querySelector("[role=alertdialog]")).toBeNull();
  },
);
it("secondary request denial drops cached link, not the readable document", async () => {
  expect(host.textContent).toContain("LINK-PROTETTO");
  secondaryCode = 403;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["/api/documenti-operativi/bolla/7/richiesta"],
    });
  });
  await act(async () => {
    await vi.waitFor(() =>
      expect(host.textContent).not.toContain("LINK-PROTETTO"),
    );
  });
  expect(host.textContent).toContain("F7-PROTETTA");
});
