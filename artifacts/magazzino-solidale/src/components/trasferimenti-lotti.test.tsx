import React, { act, createContext, useContext, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  products: [
    { id: 11, lottoFisicoObbligatorio: false },
    { id: 12, lottoFisicoObbligatorio: true },
  ],
  inventory: [
    {
      prodottoId: 11,
      prodottoNome: "Prodotto A",
      disponibileReale: 20,
      unitaMisura: "pz",
    },
    {
      prodottoId: 12,
      prodottoNome: "Prodotto B",
      disponibileReale: 5,
      unitaMisura: "pz",
    },
  ],
  lots: [
    {
      id: 101,
      prodottoId: 11,
      magazzinoId: 1,
      codiceLotto: "A",
      dataScadenza: "2027-01-01",
      disponibileReale: 8,
      disponibileRealePrecisa: "8",
    },
    {
      id: 102,
      prodottoId: 11,
      magazzinoId: 1,
      codiceLotto: "PRENOTATO",
      dataScadenza: "2027-01-01",
      disponibileReale: 0,
      disponibileRealePrecisa: "0",
    },
    {
      id: 103,
      prodottoId: 11,
      magazzinoId: 1,
      codiceLotto: "SCADUTO",
      dataScadenza: "2020-01-01",
      disponibileReale: 4,
      disponibileRealePrecisa: "4",
    },
    {
      id: 104,
      prodottoId: 11,
      magazzinoId: 2,
      codiceLotto: "ALTRO MAGAZZINO",
      dataScadenza: "2027-01-01",
      disponibileReale: 4,
      disponibileRealePrecisa: "4",
    },
    {
      id: 105,
      prodottoId: 12,
      magazzinoId: 1,
      codiceLotto: "B",
      dataScadenza: "2027-01-01",
      disponibileReale: 5,
      disponibileRealePrecisa: "5",
    },
  ],
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/api-client-react")>()),
  getListGiacenzeQueryKey: () => ["giacenze"],
  getListLottiQueryKey: () => ["lotti"],
  useListGiacenze: () => ({ data: fixtures.inventory }),
  useListLotti: () => ({ data: fixtures.lots }),
  useListProdotti: () => ({ data: fixtures.products }),
}));

const SelectContext = createContext<((value: string) => void) | null>(null);
vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    onValueChange,
  }: {
    children: React.ReactNode;
    onValueChange: (value: string) => void;
  }) => (
    <SelectContext.Provider value={onValueChange}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => {
    const change = useContext(SelectContext);
    return (
      <button type="button" data-option={value} onClick={() => change?.(value)}>
        {children}
      </button>
    );
  },
}));

import { RigheEditor } from "@/pages/trasferimenti";

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function EditorHarness() {
  const [righe, setRighe] = useState([
    { key: "r1", prodottoId: "", lottoId: "", quantita: "", unitaMisura: "pz" },
  ]);
  return (
    <>
      <RigheEditor
        magazzinoId={1}
        areaOperativaId={1}
        righe={righe}
        setRighe={setRighe}
      />
      <output data-testid="draft">{JSON.stringify(righe)}</output>
    </>
  );
}

describe("selettore lotto Trasferimento", () => {
  it("mostra solo partite disponibili del contesto, FEFO facoltativo e resetta il lotto al cambio prodotto", () => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<EditorHarness />));
    const option = (value: string) =>
      host?.querySelector<HTMLButtonElement>(`[data-option="${value}"]`);
    act(() => option("11")?.click());
    expect(option("fefo")).not.toBeNull();
    expect(option("101")?.textContent).toContain("A");
    expect(option("102")).toBeNull();
    expect(option("103")).toBeNull();
    expect(option("104")).toBeNull();
    act(() => option("101")?.click());
    expect(host.querySelector('[data-testid="draft"]')?.textContent).toContain(
      '"lottoId":"101"',
    );
    act(() => option("12")?.click());
    expect(host.querySelector('[data-testid="draft"]')?.textContent).toContain(
      '"lottoId":""',
    );
    expect(option("fefo")).toBeNull();
    expect(option("105")?.textContent).toContain("B");
  });
});
