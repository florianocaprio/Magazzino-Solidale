import React, { act } from "react";
vi.mock("@/lib/i18n", () => ({ default: { addResourceBundle: vi.fn() } }));
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createCardMutate, updateNucleoMutate, recoverCard, pdf, requests, getZone, patchPerson } = vi.hoisted(() => ({
  createCardMutate: vi.fn(),
  updateNucleoMutate: vi.fn(),
  recoverCard: vi.fn(),
  pdf: vi.fn(),
  requests: vi.fn(),
  getZone: vi.fn(),
  patchPerson: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBeneficiarioStatiServiziUds: () => ({ data: { emporio: { disponibile: true, stato: "attivo" }, mensa: { disponibile: true, stato: "sospesa" } } }),
  getGetBeneficiarioStatiServiziUdsQueryKey: (id: number) => ["stati-uds", id],
  useGetOrCreateBeneficiarioTesseraDocumento: () => ({ mutateAsync: recoverCard, isPending: false }),
  useListRichiesteMagazzino: (...args: unknown[]) => { requests(...args); return ({
    data: { items: [] },
    isLoading: false,
    isError: false,
  }); },
  getListRichiesteMagazzinoQueryKey: () => ["richieste-magazzino"],
  useGetBeneficiario: () => ({
    data: {
      id: 42,
      codice: "BEN-42",
      codiceFiscale: null,
      statoAnagrafica: "completa",
      cognome: "Rossi",
      nome: "Mario",
      soprannome: null,
      dataNascita: null,
      fasciaEtaPresunta: "30_64",
      fasciaEtaCorrente: "30_64",
      fasciaEtaOrigine: "presunta",
      sesso: "M",
      cittadinanza: null,
      areaProvenienza: null,
      residenza: null,
      domicilio: null,
      comune: null,
      zonaMunicipio: null,
      telefono: null,
      email: null,
      statoCivile: null,
      numComponenti: 2,
      numFigliMaschi: 0,
      numFiglieFemmine: 1,
      numMinori: 0,
      numAnziani: 0,
      numDisabili: 0,
      restrizioniAlimentari: null,
      allergie: null,
      notePaccoAlimentare: null,
      priorita: "media",
      consegnaDomicilio: false,
      motivoConsegnaDomicilio: null,
      centroAscoltoId: 7,
      centroAscoltoNome: "Centro Roma",
      creditoSolidaleAbilitato: false,
      creditoSolidaleStato: "non_abilitato",
      creditoSolidaleDataAbilitazione: null,
      creditoSolidaleNote: null,
      magazzinoEmporioPreferitoId: null,
      magazzinoEmporioPreferitoNome: null,
      creditoSolidaleMensileAssegnato: null,
      creditoSolidaleMensileManuale: false,
      creditoSolidaleMotivoModifica: null,
      creditoSolidaleDataUltimaModificaQuota: null,
      creditoSolidaleSaldo: 0,
      creditoSolidaleDataUltimoMovimento: null,
      uds: false,
      areaOperativaId: 1,
      areaOperativaNome: "Roma",
      zonaUdsId: null,
      attivo: true,
      dataPresaInCarico: null,
      noteInterne: null,
      nucleo: [
        {
          id: 77,
          beneficiarioId: 42,
          nome: "Giulia",
          cognome: "Rossi",
          dataNascita: "2000-01-01",
          sesso: "F",
          areaProvenienza: "UE",
          relazione: "Figlia",
          tagliiaVestiti: null,
          numeroScarpe: null,
          esigenzeParticolari: null,
          note: null,
        },
      ],
      interventi: [],
      consegne: [],
      dataCreazione: "2026-08-15T00:00:00.000Z",
    },
    isLoading: false,
  }),
  useListTessereBeneficiarioDaAnagrafica: () => ({
    data: [
      {
        id: 9,
        beneficiarioId: 42,
        codice: "BEN-42",
        stato: "attiva",
        dataEmissione: "2025-01-01T00:00:00.000Z",
        dataScadenza: null,
        dataRevoca: null,
        motivoRevoca: null,
        createdBy: null,
        createdAt: "2025-01-01T00:00:00.000Z",
        versione: "2025-01-01T00:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  useCreateTesseraBeneficiarioDaAnagrafica: () => ({
    mutate: createCardMutate,
    isPending: false,
  }),
  useCreateMensaAbilitazione: () => ({ mutate: vi.fn(), isPending: false }),
  useListMensaAbilitazioni: () => ({
    data: [],
    isLoading: false,
    isError: false,
  }),
  useListMense: () => ({ data: [], isLoading: false }),
  useListAccessiEmporio: () => ({ data: [] }),
  useListCentriAscolto: () => ({
    data: [{ id: 7, nome: "Centro Roma", attivo: true }],
  }),
  useListMagazzini: () => ({ data: [] }),
  getGetEmporioAbilitazioneQueryKey: (id: number) => [
    "/api/emporio/beneficiari",
    id,
  ],
  useGetEmporioAbilitazione: () => ({ data: { stato: "non_abilitato" } }),
  useUpdateEmporioAbilitazione: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateBeneficiario: () => ({ mutate: vi.fn(), mutateAsync: patchPerson, isPending: false }),
  useUpdateCreditoSolidaleBeneficiarioConfigurazione: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useAuthorizeBeneficiariExport: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ autorizzato: true }),
  }),
  useAddNucleoFamiliare: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateNucleoFamiliare: () => ({
    mutate: updateNucleoMutate,
    isPending: false,
  }),
  useDeleteNucleoFamiliare: () => ({ mutate: vi.fn(), isPending: false }),
  useGetBeneficiarioFse: () => ({
    data: null,
    isLoading: false,
    isError: false,
  }),
  useUpdateBeneficiarioFse: () => ({ mutateAsync: vi.fn(), isPending: false }),
  getGetBeneficiarioFseQueryKey: (id: number) => ["beneficiario-fse", id],
  useListAreeOperative: () => ({ data: [] }),
  useListZoneUds: () => ({ data: [] }),
  useGetZonaUds: (...args: unknown[]) => getZone(...args),
  useCalcolaCreditoSolidaleBeneficiario: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  }),
  useGetCreditoSolidaleBeneficiarioSaldo: () => ({ data: undefined }),
  useListCreditoSolidaleBeneficiarioMovimenti: () => ({ data: [] }),
  useCreateCreditoSolidaleRettifica: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useCreateCreditoSolidaleRicaricaManuale: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  getGetBeneficiarioQueryKey: () => ["beneficiario", 42],
  getListAccessiEmporioQueryKey: () => ["accessi"],
  getListTessereBeneficiarioDaAnagraficaQueryKey: () => ["tessere", 42],
  getListBeneficiariQueryKey: () => ["beneficiari"],
  getListAreeOperativeQueryKey: () => ["areaOperativa"],
  getCalcolaCreditoSolidaleBeneficiarioQueryKey: () => ["calcolo"],
  getGetCreditoSolidaleBeneficiarioSaldoQueryKey: () => ["saldo"],
  getListCreditoSolidaleBeneficiarioMovimentiQueryKey: () => ["movimenti"],
  getListMensaAbilitazioniQueryKey: () => ["mensa-abilitazioni"],
  getListMenseQueryKey: () => ["mense"],
}));

