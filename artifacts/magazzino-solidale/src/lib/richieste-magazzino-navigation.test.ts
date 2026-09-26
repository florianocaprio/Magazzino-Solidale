import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  isNavItemEnabledByAccess,
  isNavItemEnabledByModules,
} from "@/components/layout";
import { richiesteMagazzino } from "@/lib/i18n/namespaces/richiesteMagazzino";
import { MODULO_BY_ROUTE } from "@/lib/use-moduli";

describe("M5A — unica coda e ingresso autorizzato", () => {
  const item = NAV_ITEMS.find(
    (candidate) => candidate.key === "richiesteMagazzino",
  )!;

  it("ha un solo ingresso per Centro e Magazzino, senza BOLLE/CONSEGNE", () => {
    expect(
      NAV_ITEMS.filter((candidate) => candidate.url === "/richieste-magazzino"),
    ).toHaveLength(1);
    expect(item.area).toEqual(["sociale", "magazzino"]);
    expect(item.moduloCodice).toBe("MAGAZZINO_SOLIDALE");
    expect(MODULO_BY_ROUTE["/richieste-magazzino"]).toBe("MAGAZZINO_SOLIDALE");
    expect(item.moduloCodiciAll).toBeUndefined();
  });

  it("nega utenti senza area/grant/modulo", () => {
    const access = (areas: string[], permissions: string[]) =>
      isNavItemEnabledByAccess(
        item,
        (area) => areas.includes(area),
        (permission) => permissions.includes(permission),
      );
    expect(access(["sociale"], ["richieste_magazzino.view"])).toBe(true);
    expect(access(["magazzino"], ["richieste_magazzino.view"])).toBe(true);
    expect(access(["uds"], ["richieste_magazzino.view"])).toBe(false);
    expect(access(["sociale"], ["bolle.view"])).toBe(false);
    expect(
      isNavItemEnabledByModules(
        item,
        (module) => module === "MAGAZZINO_SOLIDALE",
      ),
    ).toBe(true);
    expect(isNavItemEnabledByModules(item, () => false)).toBe(false);
  });

  it("contiene le etichette operative in tutte le lingue abilitate", () => {
    for (const locale of ["it", "en", "es", "fr", "de", "ar"] as const) {
      const labels = richiesteMagazzino[locale];
      for (const key of [
        "title",
        "new",
        "send",
        "sent",
        "take",
        "cancelReason",
        "notesVisible",
      ] as const) {
        expect(labels[key].trim().length).toBeGreaterThan(0);
      }
    }
  });
});
