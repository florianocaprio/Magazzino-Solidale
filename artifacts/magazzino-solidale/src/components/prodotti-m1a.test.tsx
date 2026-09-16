import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  canManageProducts: true,
  generateBarcodePdf: vi.fn(),
  invalidateQueries: vi.fn(),
}));

const prodotto = {
  id: 1,
  codice: "PRD-001",
  nome: "Pasta",
  descrizione: null,
  tipoProdotto: "alimentare",
  unitaMisura: "pz",
  codiceBarre: "8000000000001",
  quantitaFrazionabile: false,
  lottoFisicoObbligatorio: false,
  gestioneScadenza: false,
  fsePlus: false,
  scortaMinima: 0,
  scortaConsigliata: 0,
  abilitatoEmporio: false,
  creditoSolidaleValore: 0,
  quantitaMassimaPerSpesa: null,
  quantitaMassimaMensile: null,
  fornitoreId: null,
  attivo: true,
  note: null,
};

vi.mock("@workspace/api-client-react", () => ({
  useListProdotti: () => ({ data: [prodotto], isLoading: false }),
  useCreateProdotto: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateProdotto: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteProdotto: () => ({ mutate: vi.fn(), isPending: false }),
  useListMagazzini: () => ({ data: [] }),
  useListLotti: () => ({ data: [], isLoading: false }),
  useListFornitori: () => ({ data: [] }),
  useBulkProdotti: () => ({ mutateAsync: vi.fn() }),
  useCreateLotto: () => ({ mutate: vi.fn(), isPending: false }),
  getListProdottiQueryKey: () => ["prodotti"],
  getListGiacenzeQueryKey: () => ["giacenze"],
  getListLottiQueryKey: () => ["lotti"],
  getListMovimentiQueryKey: () => ["movimenti"],
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    hasPermission: () => mocks.canManageProducts,
  }),
}));

vi.mock("@/lib/use-moduli", () => ({
  EMPORIO_DISABLED_MESSAGE: "Emporio disabilitato",
  useModuloFlags: () => ({ emporioAbilitato: false }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/prodotti-barcode-pdf", () => ({
  generateProdottiBarcodePdf: mocks.generateBarcodePdf,
}));

vi.mock("@/components/export-buttons", () => ({
  ExportButtons: () => <button type="button">Esporta</button>,
}));

vi.mock("@/components/bulk-import-dialog", () => ({
  BulkImportDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog">
        Import prodotti
        <button type="button" onClick={() => onOpenChange(false)}>
          Chiudi import
        </button>
      </div>
    ) : null,
  matchByName: vi.fn(),
  parseBoolCell: vi.fn(() => false),
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div role="dialog">
        Scheda prodotto
        <button type="button" onClick={() => onOpenChange(false)}>
          Chiudi prodotto
        </button>
      </div>
    ) : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

const labels: Record<string, string> = {
  "prodotti.title": "Catalogo Prodotti",
  "prodotti.subtitle": "Gestisci prodotti",
  "prodotti.exportBarcodes": "Scarica codici a barre",
  "prodotti.barcodeListTitle": "Catalogo Prodotti — Codici a Barre",
  "prodotti.barcodeTipo": "Tipo",
  "prodotti.barcodeUm": "UM",
  "prodotti.newProduct": "Nuovo Prodotto",
  "bulkImport.button": "Importa",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) =>
      labels[key] ?? (typeof fallback === "string" ? fallback : key),
  }),
}));

import Prodotti from "@/pages/prodotti";

function button(label: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
}

describe("Catalogo prodotti M1A", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.canManageProducts = true;
    mocks.generateBarcodePdf.mockReset();
    mocks.invalidateQueries.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("presenta i codici a barre come download e conserva il generatore PDF", async () => {
    await act(async () => root.render(<Prodotti />));

    const download = button("Scarica codici a barre");
    expect(download).toBeDefined();
    expect(download?.querySelector(".lucide-download")).not.toBeNull();
    expect(download?.querySelector(".lucide-barcode")).toBeNull();
    expect(download?.hasAttribute("aria-expanded")).toBe(false);
    expect(download?.hasAttribute("aria-pressed")).toBe(false);
    expect(download?.hasAttribute("data-state")).toBe(false);

    await act(async () => download?.click());
    expect(mocks.generateBarcodePdf).toHaveBeenCalledTimes(1);
    expect(mocks.generateBarcodePdf).toHaveBeenCalledWith(
      [
        {
          nome: "Pasta",
          tipo: "alimentare",
          um: "pz",
          code: "8000000000001",
        },
      ],
      {
        title: "Catalogo Prodotti — Codici a Barre",
        tipoLabel: "Tipo",
        umLabel: "UM",
      },
    );
  });

  it("espone lo stato aperto di Importa e Nuovo prodotto", async () => {
    await act(async () => root.render(<Prodotti />));

    const importButton = button("Importa");
    const newButton = button("Nuovo Prodotto");
    expect(importButton?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(importButton?.getAttribute("aria-expanded")).toBe("false");
    expect(newButton?.getAttribute("aria-haspopup")).toBe("dialog");
    expect(newButton?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => importButton?.click());
    expect(importButton?.getAttribute("aria-expanded")).toBe("true");
    expect(
      importButton?.classList.contains("aria-[expanded=true]:ring-2"),
    ).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "Import prodotti",
    );
    await act(async () => button("Chiudi import")?.click());
    expect(importButton?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => newButton?.click());
    expect(newButton?.getAttribute("aria-expanded")).toBe("true");
    expect(newButton?.classList.contains("aria-[expanded=true]:ring-2")).toBe(
      true,
    );
    await act(async () => button("Chiudi prodotto")?.click());
    expect(newButton?.getAttribute("aria-expanded")).toBe("false");
  });

  it("mantiene invariati i permessi dei comandi di gestione", async () => {
    mocks.canManageProducts = false;
    await act(async () => root.render(<Prodotti />));

    expect(button("Scarica codici a barre")).toBeDefined();
    expect(button("Importa")).toBeUndefined();
    expect(button("Nuovo Prodotto")).toBeUndefined();
  });
});
