import { bolleTable } from "@workspace/db";
import { desc, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

/** Shared M4 persistence path; callers validate actor, recipient and warehouse. */
export async function createBollaDraftTx(
  tx: InventoryTransaction,
  values: Omit<typeof bolleTable.$inferInsert, "numeroBolla" | "stato"> & {
    dataBolla: string;
  },
) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext('bolle.numero_bolla'))`,
  );
  const year = Number(values.dataBolla.slice(0, 4));
  const existing = await tx
    .select({ number: bolleTable.numeroBolla })
    .from(bolleTable)
    .where(sql`${bolleTable.numeroBolla} like ${`BOLLA-${year}-%`}`)
    .orderBy(desc(bolleTable.id))
    .limit(1);
  const last =
    existing.length > 0 ? Number(existing[0].number.split("-").pop() ?? 0) : 0;
  const number = `BOLLA-${year}-${String(last + 1).padStart(4, "0")}`;
  const [created] = await tx
    .insert(bolleTable)
    .values({ ...values, numeroBolla: number, stato: "bozza" })
    .returning();
  return created;
}
