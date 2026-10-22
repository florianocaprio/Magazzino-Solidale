import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: { areaOperativaId: null as number | null, centroAscoltoId: null as number | null }, volunteers: [] as Array<Record<string, unknown>>, queries: [] as Array<Record<string, unknown>>, turns: [] as Array<Record<string, unknown>>, mutate: vi.fn(), invalidate: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListAreeOperative: () => ({ data: [{ id: 1, nome: "Roma", attivo: true }, { id: 2, nome: "Milano", attivo: true }] }),
  useListCentriAscolto: () => ({ data: [{ id: 10, nome: "Roma A", areaOperativaId: 1, attivo: true }, { id: 11, nome: "Roma B", areaOperativaId: 1, attivo: true }, { id: 20, nome: "Milano A", areaOperativaId: 2, attivo: true }] }),
  useListRuoliVolontari: () => ({ data: [] }),
useListRuoliVolontariOperativi: () => ({ data: [] }),
  useListVolontari: (params: Record<string, unknown>) => { state.queries.push(params); return { data: state.volunteers, isFetching: false, isError: false }; },
useListVolontariOperativi: (params: Record<string, unknown>) => { state.queries.push(params); return { data: state.volunteers, isFetching: false, isError: false }; },
  useListMezzi: () => ({ data: [], isFetching: false, isError: false }),
useListMezziOperativi: () => ({ data: [], isFetching: false, isError: false }),
  useListTurni: () => ({ data: state.turns, isFetching: false, isError: false }),
  useGetVolontariCarico: () => ({ data: [], isFetching: false, isError: false }),
useGetCaricoVolontariOperativo: () => ({ data: [], isFetching: false, isError: false }),
  useUpsertTurno: () => ({ mutate: state.mutate, isPending: false }),
  useCreateTurnoVolontarioPending: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateTurnoMezzoPending: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: state.user, hasPermission: () => true }) }));
vi.mock("@tanstack/react-query", async (original) => ({ ...await original<typeof import("@tanstack/react-query")>(), useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: "it" } }) }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) => <select value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}><option value="" />{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ children, value, disabled }: { children: React.ReactNode; value: string; disabled?: boolean }) => <option value={value} disabled={disabled}>{children}</option>,
}));
vi.mock("@/lib/i18n", () => ({ default: { addResourceBundle: vi.fn() } }));
import Turni from "./turni";
let container: HTMLDivElement, root: Root;
async function choose(index: number, value: string) {
  const select = document.querySelectorAll("select")[index];
  await act(async () => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === label)!;
  expect(button).toBeTruthy(); await act(async () => button.click());
}
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.queries = []; state.turns = []; state.volunteers = []; state.user = { areaOperativaId: null, centroAscoltoId: null };
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-19T12:00:00+02:00"));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<Turni />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
it("richiede Area prima del Centro e carica la disponibilità per Centro e data selezionati", async () => {
  expect(document.querySelectorAll("select")[1].disabled).toBe(true);
  expect(state.queries).toHaveLength(0);
  await choose(0, "1");
  expect(document.querySelectorAll("select")[1].textContent).toContain("Roma B");
  expect(document.querySelectorAll("select")[1].textContent).not.toContain("Milano");
  await choose(1, "10");
  expect(state.queries.some((p) => p.centroAscoltoId === 10 && p.stato === "tutti")).toBe(true);
  await click("turni.emptySlot");
  expect(state.queries.some((p) => p.centroAscoltoId === 10 && p.dataRiferimento === "2026-10-19" && p.stato === "attivi")).toBe(true);
});
it("cambio contesto azzera la bozza e ignora il completamento tardivo del contesto precedente", async () => {
  await choose(0, "1"); await choose(1, "10"); await click("turni.emptySlot"); await click("turni.save");
  const [request, old] = state.mutate.mock.calls[0];
  expect(request.data.centroAscoltoId).toBe(10);
  await click("turni.cancel");
  await choose(0, "2");
  expect(document.querySelectorAll("select")[1].value).toBe("");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await choose(1, "20"); await click("turni.emptySlot");
  await act(async () => old.onSuccess());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect((document.querySelectorAll("select")[2] as HTMLSelectElement).value).toBe("");
  await click("turni.save");
  expect(state.mutate.mock.calls[1][0].data.centroAscoltoId).toBe(20);
});
it("blocca l’Area del profilo ma lascia scegliere i suoi Centri", async () => {
  state.user = { areaOperativaId: 1, centroAscoltoId: null };
  await act(async () => root.render(<Turni />));
  expect(document.querySelectorAll("select")[0].disabled).toBe(true);
  expect(document.querySelectorAll("select")[0].value).toBe("1");
  expect(document.querySelectorAll("select")[1].textContent).toContain("Roma A");
  expect(document.querySelectorAll("select")[1].textContent).not.toContain("Milano");
});

it("mantiene consultabile e annullabile lo storico senza permettere riassegnazioni", async () => {
  state.turns = [{ id: 66, centroAscoltoId: 10, data: "2026-10-11", fascia: "09-13", stato: "pianificato", versione: 3, volontari: [], mezzoId: null }];
  await choose(0, "1"); await choose(1, "10");
  for (let i = 0; i < 2; i++) await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="turni.prevWeek"]')!.click());
  const cell = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("pianificato"))!;
  expect(cell.disabled).toBe(false);
  await act(async () => cell.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector("fieldset")?.disabled).toBe(true);
  expect(dialog.textContent).not.toContain("turni.save");
  await click("logisticaCampaign.cancelShift");
  expect(state.mutate.mock.calls[0][0].data).toMatchObject({ data: "2026-10-11", versione: 3, volontari: [], mezzoId: null });
});

it("propone i condivisi e il riferimento locale, escludendo altri Centri e altre Aree", async () => {
  state.volunteers = [
    { id: 1, nome: "Condiviso", cognome: "Area", areaOperativaId: 1, centroAscoltoId: null, operativo: true, maxConsegneTurno: 0 },
    { id: 2, nome: "Locale", cognome: "RomaA", areaOperativaId: 1, centroAscoltoId: 10, operativo: true, maxConsegneTurno: 0 },
    { id: 3, nome: "AltroCentro", cognome: "RomaB", areaOperativaId: 1, centroAscoltoId: 11, operativo: true, maxConsegneTurno: 0 },
    { id: 4, nome: "AltraArea", cognome: "Milano", areaOperativaId: 2, centroAscoltoId: null, operativo: true, maxConsegneTurno: 0 },
  ];
  await choose(0, "1"); await choose(1, "10"); await click("turni.emptySlot"); await click("turni.addVolontario");
  const options = document.querySelector('[role="dialog"]')!.querySelector("select")!.textContent;
  expect(options).toContain("Condiviso");
  expect(options).toContain("Locale");
  expect(options).not.toContain("AltroCentro");
  expect(options).not.toContain("AltraArea");
});
