export interface AreaDef {
  key: string;
  label: string;
}

export const ALL_AREAS: AreaDef[] = [
  { key: "generale", label: "Generale" },
  { key: "magazzino", label: "Magazzino" },
  { key: "sociale", label: "Sociale" },
  { key: "uds", label: "Unità di Strada" },
  { key: "logistica", label: "Logistica" },
  { key: "analisi", label: "Analisi" },
  { key: "amministrazione", label: "Amministrazione" },
];

export const AREA_LABEL: Record<string, string> = Object.fromEntries(
  ALL_AREAS.map((a) => [a.key, a.label]),
);
