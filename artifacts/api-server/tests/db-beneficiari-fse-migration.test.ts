/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260827_beneficiari_2_0_fse.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione Beneficiari 2.0 FSE+", () => {
  it("è incrementale, non distruttiva e idempotente", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
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

  it("crea tabelle, colonne, indici, FK e CHECK canonici", async () => {
    const client = await pool.connect();
    try {
      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('fse_import_batches', 'fse_fascicoli_sociali')
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "fse_fascicoli_sociali",
        "fse_import_batches",
      ]);

      const batchColumns = await client.query<{ column_name: string; is_nullable: string }>(`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'fse_import_batches'
      `);
      const columns = new Map(batchColumns.rows.map((row) => [row.column_name, row.is_nullable]));
      expect(columns.get("sha256_file")).toBe("NO");
      expect(columns.get("hash_contenuto_normalizzato")).toBe("NO");
      expect(columns.get("centro_ascolto_id")).toBe("NO");
      expect(columns.get("area_operativa_id")).toBe("NO");

      const constraints = await client.query<{ conname: string; contype: string; validated: boolean }>(`
        SELECT conname, contype, convalidated AS validated
        FROM pg_constraint
        WHERE conrelid IN (
          'public.fse_import_batches'::regclass,
          'public.fse_fascicoli_sociali'::regclass
        )
      `);
      const names = constraints.rows.map((row) => row.conname);
      expect(names).toEqual(expect.arrayContaining([
        "fse_import_batches_sha256_file_check",
        "fse_import_batches_hash_contenuto_normalizzato_check",
        "fse_import_batches_counts_check",
        "fse_fascicoli_sociali_snapshot_check",
        "fse_fascicoli_sociali_specific_counts_check",
      ]));
      expect(constraints.rows.filter((row) => row.contype === "f").every((row) => row.validated)).toBe(true);

      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename IN ('fse_import_batches', 'fse_fascicoli_sociali')
      `);
      expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
        "fse_import_batches_scope_idx",
        "fse_fascicoli_sociali_beneficiario_uidx",
        "fse_fascicoli_sociali_codice_norm_uidx",
      ]));
    } finally {
      client.release();
    }
  });
});
