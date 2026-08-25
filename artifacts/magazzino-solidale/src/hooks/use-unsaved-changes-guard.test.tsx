import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useState } from "react";
import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

function Harness() {
  const [open, setOpen] = useState(true);
  const [value, setValue] = useState("");
  const guard = useUnsavedChangesGuard(value.length > 0);
  if (!open) return <p data-testid="closed">closed</p>;
  return (
    <div>
      <input
        aria-label="contenuto"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button onClick={() => guard.requestClose(() => setOpen(false))}>
        close
      </button>
      <button onClick={guard.cancelDiscard}>stay</button>
      <button onClick={guard.confirmDiscard}>discard</button>
      <button
        onClick={() => {
          setValue("");
          setOpen(false);
        }}
      >
        save
      </button>
      <output data-testid="confirmation">
        {guard.dialogOpen ? "open" : "closed"}
      </output>
    </div>
  );
}

describe("useUnsavedChangesGuard", () => {
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
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });

  const render = async () => {
    await act(async () => root.render(<Harness />));
  };

  const click = async (label: string) => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (item) => item.textContent === label,
    );
    await act(async () => button?.click());
  };

  const type = async (value: string) => {
    const input = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  };

  it("chiude subito un form pulito", async () => {
    await render();
    await click("close");
    expect(container.querySelector('[data-testid="closed"]')).not.toBeNull();
  });

  it("chiede conferma senza perdere i dati e annulla la chiusura", async () => {
    await render();
    await type("nota operativa");
    await click("close");
    expect(
      container.querySelector('[data-testid="confirmation"]')?.textContent,
    ).toBe("open");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "nota operativa",
    );
    await click("stay");
    expect(
      container.querySelector('[data-testid="confirmation"]')?.textContent,
    ).toBe("closed");
    expect(container.querySelector<HTMLInputElement>("input")?.value).toBe(
      "nota operativa",
    );
  });

  it("scarta le modifiche solo dopo conferma", async () => {
    await render();
    await type("da scartare");
    await click("close");
    await click("discard");
    expect(container.querySelector('[data-testid="closed"]')).not.toBeNull();
  });

  it("il salvataggio chiude senza conferma e rimuove beforeunload", async () => {
    await render();
    await type("da salvare");
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);

    await click("save");
    const savedEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(savedEvent);
    expect(savedEvent.defaultPrevented).toBe(false);
    expect(container.querySelector('[data-testid="closed"]')).not.toBeNull();
  });
});
