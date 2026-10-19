import type { QueryClient } from "@tanstack/react-query";
import {
  getListApprovazioniLogisticaQueryKey,
  getListVolontariQueryKey,
  getListMezziQueryKey,
  getListTurniQueryKey,
  getGetVolontariCaricoQueryKey,
  getGetVolontarioQueryKey,
  getGetMezzoQueryKey,
} from "@workspace/api-client-react";

type Cache = Pick<QueryClient, "invalidateQueries">;

/** Refresh resource families, including inactive filtered pickers within staleTime. */
export async function invalidateLogisticaResources(
  cache: Cache,
  kind: "volontari" | "mezzi",
  id?: number,
) {
  const keys: readonly unknown[][] = [
    [...getListApprovazioniLogisticaQueryKey()],
    [...getListTurniQueryKey()],
    [...getListMezziQueryKey()], // A volunteer's Centre also scopes their personal vehicle.
    ...(kind === "volontari" ? [
      [...getListVolontariQueryKey()],
      [...getGetVolontariCaricoQueryKey({ data: "", fascia: "09-13" })].slice(0, 1),
      ["volontario-detail", ...(id == null ? [] : [id])],
      ["volontario-dossier", ...(id == null ? [] : [id])],
    ] : []),
    ...(id == null ? [] : [[...(kind === "volontari" ? getGetVolontarioQueryKey(id) : getGetMezzoQueryKey(id))]]),
  ];
  await Promise.all([
    ...keys.map((queryKey) => cache.invalidateQueries({ queryKey })),
    ...(id != null ? [] : [cache.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith(`/api/${kind}/`) })]),
  ]);
}

export function isStaleLogisticaError(error: unknown): boolean {
  const value = error as { status?: number; data?: { code?: string; error?: string }; response?: { status?: number; data?: { code?: string; error?: string } } };
  const data = value?.data ?? value?.response?.data;
  return (value?.status ?? value?.response?.status) === 409 &&
    (data?.code === "STALE_VERSION" || /aggiornat|versione/i.test(data?.error ?? ""));
}
