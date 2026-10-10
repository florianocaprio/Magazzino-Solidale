const it = {
  rettifica: "Rettifica spesa",
  rettificaRegistrata: "Rettifica registrata",
  creditoInteroRichiesto: "Il Credito Solidale richiede unità intere.",
  legacyNonConforme:
    "Importi storici frazionari non conformi: lettura preservata, nuova rettifica bloccata. Serve una riconciliazione amministrativa approvata.",
  tipoRettifica: "Tipologia rettifica",
  reso_idoneo: "Reso fisico idoneo",
  reso_non_distribuibile: "Reso fisico non distribuibile",
  errore_amministrativo: "Errore amministrativo — solo credito",
  solo_credito: "Rettifica solo credito",
  effettoIdoneo:
    "La merce realmente restituita torna al lotto originale. Il rimborso usa l'addebito storico.",
  effettoScarto:
    "La merce restituita viene scartata nella stessa transazione: nessun aumento della disponibilità distribuibile.",
  effettoCredito:
    "Solo rimborso motivato: stock e quantità distribuite non cambiano. Correzioni fisiche amministrative non definite non sono disponibili.",
  creditoResiduo:
    "Addebitato: {{originale}} · Già restituito: {{restituito}} · Rimborsabile: {{residuo}}",
  importo: "Credito intero da restituire",
  frazioneBloccata:
    "Rimborso non rappresentabile in crediti interi o superiore al residuo. Nessun arrotondamento automatico.",
  confermaEffetti:
    "Confermo gli effetti fisici ed economici indicati e il motivo. La rettifica sarà auditata.",
  confermaRettifica: "Conferma rettifica",
  recuperaEsito: "Verifica esito rettifica",
  esitoIncerto:
    "Esito incerto: verifica la ricevuta. Non inviare una nuova rettifica.",
  titolo: "Spese Emporio",
  sottotitolo:
    "Storico delle spese chiuse dalla Cassa Emporio con bolla e consumo Credito Solidale.",
  filtri: "Filtri Spese Emporio",
  cercaBeneficiario: "Cerca beneficiario",
  dataChiusura: "Data chiusura",
  numeroSpesa: "Numero spesa",
  beneficiario: "Beneficiario",
  emporio: "Emporio",
  creditoConsumati: "Credito consumato",
  statoEmailBolla: "Invio email Bolla",
  nessunaSpesa: "Nessuna Spesa Emporio trovata.",
  dettaglio: "Dettaglio Spesa",
  numeroBolla: "Numero Bolla",
  saldoPrima: "Saldo precedente",
  saldoDopo: "Saldo residuo",
  quantita: "Quantità",
  stampaBolla: "Scarica Bolla PDF",
  ritentaInvioEmail: "Apri email Bolla",
  copiaLinkBolla: "Copia link Bolla",
  copiaTestoEmail: "Copia testo email",
  emailClientAperto: "Client email aperto.",
  emailClientApertoDescrizione:
    "Controlla e invia la bozza dal programma di posta. Se non si apre, premi di nuovo Apri email Bolla.",
  linkBollaCopiato: "Link Bolla copiato.",
  testoEmailCopiato: "Testo email Bolla copiato.",
  nessunDestinatarioEmail:
    "Nessun destinatario email disponibile. Copia manualmente il link alla Bolla e invialo dal tuo client di posta.",
  emailPreparazioneErrore: "Errore nell'apertura dell'email Bolla.",
  emailDataUltimoClick: "Ultimo tentativo email",
  emailOperatore: "Operatore email",
  emailOggetto: "Oggetto email",
  selezionaSpesa: "Seleziona una spesa per vedere il dettaglio.",
  email: {
    non_preparata: "Da inviare",
    invio_manuale_avviato: "Apertura email avviata",
    nessun_destinatario: "Nessun destinatario",
    errore: "Errore email",
    non_inviata: "Da inviare",
    inviata: "Apertura email avviata",
  },
} as const;

export const speseEmporio = {
  it,
  es: it,
  en: it,
  fr: it,
  de: it,
  ar: it,
} as const;
