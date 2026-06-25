export const ALL_AREAS = [
  { key: "generale", label: "Generale" },
  { key: "magazzino", label: "Magazzino" },
  { key: "sociale", label: "Sociale" },
  { key: "uds", label: "Unità di Strada" },
  { key: "logistica", label: "Logistica" },
  { key: "analisi", label: "Analisi" },
  { key: "amministrazione", label: "Amministrazione" },
] as const;

export const ALL_AREA_KEYS: string[] = ALL_AREAS.map((a) => a.key);

/**
 * Maps the first URL segment (under `/api`) to the access area(s) that govern it.
 * Used by the area-guard middleware to enforce role-based area access server-side.
 * A segment may map to MULTIPLE areas (e.g. beneficiari/interventi are shared by
 * the Sociale and UDS staff): access is granted if the caller has ANY of them.
 */
export const AREA_BY_SEGMENT: Record<string, string | string[]> = {
  dashboard: "generale",

  magazzini: "magazzino",
  prodotti: "magazzino",
  lotti: "magazzino",
  movimenti: "magazzino",
  giacenze: "magazzino",
  trasferimenti: "magazzino",

  "centri-ascolto": "sociale",
  beneficiari: ["sociale", "uds"],
  interventi: ["sociale", "uds"],
  consegne: "sociale",
  bolle: "sociale",
  scarichi: "sociale",

  volontari: "logistica",
  mezzi: "logistica",
  fornitori: "logistica",
  approvvigionamenti: "logistica",

  report: "analisi",

  "impostazioni-stampa": "amministrazione",
  utenti: "amministrazione",
  ruoli: "amministrazione",
  aree: "amministrazione",
};
