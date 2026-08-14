import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const verifyMutate = vi.fn();

vi.mock("@workspace/api-client-react", () => ({
  getSearchMensaBeneficiariQueryKey: () => ["mensa-beneficiari"],
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getListGiacenzeMensaQueryKey: () => ["mensa-giacenze"],
  useListMense: () => ({
    data: [{ id: 10, nome: "Mensa Roma", attiva: true }],
  }),
  useVerificaAccessoMensa: () => ({ mutate: verifyMutate, isPending: false }),
  useAutorizzaEccezioneMensa: () => ({ mutate: vi.fn(), isPending: false }),
  useCreatePastoMensa: () => ({ mutate: vi.fn(), isPending: false }),
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
});
