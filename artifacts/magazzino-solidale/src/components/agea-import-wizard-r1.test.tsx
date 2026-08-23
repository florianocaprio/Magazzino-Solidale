/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const wizardUrl = new URL("./agea-import-wizard.tsx", import.meta.url);

describe("wizard AGEA 2.0B-R1", () => {
  it("espone paginazione, filtri, mapping globale e correzioni versionate", async () => {
    const source = await readFile(wizardUrl, "utf8");
    for (const control of [
      "rowPage",
      "rowPageSize",
      "rowState",
      "rowType",
      "rowFund",
      "rowSearch",
    ])
      expect(source).toContain(control);
    expect(source).toContain("useListAgeaImportazioneDescrizioniDaMappare");
    expect(source).toContain("useUpdateAgeaImportazioneRigaDataCarico");
    expect(source).toContain("useUpdateAgeaImportazioneRigaLotto");
    expect(source).toContain("Motivazione correzione scadenza");
    expect(source).toContain("Crea un prodotto nel flusso Prodotti");
    expect(source).toContain('hasPermission("magazzino.agea.import")');
    expect(source).toContain('hasPermission("magazzino.agea.bootstrap")');
  });

  it("distingue conferma, replay senza carichi e annullamento esplicito", async () => {
    const source = await readFile(wizardUrl, "utf8");
    expect(source).toContain("Importazione già confermata");
    expect(source).toContain("${result.carichi.length} carichi locali creati.");
    expect(source).toContain("window.confirm");
    expect(source).toContain("Annulla importazione");
  });

  it("marca dirty la preview dopo ogni mapping e la ripulisce solo dopo il preflight", async () => {
    const source = await readFile(wizardUrl, "utf8");
    expect(source).toContain("previewDirtyByImport");
    expect(source).toContain("markSelectedPreviewDirty");
    expect(source).toContain("Preview da ricalcolare");
    expect(source).toMatch(
      /selected\.stato !== "PRONTA" \|\|\s+previewDirty \|\|/,
    );
    expect(source).toContain("[result.id]: false");
    expect(source).toContain("maxLength={80}");
  });
});
