import React, { act, createContext, useContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  ListGiacenzeQueryParams,
  ListGiacenzeResponse,
} from "@workspace/api-zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  areas: [] as Array<Record<string, unknown>>,
  warehouses: [] as Array<Record<string, unknown>>,
  giacenzeCalls: [] as Array<{
    params: Record<string, unknown>;
    enabled: boolean;
    queryKey: readonly unknown[] | undefined;
  }>,
  responseFor: (_params: Record<string, unknown>) =>
    undefined as Array<Record<string, unknown>> | undefined,
  exportProps: undefined as Record<string, unknown> | undefined,
  listProducts: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  getListGiacenzeQueryKey: (params: Record<string, unknown>) => [
    "/api/giacenze",
    params,
  ],
  useListAreeOperative: () => ({ data: mocks.areas, isLoading: false }),
  useListMagazzini: () => ({ data: mocks.warehouses }),
  useListProdotti: mocks.listProducts,
  useListGiacenze: (
    params: Record<string, unknown>,
    options: { query?: { enabled?: boolean; queryKey?: readonly unknown[] } },
  ) => {
    mocks.giacenzeCalls.push({
      params,
      enabled: options.query?.enabled !== false,
      queryKey: options.query?.queryKey,
    });
    return { data: mocks.responseFor(params), isLoading: false };
  },
}));

type SelectState = {
  disabled?: boolean;
  onValueChange: (value: string) => void;
};
const SelectContext = createContext<SelectState | null>(null);

vi.mock("@/components/ui/select", () => ({
  Select: ({
    children,
    disabled,
    onValueChange,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <SelectContext.Provider value={{ disabled, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectTrigger: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    const state = useContext(SelectContext);
    return (
      <button type="button" disabled={state?.disabled} {...props}>
        {children}
      </button>
    );
  },
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
    const state = useContext(SelectContext);
    return (
      <button
        type="button"
        disabled={state?.disabled}
        data-option={value}
        onClick={() => state?.onValueChange(value)}
      >
        {children}
      </button>
    );
  },
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  } & React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
      {...props}
    />
  ),
}));

vi.mock("@/components/export-buttons", () => ({
  ExportButtons: (props: Record<string, unknown>) => {
    mocks.exportProps = props;
    return <button type="button">Esporta</button>;
  },
}));

const labels: Record<string, string> = {
  "giacenze.title": "Giacenze",
  "giacenze.subtitle": "Monitora le quantità disponibili nei magazzini.",
  "giacenze.inventoryFor": "Giacenze — Magazzino {{name}}",
  "giacenze.inventoryArea": "Giacenze — Area Operativa {{name}}",
  "giacenze.areaScopeSubtitle": "Tutti i magazzini accessibili dell'Area.",
  "giacenze.warehouseScopeSubtitle": "Magazzino dell'Area Operativa {{area}}.",
  "giacenze.areaAggregate": "Aggregato Area",
  "giacenze.areaOperativa": "Area Operativa",
  "giacenze.selectArea": "Seleziona Area Operativa",
  "giacenze.selectAreaHelp":
    "Seleziona un'Area Operativa per consultare le giacenze.",
  "giacenze.noActiveAreas": "Nessuna Area Operativa attiva accessibile.",
  "giacenze.noAreaWarehouses":
    "Nessun magazzino attivo accessibile nell'Area selezionata.",
  "giacenze.warehouse": "Magazzino",
  "giacenze.allAreaWarehouses": "Tutti i magazzini dell'Area",
  "giacenze.exportSubtitleSottoscorta": "Solo prodotti sottoscorta",
  "giacenze.exportSubtitleFsePlus": "Solo prodotti FSE+",
  "giacenze.sheetName": "Inventario",
  "giacenze.colCodice": "Codice",
  "giacenze.colProdotto": "Prodotto",
  "giacenze.colMagazzino": "Magazzino",
  "giacenze.colGiacenzaFisica": "Giacenza fisica",
  "giacenze.colImpegnato": "Impegnato",
  "giacenze.colDisponibileReale": "Disponibile reale",
  "giacenze.colUM": "U.M.",
  "giacenze.colScortaMinima": "Scorta minima",
  "giacenze.colProssimaScadenza": "Prossima scadenza",
  "giacenze.colProssimaScad": "Prossima scad.",
  "giacenze.colStato": "Stato",
  "giacenze.sottoscortaOnly": "Solo Sottoscorta",
  "giacenze.fsePlusOnly": "Solo FSE+",
  "giacenze.noResults": "Nessuna giacenza trovata.",
  "giacenze.statusSottoscorta": "Sottoscorta",
  "giacenze.statusRegolare": "Regolare",
};

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, string>) => {
      let translated = labels[key] ?? key;
      for (const [name, value] of Object.entries(values ?? {})) {
        translated = translated.replace(`{{${name}}}`, value);
      }
      return translated;
    },
  }),
}));

import Giacenze from "@/pages/giacenze";

