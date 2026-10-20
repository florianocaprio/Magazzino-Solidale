import type { Request } from "express";
import {
  areeOperativeTable,
  centriAscoltoTable,
  db,
  volontariTable,
} from "@workspace/db";
import { eq, sql, type SQL } from "drizzle-orm";
import { callerAreaOperativaId, callerCentroId } from "./centroScope";

type VolunteerArea = {
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
};
type Executor = Pick<typeof db, "select">;

export function volunteerAreaFilter(areaId: number | null): SQL | undefined {
  return areaId == null
    ? undefined
    : eq(volontariTable.areaOperativaId, areaId);
}

/** Shared volunteers serve every Centre in their Area; others only their reference Centre. */
export function volunteerContextFilter(centreId: number): SQL {
  return sql`${volontariTable.areaOperativaId} = (select area_operativa_id from centri_di_ascolto where id = ${centreId})
    and (${volontariTable.centroAscoltoId} is null or ${volontariTable.centroAscoltoId} = ${centreId})`;
}

export async function volunteerCallerArea(
  req: Request,
): Promise<number | null> {
  const areaId = callerAreaOperativaId(req);
  if (areaId != null || callerCentroId(req) == null) return areaId;
  const [centre] = await db
    .select({ area: centriAscoltoTable.areaOperativaId })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, callerCentroId(req)!));
  return centre?.area ?? null;
}

export async function canAccessVolunteer(
  req: Request,
  row: VolunteerArea,
): Promise<boolean> {
  const areaId = await volunteerCallerArea(req);
  if (areaId != null) return row.areaOperativaId === areaId;
  // Legacy centre-scoped sessions remain confined while awaiting Area repair.
  const centreId = callerCentroId(req);
  return centreId == null || row.centroAscoltoId === centreId;
}

export async function volunteerMatchesCentre(
  executor: Executor,
  row: VolunteerArea,
  centreId: number,
): Promise<boolean> {
  if (row.areaOperativaId == null ||
      (row.centroAscoltoId != null && row.centroAscoltoId !== centreId)) return false;
  const [centre] = await executor
    .select({ area: centriAscoltoTable.areaOperativaId })
    .from(centriAscoltoTable)
    .where(eq(centriAscoltoTable.id, centreId));
  return centre?.area === row.areaOperativaId;
}

/** Resolve legacy Centre-only input, but require an explicit, real Area overall. */
export async function validateVolunteerArea(
  req: Request,
  values: Record<string, unknown>,
  executor: Executor = db,
) {
  const errors: Record<string, string> = {};
  const callerArea = await volunteerCallerArea(req);
  const centreId =
    values.centroAscoltoId == null ? null : Number(values.centroAscoltoId);
  const [centre] =
    centreId == null || !Number.isSafeInteger(centreId) || centreId <= 0
      ? []
      : await executor
          .select()
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, centreId));
  const areaId =
    values.areaOperativaId == null
      ? (callerArea ?? centre?.areaOperativaId)
      : Number(values.areaOperativaId);
  if (!Number.isSafeInteger(areaId) || Number(areaId) <= 0)
    errors.areaOperativaId = "Seleziona un’Area Operativa";
  else if (callerArea != null && areaId !== callerArea)
    errors.areaOperativaId = "Area Operativa non accessibile";
  else {
    const [area] = await executor
      .select()
      .from(areeOperativeTable)
      .where(eq(areeOperativeTable.id, Number(areaId)));
    if (!area?.attivo)
      errors.areaOperativaId = "Seleziona un’Area Operativa attiva";
  }
  if (
    centreId != null &&
    (!centre?.attivo || centre.areaOperativaId !== areaId)
  )
    errors.centroAscoltoId =
      "Seleziona un Centro di riferimento della stessa Area";
  if (!Object.keys(errors).length) {
    values.areaOperativaId = Number(areaId);
    values.centroAscoltoId = centreId;
  }
  return errors;
}

export async function canAccessPersonalVehicle(
  req: Request,
  vehicle: { volontarioId: number | null },
  executor: Executor = db,
): Promise<boolean> {
  if (vehicle.volontarioId == null) return true;
  const [owner] = await executor
    .select()
    .from(volontariTable)
    .where(eq(volontariTable.id, vehicle.volontarioId));
  return owner != null && (await canAccessVolunteer(req, owner));
}
