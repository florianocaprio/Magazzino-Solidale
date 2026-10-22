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
  pendingMaps: false,
  mapsError: false,
  loggedIn: true,
  dir: "ltr",
  disabledModules: new Set<string>(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: mocks.loggedIn ? {
      id: mocks.userId,
      isAdmin: mocks.isAdmin,
      isSuperAdmin: mocks.isSuperAdmin,
      nome: "Utente",
      cognome: "Test",
      ruoloNome: "Ruolo test",
    } : null,
    hasArea: (area: string) => mocks.isAdmin || mocks.areas.has(area),
    hasPermission: (permission: string) =>
      mocks.isAdmin || mocks.permissions.has(permission),
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/use-moduli", () => ({
  useConfigurazioneAmbienteFlags: () => ({
    isModuloAttivo: (code: string) => !mocks.disabledModules.has(code),
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
      isError: mocks.mapsError,
      isPending: mocks.pendingMaps,
      data: mocks.pendingMaps ? undefined : {
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
  "nav.items.reportLogistica": "Report operativi",
  "nav.items.maps": "Mappa Operativa",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key,
    i18n: { language: "it", changeLanguage: vi.fn(), dir: () => mocks.dir },
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
    mocks.pendingMaps = false;
    mocks.mapsError = false;
    mocks.loggedIn = true;
    mocks.dir = "ltr";
    mocks.disabledModules = new Set();
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

  const trigger = (label: string) => sidebarGroup(label)!.querySelector<HTMLButtonElement>('[data-slot="sidebar-group-label"]')!;

  it("il nome apre il profilo personale anche senza permessi amministrativi", async () => {
    mocks.areas = new Set(["uds"]);
    mocks.permissions = new Set(["uds.directory.view"]);
    await renderLayout();
    const profile = container.querySelector<HTMLAnchorElement>('a[href="/profilo"]');
    expect(profile?.textContent).toContain("Utente Test");
    expect(profile?.getAttribute("aria-label")).toBe("profile.title");
    expect(groupLinks("Amministrazione")).toHaveLength(0);
  });

  it("separa corrente e aperto nelle quattro combinazioni, senza duplicare aria-current", async () => {
    mocks.isAdmin = true;
    mocks.location = "/volontari";
    await renderLayout();
    expect(trigger("Logistica").getAttribute("data-current")).toBe("true");
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("Generale").getAttribute("data-current")).toBe("false");
    expect(trigger("Generale").getAttribute("aria-expanded")).toBe("false");
    await expandGroup("Generale");
    await act(async () => trigger("Logistica").click());
    expect(trigger("Logistica").getAttribute("data-current")).toBe("true");
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("false");
    expect(trigger("Generale").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("Logistica").hasAttribute("aria-current")).toBe(false);
    await expandGroup("Logistica");
    expect(document.querySelectorAll('a[aria-current="page"]')).toHaveLength(1);
    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/volontari");
    for (const group of document.querySelectorAll('[data-slot="sidebar-group-label"]')) {
      expect(group.querySelectorAll('[data-nav-group-icon]')).toHaveLength(1);
      expect(group.querySelector('[data-nav-group-icon]')?.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("refresh dello stesso utente conserva le scelte; logout e rientro le azzerano", async () => {
    mocks.isAdmin = true;
    mocks.location = "/volontari";
    await renderLayout();
    await act(async () => trigger("Logistica").click());
    await expandGroup("Generale");
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("false");
    mocks.dir = "rtl";
    await renderLayout();
    expect(trigger("Generale").getAttribute("aria-expanded")).toBe("true");
    mocks.loggedIn = false;
    await renderLayout();
    expect(document.querySelector('[data-slot="sidebar-group"]')).toBeNull();
    mocks.loggedIn = true;
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("true");
    expect(trigger("Generale").getAttribute("aria-expanded")).toBe("false");
  });

  it("Maps tardiva completa una sola inizializzazione", async () => {
    mocks.isAdmin = true;
    mocks.location = "/maps";
    mocks.pendingMaps = true;
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("false");
    mocks.pendingMaps = false;
    mocks.mapsLayerCount = 1;
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/maps");
    await act(async () => trigger("Logistica").click());
    mocks.mapsLayerCount = 2;
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("false");
    mocks.mapsError = true;
    await renderLayout();
    expect(document.querySelector('a[aria-current="page"]')).toBeNull();
  });

  it.each(["manuale", "navigazione"])("Maps tardiva rispetta %s", async (action) => {
    mocks.isAdmin = true;
    mocks.location = "/maps";
    mocks.pendingMaps = true;
    await renderLayout();
    if (action === "manuale") await expandGroup("Generale");
    else {
      mocks.location = "/volontari";
      await renderLayout();
      mocks.location = "/maps";
      await renderLayout();
    }
    mocks.pendingMaps = false;
    mocks.mapsLayerCount = 1;
    await renderLayout();
    expect(trigger("Logistica").getAttribute("aria-expanded")).toBe("false");
  });

  it("modulo escluso non genera né link corrente né gruppo aperto", async () => {
    mocks.isAdmin = true;
    mocks.location = "/carico-merce";
    mocks.disabledModules.add("LOTTI");
    await renderLayout();
    expect(document.querySelector('a[href="/carico-merce"]')).toBeNull();
    expect(document.querySelector('a[aria-current="page"]')).toBeNull();
    expect(trigger("nav.groups.magazzino").getAttribute("aria-expanded")).toBe("false");
  });

  it("all'accesso apre soltanto il gruppo della pagina corrente", async () => {
    mocks.isAdmin = true;
    mocks.location = "/volontari";
    await renderLayout();
    const triggers = document.querySelectorAll(
      '[data-slot="sidebar-group-label"]',
    );
    expect(triggers.length).toBeGreaterThan(1);
    for (const trigger of triggers) {
      expect(trigger.getAttribute("aria-expanded")).toBe(trigger.textContent?.includes("Logistica") ? "true" : "false");
    }
    expect(groupLinks("Logistica").length).toBeGreaterThan(0);
  });

  it("apre soltanto il gruppo richiesto, mantenendolo durante la navigazione", async () => {
    mocks.isAdmin = true;
    mocks.location = "/senza-voce";
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
      "Report operativi",
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
