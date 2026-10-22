import { createContext, useContext, useEffect, useLayoutEffect, useState, Fragment, type ReactNode } from "react";
import { useLocation } from "wouter";
import { authorizationSignature, isIdentityQuery } from "./auth-cache";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCurrentUser,
  useGetConfigurazioneAmbientePubblica,
  getGetConfigurazioneAmbientePubblicaQueryKey,
  getGetCurrentUserQueryKey,
  useGetBootstrapStatus,
  getGetBootstrapStatusQueryKey,
  useLogoutUser,
  type AuthUser,
} from "@workspace/api-client-react";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  bootstrap: boolean;
  bootstrapLoading: boolean;
  refreshBootstrap: () => void;
  hasArea: (area: string) => boolean;
  hasPermission: (permission: string) => boolean;
  setUser: (user: AuthUser) => void;
  refresh: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CURRENT_USER_KEY = getGetCurrentUserQueryKey();
const BOOTSTRAP_KEY = getGetBootstrapStatusQueryKey();

type AuthAccessUser = Pick<AuthUser, "isAdmin"> &
  Partial<Pick<AuthUser, "aree" | "permessi">>;

export function authUserHasArea(
  user: AuthAccessUser | null | undefined,
  area: string,
): boolean {
  if (!user) return false;
  if (user.isAdmin) return true;
  if (area === "amministrazione") return false;
  return (user.aree ?? []).includes(area);
}

export function authUserHasPermission(
  user: AuthAccessUser | null | undefined,
  permission: string,
): boolean {
  if (!user) return false;
  return user.isAdmin || (user.permessi ?? []).includes(permission);
}

export function authUserCanOperateBolle(
  user: AuthAccessUser | null | undefined,
  permission: string,
): boolean {
  return Boolean(
    user &&
    (user.isAdmin || user.aree?.includes("magazzino")) &&
    authUserHasPermission(user, permission),
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetCurrentUser({
    query: {
      queryKey: CURRENT_USER_KEY,
      retry: false,
      staleTime: 0,
      refetchInterval: 30_000,
      refetchOnWindowFocus: "always",
      refetchOnReconnect: "always",
    },
  });
  const { data: bootstrapData, isLoading: bootstrapLoading } =
    useGetBootstrapStatus({
      query: {
        queryKey: BOOTSTRAP_KEY,
        retry: false,
        staleTime: 0,
      },
    });
  const logoutMutation = useLogoutUser();

  const user = isError ? null : (data ?? null);
  const bootstrap = bootstrapData?.bootstrap ?? false;
  const environment = useGetConfigurazioneAmbientePubblica({ query: {
    queryKey: getGetConfigurazioneAmbientePubblicaQueryKey(), enabled: !!user, staleTime: 30_000, refetchInterval: 30_000, refetchOnWindowFocus: "always", retry: false,
  } });
  const signature = JSON.stringify([authorizationSignature(user), environment.isError ? "unavailable" : [...(environment.data?.moduliAttivi ?? [])].sort()]);
  const [settledScope, setSettledScope] = useState<string | null>(null);
  const [location] = useLocation();
  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
  }, [location, queryClient]);
  useLayoutEffect(() => {
    let current = true;
    // Hide the old scope until in-flight reads are cancelled and its cached
    // payloads removed. A keyed subtree also discards drafts and local details.
    void queryClient.cancelQueries({ predicate: (query) => !isIdentityQuery(query.queryKey) }).then(() => {
      if (!current) return;
      queryClient.removeQueries({ predicate: (query) => !isIdentityQuery(query.queryKey) });
      queryClient.getMutationCache().clear();
      setSettledScope(signature);
    });
    return () => { current = false; };
  }, [signature, queryClient]);

  const hasArea = (area: string): boolean => {
    return authUserHasArea(user, area);
  };

  const hasPermission = (permission: string): boolean => {
    return authUserHasPermission(user, permission);
  };

  const setUser = (next: AuthUser) => {
    queryClient.setQueryData(CURRENT_USER_KEY, next);
  };

  const refresh = async () => {
    await queryClient.refetchQueries({
      queryKey: CURRENT_USER_KEY,
      type: "active",
    });
  };

  const refreshBootstrap = () => {
    queryClient.invalidateQueries({ queryKey: BOOTSTRAP_KEY });
  };

  const logout = () => {
    logoutMutation.mutate(undefined, {
      onSettled: () => {
        queryClient.clear();
      },
    });
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: isLoading || settledScope !== signature,
        bootstrap,
        bootstrapLoading,
        refreshBootstrap,
        hasArea,
        hasPermission,
        setUser,
        refresh,
        logout,
      }}
    >
      <Fragment key={signature}>{children}</Fragment>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
