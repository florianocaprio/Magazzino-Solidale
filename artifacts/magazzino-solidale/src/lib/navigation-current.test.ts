import { describe, expect, it } from "vitest";
import { currentNavigationItem, navigationPath } from "./navigation-current";

const entries = [
  "/",
  "/report",
  "/report/mensa",
  "/mensa/report",
  "/report/uds",
  "/carico-merce",
  "/bolle",
  "/trasferimenti",
  "/beneficiari",
  "/uds/anagrafica",
  "/ruoli",
  "/ruoli-volontari",
].map((url) => ({ url, key: url, groupKey: `group:${url}` }));
describe("posizione corrente sulle sole voci autorizzate", () => {
  it.each([
    ["/", "/"],
    ["/?vista=1#top", "/"],
    ["/ruoli-volontari", "/ruoli-volontari"],
    ["/beneficiari/42?tab=nucleo#dati", "/beneficiari"],
    ["/carico-merce/?tab=import", "/carico-merce"],
    ["/lotti?magazzino=3", "/carico-merce"],
    ["/report-uds", "/report/uds"],
    ["/report/mensa", "/report/mensa"],
    ["/mensa/report", "/mensa/report"],
    ["/report/mensa/dettaglio", "/report/mensa"],
    ["/bolle/9", "/bolle"],
    ["/trasferimenti", "/trasferimenti"],
  ])("%s identifica %s", (route, expected) => {
    expect(currentNavigationItem(route, entries)?.url).toBe(expected);
  });
  it("fallback documenti e dossier senza introdurre voci nascoste", () => {
    expect(
      currentNavigationItem(
        "/bolle?tipo=trasferimento",
        entries.filter((e) => e.url !== "/bolle"),
      )?.url,
    ).toBe("/trasferimenti");
    expect(
      currentNavigationItem(
        "/beneficiari/42",
        entries.filter((e) => e.url !== "/beneficiari"),
      )?.url,
    ).toBe("/uds/anagrafica");
    expect(currentNavigationItem("/beneficiari/42", [])).toBeUndefined();
    expect(
      currentNavigationItem(
        "/report-uds",
        entries.filter((e) => e.url !== "/report/uds"),
      ),
    ).toBeUndefined();
    expect(
      currentNavigationItem(
        "/lotti",
        entries.filter((e) => e.url !== "/carico-merce"),
      ),
    ).toBeUndefined();
  });
  it.each([
    "/ruoli-volontarix",
    "/ruoli-volontari",
    "/reports",
    "/report/sconosciuto",
    "/altro",
    "/beneficiari/non-id",
  ])("non inventa un contesto per %s", (route) => {
    expect(
      currentNavigationItem(
        route,
        entries.filter(
          (e) => !["/ruoli-volontari", "/beneficiari"].includes(e.url),
        ),
      ),
    ).toBeUndefined();
  });
  it("preferisce la voce più specifica a confine di segmento senza riscrivere URL", () => {
    const route = "/carico-merce/pratiche/9/?area=3#righe";
    const nested = {
      key: "pratiche",
      url: "/carico-merce/pratiche",
      groupKey: "magazzino",
    };
    expect(currentNavigationItem(route, [...entries, nested])).toBe(nested);
    expect(navigationPath(route)).toBe("/carico-merce/pratiche/9");
    expect(route).toBe("/carico-merce/pratiche/9/?area=3#righe");
  });
});
