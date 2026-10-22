import type { AuthUser } from "@workspace/api-client-react";

export function authorizationSignature(
  user: AuthUser | null | undefined,
): string {
  if (!user) return "anonymous";
  return JSON.stringify([
    user.id,
    user.ruoloId,
    user.isAdmin,
    user.isSuperAdmin,
    user.areaOperativaId,
    user.centroAscoltoId,
    user.zonaUdsId,
    user.mustChangePassword,
    [...(user.aree ?? [])].sort(),
    [...(user.permessi ?? [])].sort(),
  ]);
}

export function isIdentityQuery(key: readonly unknown[]): boolean {
  return (
    key[0] === "/api/auth/me" ||
    key[0] === "/api/auth/bootstrap-status" ||
    key[0] === "/api/configurazione-ambiente"
  );
}
