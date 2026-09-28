export type M5bDocumentType = "bolla" | "trasferimento";

/** Only known M4 states are actionable; unknown states never imply a new document. */
export function logicalDocumentProgress(
  tipo: M5bDocumentType,
  stato: string | null,
) {
  if (stato === null) return "non_disponibile";
  if (stato === "annullato") return "annullato";
  if (tipo === "bolla") {
    switch (stato) {
      case "bozza":
        return "in_preparazione";
      case "confermato":
        return "pronta";
      case "in_trasporto":
        return "in_viaggio";
      case "rientro_atteso":
        return "rientro_atteso";
      case "consegnato":
        return "esito_registrato";
      case "rientrato":
        return "rientrato";
      default:
        return "stato_non_riconosciuto";
    }
  }
  switch (stato) {
    case "richiesto":
      return "in_preparazione";
    case "preparato":
      return "pronta";
    case "in_transito":
      return "in_viaggio";
    case "rientro_atteso":
      return "rientro_atteso";
    case "completato":
      return "esito_registrato";
    case "rientrato":
      return "rientrato";
    default:
      return "stato_non_riconosciuto";
  }
}
