/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260821_audit_logistica_operational_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione hardening operativo Logistica", () => {
  it("è conservativa, idempotente e protegge i nuovi dati", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(migrationSql).not.toMatch(/UPDATE\s+public\.(volontari|mezzi|turni|consegne)/i);
    expect(migrationSql).toMatch(/NOT VALID/i);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        DROP TRIGGER IF EXISTS enforce_turno_volontario_slot_trg ON turni_volontari;
        DROP TRIGGER IF EXISTS enforce_turno_slot_update_trg ON turni;
        ALTER TABLE volontari
          DROP CONSTRAINT IF EXISTS volontari_ruolo_volontario_id_fkey,
          DROP CONSTRAINT IF EXISTS volontari_stato_approvazione_check,
          DROP CONSTRAINT IF EXISTS volontari_max_consegne_turno_check;
        ALTER TABLE mezzi
          DROP CONSTRAINT IF EXISTS mezzi_stato_approvazione_check,
          DROP CONSTRAINT IF EXISTS mezzi_stato_check,
          DROP CONSTRAINT IF EXISTS mezzi_capacita_colli_check,
          DROP CONSTRAINT IF EXISTS mezzi_capacita_kg_check;
        ALTER TABLE turni
          DROP CONSTRAINT IF EXISTS turni_fascia_check,
          DROP CONSTRAINT IF EXISTS turni_stato_check;
        ALTER TABLE consegne
          DROP CONSTRAINT IF EXISTS consegne_volontario_id_fkey,
          DROP CONSTRAINT IF EXISTS consegne_mezzo_id_fkey;
      `);
      const legacyRole = await client.query<{ id: number }>(`
        INSERT INTO ruoli_volontari (nome, attivo)
        VALUES ('Ruolo migration Logistica', true)
        RETURNING id
      `);
      const legacyVolunteer = await client.query<{ id: number }>(`
        INSERT INTO volontari (
          nome, cognome, matricola, ruolo, ruolo_volontario_id,
          attivo, stato_approvazione, max_consegne_turno
        ) VALUES ('Legacy', 'Logistica', 'LEG-MIG-LOG', 'testo non riconosciuto', NULL,
          true, 'approvato', 5)
        RETURNING id
      `);
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM volontari) AS volontari,
          (SELECT count(*)::int FROM mezzi) AS mezzi,
          (SELECT count(*)::int FROM turni) AS turni,
          (SELECT count(*)::int FROM consegne) AS consegne
      `);

      await client.query(migrationSql);
      await client.query(migrationSql);

      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM volontari) AS volontari,
          (SELECT count(*)::int FROM mezzi) AS mezzi,
          (SELECT count(*)::int FROM turni) AS turni,
          (SELECT count(*)::int FROM consegne) AS consegne
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const legacyPreserved = await client.query(
        `SELECT ruolo, ruolo_volontario_id, attivo, stato_approvazione, max_consegne_turno
         FROM volontari WHERE id = $1`,
        [legacyVolunteer.rows[0].id],
      );
      expect(legacyPreserved.rows[0]).toMatchObject({
        ruolo: "testo non riconosciuto",
        ruolo_volontario_id: null,
        attivo: true,
        stato_approvazione: "approvato",
        max_consegne_turno: 5,
      });

      const columns = await client.query(`
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND (table_name, column_name) IN (
          ('volontari', 'ruolo_volontario_id'),
          ('volontari', 'versione'),
          ('mezzi', 'versione'),
          ('turni', 'stato'),
          ('turni', 'motivo_annullamento'),
          ('turni', 'versione')
        )
      `);
      expect(columns.rows).toHaveLength(6);

      const constraints = await client.query<{ conname: string; convalidated: boolean }>(`
        SELECT conname, convalidated FROM pg_constraint
        WHERE conname = ANY(ARRAY[
          'volontari_ruolo_volontario_id_fkey',
          'consegne_volontario_id_fkey',
          'consegne_mezzo_id_fkey',
          'volontari_stato_approvazione_check',
          'mezzi_stato_check',
          'turni_fascia_check'
        ])
      `);
      expect(constraints.rows).toHaveLength(6);
      expect(constraints.rows.every((constraint) => constraint.convalidated === false)).toBe(true);

      await client.query("SAVEPOINT invalid_volunteer");
      await expect(client.query(`
        INSERT INTO volontari (nome, cognome, matricola, ruolo, ruolo_volontario_id, stato_approvazione, max_consegne_turno)
        VALUES ('Nuovo', 'Invalido', 'NEW-MIG-BAD', 'Ruolo migration Logistica', $1, 'arbitrario', -1)
      `, [legacyRole.rows[0].id])).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT invalid_volunteer");

      await client.query("SAVEPOINT invalid_vehicle");
      await expect(client.query(`
        INSERT INTO mezzi (codice, tipo, proprieta, stato, stato_approvazione, capacita_colli, capacita_kg)
        VALUES ('NEW-MIG-BAD-M', 'auto', 'associazione', 'arbitrario', 'in_attesa', -1, -1)
      `)).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT invalid_vehicle");

      await client.query("SAVEPOINT invalid_shift");
      await expect(client.query(`
        INSERT INTO turni (centro_ascolto_id, data, fascia)
        VALUES ((SELECT id FROM centri_di_ascolto LIMIT 1), DATE '2026-09-01', 'Mattina')
      `)).rejects.toThrow();
      await client.query("ROLLBACK TO SAVEPOINT invalid_shift");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
