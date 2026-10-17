import type { Request, RequestHandler } from "express";
import { callerAreaOperativaId } from "./centroScope";

/** NULL non concede globalità a un operatore UDS ordinario, anche con ruolo misto. */
export function hasUdsOperationalArea(req: Request): boolean {
  return Boolean(
    req.user &&
    (req.user.isAdmin ||
      req.user.isSuperAdmin ||
      (callerAreaOperativaId(req) != null &&
        req.user.areaOperativaAttiva !== false)),
  );
}

export const requireCurrentUdsScope: RequestHandler = (req, res, next) => {
  if (req.user?.aree.includes("uds") && !hasUdsOperationalArea(req)) {
    res
      .status(403)
      .json({ error: "Assegnazione territoriale UDS non disponibile" });
    return;
  }
  next();
};

interface UdsTerritorySnapshot {
  areaOperativaIdSnapshot: number | null;
}

/**
 * Gli snapshot classificati governano sempre lo storico. Solo per i record UDS
 * espliciti legacy privi di snapshot l'Area corrente della persona può essere
 * usata come fallback di autorizzazione, senza diventare dato storico.
 */
export function canAccessUdsInterventoTerritory(
  req: Request,
  intervento: UdsTerritorySnapshot,
  currentBeneficiarioAreaId: number | null,
): boolean {
  if (!hasUdsOperationalArea(req)) return false;
  const callerArea = callerAreaOperativaId(req);
  if (intervento.areaOperativaIdSnapshot != null) {
    return (
      callerArea == null || intervento.areaOperativaIdSnapshot === callerArea
    );
  }
  if (currentBeneficiarioAreaId != null) {
    return callerArea == null || currentBeneficiarioAreaId === callerArea;
  }
  return callerArea == null;
}
