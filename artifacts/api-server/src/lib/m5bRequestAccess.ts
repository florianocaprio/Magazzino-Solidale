import { and, eq, isNull, or, inArray, sql, type SQL } from "drizzle-orm";
import {
  areeOperativeTable,
  centriAscoltoTable,
  richiesteMagazzinoTable,
  type RichiestaMagazzino,
} from "@workspace/db";
import { requireCurrentCommandActor } from "./currentCommandActor";
import type { InventoryTransaction } from "./scaricoInventory";
import { currentMensaIds } from "./mensaScope";
import type { PermissionKey } from "./permissions";

export type M5bRequestActor = {
  id?: number;
  mensaIds?: number[] | null;
  isAdmin: boolean;
  permessi: string[] | null;
  aree: string[] | null;
  areaOperativaId: number | null;
  centroAscoltoId: number | null;
  zonaUdsId: number | null;
  areaOperativaAttiva?: boolean | null;
  centroAscoltoAttivo?: boolean | null;
  centroAscoltoAreaOperativaId?: number | null;
};

/** Lock current assignments after the actor/role, before the M5 request/document. */
export async function requireCurrentM5bActor(
  tx: InventoryTransaction,
  userId: number,
  permission: string,
) {
  const actor = await requireCurrentCommandActor(tx, userId, permission);
  const [area] =
    actor.areaOperativaId == null
      ? []
      : await tx
          .select({ attivo: areeOperativeTable.attivo })
          .from(areeOperativeTable)
          .where(eq(areeOperativeTable.id, actor.areaOperativaId))
          .for("share");
  const [centro] =
    actor.centroAscoltoId == null
      ? []
      : await tx
          .select({
            attivo: centriAscoltoTable.attivo,
            areaOperativaId: centriAscoltoTable.areaOperativaId,
          })
          .from(centriAscoltoTable)
          .where(eq(centriAscoltoTable.id, actor.centroAscoltoId))
          .for("share");
  const mensaIds =
    !actor.isAdmin && actor.aree.includes("mensa")
      ? actor.areaOperativaId == null
        ? []
        : (await currentMensaIds(tx, userId)).ids
      : undefined;
  return {
    ...actor,
    mensaIds,
    areaOperativaAttiva:
      actor.areaOperativaId == null ? null : (area?.attivo ?? false),
    centroAscoltoAttivo:
      actor.centroAscoltoId == null ? null : (centro?.attivo ?? false),
    centroAscoltoAreaOperativaId: centro?.areaOperativaId ?? null,
  };
}

export function hasM5bGrant(
  actor: Pick<M5bRequestActor, "isAdmin" | "permessi">,
  permission: string,
) {
  return actor.isAdmin || (actor.permessi ?? []).includes(permission);
}

export function hasM5bArea(
  actor: Pick<M5bRequestActor, "isAdmin" | "aree">,
  area: string,
) {
  return actor.isAdmin || (actor.aree ?? []).includes(area);
}

/** A missing assignment is not a global grant for an ordinary operator. */
export function m5bTerritory(actor: M5bRequestActor) {
  if (
    actor.areaOperativaId != null &&
    actor.areaOperativaAttiva !== undefined &&
    actor.areaOperativaAttiva !== true
  )
    return "none";
  if (
    actor.centroAscoltoId != null &&
    ((actor.centroAscoltoAttivo !== undefined &&
      actor.centroAscoltoAttivo !== true) ||
      (actor.centroAscoltoAreaOperativaId !== undefined &&
        actor.centroAscoltoAreaOperativaId !== actor.areaOperativaId))
  )
    return "none";
  if (actor.areaOperativaId == null) {
    return actor.centroAscoltoId == null && actor.isAdmin ? "global" : "none";
  }
  if (actor.centroAscoltoId != null) return "centro";
  return actor.isAdmin || hasM5bArea(actor, "magazzino") ? "area" : "none";
}

