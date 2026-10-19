import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  user: { isAdmin: true, areaOperativaId: null as number | null, aree: ["sociale"] },
  manage: true, params: [] as Array<Record<string, unknown>>, items: [] as Array<Record<string, unknown>>,
}));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListAreeOperative: () => ({ data: [{ id: 1, nome: "Roma", attivo: true }, { id: 2, nome: "Milano", attivo: true }] }),
  useListEntiDestinatari: (params: Record<string, unknown>) => { state.params.push(params); return { data: state.items }; },
  useCreateEnteDestinatario: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateEnteDestinatario: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: state.user, hasPermission: () => state.manage }) }));
vi.mock("@tanstack/react-query", async (original) => ({ ...await original<typeof import("@tanstack/react-query")>(), useQueryClient: () => ({ invalidateQueries: vi.fn().mockResolvedValue(undefined) }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void }) => <select value={value} onChange={(e) => onValueChange(e.target.value)}><option value="" />{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => <option value={value}>{children}</option>,
}));
import EntiEsterni from "./enti-esterni";
let host: HTMLDivElement, root: Root;
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.user = { isAdmin: true, areaOperativaId: null, aree: ["sociale"] }; state.manage = true; state.params = []; state.items = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("cambia filtro Area/globali azzerando la pagina e inviando il contesto al server", async () => {
  state.items = Array.from({ length: 50 }, (_, id) => ({ id, denominazione: "Ente", indirizzo: "Via", areaOperativaId: 1, attivo: true }));
  await act(async () => root.render(<EntiEsterni />));
  await click("entiEsterni.next");
  expect(state.params.at(-1)?.offset).toBe(50);
  await act(async () => { const select = document.querySelector("select")!; select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(state.params.at(-1)).toMatchObject({ offset: 0, areaOperativaId: 1 });
  await click("entiEsterni.next");
  expect(state.params.at(-1)?.offset).toBe(50);
  await click("entiEsterni.onlyGlobal");
  expect(state.params.at(-1)).toMatchObject({ offset: 0, ambito: "globali" });
  expect(state.params.at(-1)).not.toHaveProperty("areaOperativaId");
});
it("Area prima dell’anagrafica e opzione globale soltanto per amministrazione globale", async () => {
  await act(async () => root.render(<EntiEsterni />)); await click("entiEsterni.new");
  const form = document.querySelector("form")!;
  expect(form.querySelector("select")!.textContent).toContain("entiEsterni.global");
  expect(form.firstElementChild?.textContent).toBe("entiEsterni.area");
});
it("l’amministratore di Area vede i globali ma gestisce soltanto i territoriali della propria Area", async () => {
  state.user.areaOperativaId = 1;
  state.items = [{ id: 1, denominazione: "Globale", indirizzo: "Via", areaOperativaId: null }, { id: 2, denominazione: "Locale", indirizzo: "Via", areaOperativaId: 1 }];
  await act(async () => root.render(<EntiEsterni />));
  expect(state.params.at(-1)?.areaOperativaId).toBe(1);
  expect(host.textContent).toContain("Globale");
  expect([...host.querySelectorAll("button")].filter((b) => b.textContent === "entiEsterni.edit")).toHaveLength(1);
  expect(host.querySelector("select")!.textContent).not.toContain("Milano");
  await click("entiEsterni.new");
  expect(document.querySelector("form")!.querySelector("select")).toBeNull();
  expect(document.querySelector("form")!.textContent).toContain("Roma");
});
