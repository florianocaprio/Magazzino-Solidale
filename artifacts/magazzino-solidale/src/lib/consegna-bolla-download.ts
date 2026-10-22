import {
  getBollaTrasportoConsegna,
  getStampaOperativa,
} from "@workspace/api-client-react";
import { generateBollaPdf, type BollaTemplate } from "./bolla-pdf";
import { loadDocumentBrandingForPdf } from "./branding-ambiente";

/** The caller can download only the issued document linked to this delivery. */
export async function downloadConsegnaBolla(consegnaId: number): Promise<void> {
  const bolla = await getBollaTrasportoConsegna(consegnaId);
  const stampa = await getStampaOperativa({ contesto: "consegne" });
  const { branding, logoDataUrl } = await loadDocumentBrandingForPdf();
  await generateBollaPdf({
    bolla,
    footer: stampa.footerBolla,
    template: stampa.templateBolla as BollaTemplate,
    branding,
    associationLogoDataUrl: logoDataUrl,
    beforeSave: async () => {
      // Recheck current authorization after branding/images/PDF preparation.
      const current = await getBollaTrasportoConsegna(consegnaId);
      if (current.id !== bolla.id || current.versione !== bolla.versione)
        throw new Error(
          "La bolla è cambiata: scaricala nuovamente dalla consegna.",
        );
    },
  });
}
