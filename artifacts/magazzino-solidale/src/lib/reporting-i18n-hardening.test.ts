import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { reporting } from "./i18n/namespaces/reporting";

function leafKeys(value: unknown, prefix = ""): string[] {
  if (value == null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, child]) => leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("Reporting 2.0 FSE+ i18n hardening", () => {
  it("mantiene le stesse chiavi FSE in tutte le sei lingue", () => {
    const expected = leafKeys(reporting.it.fse).sort();
    for (const locale of ["es", "en", "fr", "de", "ar"] as const) {
      expect(leafKeys(reporting[locale].fse).sort()).toEqual(expected);
    }
  });

  it("usa testi non italiani in inglese e renderizza l'arabo senza fallback", () => {
    expect(reporting.en.fse.referenceDate).toBe("FSE+ import reference date");
    expect(reporting.en.fse.referenceDate).not.toBe(
      reporting.it.fse.referenceDate,
    );
    expect(reporting.ar.fse.referenceDate).toMatch(/[\u0600-\u06ff]/);
    const html = renderToStaticMarkup(
      createElement(
        "div",
        { dir: "rtl", "aria-label": reporting.ar.fse.referenceDate },
        createElement(
          "label",
          { htmlFor: "fse-arabic" },
          reporting.ar.fse.dossierReferenceDate,
        ),
        createElement("input", { id: "fse-arabic", type: "date" }),
      ),
    );
    expect(html).toContain('dir="rtl"');
    expect(html).toContain(reporting.ar.fse.dossierReferenceDate);
    expect(html).not.toContain("reporting.fse");
  });
});
