import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNavItemEnabledByAccess, navigationGroupForItem, NAV_ITEMS } from "@/components/layout";
import { canAccessDocumentiOperativiRoute } from "@/App";

const appSource = readFileSync(
  path.resolve(process.cwd(), "src/App.tsx"),
  "utf8",
);

function routeSource(path: string, nextPath: string): string {
  const start = appSource.indexOf(`<Route path="${path}">`);
  const end = appSource.indexOf(`<Route path="${nextPath}">`, start + 1);
  return appSource.slice(start, end);
}

describe("permission gate della navigazione operativa", () => {
  it.each(["sociale", "uds"])(
    "i permessi condivisi di %s non abilitano il menu o le pagine Emporio",
    (area) => {
      const hasArea = (key: string) => key === area;
      const emporio = NAV_ITEMS.filter((item) => item.groupKey === "emporio");
      expect(emporio.length).toBeGreaterThan(0);
      for (const item of emporio) {
        expect(isNavItemEnabledByAccess(item, hasArea, () => true)).toBe(false);
      }
      for (const [path, next, permission] of [
        ["/emporio/crediti-saldo", "/emporio/accessi", "credito.view"],
        ["/emporio/accessi", "/emporio/spese", "emporio.access.view"],
      ]) {
        expect(routeSource(path, next)).toContain(`<RequireEmporioMenu permission="${permission}">`);
      }
    },
  );

  it("una sola eccezione esplicita espone solo la sottofunzione concessa dentro UDS", () => {
    const hasArea = (area: string) => area === "uds";
    const items = NAV_ITEMS.filter((item) => item.groupKey === "emporio" &&
      isNavItemEnabledByAccess(item, hasArea, () => true, ["credito.view"]));
    expect(items.map((item) => item.key)).toEqual(["emporioCreditiSaldo"]);
    expect(navigationGroupForItem(items[0], hasArea)).toBe("uds");
    expect(isNavItemEnabledByAccess(items[0], hasArea, () => false, ["credito.view"])).toBe(false);
  });

  it("ogni combinazione di Aree mantiene i workflow dentro menu assegnati", () => {
    const areas = ["generale", "magazzino", "sociale", "emporio", "mensa", "uds", "logistica", "analisi"];
    for (let mask = 0; mask < 2 ** areas.length; mask++) {
      const assigned = areas.filter((_, index) => mask & (1 << index));
      const hasArea = (key: string) => assigned.includes(key);
      for (const item of NAV_ITEMS.filter((item) =>
        !item.public && !item.superAdmin && isNavItemEnabledByAccess(item, hasArea, () => true),
      )) {
        expect(assigned, `${assigned}: ${item.key}`).toContain(navigationGroupForItem(item, hasArea));
      }
    }
  });

  it.each([
    ["consegne", "logistica"],
    ["turni", "logistica"],
    ["richiesteMagazzino", "sociale"],
    ["bolle", "sociale"],
    ["maps", "sociale"],
    ["maps", "magazzino"],
    ["reportLogistica", "magazzino"],
  ])("mantiene %s nel menu assegnato %s senza duplicarlo", (key, area) => {
    const item = NAV_ITEMS.find((item) => item.key === key)!;
    expect(navigationGroupForItem(item, (key) => key === area)).toBe(area);
    expect(isNavItemEnabledByAccess(item, (key) => key === area, () => true)).toBe(true);
    expect(navigationGroupForItem(item, () => true)).toBe(item.groupKey);
  });

  it("preserva il gate legacy Trasferimenti prima del redirect alla facciata comune", () => {
    const source = routeSource("/trasferimenti", "/preparazione-consegne");
    expect(source).toContain('<Guard area="magazzino">');
    expect(source).toContain('<RequireModulo codice="TRASFERIMENTI">');
    expect(source).toContain('permission="magazzino.view"');
    expect(source).toContain("<LegacyTrasferimentiRedirect />");
    expect(appSource).toContain(
      "canonicalLegacyTrasferimentiSearch(window.location.search)",
    );
  });

  it("apre la facciata comune per il solo ramo autorizzato", () => {
    const access = (
      areas: string[],
      permissions: string[],
      modules: string[],
    ) =>
      canAccessDocumentiOperativiRoute(
        (area) => areas.includes(area),
        (permission) => permissions.includes(permission),
        (module) => modules.includes(module),
      );

    expect(access(["magazzino"], ["magazzino.view"], ["TRASFERIMENTI"])).toBe(
      true,
    );
    expect(
      access(["sociale"], ["bolle.view"], ["MAGAZZINO_SOLIDALE", "BOLLE"]),
    ).toBe(true);
    expect(
      access(
        ["magazzino"],
        ["magazzino.view"],
        ["MAGAZZINO_SOLIDALE", "BOLLE"],
      ),
    ).toBe(false);
    expect(access(["sociale"], ["bolle.view"], ["TRASFERIMENTI"])).toBe(false);
    expect(
      access(
        ["magazzino"],
        ["magazzino.view", "bolle.view"],
        ["MAGAZZINO_SOLIDALE", "BOLLE"],
      ),
    ).toBe(true);
  });

  it("separa lista Sociale, directory UDS e dossier completo", () => {
    expect(routeSource("/beneficiari", "/beneficiari/:id")).toContain(
      'permission="beneficiari.view"',
    );
    expect(routeSource("/beneficiari", "/beneficiari/:id")).not.toContain(
      'permission="uds.directory.view"',
    );
    expect(routeSource("/beneficiari/:id", "/interventi")).toContain(
      'permission="beneficiari.view"',
    );
    expect(routeSource("/uds/anagrafica", "/mensa/postazione")).toContain(
      'permission="uds.directory.view"',
    );
    expect(routeSource("/uds/anagrafica", "/mensa/postazione")).not.toContain(
      'permission="beneficiari.view"',
    );
  });

  it.each([
    ["beneficiari", "beneficiari.view"],
    ["udsAnagrafica", "uds.directory.view"],
    ["interventi", "sociale.interventi.view"],
    ["emporioCreditiSaldo", "credito.view"],
    ["emporioAccessi", "emporio.access.view"],
    ["emporioCassa", "emporio.cassa.view"],
    ["emporioSpese", "emporio.sales.view"],
    ["prodotti", "magazzino.view"],
    ["lotti", "magazzino.view"],
    ["movimenti", "magazzino.view"],
    ["giacenze", "magazzino.view"],
    ["trasferimenti", "magazzino.view"],
    ["preparazioneConsegne", "magazzino.view"],
    ["scarichi", "magazzino.view"],
    ["bolle", "bolle.view"],
    ["approvvigionamenti", "approvvigionamenti.view"],
    ["turni", "logistica.turni.view"],
    ["volontari", "logistica.volontari.view"],
    ["mezzi", "logistica.mezzi.view"],
    ["approvazioniLogistica", "logistica.approvazioni.view"],
  ])("protegge %s con %s", (key, permission) => {
    expect(NAV_ITEMS.find((item) => item.key === key)?.permission).toBe(
      permission,
    );
  });

  it("nasconde Beneficiari e Interventi Sociali al ruolo Emporio standard", () => {
    const areas = new Set(["generale", "magazzino", "emporio"]);
    const permissions = new Set([
      "credito.view",
      "emporio.access.view",
      "emporio.access.manage",
      "emporio.cassa.view",
      "emporio.cassa.operate",
      "emporio.sales.view",
      "emporio.sales.manage",
    ]);
    const visible = NAV_ITEMS.filter((item) =>
      isNavItemEnabledByAccess(
        item,
        (area) => areas.has(area),
        (permission) => permissions.has(permission),
      ),
    ).map((item) => item.key);

    expect(visible).not.toContain("beneficiari");
    expect(visible).not.toContain("interventi");
    expect(visible).toEqual(
      expect.arrayContaining([
        "emporioCassa",
        "emporioCreditiSaldo",
        "emporioAccessi",
        "emporioSpese",
      ]),
    );
  });

  it("espone le viste operative Mensa con permessi separati", () => {
    const transfers = NAV_ITEMS.find(
      (item) => item.key === "mensaTrasferimenti",
    )!;
    expect(transfers.anyPermissions).toEqual([
      "mensa.transfers.request",
      "mensa.transfers.receive",
      "mensa.transfers.manage",
    ]);
    for (const grant of [
      "mensa.transfers.request",
      "mensa.transfers.receive",
      "mensa.transfers.manage",
    ])
      expect(
        isNavItemEnabledByAccess(
          transfers,
          (area) => area === "mensa",
          (permission) => permission === grant,
        ),
      ).toBe(true);
    for (const grant of ["mensa.reports.view", "magazzino.view", ""])
      expect(
        isNavItemEnabledByAccess(
          transfers,
          (area) => area === "mensa",
          (permission) => permission === grant,
        ),
      ).toBe(false);
    expect(
      isNavItemEnabledByAccess(
        transfers,
        () => false,
        () => true,
      ),
    ).toBe(false);
    expect(
      NAV_ITEMS.find((item) => item.key === "mensaConsumi")?.permission,
    ).toBe("mensa.consumption.manage");
  });

  it("mostra Turni a Sociale o Logistica solo col permesso dedicato", () => {
    const item = NAV_ITEMS.find((candidate) => candidate.key === "turni")!;
    expect(item.area).toEqual(["sociale", "logistica"]);
    expect(
      isNavItemEnabledByAccess(
        item,
        (area) => area === "sociale",
        () => true,
      ),
    ).toBe(true);
    expect(
      isNavItemEnabledByAccess(
        item,
        () => false,
        () => true,
      ),
    ).toBe(false);
    expect(
      isNavItemEnabledByAccess(
        item,
        () => true,
        () => false,
      ),
    ).toBe(false);
  });
});
