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
  "preparazione-consegne": "magazzino",

  // Read by several operational areas to populate filters/forms; mutations are
  // admin-gated in the route.
  "centri-ascolto": ["sociale", "uds", "magazzino", "logistica", "analisi"],
  beneficiari: ["sociale", "uds"],
  interventi: ["sociale", "uds"],
  consegne: "sociale",
  bolle: "sociale",
  scarichi: "sociale",
  turni: "sociale",

  volontari: "logistica",
  // Mapped to "logistica" so non-admin logistica staff can READ the list to
  // populate the volontari form (admins always pass via isAdmin). Note: a segment
  // mapped to "amministrazione" would auto-deny every non-admin in areaGuard, so it
  // must NOT be listed here. Mutations are admin-gated with requireAdmin in the route.
  "ruoli-volontari": "logistica",
  // Read by sociale + uds staff to populate the interventi type selects; mutations
  // are admin-gated with requireAdmin in the route. Must NOT be "amministrazione"
  // (that would auto-deny every non-admin in areaGuard).
  "tipi-intervento": ["sociale", "uds"],
  mezzi: "logistica",
  fornitori: "logistica",
  // Read by logistica staff to populate the fornitori type select; mutations are
  // admin-gated with requireAdmin in the route. Must NOT be "amministrazione"
  // (that would auto-deny every non-admin in areaGuard).
  "tipologie-fornitore": "logistica",
  approvvigionamenti: "logistica",
  "approvazioni-logistica": "logistica",

  report: "analisi",

  "impostazioni-stampa": "amministrazione",
  "impostazioni-email": "amministrazione",
  "impostazioni-moduli": ALL_AREA_KEYS,
  "politiche-credito-solidale": "amministrazione",
  "credito-solidale": ["sociale", "uds"],
  utenti: "amministrazione",
  ruoli: "amministrazione",
  aree: "amministrazione",
};
