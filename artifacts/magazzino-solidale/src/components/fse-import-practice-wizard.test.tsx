/* @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caricoPratiche } from "@/lib/i18n/namespaces/caricoPratiche";

const wizardSource = readFileSync(
  new URL("./fse-import-practice-wizard.tsx", import.meta.url),
  "utf8",
);
const pageSource = readFileSync(
  new URL("../pages/carico-merce.tsx", import.meta.url),
  "utf8",
);

describe("M3B — ingresso UI Importa file FSE+", () => {
  it("riusa la pratica M3A e mantiene upload e aggiunta separati dalla registrazione stock", () => {
    expect(pageSource).toContain("FseImportPracticeWizard");
    expect(pageSource).toContain('t("caricoPratiche.fseImport")');
    expect(pageSource).toContain("canOpenFseImport");
    expect(pageSource).toContain('origineCarico === "AGEA_SIFEAD"');
    expect(pageSource).toContain("fseExternalDocument");
    expect(wizardSource).toContain("analyzeFsePracticeImport");
    expect(wizardSource).toContain("useAddFseImportToPractice");
    expect(wizardSource).toContain("versionePratica: practice.versione");
    expect(wizardSource).toContain("{step > 0 && (");
    expect(wizardSource).not.toContain("step > 0 && step < 2");
    expect(wizardSource).toContain('detail?.stato === "IN_PRATICA"');
    expect(wizardSource).not.toContain("useRegistraCaricoPratica");
    expect(wizardSource).not.toContain("useCreateCaricoMagazzino");
  });

  it("protegge creazione prodotto e saldo iniziale con i permessi dedicati", () => {
    expect(wizardSource).toContain(
      'hasPermission("magazzino.products.manage")',
    );
    expect(wizardSource).toContain('hasPermission("magazzino.agea.bootstrap")');
    expect(wizardSource).toContain(
      'hasPermission("magazzino.agea.mapping.manage")',
    );
  });

  it("espone etichette localizzate nelle sei lingue supportate", () => {
    const translations = Object.values(caricoPratiche);
    expect(translations).toHaveLength(6);
    for (const translation of translations) {
      expect(translation.fseImport).toBeTruthy();
      expect(translation.fseNoStockChange).toBeTruthy();
      expect(translation.fseAddToPractice).toBeTruthy();
      expect(translation.fseExternalDocument).toBeTruthy();
    }
  });
});
