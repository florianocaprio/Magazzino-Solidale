/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260820_audit_emporio_operational_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione hardening operativo Emporio", () => {
  it("è additiva, idempotente e preserva le cardinalità business", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const countsSql = `
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM prodotti) AS prodotti,
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti,
          (SELECT count(*)::int FROM consegne) AS consegne,
          (SELECT count(*)::int FROM sessioni_cassa_emporio) AS sessioni,
          (SELECT count(*)::int FROM sessioni_cassa_emporio_righe) AS righe_sessione,
          (SELECT count(*)::int FROM spese_emporio) AS spese,
          (SELECT count(*)::int FROM spese_emporio_righe) AS righe_spesa,
          (SELECT count(*)::int FROM credito_solidale_movimenti) AS credito,
          (SELECT count(*)::int FROM bolle) AS bolle,
          (SELECT count(*)::int FROM scarichi) AS scarichi
      `;
      const before = await client.query(countsSql);
      await client.query(migrationSql);
      await client.query(migrationSql);
      const after = await client.query(countsSql);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const columns = await client.query<{
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(`
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('sessioni_cassa_emporio', 'versione'),
            ('sessioni_cassa_emporio_righe', 'quantita'),
            ('sessioni_cassa_emporio_righe', 'unita_misura'),
            ('spese_emporio_righe', 'unita_misura'),
            ('spese_emporio_storni_righe', 'movimento_inventario_originale_id')
          )
        ORDER BY table_name, column_name
      `);
      expect(columns.rows).toHaveLength(5);
      expect(
        columns.rows.find((row) => row.column_name === "quantita")?.data_type,
      ).toBe("numeric");
      expect(
        columns.rows
          .filter((row) => row.column_name === "unita_misura")
          .every((row) => row.is_nullable === "YES"),
      ).toBe(true);

      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('spese_emporio_storni', 'spese_emporio_storni_righe')
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "spese_emporio_storni",
        "spese_emporio_storni_righe",
      ]);

      const triggers = await client.query<{ tgname: string }>(`
        SELECT tgname FROM pg_trigger
        WHERE NOT tgisinternal AND tgname = ANY(ARRAY[
          'prevent_new_duplicate_accesso_emporio_trg',
          'prevent_new_duplicate_sessione_emporio_trg',
          'prevent_new_duplicate_ricarica_mensile_trg'
        ]) ORDER BY tgname
      `);
      expect(triggers.rows).toHaveLength(3);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
