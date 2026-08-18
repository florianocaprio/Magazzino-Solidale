import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBeneficiari: vi.fn(),
  listMensaAbilitazioni: vi.fn(),
  permissions: new Set<string>(),
  mensaAbilitato: true,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListBeneficiari: (params: unknown) => mocks.listBeneficiari(params),
  useCreateBeneficiario: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateMensaAbilitazione: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useListMense: () => ({ data: [], isLoading: false }),
  useListMensaAbilitazioni: (params: unknown, options: unknown) =>
    mocks.listMensaAbilitazioni(params, options),
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
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getListMenseQueryKey: () => ["mense"],
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
    user: { id: 1, cittaId: 1, centroAscoltoId: 2 },
    hasPermission: (permission: string) => mocks.permissions.has(permission),
  }),
}));

vi.mock("@/lib/use-moduli", () => ({
  EMPORIO_DISABLED_MESSAGE: "Emporio disabilitato",
  UNITA_STRADA_DISABLED_MESSAGE: "UDS disabilitata",
  useModuloFlags: () => ({
    emporioAbilitato: true,
    unitaStradaAbilitata: true,
    mensaAbilitato: mocks.mensaAbilitato,
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
    mocks.permissions = new Set();
    mocks.mensaAbilitato = true;
    mocks.listBeneficiari.mockReturnValue({
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
    mocks.listMensaAbilitazioni.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
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
    expect(mocks.listBeneficiari).toHaveBeenCalledWith(
      expect.objectContaining({ statoAnagrafica: undefined }),
    );
  });

  it("non abilita richieste né UI Mensa quando il modulo è disattivato", async () => {
    mocks.mensaAbilitato = false;
    mocks.permissions = new Set(["mensa.view", "mensa.eligibility.manage"]);

    await act(async () => root.render(<Beneficiari />));

    expect(mocks.listMensaAbilitazioni).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
    expect(document.body.textContent).not.toContain("NON ABILITATO");
  });

  it("mostra l'abilitazione nel nuovo beneficiario solo a chi può gestirla", async () => {
    mocks.permissions = new Set(["mensa.view"]);
    await act(async () => root.render(<Beneficiari />));
    const newButton = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("beneficiari.newBeneficiario"),
    );
    await act(async () => newButton?.click());
    expect(
      document.querySelector('[data-testid="nuova-abilitazione-mensa"]'),
    ).toBeNull();

    mocks.permissions.add("mensa.eligibility.manage");
    await act(async () => root.render(<Beneficiari />));
    expect(
      document.querySelector('[data-testid="nuova-abilitazione-mensa"]'),
    ).not.toBeNull();
  });

  it("usa una sola query aggregata e mostra gli stati Mensa in tabella", async () => {
    mocks.permissions = new Set(["mensa.view"]);
    mocks.listBeneficiari.mockReturnValue({
      data: [
        {
          id: 10,
          codice: "BEN-10",
          cognome: "Attiva",
          nome: "Persona",
          statoAnagrafica: "completa",
          priorita: "media",
          numComponenti: 1,
          creditoSolidaleStato: "non_abilitato",
          consegnaDomicilio: false,
          uds: false,
          attivo: true,
        },
        {
          id: 11,
          codice: "BEN-11",
          cognome: "Programmata",
          nome: "Persona",
          statoAnagrafica: "completa",
          priorita: "media",
          numComponenti: 1,
          creditoSolidaleStato: "non_abilitato",
          consegnaDomicilio: false,
          uds: false,
          attivo: true,
        },
        {
          id: 12,
          codice: "BEN-12",
          cognome: "Senza",
          nome: "Persona",
          statoAnagrafica: "completa",
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
    mocks.listMensaAbilitazioni.mockReturnValue({
      data: [
        {
          id: 1,
          beneficiarioId: 10,
          mensaId: 2,
          dataInizio: "2020-01-01",
          dataFine: null,
          stato: "attiva",
          mensaPrincipale: true,
          createdAt: "2020-01-01T00:00:00Z",
          versione: "2020-01-01T00:00:00Z",
        },
        {
          id: 2,
          beneficiarioId: 11,
          mensaId: 2,
          dataInizio: "2999-01-01",
          dataFine: null,
          stato: "attiva",
          mensaPrincipale: true,
          createdAt: "2020-01-01T00:00:00Z",
          versione: "2020-01-01T00:00:00Z",
        },
      ],
      isLoading: false,
      isError: false,
    });

    await act(async () => root.render(<Beneficiari />));

    expect(mocks.listMensaAbilitazioni).toHaveBeenCalled();
    expect(
      mocks.listMensaAbilitazioni.mock.calls.every(([params]) =>
        params === undefined,
      ),
    ).toBe(true);
    expect(mocks.listMensaAbilitazioni).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
    expect(document.body.textContent).toContain("ATTIVA");
    expect(document.body.textContent).toContain("PROGRAMMATA");
    expect(document.body.textContent).toContain("NON ABILITATO");
  });
});
