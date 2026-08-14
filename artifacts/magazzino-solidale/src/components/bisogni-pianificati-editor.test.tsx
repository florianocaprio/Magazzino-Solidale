import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BisogniPianificatiEditor,
  isBisognoScaduto,
  type BisognoPianificatoDraft,
} from "./bisogni-pianificati-editor";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
  }),
}));

function ControlledEditor({ initial }: { initial: BisognoPianificatoDraft[] }) {
  const [value, setValue] = useState(initial);
  return <BisogniPianificatiEditor value={value} onChange={setValue} />;
}

describe("BisogniPianificatiEditor", () => {
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
    vi.clearAllMocks();
  });

  it("permette zero o più elementi e rimuove soltanto quelli non ancora salvati", async () => {
    await act(async () => root.render(<ControlledEditor initial={[]} />));
    expect(
      document.querySelector('[data-testid="bisogni-pianificati-empty"]'),
    ).not.toBeNull();

    const addButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("udsInterventi.addBisognoPianificato"),
    );
    await act(async () => addButton?.click());
    expect(
      document.querySelectorAll('[data-testid="bisogno-pianificato-card"]'),
    ).toHaveLength(1);

    const description = document.querySelector<HTMLTextAreaElement>(
      'textarea[id^="bisogno-descrizione-"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(description, "Richiesta visita medica");
      description?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(description?.value).toBe("Richiesta visita medica");

    const removeButton = document.querySelector<HTMLButtonElement>(
      'button[aria-label="udsInterventi.removeBisognoPianificato"]',
    );
    await act(async () => removeButton?.click());
    expect(
      document.querySelector('[data-testid="bisogni-pianificati-empty"]'),
    ).not.toBeNull();
  });

  it("mantiene nello storico gli elementi conclusi ed evidenzia quelli scaduti anche su viewport mobile", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 390,
    });
    const initial: BisognoPianificatoDraft[] = [
      {
        clientKey: "persisted-overdue",
        id: 10,
        tipo: "azione",
        descrizione: "Contattare il servizio sociale",
        stato: "pianificato",
        dataPrevista: "2000-01-01",
        priorita: "urgente",
        note: "",
      },
      {
        clientKey: "persisted-completed",
        id: 11,
        tipo: "richiesta",
        descrizione: "Kit igiene",
        stato: "completato",
        dataPrevista: "",
        priorita: "normale",
        note: "Consegnato",
        dataCompletamento: "2026-08-14T08:00:00.000Z",
      },
    ];

    await act(async () => root.render(<ControlledEditor initial={initial} />));

    expect(
      document.querySelectorAll('[data-testid="bisogno-pianificato-card"]'),
    ).toHaveLength(2);
    expect(
      document.querySelector('[data-testid="bisogno-scaduto"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      "udsInterventi.bisognoStato.completato",
    );
    expect(
      document.querySelector(
        'button[aria-label="udsInterventi.removeBisognoPianificato"]',
      ),
    ).toBeNull();
    expect(document.querySelector(".sm\\:grid-cols-2")).not.toBeNull();
    expect(isBisognoScaduto(initial[0], "2026-08-14")).toBe(true);
    expect(isBisognoScaduto(initial[1], "2026-08-14")).toBe(false);
  });
});
