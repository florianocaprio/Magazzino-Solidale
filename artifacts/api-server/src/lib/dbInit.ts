import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Idempotent DB bootstrap run at startup. Enables the `pg_trgm` extension used by
 * the fuzzy person-duplicate search (`GET /beneficiari/cerca-simili`).
 */
export async function initDbExtensions(): Promise<void> {
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  // One-time backfill: fornitori moved from centro-scoping to città-scoping
  // ("Area"). Derive each supplier's città from its (legacy) centro when not yet
  // set. Idempotent: only touches rows missing citta_id but having a centro.
  await db.execute(sql`
    UPDATE fornitori f
    SET citta_id = c.citta_id
    FROM centri_di_ascolto c
    WHERE f.centro_ascolto_id = c.id
      AND f.citta_id IS NULL
      AND c.citta_id IS NOT NULL
  `);
}
