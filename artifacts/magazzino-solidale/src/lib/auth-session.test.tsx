import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@workspace/api-client-react";

const server = vi.hoisted(() => ({
  user: null as AuthUser | null,
  modules: ["UDS"],
  unavailable: false,
  configReads: 0,
}));
vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  return {
    getGetCurrentUserQueryKey: () => ["/api/auth/me"],
    getGetBootstrapStatusQueryKey: () => ["/api/auth/bootstrap-status"],
    getGetConfigurazioneAmbientePubblicaQueryKey: () => [
      "/api/configurazione-ambiente",
    ],
    useGetCurrentUser: ({ query }: { query: object }) =>
      useQuery({
        queryKey: ["/api/auth/me"],
        queryFn: async () => server.user,
        ...query,
      }),
    useGetBootstrapStatus: ({ query }: { query: object }) =>
      useQuery({
        queryKey: ["/api/auth/bootstrap-status"],
        queryFn: async () => ({ bootstrap: false }),
        ...query,
      }),
    useGetConfigurazioneAmbientePubblica: ({ query }: { query: object }) =>
      useQuery({
        queryKey: ["/api/configurazione-ambiente"],
        queryFn: async () => {
          server.configReads++;
          if (server.unavailable) throw new Error("Configuration unavailable");
          return { moduliAttivi: server.modules };
        },
        ...query,
      }),
    useLogoutUser: () => ({ mutate: vi.fn() }),
  };
});
import { AuthProvider, useAuth } from "./auth";
import { useConfigurazioneAmbienteFlags } from "./use-moduli";
function Probe() {
  const { user, isLoading } = useAuth();
  const flags = useConfigurazioneAmbienteFlags();
  const [draft, setDraft] = useState("");
  if (isLoading || flags.isLoading) return <div>loading</div>;
  if (flags.isError) return <div role="alert">Configuration unavailable</div>;
  return (
    <div>
      <span>
        {user?.id}:{user?.areaOperativaId}:{user?.permessi.join(",")}
      </span>
      <button onClick={() => setDraft("old draft")}>draft</button>
      <output>{draft}</output>
    </div>
  );
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("BUG6 — provider reale e cache tra sessioni", () => {
  let client: QueryClient, root: Root, container: HTMLDivElement;
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    server.user = {
      id: 1,
      ruoloId: 1,
      areaOperativaId: 10,
      aree: ["uds"],
      permessi: ["uds.directory.view"],
    } as AuthUser;
    server.modules = ["UDS"];
    server.unavailable = false;
    server.configReads = 0;
    client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  });
  async function mount() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AuthProvider>
            <Probe />
          </AuthProvider>
        </QueryClientProvider>,
      );
      await tick();
    });
    await act(tick);
  }
  it("revoca, cambio Area e cambio utente eliminano dati e bozze della precedente identità", async () => {
    await mount();
    for (const next of [
      { ...server.user!, permessi: [] },
      { ...server.user!, areaOperativaId: 20 },
      { ...server.user!, id: 2, ruoloId: 8 },
    ]) {
      await act(async () => {
        container.querySelector("button")!.click();
        client.setQueryData(["/api/beneficiari"], ["old private data"]);
      });
      expect(container.querySelector("output")!.textContent).toBe("old draft");
      server.user = next;
      await act(async () => {
        await client.refetchQueries({ queryKey: ["/api/auth/me"] });
        await tick();
      });
      expect(client.getQueryData(["/api/beneficiari"])).toBeUndefined();
      expect(container.querySelector("output")!.textContent).toBe("");
      expect(container.textContent).toContain(
        `${next.id}:${next.areaOperativaId}:`,
      );
    }
  });
  it("spegnimento servizio e configurazione indisponibile rimuovono i payload precedenti", async () => {
    await mount();
    for (const unavailable of [false, true]) {
      client.setQueryData(["/api/report/uds"], { private: "old data" });
      server.modules = [];
      server.unavailable = unavailable;
      await act(async () => {
        await client.refetchQueries({
          queryKey: ["/api/configurazione-ambiente"],
        });
        await tick();
      });
      expect(client.getQueryData(["/api/report/uds"])).toBeUndefined();
    }
  });
  it("la configurazione assente al primo accesso mostra l'errore senza cicli di rimontaggio, poi recupera", async () => {
    server.unavailable = true;
    await mount();
    await act(tick);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Configuration unavailable");
    const reads = server.configReads;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(server.configReads).toBe(reads);
    expect(client.getQueryData(["/api/beneficiari"])).toBeUndefined();
    server.unavailable = false;
    await act(async () => { await client.refetchQueries({ queryKey: ["/api/configurazione-ambiente"] }); await tick(); });
    expect(container.querySelector("output")).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

});