const area = (id: number, nome: string, attivo = true) => ({
  id,
  nome,
  attivo,
  dataCreazione: "2026-01-01T00:00:00.000Z",
});
const warehouse = (
  id: number,
  nome: string,
  areaOperativaId: number | null,
) => ({
  id,
  codice: `M-${id}`,
  nome,
  areaOperativaId,
  tipoMagazzino: "logistico",
  stato: "attivo",
  dataCreazione: "2026-01-01T00:00:00.000Z",
});
const stock = (
  areaOperativaId: number,
  ambito: "area" | "magazzino",
  magazzinoId: number | null,
  prodottoNome: string,
) => ({
  ambito,
  areaOperativaId,
  areaOperativaNome: areaOperativaId === 1 ? "Area A" : "Area B",
  prodottoId: areaOperativaId * 100 + (magazzinoId ?? 0),
  prodottoNome,
  prodottoCodice: `P-${areaOperativaId}`,
  tipoProdotto: "alimentare",
  unitaMisura: "kg",
  magazzinoId,
  magazzinoNome: magazzinoId == null ? null : `Mag ${magazzinoId}`,
  quantitaTotale: 30,
  quantitaTotalePrecisa: "30.000000",
  giacenzaFisica: 30,
  giacenzaScaduta: 0,
  giacenzaDistribuibile: 30,
  giacenzaFisicaPrecisa: "30.000000",
  giacenzaScadutaPrecisa: "0.000000",
  giacenzaDistribuibilePrecisa: "30.000000",
  impegnato: 2,
  impegnatoPreciso: "2.000000",
  disponibileReale: 28,
  disponibileRealePrecisa: "28.000000",
  scortaMinima: ambito === "area" ? null : 5,
  scortaMinimaPrecisa: ambito === "area" ? null : "5.000000",
  scortaConsigliata: ambito === "area" ? null : 10,
  sottoscorta: ambito === "area" ? null : false,
  lottiAttivi: 2,
  prossimaScadenza: "2099-01-01",
});

function option(text: string): HTMLButtonElement {
  const found = Array.from(
    document.querySelectorAll<HTMLButtonElement>("button[data-option]"),
  ).find((button) => button.textContent?.trim() === text);
  expect(found).toBeDefined();
  return found as HTMLButtonElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => element.click());
}

