import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ mutate: vi.fn(), toast: vi.fn(), canRead: true, canApprove: true, hasArea: true }));
vi.mock("@workspace/api-client-react", async (original) => ({
  ...await original<typeof import("@workspace/api-client-react")>(),
  useListApprovazioniLogistica: () => ({ data: { volontari: [{ id: 7, nome: "Ada", cognome: "Test", versione: 3 }], mezzi: [{ id: 8, codice: "M8", versione: 4 }] }, isLoading: false }),
  useApprovaVolontarioLogistica: () => ({ mutate: state.mutate }),
  useRespingiVolontarioLogistica: () => ({ mutate: state.mutate }),
  useApprovaMezzoLogistica: () => ({ mutate: state.mutate }),
  useRespingiMezzoLogistica: () => ({ mutate: state.mutate }),
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ hasArea: () => state.hasArea, hasPermission: (key: string) => key.endsWith("manage") ? state.canApprove : state.canRead }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/lib/use-moduli", () => ({ useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
import Approvazioni from "@/pages/approvazioni-logistica";
import { VolunteerApprovalBadge } from "./volontari/volunteer-approval-badge";
import { getListVolontariQueryKey, getListMezziQueryKey, getListTurniQueryKey, getGetVolontarioQueryKey, getGetMezzoQueryKey } from "@workspace/api-client-react";
let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks(); state.canApprove = state.canRead = state.hasArea = true;
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 60000, retry: false } } });
  for (const key of [getListVolontariQueryKey(), getListVolontariQueryKey({ centroAscoltoId: 1, stato: "attivi", dataRiferimento: "2026-10-19" }), getListMezziQueryKey(), getGetVolontarioQueryKey(7), getGetMezzoQueryKey(8), getListTurniQueryKey(), ["/api/prodotti"]]) client.setQueryData(key, []);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<QueryClientProvider client={client}><Approvazioni /></QueryClientProvider>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); client.clear(); });
it.each([0,1,2,3])("approvazione/rifiuto aggiorna cache e picker ancora freschi, azione %s", async (index) => {
  await act(async () => (container.querySelectorAll("button")[index] as HTMLButtonElement).click());
  const [payload, options] = state.mutate.mock.calls[0];
  expect(payload).toMatchObject({ id: index < 2 ? 7 : 8, data: { versione: index < 2 ? 3 : 4 } });
  await act(async () => options.onSuccess());
  expect(client.getQueryState(getListVolontariQueryKey({ centroAscoltoId: 1, stato: "attivi", dataRiferimento: "2026-10-19" }))?.isInvalidated).toBe(true);
  expect(client.getQueryState(getListMezziQueryKey())?.isInvalidated).toBe(true);
  expect(client.getQueryState(getGetVolontarioQueryKey(7))?.isInvalidated).toBe(true);
  expect(client.getQueryState(getGetMezzoQueryKey(8))?.isInvalidated).toBe(true);
  expect(client.getQueryState(["/api/prodotti"])?.isInvalidated).toBe(false);
  expect(state.toast.mock.calls[0][0].variant).not.toBe("destructive");
});
it("409 ricarica entrambe le risorse senza dichiarare riuscita l’approvazione", async () => {
  await act(async () => (container.querySelector("button") as HTMLButtonElement).click());
  await act(async () => state.mutate.mock.calls[0][1].onError({ status: 409 }));
  expect(client.getQueryState(getListMezziQueryKey())?.isInvalidated).toBe(true);
  expect(state.toast).toHaveBeenCalledTimes(1);
  expect(state.toast.mock.calls[0][0]).toMatchObject({ variant: "destructive", description: "approvazioniLogistica.stale" });
});
it("il tag richiede lettura e Area Logistica; non conferisce il diritto di approvare", () => {
  state.canApprove = false;
  expect(renderToStaticMarkup(<VolunteerApprovalBadge state="in_attesa" />)).toContain('href="/approvazioni-logistica"');
  state.canRead = false;
  expect(renderToStaticMarkup(<VolunteerApprovalBadge state="in_attesa" />)).not.toContain("href=");
  state.canRead = true; state.hasArea = false;
  expect(renderToStaticMarkup(<VolunteerApprovalBadge state="in_attesa" />)).not.toContain("href=");
  expect(renderToStaticMarkup(<VolunteerApprovalBadge state="approvato" />)).toBe("");
  expect(renderToStaticMarkup(<VolunteerApprovalBadge state="respinto" />)).toContain("logisticaCampaign.rejected");
});