vi.mock("wouter", async (importOriginal) => ({
  ...await importOriginal<typeof import("wouter")>(),
  useParams: () => ({ id: "42" }),
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
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: vi.fn(),
    getMutationCache: () => ({ subscribe: () => () => {} }),
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: 1, areaOperativaId: 1, centroAscoltoId: 7 },
    hasArea: () => true,
    hasPermission: () => true,
  }),
}));
vi.mock("@/lib/use-moduli", () => ({
  EMPORIO_DISABLED_MESSAGE: "",
  UNITA_STRADA_DISABLED_MESSAGE: "",
  useModuloFlags: () => ({
    emporioAbilitato: true,
    unitaStradaAbilitata: true,
    mensaAbilitato: true,
  }),
  useConfigurazioneAmbienteFlags: () => ({ isModuloAttivo: () => true }),
}));
vi.mock("@/lib/branding-ambiente", () => ({
  loadTesseraBrandingForPdf: vi.fn().mockResolvedValue({ branding: {}, logoDataUrl: null }),
}));
vi.mock("@/lib/tessera-pdf", () => ({
  generateTesseraPdf: (...args: unknown[]) => pdf(...args),
  buildTesseraLabels: vi.fn(),
}));
vi.mock("@/components/export-buttons", () => ({ ExportButtons: () => null }));
vi.mock("@/components/scheda-export", () => ({
  SchedaExportButtons: () => null,
}));

import { UdsTerritoryFields } from "./beneficiario-uds-tools";
import BeneficiarioDettaglio from "@/pages/beneficiario-dettaglio";

