/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260820_audit_mensa_operational_hardening.sql",
  import.meta.url,
);
const schemaUrl = new URL(
  "../../../lib/db/src/schema/mensa.ts",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione hardening operativo Mensa", () => {
  it("non reintroduce nello schema Drizzle l'unicità principale obsoleta", async () => {
    const schema = await readFile(schemaUrl, "utf8");
    expect(schema).not.toContain("mensa_abilitazioni_principale_attiva_unique");
  });

  it("è idempotente e non modifica i conteggi storici", async () => {
    const client = await pool.connect();
    const migrationSql = await readFile(migrationUrl, "utf8");
    try {
      await client.query("BEGIN");
      const before = await client.query<{
        beneficiari: number;
        mense: number;
        pasti: number;
        accessi: number;
        movimenti: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM mense) AS mense,
          (SELECT count(*)::int FROM mensa_pasti) AS pasti,
          (SELECT count(*)::int FROM mensa_accessi) AS accessi,
          (SELECT count(*)::int FROM movimenti) AS movimenti
      `);

      const legacyReference = await client.query<{
        beneficiario_id: number;
        mensa_id: number;
        user_id: number;
      }>(`
        SELECT b.id AS beneficiario_id, m.id AS mensa_id, u.id AS user_id
        FROM beneficiari b
        JOIN mense m ON m.citta_id = b.citta_id
        CROSS JOIN utenti u
        ORDER BY b.id, m.id, u.id
        LIMIT 1
      `);
      expect(legacyReference.rowCount).toBe(1);
      const legacy = legacyReference.rows[0];
      const legacyAuthorization = await client.query<{ id: number }>(
        `INSERT INTO mensa_autorizzazioni_temporanee
          (beneficiario_id, mensa_id, data_servizio, tipo_servizio, motivo, operatore_id)
         VALUES ($1, $2, '2099-12-31', NULL, 'Record legacy test', $3)
         RETURNING id`,
        [legacy.beneficiario_id, legacy.mensa_id, legacy.user_id],
      );

      await client.query(migrationSql);
      await client.query(migrationSql);

      const after = await client.query<{
        beneficiari: number;
        mense: number;
        pasti: number;
        accessi: number;
        movimenti: number;
      }>(`
        SELECT
          (SELECT count(*)::int FROM beneficiari) AS beneficiari,
          (SELECT count(*)::int FROM mense) AS mense,
          (SELECT count(*)::int FROM mensa_pasti) AS pasti,
          (SELECT count(*)::int FROM mensa_accessi) AS accessi,
          (SELECT count(*)::int FROM movimenti) AS movimenti
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const tables = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN ('mensa_giornate_servizio', 'mensa_consumi', 'mensa_consumi_storni')
        ORDER BY table_name
      `);
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        "mensa_consumi",
        "mensa_consumi_storni",
        "mensa_giornate_servizio",
      ]);

      const trigger = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_trigger
        WHERE tgname = 'mensa_abilitazioni_principale_overlap_trg'
          AND NOT tgisinternal
      `);
      expect(trigger.rows[0].count).toBe(1);

      const constraints = await client.query<{
        accessi_eccezione: number;
        accessi_eccezione_validi: number;
        pasti_giornata_validi: number;
      }>(`
        SELECT
          count(*) FILTER (
            WHERE c.conrelid = 'mensa_accessi'::regclass
              AND c.confrelid = 'mensa_eccezioni'::regclass
              AND c.contype = 'f'
          )::int AS accessi_eccezione,
          count(*) FILTER (
            WHERE c.conrelid = 'mensa_accessi'::regclass
              AND c.confrelid = 'mensa_eccezioni'::regclass
              AND c.contype = 'f'
              AND c.convalidated
          )::int AS accessi_eccezione_validi,
          count(*) FILTER (
            WHERE c.conrelid = 'mensa_pasti'::regclass
              AND c.confrelid = 'mensa_giornate_servizio'::regclass
              AND c.contype = 'f'
              AND c.convalidated
          )::int AS pasti_giornata_validi
        FROM pg_constraint c
      `);
      expect(constraints.rows[0]).toEqual({
        accessi_eccezione: 1,
        accessi_eccezione_validi: 1,
        pasti_giornata_validi: 1,
      });

      const temporaryAuthorizationSchema = await client.query<{
        nullable: string;
        old_index: number;
        service_index: number;
      }>(`
        SELECT
          (SELECT is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'mensa_autorizzazioni_temporanee'
             AND column_name = 'tipo_servizio') AS nullable,
          (SELECT count(*)::int FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'mensa_autorizzazioni_temporanee_giorno_unique') AS old_index,
          (SELECT count(*)::int FROM pg_indexes
           WHERE schemaname = 'public'
             AND indexname = 'mensa_autorizzazioni_temporanee_servizio_unique') AS service_index
      `);
      expect(temporaryAuthorizationSchema.rows[0]).toEqual({
        nullable: "YES",
        old_index: 0,
        service_index: 1,
      });
      const preservedLegacy = await client.query<{
        tipo_servizio: string | null;
      }>(
        `SELECT tipo_servizio
         FROM mensa_autorizzazioni_temporanee
         WHERE id = $1`,
        [legacyAuthorization.rows[0].id],
      );
      expect(preservedLegacy.rows).toEqual([{ tipo_servizio: null }]);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("preserva un orfano legacy, lascia la FK NOT VALID e blocca nuovi orfani", async () => {
    const client = await pool.connect();
    const migrationSql = await readFile(migrationUrl, "utf8");
    try {
      await client.query("BEGIN");
      const existingConstraints = await client.query<{ conname: string }>(`
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'mensa_accessi'::regclass
          AND c.confrelid = 'mensa_eccezioni'::regclass
          AND c.contype = 'f'
      `);
      for (const { conname } of existingConstraints.rows) {
        await client.query(
          `ALTER TABLE mensa_accessi DROP CONSTRAINT "${conname.replaceAll('"', '""')}"`,
        );
      }
      const reference = await client.query<{
        mensa_id: number;
        user_id: number;
      }>(`
        SELECT m.id AS mensa_id, u.id AS user_id
        FROM mense m CROSS JOIN utenti u
        ORDER BY m.id, u.id
        LIMIT 1
      `);
      expect(reference.rowCount).toBe(1);
      const { mensa_id: mensaId, user_id: userId } = reference.rows[0];
      const firstKey = `migration-orphan-${Date.now()}`;
      await client.query(
        `INSERT INTO mensa_accessi
          (mensa_id, esito, motivo_esito, operatore_id, eccezione_id,
           modalita_accesso, idempotency_key)
         VALUES ($1, 'negato', 'TEST_LEGACY', $2, 2147483000, 'manuale', $3)`,
        [mensaId, userId, firstKey],
      );

      await client.query(migrationSql);
      const constraint = await client.query<{ count: number; valid: boolean }>(`
        SELECT count(*)::int AS count, bool_and(c.convalidated) AS valid
        FROM pg_constraint c
        WHERE c.conrelid = 'mensa_accessi'::regclass
          AND c.confrelid = 'mensa_eccezioni'::regclass
          AND c.contype = 'f'
      `);
      expect(constraint.rows[0]).toEqual({ count: 1, valid: false });

      await client.query("SAVEPOINT new_orphan");
      await expect(
        client.query(
          `INSERT INTO mensa_accessi
            (mensa_id, esito, motivo_esito, operatore_id, eccezione_id,
             modalita_accesso, idempotency_key)
           VALUES ($1, 'negato', 'TEST_NEW', $2, 2147483001, 'manuale', $3)`,
          [mensaId, userId, `${firstKey}-new`],
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK TO SAVEPOINT new_orphan");

      await client.query(migrationSql);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("preserva overlap legacy e installa comunque la protezione per nuove scritture", async () => {
    const client = await pool.connect();
    const migrationSql = await readFile(migrationUrl, "utf8");
    try {
      await client.query("BEGIN");
      await client.query(`
        DROP TRIGGER IF EXISTS mensa_abilitazioni_principale_overlap_trg
          ON mensa_abilitazioni;
        DROP INDEX IF EXISTS mensa_abilitazioni_principale_attiva_unique;
      `);
      const reference = await client.query<{
        mensa_id: number;
        citta_id: number;
        user_id: number;
      }>(`
        SELECT m.id AS mensa_id, m.citta_id, u.id AS user_id
        FROM mense m CROSS JOIN utenti u
        WHERE m.citta_id IS NOT NULL
        ORDER BY m.id, u.id
        LIMIT 1
      `);
      expect(reference.rowCount).toBe(1);
      const {
        mensa_id: mensaId,
        citta_id: cittaId,
        user_id: userId,
      } = reference.rows[0];
      const beneficiary = await client.query<{ id: number }>(
        `INSERT INTO beneficiari (codice, nome, cognome, citta_id)
         VALUES ($1, 'Legacy', 'Overlap', $2)
         RETURNING id`,
        [`OV-${Date.now().toString().slice(-12)}`, cittaId],
      );
      const beneficiaryId = beneficiary.rows[0].id;
      await client.query(
        `INSERT INTO mensa_abilitazioni
          (beneficiario_id, mensa_id, data_inizio, data_fine, stato,
           mensa_principale, created_by)
         VALUES
          ($1, $2, '2026-01-01', '2026-12-31', 'attiva', true, $3),
          ($1, $2, '2026-06-01', NULL, 'attiva', true, $3)`,
        [beneficiaryId, mensaId, userId],
      );

      await client.query(migrationSql);
      const preserved = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM mensa_abilitazioni
         WHERE beneficiario_id = $1`,
        [beneficiaryId],
      );
      expect(preserved.rows[0].count).toBe(2);

      await client.query("SAVEPOINT new_overlap");
      await expect(
        client.query(
          `INSERT INTO mensa_abilitazioni
            (beneficiario_id, mensa_id, data_inizio, stato,
             mensa_principale, created_by)
           VALUES ($1, $2, '2026-09-01', 'attiva', true, $3)`,
          [beneficiaryId, mensaId, userId],
        ),
      ).rejects.toMatchObject({ code: "23P01" });
      await client.query("ROLLBACK TO SAVEPOINT new_overlap");

      await client.query(migrationSql);
      const trigger = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_trigger
        WHERE tgname = 'mensa_abilitazioni_principale_overlap_trg'
          AND NOT tgisinternal
      `);
      expect(trigger.rows[0].count).toBe(1);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
