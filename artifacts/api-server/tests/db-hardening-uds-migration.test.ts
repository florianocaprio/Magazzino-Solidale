/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260821_audit_uds_operational_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione hardening operativo UDS", () => {
  it("è additiva, idempotente e applica gli invariant ai nuovi dati", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(migrationSql).not.toMatch(/UPDATE\s+public\.interventi/i);
    expect(migrationSql).toMatch(/ADD CONSTRAINT[\s\S]+NOT VALID/i);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM utenti) AS utenti,
          (SELECT count(*)::int FROM interventi) AS interventi,
          (SELECT count(*)::int FROM bisogni_pianificati) AS bisogni
      `);

      await client.query(migrationSql);
      await client.query(migrationSql);

      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM utenti) AS utenti,
          (SELECT count(*)::int FROM interventi) AS interventi,
          (SELECT count(*)::int FROM bisogni_pianificati) AS bisogni
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const columns = await client.query<{
        table_name: string;
        column_name: string;
      }>(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (table_name, column_name) IN (
            ('zone_uds', 'versione'),
            ('zone_uds', 'data_aggiornamento'),
            ('interventi', 'area_operativa_id_snapshot'),
            ('interventi', 'zona_uds_id_snapshot'),
            ('bisogni_pianificati', 'versione')
          )
      `);
      expect(columns.rows).toHaveLength(5);

      const constraints = await client.query<{
        conname: string;
        convalidated: boolean;
      }>(`
        SELECT conname, convalidated FROM pg_constraint
        WHERE conname = ANY(ARRAY[
          'beneficiari_zona_richiede_area_check',
          'beneficiari_zona_area_fk',
          'utenti_zona_richiede_area_check',
          'utenti_zona_area_fk',
          'interventi_uds_area_snapshot_check',
          'interventi_uds_zona_area_snapshot_fk'
        ])
      `);
      expect(constraints.rows).toHaveLength(6);

      const tables = await client.query<{ exists: boolean }>(`
        SELECT to_regclass('public.bisogni_pianificati_storico') IS NOT NULL AS exists
      `);
      expect(tables.rows[0].exists).toBe(true);

      const area = await client.query<{ id: number }>(`
        INSERT INTO aree_operative (nome, attivo)
        VALUES ('Area migration UDS', true)
        RETURNING id
      `);
      const areaId = area.rows[0].id;
      const zona = await client.query<{ id: number }>(
        `
        INSERT INTO zone_uds (area_operativa_id, nome, attivo)
        VALUES ($1, 'Zona Test', true)
        RETURNING id
      `,
        [areaId],
      );

      await client.query("SAVEPOINT duplicate_zone");
      await expect(
        client.query(
          `INSERT INTO zone_uds (area_operativa_id, nome, attivo) VALUES ($1, '  zOnA tEsT  ', true)`,
          [areaId],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT duplicate_zone");

      const secondArea = await client.query<{ id: number }>(`
        INSERT INTO aree_operative (nome, attivo)
        VALUES ('Area migration UDS 2', true)
        RETURNING id
      `);
      await client.query("SAVEPOINT immutable_zone");
      await expect(
        client.query(
          `UPDATE zone_uds SET area_operativa_id = $1 WHERE id = $2`,
          [secondArea.rows[0].id, zona.rows[0].id],
        ),
      ).rejects.toThrow(/immutabile/i);
      await client.query("ROLLBACK TO SAVEPOINT immutable_zone");

      const beneficiary = await client.query<{ id: number }>(
        `
        INSERT INTO beneficiari (
          codice, nome, cognome, sesso, uds, area_operativa_id, zona_uds_id
        ) VALUES ('UDS-MIG-VALID', 'Test', 'Valido', 'M', true, $1, $2)
        RETURNING id
      `,
        [areaId, zona.rows[0].id],
      );

      await client.query("SAVEPOINT beneficiary_area_mismatch");
      await expect(
        client.query(
          `
          INSERT INTO beneficiari (
            codice, nome, cognome, sesso, uds, area_operativa_id, zona_uds_id
          ) VALUES ('UDS-MIG-BAD', 'Test', 'Incoerente', 'M', true, $1, $2)
        `,
          [secondArea.rows[0].id, zona.rows[0].id],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT beneficiary_area_mismatch");

      await client.query("SAVEPOINT user_area_mismatch");
      await expect(
        client.query(
          `
          INSERT INTO utenti (
            username, password_hash, nome, area_operativa_id, zona_uds_id
          ) VALUES ('uds-migration-incoerente', 'test', 'Test', $1, $2)
        `,
          [secondArea.rows[0].id, zona.rows[0].id],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT user_area_mismatch");

      await client.query("SAVEPOINT uds_without_snapshot");
      await expect(
        client.query(
          `
          INSERT INTO interventi (
            beneficiario_id, tipo_intervento, ambito, stato
          ) VALUES ($1, 'test', 'uds', 'concluso')
        `,
          [beneficiary.rows[0].id],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT uds_without_snapshot");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
