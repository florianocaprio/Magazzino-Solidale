import { describe, expect, it } from "vitest";
import { isNavItemEnabledByAccess, NAV_ITEMS } from "@/components/layout";

describe("permission gate della navigazione operativa", () => {
  it.each([
    ["beneficiari", "beneficiari.view"],
    ["udsAnagrafica", "beneficiari.view"],
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
