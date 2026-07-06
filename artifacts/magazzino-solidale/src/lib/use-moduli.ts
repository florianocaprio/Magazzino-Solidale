import { getGetImpostazioniModuliQueryKey, useGetImpostazioniModuli } from "@workspace/api-client-react";

export const EMPORIO_DISABLED_MESSAGE = "Il modulo Emporio Solidale è disabilitato.";
export const UNITA_STRADA_DISABLED_MESSAGE = "La gestione Unità di Strada è disabilitata.";

export function useModuloFlags() {
  const query = useGetImpostazioniModuli({
    query: {
      queryKey: getGetImpostazioniModuliQueryKey(),
      staleTime: 60_000,
    },
  });

  return {
    ...query,
    emporioAbilitato: query.data?.emporioAbilitato ?? false,
    unitaStradaAbilitata: query.data?.unitaStradaAbilitata ?? true,
  };
}
