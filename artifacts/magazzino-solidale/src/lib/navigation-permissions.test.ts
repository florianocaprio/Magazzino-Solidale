import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { isNavItemEnabledByAccess, NAV_ITEMS } from "@/components/layout";

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
    expect(
      NAV_ITEMS.find((item) => item.key === "mensaTrasferimenti")?.permission,
    ).toBe("mensa.transfers.request");
    expect(
      NAV_ITEMS.find((item) => item.key === "mensaConsumi")?.permission,
    ).toBe("mensa.consumption.manage");
  });
});
