import { db, magazziniTable } from "@workspace/db";
import { and, eq, isNull, or, sql, type SQL } from "drizzle-orm";
import { CurrentCommandActorError } from "./currentCommandActor";
import {
  requireCurrentM5bActor,
  type M5bRequestActor,
} from "./m5bRequestAccess";
import type { InventoryTransaction } from "./scaricoInventory";

/** FSE-only policy: absence of an assignment is not a global permission. */
export function fseTerritory(
  actor: M5bRequestActor,
): "none" | "global" | "area" | "centro" {
  // The existing entry points are Warehouse import and Analysis reporting.
  if (
    !actor.isAdmin &&
    !(actor.aree ?? []).some(
      (area) => area === "magazzino" || area === "analisi",
    )
  )
    return "none";
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
  if (actor.areaOperativaId == null)
    return actor.centroAscoltoId == null && actor.isAdmin ? "global" : "none";
  return actor.centroAscoltoId == null ? "area" : "centro";
}

export function fseWarehouseScope(actor: M5bRequestActor): SQL {
  const territory = fseTerritory(actor);
  if (territory === "none") return sql`false`;
  if (territory === "global") return sql`true`;
  return and(
    eq(magazziniTable.areaOperativaId, actor.areaOperativaId!),
    territory === "centro"
      ? or(
          eq(magazziniTable.centroAscoltoId, actor.centroAscoltoId!),
          isNull(magazziniTable.centroAscoltoId),
        )
      : undefined,
  )!;
}

export async function visibleFseWarehouseIds(actor: M5bRequestActor) {
  return (
    await db
      .select({ id: magazziniTable.id })
      .from(magazziniTable)
      .where(fseWarehouseScope(actor))
  ).map((row) => row.id);
}

export async function canAccessFseWarehouse(
  actor: M5bRequestActor,
  id: number,
) {
  return (
    (
      await db
        .select({ id: magazziniTable.id })
        .from(magazziniTable)
        .where(and(eq(magazziniTable.id, id), fseWarehouseScope(actor)))
    ).length > 0
  );
}

/** Call within the mutation transaction, after its document/source lock and before replay. */
export async function requireCurrentFseWarehouse(
  tx: InventoryTransaction,
  userId: number,
  permission: string,
  warehouseId: number,
  options: { historicalRead?: boolean } = {},
) {
  const actor = await requireCurrentM5bActor(tx, userId, permission);
  const [warehouse] = await tx
    .select()
    .from(magazziniTable)
    .where(and(eq(magazziniTable.id, warehouseId), fseWarehouseScope(actor)))
    .for("share");
  // Legacy null-Area remains readable by a global administrator, never a new write target.
  if (
    !warehouse ||
    (warehouse.areaOperativaId == null && !options.historicalRead)
  )
    throw new CurrentCommandActorError(
      "Magazzino non accessibile per l'operazione FSE corrente",
    );
  return actor;
}
