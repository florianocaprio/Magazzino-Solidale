import type { Request } from "express";
import { callerAreaOperativaId } from "./centroScope";

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
