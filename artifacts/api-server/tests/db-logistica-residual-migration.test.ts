/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260822_logistica_residual_reconciliation.sql",
  import.meta.url,
);

afterAll(async () => {
  await pool.end();
});

describe("migration residui Logistica", () => {
  it("è idempotente, non interpreta il legacy e rende RESTRICT la FK del turno", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(migrationSql).not.toMatch(
      /INSERT\s+INTO\s+public\.turni_consegne\s+SELECT/i,
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await client.query(`
        SELECT
          (SELECT count(*)::int FROM turni) AS turni,
          (SELECT count(*)::int FROM turni_volontari) AS turni_volontari,
          (SELECT count(*)::int FROM consegne) AS consegne
      `);
      await client.query(migrationSql);
      await client.query(migrationSql);
      const after = await client.query(`
        SELECT
          (SELECT count(*)::int FROM turni) AS turni,
          (SELECT count(*)::int FROM turni_volontari) AS turni_volontari,
          (SELECT count(*)::int FROM consegne) AS consegne
      `);
      expect(after.rows[0]).toEqual(before.rows[0]);

      const action = await client.query<{ confdeltype: string }>(`
        SELECT c.confdeltype
        FROM pg_constraint c
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
        WHERE c.conrelid = 'turni_volontari'::regclass
          AND c.contype = 'f'
          AND c.confrelid = 'turni'::regclass
          AND a.attname = 'turno_id'
      `);
      expect(action.rows).toHaveLength(1);
      expect(action.rows[0].confdeltype).toBe("r");

      const centro = await client.query<{ id: number }>(
        "SELECT id FROM centri_di_ascolto ORDER BY id LIMIT 1",
      );
      expect(centro.rows[0]).toBeDefined();
      const volontario = await client.query<{ id: number }>(`
        INSERT INTO volontari (
          nome, cognome, matricola, ruolo, attivo, stato_approvazione
        ) VALUES ('FK', 'Restrict', 'FK-RESTRICT-' || txid_current(), 'Volontario', true, 'approvato')
        RETURNING id
      `);
      const turno = await client.query<{ id: number }>(
        `
        INSERT INTO turni (centro_ascolto_id, data, fascia)
        VALUES ($1, DATE '2099-12-20', '09-13') RETURNING id
      `,
        [centro.rows[0].id],
      );
      await client.query(
        "INSERT INTO turni_volontari (turno_id, volontario_id) VALUES ($1, $2)",
        [turno.rows[0].id, volontario.rows[0].id],
      );
      await client.query("SAVEPOINT direct_delete");
      await expect(
        client.query("DELETE FROM turni WHERE id = $1", [turno.rows[0].id]),
      ).rejects.toMatchObject({ code: "23503" });
      await client.query("ROLLBACK TO SAVEPOINT direct_delete");
      expect(
        (
          await client.query("SELECT 1 FROM turni WHERE id = $1", [
            turno.rows[0].id,
          ])
        ).rowCount,
      ).toBe(1);
      expect(
        (
          await client.query(
            "SELECT 1 FROM turni_volontari WHERE turno_id = $1",
            [turno.rows[0].id],
          )
        ).rowCount,
      ).toBe(1);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
