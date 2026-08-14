import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyMutate = vi.fn();
const mealMutate = vi.fn();
const temporaryMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getSearchMensaBeneficiariQueryKey: () => ["mensa-beneficiari"],
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getListGiacenzeMensaQueryKey: () => ["mensa-giacenze"],
  useListMense: () => ({
    data: [{ id: 10, nome: "Mensa Roma", attiva: true }],
  }),
  useVerificaAccessoMensa: () => ({ mutate: verifyMutate, isPending: false }),
  useAutorizzaEccezioneMensa: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePastoMensa: () => ({ mutate: mealMutate, isPending: false }),
  useCreateAccessoTemporaneoMensa: () => ({
    mutate: temporaryMutate,
    isPending: false,
  }),
  useSearchMensaBeneficiari: () => ({ data: [] }),
  useListPastiMensa: () => ({ data: [] }),
  useCreateMensa: () => ({ mutate: vi.fn(), isPending: false }),
  useListMagazziniMensa: () => ({ data: [] }),
  useListMensaAbilitazioni: () => ({ data: [] }),
  useCreateMensaAbilitazione: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateMensaAbilitazioneStato: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateTesseraBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useListTrasferimentiMensa: () => ({ data: [] }),
  useListGiacenzeMensa: () => ({ data: [] }),
  useCreateTrasferimentoMensa: () => ({ mutate: vi.fn(), isPending: false }),
  useAvviaTrasferimento: () => ({ mutate: vi.fn(), isPending: false }),
  useConfermaTrasferimento: () => ({ mutate: vi.fn(), isPending: false }),
  useListEccezioniMensa: () => ({ data: [] }),
  useGetMensaReport: () => ({ data: undefined }),
  getDocumentoTrasferimento: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, cittaId: 1 },
    hasPermission: (permission: string) => permission !== "mensa.access.manual",
  }),
}));

vi.mock("@/lib/trasferimento-pdf", () => ({
  generateTrasferimentoPdf: vi.fn(),
}));

import { MensaPostazione } from "@/pages/mensa";

describe("Postazione Mensa", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("mantiene il focus sul lettore e blocca una doppia scansione accidentale", async () => {
    await act(async () => root.render(<MensaPostazione />));
    const input = document.querySelector<HTMLInputElement>("#mensa-scan");
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "CARD-OPAQUE-123");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input?.closest("form");
    await act(async () => {
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      form?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    expect(verifyMutate).toHaveBeenCalledTimes(1);
    expect(verifyMutate.mock.calls[0]?.[0]).toMatchObject({
      data: {
        mensaId: 10,
        modalitaAccesso: "tessera",
        codiceTessera: "CARD-OPAQUE-123",
      },
    });
    expect(document.body.textContent).not.toContain("mensa.manualSearch");
  });

  it("dopo scansione valida e pasto torna pronta e focalizzata sulla persona successiva", async () => {
    verifyMutate.mockImplementation(
      (_input, options: { onSuccess?: (value: unknown) => void }) =>
        options.onSuccess?.({
          id: 101,
          mensaId: 10,
          mensaNome: "Mensa Roma",
          beneficiarioId: 22,
          beneficiarioNome: "Mario Rossi",
          beneficiarioCodice: "BEN-22",
          esito: "consentito",
          motivoEsito: "CONSENTITO",
          modalitaAccesso: "tessera",
          temporaneo: false,
          dataOra: new Date().toISOString(),
          eccezionePossibile: false,
        }),
    );
    mealMutate.mockImplementation(
      (_input, options: { onSuccess?: () => void }) => options.onSuccess?.(),
    );
    await act(async () => root.render(<MensaPostazione />));
    const input = document.querySelector<HTMLInputElement>("#mensa-scan")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "CARD-VALID");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input
        .closest("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(document.body.textContent).toContain("Mario Rossi");
    const mealButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "mensa.registerMeal",
    );
    await act(async () => mealButton?.click());
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(mealMutate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Mario Rossi");
    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("offre il form minimo di nuova persona quando l'operatore ha il permesso temporaneo", async () => {
    await act(async () => root.render(<MensaPostazione />));
    const openButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("NUOVA PERSONA – ACCESSO TEMPORANEO"),
    );
    expect(openButton).toBeDefined();
    await act(async () => openButton?.click());
    expect(document.querySelector("#temporary-name")).not.toBeNull();
    expect(document.querySelector("#temporary-surname")).not.toBeNull();
    expect(document.querySelector("#temporary-birth-date")).not.toBeNull();
    expect(document.querySelector("#temporary-reason")).not.toBeNull();
    expect(document.body.textContent).toContain(
      "senza tessera né abilitazione permanente",
    );
  });
});
