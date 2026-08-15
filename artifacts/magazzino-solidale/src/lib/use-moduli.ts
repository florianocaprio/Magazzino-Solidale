import {
  getGetConfigurazioneAmbientePubblicaQueryKey,
  useGetConfigurazioneAmbientePubblica,
} from "@workspace/api-client-react";

export const EMPORIO_DISABLED_MESSAGE = "Il modulo Emporio Solidale è disabilitato.";
export const UNITA_STRADA_DISABLED_MESSAGE = "La gestione Unità di Strada è disabilitata.";

export const MODULO_BY_ROUTE: Record<string, string> = {
  "/beneficiari": "CENTRO_ASCOLTO",
  "/interventi": "CENTRO_ASCOLTO",
  "/turni": "CENTRO_ASCOLTO",
  "/centri-ascolto": "CENTRO_ASCOLTO",
  "/preparazione-consegne": "MAGAZZINO_SOLIDALE",
  "/scarichi": "SCARICHI",
  "/lotti": "LOTTI",
  "/trasferimenti": "TRASFERIMENTI",
  "/approvvigionamenti": "APPROVVIGIONAMENTI",
  "/volontari": "VOLONTARI",
  "/mezzi": "MEZZI",
  "/consegne": "CONSEGNE",
  "/bolle": "BOLLE",
  "/fornitori": "FORNITORI",
  "/report": "REPORT",
  "/uds/anagrafica": "UDS",
  "/uds/interventi": "UDS",
  "/uds/report-giornaliero": "UDS",
  "/report-uds": "UDS",
  "/zone-uds": "UDS",
  "/emporio/cassa": "EMPORIO_SOLIDALE",
  "/emporio/accessi": "EMPORIO_SOLIDALE",
  "/emporio/spese": "EMPORIO_SOLIDALE",
  "/emporio/crediti-saldo": "CREDITO_SOLIDALE",
  "/politiche-credito-solidale": "CREDITO_SOLIDALE",
};

export function areAllModuliAttivi(
  codici: readonly string[],
  isAttivo: (codice: string) => boolean,
): boolean {
  return codici.every(isAttivo);
}

export function isAnyModuloAttivo(
  codici: readonly string[],
  isAttivo: (codice: string) => boolean,
): boolean {
  return codici.some(isAttivo);
}

export function useModuloFlags() {
  const query = useGetConfigurazioneAmbientePubblica({
    query: {
      queryKey: getGetConfigurazioneAmbientePubblicaQueryKey(),
      staleTime: 60_000,
    },
  });
  const activeCodes = new Set(query.data?.moduliAttivi ?? []);
  const hasConfig = !!query.data && !query.isError;

  return {
    ...query,
    emporioAbilitato: hasConfig ? activeCodes.has("EMPORIO_SOLIDALE") : false,
    unitaStradaAbilitata: hasConfig ? activeCodes.has("UDS") : true,
  };
}

export function useConfigurazioneAmbienteFlags() {
  const query = useGetConfigurazioneAmbientePubblica({
    query: {
      queryKey: getGetConfigurazioneAmbientePubblicaQueryKey(),
      staleTime: 60_000,
    },
  });

  const activeCodes = new Set(query.data?.moduliAttivi ?? []);
  const hasConfig = !!query.data && !query.isError;
  const isModuloAttivo = (codice?: string | null): boolean => {
    if (!codice) return true;
    if (!hasConfig) return true;
    return activeCodes.has(codice);
  };
  const areAllModuliAttiviForEnvironment = (codici: readonly string[]) =>
    areAllModuliAttivi(codici, (codice) => isModuloAttivo(codice));
  const isAnyModuloAttivoForEnvironment = (codici: readonly string[]) =>
    isAnyModuloAttivo(codici, (codice) => isModuloAttivo(codice));

  return {
    ...query,
    configurazione: query.data?.configurazione ?? null,
    moduli: query.data?.moduli ?? [],
    moduliAttivi: query.data?.moduliAttivi ?? [],
    isModuloAttivo,
    areAllModuliAttivi: areAllModuliAttiviForEnvironment,
    isAnyModuloAttivo: isAnyModuloAttivoForEnvironment,
  };
}