export function canReadM5bRequest(
  actor: M5bRequestActor,
  row: RichiestaMagazzino,
) {
  if (
    row.mensaId != null &&
    canReadMensaRequests(actor) &&
    actor.mensaIds?.includes(row.mensaId) &&
    actor.areaOperativaId === row.areaOperativaId
  )
    return true;
  if (!hasM5bGrant(actor, "richieste_magazzino.view")) return false;
  const territory = m5bTerritory(actor);
  if (territory === "none") return false;
  if (
    actor.areaOperativaId != null &&
    actor.areaOperativaId !== row.areaOperativaId
  )
    return false;
  if (
    actor.centroAscoltoId != null &&
    actor.centroAscoltoId !== row.centroAscoltoId &&
    !(
      hasM5bArea(actor, "magazzino") &&
      row.centroAscoltoId == null &&
      row.sorgente === "operativa" &&
      row.tipoDestinatario !== "beneficiario"
    )
  )
    return false;
  if (hasM5bArea(actor, "magazzino")) return true;
  return (
    hasM5bArea(actor, "sociale") &&
    row.tipoDestinatario === "beneficiario" &&
    (actor.zonaUdsId == null || actor.zonaUdsId === row.zonaUdsIdSnapshot)
  );
}

/** Mirrors canReadM5bRequest in SQL, before count and pagination. */
export function m5bRequestScopePredicate(actor: M5bRequestActor): SQL {
  const mensa =
    canReadMensaRequests(actor) && actor.mensaIds?.length
      ? and(
          inArray(richiesteMagazzinoTable.mensaId, actor.mensaIds),
          eq(
            richiesteMagazzinoTable.areaOperativaId,
            actor.areaOperativaId ?? -1,
          ),
        )!
      : sql`false`;
  if (
    !hasM5bGrant(actor, "richieste_magazzino.view") ||
    m5bTerritory(actor) === "none"
  )
    return mensa;
  const parts: SQL[] = [];
  if (actor.areaOperativaId != null)
    parts.push(
      eq(richiesteMagazzinoTable.areaOperativaId, actor.areaOperativaId),
    );
  if (actor.centroAscoltoId != null)
    parts.push(
      hasM5bArea(actor, "magazzino")
        ? or(
            eq(richiesteMagazzinoTable.centroAscoltoId, actor.centroAscoltoId),
            and(
              isNull(richiesteMagazzinoTable.centroAscoltoId),
              eq(richiesteMagazzinoTable.sorgente, "operativa"),
            ),
          )!
        : eq(richiesteMagazzinoTable.centroAscoltoId, actor.centroAscoltoId),
    );
  if (!hasM5bArea(actor, "magazzino")) {
    if (!hasM5bArea(actor, "sociale")) return mensa;
    parts.push(eq(richiesteMagazzinoTable.tipoDestinatario, "beneficiario"));
    if (actor.zonaUdsId != null)
      parts.push(
        eq(richiesteMagazzinoTable.zonaUdsIdSnapshot, actor.zonaUdsId),
      );
  }
  return or(mensa, and(...parts) ?? sql`true`)!;
}

/** Existing Mensa capabilities permit needs/receiving, never origin stock work. */
export function canReadMensaRequests(actor: M5bRequestActor) {
  return (
    hasM5bArea(actor, "mensa") &&
    [
      "mensa.transfers.request",
      "mensa.transfers.receive",
      "mensa.transfers.manage",
    ].some((permission) => hasM5bGrant(actor, permission))
  );
}

export function mensaRequestPermission(
  actor: M5bRequestActor,
  permission: PermissionKey,
): PermissionKey {
  if (hasM5bGrant(actor, permission)) return permission;
  if (!hasM5bArea(actor, "mensa")) return permission;
  const allowed: PermissionKey[] =
    permission === "richieste_magazzino.view"
      ? [
          "mensa.transfers.request",
          "mensa.transfers.receive",
          "mensa.transfers.manage",
        ]
      : [
            "richieste_magazzino.create",
            "richieste_magazzino.update",
            "richieste_magazzino.cancel",
          ].includes(permission)
        ? ["mensa.transfers.request", "mensa.transfers.manage"]
        : [];
  return allowed.find((p) => hasM5bGrant(actor, p)) ?? permission;
}
