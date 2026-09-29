import type { QueryClient } from "@tanstack/react-query";
import {
  getGetBollaQueryKey,
  getGetDocumentoOperativoQueryKey,
  getListBolleQueryKey,
  getListDocumentiOperativiQueryKey,
  getListGiacenzeQueryKey,
  getListRichiesteMagazzinoQueryKey,
  getListConsegneQueryKey,
} from "@workspace/api-client-react";

/** The linked document detail, not GET /bolle/:id, feeds the operational UI. */
export async function invalidateBollaViews(
  queryClient: QueryClient,
  bollaId: number,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: getGetBollaQueryKey(bollaId) }),
    queryClient.invalidateQueries({
      queryKey: getGetDocumentoOperativoQueryKey("bolla", bollaId),
    }),
    queryClient.invalidateQueries({
      queryKey: getListDocumentiOperativiQueryKey(),
    }),
    queryClient.invalidateQueries({ queryKey: getListBolleQueryKey() }),
    queryClient.invalidateQueries({
      queryKey: getListRichiesteMagazzinoQueryKey(),
    }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        String(query.queryKey[0]).startsWith("/api/richieste-magazzino/"),
    }),
    queryClient.invalidateQueries({ queryKey: getListGiacenzeQueryKey() }),
    queryClient.invalidateQueries({ queryKey: getListConsegneQueryKey() }),
  ]);
}

export function bollaErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as {
    data?: { error?: string };
    response?: { data?: { error?: string } };
    message?: string;
  } | null;
  return (
    candidate?.data?.error ??
    candidate?.response?.data?.error ??
    candidate?.message ??
    fallback
  );
}
