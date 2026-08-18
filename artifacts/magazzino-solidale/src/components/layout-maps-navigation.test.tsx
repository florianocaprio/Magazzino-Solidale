import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAdmin: false,
  isSuperAdmin: false,
  areas: new Set<string>(),
  permissions: new Set<string>(),
  mapsLayerCount: 0,
  capabilitiesHook: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: {
      isAdmin: mocks.isAdmin,
      isSuperAdmin: mocks.isSuperAdmin,
      nome: "Utente",
      cognome: "Test",
      ruoloNome: "Ruolo test",
    },
    hasArea: (area: string) => mocks.isAdmin || mocks.areas.has(area),
    hasPermission: (permission: string) =>
      mocks.isAdmin || mocks.permissions.has(permission),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/use-moduli", () => ({
  useConfigurazioneAmbienteFlags: () => ({
    isModuloAttivo: () => true,
  }),
}));

vi.mock("@/lib/i18n", () => ({
  LANGUAGES: [{ code: "it", label: "Italiano" }],
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetMapsCapabilitiesQueryKey: () => ["maps", "capabilities"],
  useGetMapsCapabilities: (options: unknown) => {
    mocks.capabilitiesHook(options);
    return {
      data: {
        layers: Array.from({ length: mocks.mapsLayerCount }, (_, id) => ({
          id,
        })),
      },
    };
  },
}));

const translations: Record<string, string> = {
  "nav.groups.generale": "Generale",
  "nav.groups.logistica": "Logistica",
  "nav.items.dashboard": "Dashboard",
  "nav.items.volontari": "Volontari",
  "nav.items.mezzi": "Mezzi",
  "nav.items.approvazioniLogistica": "Approva nuovi inserimenti",
  "nav.items.fornitori": "Fornitori",
  "nav.items.approvvigionamenti": "Approvvigionamenti",
  "nav.items.maps": "Mappa Operativa",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
    i18n: { language: "it", changeLanguage: vi.fn() },
  }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/"],
  Link: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { AppLayout } from "./layout";

function sidebarGroup(label: string): HTMLElement | undefined {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-slot="sidebar-group"]'),
  ).find((group) =>
    group
      .querySelector('[data-slot="sidebar-group-label"]')
      ?.textContent?.includes(label),
  );
}

function groupLinks(label: string): HTMLAnchorElement[] {
  return Array.from(
    sidebarGroup(label)?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
  );
}

describe("Sidebar - Mappa Operativa", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.isAdmin = false;
    mocks.isSuperAdmin = false;
    mocks.areas = new Set();
    mocks.permissions = new Set();
    mocks.mapsLayerCount = 0;
    mocks.capabilitiesHook.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  const renderLayout = async () => {
    await act(async () =>
      root.render(
        <AppLayout>
          <main>Contenuto</main>
        </AppLayout>,
      ),
    );
  };

  it("mostra al SuperAdmin Mappa Operativa come ultima voce di Logistica", async () => {
    mocks.isSuperAdmin = true;
    mocks.areas = new Set(["logistica"]);
    mocks.mapsLayerCount = 1;
    await renderLayout();

    const links = groupLinks("Logistica");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Volontari",
      "Mezzi",
      "Approva nuovi inserimenti",
      "Fornitori",
      "Approvvigionamenti",
      "Mappa Operativa",
    ]);
    expect(links.at(-1)?.getAttribute("href")).toBe("/maps");
    expect(
      groupLinks("Generale").some(
        (link) => link.getAttribute("href") === "/maps",
      ),
    ).toBe(false);
  });

  it("mostra Mappa Operativa all'Admin con almeno un layer", async () => {
    mocks.isAdmin = true;
    mocks.mapsLayerCount = 1;
    await renderLayout();

    const maps = groupLinks("Logistica").find((link) =>
      link.textContent?.includes("Mappa Operativa"),
    );
    expect(maps?.getAttribute("href")).toBe("/maps");
  });

  it("non mostra Mappa Operativa al SuperAdmin senza layer", async () => {
    mocks.isSuperAdmin = true;
    mocks.areas = new Set(["logistica"]);
    await renderLayout();

    expect(document.body.textContent).not.toContain("Mappa Operativa");
  });

  it("mostra Mappa Operativa all'utente autorizzato senza richiedere area logistica", async () => {
    mocks.areas = new Set(["sociale"]);
    mocks.permissions = new Set(["maps.operational"]);
    mocks.mapsLayerCount = 1;
    await renderLayout();

    expect(groupLinks("Logistica").at(-1)?.getAttribute("href")).toBe("/maps");
    expect(document.body.textContent).toContain("Mappa Operativa");
  });

  it.each([
    { caso: "senza maps.operational", areas: ["sociale"], permissions: [] },
    {
      caso: "senza area sorgente",
      areas: ["logistica"],
      permissions: ["maps.operational"],
    },
  ])(
    "non mostra Mappa Operativa all'utente standard $caso",
    async ({ areas, permissions }) => {
      mocks.areas = new Set(areas);
      mocks.permissions = new Set(permissions);
      mocks.mapsLayerCount = 1;
      await renderLayout();

      expect(document.body.textContent).not.toContain("Mappa Operativa");
    },
  );
});
