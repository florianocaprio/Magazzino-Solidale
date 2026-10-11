import type { Intervento } from "@workspace/api-client-react";

export function interventoLogisticLabel(
  raccordo: Intervento["raccordoMagazzino"],
) {
  if (!raccordo) return null;
  if (raccordo.ambiguo) return "ambiguous";
  if (raccordo.richiestaStato === "annullata") return "requestCancelled";
  if (raccordo.richiestaStato === "chiusa") return "requestClosed";
  if (raccordo.consegnaStato === "effettuata") return "deliveryDone";
  if (raccordo.consegnaId != null && raccordo.consegnaStato !== "annullata")
    return "deliveryPlanned";
  if (raccordo.bollaStato === "confermato") return "readyToPlan";
  if (
    raccordo.bollaStato === "bozza" ||
    raccordo.richiestaStato === "presa_in_carico"
  )
    return "preparingBolla";
  return "requestSent";
}
