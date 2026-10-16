import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: [] as any[], columns: [] as any[] }));
vi.mock("@workspace/api-client-react", () => ({
  useListMovimenti: () => ({
    data: state.rows,
    isError: false,
    isLoading: false,
    isFetching: false,
  }),
  getListMovimentiQueryKey: () => ["movimenti"],
  useListCentriAscolto: () => ({ data: [] }),
  listMovimenti: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1 } }) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/export-buttons", () => ({
  ExportButtons: ({ columns }: { columns: any[] }) => {
    state.columns = columns;
    return null;
  },
}));
import Movimenti from "./movimenti";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it.each([
  ["carico", "donazione", 1],
  ["scarico", "consumo", -1],
  ["trasferimento", "entrata", 1],
  ["trasferimento", "uscita", -1],
  ["rientro", "idonea", 1],
  ["rettifica_positiva", "inventario", 1],
  ["rettifica_negativa", "inventario", -1],
  ["storno", "entrata", -1],
  ["storno", "uscita", 1],
  ["esito", "consegna", 0],
  ["storno", "legacy_origine_assente", null],
] as const)(
  "UI/export %s/%s preserve canonical effect %s and exact quantity/date",
  async (type, detail, effect) => {
    const row = {
      id: 1,
      tipoMovimento: type,
      tipoDettaglio: detail,
      effettoFisico: effect,
      dataMovimento: "2026-03-29",
      quantita: 1.123456,
      quantitaPrecisa: "1.123456",
      unitaMisura: "kg",
      prodottoNome: "Fixture",
      magazzinoNome: "Magazzino sintetico",
    };
    state.rows = [row];
    await act(async () => root.render(<Movimenti />));
    expect(host.textContent).toContain("29/03/2026");
    expect(host.textContent).not.toContain("00:00");
    expect(host.textContent).toContain("1.123456");
    expect(
      host.querySelector('[aria-label="movimenti.physicalEffect"]')!
        .textContent,
    ).toBe(effect === 1 ? "+" : effect === -1 ? "-" : effect === 0 ? "0" : "?");
    const value = (header: string) =>
      state.columns
        .find((c) => c.header === `movimenti.${header}`)
        .accessor(row);
    expect(value("colData")).toBe("29/03/2026");
    expect(value("colQuantita")).toBe("1.123456");
    expect(value("physicalEffect")).toBe(
      effect === 0
        ? "0: movimenti.noPhysicalChange"
        : effect == null
          ? "movimenti.unknownPhysicalEffect"
          : effect === 1
            ? "(+)"
            : "(-)",
    );
    if (effect === 0)
      expect(host.textContent).toContain("movimenti.noPhysicalChange");
    if (effect == null)
      expect(host.textContent).toContain("movimenti.unknownPhysicalEffect");
  },
);
