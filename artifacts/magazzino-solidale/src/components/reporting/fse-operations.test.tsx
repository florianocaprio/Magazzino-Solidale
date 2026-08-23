import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { fseOperations } from "@/lib/i18n/namespaces/fseOperations";
import { NAV_ITEMS } from "@/components/layout";
import { FseResolutionInputAzione } from "@workspace/api-client-react";
import {
  FSE_OPERATION_TABS,
  RecordList,
  fseExportActionAvailability,
  fseResolutionReady,
} from "./fse-operations";

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

  it("abilita marca/annulla export soltanto nelle transizioni consentite", () => {
    expect(
      fseExportActionAvailability(
        {
          stato: "PRONTA_PER_INSERIMENTO_MANUALE",
          righeBloccanti: 0,
        },
        "SIFEAD-123",
      ),
    ).toEqual({ canMarkEntered: true, canCancel: true });
    expect(
      fseExportActionAvailability(
        { stato: "GENERATA_CON_BLOCCHI", righeBloccanti: 2 },
        "audit",
      ).canMarkEntered,
    ).toBe(false);
    expect(
      fseExportActionAvailability(
        { stato: "INSERITA_MANUALMENTE", righeBloccanti: 0 },
        "audit",
      ).canCancel,
    ).toBe(false);
  });

  it("richiede target reali per ABBINA ma non per ACCETTA_SCOSTAMENTO", () => {
    const base = {
      lineId: 12,
      motivation: "verifica operatore",
      targetMovementId: "",
      targetAgeaRowId: "",
      hasHeader: true,
    };
    expect(
      fseResolutionReady({
        ...base,
        action: FseResolutionInputAzione.ACCETTA_SCOSTAMENTO,
      }),
    ).toBe(true);
    expect(
      fseResolutionReady({ ...base, action: FseResolutionInputAzione.ABBINA }),
    ).toBe(false);
    expect(
      fseResolutionReady({
        ...base,
        action: FseResolutionInputAzione.ABBINA,
        targetMovementId: "31",
        targetAgeaRowId: "44",
      }),
    ).toBe(true);
  });

  it("renderizza paginazione, selezione e due download dello snapshot", async () => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();
    const rows = Array.from({ length: 21 }, (_, index) => ({
      id: index + 1,
      formatCode: "FSE_CANONICAL_AUDIT_XLSX_V1",
      stato: "PRONTA_PER_INSERIMENTO_MANUALE",
      dataDa: "2026-09-01",
      dataA: "2026-09-30",
    }));
    await act(async () =>
      root.render(
        <RecordList rows={rows} downloadExports onSelect={onSelect} />,
      ),
    );
    const selectionButtons = [...container.querySelectorAll("button")].filter(
      (button) => !["‹", "›"].includes(button.textContent?.trim() ?? ""),
    );
    expect(selectionButtons).toHaveLength(20);
    await act(async () =>
      selectionButtons[0].dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      ),
    );
    expect(onSelect).toHaveBeenCalledWith(1);
    const downloads = [...container.querySelectorAll("a")].map((link) =>
      link.getAttribute("href"),
    );
    expect(downloads).toHaveLength(40);
    expect(downloads).toEqual(
      expect.arrayContaining([
        expect.stringContaining("representation=FSE_CANONICAL_AUDIT_XLSX_V1"),
        expect.stringContaining(
          "representation=SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1",
        ),
      ]),
    );
    expect(container.textContent).toContain("1–20 / 21");
    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "›",
    ) as HTMLButtonElement;
    await act(async () => next.click());
    expect(container.textContent).toContain("21–21 / 21");
    expect(container.querySelectorAll("a")).toHaveLength(2);
    await act(async () => root.unmount());
    container.remove();
  });
});
