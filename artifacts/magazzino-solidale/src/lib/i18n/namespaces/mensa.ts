const it = {
  nav: {
    group: "Mensa",
    mensaPostazione: "Postazione Mensa",
    mensaPasti: "Pasti / Giornata",
    mensaAbilitazioni: "Abilitazioni",
    mensaTrasferimenti: "Rifornimenti",
    mensaConsumi: "Consumi",
    mensaEccezioni: "Eccezioni",
    mensaReport: "Report",
  },
  title: {
    postazione: "Postazione Mensa",
    pasti: "Pasti e giornata di servizio",
    abilitazioni: "Abilitazioni",
    trasferimenti: "Rifornimenti Mensa",
    consumi: "Consumi e scarti",
    eccezioni: "Eccezioni di accesso",
    report: "Report Mensa",
  },
  scanPrompt: "Avvicina o scansiona la tessera",
  accessGranted: "ACCESSO CONSENTITO",
  accessDenied: "ACCESSO NON CONSENTITO",
  exceptionPossible: "ALTRA MENSA DELLA STESSA AREA OPERATIVA",
  registerMeal: "Registra pasto",
  authorizeException: "Autorizza eccezione",
  manualSearch: "Ricerca manuale",
  noSensitiveData:
    "La postazione mostra solo i dati necessari all'erogazione del pasto.",
};

const en = {
  ...it,
  nav: {
    group: "Canteen",
    mensaPostazione: "Canteen station",
    mensaPasti: "Today's meals",
    mensaAbilitazioni: "Eligibility",
    mensaTrasferimenti: "Transfers",
    mensaConsumi: "Consumption",
    mensaEccezioni: "Exceptions",
    mensaReport: "Reports",
  },
  scanPrompt: "Scan or present the card",
  accessGranted: "ACCESS GRANTED",
  accessDenied: "ACCESS DENIED",
  exceptionPossible: "OTHER CANTEEN IN THE SAME AREA",
  registerMeal: "Register meal",
  authorizeException: "Authorize exception",
  manualSearch: "Manual search",
};

export const mensa = {
  it,
  en,
  es: {
    ...it,
    nav: { ...en.nav, group: "Comedor" },
    scanPrompt: "Acerque o escanee la tarjeta",
    accessGranted: "ACCESO PERMITIDO",
    accessDenied: "ACCESO DENEGADO",
  },
  fr: {
    ...it,
    nav: { ...en.nav, group: "Cantine" },
    scanPrompt: "Présentez ou scannez la carte",
    accessGranted: "ACCÈS AUTORISÉ",
    accessDenied: "ACCÈS REFUSÉ",
  },
  de: {
    ...it,
    nav: { ...en.nav, group: "Kantine" },
    scanPrompt: "Karte vorlegen oder scannen",
    accessGranted: "ZUGANG ERLAUBT",
    accessDenied: "ZUGANG VERWEIGERT",
  },
  ar: {
    ...it,
    nav: { ...en.nav, group: "المطعم" },
    scanPrompt: "قرّب البطاقة أو امسحها",
    accessGranted: "الدخول مسموح",
    accessDenied: "الدخول غير مسموح",
  },
} as const;
