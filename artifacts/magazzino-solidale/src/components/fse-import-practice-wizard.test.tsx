/* @vitest-environment node */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { caricoPratiche } from "@/lib/i18n/namespaces/caricoPratiche";
import {
  reconcileFseReadySelection,
  resolveFseAttachIntent,
  retainFseAttachIntentAfterError,
} from "@/lib/fse-import-attach-intent";

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
    expect(wizardSource).toContain("practiceVersion: practice.versione");
    expect(wizardSource).toContain("{step > 0 && (");
    expect(wizardSource).not.toContain("step > 0 && step < 2");
    expect(wizardSource).toContain('"DA_COMPLETARE", "IN_PRATICA"');
    expect(wizardSource).not.toContain("useRegistraCaricoPratica");
    expect(wizardSource).not.toContain("useCreateCaricoMagazzino");
  });

  it("riusa key e payload canonico soltanto per la stessa intenzione incerta", () => {
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;
    const first = resolveFseAttachIntent(
      null,
      {
        sessionId: 10,
        practiceId: 20,
        mode: "NUOVI_CARICHI",
        sessionVersion: 3,
        practiceVersion: 7,
        rowIds: [9, 4, 9],
        historicalCoverageConfirmed: false,
      },
      createKey,
    );
    const retryAfterRefetch = resolveFseAttachIntent(
      first,
      {
        sessionId: 10,
        practiceId: 20,
        mode: "NUOVI_CARICHI",
        sessionVersion: 4,
        practiceVersion: 8,
        rowIds: [4, 9],
        historicalCoverageConfirmed: false,
      },
      createKey,
    );
    expect(retryAfterRefetch).toBe(first);
    expect(retryAfterRefetch.payload).toEqual({
      versione: 3,
      versionePratica: 7,
      rigaIds: [4, 9],
      idempotencyKey: "key-1",
      confermaCoperturaStorica: false,
    });

    const changedSelection = resolveFseAttachIntent(
      first,
      {
        sessionId: 10,
        practiceId: 20,
        mode: "NUOVI_CARICHI",
        sessionVersion: 4,
        practiceVersion: 8,
        rowIds: [4],
        historicalCoverageConfirmed: false,
      },
      createKey,
    );
    const changedPractice = resolveFseAttachIntent(
      first,
      {
        sessionId: 10,
        practiceId: 21,
        mode: "NUOVI_CARICHI",
        sessionVersion: 4,
        practiceVersion: 1,
        rowIds: [4, 9],
        historicalCoverageConfirmed: false,
      },
      createKey,
    );
    expect(changedSelection.payload.idempotencyKey).toBe("key-2");
    expect(changedPractice.payload.idempotencyKey).toBe("key-3");
    expect(retainFseAttachIntentAfterError({ name: "TypeError" })).toBe(true);
    expect(
      retainFseAttachIntentAfterError({ name: "ResponseParseError" }),
    ).toBe(true);
    expect(retainFseAttachIntentAfterError({ name: "ApiError" })).toBe(false);
  });

  it("preserva la selezione esplicita dopo refetch senza riselezionare nuove righe", () => {
    expect([...reconcileFseReadySelection(new Set(), [1, 2], true)]).toEqual([
      1, 2,
    ]);
    expect([
      ...reconcileFseReadySelection(new Set([1]), [1, 2, 3], false),
    ]).toEqual([1]);
    expect([
      ...reconcileFseReadySelection(new Set([1, 2]), [2, 3], false),
    ]).toEqual([2]);
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
