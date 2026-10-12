import { db, trasferimentiTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

/** Read-only compatibility. A legacy null reference is accepted only for a
 * canonical warehouse-backed Mensa which already existed at document creation
 * and has never been updated. Any uncertainty stays unattributed; no backfill.
 * New documents always persist the reference in createTransferRequestTx. */
export function transferMensaId() {
  return sql<number | null>`(select m.id from mense m
    where m.magazzino_id = ${trasferimentiTable.magazzinoDestinoId}
      and (m.id = ${trasferimentiTable.mensaId} or (
        ${trasferimentiTable.mensaId} is null
        and m.codice = 'MEN-MAG-' || m.magazzino_id::text
        and m.created_at <= ${trasferimentiTable.dataCreazione}
        and m.updated_at = m.created_at
      )))`;
}

export async function resolveTransferMensaId(
  id: number,
  tx: InventoryTransaction | typeof db = db,
) {
  const [row] = await tx
    .select({ mensaId: transferMensaId() })
    .from(trasferimentiTable)
    .where(eq(trasferimentiTable.id, id));
  return row?.mensaId ?? null;
}
