import { areaOnlyUserScope } from "./userAccess";
import { ruoliTable, utentiTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export class CurrentCommandActorError extends Error {
  readonly status = 403;
}

/** Re-read actor, role and territorial assignment after document lock. */
export async function requireCurrentCommandActor(
  tx: InventoryTransaction,
  userId: number,
  permission: string,
) {
  const [actor] = await tx
    .select({
      id: utentiTable.id,
      attivo: utentiTable.attivo,
      isSuperAdmin: utentiTable.isSuperAdmin,
      areaOperativaId: utentiTable.areaOperativaId,
      centroAscoltoId: utentiTable.centroAscoltoId,
      zonaUdsId: utentiTable.zonaUdsId,
      ruoloId: utentiTable.ruoloId,
    })
    .from(utentiTable)
    .where(eq(utentiTable.id, userId))
    .for("share");
  const [role] =
    actor?.ruoloId == null
      ? []
      : await tx
          .select({
            isAdmin: ruoliTable.isAdmin,
            permessi: ruoliTable.permessi,
            aree: ruoliTable.aree,
          })
          .from(ruoliTable)
          .where(eq(ruoliTable.id, actor.ruoloId))
          .for("share");
  if (
    !actor?.attivo ||
    (actor.areaOperativaId == null &&
      ((!role?.isAdmin && !actor.isSuperAdmin) ||
        actor.centroAscoltoId != null || actor.zonaUdsId != null)) ||
    !(role?.isAdmin || (role?.permessi ?? []).includes(permission))
  ) {
    throw new CurrentCommandActorError(
      "Permesso non più disponibile per l'operazione",
    );
  }
  return {
    ...areaOnlyUserScope(actor),
    isAdmin: role.isAdmin,
    permessi: role.permessi,
    aree: role.aree,
  };
}
