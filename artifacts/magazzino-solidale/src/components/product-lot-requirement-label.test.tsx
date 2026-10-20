import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "uxCaricoLotti.lotRequired" ? "Lotto richiesto" : key,
  }),
}));

import { ProductLotRequirementLabel } from "./product-lot-requirement-label";
import { uxCaricoLotti } from "@/lib/i18n/namespaces/uxCaricoLotti";

describe("LOT-COLOR — evidenza lotto produttore", () => {
  it("mantiene nome e descrizione standard senza badge per il lotto facoltativo", () => {
    const html = renderToStaticMarkup(
      <ProductLotRequirementLabel
        name="Pasta di semola"
        description="Confezione 500g"
        lotRequired={false}
      />,
    );

    expect(html).toContain("Pasta di semola");
    expect(html).toContain("Confezione 500g");
    expect(html).toContain("text-foreground");
    expect(html).toContain("text-muted-foreground");
    expect(html).not.toContain("Lotto richiesto");
    expect(html).not.toContain("text-blue-");
  });

  it("evidenzia nome e descrizione in blu e mostra testo leggibile per il lotto obbligatorio", () => {
    const html = renderToStaticMarkup(
      <ProductLotRequirementLabel
        name="Tonno 80g"
        description="Confezione multipla"
        lotRequired
      />,
    );

    expect(html).toContain("Tonno 80g");
    expect(html).toContain("Confezione multipla");
    expect(html).toContain("Lotto richiesto");
    expect(html.match(/text-blue-700 dark:text-blue-300/g)).toHaveLength(2);
    expect(html).toContain("border-blue-300 bg-blue-50");
    expect(html).toContain("flex-wrap");
  });

  it("traduce badge e legenda in tutte le lingue disponibili", () => {
    for (const language of Object.values(uxCaricoLotti)) {
      expect(language.lotRequired).toBeTruthy();
      expect(language.lotLegend).toBeTruthy();
    }
  });
});

describe("BUG18 — classificazione FSE+ e obbligo lotto indipendenti", () => {
  for (const fsePlus of [false, true])
    for (const lotRequired of [false, true]) {
      it(`FSE+=${fsePlus}, obbligo lotto=${lotRequired}`, () => {
        const element = document.createElement("div");
        element.innerHTML = renderToStaticMarkup(
          <ProductLotRequirementLabel
            name="Campione"
            lotRequired={lotRequired}
            fsePlus={fsePlus}
          />,
        );
        expect(element.textContent?.includes("FSE+")).toBe(fsePlus);
        expect(element.textContent?.includes("Lotto richiesto")).toBe(
          lotRequired,
        );
        expect(element.querySelector(".bg-purple-50") != null).toBe(fsePlus);
      });
    }
});
