import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userId: 1,
  location: "/",
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
      id: mocks.userId,
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
  useLocation: () => [mocks.location],
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

import { AppLayout, NAV_ITEMS, isNavItemEnabledByAccess } from "./layout";

it.each([
  "mensa.transfers.request",
  "mensa.transfers.receive",
  "mensa.transfers.manage",
])(
  "M67-10/11 Rifornimenti menu supports %s without other grants",
  (permission) => {
    const item = NAV_ITEMS.find((item) => item.key === "mensaTrasferimenti")!;
    expect(
      isNavItemEnabledByAccess(
        item,
        (area) => area === "mensa",
        (p) => p === permission,
      ),
    ).toBe(true);
    expect(
      isNavItemEnabledByAccess(
        item,
        (area) => area === "mensa",
        (p) => p === "mensa.reports.view",
      ),
    ).toBe(false);
    expect(
      isNavItemEnabledByAccess(
        item,
        () => false,
        (p) => p === permission,
      ),
    ).toBe(false);
  },
);

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

async function expandGroup(label: string) {
  const trigger = sidebarGroup(label)?.querySelector<HTMLButtonElement>(
    '[data-slot="sidebar-group-label"]',
  );
  if (trigger?.getAttribute("aria-expanded") === "false") {
    await act(async () => trigger.click());
  }
}

describe("Sidebar - Mappa Operativa", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.isAdmin = false;
    mocks.userId = 1;
    mocks.location = "/";
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

  it("all'accesso lascia chiusi tutti i gruppi, anche quello della pagina corrente", async () => {
    mocks.isAdmin = true;
    mocks.location = "/volontari";
    await renderLayout();
    const triggers = document.querySelectorAll(
      '[data-slot="sidebar-group-label"]',
    );
    expect(triggers.length).toBeGreaterThan(1);
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    }
    expect(groupLinks("Logistica")).toHaveLength(0);
  });

  it("apre soltanto il gruppo richiesto, mantenendolo durante la navigazione", async () => {
    mocks.isAdmin = true;
    await renderLayout();
    await expandGroup("Logistica");
    expect(groupLinks("Logistica").length).toBeGreaterThan(0);
    expect(groupLinks("Generale")).toHaveLength(0);
    mocks.location = "/volontari";
    await renderLayout();
    expect(groupLinks("Logistica").length).toBeGreaterThan(0);
    expect(groupLinks("Generale")).toHaveLength(0);
    await act(async () =>
      sidebarGroup("Logistica")
        ?.querySelector<HTMLButtonElement>('[data-slot="sidebar-group-label"]')
        ?.click(),
    );
    expect(groupLinks("Logistica")).toHaveLength(0);
  });

  it("non eredita i gruppi aperti quando cambia l'utente", async () => {
    mocks.isAdmin = true;
    await renderLayout();
    await expandGroup("Logistica");
    expect(groupLinks("Logistica").length).toBeGreaterThan(0);
    mocks.userId = 2;
    await renderLayout();
    expect(groupLinks("Logistica")).toHaveLength(0);
  });

  it("mostra al SuperAdmin Mappa Operativa come ultima voce di Logistica", async () => {
    mocks.isAdmin = true;
    mocks.isSuperAdmin = true;
    mocks.areas = new Set(["logistica"]);
    mocks.mapsLayerCount = 1;
    await renderLayout();

    await expandGroup("Logistica");
    await expandGroup("Generale");
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

    await expandGroup("Logistica");
    const maps = groupLinks("Logistica").find((link) =>
      link.textContent?.includes("Mappa Operativa"),
    );
    expect(maps?.getAttribute("href")).toBe("/maps");
  });

  it("non mostra Mappa Operativa al SuperAdmin senza layer", async () => {
    mocks.isSuperAdmin = true;
    mocks.areas = new Set(["logistica"]);
    await renderLayout();

    await expandGroup("Logistica");
    expect(document.body.textContent).not.toContain("Mappa Operativa");
  });

  it("mostra Mappa Operativa all'utente autorizzato senza richiedere area logistica", async () => {
    mocks.areas = new Set(["sociale"]);
    mocks.permissions = new Set(["maps.operational"]);
    mocks.mapsLayerCount = 1;
    await renderLayout();

    await expandGroup("Logistica");
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

      await expandGroup("Logistica");
      expect(document.body.textContent).not.toContain("Mappa Operativa");
    },
  );
});
