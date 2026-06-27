import { eq } from "drizzle-orm";
import { db, ruoliTable, utentiTable } from "@workspace/db";

/**
 * First-run bootstrap detection.
 *
 * The portal ships with NO default user. Until at least one user holding an
 * admin role exists in the database, the system is in "bootstrap" mode: whoever
 * opens the app may create the system users (one of which MUST be an
 * administrator) WITHOUT logging in. The moment an admin user exists, bootstrap
 * mode ends for good and every endpoint requires authentication.
 *
 * Bootstrap mode is therefore defined purely by the database state: it is active
 * exactly when no user is linked to a role with `isAdmin = true`.
 */
export async function isBootstrapMode(): Promise<boolean> {
  const [row] = await db
    .select({ id: utentiTable.id })
    .from(utentiTable)
    .innerJoin(ruoliTable, eq(utentiTable.ruoloId, ruoliTable.id))
    .where(eq(ruoliTable.isAdmin, true))
    .limit(1);
  return !row;
}
