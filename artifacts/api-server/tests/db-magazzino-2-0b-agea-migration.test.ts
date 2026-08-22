/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260822_magazzino_2_0b_agea_import.sql",
  import.meta.url,
);
const r1MigrationUrl = new URL(
  "../../../lib/db/updates/20260823_magazzino_2_0b_r1_agea_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migration Magazzino 2.0B AGEA", () => {
  it("è additiva, idempotente e crea i vincoli di staging senza alterare i dati business", async () => {
    const migration = await readFile(migrationUrl, "utf8");
    expect(migration).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/im);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM prodotti) AS prodotti,
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM carichi_magazzino) AS carichi
      `);
      await client.query(migration);
      await client.query(migration);
      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM prodotti) AS prodotti,
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM carichi_magazzino) AS carichi
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);
      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = ANY(ARRAY[
            'importazioni_agea',
            'importazioni_agea_righe',
            'importazioni_agea_partite',
            'movimenti_esterni_agea',
            'mappature_prodotti_esterni'
          ])
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "importazioni_agea",
        "importazioni_agea_partite",
        "importazioni_agea_righe",
        "mappature_prodotti_esterni",
        "movimenti_esterni_agea",
      ]);
      const constraints = await client.query<{ conname: string }>(`
        SELECT conname
        FROM pg_constraint
        WHERE conname = ANY(ARRAY[
          'importazioni_agea_righe_numero_unique',
          'importazioni_agea_partite_key_unique',
          'movimenti_esterni_agea_magazzino_identity_unique',
          'mappature_prodotti_esterni_fonte_descrizione_unique'
        ])
        ORDER BY conname
      `);
      expect(constraints.rows).toHaveLength(4);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("applica due volte l'hardening R1 preservando i dati business e aggiungendo campi/indici", async () => {
    const migration = await readFile(r1MigrationUrl, "utf8");
    expect(migration).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP\s+TABLE)\b/im);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM prodotti) AS prodotti,
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM carichi_magazzino) AS carichi
      `);
      await client.query(migration);
      await client.query(migration);
      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM prodotti) AS prodotti,
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM carichi_magazzino) AS carichi
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);
      const columns = await client.query<{ column_name: string }>(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'importazioni_agea_righe'
          AND column_name = ANY(ARRAY[
            'lotto_effettivo_raw',
            'lotto_effettivo_normalizzato',
            'data_carico_effettiva',
            'mapping_versione_snapshot',
            'correzione_motivazione',
            'corretto_da',
            'data_correzione'
          ])
      `);
      expect(columns.rows).toHaveLength(7);
      const indexes = await client.query<{ indexname: string }>(`
        SELECT indexname
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = ANY(ARRAY[
            'importazioni_agea_righe_identity_base_idx',
            'importazioni_agea_righe_mapping_idx',
            'importazioni_agea_partite_identity_idx'
          ])
      `);
      expect(indexes.rows).toHaveLength(3);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
