import { describe, expect, it } from "vitest";
import { fseOperations } from "@/lib/i18n/namespaces/fseOperations";
import { NAV_ITEMS } from "@/components/layout";
import { FSE_OPERATION_TABS } from "./fse-operations";

describe("rendicontazione FSE+ 2.0C", () => {
  it("espone le sei tab e i due wizard richiesti", () => {
    expect(FSE_OPERATION_TABS).toEqual([
      "overview",
      "queue",
      "exports",
      "reconciliations",
      "indicators",
      "anomalies",
    ]);
    expect(fseOperations.it.exportSteps).toContain("6.");
    expect(fseOperations.it.reconciliationSteps).toContain("7.");
  });

  it("mostra i confini SIFEAD in tutte le sei lingue senza chiavi raw", () => {
    expect(Object.keys(fseOperations)).toEqual([
      "it",
      "es",
      "en",
      "fr",
      "de",
      "ar",
    ]);
    for (const locale of Object.values(fseOperations)) {
      expect(locale.noAutomaticTransmission).toMatch(/SIFEAD/);
      expect(locale.observedFormatWarning.length).toBeGreaterThan(20);
      expect(locale.exportSteps).toContain("6.");
      expect(locale.reconciliationSteps).toContain("7.");
      expect(locale.download.length).toBeGreaterThan(2);
      expect(locale.closeWithDifferences.length).toBeGreaterThan(5);
    }
  });

  it("protegge la voce FSE+ con il permesso dedicato", () => {
    expect(
      NAV_ITEMS.find((item) => item.url === "/report/fse-plus")?.permission,
    ).toBe("magazzino.fse.view");
  });
});
