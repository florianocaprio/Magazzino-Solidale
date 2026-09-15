/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260911_m1c_audit_eventi.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../../../lib/db/updates/20260916_m1c_audit_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migration M1C audit comune", () => {
  it("non riscrive dati legacy e definisce il registro append-only", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+(public\.)?movimenti\b/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.audit_eventi/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS audit_evento_id/i);
    expect(sql).toMatch(/audit_eventi_append_only_trg/i);
  });

  it("irrobustisce soltanto il vincolo attore con una nuova migration", async () => {
    const sql = await readFile(hardeningMigrationUrl, "utf8");
    expect(sql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(sql).not.toMatch(/\bTRUNCATE\b/i);
    expect(sql).not.toMatch(/\bUPDATE\s+/i);
    expect(sql).toMatch(
      /DROP CONSTRAINT IF EXISTS audit_eventi_actor_consistency_check/i,
    );
    expect(sql).toMatch(/ADD CONSTRAINT audit_eventi_actor_consistency_check/i);
    expect(sql).toMatch(
      /initiated_by_user_id IS NULL[\s\S]*initiated_by_code_snapshot IS NOT NULL/i,
    );
    expect(sql).toMatch(
      /VALIDATE CONSTRAINT audit_eventi_actor_consistency_check/i,
    );
  });

  it("espone colonne, FK e indici previsti dopo la migration", async () => {
    const result = await pool.query(`
      SELECT
        to_regclass('public.audit_eventi') IS NOT NULL AS audit_table,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'movimenti'
            AND column_name = 'audit_evento_id'
            AND is_nullable = 'YES'
        ) AS nullable_link,
        EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'audit_eventi_append_only_trg'
            AND NOT tgisinternal
        ) AS append_only_trigger,
        EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname = 'audit_eventi_operation_key_unique'
        ) AS operation_key_index,
        (
          SELECT count(*)::integer FROM pg_indexes
          WHERE schemaname = 'public'
            AND indexname IN (
              'audit_eventi_action_idx',
              'audit_eventi_area_idx',
              'audit_eventi_warehouse_idx'
            )
        ) AS scoped_indexes,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'audit_eventi'
            AND column_name = 'initiated_by_code_snapshot'
        ) AS initiator_snapshot,
        EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conrelid = 'public.audit_eventi'::regclass
            AND conname = 'audit_eventi_actor_consistency_check'
            AND convalidated
        ) AS actor_constraint
    `);
    expect(result.rows[0]).toEqual({
      audit_table: true,
      nullable_link: true,
      append_only_trigger: true,
      operation_key_index: true,
      scoped_indexes: 3,
      initiator_snapshot: true,
      actor_constraint: true,
    });
  });
});
