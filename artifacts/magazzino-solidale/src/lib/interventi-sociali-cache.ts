import {
  getGetInterventiRiepilogoVisteQueryKey,
  getListInterventiOperatoriQueryKey,
  getListInterventiQueryKey,
} from "@workspace/api-client-react";

interface QueryInvalidator {
  invalidateQueries: (filters: {
    queryKey: readonly unknown[];
  }) => Promise<unknown>;
}

export async function invalidateInterventiSociali(
  queryClient: QueryInvalidator,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getListInterventiQueryKey() }),
    queryClient.invalidateQueries({
      queryKey: getGetInterventiRiepilogoVisteQueryKey(),
    }),
    queryClient.invalidateQueries({
      queryKey: getListInterventiOperatoriQueryKey(),
    }),
  ]);
}
