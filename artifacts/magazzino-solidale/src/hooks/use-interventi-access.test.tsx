// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  isInterventoReadDenied,
  interventiIdentity,
  useInterventiAccess,
} from "./use-interventi-access";

let client: QueryClient, root: Root, host: HTMLDivElement;
let access: ReturnType<typeof useInterventiAccess>;
let load: () => Promise<string>;
function Probe({ identity }: { identity: string }) {
  access = useInterventiAccess(identity);
  const query = useQuery({
    queryKey: access.key(["/api/interventi/17"]),
    queryFn: async ({ signal }) => {
      void signal;
      return load();
    },
    retry: false,
    enabled: !access.blocked,
  });
  const denied = isInterventoReadDenied(query.error);
  useEffect(() => {
    if (denied && !access.blocked) access.revoke();
  }, [denied, access.blocked]);
  return <p>{denied || access.blocked ? "negato" : query.data}</p>;
}
async function mount(identity = "A") {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe key={identity} identity={identity} />
      </QueryClientProvider>,
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  load = async () => "nota protetta";
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
it.each([401, 403, 404])(
  "T14 GET %s elimina contenuti e cache protette",
  async (status) => {
    await mount();
    await act(async () =>
      vi.waitFor(() => expect(host.textContent).toBe("nota protetta")),
    );
    load = async () => {
      throw { status };
    };
    await act(async () => client.invalidateQueries());
    await act(async () =>
      vi.waitFor(() => expect(host.textContent).toBe("negato")),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data != null),
    ).toHaveLength(0);
    expect(() => access.assertCurrent()).toThrow();
  },
);
it("T14 vecchia identità e risposta tardiva non ripopolano il nuovo contesto", async () => {
  let resolve!: (value: string) => void;
  load = () => new Promise((r) => (resolve = r));
  await mount("A");
  const old = access;
  load = async () => "identità B";
  await mount("B");
  await act(async () => {
    resolve("segreto A");
  });
  await act(async () =>
    vi.waitFor(() => expect(host.textContent).toBe("identità B")),
  );
  expect(() => old.assertCurrent()).toThrow();
  expect(
    client
      .getQueryCache()
      .getAll()
      .some((query) => query.state.data === "segreto A"),
  ).toBe(false);
});
it("T14 rete non è revoca e un errore comando non invalida il GET", async () => {
  await mount();
  await act(async () =>
    vi.waitFor(() => expect(host.textContent).toBe("nota protetta")),
  );
  expect(isInterventoReadDenied(new Error("rete"))).toBe(false);
  await client
    .getMutationCache()
    .build(client, {
      mutationFn: async () => {
        throw { status: 403 };
      },
    })
    .execute(undefined)
    .catch(() => {});
  expect(host.textContent).toBe("nota protetta");
  expect(() => access.assertCurrent()).not.toThrow();
});
it("l'identità include ruolo, grant e ogni assegnazione; l'ordine dei grant non cambia il perimetro", () => {
  const user = {
    id: 1,
    ruoloId: 2,
    isAdmin: false,
    aree: ["sociale"],
    permessi: ["a", "b"],
    areaOperativaId: 3,
    centroAscoltoId: 4,
    zonaUdsId: null,
  } as Parameters<typeof interventiIdentity>[0];
  expect(interventiIdentity({ ...user!, permessi: ["b", "a"] })).toBe(
    interventiIdentity(user),
  );
  for (const change of [
    { ruoloId: 5 },
    { permessi: ["a"] },
    { areaOperativaId: null },
    { centroAscoltoId: null },
    { zonaUdsId: 8 },
    { aree: [] },
  ])
    expect(interventiIdentity({ ...user!, ...change })).not.toBe(
      interventiIdentity(user),
    );
});
