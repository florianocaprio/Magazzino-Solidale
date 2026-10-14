import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Magazzini from "./magazzini";

const state = vi.hoisted(() => ({
  area: null as number | null,
  save: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { areaOperativaId: state.area, centroAscoltoId: null },
  }),
}));
vi.mock("@/lib/use-moduli", () => ({
  useModuloFlags: () => ({ emporioAbilitato: true }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("@workspace/api-client-react", () => ({
  useListMagazzini: () => ({ data: [], isLoading: false }),
  useListCentriAscolto: () => ({ data: [] }),
  useListAreeOperative: () => ({ data: [{ id: 4, nome: "Test Area" }] }),
  useCreateMagazzino: () => ({ mutate: state.save, isPending: false }),
  useUpdateMagazzino: () => ({ mutate: state.save, isPending: false }),
  useDeleteMagazzino: () => ({ mutate: vi.fn() }),
  getListMagazziniQueryKey: () => ["warehouses"],
}));
// Native test adapter only for the Radix select. The page, form, resolver,
// submit handler and area validation are the real implementation.
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: any) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onValueChange(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => (
    <option value={value}>{children}</option>
  ),
}));
let root: Root;
let host: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
});
async function open(area: number | null) {
  state.area = area;
  state.save.mockClear();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Magazzini />));
  const create = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("magazzini.newWarehouse"),
  );
  expect(create).toBeTruthy();
  await act(async () => create!.click());
  const form = document.querySelector("form")!;
  const name = form.querySelector<HTMLInputElement>('input[name="nome"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name, "Test Warehouse");
    name.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return form;
}
it.each(["logistico", "mensa", "emporio", "misto"])(
  "UI blocks %s without Area and shows the contextual error",
  async (tipo) => {
    const form = await open(null);
    const select = [...form.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "mensa"),
    )!;
    await act(async () => {
      select.value = tipo;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(state.save).not.toHaveBeenCalled();
    expect(form.textContent).toContain("magazzini.areaRequired");
  },
);
it("UI preserves the caller's fixed Area and allows a shared Centre", async () => {
  const form = await open(4);
  await act(async () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  expect(state.save).toHaveBeenCalledTimes(1);
  expect(state.save.mock.calls[0][0].data).toMatchObject({
    areaOperativaId: 4,
    centroAscoltoId: null,
  });
});
