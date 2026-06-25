import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DB bootstrap run at startup. Enables the `pg_trgm` extension used by
 * the fuzzy person-duplicate search (`GET /beneficiari/cerca-simili`).
 */
export async function initDbExtensions(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
}
