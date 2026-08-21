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
      await client.query(`
        ALTER TABLE interventi
          DROP CONSTRAINT IF EXISTS interventi_uds_area_snapshot_check;
        DROP TRIGGER IF EXISTS enforce_new_uds_area_snapshot_trg ON interventi;
        DROP TRIGGER IF EXISTS prevent_uds_snapshot_rewrite_trg ON interventi;
        ALTER TABLE bisogni_pianificati_storico
          DROP CONSTRAINT IF EXISTS bisogni_pianificati_storico_bisogno_id_fkey;
        ALTER TABLE bisogni_pianificati_storico
          ADD CONSTRAINT bisogni_pianificati_storico_bisogno_id_fkey
          FOREIGN KEY (bisogno_id) REFERENCES bisogni_pianificati(id)
          ON DELETE CASCADE;
      `);
      const legacyArea = await client.query<{ id: number }>(`
        INSERT INTO aree_operative (nome, attivo)
        VALUES ('Area legacy migration UDS', true)
        RETURNING id
      `);
      const legacyBeneficiary = await client.query<{ id: number }>(
        `
          INSERT INTO beneficiari (
            codice, nome, cognome, sesso, uds, area_operativa_id
          ) VALUES ('UDS-MIG-LEGACY', 'Test', 'Legacy', 'M', false, $1)
          RETURNING id
        `,
        [legacyArea.rows[0].id],
      );
      const legacyIntervento = await client.query<{ id: number }>(
        `
          INSERT INTO interventi (
            beneficiario_id, tipo_intervento, ambito, stato,
            area_operativa_id_snapshot, zona_uds_id_snapshot
          ) VALUES ($1, 'legacy', 'uds', 'concluso', NULL, NULL)
          RETURNING id
        `,
        [legacyBeneficiary.rows[0].id],
      );
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
          'beneficiari_zona_richiede_uds_check',
          'beneficiari_zona_area_fk',
          'utenti_zona_richiede_area_check',
          'utenti_zona_area_fk',
          'interventi_uds_zona_area_snapshot_fk'
        ])
      `);
      expect(constraints.rows).toHaveLength(6);

      const tables = await client.query<{ exists: boolean }>(`
        SELECT to_regclass('public.bisogni_pianificati_storico') IS NOT NULL AS exists
      `);
      expect(tables.rows[0].exists).toBe(true);

      const legacyPreserved = await client.query<{
        area_snapshot: number | null;
        zona_snapshot: number | null;
      }>(
        `
          SELECT area_operativa_id_snapshot AS area_snapshot,
                 zona_uds_id_snapshot AS zona_snapshot
          FROM interventi WHERE id = $1
        `,
        [legacyIntervento.rows[0].id],
      );
      expect(legacyPreserved.rows[0]).toEqual({
        area_snapshot: null,
        zona_snapshot: null,
      });
      await expect(
        client.query(`UPDATE interventi SET note_uds = 'nota' WHERE id = $1`, [
          legacyIntervento.rows[0].id,
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });

      const storicoFk = await client.query<{
        confdeltype: string;
        convalidated: boolean;
      }>(`
        SELECT confdeltype, convalidated
        FROM pg_constraint
        WHERE conrelid = 'bisogni_pianificati_storico'::regclass
          AND conname = 'bisogni_pianificati_storico_bisogno_id_fkey'
      `);
      expect(storicoFk.rows[0]).toMatchObject({
        confdeltype: "r",
        convalidated: true,
      });

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

      await client.query("SAVEPOINT beneficiary_zone_without_uds");
      await expect(
        client.query(
          `
          INSERT INTO beneficiari (
            codice, nome, cognome, sesso, uds, area_operativa_id, zona_uds_id
          ) VALUES ('UDS-MIG-ZONA-NO-UDS', 'Test', 'Incoerente', 'M', false, $1, $2)
        `,
          [areaId, zona.rows[0].id],
        ),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT beneficiary_zone_without_uds");

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

      const socialIntervento = await client.query<{ id: number }>(
        `
          INSERT INTO interventi (beneficiario_id, tipo_intervento, ambito, stato)
          VALUES ($1, 'sociale', 'sociale', 'concluso') RETURNING id
        `,
        [beneficiary.rows[0].id],
      );
      await client.query("SAVEPOINT transition_without_snapshot");
      await expect(
        client.query(`UPDATE interventi SET ambito = 'uds' WHERE id = $1`, [
          socialIntervento.rows[0].id,
        ]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT transition_without_snapshot");

      const classifiedIntervento = await client.query<{ id: number }>(
        `
          INSERT INTO interventi (
            beneficiario_id, tipo_intervento, ambito, stato,
            area_operativa_id_snapshot, zona_uds_id_snapshot
          ) VALUES ($1, 'classificato', 'uds', 'concluso', $2, $3)
          RETURNING id
        `,
        [beneficiary.rows[0].id, areaId, zona.rows[0].id],
      );
      await client.query("SAVEPOINT immutable_snapshot");
      await expect(
        client.query(
          `UPDATE interventi SET area_operativa_id_snapshot = $1 WHERE id = $2`,
          [secondArea.rows[0].id, classifiedIntervento.rows[0].id],
        ),
      ).rejects.toThrow(/immutabile/i);
      await client.query("ROLLBACK TO SAVEPOINT immutable_snapshot");

      const bisogno = await client.query<{ id: number }>(
        `
          INSERT INTO bisogni_pianificati (
            intervento_id, tipo, descrizione, stato, priorita
          ) VALUES ($1, 'azione', 'Audit persistente', 'da_pianificare', 'normale')
          RETURNING id
        `,
        [classifiedIntervento.rows[0].id],
      );
      await client.query(
        `
          INSERT INTO bisogni_pianificati_storico (
            bisogno_id, stato_precedente, stato_nuovo, motivo
          ) VALUES ($1, NULL, 'da_pianificare', 'Creazione')
        `,
        [bisogno.rows[0].id],
      );
      await client.query("SAVEPOINT delete_need_with_history");
      await expect(
        client.query(`DELETE FROM bisogni_pianificati WHERE id = $1`, [
          bisogno.rows[0].id,
        ]),
      ).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT delete_need_with_history");
      const historyStillPresent = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM bisogni_pianificati_storico WHERE bisogno_id = $1`,
        [bisogno.rows[0].id],
      );
      expect(historyStillPresent.rows[0].count).toBe(1);

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
