import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "./dialog";

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
});

it("limita l'altezza alla viewport dinamica e mantiene lo scroll fino al Salva", async () => {
  let submitted = 0;
  await act(() =>
    root.render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Modulo lungo</DialogTitle>
          <DialogDescription>
            Campi e pulsanti nello stesso scroll.
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              submitted++;
            }}
          >
            <div style={{ height: 1000 }}>Campi del modulo</div>
            <DialogFooter>
              <button type="submit">Salva</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    ),
  );
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.classList.contains("max-h-[calc(100dvh-2rem)]")).toBe(true);
  expect(dialog.classList.contains("overflow-y-auto")).toBe(true);
  expect(dialog.classList.contains("overscroll-contain")).toBe(true);
  const save = dialog.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )!;
  await act(() => save.click());
  expect(submitted).toBe(1);
});
