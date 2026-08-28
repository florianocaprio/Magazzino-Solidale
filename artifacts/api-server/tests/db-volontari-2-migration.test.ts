/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260831_volontari_2_0.sql",
  import.meta.url,
);
const hardeningMigrationUrl = new URL(
  "../../../lib/db/updates/20260901_volontari_2_0_review_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione Volontari 2.0", () => {
  it("è additiva, idempotente e aggiorna senza perdere il volontario legacy", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    const hardeningMigrationSql = await readFile(hardeningMigrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(hardeningMigrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(hardeningMigrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(hardeningMigrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`
        DROP TABLE IF EXISTS
          emissioni_registro_volontari,
          registro_volontari_eventi,
          importazioni_volontari_righe,
          importazioni_volontari,
          qualifiche_dei_volontari,
          qualifiche_volontari_ruoli,
          qualifiche_volontari_catalogo,
          corsi_dei_volontari,
          corsi_volontari_ruoli,
          corsi_volontari_catalogo,
          giornate_servizio_volontari,
          coperture_assicurative_volontari,
          stati_volontari
        CASCADE;
        DROP FUNCTION IF EXISTS volontari_registro_append_only();
        ALTER TABLE volontari
          DROP COLUMN IF EXISTS tipo_volontario,
          DROP COLUMN IF EXISTS telefono_secondario,
          DROP COLUMN IF EXISTS luogo_nascita,
          DROP COLUMN IF EXISTS data_nascita,
          DROP COLUMN IF EXISTS indirizzo_residenza,
          DROP COLUMN IF EXISTS codice_fiscale,
          DROP COLUMN IF EXISTS codice_fiscale_normalizzato,
          DROP COLUMN IF EXISTS data_inizio_importata,
          DROP COLUMN IF EXISTS categoria_importata_originale,
          DROP COLUMN IF EXISTS gruppo_importato_originale;
        ALTER TABLE ruoli_volontari
          DROP COLUMN IF EXISTS nome_normalizzato,
          DROP COLUMN IF EXISTS descrizione,
          DROP COLUMN IF EXISTS data_aggiornamento;
      `);
      const legacyRole = await client.query<{ id: number }>(`
        INSERT INTO ruoli_volontari (nome, attivo)
        VALUES ('  Autista Legacy  ', true)
        RETURNING id
      `);
      const legacyVolunteer = await client.query<{ id: number }>(
        `
        INSERT INTO volontari (
          nome, cognome, matricola, ruolo, ruolo_volontario_id,
          attivo, stato_approvazione
        ) VALUES (
          'Ada', 'Legacy', 'LEG-VOL-2', 'Autista Legacy', $1,
          true, 'approvato'
        ) RETURNING id
      `,
        [legacyRole.rows[0].id],
      );

      await client.query(migrationSql);
      await client.query(migrationSql);
      await client.query(hardeningMigrationSql);
      await client.query(hardeningMigrationSql);

      const preserved = await client.query(
        `
        SELECT nome, cognome, matricola, ruolo_volontario_id, tipo_volontario,
               attivo, stato_approvazione
        FROM volontari WHERE id = $1
      `,
        [legacyVolunteer.rows[0].id],
      );
      expect(preserved.rows[0]).toMatchObject({
        nome: "Ada",
        cognome: "Legacy",
        matricola: "LEG-VOL-2",
        ruolo_volontario_id: legacyRole.rows[0].id,
        tipo_volontario: "PERMANENTE",
        attivo: true,
        stato_approvazione: "approvato",
      });
      const structures = await client.query<{ name: string | null }>(`
        SELECT unnest(ARRAY[
          to_regclass('stati_volontari')::text,
          to_regclass('coperture_assicurative_volontari')::text,
          to_regclass('giornate_servizio_volontari')::text,
          to_regclass('corsi_volontari_catalogo')::text,
          to_regclass('qualifiche_volontari_catalogo')::text,
          to_regclass('registro_volontari_eventi')::text,
          to_regclass('emissioni_registro_volontari')::text
        ]) AS name
      `);
      expect(structures.rows.every((row) => row.name != null)).toBe(true);
      const hardeningColumns = await client.query<{ count: string }>(`
        SELECT count(*)::text AS count
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'chiave_idempotenza'
          AND table_name IN (
            'importazioni_volontari',
            'coperture_assicurative_volontari',
            'giornate_servizio_volontari'
          )
      `);
      expect(hardeningColumns.rows[0].count).toBe("3");

      const inserted = await client.query<{ id: number }>(
        `
        INSERT INTO registro_volontari_eventi (
          progressivo, sezione, tipo_evento, volontario_id, data_effettiva,
          snapshot, hash_evento
        ) VALUES (
          COALESCE((SELECT max(progressivo) + 1 FROM registro_volontari_eventi), 1),
          'PERMANENTE', 'REGISTRAZIONE', $1, DATE '2026-08-28',
          '{"origine":"migration-test"}'::jsonb,
          repeat('a', 64)
        ) RETURNING id
      `,
        [legacyVolunteer.rows[0].id],
      );
      let appendOnlyError: unknown = null;
      try {
        await client.query(
          "UPDATE registro_volontari_eventi SET snapshot = '{}'::jsonb WHERE id = $1",
          [inserted.rows[0].id],
        );
      } catch (error) {
        appendOnlyError = error;
      }
      expect(appendOnlyError).toBeInstanceOf(Error);
      expect((appendOnlyError as Error).message).toMatch(/append-only/i);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
