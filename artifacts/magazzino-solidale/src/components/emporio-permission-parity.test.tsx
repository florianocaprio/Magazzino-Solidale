import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  executeMonthly: vi.fn(),
  beneficiary: {
    id: 1,
    codice: "BEN-1",
    codiceFiscale: null,
    cognome: "Rossi",
    nome: "Mario",
    centroAscoltoId: 1,
    centroAscoltoNome: "Centro A",
    cittaId: 1,
    cittaNome: "Area A",
    attivo: true,
    creditoSolidaleAbilitato: true,
    creditoSolidaleStato: "attivo",
    creditoSolidaleSaldo: 20,
    creditoSolidaleMensileAssegnato: 10,
    creditoSolidaleDataUltimoMovimento: null,
    magazzinoEmporioPreferitoId: 1,
    magazzinoEmporioPreferitoNome: "Emporio A",
  },
  accesso: {
    id: 1,
    beneficiarioId: 1,
    beneficiarioNome: "Rossi Mario",
    beneficiarioCodice: "BEN-1",
    centroAscoltoNome: "Centro A",
    magazzinoEmporioId: 1,
    magazzinoEmporioNome: "Emporio A",
    dataOraInizio: "2026-08-19T10:00:00.000Z",
    dataOraFine: null,
    statoAccessoEmporio: "pianificato",
    saldoCreditoSolidale: 20,
    quotaMensileAssegnata: 10,
    noteAccessoEmporio: null,
    accessoForzato: false,
  },
}));

vi.mock("@workspace/api-client-react", () => ({
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListCreditoSolidaleBeneficiarioMovimentiQueryKey: () => [
    "credito",
    "beneficiario",
  ],
  getListAccessiEmporioQueryKey: () => ["accessi"],
  useCreateCreditoSolidaleRettifica: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateCreditoSolidaleRicaricaManuale: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useExecuteCreditoSolidaleRicaricaMensile: () => ({
    mutate: mocks.executeMonthly,
    isPending: false,
  }),
  useListCreditoSolidaleBeneficiari: () => ({
    data: [mocks.beneficiary],
    isLoading: false,
  }),
  useListCentriAscolto: () => ({ data: [{ id: 1, nome: "Centro A" }] }),
  useListCitta: () => ({ data: [{ id: 1, nome: "Area A" }] }),
  useListCreditoSolidaleBeneficiarioMovimenti: () => ({ data: [] }),
  useListCreditoSolidaleMovimenti: () => ({ data: [] }),
  useListMagazzini: () => ({
    data: [{ id: 1, nome: "Emporio A", tipoMagazzino: "emporio" }],
  }),
  useStornaCreditoSolidaleMovimento: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateAccessoEmporio: () => ({ mutate: vi.fn(), isPending: false }),
  useListAccessiEmporio: () => ({ data: [mocks.accesso], isLoading: false }),
  useSearchBeneficiariAccessiEmporio: () => ({ data: [] }),
  useUpdateAccessoEmporio: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAccessoEmporioStato: () => ({ mutate: vi.fn(), isPending: false }),
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

vi.mock("@/lib/use-moduli", () => ({
  EMPORIO_DISABLED_MESSAGE: "Emporio disabilitato",
  useModuloFlags: () => ({ emporioAbilitato: true }),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => mocks.permissions.has(permission),
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

import EmporioCreditiSaldo from "@/pages/emporio-crediti-saldo";
import EmporioAccessi from "@/pages/emporio-accessi";

describe("parità permessi UI Credito e Accessi Emporio", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.permissions = new Set(["credito.view", "emporio.access.view"]);
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

  it("Credito view-only non espone mutazioni e non esegue ricariche all'apertura", async () => {
    await act(async () => root.render(<EmporioCreditiSaldo />));

    expect(document.body.textContent).not.toContain(
      "creditoSolidale.ricaricaCreditoSolidale",
    );
    expect(document.body.textContent).not.toContain(
      "creditoSolidale.rettificaCreditoSolidale",
    );
    expect(document.body.textContent).not.toContain(
      "creditoSolidale.eseguiRicaricaMensile",
    );
    expect(mocks.executeMonthly).not.toHaveBeenCalled();
  });

  it("credito.adjust abilita ricarica e rettifica, senza concedere l'esecuzione mensile", async () => {
    mocks.permissions.add("credito.adjust");
    await act(async () => root.render(<EmporioCreditiSaldo />));

    expect(document.body.textContent).toContain(
      "creditoSolidale.ricaricaCreditoSolidale",
    );
    expect(document.body.textContent).toContain(
      "creditoSolidale.rettificaCreditoSolidale",
    );
    expect(document.body.textContent).not.toContain(
      "creditoSolidale.eseguiRicaricaMensile",
    );
  });

  it("esegue la ricarica mensile una sola volta e solo dopo conferma", async () => {
    mocks.permissions.add("credito.monthly.execute");
    await act(async () => root.render(<EmporioCreditiSaldo />));

    const executeButton = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("creditoSolidale.eseguiRicaricaMensile"),
    );
    expect(executeButton).toBeDefined();
    expect(mocks.executeMonthly).not.toHaveBeenCalled();

    await act(async () => executeButton?.click());
    expect(mocks.executeMonthly).not.toHaveBeenCalled();
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "creditoSolidale.conferma",
    );
    await act(async () => confirm?.click());
    expect(mocks.executeMonthly).toHaveBeenCalledTimes(1);
  });

  it("Accessi view-only non mostra controlli manage; il grant manage li abilita", async () => {
    await act(async () => root.render(<EmporioAccessi />));
    expect(document.body.textContent).not.toContain(
      "accessiEmporio.nuovoAccesso",
    );
    expect(
      document.querySelector('[title="accessiEmporio.modificaAccesso"]'),
    ).toBeNull();

    mocks.permissions.add("emporio.access.manage");
    await act(async () => root.render(<EmporioAccessi />));
    expect(document.body.textContent).toContain("accessiEmporio.nuovoAccesso");
    expect(
      document.querySelector('[title="accessiEmporio.modificaAccesso"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[title="accessiEmporio.segnoEffettuato"]'),
    ).toBeNull();
    expect(
      document.querySelector('[title="accessiEmporio.apriCassa"]'),
    ).toBeNull();

    mocks.permissions.add("emporio.cassa.operate");
    await act(async () => root.render(<EmporioAccessi />));
    expect(
      document.querySelector('[title="accessiEmporio.apriCassa"]'),
    ).not.toBeNull();
  });
});
