import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("Volontari 2.0 — contratti UI", () => {
  it("espone solo le tre azioni operative previste", async () => {
    const [page, operations] = await Promise.all([
      source("../pages/volontari.tsx"),
      source("../components/volontari/volontario-operation-dialog.tsx"),
    ]);
    expect(page).toContain('openOperation(volunteer, "sospendi")');
    expect(page).toContain('openOperation(volunteer, "riattiva")');
    expect(page).toContain('openOperation(volunteer, "assicurazione")');
    expect(operations).toContain("Registra / Rinnova assicurazione");
    expect(page).not.toContain("useDeleteVolontario");
    expect(page).not.toContain("toggleStatus");
  });

  it("mantiene PII fuori dalla lista e dentro la scheda", async () => {
    const [page, dossier] = await Promise.all([
      source("../pages/volontari.tsx"),
      source("../components/volontari/volontario-dossier-sheet.tsx"),
    ]);
    const listStart = page.indexOf('data-testid="volontari-desktop-list"');
    const listEnd = page.indexOf("<Sheet open={formOpen}");
    const list = page.slice(listStart, listEnd);
    expect(list).not.toContain("codiceFiscale");
    expect(list).not.toContain("indirizzoResidenza");
    expect(dossier).toContain('label="Codice fiscale"');
    expect(dossier).toContain('label="Indirizzo di residenza"');
  });

  it("usa layout card sotto 1024px e controlli principali touch-friendly", async () => {
    const page = await source("../pages/volontari.tsx");
    expect(page).toContain('data-testid="volontari-mobile-list"');
    expect(page).toContain('data-testid="volontari-desktop-list"');
    expect(page).toContain("lg:hidden");
    expect(page).toContain("hidden lg:block");
    expect(page).toContain("min-h-11");
  });

  it("implementa import analizza/conferma e rinnovo massivo con preview", async () => {
    const [page, importDialog] = await Promise.all([
      source("../pages/volontari.tsx"),
      source("../components/volontari/volontari-import-dialog.tsx"),
    ]);
    expect(importDialog).toContain("analyzeVolontariImport");
    expect(importDialog).toContain("confirmVolontariImport");
    expect(importDialog).toContain("POSSIBILE_DUPLICATO");
    expect(importDialog).toContain("creaNuovo");
    expect(importDialog).toContain("dataInizioImportata");
    expect(importDialog).toContain("matricolaProposta");
    expect(page).toContain("previewBulkVolontariInsurance");
    expect(page).toContain("confirmBulkVolontariInsurance");
    expect(page).toContain("row.incluso");
  });

  it("mantiene atomica la prima giornata e applica le semplificazioni anagrafiche", async () => {
    const page = await source("../pages/volontari.tsx");
    expect(page).not.toContain("createVolontarioServiceDay");
    expect(page).toContain("dataServizio: draft.dataServizio");
    expect(page).toContain("Il domicilio coincide con la residenza");
    expect(page).toContain("Motivo indisponibilità (facoltativo)");
    expect(page).toContain("domicilioCoincideResidenza");
  });
});
