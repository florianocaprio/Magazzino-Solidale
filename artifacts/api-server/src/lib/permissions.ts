export const MENSA_PERMISSIONS = [
  { key: "mensa.view", label: "Mensa: consultazione" },
  { key: "mensa.manage", label: "Mensa: configurazione mense" },
  { key: "mensa.access.scan", label: "Mensa: scansione tessere" },
  { key: "mensa.access.manual", label: "Mensa: ricerca manuale" },
  {
    key: "mensa.access.temporary",
    label: "Mensa: accesso temporaneo motivato",
  },
  { key: "mensa.meals.create", label: "Mensa: registrazione pasti" },
  { key: "mensa.meals.override", label: "Mensa: secondo pasto in deroga" },
  { key: "mensa.eligibility.manage", label: "Mensa: gestione abilitazioni" },
  {
    key: "mensa.exceptions.manage",
    label: "Mensa: eccezioni nella stessa Area",
  },
  { key: "mensa.transfers.manage", label: "Mensa: rifornimenti" },
  { key: "mensa.reports.view", label: "Mensa: report" },
  { key: "mensa.cards.manage", label: "Mensa: gestione tessere" },
] as const;

export const BENEFICIARI_PERMISSIONS = [
  {
    key: "beneficiari.view",
    label: "Beneficiari: consultazione directory e anagrafica",
  },
  { key: "beneficiari.manage", label: "Beneficiari: gestione anagrafica" },
  {
    key: "beneficiari.sensitive.view",
    label: "Beneficiari: consultazione dossier sensibile",
  },
  {
    key: "beneficiari.deactivate",
    label: "Beneficiari: disattivazione e riattivazione",
  },
  { key: "beneficiari.export", label: "Beneficiari: esportazione dati" },
  {
    key: "beneficiari.duplicates.search",
    label: "Beneficiari: ricerca anti-duplicato",
  },
  {
    key: "beneficiari.cards.manage",
    label: "Beneficiari: emissione tessere trasversali",
  },
] as const;

export const CREDITO_PERMISSIONS = [
  { key: "credito.view", label: "Credito Solidale: consultazione" },
  {
    key: "credito.quota.manage",
    label: "Credito Solidale: gestione quota assegnata",
  },
  {
    key: "credito.adjust",
    label: "Credito Solidale: ricariche, rettifiche e storni",
  },
  {
    key: "credito.monthly.execute",
    label: "Credito Solidale: esecuzione ricariche mensili",
  },
] as const;

export const EMPORIO_ACCESS_PERMISSIONS = [
  { key: "emporio.access.view", label: "Emporio: consultazione accessi" },
  { key: "emporio.access.manage", label: "Emporio: gestione accessi" },
] as const;

export const SOCIALE_INTERVENTI_PERMISSIONS = [
  {
    key: "sociale.interventi.view",
    label: "Interventi Sociali: consultazione",
  },
  { key: "sociale.interventi.create", label: "Interventi Sociali: creazione" },
  {
    key: "sociale.interventi.update",
    label: "Interventi Sociali: modifica e operatività",
  },
  {
    key: "sociale.interventi.complete",
    label: "Interventi Sociali: avvio e conclusione",
  },
  {
    key: "sociale.interventi.cancel",
    label: "Interventi Sociali: annullamento e mancata presentazione",
  },
] as const;

export const MAPS_PERMISSIONS = [
  {
    key: "maps.route",
    label: "MAPS: apertura percorsi su attività autorizzate",
  },
  {
    key: "maps.operational",
    label: "MAPS: accesso alla mappa operativa",
  },
] as const;

export const ALL_PERMISSIONS = [
  ...MENSA_PERMISSIONS,
  ...BENEFICIARI_PERMISSIONS,
  ...CREDITO_PERMISSIONS,
  ...EMPORIO_ACCESS_PERMISSIONS,
  ...SOCIALE_INTERVENTI_PERMISSIONS,
  ...MAPS_PERMISSIONS,
] as const;
export const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((item) => item.key);

export type PermissionKey = (typeof ALL_PERMISSIONS)[number]["key"];
