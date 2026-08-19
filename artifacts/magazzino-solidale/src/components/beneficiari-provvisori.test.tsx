import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listBeneficiari: vi.fn(),
  getMensaRiepilogo: vi.fn(),
  areas: new Set<string>(),
  permissions: new Set<string>(),
  mensaAbilitato: true,
  user: { id: 1, cittaId: 1 as number | null, centroAscoltoId: 2 as number | null },
  centri: [] as Array<{ id: number; nome: string; cittaId: number | null }>,
  citta: [] as Array<{ id: number; nome: string }>,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListBeneficiari: (params: unknown) => mocks.listBeneficiari(params),
  useCreateBeneficiario: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateMensaAbilitazione: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useListMense: () => ({ data: [], isLoading: false }),
  useGetMensaAbilitazioniRiepilogoBeneficiari: (
    params: unknown,
    options: unknown,
  ) => mocks.getMensaRiepilogo(params, options),
  useDeleteBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateBeneficiarioStato: () => ({ mutate: vi.fn(), isPending: false }),
  useAuthorizeBeneficiariExport: () => ({ mutateAsync: vi.fn().mockResolvedValue({ autorizzato: true }) }),
  useUpdateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkBeneficiari: () => ({ mutate: vi.fn(), isPending: false }),
  listBeneficiari: vi.fn().mockResolvedValue([]),
  useListCentriAscolto: () => ({ data: mocks.centri }),
  useListMagazzini: () => ({ data: [] }),
  useGetBeneficiario: () => ({ data: undefined }),
  useCercaBeneficiariSimili: () => ({ data: [] }),
  useListCitta: () => ({ data: mocks.citta }),
  useListZoneUds: () => ({ data: [] }),
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getGetBeneficiarioQueryKey: (id: number) => ["beneficiari", id],
  getCercaBeneficiariSimiliQueryKey: () => ["beneficiari", "simili"],
  getListCittaQueryKey: () => ["citta"],
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getGetMensaAbilitazioniRiepilogoBeneficiariQueryKey: (params?: unknown) => [
    "mensa-riepilogo",
    params,
  ],
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
    user: mocks.user,
    hasArea: (area: string) => mocks.areas.has(area),
    hasPermission: (permission: string) => permission.startsWith("beneficiari.") || mocks.permissions.has(permission),
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
    mocks.areas = new Set(["mensa"]);
    mocks.permissions = new Set();
    mocks.mensaAbilitato = true;
    mocks.user = { id: 1, cittaId: 1, centroAscoltoId: 2 };
    mocks.centri = [];
    mocks.citta = [];
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
    mocks.getMensaRiepilogo.mockReturnValue({
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

  it("mostra sempre l'Area obbligatoria nella creazione Sociale di un Admin globale", async () => {
    mocks.user = { id: 1, cittaId: null, centroAscoltoId: null };
    mocks.citta = [{ id: 1, nome: "Area A" }, { id: 2, nome: "Area B" }];
    mocks.centri = [
      { id: 10, nome: "Centro A", cittaId: 1 },
      { id: 20, nome: "Centro B", cittaId: 2 },
    ];
    await act(async () => root.render(<Beneficiari />));
    const newButton = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("beneficiari.newBeneficiario"),
    );
    await act(async () => newButton?.click());

    expect(document.body.textContent).toContain("Area");
    expect(document.body.textContent).toContain("Seleziona un'Area");
    expect(document.body.textContent).not.toContain("Centro A");
    expect(document.body.textContent).not.toContain("Centro B");
  });

  it("non abilita richieste né UI Mensa quando il modulo è disattivato", async () => {
    mocks.mensaAbilitato = false;
    mocks.permissions = new Set(["mensa.view", "mensa.eligibility.manage"]);

    await act(async () => root.render(<Beneficiari />));

    expect(mocks.getMensaRiepilogo).toHaveBeenCalledWith(
      { beneficiarioIds: "10" },
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

  it.each([
    {
      label: "manca l'area Mensa",
      areas: [] as string[],
      permissions: ["mensa.view", "mensa.eligibility.manage"],
    },
    {
      label: "manca mensa.view",
      areas: ["mensa"],
      permissions: ["mensa.eligibility.manage"],
    },
  ])(
    "non mostra né abilita query Mensa quando $label",
    async ({ areas, permissions }) => {
      mocks.areas = new Set(areas);
      mocks.permissions = new Set(permissions);

      await act(async () => root.render(<Beneficiari />));

      expect(document.body.textContent).not.toContain("NON ABILITATO");
      expect(mocks.getMensaRiepilogo).toHaveBeenCalledWith(
        { beneficiarioIds: "10" },
        expect.objectContaining({
          query: expect.objectContaining({ enabled: false }),
        }),
      );
    },
  );

  it("non abilita la query riepilogo quando la lista è vuota", async () => {
    mocks.areas = new Set(["mensa"]);
    mocks.permissions = new Set(["mensa.view"]);
    mocks.listBeneficiari.mockReturnValue({ data: [], isLoading: false });

    await act(async () => root.render(<Beneficiari />));

    expect(mocks.getMensaRiepilogo).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        query: expect.objectContaining({ enabled: false }),
      }),
    );
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
    mocks.getMensaRiepilogo.mockReturnValue({
      data: [
        {
          beneficiarioId: 10,
          stato: "attiva",
        },
        {
          beneficiarioId: 11,
          stato: "programmata",
        },
        {
          beneficiarioId: 12,
          stato: "non_abilitato",
        },
      ],
      isLoading: false,
      isError: false,
    });

    await act(async () => root.render(<Beneficiari />));

    expect(mocks.getMensaRiepilogo).toHaveBeenCalled();
    for (const call of mocks.getMensaRiepilogo.mock.calls) {
      expect(call).toEqual([
        { beneficiarioIds: "10,11,12" },
        expect.objectContaining({
          query: expect.objectContaining({ enabled: true }),
        }),
      ]);
    }
    expect(document.body.textContent).toContain("ATTIVA");
    expect(document.body.textContent).toContain("PROGRAMMATA");
    expect(document.body.textContent).toContain("NON ABILITATO");
  });

  it("naviga pagina 1, pagina 2, ritorna e resetta a pagina 1 quando cambia ricerca", async () => {
    const pageRows = (page: number) => Array.from({ length: 50 }, (_, index) => ({
      id: page * 100 + index,
      codice: `BEN-${page}-${index}`,
      cognome: `Cognome ${page}-${index}`,
      nome: "Persona",
      statoAnagrafica: "completa",
      priorita: "media",
      numComponenti: 1,
      consegnaDomicilio: false,
      uds: false,
      attivo: true,
      versione: 1,
    }));
    mocks.mensaAbilitato = false;
    mocks.listBeneficiari.mockImplementation((params: { page?: number }) => ({
      data: pageRows(params.page ?? 1),
      isLoading: false,
    }));

    await act(async () => root.render(<Beneficiari />));
    expect(mocks.listBeneficiari).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 50 }));

    const next = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Successiva");
    await act(async () => next?.click());
    expect(mocks.listBeneficiari).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, limit: 50 }));

    const previous = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.trim() === "Precedente");
    await act(async () => previous?.click());
    expect(mocks.listBeneficiari).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, limit: 50 }));

    await act(async () => next?.click());
    const search = document.querySelector<HTMLInputElement>('input[placeholder="beneficiari.searchPlaceholder"]');
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "Rossi");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(mocks.listBeneficiari).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, search: "Rossi" }));
  });
});
