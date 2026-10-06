import type { QueryClient } from "@tanstack/react-query";
import {
  getGetBollaQueryKey,
  getGetDocumentoOperativoQueryKey,
  getListBolleQueryKey,
  getListDocumentiOperativiQueryKey,
  getListGiacenzeQueryKey,
  getListRichiesteMagazzinoQueryKey,
  getListConsegneQueryKey,
  getListBollePronteDaPianificareQueryKey,
} from "@workspace/api-client-react";

/** Cross-workflow reads; use stock=true only for inventory/reservation effects. */
export async function invalidateRequestWorkflowViews(
  queryClient: QueryClient,
  stock = false,
): Promise<void> {
  const prefixes = [
    "/api/richieste-magazzino",
    "/api/documenti-operativi",
    "/api/bolle",
    "/api/trasferimenti",
    "/api/consegne",
    "/api/interventi",
  ];
  if (stock) prefixes.push("/api/giacenze");
  await queryClient.invalidateQueries({
    predicate: (query) =>
      prefixes.some(
        (prefix) =>
          String(query.queryKey[0]) === prefix ||
          String(query.queryKey[0]).startsWith(prefix + "/"),
      ),
  });
}

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
    queryClient.invalidateQueries({
      queryKey: getListBollePronteDaPianificareQueryKey(),
    }),
    queryClient.invalidateQueries({
      predicate: (query) =>
        String(query.queryKey[0]).startsWith("/api/interventi"),
    }),
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
