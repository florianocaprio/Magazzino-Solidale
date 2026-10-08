import { useEffect, useMemo, useRef } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  getGetDocumentoOperativoQueryKey,
  useGetDocumentoOperativo,
  type AuthUser,
} from "@workspace/api-client-react";

type Document = { tipo: "bolla" | "trasferimento"; id: number };

export function documentAuthContext(user: AuthUser | null) {
  return JSON.stringify({
    id: user?.id,
    centro: user?.centroAscoltoId,
    area: user?.areaOperativaId,
    zona: user?.zonaUdsId,
    admin: user?.isAdmin,
    aree: user?.aree,
    permessi: user?.permessi,
  });
}

// Operation IDs generated from OpenAPI. Numeric IDs alone cannot identify owners.
const commands = {
  bolla: new Set([
    "updateBolla",
    "addBollaRiga",
    "deleteBollaRiga",
    "confermaBolla",
    "annullaBolla",
    "stornaAmministrativamenteBolla",
    "consegnaBolla",
    "affidaBolla",
    "segnalaMancataConsegnaBolla",
    "registraRientroBolla",
    "segnalaRitiroNonEffettuato",
    "convertiBollaInConsegna",
    "pianificaConsegnaDaBolla",
  ]),
  trasferimento: new Set([
    "updateTrasferimento",
    "preparaTrasferimento",
    "annullaTrasferimento",
    "avviaTrasferimento",
    "confermaTrasferimento",
    "segnalaMancatoArrivoTrasferimento",
    "registraRientroTrasferimento",
  ]),
};

export function documentCommandMatches(
  document: Document,
  key: readonly unknown[] | undefined,
  variables: unknown,
): boolean {
  if (
    key?.length !== 1 ||
    typeof key[0] !== "string" ||
    !variables ||
    typeof variables !== "object"
  )
    return false;
  const input = variables as { id?: number; data?: { bollaId?: number } };
  // associaBolla.id is a Consegna ID, not the Bolla ID.
  if (key[0] === "associaBolla")
    return document.tipo === "bolla" && input.data?.bollaId === document.id;
  return commands[document.tipo].has(key[0]) && input.id === document.id;
}

export function documentErrorStatus(error: unknown): number | undefined {
  const value = error as {
    status?: number;
    response?: { status?: number };
  } | null;
  return value?.status ?? value?.response?.status;
}

// Only commands started while this exact document/auth context is mounted count.
// Observing the error does NOT decide access: only the subsequent canonical GET does.
export function observeDocumentCommands(
  client: QueryClient,
  document: Document,
  revalidate: (status: number) => void,
) {
  const started = new WeakSet<object>();
  return client.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const mutation = event.mutation;
    if (
      event.action.type === "pending" &&
      documentCommandMatches(
        document,
        mutation.options.mutationKey,
        mutation.state.variables,
      )
    )
      started.add(mutation);
    if (event.action.type !== "error" || !started.has(mutation)) return;
    started.delete(mutation);
    const status = documentErrorStatus(mutation.state.error);
    if (status === 401 || status === 403 || status === 404) revalidate(status);
  });
}

export function useDocumentoAccess(
  document: Document,
  authContext: string,
  enabled: boolean,
) {
  const client = useQueryClient();
  const context = `${document.tipo}:${document.id}:${authContext}`;
  const current = useRef(context);
  current.current = context;
  const queryKey = useMemo(
    () => [
      ...getGetDocumentoOperativoQueryKey(document.tipo, document.id),
      authContext,
    ],
    [document.tipo, document.id, authContext],
  );
  const read = useGetDocumentoOperativo(document.tipo, document.id, {
    query: {
      queryKey,
      enabled,
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: "always",
    },
  });
  useEffect(() => {
    if (!enabled) return;
    return observeDocumentCommands(client, document, (commandStatus) => {
      if (current.current !== context) return;
      if (commandStatus === 401)
        void client.invalidateQueries({
          queryKey: getGetCurrentUserQueryKey(),
        });
      // TanStack cancels the earlier in-flight read (including its AbortSignal),
      // so a late 200 cannot overwrite the result of this newer verification.
      void client.refetchQueries(
        { queryKey, exact: true },
        { cancelRefetch: true },
      );
    });
  }, [client, context, document.tipo, document.id, enabled, queryKey]);
  const status = documentErrorStatus(read.error);
  useEffect(() => {
    if (status === 401)
      void client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
  }, [client, status, read.errorUpdatedAt]);
  const denied = !enabled || status === 401 || status === 403 || status === 404;
  return {
    ...read,
    context,
    denied,
    technicalError: read.isError && !denied,
    blocked: denied || read.isError || read.isFetching,
  };
}
