export const MENSA_PERMISSIONS = [
  { key: "mensa.view", label: "Mensa: consultazione" },
  { key: "mensa.manage", label: "Mensa: configurazione mense" },
  { key: "mensa.access.scan", label: "Mensa: scansione tessere" },
  { key: "mensa.access.manual", label: "Mensa: ricerca manuale" },
  { key: "mensa.meals.create", label: "Mensa: registrazione pasti" },
  { key: "mensa.meals.override", label: "Mensa: secondo pasto in deroga" },
  { key: "mensa.eligibility.manage", label: "Mensa: gestione abilitazioni" },
  { key: "mensa.exceptions.manage", label: "Mensa: eccezioni stessa città" },
  { key: "mensa.transfers.manage", label: "Mensa: rifornimenti" },
  { key: "mensa.reports.view", label: "Mensa: report" },
  { key: "mensa.cards.manage", label: "Mensa: gestione tessere" },
] as const;

export const ALL_PERMISSIONS = [...MENSA_PERMISSIONS] as const;
export const ALL_PERMISSION_KEYS = ALL_PERMISSIONS.map((item) => item.key);

export type PermissionKey = (typeof ALL_PERMISSIONS)[number]["key"];
