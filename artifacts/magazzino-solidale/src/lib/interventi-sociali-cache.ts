import {
  getGetInterventiRiepilogoVisteQueryKey,
  getGetInterventoOperativitaQueryKey,
  getGetInterventoQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventiQueryKey,
  getListInterventoStoricoStatiQueryKey,
} from "@workspace/api-client-react";

interface QueryInvalidator {
  invalidateQueries: (filters: {
    queryKey: readonly unknown[];
  }) => Promise<unknown>;
}

export async function invalidateInterventiSociali(
  queryClient: QueryInvalidator,
  interventoId?: number,
): Promise<void> {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: getListInterventiQueryKey() }),
    queryClient.invalidateQueries({
      queryKey: getGetInterventiRiepilogoVisteQueryKey(),
    }),
    queryClient.invalidateQueries({
      queryKey: getListInterventiOperatoriQueryKey(),
    }),
  ];
  if (interventoId != null) {
    invalidations.push(
      queryClient.invalidateQueries({
        queryKey: getGetInterventoQueryKey(interventoId),
      }),
      queryClient.invalidateQueries({
        queryKey: getGetInterventoOperativitaQueryKey(interventoId),
      }),
      queryClient.invalidateQueries({
        queryKey: getListInterventoStoricoStatiQueryKey(interventoId),
      }),
    );
  }
  await Promise.all(invalidations);
}
