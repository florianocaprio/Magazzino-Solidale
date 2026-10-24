import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ compare: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  compareFseWarehouseStock: api.compare,
  getListFseImportSourcesQueryKey: () => ["sources"],
  useListFseImportSources: () => ({
    data: [{ id: 5, areaOperativaId: 1, attiva: 1, descrizione: "FSE Roma" }],
  }),
}));
import { FseStockComparison } from "./fse-stock-comparison";

let root: Root, host: HTMLDivElement;
beforeEach(() => {
  api.compare
    .mockReset()
    .mockResolvedValue({
      allineato: true,
      righeFile: 11,
      righeCoincidenti: 11,
      differenze: [],
      verificatoAt: "2026-10-24T12:00:00Z",
    });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
  expect(button).toBeTruthy();
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
}
async function selectFile(file: File) {
  const input = document.querySelector(
    'input[aria-label="File Giacenze FSE+"]',
  )!;
  Object.defineProperty(input, "files", { configurable: true, value: [file] });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
}
it("invia solo Giacenze, mostra l’esito verde e lo rimuove quando cambia il file", async () => {
  await act(async () =>
    root.render(<FseStockComparison warehouseId={7} areaId={1} />),
  );
  await click("Verifica giacenze FSE+");
  expect(
    (document.getElementById("fse-comparison-registry") as HTMLInputElement)
      .disabled,
  ).toBe(true);
  const file = new File(["stock"], "Giacenze.xlsx");
  await selectFile(file);
  await click("Confronta giacenze");
  expect(api.compare).toHaveBeenCalledWith(file, {
    magazzinoId: 7,
    sourceRegistryId: 5,
  });
  const status = document.querySelector('[role="status"]')!;
  expect(status.textContent).toContain("Magazzino allineato");
  expect(status.className).toContain("bg-emerald-50");
  expect(status.textContent).toContain("Nessuna quantità modificata");
  await selectFile(new File(["changed"], "AltreGiacenze.xlsx"));
  expect(document.querySelector('[role="status"]')).toBeNull();
});
it("non mostra allineamento in caso di differenze o errore", async () => {
  api.compare.mockResolvedValueOnce({
    allineato: false,
    righeFile: 1,
    righeCoincidenti: 0,
    verificatoAt: "2026-10-24T12:00:00Z",
    differenze: [
      {
        prodotto: "Pasta",
        lotto: "L1",
        fondo: "FSE_PLUS",
        quantitaFile: "10",
        quantitaLocale: "8",
        unita: "pz",
        motivo: "Quantità diversa",
      },
    ],
  });
  await act(async () =>
    root.render(<FseStockComparison warehouseId={7} areaId={1} />),
  );
  await click("Verifica giacenze FSE+");
  await selectFile(new File(["stock"], "Giacenze.xlsx"));
  await click("Confronta giacenze");
  expect(document.querySelector('[role="status"]')?.textContent).toContain(
    "Giacenze da verificare",
  );
  expect(document.body.textContent).toContain("In magazzino: 8 pz");
  api.compare.mockRejectedValueOnce(new Error("File non valido"));
  await click("Confronta giacenze");
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
});
it("richiede un singolo magazzino prima del confronto", async () => {
  await act(async () =>
    root.render(<FseStockComparison warehouseId={null} areaId={1} />),
  );
  expect(host.querySelector("button")?.disabled).toBe(true);
});