describe("Tessera trasversale dal dettaglio beneficiario", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    getZone.mockReturnValue({ data: undefined });
    patchPerson.mockResolvedValue({});
    window.history.replaceState(null, "", "/");
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

  it("riconosce la tessera legacy attiva e richiede il motivo prima della sostituzione", async () => {
    await act(async () => root.render(<BeneficiarioDettaglio />));
    expect(document.body.textContent).toContain("Tessera attiva legacy");
    expect(document.body.textContent).toContain("blocco04.cardDownload");
    const replace = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Sostituisci tessera"),
    );
    await act(async () => replace?.click());
    const confirm = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Revoca e genera"),
    ) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const reason = document.querySelector<HTMLTextAreaElement>(
      'textarea[placeholder="Motivo obbligatorio della sostituzione"]',
    )!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(reason, "Tessera deteriorata");
      reason.dispatchEvent(new Event("input", { bubbles: true }));
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
    const edit = Array.from(document.querySelectorAll("button")).find(
      (button) =>
        button.textContent?.includes("beneficiarioDettaglio.editAnagrafica"),
    );
    await act(async () => edit?.click());

    expect(
      document.querySelectorAll('[data-testid="beneficiario-mensa-card"]'),
    ).toHaveLength(2);
    expect(document.body.textContent).toContain("Abilita alla Mensa");
  });

  it("BUG21: percorso UDS conserva soli stati anche in Modifica e recupera il PDF sullo stesso token dopo errore", async () => {
    window.history.replaceState(null, "", "/uds/anagrafica/42?ritorno=%2Fuds%2Fanagrafica%3Fpage%3D3");
    const card = { id: 19, codice: "MS-AbCd_Card", dataEmissione: "2024-03-07T11:00:00.000Z", stato: "sospesa", dataRevoca: null, dataScadenza: null };
    recoverCard.mockResolvedValue(card);
    pdf.mockRejectedValueOnce(new Error("PDF indisponibile")).mockResolvedValue(undefined);
    await act(async () => root.render(<BeneficiarioDettaglio />));
    expect(document.body.textContent).toContain("blocco04.udsPerson");
    expect(document.querySelectorAll('[data-testid="beneficiario-mensa-card"]')).toHaveLength(0);
    expect(requests).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ query: expect.objectContaining({ enabled: false }) }));
    expect(document.body.textContent).not.toContain("Abilita alla Mensa");
    expect(document.body.textContent).not.toContain("richiesteMagazzino.new");
    expect(recoverCard).not.toHaveBeenCalled();
    await act(async () => buttonByText("blocco04.cardDownload")?.click());
    expect(document.body.textContent).toContain("blocco04.cardFailed");
    expect(document.body.textContent).toContain("blocco04.cardInvalid");
    await act(async () => buttonByText("blocco04.cardDownload")?.click());
    expect(recoverCard).toHaveBeenCalledTimes(2);
    expect(recoverCard).toHaveBeenLastCalledWith({ id: 42 });
    expect(pdf).toHaveBeenLastCalledWith(expect.objectContaining({ beneficiario: expect.objectContaining({ codice: "BEN-42", codiceTessera: card.codice }), dataEmissione: card.dataEmissione }));
    expect(createCardMutate).not.toHaveBeenCalled();
    await act(async () => buttonByText("beneficiarioDettaglio.editAnagrafica")?.click());
    expect(document.body.textContent).not.toContain("Abilita alla Mensa");
    expect(document.querySelectorAll('[data-testid="beneficiario-mensa-card"]')).toHaveLength(0);
  });

  it("BUG21: conserva la Zona storica inattiva e invia soltanto Zona/null e versione", async () => {
    getZone.mockReturnValue({ data: { id: 99, nome: "Zona storica", attivo: false, areaOperativaId: 1 } });
    await act(async () => root.render(<UdsTerritoryFields b={{ id: 42, versione: 7, areaOperativaId: 1, centroAscoltoId: 7, zonaUdsId: 99 } as never} />));
    expect(document.body.textContent).toContain("Zona storica");
    expect(document.body.textContent).toContain("blocco04.historical");
    expect(getZone).toHaveBeenCalledWith(99, expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }));
    const picker = document.querySelector<HTMLButtonElement>('button[aria-label="udsAnagrafica.fZona"]')!;
    await act(async () => picker.click());
    const none = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent === "blocco04.noZone")!;
    await act(async () => none.click());
    const save = Array.from(picker.parentElement!.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent === "common.save")!;
    await act(async () => save.click());
    expect(patchPerson).toHaveBeenCalledWith({ id: 42, data: { zonaUdsId: null, versione: 7 } });
  });

  it("modifica un componente e mostra la fascia calcolata senza renderla editabile", async () => {
    await act(async () => root.render(<BeneficiarioDettaglio />));
    expect(document.body.textContent).toContain("Fascia: 18_29");
    expect(document.querySelector('[name="fasciaEta"]')).toBeNull();

    const editMember = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Modifica componente"]',
    )!;
    await act(async () => editMember.click());
    expect(document.body.textContent).toContain("Modifica componente");
    expect(document.querySelector('[name="fasciaEta"]')).toBeNull();

    const relation = Array.from(
      document.querySelectorAll<HTMLInputElement>("input"),
    ).find((input) => input.value === "Figlia")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(relation, "Convivente");
      relation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText("Salva")?.click());
    expect(updateNucleoMutate).toHaveBeenCalledWith(
      {
        id: 42,
        membroId: 77,
        data: expect.objectContaining({
          relazione: "Convivente",
          dataNascita: "2000-01-01",
        }),
      },
      expect.any(Object),
    );
  });
});

function buttonByText(label: string) {
  return Array.from(document.querySelectorAll("button")).find((item) =>
    item.textContent?.includes(label),
  );
}
