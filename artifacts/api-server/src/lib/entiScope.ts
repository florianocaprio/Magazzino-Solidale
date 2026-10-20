import type { Request } from "express";
import { isGlobalAdmin } from "./adminScope";
import { callerAreaOperativaId } from "./centroScope";

/** Global recipients never make the operation's Area global. */
export function enteMatchesArea(
  entity: { areaOperativaId: number | null } | null | undefined,
  operationArea: number | null | undefined,
): boolean {
  return (
    entity != null &&
    operationArea != null &&
    (entity.areaOperativaId == null || entity.areaOperativaId === operationArea)
  );
}

export function canManageEnte(req: Request, areaId: number | null): boolean {
  return (
    isGlobalAdmin(req.user) ||
    (areaId != null && areaId === callerAreaOperativaId(req))
  );
}
