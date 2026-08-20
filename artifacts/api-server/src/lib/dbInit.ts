import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DB bootstrap run at startup. Enables the `pg_trgm` extension used by
 * the fuzzy person-duplicate search (`GET /beneficiari/cerca-simili`).
 */
export async function initDbExtensions(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  // One-time backfill: fornitori moved from centro-scoping to area operativa-scoping
  // ("Area"). Derive each supplier's area operativa from its (legacy) centro when not yet
  // set. Idempotent: only touches rows missing area_operativa_id but having a centro.
  await db.execute(sql`
    UPDATE fornitori f
    SET area_operativa_id = c.area_operativa_id
    FROM centri_di_ascolto c
    WHERE f.centro_ascolto_id = c.id
      AND f.area_operativa_id IS NULL
      AND c.area_operativa_id IS NOT NULL
  `);
}
