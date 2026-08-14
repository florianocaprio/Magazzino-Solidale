import { isCivilDate, todayEuropeRome } from "./europe-rome";

export const INTERVENTI_SOCIALI_VISTE = [
  "da_pianificare",
  "pianificati",
  "oggi",
  "in_corso",
  "conclusi",
  "annullati",
] as const;

export type InterventiSocialiVista = (typeof INTERVENTI_SOCIALI_VISTE)[number];
export type InterventiSocialiModo = "elenco" | "calendario";

export interface InterventiSocialiFilters {
  vista: InterventiSocialiVista;
  modo: InterventiSocialiModo;
  ricerca: string;
  tipo: string;
  priorita: string;
  operatoreId: string;
  centroAscoltoId: string;
  cittaId: string;
  stato: string;
  ambitoLegacy: "tutti" | "classificati" | "legacy";
  da: string;
  a: string;
  ordina: "default" | "data" | "priorita" | "beneficiario" | "operatore";
  direzione: "asc" | "desc";
  mese: string;
  giorno: string;
}

const PRIORITA = new Set(["bassa", "normale", "alta", "urgente"]);
const STATI = new Set([
  "da_pianificare",
  "pianificato",
  "in_corso",
  "concluso",
  "annullato",
  "mancata_presentazione",
]);
const ORDINI = new Set(["data", "priorita", "beneficiario", "operatore"]);

function positiveId(value: string | null): string {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? value : "";
}

export function defaultInterventiSocialiFilters(
  referenceDate = new Date(),
): InterventiSocialiFilters {
  const today = todayEuropeRome(referenceDate);
  return {
    vista: "oggi",
    modo: "elenco",
    ricerca: "",
    tipo: "",
    priorita: "",
    operatoreId: "",
    centroAscoltoId: "",
    cittaId: "",
    stato: "",
    ambitoLegacy: "tutti",
    da: "",
    a: "",
    ordina: "default",
    direzione: "asc",
    mese: today.slice(0, 7),
    giorno: today,
  };
}

export function parseInterventiSocialiFilters(
  search: string,
  referenceDate = new Date(),
): InterventiSocialiFilters {
  const defaults = defaultInterventiSocialiFilters(referenceDate);
  const params = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  );
  const vista = params.get("vista");
  const modo = params.get("modo");
  const legacy = params.get("legacy");
  const da = params.get("da") ?? "";
  const a = params.get("a") ?? "";
  const mese = params.get("mese") ?? "";
  const giorno = params.get("giorno") ?? "";
  const ordina = params.get("ordina");
  const selectedVista = INTERVENTI_SOCIALI_VISTE.includes(
    vista as InterventiSocialiVista,
  )
    ? (vista as InterventiSocialiVista)
    : defaults.vista;
  const calendarAllowed =
    selectedVista === "pianificati" || selectedVista === "oggi";
  return {
    vista: selectedVista,
    modo: modo === "calendario" && calendarAllowed ? "calendario" : "elenco",
    ricerca: (params.get("q") ?? "").slice(0, 120),
    tipo: (params.get("tipo") ?? "").slice(0, 120),
    priorita: PRIORITA.has(params.get("priorita") ?? "")
      ? params.get("priorita")!
      : "",
    operatoreId: positiveId(params.get("operatore")),
    centroAscoltoId: positiveId(params.get("centro")),
    cittaId: positiveId(params.get("citta")),
    stato: STATI.has(params.get("stato") ?? "") ? params.get("stato")! : "",
    ambitoLegacy:
      legacy === "classificati" || legacy === "legacy" ? legacy : "tutti",
    da: isCivilDate(da) ? da : "",
    a: isCivilDate(a) ? a : "",
    ordina: ORDINI.has(ordina ?? "")
      ? (ordina as InterventiSocialiFilters["ordina"])
      : "default",
    direzione: params.get("direzione") === "desc" ? "desc" : "asc",
    mese: /^\d{4}-(0[1-9]|1[0-2])$/.test(mese) ? mese : defaults.mese,
    giorno: isCivilDate(giorno) ? giorno : defaults.giorno,
  };
}

export function serializeInterventiSocialiFilters(
  filters: InterventiSocialiFilters,
): string {
  const params = new URLSearchParams();
  params.set("vista", filters.vista);
  if (filters.modo !== "elenco") params.set("modo", filters.modo);
  if (filters.ricerca) params.set("q", filters.ricerca);
  if (filters.tipo) params.set("tipo", filters.tipo);
  if (filters.priorita) params.set("priorita", filters.priorita);
  if (filters.operatoreId) params.set("operatore", filters.operatoreId);
  if (filters.centroAscoltoId) params.set("centro", filters.centroAscoltoId);
  if (filters.cittaId) params.set("citta", filters.cittaId);
  if (filters.stato) params.set("stato", filters.stato);
  if (filters.ambitoLegacy !== "tutti")
    params.set("legacy", filters.ambitoLegacy);
  if (filters.da) params.set("da", filters.da);
  if (filters.a) params.set("a", filters.a);
  if (filters.ordina !== "default") params.set("ordina", filters.ordina);
  if (filters.direzione !== "asc") params.set("direzione", filters.direzione);
  if (filters.modo === "calendario") {
    params.set("mese", filters.mese);
    params.set("giorno", filters.giorno);
  }
  return `?${params.toString()}`;
}

export function clearInterventiSocialiFilters(
  filters: InterventiSocialiFilters,
): InterventiSocialiFilters {
  return {
    ...defaultInterventiSocialiFilters(),
    vista: filters.vista,
    modo: filters.modo,
    mese: filters.mese,
    giorno: filters.giorno,
  };
}
