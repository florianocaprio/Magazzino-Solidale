import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listBeneficiari } = vi.hoisted(() => ({ listBeneficiari: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({
  useListBeneficiari: (params: unknown) => listBeneficiari(params),
  useCreateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkBeneficiari: () => ({ mutate: vi.fn(), isPending: false }),
  useListCentriAscolto: () => ({ data: [] }),
  useListMagazzini: () => ({ data: [] }),
  useGetBeneficiario: () => ({ data: undefined }),
  useCercaBeneficiariSimili: () => ({ data: [] }),
  useListCitta: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getGetBeneficiarioQueryKey: (id: number) => ["beneficiari", id],
  getCercaBeneficiariSimiliQueryKey: () => ["beneficiari", "simili"],
  getListCittaQueryKey: () => ["citta"],
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
  useAuth: () => ({ user: { id: 1, cittaId: 1, centroAscoltoId: 2 } }),
}));

vi.mock("@/lib/use-moduli", () => ({
  EMPORIO_DISABLED_MESSAGE: "Emporio disabilitato",
  UNITA_STRADA_DISABLED_MESSAGE: "UDS disabilitata",
  useModuloFlags: () => ({
    emporioAbilitato: true,
    unitaStradaAbilitata: true,
  }),
}));

vi.mock("wouter", () => ({
  Link: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import Beneficiari from "@/pages/beneficiari";

describe("Lista Beneficiari - anagrafiche provvisorie", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    listBeneficiari.mockReturnValue({
      data: [
        {
          id: 10,
          codice: "BEN-10",
          cognome: "Provvisoria",
          nome: "Persona",
          statoAnagrafica: "provvisoria",
          priorita: "media",
          numComponenti: 1,
          creditoSolidaleStato: "non_abilitato",
          consegnaDomicilio: false,
          uds: false,
          attivo: true,
        },
      ],
      isLoading: false,
    });
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

  it("mostra il badge Provvisoria e il filtro dedicato", async () => {
    await act(async () => root.render(<Beneficiari />));

    expect(document.body.textContent).toContain("Provvisoria");
    const filter = Array.from(
      document.querySelectorAll('[role="combobox"]'),
    ).find((element) => element.textContent?.includes("Tutte le anagrafiche"));
    expect(filter).toBeDefined();
    expect(listBeneficiari).toHaveBeenCalledWith(
      expect.objectContaining({ statoAnagrafica: undefined }),
    );
  });
});
