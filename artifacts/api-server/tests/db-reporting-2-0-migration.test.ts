/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260828_reporting_2_0_final_alignment.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migration Reporting 2.0", () => {
  it("è additiva, idempotente e non esegue backfill speculativi", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(
      /\bUPDATE\s+(bolle|consegne|interventi|fse_fascicoli_sociali)\b/i,
    );
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SEQUENCE)\b/i);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migrationSql);
      await client.query(migrationSql);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("crea storia FSE append-only e snapshot evento nullable e indicizzati", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(await readFile(migrationUrl, "utf8"));
      const table = await client.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'fse_fascicoli_sociali_snapshot'
      `);
      expect(table.rowCount).toBe(1);

      const columns = await client.query<{
        table_name: string;
        column_name: string;
        is_nullable: string;
      }>(`
        SELECT table_name, column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND (
          (table_name = 'bolle' AND column_name IN ('area_operativa_id_snapshot','centro_ascolto_id_snapshot','numero_componenti_nucleo_snapshot')) OR
          (table_name = 'consegne' AND column_name IN ('area_operativa_id_snapshot','centro_ascolto_id_snapshot')) OR
          (table_name = 'interventi' AND column_name = 'centro_ascolto_id_snapshot')
        )
      `);
      expect(columns.rows).toHaveLength(6);
      expect(columns.rows.every((column) => column.is_nullable === "YES")).toBe(
        true,
      );

      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
          AND indexname IN (
            'fse_fascicoli_snapshot_asof_idx', 'fse_fascicoli_snapshot_hash_uidx',
            'bolle_reporting_snapshot_idx', 'consegne_reporting_snapshot_idx',
            'interventi_reporting_snapshot_idx'
          )
      `);
      expect(indexes.rows).toHaveLength(5);

      const triggers = await client.query(`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'public.fse_fascicoli_sociali_snapshot'::regclass
          AND NOT tgisinternal AND tgname = 'fse_fascicoli_snapshot_append_only'
      `);
      expect(triggers.rowCount).toBe(1);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
