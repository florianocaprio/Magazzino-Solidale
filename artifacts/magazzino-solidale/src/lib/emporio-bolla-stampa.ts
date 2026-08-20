import {
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
    dataBolla: stampa.dataChiusura.slice(0, 10),
    beneficiarioId: spesa.beneficiarioId,
    beneficiarioNome: stampa.beneficiario,
    magazzinoId: spesa.magazzinoEmporioId,
    magazzinoNome: stampa.emporio,
    magazzinoIndirizzo: stampa.emporioIndirizzo,
    stato: "consegnato",
    confermaRicezione: false,
    operatoreCodice: stampa.operatore,
    dataCreazione: stampa.dataChiusura,
    noteConsegna: stampa.note,
    righe: stampa.righe.map((riga) => ({
      id: riga.bollaRigaId ?? riga.id,
      bollaId,
      prodottoId: riga.prodottoId,
      prodottoNome: riga.prodottoNome,
      lottoId: riga.lottoId,
      codiceLotto: riga.codiceLotto,
      fsePlus: false,
      quantita: riga.quantita,
      unitaMisura: riga.unitaMisura ?? null,
      note: null,
    })),
  };
}

export async function downloadBollaEmporioPdf(
  spesa: SpesaEmporio,
  options: { footer?: string | null; template?: BollaTemplate } = {},
): Promise<void> {
  const stampa = await getBollaStampaSpesaEmporio(spesa.id);
  const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
  await generateBollaPdf({
    bolla: adattaBollaEmporioPerPdf(spesa, stampa),
    centro: stampa.centroAscolto ? { nome: stampa.centroAscolto } : null,
    footer: options.footer ?? null,
    template: options.template ?? "standard",
    associationLogoDataUrl: logoDataUrl,
    branding,
  });
}
