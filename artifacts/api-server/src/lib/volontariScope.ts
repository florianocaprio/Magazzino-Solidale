import { createHash } from "node:crypto";
import type { Request } from "express";
import { centriAscoltoTable, db } from "@workspace/db";
import { and, asc, eq, or, type Column, type SQL } from "drizzle-orm";
import { callerAreaOperativaId, callerCentroId } from "./centroScope";

export type VolunteerOwnerScope = {
  scopeTipo: "CENTRO" | "AREA" | "GLOBALE";
  scopeCentroId: number | null;
  scopeAreaOperativaId: number | null;
  scopeCentroIdsSnapshot: number[];
  scopeFingerprint: string;
};

type ScopeColumns = {
  scopeTipo: Column;
  scopeCentroId: Column;
  scopeAreaOperativaId: Column;
};

type StoredOwnerScope = {
  scopeTipo: string;
  scopeCentroId: number | null;
  scopeAreaOperativaId: number | null;
  scopeCentroIdsSnapshot: number[];
};

function canonicalScopeValue(
  scope: Omit<VolunteerOwnerScope, "scopeFingerprint">,
) {
  return JSON.stringify({
    scopeTipo: scope.scopeTipo,
    scopeCentroId: scope.scopeCentroId,
    scopeAreaOperativaId: scope.scopeAreaOperativaId,
    scopeCentroIdsSnapshot: [...scope.scopeCentroIdsSnapshot].sort(
      (a, b) => a - b,
    ),
  });
}

export function volunteerScopeFingerprint(
  scope: Omit<VolunteerOwnerScope, "scopeFingerprint">,
): string {
  return createHash("sha256").update(canonicalScopeValue(scope)).digest("hex");
}

export async function resolveVolunteerOwnerScope(
  req: Request,
  requestedCenterId: number | null,
): Promise<VolunteerOwnerScope> {
  const callerCenterId = callerCentroId(req);
  const callerAreaId = callerAreaOperativaId(req);
  const effectiveCenterId = callerCenterId ?? requestedCenterId;

  if (effectiveCenterId != null) {
    const [center] = await db
      .select({
        id: centriAscoltoTable.id,
        areaOperativaId: centriAscoltoTable.areaOperativaId,
      })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.id, effectiveCenterId));
    if (!center) throw new Error("VOLUNTEER_SCOPE_CENTER_NOT_FOUND");
    const base = {
      scopeTipo: "CENTRO" as const,
      scopeCentroId: center.id,
      scopeAreaOperativaId: center.areaOperativaId,
      scopeCentroIdsSnapshot: [center.id],
    };
    return { ...base, scopeFingerprint: volunteerScopeFingerprint(base) };
  }

  if (callerAreaId != null) {
    const centers = await db
      .select({ id: centriAscoltoTable.id })
      .from(centriAscoltoTable)
      .where(eq(centriAscoltoTable.areaOperativaId, callerAreaId))
      .orderBy(asc(centriAscoltoTable.id));
    const base = {
      scopeTipo: "AREA" as const,
      scopeCentroId: null,
      scopeAreaOperativaId: callerAreaId,
      scopeCentroIdsSnapshot: centers.map((center) => center.id),
    };
    return { ...base, scopeFingerprint: volunteerScopeFingerprint(base) };
  }

  const centers = await db
    .select({ id: centriAscoltoTable.id })
    .from(centriAscoltoTable)
    .orderBy(asc(centriAscoltoTable.id));
  const base = {
    scopeTipo: "GLOBALE" as const,
    scopeCentroId: null,
    scopeAreaOperativaId: null,
    scopeCentroIdsSnapshot: centers.map((center) => center.id),
  };
  return { ...base, scopeFingerprint: volunteerScopeFingerprint(base) };
}

export function canAccessVolunteerOwnerScope(
  req: Request,
  scope: StoredOwnerScope,
): boolean {
  const centerId = callerCentroId(req);
  const areaId = callerAreaOperativaId(req);
  if (centerId != null)
    return scope.scopeTipo === "CENTRO" && scope.scopeCentroId === centerId;
  if (areaId != null)
    return (
      scope.scopeTipo !== "GLOBALE" && scope.scopeAreaOperativaId === areaId
    );
  return true;
}

export function volunteerOwnerScopeSql(
  req: Request,
  columns: ScopeColumns,
): SQL | undefined {
  const centerId = callerCentroId(req);
  const areaId = callerAreaOperativaId(req);
  if (centerId != null)
    return and(
      eq(columns.scopeTipo, "CENTRO"),
      eq(columns.scopeCentroId, centerId),
    );
  if (areaId != null)
    return and(
      or(eq(columns.scopeTipo, "CENTRO"), eq(columns.scopeTipo, "AREA")),
      eq(columns.scopeAreaOperativaId, areaId),
    );
  return undefined;
}

export function scopeContainsCenter(
  scope: StoredOwnerScope,
  centerId: number | null | undefined,
): boolean {
  if (centerId == null) return scope.scopeTipo === "GLOBALE";
  if (scope.scopeTipo === "GLOBALE") return true;
  return scope.scopeCentroIdsSnapshot.includes(centerId);
}
