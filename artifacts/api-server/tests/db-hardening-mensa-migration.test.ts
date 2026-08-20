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

type Client = Awaited<ReturnType<typeof pool.connect>>;

async function createMensaFixture(client: Client) {
  const suffix = `${Date.now().toString(36).slice(-6)}${Math.random().toString(36).slice(2, 6)}`;
  const area = await client.query<{ id: number }>(
    `INSERT INTO aree_operative (nome) VALUES ($1) RETURNING id`,
    [`Mensa migration ${suffix}`],
  );
  const user = await client.query<{ id: number }>(
    `INSERT INTO utenti (username, password_hash, nome)
     VALUES ($1, 'x', 'Test migration Mensa') RETURNING id`,
    [`mensa-migration-${suffix}`],
  );
  const warehouse = await client.query<{ id: number }>(
    `INSERT INTO magazzini (codice, nome, tipo_magazzino, area_operativa_id)
     VALUES ($1, 'Magazzino migration Mensa', 'mensa', $2) RETURNING id`,
    [`MIG-${suffix}`, area.rows[0].id],
  );
  const canteen = await client.query<{ id: number }>(
    `INSERT INTO mense (codice, nome, area_operativa_id, magazzino_id, created_by)
     VALUES ($1, 'Mensa migration', $2, $3, $4) RETURNING id`,
    [`MENSA-${suffix}`, area.rows[0].id, warehouse.rows[0].id, user.rows[0].id],
  );
  const beneficiary = await client.query<{ id: number }>(
    `INSERT INTO beneficiari (codice, nome, cognome, area_operativa_id)
     VALUES ($1, 'Test', 'Migration Mensa', $2) RETURNING id`,
    [`BEN-${suffix}`, area.rows[0].id],
  );
  return {
    userId: user.rows[0].id,
    mensaId: canteen.rows[0].id,
    beneficiarioId: beneficiary.rows[0].id,
  };
}

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
      const fixture = await createMensaFixture(client);
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

      const legacyAuthorization = await client.query<{ id: number }>(
        `INSERT INTO mensa_autorizzazioni_temporanee
          (beneficiario_id, mensa_id, data_servizio, tipo_servizio, motivo, operatore_id)
         VALUES ($1, $2, '2099-12-31', NULL, 'Record legacy test', $3)
         RETURNING id`,
        [fixture.beneficiarioId, fixture.mensaId, fixture.userId],
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
      const fixture = await createMensaFixture(client);
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
      const firstKey = `migration-orphan-${Date.now()}`;
      await client.query(
        `INSERT INTO mensa_accessi
          (mensa_id, esito, motivo_esito, operatore_id, eccezione_id,
           modalita_accesso, idempotency_key)
         VALUES ($1, 'negato', 'TEST_LEGACY', $2, 2147483000, 'manuale', $3)`,
        [fixture.mensaId, fixture.userId, firstKey],
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
          [fixture.mensaId, fixture.userId, `${firstKey}-new`],
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
      const fixture = await createMensaFixture(client);
      await client.query(`
        DROP TRIGGER IF EXISTS mensa_abilitazioni_principale_overlap_trg
          ON mensa_abilitazioni;
        DROP INDEX IF EXISTS mensa_abilitazioni_principale_attiva_unique;
      `);
      await client.query(
        `INSERT INTO mensa_abilitazioni
          (beneficiario_id, mensa_id, data_inizio, data_fine, stato,
           mensa_principale, created_by)
         VALUES
          ($1, $2, '2026-01-01', '2026-12-31', 'attiva', true, $3),
          ($1, $2, '2026-06-01', NULL, 'attiva', true, $3)`,
        [fixture.beneficiarioId, fixture.mensaId, fixture.userId],
      );

      await client.query(migrationSql);
      const preserved = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM mensa_abilitazioni
         WHERE beneficiario_id = $1`,
        [fixture.beneficiarioId],
      );
      expect(preserved.rows[0].count).toBe(2);

      await client.query("SAVEPOINT new_overlap");
      await expect(
        client.query(
          `INSERT INTO mensa_abilitazioni
            (beneficiario_id, mensa_id, data_inizio, stato,
             mensa_principale, created_by)
           VALUES ($1, $2, '2026-09-01', 'attiva', true, $3)`,
          [fixture.beneficiarioId, fixture.mensaId, fixture.userId],
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
