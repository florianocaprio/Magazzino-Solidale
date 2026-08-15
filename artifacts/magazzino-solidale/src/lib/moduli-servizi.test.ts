import { describe, expect, it } from "vitest";
import {
  NAV_ITEMS,
  isNavItemEnabledByModules,
} from "@/components/layout";
import {
  MODULO_BY_ROUTE,
  areAllModuliAttivi,
  isAnyModuloAttivo,
} from "@/lib/use-moduli";

const SERVICE_CODES = [
  "MAGAZZINO_SOLIDALE",
  "CENTRO_ASCOLTO",
  "EMPORIO_SOLIDALE",
  "MENSA",
  "UDS",
] as const;

function enabledKeys(activeCodes: readonly string[]) {
  const active = new Set(activeCodes);
  return NAV_ITEMS.filter((item) =>
    isNavItemEnabledByModules(item, (codice) =>
      codice == null ? true : active.has(codice),
    ),
  ).map((item) => item.key);
}

describe("moduli-servizio e navigazione", () => {
  it("nasconde l'intero gruppo Centro di Ascolto senza intaccare Mensa, Emporio e UDS", () => {
    const keys = enabledKeys([
      "MAGAZZINO_SOLIDALE",
      "EMPORIO_SOLIDALE",
      "CREDITO_SOLIDALE",
      "MENSA",
      "UDS",
      "CONSEGNE",
      "BOLLE",
      "REPORT",
      "SCARICHI",
    ]);

    const centerKeys = NAV_ITEMS.filter((item) => item.groupKey === "sociale").map(
      (item) => item.key,
    );
    expect(keys).not.toEqual(expect.arrayContaining(centerKeys));
    expect(keys).toContain("mensaPostazione");
    expect(keys).toContain("emporioCassa");
    expect(keys).toContain("udsAnagrafica");
  });

  it("mantiene disponibili le capability inventariali condivise quando Magazzino Solidale è spento", () => {
    const keys = enabledKeys(["EMPORIO_SOLIDALE", "MENSA", "UDS"]);

    expect(keys).toContain("prodotti");
    expect(keys).toContain("giacenze");
    expect(keys).not.toContain("preparazioneConsegne");
    expect(keys).toContain("mensaPostazione");
    expect(keys).toContain("emporioCassa");
  });

  it.each([
    ["EMPORIO_SOLIDALE", "emporio"],
    ["MENSA", "mensa"],
    ["UDS", "uds"],
  ])("nasconde l'intero gruppo %s quando il servizio è spento", (disabled, groupKey) => {
    const active = new Set([
      ...SERVICE_CODES,
      "CREDITO_SOLIDALE",
      "REPORT",
    ]);
    active.delete(disabled);
    const keys = enabledKeys([...active]);
    const groupKeys = NAV_ITEMS.filter(
      (item) => item.groupKey === groupKey,
    ).map((item) => item.key);

    expect(keys).not.toEqual(expect.arrayContaining(groupKeys));
  });

  it("posiziona Scarichi Manuali nel Magazzino subito dopo Bolle di Consegna", () => {
    const warehouseKeys = NAV_ITEMS.filter(
      (item) => item.groupKey === "magazzino",
    ).map((item) => item.key);
    const bolleIndex = warehouseKeys.indexOf("bolle");

    expect(bolleIndex).toBeGreaterThanOrEqual(0);
    expect(warehouseKeys[bolleIndex + 1]).toBe("scarichi");
    expect(NAV_ITEMS.find((item) => item.key === "scarichi")).toMatchObject({
      area: "magazzino",
      moduloCodice: "SCARICHI",
    });
  });

  it("nasconde Scarichi Manuali quando SCARICHI è spento", () => {
    const activeWithoutScarichi = SERVICE_CODES.filter(Boolean);
    expect(enabledKeys(activeWithoutScarichi)).not.toContain("scarichi");
  });

  it("richiede Centro di Ascolto per Report Centro senza vincolare Report UDS", () => {
    const reportCentro = NAV_ITEMS.find((item) => item.key === "report");
    const reportUds = NAV_ITEMS.find((item) => item.key === "reportUds");

    expect(reportCentro?.moduloCodiciAll).toEqual(["CENTRO_ASCOLTO", "REPORT"]);
    expect(reportUds?.moduloCodiciAll).toEqual(["REPORT", "UDS"]);
    expect(enabledKeys(["REPORT", "UDS"])).not.toContain("report");
    expect(enabledKeys(["REPORT", "UDS"])).toContain("reportUds");
  });

  it("mappa le route dirette ai moduli corretti", () => {
    expect(MODULO_BY_ROUTE["/beneficiari"]).toBe("CENTRO_ASCOLTO");
    expect(MODULO_BY_ROUTE["/interventi"]).toBe("CENTRO_ASCOLTO");
    expect(MODULO_BY_ROUTE["/scarichi"]).toBe("SCARICHI");
    expect(MODULO_BY_ROUTE["/preparazione-consegne"]).toBe(
      "MAGAZZINO_SOLIDALE",
    );
  });

  it("supporta prerequisiti tutti/uno senza trasformare capability condivise in dipendenze rigide", () => {
    const active = new Set(["CENTRO_ASCOLTO", "UDS"]);
    const check = (codice: string) => active.has(codice);

    expect(areAllModuliAttivi(["CENTRO_ASCOLTO", "UDS"], check)).toBe(true);
    expect(areAllModuliAttivi(["CENTRO_ASCOLTO", "MENSA"], check)).toBe(false);
    expect(isAnyModuloAttivo(["CENTRO_ASCOLTO", "MENSA"], check)).toBe(true);
  });
});
