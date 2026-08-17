type Translate = (key: string, options?: Record<string, unknown>) => string;

const reportingTextKeys: Record<string, string> = {
  "Persona unica complessiva = beneficiario distinto sull'unione degli eventi effettivamente erogati nei moduli attivi.": "generalUniquePerson",
  "I membri del nucleo non vengono espansi nel KPI generale delle persone uniche.": "generalHouseholdMembers",
  "I KPI di aree diverse non vengono sommati tra loro perché rappresentano unità operative differenti.": "generalNoCrossAreaSum",
  "Pacco distribuito = bolla nello stato consegnato nel periodo non associata a una spesa Emporio chiusa.": "parcelDelivered",
  "Nucleo servito = beneficiario distinto associato a una bolla consegnata.": "parcelHousehold",
  "Persone raggiunte = titolare più membri del nucleo registrati per i nuclei serviti.": "parcelPeople",
  "La quantità FSE+ deriva esclusivamente dai lotti effettivamente scaricati.": "parcelFseLots",
  "Le quantità sono mostrate per prodotto e unità; soltanto i kg vengono aggregati nel KPI dedicato.": "parcelUnits",
  "Intervento Sociale = ambito sociale oppure ambito NULL legacy, coerentemente con la vista operativa corrente.": "socialIntervention",
  "Intervento effettuato = intervento Sociale nello stato concluso.": "socialCompleted",
  "Persona servita = beneficiario distinto con almeno un intervento concluso nel periodo.": "socialServedPerson",
  "Scaduto = intervento ancora pianificato con data/ora precedente al minore tra fine periodo e ora corrente Europe/Rome.": "socialExpired",
  "Le note riservate non sono dimensioni analitiche e non vengono esportate.": "socialPrivateNotes",
  "Spesa Emporio = record spese_emporio nello stato chiusa.": "emporioExpense",
  "Prodotti distinti distribuiti = prodotti diversi presenti nelle sole spese chiuse.": "emporioDistinctProducts",
  "Utente servito = beneficiario distinto con almeno una spesa chiusa nel periodo.": "emporioServedUser",
  "La provenienza FSE+ deriva dal lotto della riga di spesa.": "emporioFseLot",
  "Le quantità restano separate per prodotto e unità di misura e non vengono sommate tra unità eterogenee.": "emporioUnits",
  "Pasto erogato = record mensa_pasti registrato nella data civile Europe/Rome.": "mensaMeal",
  "Persona servita = beneficiario distinto dei pasti; un accesso negato non conta.": "mensaServedPerson",
  "Media pasti = pasti diviso giornate con almeno un servizio, non giorni di calendario.": "mensaAverage",
  "Intervento UDS = persona con flag uds e intervento ambito uds oppure NULL legacy.": "udsIntervention",
  "Primo contatto = numero cronologico 1 sull'intera storia della persona, prima di applicare il periodo.": "udsFirstContact",
  "Le note libere non vengono interpretate né incluse nelle dimensioni statistiche.": "udsFreeNotes",
  "La giacenza reale è la somma delle quantità residue dei lotti.": "logisticsStock",
  "I movimenti sono eventi di audit; non costituiscono una seconda giacenza.": "logisticsMovements",
  "Giacenze e quantità movimentate sono aggregate separatamente per unità di misura.": "logisticsUnits",
  "La provenienza FSE+ è determinata esclusivamente dal lotto movimentato.": "fseProvenance",
  "Una persona raggiunta è il titolare o un membro registrato di un nucleo con distribuzione FSE+.": "fseReachedPerson",
  "Le celle SIFEAD non supportate dal modello restano MANCANTI e non assumono valore zero.": "fseMissingCells",
  "Le sorgenti FSE+ sono incluse solo quando modulo, area e permessi del chiamante lo consentono.": "fseSources",
  "I canali sono confrontati per documenti e nuclei; le quantità restano separate per unità di misura.": "fseChannels",
  "I record legacy con ambito NULL seguono la vista Sociale corrente.": "qualitySocialLegacy",
  "Le tipologie sono configurabili e non possiedono una categoria semantica accoglienza/follow-up.": "qualitySocialClassification",
  "Gli interventi legacy NULL seguono la compatibilità UDS esistente.": "qualityUdsLegacy",
  "Senza lotto non è possibile attribuire con certezza la provenienza FSE+.": "qualityMissingLot",
  "Solo le quantità già espresse in kg confluiscono nei kg calcolabili.": "qualityKgOnly",
  "I campi mancanti sono esposti come non disponibili, mai come zero.": "qualityMissingFields",
  "Il lotto è autorevole": "sifeadLotAuthoritative",
  "Titolare più membri registrati": "sifeadHouseholdMembers",
  "Con controllo dei valori mancanti": "sifeadMissingValueCheck",
  "areaProvenienza non equivale alla definizione SIFEAD": "sifeadOriginMismatch",
  "numDisabili non identifica persone": "sifeadDisabilityAggregate",
  "Extra-UE non viene reinterpretato": "sifeadExtraEu",
  "Le note libere non vengono analizzate": "sifeadFreeNotes",
  "Lo stato anagrafica non viene reinterpretato": "sifeadRegistryStatus",
  "Serve una decisione funzionale di mapping": "sifeadMappingDecision",
  "I trasferimenti alla Mensa non provano il consumo nel pasto": "sifeadMensaConsumption",
  "Classificazione continuativo non presente nel modello": "sifeadContinuousMissing",
  "Attribuzione FSE+ del singolo pasto non disponibile": "sifeadMealAttributionMissing",
  "Classificazione saltuario non presente nel modello": "sifeadOccasionalMissing",
  "Gli interventi UDS non registrano una distribuzione FSE+ strutturata": "sifeadUdsDistributionMissing",
  "Tipologie intervento non mappate a misure FSE+": "sifeadMeasuresMissing",
  "Il modello operativo non rende disponibile questo dettaglio senza inferenze.": "missingSheetDetail",
};

const dynamicTexts: Array<{
  pattern: RegExp;
  key: string;
}> = [
  { pattern: /^Fascia valutata alla data finale (\d{4}-\d{2}-\d{2})\.$/, key: "qualityAgeDate" },
  { pattern: /^Le fasce d'età delle persone uniche sono calcolate alla data finale (\d{4}-\d{2}-\d{2})\.$/, key: "mensaAgeDate" },
  { pattern: /^Scadenze e merce scaduta sono valutate sulla data civile finale (\d{4}-\d{2}-\d{2})\.$/, key: "logisticsExpiryDate" },
  { pattern: /^Le fasce d'età sono valutate alla data finale (\d{4}-\d{2}-\d{2})\.$/, key: "fseAgeDate" },
  { pattern: /^Reference date (\d{4}-\d{2}-\d{2})$/, key: "sifeadReferenceDate" },
];

export function localizeReportingText(t: Translate, value: string): string {
  if (value === "OK") return t("reporting.status.ok");
  if (value === "DERIVABILE") return t("reporting.status.derivable");
  if (value === "MANCANTE") return t("reporting.status.missing");
  const exactKey = reportingTextKeys[value];
  if (exactKey) return t(`reporting.text.${exactKey}`);
  for (const entry of dynamicTexts) {
    const match = value.match(entry.pattern);
    if (match) return t(`reporting.text.${entry.key}`, { date: match[1] });
  }
  return value;
}
