import { canReadMensaRequests } from "../m5bRequestAccess";
import { isReportModuleActive } from "./queryContext";
import type { ReportFilters } from "./types";
import { AREA_BY_SEGMENT } from "../areas";

type Actor = Pick<
  ReportFilters,
  | "callerIsAdmin"
  | "callerAreas"
  | "callerPermissions"
  | "areaOperativaId"
  | "centroAscoltoId"
  | "zonaUdsId"
>;

/** Source grants, not a new reporting privilege. Territory remains in filters. */
export async function logisticsSources(actor: Actor) {
  const [warehouse, lots, transfers, supplies, means, volunteers] =
    await Promise.all(
      [
        "MAGAZZINO_SOLIDALE",
        "LOTTI",
        "TRASFERIMENTI",
        "APPROVVIGIONAMENTI",
        "MEZZI",
        "VOLONTARI",
      ].map(isReportModuleActive),
    );
  const sourceArea =
    actor.callerIsAdmin ||
    actor.callerAreas.some((area) => ["magazzino", "logistica"].includes(area));
  const grant = (permission: string) =>
    sourceArea &&
    (actor.callerIsAdmin || actor.callerPermissions.includes(permission));
  const source = (segment: string, permission: string) => {
    const configured = AREA_BY_SEGMENT[segment];
    const areas = Array.isArray(configured) ? configured : [configured];
    return (
      grant(permission) &&
      (actor.callerIsAdmin ||
        areas.some((area) => actor.callerAreas.includes(area)))
    );
  };
  const stock = source("movimenti", "magazzino.view");
  return {
    stock: stock && (warehouse || lots),
    lots: stock && lots,
    // Generic transfer reads use magazzino.view, not a synthetic transfers.view grant.
    transfers: stock && transfers,
    supplies:
      source("approvvigionamenti", "approvvigionamenti.view") && supplies,
    means: source("mezzi", "logistica.mezzi.view") && means,
    requests:
      sourceArea &&
      warehouse &&
      (source("richieste-magazzino", "richieste_magazzino.view") ||
        canReadMensaRequests({
          isAdmin: actor.callerIsAdmin,
          aree: actor.callerAreas,
          permessi: actor.callerPermissions,
          areaOperativaId: actor.areaOperativaId,
          centroAscoltoId: actor.centroAscoltoId,
          zonaUdsId: actor.zonaUdsId,
        })),
    volunteers: source("volontari", "logistica.volontari.view") && volunteers,
  };
}
