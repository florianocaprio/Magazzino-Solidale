import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MensaMagazzinoForm } from "./mensa-magazzino-form";

describe("MensaMagazzinoForm", () => {
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

  it("usa i campi del Magazzino, non espone ID città/ubicazione e ripulisce alla riapertura", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn();
    const renderForm = async (open: boolean) => {
      await act(async () => {
        root.render(
          <MensaMagazzinoForm
            open={open}
            onOpenChange={onOpenChange}
            onSubmit={onSubmit}
            lockedAreaId={1}
            areas={[{ id: 1, nome: "Area Roma" }]}
            centri={[{ id: 10, nome: "Centro Roma", cittaId: 1, attivo: true }]}
          />,
        );
      });
    };

    await renderForm(false);
    await renderForm(true);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("Nuova Mensa");
    expect(document.body.textContent).toContain("Centro di Ascolto");
    expect(document.body.textContent).toContain("Area");
    expect(document.body.textContent).toContain("Tipo magazzino");
    expect(document.body.textContent).toContain("Responsabile");
    expect(document.body.textContent).not.toContain("ID città");
    expect(document.body.textContent).not.toContain("Ubicazione logistica");
    expect(
      document.querySelector<HTMLInputElement>("#mensa-codice")?.placeholder,
    ).toBe("Lascia vuoto per generare");

    const nome = document.querySelector<HTMLInputElement>("#mensa-nome")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(nome, "Mensa temporanea");
      nome.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(nome.value).toBe("Mensa temporanea");

    await renderForm(false);
    await renderForm(true);
    expect(document.querySelector<HTMLInputElement>("#mensa-nome")?.value).toBe(
      "",
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
