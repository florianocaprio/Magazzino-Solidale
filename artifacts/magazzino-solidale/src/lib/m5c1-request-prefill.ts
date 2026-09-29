import type { Intervento } from "@workspace/api-client-react";
import { civilDateEuropeRome } from "./europe-rome";

export function interventionRequestPrefill(
  intervention: Pick<
    Intervento,
    "beneficiarioId" | "priorita" | "dataOraPianificata"
  >,
) {
  return {
    beneficiarioId: intervention.beneficiarioId,
    priorita: intervention.priorita,
    dataDesiderata: intervention.dataOraPianificata
      ? civilDateEuropeRome(intervention.dataOraPianificata)
      : "",
    modalitaPreferita: "da_definire" as const,
  };
}
