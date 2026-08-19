/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

type TestClient = Awaited<ReturnType<typeof pool.connect>>;

const migrationUrl = new URL(
  "../../../lib/db/updates/20260819_audit_magazzino_hardening.sql",
  import.meta.url,
);

function schemaName(): string {
  return `audit_magazzino_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function withIsolatedSchema(
  operation: (client: TestClient, migrationSql: string) => Promise<void>,
): Promise<void> {
  const client = await pool.connect();
  const schema = schemaName();
  const quotedSchema = `"${schema}"`;
  const migrationSql = await readFile(migrationUrl, "utf8");
  try {
    await client.query(`CREATE SCHEMA ${quotedSchema}`);
    await client.query(`SET search_path TO ${quotedSchema}`);
    await client.query(`
      CREATE TABLE utenti (id integer PRIMARY KEY);
      CREATE TABLE prodotti (id integer PRIMARY KEY);
      CREATE TABLE magazzini (id integer PRIMARY KEY);
      CREATE TABLE fornitori (id integer PRIMARY KEY);
      CREATE TABLE beneficiari (id integer PRIMARY KEY);
      CREATE TABLE centri_di_ascolto (id integer PRIMARY KEY);
      CREATE TABLE volontari (id integer PRIMARY KEY);

      CREATE TABLE bolle (id integer PRIMARY KEY);
      CREATE TABLE trasferimenti (
        id integer PRIMARY KEY,
        magazzino_origine_id integer,
        magazzino_destino_id integer,
        operatore_id integer,
        trasportatore_volontario_id integer
      );
      CREATE TABLE lotti (
        id integer PRIMARY KEY,
        prodotto_id integer,
        magazzino_id integer,
        fornitore_id integer,
        quantita_caricata numeric NOT NULL,
        quantita_residua numeric NOT NULL
      );
      CREATE TABLE bolla_righe (
        id integer PRIMARY KEY,
        bolla_id integer,
        prodotto_id integer,
        lotto_id integer,
        quantita numeric NOT NULL
      );
      CREATE TABLE movimenti (
        id integer PRIMARY KEY,
        magazzino_id integer,
        prodotto_id integer,
        lotto_id integer,
        fornitore_id integer,
        beneficiario_id integer,
        bolla_id integer,
        bolla_riga_id integer,
        trasferimento_id integer,
        quantita numeric NOT NULL,
        documento_riferimento text
      );
      CREATE TABLE scarichi (
        id integer PRIMARY KEY,
        magazzino_id integer,
        centro_ascolto_id integer,
        operatore_id integer,
        CONSTRAINT scarichi_centro_existing_fk
          FOREIGN KEY (centro_ascolto_id) REFERENCES centri_di_ascolto(id)
      );
      CREATE TABLE scarico_righe (
        id integer PRIMARY KEY,
        scarico_id integer,
        prodotto_id integer,
        quantita numeric NOT NULL
      );
      CREATE TABLE trasferimento_righe (
        id integer PRIMARY KEY,
        trasferimento_id integer,
        prodotto_id integer,
        lotto_id integer,
        quantita numeric NOT NULL
      );
      CREATE TABLE approvvigionamenti (
        id integer PRIMARY KEY,
        fornitore_id integer,
        magazzino_id integer,
        centro_ascolto_id integer
      );
      CREATE TABLE approvvigionamento_righe (
        id integer PRIMARY KEY,
        approvvigionamento_id integer,
        prodotto_id integer,
        quantita_richiesta numeric NOT NULL,
        quantita_ricevuta numeric NOT NULL
      );
    `);
    await operation(client, migrationSql);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    client.release();
  }
}

afterAll(async () => {
  await pool.end();
});

describe("migrazione progressiva hardening Magazzino", () => {
  it("è idempotente, valida un database pulito e non duplica FK equivalenti", async () => {
    await withIsolatedSchema(async (client, migrationSql) => {
      await client.query(migrationSql);
      await client.query(migrationSql);

      const columns = await client.query<{ table_name: string; column_name: string; data_type: string }>(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND (table_name, column_name) IN (
            ('movimenti', 'movimento_origine_id'),
            ('movimenti', 'operatore_id'),
            ('trasferimenti', 'versione'),
            ('approvvigionamenti', 'versione')
          )
        ORDER BY table_name, column_name
      `);
      expect(columns.rows).toHaveLength(4);
      expect(columns.rows.every((row) => row.data_type === "integer")).toBe(true);

      const constraints = await client.query<{ count: number; all_valid: boolean }>(`
        SELECT count(*)::int AS count, bool_and(convalidated) AS all_valid
        FROM pg_constraint
        WHERE contype IN ('f', 'c')
          AND connamespace = current_schema()::regnamespace
      `);
      expect(constraints.rows[0].count).toBe(43);
      expect(constraints.rows[0].all_valid).toBe(true);

      const equivalentCenterFks = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_constraint constraint_row
        JOIN pg_attribute source_attribute
          ON source_attribute.attrelid = constraint_row.conrelid
         AND source_attribute.attnum = constraint_row.conkey[1]
        WHERE constraint_row.contype = 'f'
          AND constraint_row.conrelid = 'scarichi'::regclass
          AND source_attribute.attname = 'centro_ascolto_id'
      `);
      expect(equivalentCenterFks.rows[0].count).toBe(1);
    });
  });

  it("preserva orphan e valori legacy, ma protegge ogni nuova scrittura", async () => {
    await withIsolatedSchema(async (client, migrationSql) => {
      await client.query(`
        INSERT INTO lotti
          (id, prodotto_id, magazzino_id, quantita_caricata, quantita_residua)
        VALUES (1, 9001, 9002, 0, -1);
        INSERT INTO movimenti
          (id, magazzino_id, prodotto_id, lotto_id, quantita, documento_riferimento)
        VALUES (1, 9002, 9001, 1, 0, 'LEGACY');
      `);

      await client.query(migrationSql);
      await client.query(migrationSql);

      const preserved = await client.query<{ lotti: number; movimenti: number }>(`
        SELECT
          (SELECT count(*)::int FROM lotti) AS lotti,
          (SELECT count(*)::int FROM movimenti) AS movimenti
      `);
      expect(preserved.rows[0]).toEqual({ lotti: 1, movimenti: 1 });

      const states = await client.query<{ conname: string; convalidated: boolean }>(`
        SELECT conname, convalidated
        FROM pg_constraint
        WHERE connamespace = current_schema()::regnamespace
          AND conname = ANY(ARRAY[
          'lotti_prodotto_fk',
          'lotti_magazzino_fk',
          'lotti_quantita_caricata_positive_ck',
          'lotti_quantita_residua_nonnegative_ck',
          'movimenti_quantita_positive_ck'
        ])
      `);
      expect(states.rows).toHaveLength(5);
      expect(states.rows.every((row) => row.convalidated === false)).toBe(true);

      await expect(
        client.query(`
          INSERT INTO lotti
            (id, prodotto_id, magazzino_id, quantita_caricata, quantita_residua)
          VALUES (2, 9991, 9992, 1, 1)
        `),
      ).rejects.toMatchObject({ code: "23503" });

      await client.query("INSERT INTO prodotti (id) VALUES (10)");
      await client.query("INSERT INTO magazzini (id) VALUES (20)");
      await expect(
        client.query(`
          INSERT INTO lotti
            (id, prodotto_id, magazzino_id, quantita_caricata, quantita_residua)
          VALUES (3, 10, 20, 0, 0)
        `),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
