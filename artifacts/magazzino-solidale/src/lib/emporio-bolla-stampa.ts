import {
  getCurrentUser,
  getBollaStampaSpesaEmporio,
  type BollaDettaglio,
  type BollaEmporioStampa,
  type SpesaEmporio,
} from "@workspace/api-client-react";
import { generateBollaPdf, type BollaTemplate } from "@/lib/bolla-pdf";
import { loadDocumentBrandingForPdf } from "@/lib/branding-ambiente";

export function adattaBollaEmporioPerPdf(
  spesa: SpesaEmporio,
  stampa: BollaEmporioStampa,
): BollaDettaglio {
  const bollaId = spesa.bollaId ?? spesa.id;
  return {
    id: bollaId,
    numeroBolla: stampa.numeroBolla ?? stampa.numeroSpesa,
    dataBolla: stampa.dataBolla,
    tipoDestinatario: "beneficiario",
    beneficiarioId: spesa.beneficiarioId,
    beneficiarioNome: stampa.beneficiario,
    destinatarioSnapshotCongelato: false,
    magazzinoId: spesa.magazzinoEmporioId,
    magazzinoNome: stampa.emporio,
    magazzinoIndirizzo: stampa.emporioIndirizzo,
    stato: "consegnato",
    confermaRicezione: false,
    operatoreCodice: stampa.operatore,
    dataCreazione: stampa.dataChiusura,
    versione: 1,
    noteConsegna: stampa.note,
    righe: stampa.righe.map((riga) => ({
      id: riga.bollaRigaId ?? riga.id,
      bollaId,
      prodottoId: riga.prodottoId,
      prodottoNome: riga.prodottoNome,
      lottoId: riga.lottoId,
      codiceLotto: riga.codiceLotto,
      ripartizioniLotto: [],
      fsePlus: riga.fsePlus,
      quantita: riga.quantita,
      unitaMisura: riga.unitaMisura ?? null,
      note: null,
    })),
  };
}

export async function downloadBollaEmporioPdf(
  spesa: SpesaEmporio,
  options: {
    footer?: string | null;
    template?: BollaTemplate;
    expectedActor?: unknown;
    isCurrent?: () => boolean;
  } = {},
): Promise<void> {
  const actor = JSON.stringify(await getCurrentUser());
  const assertLocalContext = () => {
    if (
      options.isCurrent?.() === false ||
      (options.expectedActor !== undefined &&
        JSON.stringify(options.expectedActor) !== actor)
    )
      throw new Error("Export context changed");
  };
  assertLocalContext();
  const stampa = await getBollaStampaSpesaEmporio(spesa.id);
  const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
  await generateBollaPdf({
    bolla: adattaBollaEmporioPerPdf(spesa, stampa),
    centro: stampa.centroAscolto ? { nome: stampa.centroAscolto } : null,
    footer: options.footer ?? null,
    template: options.template ?? "standard",
    associationLogoDataUrl: logoDataUrl,
    branding,
    beforeSave: async () => {
      assertLocalContext();
      if (JSON.stringify(await getCurrentUser()) !== actor)
        throw new Error("Export actor changed");
      // Revalidate the canonical document after asynchronous rendering. A
      // previously authorized response is not authorization to download later.
      await getBollaStampaSpesaEmporio(spesa.id);
      if (JSON.stringify(await getCurrentUser()) !== actor)
        throw new Error("Export actor changed");
      assertLocalContext();
    },
  });
}
