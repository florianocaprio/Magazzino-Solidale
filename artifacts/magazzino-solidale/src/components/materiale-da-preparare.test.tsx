import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialeDaPreparare } from "@workspace/api-client-react";
import { MaterialeDaPreparareView } from "./materiale-da-preparare";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

const data: MaterialeDaPreparare = {
  da: "2026-08-14",
  a: "2026-08-20",
  fusoOrario: "Europe/Rome",
  gruppi: [
    {
      chiave: "catalogo:1:pacco:2",
      prodottoId: 1,
      descrizione: "Pacco alimentare",
      unitaMisura: "pacco",
      magazzinoId: 2,
      magazzinoNome: "Magazzino Roma",
      quantitaTotale: 6,
      quantitaPronta: 2,
      quantitaDaPreparare: 4,
      numeroInterventi: 2,
      primaScadenza: "2026-08-15T07:00:00Z",
      prioritaPiuAlta: "urgente",
      avviso: "imminente",
      interventi: [
        {
          materialeId: 10,
          interventoId: 20,
          beneficiarioNome: "Rossi Mario",
          beneficiarioCodice: "BEN-20",
          dataOraPianificata: "2026-08-15T07:00:00Z",
          sede: "Centro Roma",
          operatoreNome: "Operatore Test",
          quantitaResidua: 4,
          statoPreparazione: "da_preparare",
          note: null,
          versione: "2026-08-14T10:00:00Z",
          avviso: "imminente",
        },
      ],
    },
  ],
};

describe("MaterialeDaPreparareView", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("mostra aggregazioni, dettaglio, priorità temporale e aggiorna pronto", async () => {
    const onChangeState = vi.fn();
    const onOpenIntervento = vi.fn();
    await act(async () => {
      root.render(
        <MaterialeDaPreparareView
          data={data}
          periodo="7"
          da="2026-08-14"
          a="2026-08-20"
          onPeriodoChange={vi.fn()}
          onDaChange={vi.fn()}
          onAChange={vi.fn()}
          onOpenIntervento={onOpenIntervento}
          onChangeState={onChangeState}
        />,
      );
    });
    expect(document.body.textContent).toContain("Pacco alimentare");
    expect(document.body.textContent).toContain("interventi.alerts.imminente");
    expect(document.body.textContent).toContain("Rossi Mario");
    const ready = Array.from(document.body.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("interventi.preparation.markReady"),
    );
    await act(async () => ready?.click());
    expect(onChangeState).toHaveBeenCalledWith(
      data.gruppi[0].interventi[0],
      "pronto",
    );
    const beneficiary = Array.from(
      document.body.querySelectorAll("button"),
    ).find((button) => button.textContent?.includes("Rossi Mario"));
    await act(async () => beneficiary?.click());
    expect(onOpenIntervento).toHaveBeenCalledWith(20);
  });

  it("resta utilizzabile con viewport mobile senza una tabella desktop separata", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 360,
    });
    await act(async () => {
      root.render(
        <MaterialeDaPreparareView
          data={data}
          periodo="7"
          da="2026-08-14"
          a="2026-08-20"
          onPeriodoChange={vi.fn()}
          onDaChange={vi.fn()}
          onAChange={vi.fn()}
          onOpenIntervento={vi.fn()}
          onChangeState={vi.fn()}
        />,
      );
    });
    expect(
      document.querySelector('[data-testid="materiale-da-preparare"]'),
    ).toBeTruthy();
    expect(document.querySelector("table")).toBeNull();
    expect(document.body.textContent).toContain("Rossi Mario");
  });
});
