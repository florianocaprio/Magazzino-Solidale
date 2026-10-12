import {
  db,
  fseReconciliationRunsTable,
  riconciliazioniFseTable,
} from "@workspace/db";
import { inArray, sql } from "drizzle-orm";

/** Test-owned fixtures only. The append-only trigger remains enabled globally;
 * replica mode is confined to this teardown transaction, as in scope-helpers. */
export async function removeFseRunFixtures(reconciliationIds: number[]) {
  if (
    process.env.NODE_ENV !== "test" ||
    !reconciliationIds.every((id) => Number.isSafeInteger(id) && id > 0)
  )
    throw new Error("Invalid FSE fixture cleanup");
  if (!reconciliationIds.length) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL session_replication_role = 'replica'`);
    await tx
      .update(riconciliazioniFseTable)
      .set({ baselineRunId: null })
      .where(inArray(riconciliazioniFseTable.id, reconciliationIds));
    await tx
      .delete(fseReconciliationRunsTable)
      .where(
        inArray(fseReconciliationRunsTable.reconciliationId, reconciliationIds),
      );
  });
}
