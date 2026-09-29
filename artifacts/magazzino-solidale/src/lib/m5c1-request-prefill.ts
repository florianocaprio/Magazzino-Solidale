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

export function interventionReturnUrl(
  intervention: Pick<
    Intervento,
    "id" | "stato" | "areaOperativaId" | "centroAscoltoId"
  >,
): string {
  const vista =
    intervention.stato === "pianificato"
      ? "pianificati"
      : intervention.stato === "concluso"
        ? "conclusi"
        : intervention.stato === "annullato" ||
            intervention.stato === "mancata_presentazione"
          ? "annullati"
          : intervention.stato;
  const params = new URLSearchParams({
    vista,
    interventoId: String(intervention.id),
  });
  if (intervention.areaOperativaId != null)
    params.set("areaOperativa", String(intervention.areaOperativaId));
  if (intervention.centroAscoltoId != null)
    params.set("centro", String(intervention.centroAscoltoId));
  return `/interventi?${params}`;
}
