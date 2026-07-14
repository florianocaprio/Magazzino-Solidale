import { and, eq } from "drizzle-orm";
import { db, ruoliTable, utentiTable } from "@workspace/db";

/**
 * First-run bootstrap detection.
 *
 * Until at least one user holding an admin role exists in the database, the
 * system is in "bootstrap" mode: whoever opens the app may create the first
 * system user WITHOUT logging in. The backend forces that first user to be a
 * SuperAdmin. The moment an admin user exists, bootstrap mode ends for good and
 * every endpoint requires authentication.
 *
 * Bootstrap mode is therefore defined purely by the database state: it is active
 * exactly when no user is linked to a role with `isAdmin = true`.
 */
export async function isBootstrapMode(): Promise<boolean> {
  const [row] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .innerJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(
      and(eq(ruoliTable.isAdmin, true), eq(utentiTable.attivo, true)),
    )
    .limit(1);
  return !row;
}
