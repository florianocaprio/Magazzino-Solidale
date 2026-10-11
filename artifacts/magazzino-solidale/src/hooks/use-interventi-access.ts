import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { AuthUser } from "@workspace/api-client-react";

export function interventiIdentity(user: AuthUser | null | undefined) {
  return JSON.stringify([
    user?.id,
    user?.ruoloId,
    user?.isAdmin,
    [...(user?.aree ?? [])].sort(),
    [...(user?.permessi ?? [])].sort(),
    user?.areaOperativaId,
    user?.centroAscoltoId,
    user?.zonaUdsId,
  ]);
}

export function isInterventoReadDenied(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  return status === 401 || status === 403 || status === 404;
}

/** Only canonical GET errors revoke cached reads; mutation errors do not. */
export function useInterventiAccess(identity: string) {
  const client = useQueryClient();
  const [blocked, setBlocked] = useState(false);
  const alive = useRef(true);
  const revoked = useRef(false);
  const namespace = useMemo(() => ({ socialIdentity: identity }), [identity]);
  const predicate = (query: { queryKey: QueryKey }) =>
    query.queryKey.some(
      (part) =>
        part != null &&
        typeof part === "object" &&
        "socialIdentity" in part &&
        part.socialIdentity === identity,
    );
  const purge = () => {
    // Cancel first: a late GET cannot repopulate this identity's removed cache.
    void client
      .cancelQueries({ predicate })
      .then(() => client.removeQueries({ predicate }));
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      purge();
    };
  }, [client, identity]);
  return {
    blocked,
    key: (key: QueryKey): QueryKey => [...key, namespace],
    revoke: () => {
      revoked.current = true;
      setBlocked(true);
      purge();
    },
    assertCurrent: () => {
      if (!alive.current || revoked.current)
        throw new Error("Accesso agli Interventi non più disponibile");
    },
  };
}
