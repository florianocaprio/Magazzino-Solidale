import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  type ComponentType,
} from "react";
import {
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  documentAuthContext,
  documentErrorStatus,
} from "./use-documento-access";

const owners: Record<string, string> = {
  updateAccessoEmporio: "accesso",
  updateAccessoEmporioStato: "accesso",
  createAccessoEmporio: "accesso",
  apriSessioneCassaEmporio: "sessione",
  forzaAccessoEmporioCassa: "sessione",
  addSessioneCassaEmporioRiga: "sessione",
  updateSessioneCassaEmporioRiga: "sessione",
  deleteSessioneCassaEmporioRiga: "sessione",
  sospendiSessioneCassaEmporio: "sessione",
  riprendiSessioneCassaEmporio: "sessione",
  annullaSessioneCassaEmporio: "sessione",
  preparaChiusuraSessioneCassaEmporio: "sessione",
  chiudiSessioneCassaEmporio: "sessione",
  stornaSpesaEmporio: "spesa",
  registraInvioManualeBollaSpesaEmporio: "spesa",
  createCreditoSolidaleRicaricaManuale: "beneficiario",
  createCreditoSolidaleRettifica: "beneficiario",
  refreshCreditoSolidaleBeneficiario: "beneficiario",
};
function queryOwner(key: QueryKey) {
  const path = typeof key[0] === "string" ? key[0] : "";
  const match = path.match(
    /^\/api\/(?:accessi-emporio\/(\d+)|cassa-emporio\/sessioni\/(\d+)|spese-emporio\/(\d+)|credito-solidale\/beneficiari\/(\d+))(?:\/|$)/,
  );
  if (!match) return null;
  const index = match.slice(1).findIndex(Boolean);
  return {
    kind: ["accesso", "sessione", "spesa", "beneficiario"][index],
    id: Number(match[index + 1]),
  };
}
export function emporioCommandMatches(
  key: QueryKey,
  command: string,
  input: unknown,
) {
  const owner = queryOwner(key);
  const values = input as { id?: number; beneficiarioId?: number } | undefined;
  return (
    !!owner &&
    owners[command] === owner.kind &&
    (owner.kind === "beneficiario" ? values?.beneficiarioId : values?.id) ===
      owner.id
  );
}
export function emporioReadDenied(error: unknown) {
  return [401, 403, 404].includes(documentErrorStatus(error) ?? 0);
}
export function emporioCommandRefreshes(
  key: QueryKey,
  command: string,
  input: unknown,
) {
  const paths: Record<string, string[]> = {
    accesso: [
      "/api/accessi-emporio",
      "/api/accessi-emporio/beneficiari/ricerca",
    ],
    sessione: [
      "/api/cassa-emporio/sessioni",
      "/api/cassa-emporio/beneficiari/ricerca",
    ],
    spesa: ["/api/spese-emporio"],
    beneficiario: [
      "/api/credito-solidale/beneficiari",
      "/api/credito-solidale/movimenti",
    ],
  };
  return (
    emporioCommandMatches(key, command, input) ||
    (paths[owners[command]] ?? []).includes(String(key[0]))
  );
}
export function emporioReadableData<T>(query: { data?: T; error?: unknown }) {
  return emporioReadDenied(query.error) ? undefined : query.data;
}

/** Un errore d'azione provoca solo GET canoniche, mai il retry del comando.
 * ID tipizzati: una Spesa 7 non è la Sessione 7. Solo intenzioni iniziate nel contesto corrente. */
export function observeEmporioCommands(client: QueryClient, context: string) {
  const started = new WeakSet<object>();
  return client.getMutationCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const mutation = event.mutation,
      command = mutation.options.mutationKey?.[0];
    if (typeof command !== "string" || !owners[command]) return;
    if (event.action.type === "pending") started.add(mutation);
    if (event.action.type !== "error" || !started.has(mutation)) return;
    started.delete(mutation);
    if (!emporioReadDenied(mutation.state.error)) return;
    if (documentErrorStatus(mutation.state.error) === 401)
      void client.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    void client.refetchQueries(
      {
        predicate: (query) =>
          query.queryKey.at(-1) === context &&
          emporioCommandRefreshes(
            query.queryKey,
            command,
            mutation.state.variables,
          ),
      },
      { cancelRefetch: true },
    );
  });
}
export function useEmporioSecurity(resource: number | null = null) {
  const client = useQueryClient(),
    { user } = useAuth();
  const context = documentAuthContext(user ?? null);
  const current = useRef({ context, resource, mounted: true });
  current.current.context = context;
  current.current.resource = resource;
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  useEffect(() => observeEmporioCommands(client, context), [client, context]);
  return useMemo(
    () => ({
      context,
      isCurrent: () =>
        current.current.mounted &&
        current.current.context === context &&
        current.current.resource === resource,
      readOptions: (key: QueryKey) => ({
        queryKey: [...key, context],
        retry: false as const,
        staleTime: 0,
        refetchOnWindowFocus: "always" as const,
      }),
    }),
    [context, resource],
  );
}

/** Un nuovo contesto autenticato non eredita draft o PII nello stato locale.
 * Un semplice errore di comando non cambia questa chiave e conserva i draft. */
export function withEmporioSecurity(Page: ComponentType) {
  return function EmporioSecurityBoundary() {
    const { user } = useAuth();
    return createElement(Page, { key: documentAuthContext(user ?? null) });
  };
}
