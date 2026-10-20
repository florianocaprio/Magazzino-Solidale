import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { mutate, state } = vi.hoisted(() => ({
  mutate: vi.fn(),
  state: { failed: false },
}));
const data = vi.hoisted(() => ({
  configurazione: {
    versione: 2,
    prefissoAssociazione: "AIM",
    includiCodiceArea: true,
    segmentoFisso: "B",
    separatore: "-",
    cifreProgressivo: 3,
    numeroIniziale: 7,
    ambitoProgressivo: "PER_AREA",
  },
  storico: [{}, {}],
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetSuperAdminConfigurazioneCodiciBeneficiari: () =>
    state.failed ? { isError: true } : { data },
  useUpdateSuperAdminConfigurazioneCodiciBeneficiari: () => ({
    mutate,
    isPending: false,
  }),
  getGetSuperAdminConfigurazioneCodiciBeneficiariQueryKey: () => ["codici"],
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { ConfigurazioneCodiciBeneficiari } from "./configurazione-codici-beneficiari";
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  mutate.mockReset();
  state.failed = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("mostra la regola salvata, aggiorna l'anteprima e salva i soli campi configurabili", async () => {
  await act(async () => root.render(<ConfigurazioneCodiciBeneficiari />));
  expect(container.textContent).toContain("AIM-RM-B-007");
  const input = container.querySelector<HTMLInputElement>(
    "#benef-code-prefissoAssociazione",
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "ABC");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.textContent).toContain("ABC-RM-B-007");
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Salva nuova versione"),
  )!;
  await act(async () => button.click());
  expect(mutate).toHaveBeenLastCalledWith({
    data: {
      prefissoAssociazione: "ABC",
      includiCodiceArea: true,
      segmentoFisso: "B",
      separatore: "-",
      cifreProgressivo: 3,
      numeroIniziale: 7,
      ambitoProgressivo: "PER_AREA",
    },
  });
});
it("mostra l'errore di caricamento e impedisce di salvare valori presunti", async () => {
  state.failed = true;
  await act(async () => root.render(<ConfigurazioneCodiciBeneficiari />));
  expect(container.textContent).toContain("Configurazione non disponibile");
  const button = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("Salva nuova versione"),
  )!;
  expect(button.disabled).toBe(true);
  expect(mutate).not.toHaveBeenCalled();
});
