import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InterventoSocialeFormSheet,
  type InterventoSocialeCreateMode,
} from "./intervento-sociale-form-sheet";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe("InterventoSocialeFormSheet", () => {
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

  const renderSheet = async (
    open: boolean,
    mode: InterventoSocialeCreateMode,
    onOpenChange: (open: boolean) => void,
  ) => {
    await act(async () => {
      root.render(
        <InterventoSocialeFormSheet
          open={open}
          mode={mode}
          beneficiari={[
            { id: 10, nome: "Mario", cognome: "Rossi", codice: "BEN-10" },
          ]}
          tipi={[{ id: 1, nome: "colloquio", attivo: true }]}
          operatori={[{ id: 4, nome: "Operatore Test", codice: "OP-4" }]}
          currentOperatorId={4}
          beneficiarySearch=""
          onBeneficiarySearch={vi.fn()}
          onOpenChange={onOpenChange}
          onSubmit={vi.fn()}
        />,
      );
    });
  };

  it("apre senza ciclo React, non chiude involontariamente e ripulisce alla riapertura", async () => {
    const onOpenChange = vi.fn();
    await renderSheet(false, "da_pianificare", onOpenChange);
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await renderSheet(true, "da_pianificare", onOpenChange);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain(
      "interventi.form.titles.da_pianificare",
    );
    expect(onOpenChange).not.toHaveBeenCalled();

    const site = document.querySelector<HTMLInputElement>('input[name="sede"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(site, "Sede modificata");
      site?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(site?.value).toBe("Sede modificata");

    await renderSheet(false, "da_pianificare", onOpenChange);
    await renderSheet(true, "da_pianificare", onOpenChange);
    expect(
      document.querySelector<HTMLInputElement>('input[name="sede"]')?.value,
    ).toBe("");
    expect(onOpenChange).not.toHaveBeenCalled();

    const cancel = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "common.cancel");
    await act(async () => cancel?.click());
    expect(onOpenChange).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("distingue i form da pianificare, pianificato e già effettuato", async () => {
    const onOpenChange = vi.fn();
    await renderSheet(true, "da_pianificare", onOpenChange);
    expect(document.querySelector('input[name="dataPianificata"]')).toBeNull();
    expect(document.querySelector('input[name="dataIntervento"]')).toBeNull();

    await renderSheet(true, "pianificato", onOpenChange);
    expect(
      document.querySelector('input[name="dataPianificata"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('input[name="oraPianificata"]'),
    ).not.toBeNull();

    await renderSheet(true, "gia_effettuato", onOpenChange);
    expect(
      document.querySelector('input[name="dataIntervento"]'),
    ).not.toBeNull();
    expect(document.querySelector('textarea[name="esito"]')).not.toBeNull();
  });

  it("non ripristina i campi se i dati asincroni cambiano mentre il pannello è aperto", async () => {
    const onOpenChange = vi.fn();
    const renderScheduled = async (currentOperatorId?: number) => {
      await act(async () => {
        root.render(
          <InterventoSocialeFormSheet
            open
            mode="pianificato"
            beneficiari={[
              { id: 10, nome: "Mario", cognome: "Rossi", codice: "BEN-10" },
            ]}
            tipi={[{ id: 1, nome: "colloquio", attivo: true }]}
            operatori={[{ id: 4, nome: "Operatore Test", codice: "OP-4" }]}
            currentOperatorId={currentOperatorId}
            beneficiarySearch=""
            onBeneficiarySearch={vi.fn()}
            onOpenChange={onOpenChange}
            onSubmit={vi.fn()}
          />,
        );
      });
    };

    await renderScheduled(undefined);
    const date = document.querySelector<HTMLInputElement>(
      'input[name="dataPianificata"]',
    );
    const description = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="descrizione"]',
    );
    const inputSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const textareaSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      inputSetter?.call(date, "2026-08-15");
      date?.dispatchEvent(new Event("input", { bubbles: true }));
      textareaSetter?.call(description, "Valore inserito dall'operatore");
      description?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await renderScheduled(4);

    expect(date?.value).toBe("2026-08-15");
    expect(description?.value).toBe("Valore inserito dall'operatore");
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("valida beneficiario e data/ora prima di inviare un pianificato", async () => {
    const onSubmit = vi.fn();
    await act(async () => {
      root.render(
        <InterventoSocialeFormSheet
          open
          mode="pianificato"
          beneficiari={[]}
          tipi={[{ id: 1, nome: "colloquio", attivo: true }]}
          operatori={[{ id: 4, nome: "Operatore Test", codice: "OP-4" }]}
          currentOperatorId={4}
          beneficiarySearch=""
          onBeneficiarySearch={vi.fn()}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
        />,
      );
    });
    const date = document.querySelector<HTMLInputElement>(
      'input[name="dataPianificata"]',
    );
    const time = document.querySelector<HTMLInputElement>(
      'input[name="oraPianificata"]',
    );
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(date, "");
      date?.dispatchEvent(new Event("input", { bubbles: true }));
      setter?.call(time, "");
      time?.dispatchEvent(new Event("input", { bubbles: true }));
      document
        .querySelector<HTMLFormElement>("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("common.requiredField");
  });
});
