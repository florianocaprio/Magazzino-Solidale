import { createContext, useContext, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  useLogoutUser,
  type AuthUser,
} from "@workspace/api-client-react";

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  hasArea: (area: string) => boolean;
  setUser: (user: AuthUser) => void;
  refresh: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const CURRENT_USER_KEY = getGetCurrentUserQueryKey();

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useGetCurrentUser({
    query: {
      queryKey: CURRENT_USER_KEY,
      retry: false,
      staleTime: 5 * 60 * 1000,
    },
  });
  const logoutMutation = useLogoutUser();

  const user = isError ? null : (data ?? null);

  const hasArea = (area: string): boolean => {
    if (!user) return false;
    if (user.isAdmin) return true;
    if (area === "amministrazione") return false;
    return user.aree.includes(area);
  };

  const setUser = (next: AuthUser) => {
    queryClient.setQueryData(CURRENT_USER_KEY, next);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: CURRENT_USER_KEY });
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
      value={{ user, isLoading, hasArea, setUser, refresh, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
