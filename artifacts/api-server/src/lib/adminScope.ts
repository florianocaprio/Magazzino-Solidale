import type { RequestHandler } from "express";
import type { SessionUser } from "../middlewares/auth";

type AdminScopeUser = Pick<SessionUser, "isAdmin" | "isSuperAdmin" | "cittaId">;

/**
 * Nel modello corrente un amministratore senza cittaId opera globalmente;
 * cittaId e la tabella `citta` rappresentano l'Area operativa (naming legacy).
 */
export function isGlobalAdmin(
  user: AdminScopeUser | null | undefined,
): boolean {
  return Boolean(
    user && (user.isAdmin || user.isSuperAdmin) && user.cittaId == null,
  );
}

/**
 * Le letture possono includere record legacy/shared NULL. Le mutazioni no:
 * un caller scoped modifica soltanto record con lo stesso scope esatto.
 */
export function canMutateScopedResource(
  resourceScopeId: number | null | undefined,
  callerScopeId: number | null,
): boolean {
  return callerScopeId == null || resourceScopeId === callerScopeId;
}

export const requireGlobalAdmin: RequestHandler = (req, res, next) => {
  if (!req.user || (!req.user.isAdmin && !req.user.isSuperAdmin)) {
    res.status(403).json({
      error: "Accesso riservato agli amministratori",
    });
    return;
  }
  if (!isGlobalAdmin(req.user)) {
    res.status(403).json({
      error: "Operazione riservata all'amministrazione globale",
    });
    return;
  }
  next();
};
