import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { base } from "./i18n/namespaces/base";
import { areeOperative } from "./i18n/namespaces/areeOperative";

async function beneficiariPageSource(): Promise<string> {
  return readFile(path.resolve(process.cwd(), "src/pages/beneficiari.tsx"), "utf8");
}

describe("i18n Area Operativa nel bulk import Beneficiari", () => {
  it("espone la chiave di navigazione in tutte le lingue", () => {
    for (const locale of Object.values(base)) {
      expect(locale.nav.items.areeOperative).toBeTruthy();
    }
  });

  it("usa esclusivamente la chiave nav.items.areeOperative", async () => {
    const source = await beneficiariPageSource();
    expect(source.match(/t\("nav\.items\.areeOperative"\)/g)).toHaveLength(2);
    expect(source).not.toContain('t("nav.areaOperativa")');
  });

  it("mantiene coerente il concetto Area Operativa nelle sei lingue", () => {
    const keys = [
      "title",
      "newAreaOperativa",
      "noAreaOperativa",
      "editTitle",
      "newTitle",
      "areaOperativaAttiva",
      "deleteTitle",
      "deleteDescription",
      "toastCreated",
      "toastUpdated",
      "toastDeleted",
      "saveError",
    ] as const;
    const terminology = {
      it: /Are[ae] Operativ[ae]/i,
      es: /Área(?:s)? Operativa(?:s)?/i,
      en: /Operational Area(?:s)?/i,
      fr: /zone(?:s)? opérationnelle(?:s)?/i,
      de: /Betriebsbereich/i,
      ar: /تشغيل/,
    } as const;

    for (const [language, pattern] of Object.entries(terminology)) {
      const copy = areeOperative[language as keyof typeof areeOperative];
      for (const key of keys) expect(copy[key]).toMatch(pattern);
    }
    expect(Object.values(areeOperative.fr).join(" ")).not.toMatch(/secteur/i);
    expect(Object.values(areeOperative.de).join(" ")).not.toMatch(/Gebiet/i);
    expect(Object.values(areeOperative.ar).join(" ")).not.toContain("الإقليم");
  });
});
