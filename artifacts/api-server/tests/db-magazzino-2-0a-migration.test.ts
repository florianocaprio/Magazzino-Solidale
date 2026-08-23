/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260822_magazzino_2_0a.sql",
  import.meta.url,
);
const r1MigrationUrl = new URL(
  "../../../lib/db/updates/20260822_magazzino_2_0a_r1.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migration progressiva Magazzino 2.0A", () => {
  it("è additiva, ripetibile e conserva le cardinalità business", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    const r1MigrationSql = await readFile(r1MigrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/i);
    expect(r1MigrationSql).not.toMatch(/\b(?:DELETE|TRUNCATE)\b/i);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM prodotti) AS prodotti
      `);
      await client.query(migrationSql);
      await client.query(migrationSql);
      await client.query(r1MigrationSql);
      await client.query(r1MigrationSql);
      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM prodotti) AS prodotti
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'carichi_magazzino', 'carichi_magazzino_righe',
            'operazioni_distribuzione_magazzino'
          ) ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "carichi_magazzino",
        "carichi_magazzino_righe",
        "operazioni_distribuzione_magazzino",
      ]);

      const precision = await client.query<{
        table_name: string;
        numeric_precision: number;
        numeric_scale: number;
      }>(`
        SELECT table_name, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'quantita'
          AND table_name IN ('movimenti', 'scarico_righe', 'trasferimento_righe')
        ORDER BY table_name
      `);
      expect(precision.rows).toHaveLength(3);
      expect(
        precision.rows.every(
          (row) => row.numeric_precision === 14 && row.numeric_scale === 6,
        ),
      ).toBe(true);

      const requiredColumns = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (
          ('lotti', 'fondo_origine'),
          ('lotti', 'codice_lotto_normalizzato'),
          ('movimenti', 'natura_contabile'),
          ('movimenti', 'operazione_distribuzione_id'),
          ('movimenti', 'carico_magazzino_riga_id'),
          ('movimenti', 'fattore_kg_lt_pezzo'),
          ('carichi_magazzino', 'request_hash')
        )
      `);
      expect(requiredColumns.rows[0].count).toBe(7);
      const states = await client.query<{ definition: string }>(`
        SELECT pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.operazioni_distribuzione_magazzino'::regclass
          AND conname = 'operazioni_distribuzione_stato_check'
      `);
      expect(states.rows[0].definition).toContain("parzialmente_stornata");
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
