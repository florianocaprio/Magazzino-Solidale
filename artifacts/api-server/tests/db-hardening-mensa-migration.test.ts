/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260820_audit_mensa_operational_hardening.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migrazione hardening operativo Mensa", () => {
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
});
