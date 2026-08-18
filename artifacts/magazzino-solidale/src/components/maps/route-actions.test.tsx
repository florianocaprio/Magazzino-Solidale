import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getRoute: vi.fn() }));
const auth = vi.hoisted(() => ({
  allowed: true,
  isAdmin: false,
  isSuperAdmin: false,
}));
const notifications = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({
  getMapsRouteConsegna: api.getRoute,
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: {
      isAdmin: auth.isAdmin,
      isSuperAdmin: auth.isSuperAdmin,
    },
    hasPermission: () => auth.allowed,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: notifications.toast }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { RouteActions } from "@/components/maps/route-actions";

function button(label: string): HTMLButtonElement {
  const result = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!result) throw new Error(`Pulsante ${label} non trovato`);
  return result;
}

describe("azioni condivise percorso", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    auth.allowed = true;
    auth.isAdmin = false;
    auth.isSuperAdmin = false;
    api.getRoute.mockReset().mockResolvedValue({ url: "https://www.google.com/maps/dir/?api=1" });
    notifications.toast.mockReset();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(window, "open").mockImplementation(() => null);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    container.remove();
    document.body.innerHTML = "";
  });

  it("apre, copia e condivide l'URL autorizzato senza aggiungere dati personali", async () => {
    await act(async () => root.render(<RouteActions consegnaId={7} available />));

    await act(async () => button("maps.openRoute").click());
    expect(window.open).toHaveBeenCalledWith(
      "https://www.google.com/maps/dir/?api=1",
      "_blank",
      "noopener,noreferrer",
    );

    await act(async () => button("maps.copyRoute").click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1");
    expect(notifications.toast).toHaveBeenCalledWith({ title: "maps.routeCopied" });

    await act(async () => button("maps.shareRoute").click());
    expect(navigator.share).toHaveBeenCalledWith({
      title: "maps.shareTitle",
      text: "maps.shareText",
      url: "https://www.google.com/maps/dir/?api=1",
    });
  });

  it("usa la copia come fallback quando Web Share non è disponibile", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    await act(async () => root.render(<RouteActions consegnaId={8} available />));
    await act(async () => button("maps.shareRoute").click());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("https://www.google.com/maps/dir/?api=1");
  });

  it("mostra un link selezionabile quando Clipboard API non è disponibile", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    await act(async () => root.render(<RouteActions consegnaId={9} available />));
    await act(async () => button("maps.copyRoute").click());
    const input = document.querySelector<HTMLInputElement>('[aria-label="maps.manualRouteUrl"]');
    expect(input?.value).toBe("https://www.google.com/maps/dir/?api=1");
    expect(notifications.toast).toHaveBeenCalledWith({
      title: "maps.manualCopyTitle",
      description: "maps.manualCopyDescription",
    });
  });

  it("mostra un errore senza esporre azioni esterne quando l'endpoint nega il percorso", async () => {
    api.getRoute.mockRejectedValueOnce({ data: { error: "Consegna non accessibile" } });
    await act(async () => root.render(<RouteActions consegnaId={11} available />));
    await act(async () => button("maps.openRoute").click());
    expect(window.open).not.toHaveBeenCalled();
    expect(notifications.toast).toHaveBeenCalledWith({
      title: "maps.routeError",
      description: "Consegna non accessibile",
      variant: "destructive",
    });
  });

  it("non espone azioni senza permission o senza snapshot/provider autorizzato", async () => {
    auth.allowed = false;
    await act(async () => root.render(<RouteActions consegnaId={10} available />));
    expect(document.querySelector("button")).toBeNull();

    auth.allowed = true;
    await act(async () => root.render(<RouteActions consegnaId={10} available={false} />));
    expect(document.querySelector("button")).toBeNull();
  });

  it.each([
    { ruolo: "Admin", isAdmin: true, isSuperAdmin: false },
    { ruolo: "SuperAdmin", isAdmin: false, isSuperAdmin: true },
  ])("espone le azioni a $ruolo senza permission applicativa esplicita", async ({ isAdmin, isSuperAdmin }) => {
    auth.allowed = false;
    auth.isAdmin = isAdmin;
    auth.isSuperAdmin = isSuperAdmin;

    await act(async () => root.render(<RouteActions consegnaId={12} available />));
    expect(document.querySelector('[aria-label="maps.openRoute"]')).toBeTruthy();
  });
});
