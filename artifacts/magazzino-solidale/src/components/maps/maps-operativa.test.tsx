import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiState = vi.hoisted(() => ({ markerActions: ["open", "route"] }));

vi.mock("@workspace/api-client-react", () => ({
  getMapsRouteConsegna: vi.fn(),
  getGetMapsConsegneQueryKey: () => ["maps", "deliveries"],
  getGetMapsInterventiSocialiQueryKey: () => ["maps", "social"],
  getGetMapsPuntiOperativiQueryKey: () => ["maps", "points"],
  getGetMapsRitiriNonEffettuatiQueryKey: () => ["maps", "missed"],
  useGetMapsCapabilities: () => ({ data: { operational: true, layers: [{ code: "pacchi.consegne", domain: "pacchi", label: "Consegne", routeSupported: true }] }, isLoading: false }),
  useGetMapsConsegne: () => ({ data: [{ id: "pacchi.consegna:1", layer: "pacchi.consegne", entityType: "consegna", entityId: 1, title: "Consegna CON-1", subtitle: null, status: "pianificata", address: "Via Test 1", date: "2026-08-17", actions: apiState.markerActions }], isLoading: false }),
  useGetMapsInterventiSociali: () => ({ data: undefined, isLoading: false }),
  useGetMapsRitiriNonEffettuati: () => ({ data: undefined, isLoading: false }),
  useGetMapsPuntiOperativi: () => ({ data: undefined, isLoading: false }),
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

  it("genera i toggle dalle capabilities e degrada alla lista senza chiave Google", async () => {
    await act(async () => root.render(<MapsOperativa />));
    expect(document.body.textContent).toContain("maps.noApiKey");
    expect(document.body.textContent).toContain("Consegna CON-1");
    expect(document.querySelector('[aria-label="maps.openRoute"]')).toBeTruthy();
    expect(document.querySelectorAll('[role="switch"]')).toHaveLength(1);
    expect(document.querySelector('[aria-label="Mappa operativa Google Maps"]')).toBeNull();

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
});
