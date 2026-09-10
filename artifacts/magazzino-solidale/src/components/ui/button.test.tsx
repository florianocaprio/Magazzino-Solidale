import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button interaction contract", () => {
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
  });

  it("espone feedback comune di pressione senza ridurre il target touch", async () => {
    const variants = [
      "default",
      "outline",
      "secondary",
      "destructive",
      "ghost",
      "link",
    ] as const;
    await act(async () =>
      root.render(
        <>
          {variants.map((variant) => (
            <Button key={variant} variant={variant}>
              {variant}
            </Button>
          ))}
        </>,
      ),
    );

    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons).toHaveLength(variants.length);
    for (const button of buttons) {
      expect(button.classList.contains("min-h-11")).toBe(true);
      expect(button.classList.contains("active:translate-y-0.5")).toBe(true);
      expect(button.classList.contains("active:scale-[0.98]")).toBe(true);
      expect(button.classList.contains("active:shadow-inner")).toBe(true);
      expect(button.classList.contains("focus-visible:ring-1")).toBe(true);
    }
  });

  it("non rende persistente lo stato di una normale azione", async () => {
    const onClick = vi.fn();
    await act(async () =>
      root.render(<Button onClick={onClick}>Scarica</Button>),
    );

    const button = container.querySelector("button");
    await act(async () => button?.click());
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button?.hasAttribute("data-state")).toBe(false);
    expect(button?.hasAttribute("aria-expanded")).toBe(false);
    expect(button?.hasAttribute("aria-pressed")).toBe(false);
    expect(button?.hasAttribute("aria-selected")).toBe(false);
  });

  it("rende persistenti gli stati aperto, espanso, premuto e selezionato", async () => {
    await act(async () =>
      root.render(
        <Button data-state="open" aria-expanded aria-pressed aria-selected>
          Apri
        </Button>,
      ),
    );

    const button = container.querySelector("button");
    expect(button?.dataset.state).toBe("open");
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(button?.getAttribute("aria-selected")).toBe("true");
    expect(button?.classList.contains("data-[state=open]:ring-2")).toBe(true);
    expect(button?.classList.contains("data-[state=on]:ring-2")).toBe(true);
    expect(button?.classList.contains("aria-[expanded=true]:ring-2")).toBe(
      true,
    );
    expect(button?.classList.contains("aria-[pressed=true]:ring-2")).toBe(true);
    expect(button?.classList.contains("aria-[selected=true]:ring-2")).toBe(
      true,
    );
  });

  it("mantiene disabled nativo e impedisce l'azione", async () => {
    const onClick = vi.fn();
    await act(async () =>
      root.render(
        <Button disabled onClick={onClick}>
          Salva
        </Button>,
      ),
    );

    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    expect(button?.classList.contains("disabled:pointer-events-none")).toBe(
      true,
    );
    await act(async () => button?.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it("propaga il contratto di interazione con asChild", async () => {
    await act(async () =>
      root.render(
        <Button asChild>
          <a href="/destinazione">Apri collegamento</a>
        </Button>,
      ),
    );

    const link = container.querySelector("a");
    expect(link?.getAttribute("href")).toBe("/destinazione");
    expect(link?.classList.contains("active:translate-y-0.5")).toBe(true);
  });
});
