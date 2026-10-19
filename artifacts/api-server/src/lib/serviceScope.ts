import type { Request } from "express";
import { isNull, or, sql, type Column } from "drizzle-orm";

export * from "./centroScope";

/** Mensa e servizi dei Centri operano nell’intera Area abilitata dal ruolo. */
export function callerCentroId(req: Request): number | null {
  return operationalCentroId(req.user);
}

/** Nei servizi il Centro del profilo è un riferimento, non un limite nell'Area. */
export function operationalCentroId(
  user:
    | {
        areaOperativaId?: number | null;
        centroAscoltoId?: number | null;
        aree?: string[] | null;
      }
    | null
    | undefined,
): number | null {
  if (
    user?.areaOperativaId != null &&
    user.aree?.some((area) => ["sociale", "mensa", "emporio"].includes(area))
  )
    return null;
  return user?.centroAscoltoId ?? null;
}

/** Anche con Area legacy NULL, un Centro di un'altra Area non è condiviso. */
export function serviceCentroScopeFilter(column: Column, areaId: number | null) {
  if (areaId == null) return undefined;
  return or(isNull(column), sql`exists (
    select 1 from centri_di_ascolto service_centro
    where service_centro.id = ${column}
      and service_centro.area_operativa_id = ${areaId}
  )`);
}
