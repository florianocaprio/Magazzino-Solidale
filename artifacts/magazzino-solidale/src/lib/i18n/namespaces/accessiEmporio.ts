const it = {
  titolo: "Accessi Emporio",
  sottotitolo:
    "Pianificazione degli ingressi all'Emporio. La presenza non implica una spesa completata.",
  filtri: "Filtri Accessi Emporio",
  nuovoAccesso: "Nuovo Accesso Emporio",
  modificaAccesso: "Modifica Accesso Emporio",
  annullaAccesso: "Annulla Accesso",
  confermaAccesso: "Conferma Accesso",
  segnoEffettuato: "Registra presenza",
  segnoNonPresentato: "Segna non presentato",
  apriCassa: "Apri / recupera Cassa",
  beneficiario: "Beneficiario",
  emporio: "Emporio",
  dataOraInizio: "Data/Ora",
  dataOraFine: "Ora fine",
  stato: "Stato",
  pianificato: "Pianificato",
  confermato: "Confermato",
  effettuato: "Presenza registrata",
  annullato: "Annullato",
  non_presentato: "Non presentato",
  nonPresentato: "Non presentato",
  note: "Note",
  motivoAnnullamento: "Motivo annullamento",
  cercaBeneficiario: "Cerca beneficiario",
  risultatiBeneficiari: "Risultati ricerca beneficiari",
  beneficiarioSelezionato: "Beneficiario selezionato",
  iniziaRicerca:
    "Seleziona l'Emporio e scrivi nome, cognome o codice. I risultati compariranno qui.",
  selezionaRisultato:
    "Seleziona il beneficiario dai risultati qui sotto. La ricerca per nome non seleziona automaticamente.",
  nessunBeneficiario:
    "Nessun beneficiario trovato nell'Area dell'Emporio accessibile al tuo profilo.",
  erroreRicerca:
    "Ricerca non disponibile. Riprova: non è possibile verificare i beneficiari.",
  nonPianificabile: "Beneficiario trovato, ma non pianificabile.",
  configuraCredito:
    "Configura il Credito Solidale da Modifica anagrafica, se autorizzato per questo beneficiario.",
  motivi: {
    beneficiario_non_attivo: "Anagrafica non attiva.",
    centro_non_valido:
      "Centro di Ascolto mancante, inattivo o non coerente con l'Area.",
    emporio_non_abilitato: "Abilitazione Emporio mancante nell'Area corrente.",
    emporio_sospeso: "Abilitazione Emporio sospesa.",
    emporio_revocato: "Abilitazione Emporio revocata.",
    emporio_programmato: "Abilitazione Emporio non ancora efficace.",
    credito_non_abilitato:
      "Credito Solidale non abilitato: l'abilitazione Emporio da sola non lo attiva.",
    credito_non_attivo:
      "Credito Solidale non operativo: configurarlo tramite un operatore autorizzato.",
  },
  cercaBeneficiarioPlaceholder:
    "Cerca beneficiario per nome, codice o codice a barre",
  tuttiGliEmpori: "Tutti gli empori",
  tuttiGliStati: "Tutti gli stati",
  tutteLeAree: "Tutte le Aree Operative",
  riepilogoGiornaliero: "Riepilogo giornaliero",
  totalePianificati: "Pianificati",
  totaleConfermati: "Confermati",
  totaleEffettuati: "Presenze registrate",
  accessoNegato:
    "Accesso non più autorizzato. Verifica permessi e territorio assegnato.",
  totaleNonPresentati: "Non presentati",
  totaleAnnullati: "Annullati",
  pianificaDaBeneficiario: "Pianifica accesso",
  prossimoAccesso: "Prossimo accesso",
  ultimoAccesso: "Ultimo accesso",
  avviaCassaPlaceholder: "La Cassa Emporio sarà disponibile dalla Fase4-6.",
  accessoForzatoDaCassa: "Accesso forzato da Cassa",
  emporioDisabilitato:
    "Il modulo Emporio Solidale è disabilitato. Abilitalo da Impostazioni Moduli per utilizzare questa funzione.",
  beneficiarioNonAttivo: "Il beneficiario non è attivo.",
  centroAscoltoRichiesto:
    "Per pianificare un Accesso Emporio è necessario associare il beneficiario a un Centro di Ascolto.",
  creditoSolidaleRichiesto:
    "Il beneficiario non è abilitato al Credito Solidale.",
  creditoSolidaleNonAttivo:
    "Il Credito Solidale del beneficiario non è attivo.",
  magazzinoEmporioRichiesto:
    "Selezionare un magazzino di tipo Emporio o Misto.",
  duplicatoGiornaliero:
    "Esiste già un Accesso Emporio pianificato per questo beneficiario nella data selezionata.",
  nessunAccesso: "Nessun Accesso Emporio trovato.",
  tornaBeneficiario: "Torna alla scheda beneficiario",
} as const;

export const accessiEmporio = {
  it,
  es: it,
  en: it,
  fr: it,
  de: it,
  ar: it,
} as const;