describe("Giacenze M1B — Area Operativa → Magazzino", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.areas = [area(1, "Area A"), area(2, "Area B")];
    mocks.warehouses = [
      warehouse(11, "Mag A1", 1),
      warehouse(12, "Mag A2", 1),
      warehouse(21, "Mag B1", 2),
      warehouse(90, "Legacy", null),
    ];
    mocks.giacenzeCalls = [];
    mocks.exportProps = undefined;
    mocks.listProducts.mockReset();
    mocks.responseFor = (params) => {
      const areaId = Number(params.areaOperativaId);
      if (!areaId) return undefined;
      const magazzinoId = params.magazzinoId
        ? Number(params.magazzinoId)
        : null;
      return [
        stock(
          areaId,
          magazzinoId == null ? "area" : "magazzino",
          magazzinoId,
          areaId === 1 ? "Prodotto Area A" : "Prodotto Area B",
        ),
      ];
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
  });

  it("preseleziona automaticamente l'unica Area attiva accessibile", async () => {
    mocks.areas = [area(1, "Area A"), area(2, "Area inattiva", false)];
    await act(async () => root.render(<Giacenze />));

    expect(document.body.textContent).not.toContain("Area inattiva");
    expect(mocks.giacenzeCalls.at(-1)).toMatchObject({
      params: { areaOperativaId: 1, magazzinoId: undefined },
      enabled: true,
    });
  });

  it("senza Aree attive mostra uno stato vuoto e non abilita Giacenze", async () => {
    mocks.areas = [area(2, "Area inattiva", false)];
    await act(async () => root.render(<Giacenze />));

    expect(document.body.textContent).toContain(
      "Nessuna Area Operativa attiva accessibile.",
    );
    expect(mocks.giacenzeCalls.at(-1)?.enabled).toBe(false);
  });

  it("con più Aree non abilita la query Giacenze prima della scelta", async () => {
    await act(async () => root.render(<Giacenze />));

    expect(mocks.giacenzeCalls.at(-1)).toMatchObject({
      params: { areaOperativaId: 0 },
      enabled: false,
    });
    expect(document.body.textContent).toContain("Seleziona un'Area Operativa");
  });

  it("filtra i Magazzini in base all'Area selezionata", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    expect(option("Mag A1")).toBeDefined();
    expect(option("Mag A2")).toBeDefined();
    expect(document.body.textContent).not.toContain("Mag B1");
    expect(document.body.textContent).not.toContain("Legacy");
  });

  it("Tutti i magazzini dell'Area invia Area senza Magazzino", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 1,
      magazzinoId: undefined,
    });
  });

  it("un Magazzino specifico invia Area e Magazzino", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(option("Mag A1"));

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 1,
      magazzinoId: 11,
    });
  });

  it("il cambio Area resetta il Magazzino", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    const areaAQueryKey = mocks.giacenzeCalls.at(-1)?.queryKey;
    await click(option("Mag A1"));
    await click(option("Area B"));

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 2,
      magazzinoId: undefined,
    });
    expect(mocks.giacenzeCalls.at(-1)?.queryKey).not.toEqual(areaAQueryKey);
    expect(mocks.giacenzeCalls.at(-1)?.queryKey).toEqual([
      "/api/giacenze",
      expect.objectContaining({
        areaOperativaId: 2,
        magazzinoId: undefined,
      }),
    ]);
    expect(document.body.textContent).toContain(
      "Giacenze — Area Operativa Area B",
    );
    expect(mocks.exportProps?.filename).toBe("inventario_area_area_b");
  });

  it("il cambio Area resetta il filtro sottoscorta", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(option("Mag A1"));
    await click(document.querySelector("#sottoscorta") as HTMLInputElement);
    expect(mocks.giacenzeCalls.at(-1)?.params.sottoscortaOnly).toBe(true);
    await click(option("Area B"));

    expect(mocks.giacenzeCalls.at(-1)?.params.sottoscortaOnly).toBeUndefined();
  });

  it("il ritorno a tutti i Magazzini dell'Area resetta il filtro sottoscorta", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(option("Mag A1"));
    await click(document.querySelector("#sottoscorta") as HTMLInputElement);
    await click(option("Tutti i magazzini dell'Area"));

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 1,
      magazzinoId: undefined,
      sottoscortaOnly: undefined,
    });
    expect(
      (document.querySelector("#sottoscorta") as HTMLInputElement).disabled,
    ).toBe(true);
  });

  it("non renderizza una risposta tardiva appartenente all'Area precedente", async () => {
    mocks.responseFor = (params) =>
      Number(params.areaOperativaId) === 0
        ? undefined
        : [stock(1, "area", null, "RISPOSTA TARDIVA AREA A")];
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    expect(document.body.textContent).toContain("RISPOSTA TARDIVA AREA A");
    await click(option("Area B"));

    expect(document.body.textContent).not.toContain("RISPOSTA TARDIVA AREA A");
  });

  it("in modalità Area mostra righe aggregate e soltanto colonne semanticamente valide", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    const header = document.querySelector("thead")?.textContent ?? "";
    expect(document.body.textContent).toContain("Prodotto Area A");
    expect(header).toContain("U.M.");
    expect(header).not.toContain("Scorta minima");
    expect(header).not.toContain("Stato");
  });

  it("in modalità Magazzino conserva colonne Scorta minima e Stato", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(option("Mag A1"));

    const header = document.querySelector("thead")?.textContent ?? "";
    expect(header).toContain("Scorta minima");
    expect(header).toContain("Stato");
  });

  it("l'export Area usa le stesse righe aggregate e un filename territoriale", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    expect(mocks.exportProps?.rows).toEqual([
      stock(1, "area", null, "Prodotto Area A"),
    ]);
    expect(mocks.exportProps?.filename).toBe("inventario_area_area_a");
  });

  it("l'export Magazzino usa il solo deposito e il relativo filename", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(option("Mag A1"));

    expect(mocks.exportProps?.rows).toEqual([
      stock(1, "magazzino", 11, "Prodotto Area A"),
    ]);
    expect(mocks.exportProps?.filename).toBe("inventario_magazzino_mag_a1");
  });

  it("applica FSE+ anche all'aggregato Area", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(document.querySelector("#fseplus") as HTMLInputElement);

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 1,
      magazzinoId: undefined,
      fsePlusOnly: true,
    });
  });

  it("mantiene FSE+ quando si passa al Magazzino della stessa Area", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));
    await click(document.querySelector("#fseplus") as HTMLInputElement);
    await click(option("Mag A1"));

    expect(mocks.giacenzeCalls.at(-1)?.params).toMatchObject({
      areaOperativaId: 1,
      magazzinoId: 11,
      fsePlusOnly: true,
    });
  });

  it("non presenta una scelta globale Tutti i magazzini priva di Area", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    const exactGlobal = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "Tutti i magazzini",
    );
    expect(exactGlobal).toBeUndefined();
    expect(option("Tutti i magazzini dell'Area")).toBeDefined();
  });

  it("mostra uno stato vuoto esplicito per un'Area senza Magazzini", async () => {
    mocks.warehouses = [warehouse(21, "Mag B1", 2)];
    mocks.responseFor = () => [];
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    expect(document.body.textContent).toContain(
      "Nessun magazzino attivo accessibile nell'Area selezionata.",
    );
  });

  it("non interroga né territorializza il Catalogo prodotti", async () => {
    await act(async () => root.render(<Giacenze />));
    await click(option("Area A"));

    expect(mocks.listProducts).not.toHaveBeenCalled();
  });

  it("valida con lo schema Zod generato i DTO Area e Magazzino", () => {
    const parsed = ListGiacenzeResponse.safeParse([
      stock(1, "area", null, "Prodotto Area A"),
      stock(1, "magazzino", 11, "Prodotto Area A"),
    ]);

    expect(parsed.success).toBe(true);
    expect(ListGiacenzeQueryParams.safeParse({}).success).toBe(false);
    expect(
      ListGiacenzeQueryParams.safeParse({ areaOperativaId: 1 }).success,
    ).toBe(true);
  });
});
