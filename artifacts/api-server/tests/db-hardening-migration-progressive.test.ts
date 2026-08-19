/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { pool } from "@workspace/db";
import { afterAll, describe, expect, it } from "vitest";

type TestClient = Awaited<ReturnType<typeof pool.connect>>;

const migrationUrl = new URL(
  "../../../lib/db/updates/20260819_audit_centro_ascolto_hardening.sql",
  import.meta.url,
);
const constraintNames = [
  "interventi_beneficiario_fk",
  "interventi_bolla_fk",
  "turni_centro_ascolto_fk",
  "turni_mezzo_fk",
  "turni_volontari_turno_fk",
  "turni_volontari_volontario_fk",
];
const indexNames = [
  "turni_centro_data_fascia_unique",
  "turni_mezzo_data_fascia_unique",
  "turni_volontari_turno_volontario_unique",
];

function schemaName(): string {
  return `audit_progressive_${process.pid}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
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
      CREATE TABLE beneficiari (id integer PRIMARY KEY);
      CREATE TABLE bolle (id integer PRIMARY KEY);
      CREATE TABLE centri_di_ascolto (id integer PRIMARY KEY);
      CREATE TABLE mezzi (id integer PRIMARY KEY);
      CREATE TABLE volontari (id integer PRIMARY KEY);
      CREATE TABLE interventi (
        id integer PRIMARY KEY,
        beneficiario_id integer NOT NULL,
        bolla_id integer NULL
      );
      CREATE TABLE turni (
        id integer PRIMARY KEY,
        centro_ascolto_id integer NOT NULL,
        data date NOT NULL,
        fascia text NOT NULL,
        mezzo_id integer NULL
      );
      CREATE TABLE turni_volontari (
        id integer PRIMARY KEY,
        turno_id integer NOT NULL,
        volontario_id integer NOT NULL
      );
    `);
    await operation(client, migrationSql);
  } finally {
    await client.query("RESET search_path");
    await client.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    client.release();
  }
}

async function constraintStates(
  client: TestClient,
): Promise<Map<string, boolean>> {
  const result = await client.query<{
    conname: string;
    convalidated: boolean;
  }>(
    `
    SELECT conname, convalidated
    FROM pg_constraint
    WHERE conrelid IN ('interventi'::regclass, 'turni'::regclass, 'turni_volontari'::regclass)
      AND conname = ANY($1::text[])
  `,
    [constraintNames],
  );
  return new Map(
    result.rows.map((row) => [row.conname, row.convalidated] as const),
  );
}

async function installedIndexes(client: TestClient): Promise<string[]> {
  const result = await client.query<{ indexname: string }>(
    `
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = ANY($1::text[])
    ORDER BY indexname
  `,
    [indexNames],
  );
  return result.rows.map((row) => row.indexname);
}

afterAll(async () => {
  await pool.end();
});

describe("migrazione progressiva hardening Centro di Ascolto", () => {
  it("valida tutte le FK su database pulito ed è idempotente", async () => {
    await withIsolatedSchema(async (client, migrationSql) => {
      await client.query(migrationSql);
      await client.query(migrationSql);

      const constraints = await constraintStates(client);
      expect([...constraints.keys()].sort()).toEqual(
        [...constraintNames].sort(),
      );
      expect([...constraints.values()].every(Boolean)).toBe(true);
      expect(await installedIndexes(client)).toEqual([...indexNames].sort());
    });
  });

  it("preserva gli orphan legacy, protegge le nuove scritture e consente la validazione dopo bonifica", async () => {
    await withIsolatedSchema(async (client, migrationSql) => {
      await client.query(`
        INSERT INTO interventi (id, beneficiario_id, bolla_id)
        VALUES (1, 9001, 9002);
        INSERT INTO turni_volontari (id, turno_id, volontario_id)
        VALUES (1, 9003, 9004);
      `);

      await client.query(migrationSql);
      await client.query(migrationSql);

      const constraints = await constraintStates(client);
      for (const name of [
        "interventi_beneficiario_fk",
        "interventi_bolla_fk",
        "turni_volontari_turno_fk",
        "turni_volontari_volontario_fk",
      ]) {
        expect(constraints.get(name), name).toBe(false);
      }
      expect(constraints.get("turni_centro_ascolto_fk")).toBe(true);
      expect(constraints.get("turni_mezzo_fk")).toBe(true);
      expect(
        (await client.query("SELECT count(*)::int AS count FROM interventi"))
          .rows[0].count,
      ).toBe(1);
      expect(
        (
          await client.query(
            "SELECT count(*)::int AS count FROM turni_volontari",
          )
        ).rows[0].count,
      ).toBe(1);
      await expect(
        client.query(
          "INSERT INTO interventi (id, beneficiario_id) VALUES (2, 9999)",
        ),
      ).rejects.toMatchObject({ code: "23503" });
      await expect(
        client.query(
          "INSERT INTO turni_volontari (id, turno_id, volontario_id) VALUES (2, 9998, 9997)",
        ),
      ).rejects.toMatchObject({ code: "23503" });
      expect(await installedIndexes(client)).toEqual([...indexNames].sort());

      await client.query(`
        INSERT INTO beneficiari (id) VALUES (9001);
        INSERT INTO bolle (id) VALUES (9002);
        INSERT INTO centri_di_ascolto (id) VALUES (1);
        INSERT INTO turni (id, centro_ascolto_id, data, fascia)
        VALUES (9003, 1, '2099-01-01', 'legacy');
        INSERT INTO volontari (id) VALUES (9004);
        ALTER TABLE interventi VALIDATE CONSTRAINT interventi_beneficiario_fk;
        ALTER TABLE interventi VALIDATE CONSTRAINT interventi_bolla_fk;
        ALTER TABLE turni_volontari VALIDATE CONSTRAINT turni_volontari_turno_fk;
        ALTER TABLE turni_volontari VALIDATE CONSTRAINT turni_volontari_volontario_fk;
      `);
      expect(
        [...(await constraintStates(client)).values()].every(Boolean),
      ).toBe(true);
    });
  });

  it("blocca i duplicati prima di creare FK o indici", async () => {
    await withIsolatedSchema(async (client, migrationSql) => {
      await client.query(`
        INSERT INTO centri_di_ascolto (id) VALUES (1);
        INSERT INTO turni (id, centro_ascolto_id, data, fascia)
        VALUES
          (1, 1, '2099-01-01', 'mattina'),
          (2, 1, '2099-01-01', 'mattina');
      `);
      await expect(client.query(migrationSql)).rejects.toThrow(
        "slot turno Centro/Area duplicati",
      );
      expect((await constraintStates(client)).size).toBe(0);
      expect(await installedIndexes(client)).toEqual([]);
    });
  });
});
