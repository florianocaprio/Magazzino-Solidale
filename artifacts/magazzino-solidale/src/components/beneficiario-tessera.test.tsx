import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createCardMutate } = vi.hoisted(() => ({ createCardMutate: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({
  useGetBeneficiario: () => ({ data: {
    id: 42, codice: "BEN-42", codiceFiscale: null, statoAnagrafica: "completa",
    cognome: "Rossi", nome: "Mario", soprannome: null, dataNascita: null,
    fasciaEtaPresunta: "30_64", fasciaEtaCorrente: "30_64", fasciaEtaOrigine: "presunta",
    sesso: "M", cittadinanza: null, areaProvenienza: null, residenza: null, domicilio: null,
    comune: null, zonaMunicipio: null, telefono: null, email: null, statoCivile: null,
    numComponenti: 1, numFigliMaschi: 0, numFiglieFemmine: 0, numMinori: 0,
    numAnziani: 0, numDisabili: 0, restrizioniAlimentari: null, allergie: null,
    notePaccoAlimentare: null, priorita: "media", consegnaDomicilio: false,
    motivoConsegnaDomicilio: null, centroAscoltoId: 7, centroAscoltoNome: "Centro Roma",
    creditoSolidaleAbilitato: false, creditoSolidaleStato: "non_abilitato",
    creditoSolidaleDataAbilitazione: null, creditoSolidaleNote: null,
    magazzinoEmporioPreferitoId: null, magazzinoEmporioPreferitoNome: null,
    creditoSolidaleMensileAssegnato: null, creditoSolidaleMensileManuale: false,
    creditoSolidaleMotivoModifica: null, creditoSolidaleDataUltimaModificaQuota: null,
    creditoSolidaleSaldo: 0, creditoSolidaleDataUltimoMovimento: null,
    uds: false, cittaId: 1, cittaNome: "Roma", zonaUdsId: null, attivo: true,
    dataPresaInCarico: null, noteInterne: null, nucleo: [], interventi: [], consegne: [],
    dataCreazione: "2026-08-15T00:00:00.000Z",
  }, isLoading: false }),
  useListTessereBeneficiarioDaAnagrafica: () => ({ data: [{
    id: 9, beneficiarioId: 42, codice: "BEN-42", stato: "attiva",
    dataEmissione: "2025-01-01T00:00:00.000Z", dataScadenza: null,
    dataRevoca: null, motivoRevoca: null, createdBy: null,
    createdAt: "2025-01-01T00:00:00.000Z", versione: "2025-01-01T00:00:00.000Z",
  }], isLoading: false }),
  useCreateTesseraBeneficiarioDaAnagrafica: () => ({ mutate: createCardMutate, isPending: false }),
  useCreateMensaAbilitazione: () => ({ mutate: vi.fn(), isPending: false }),
  useListMensaAbilitazioni: () => ({ data: [], isLoading: false, isError: false }),
  useListMense: () => ({ data: [], isLoading: false }),
  useListAccessiEmporio: () => ({ data: [] }),
  useListCentriAscolto: () => ({ data: [{ id: 7, nome: "Centro Roma", attivo: true }] }),
  useListMagazzini: () => ({ data: [] }),
  useUpdateBeneficiario: () => ({ mutate: vi.fn(), isPending: false }),
  useAddNucleoFamiliare: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteNucleoFamiliare: () => ({ mutate: vi.fn(), isPending: false }),
  useListCitta: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
  useCalcolaCreditoSolidaleBeneficiario: () => ({ data: undefined, isLoading: false, isError: false }),
  useGetCreditoSolidaleBeneficiarioSaldo: () => ({ data: undefined }),
  useListCreditoSolidaleBeneficiarioMovimenti: () => ({ data: [] }),
  useCreateCreditoSolidaleRettifica: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateCreditoSolidaleRicaricaManuale: () => ({ mutate: vi.fn(), isPending: false }),
  getGetBeneficiarioQueryKey: () => ["beneficiario", 42],
  getListAccessiEmporioQueryKey: () => ["accessi"],
  getListTessereBeneficiarioDaAnagraficaQueryKey: () => ["tessere", 42],
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListCittaQueryKey: () => ["citta"],
  getCalcolaCreditoSolidaleBeneficiarioQueryKey: () => ["calcolo"],
  getGetCreditoSolidaleBeneficiarioSaldoQueryKey: () => ["saldo"],
  getListCreditoSolidaleBeneficiarioMovimentiQueryKey: () => ["movimenti"],
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getListMenseQueryKey: () => ["mense"],
}));

vi.mock("wouter", () => ({
  useParams: () => ({ id: "42" }),
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { id: 1, cittaId: 1, centroAscoltoId: 7 }, hasArea: () => true, hasPermission: () => true }) }));
vi.mock("@/lib/use-moduli", () => ({ EMPORIO_DISABLED_MESSAGE: "", UNITA_STRADA_DISABLED_MESSAGE: "", useModuloFlags: () => ({ emporioAbilitato: true, unitaStradaAbilitata: true, mensaAbilitato: true }) }));
vi.mock("@/lib/branding-ambiente", () => ({ loadTesseraBrandingForPdf: vi.fn() }));
vi.mock("@/lib/tessera-pdf", () => ({ generateTesseraPdf: vi.fn(), buildTesseraLabels: vi.fn() }));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("@/components/scheda-export", () => ({ SchedaExportButtons: () => null }));

import BeneficiarioDettaglio from "@/pages/beneficiario-dettaglio";

describe("Tessera trasversale dal dettaglio beneficiario", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount()); container.remove(); document.body.innerHTML = ""; vi.clearAllMocks();
  });

  it("riconosce la tessera legacy attiva e richiede il motivo prima della sostituzione", async () => {
    await act(async () => root.render(<BeneficiarioDettaglio />));
    expect(document.body.textContent).toContain("Tessera attiva legacy");
    expect(document.body.textContent).toContain("Stampa tessera attiva");
    const replace = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Sostituisci tessera"));
    await act(async () => replace?.click());
    const confirm = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Revoca e genera")) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Motivo obbligatorio della sostituzione"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(reason, "Tessera deteriorata"); reason.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(false);
    await act(async () => confirm.click());
    expect(createCardMutate).toHaveBeenCalledWith(
      { id: 42, data: { motivoSostituzione: "Tessera deteriorata" } },
      expect.any(Object),
    );
  });

  it("include la gestione Mensa condivisa nella modifica del beneficiario", async () => {
    await act(async () => root.render(<BeneficiarioDettaglio />));
    const edit = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("beneficiarioDettaglio.editAnagrafica"),
    );
    await act(async () => edit?.click());

    expect(
      document.querySelectorAll('[data-testid="beneficiario-mensa-card"]'),
    ).toHaveLength(2);
    expect(document.body.textContent).toContain("Abilita alla Mensa");
  });
});
