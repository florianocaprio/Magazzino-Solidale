import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiState = vi.hoisted(() => ({
  markerActions: ["open", "route"],
  deliveryError: null as unknown,
  deliveryDate: "2026-08-22",
  socialDate: null as string | null,
}));

vi.mock("@workspace/api-client-react", () => ({
  getMapsRouteConsegna: vi.fn(),
  getGetMapsConsegneQueryKey: () => ["maps", "deliveries"],
  getGetMapsInterventiSocialiQueryKey: () => ["maps", "social"],
  getGetMapsPuntiOperativiQueryKey: () => ["maps", "points"],
  getGetMapsRitiriNonEffettuatiQueryKey: () => ["maps", "missed"],
  useGetMapsCapabilities: () => ({ data: { operational: true, layers: [{ code: "pacchi.consegne", domain: "pacchi", label: "Consegne", routeSupported: true }, ...(apiState.socialDate ? [{ code: "sociale.interventi_pianificati", domain: "sociale", label: "Interventi", routeSupported: false }] : [])] }, isLoading: false }),
  useGetMapsConsegne: () => ({ data: apiState.deliveryError ? undefined : [{ id: "pacchi.consegna:1", layer: "pacchi.consegne", entityType: "consegna", entityId: 1, title: "Consegna CON-1", subtitle: null, status: "pianificata", address: "Via Test 1", date: apiState.deliveryDate, actions: apiState.markerActions }], isLoading: false, isError: apiState.deliveryError != null, error: apiState.deliveryError }),
  useGetMapsInterventiSociali: () => ({ data: apiState.socialDate ? [{ id: "sociale.intervento:2", layer: "sociale.interventi_pianificati", entityType: "intervento", entityId: 2, title: "Intervento 2", subtitle: null, status: "pianificato", address: "Via Sociale 2", date: apiState.socialDate, actions: ["open"] }] : undefined, isLoading: false, isError: false, error: null }),
  useGetMapsRitiriNonEffettuati: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
  useGetMapsPuntiOperativi: () => ({ data: undefined, isLoading: false, isError: false, error: null }),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("wouter", () => ({ Link: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));

import MapsOperativa from "@/pages/maps";

describe("MAPS operativa", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    apiState.markerActions = ["open", "route"];
    apiState.deliveryError = null;
    apiState.deliveryDate = "2026-08-22";
    apiState.socialDate = null;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("genera i toggle dalle capabilities e mostra la mappa OpenStreetMap senza chiavi", async () => {
    await act(async () => root.render(<MapsOperativa />));
    expect(document.body.textContent).toContain("Consegna CON-1");
    expect(document.body.textContent).toContain("22/08/2026");
    expect(document.body.textContent).not.toContain("22/08/2026 00:00");
    expect(document.querySelector('[aria-label="maps.openRoute"]')).toBeTruthy();
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="Mappa operativa OpenStreetMap"]')).toBeTruthy();

    const details = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "maps.markerDetails");
    expect(details).toBeTruthy();
    await act(async () => details?.click());
    expect(document.body.textContent).toContain("maps.openOwner");
    expect(document.body.textContent).toContain("Via Test 1");
  });

  it("non mostra il percorso quando il provider non autorizza l'azione", async () => {
    apiState.markerActions = ["open"];
    await act(async () => root.render(<MapsOperativa />));
    expect(document.querySelector('[aria-label="maps.openRoute"]')).toBeNull();
  });

  it("mostra data e ora Europe/Rome per i marker timestamp", async () => {
    apiState.socialDate = "2026-08-22T22:30:00Z";
    await act(async () => root.render(<MapsOperativa />));
    expect(document.body.textContent).toContain("23/08/2026 00:30");

    const details = Array.from(document.querySelectorAll("button"))
      .filter((button) => button.textContent === "maps.markerDetails");
    await act(async () => details[0]?.click());
    expect(document.body.textContent?.match(/23\/08\/2026 00:30/g)).toHaveLength(2);
  });

  it("mostra Apri soltanto quando actions contiene open", async () => {
    apiState.markerActions = ["route"];
    await act(async () => root.render(<MapsOperativa />));
    const details = Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "maps.markerDetails");
    await act(async () => details?.click());
    expect(document.body.textContent).not.toContain("maps.openOwner");
    expect(document.querySelector('[aria-label="maps.openRoute"]')).toBeTruthy();
  });

  it("mantiene gli altri layer utilizzabili e mostra l'errore specifico del layer", async () => {
    apiState.deliveryError = { data: { error: "Restringi l'intervallo o i filtri" } };
    await act(async () => root.render(<MapsOperativa />));
    expect(document.body.textContent).toContain("Restringi l'intervallo o i filtri");
    expect(document.body.textContent).toContain("maps.empty");
  });
});
