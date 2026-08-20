/* @vitest-environment node */

import { readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const migrationUrl = new URL(
  "../../../lib/db/updates/20260820_z_area_operativa_migration.sql",
  import.meta.url,
);
const rollbackUrl = new URL(
  "../../../lib/db/rollbacks/20260820_area_operativa_migration_rollback.sql",
  import.meta.url,
);

const scopedTables = [
  "utenti",
  "beneficiari",
  "centri_di_ascolto",
  "magazzini",
  "zone_uds",
  "fornitori",
  "mense",
  "mensa_eccezioni",
  "politiche_credito_solidale",
  "credito_solidale_movimenti",
  "sessioni_cassa_emporio",
  "spese_emporio",
] as const;

const canonicalAreaForeignKeys = {
  utenti: "utenti_area_operativa_id_fk",
  beneficiari: "beneficiari_area_operativa_id_fk",
  centri_di_ascolto: "centri_di_ascolto_area_operativa_id_fk",
  magazzini: "magazzini_area_operativa_id_fk",
  zone_uds: "zone_uds_area_operativa_id_fk",
  mense: "mense_area_operativa_id_fkey",
  mensa_eccezioni: "mensa_eccezioni_area_operativa_id_fkey",
  politiche_credito_solidale: "politiche_credito_solidale_area_operativa_id_fk",
  credito_solidale_movimenti: "credito_solidale_movimenti_area_operativa_id_fk",
  sessioni_cassa_emporio: "sessioni_cassa_emporio_area_operativa_id_fk",
  spese_emporio: "spese_emporio_area_operativa_id_fk",
} as const;

type Client = Awaited<ReturnType<typeof pool.connect>>;

async function areaSnapshot(client: Client, tableName: "citta" | "aree_operative") {
  const result = await client.query<{
    count: number;
    max_id: number | null;
    digest: string | null;
  }>(`
    SELECT
      count(*)::int AS count,
      max(id)::int AS max_id,
      md5(string_agg(
        concat_ws('|', id, nome, provincia, sigla, attivo, note, data_creazione),
        E'\\n' ORDER BY id
      )) AS digest
    FROM public.${tableName}
  `);
  return result.rows[0];
}

async function referenceSnapshot(
  client: Client,
  columnName: "citta_id" | "area_operativa_id",
  areaTable: "citta" | "aree_operative",
) {
  const snapshots: Record<string, unknown> = {};
  for (const tableName of scopedTables) {
    const result = await client.query<{
      count: number;
      null_count: number;
      distinct_count: number;
      orphan_count: number;
      digest: string | null;
    }>(`
      SELECT
        count(*)::int AS count,
        count(*) FILTER (WHERE scoped.${columnName} IS NULL)::int AS null_count,
        count(DISTINCT scoped.${columnName})::int AS distinct_count,
        count(*) FILTER (
          WHERE scoped.${columnName} IS NOT NULL AND area.id IS NULL
        )::int AS orphan_count,
        md5(string_agg(
          concat_ws('|', scoped.id, scoped.${columnName}),
          E'\\n' ORDER BY scoped.id
        )) AS digest
      FROM public.${tableName} scoped
      LEFT JOIN public.${areaTable} area ON area.id = scoped.${columnName}
    `);
    snapshots[tableName] = result.rows[0];
  }
  return snapshots;
}

async function compatibilitySnapshot(
  client: Client,
  columnName: "citta_id" | "area_operativa_id",
) {
  const result = await client.query<{
    mense_magazzini_mismatch: number;
    zone_orfane: number;
  }>(`
    SELECT
      (SELECT count(*)::int
       FROM mense m
       JOIN magazzini mg ON mg.id = m.magazzino_id
       WHERE m.${columnName} IS DISTINCT FROM mg.${columnName}) AS mense_magazzini_mismatch,
      (SELECT count(*)::int
       FROM zone_uds z
       LEFT JOIN ${columnName === "citta_id" ? "citta" : "aree_operative"} area
         ON area.id = z.${columnName}
       WHERE area.id IS NULL) AS zone_orfane
  `);
  return result.rows[0];
}

afterAll(async () => {
  await pool.end();
});

describe("migrazione Città -> Area Operativa", () => {
  it("usa esclusivamente rename in-place e preserva dati, riferimenti e oggetti PostgreSQL", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(migrationSql).not.toMatch(/\bINSERT\s+INTO\b/i);
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SEQUENCE)\b/i);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const state = await client.query<{ old_table: boolean; new_table: boolean }>(`
        SELECT
          to_regclass('public.citta') IS NOT NULL AS old_table,
          to_regclass('public.aree_operative') IS NOT NULL AS new_table
      `);
      expect(Number(state.rows[0].old_table) + Number(state.rows[0].new_table)).toBe(1);

      const startsLegacy = state.rows[0].old_table;
      const oldTable = startsLegacy ? "citta" : "aree_operative";
      const oldColumn = startsLegacy ? "citta_id" : "area_operativa_id";
      const beforeArea = await areaSnapshot(client, oldTable);
      const beforeReferences = await referenceSnapshot(client, oldColumn, oldTable);
      const beforeCompatibility = await compatibilitySnapshot(client, oldColumn);
      const beforeSequence = await client.query<{ last_value: string }>(
        `SELECT last_value::text FROM ${startsLegacy ? "citta_id_seq" : "aree_operative_id_seq"}`,
      );

      await client.query(migrationSql);
      await client.query(migrationSql);

      expect(await areaSnapshot(client, "aree_operative")).toEqual(beforeArea);
      expect(
        await referenceSnapshot(client, "area_operativa_id", "aree_operative"),
      ).toEqual(beforeReferences);
      expect(await compatibilitySnapshot(client, "area_operativa_id")).toEqual(
        beforeCompatibility,
      );

      const columns = await client.query<{ table_name: string }>(`
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'area_operativa_id'
        ORDER BY table_name
      `);
      expect(columns.rows.map((row) => row.table_name)).toEqual([...scopedTables].sort());

      const legacyColumns = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'citta_id'
      `);
      expect(legacyColumns.rows[0].count).toBe(0);

      const foreignKeys = await client.query<{ count: number; all_valid: boolean }>(`
        SELECT count(*)::int AS count, bool_and(convalidated) AS all_valid
        FROM pg_constraint
        WHERE contype = 'f' AND confrelid = 'public.aree_operative'::regclass
      `);
      expect(foreignKeys.rows[0]).toEqual({ count: 11, all_valid: true });

      const catalog = await client.query<{ legacy_count: number }>(`
        SELECT count(*)::int AS legacy_count
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname ILIKE '%citta%'
      `);
      expect(catalog.rows[0].legacy_count).toBe(0);

      const constraints = await client.query<{ legacy_count: number }>(`
        SELECT count(*)::int AS legacy_count
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND c.conname ILIKE '%citta%'
      `);
      expect(constraints.rows[0].legacy_count).toBe(0);

      const sequence = await client.query<{
        sequence_name: string;
        last_value: string;
        owned_by: string;
      }>(`
        SELECT
          pg_get_serial_sequence('public.aree_operative', 'id') AS sequence_name,
          (SELECT last_value::text FROM aree_operative_id_seq) AS last_value,
          pg_get_serial_sequence('public.aree_operative', 'id') AS owned_by
      `);
      expect(sequence.rows[0]).toEqual({
        sequence_name: "public.aree_operative_id_seq",
        last_value: beforeSequence.rows[0].last_value,
        owned_by: "public.aree_operative_id_seq",
      });

      await client.query("SAVEPOINT split_brain");
      await client.query("CREATE TABLE public.citta (id integer)");
      await expect(client.query(migrationSql)).rejects.toThrow(/Split-brain/);
      await client.query("ROLLBACK TO SAVEPOINT split_brain");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("ha un rollback simmetrico, idempotente e data-preserving", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    const rollbackSql = await readFile(rollbackUrl, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migrationSql);
      const beforeArea = await areaSnapshot(client, "aree_operative");
      const beforeReferences = await referenceSnapshot(
        client,
        "area_operativa_id",
        "aree_operative",
      );

      await client.query(rollbackSql);
      await client.query(rollbackSql);
      expect(await areaSnapshot(client, "citta")).toEqual(beforeArea);
      expect(await referenceSnapshot(client, "citta_id", "citta")).toEqual(
        beforeReferences,
      );

      await client.query(migrationSql);
      expect(await areaSnapshot(client, "aree_operative")).toEqual(beforeArea);
      expect(
        await referenceSnapshot(client, "area_operativa_id", "aree_operative"),
      ).toEqual(beforeReferences);
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });

  it("normalizza le FK per semantica e rifiuta assenze, duplicati e collisioni", async () => {
    const migrationSql = await readFile(migrationUrl, "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migrationSql);

      await client.query(`
        ALTER TABLE public.utenti
        RENAME CONSTRAINT utenti_area_operativa_id_fk
        TO utenti_area_operativa_id_aree_operative_id_fk
      `);
      await client.query(migrationSql);
      await client.query(migrationSql);

      const normalizedForeignKeys = await client.query<{
        table_name: string;
        constraint_name: string;
      }>(`
        SELECT source_table.relname AS table_name, c.conname AS constraint_name
        FROM pg_constraint c
        JOIN pg_class source_table ON source_table.oid = c.conrelid
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
        JOIN pg_attribute source_column
          ON source_column.attrelid = c.conrelid
          AND source_column.attnum = c.conkey[1]
        JOIN pg_attribute referenced_column
          ON referenced_column.attrelid = c.confrelid
          AND referenced_column.attnum = c.confkey[1]
        WHERE c.contype = 'f'
          AND source_namespace.nspname = 'public'
          AND source_column.attname = 'area_operativa_id'
          AND c.confrelid = 'public.aree_operative'::regclass
          AND referenced_column.attname = 'id'
          AND cardinality(c.conkey) = 1
          AND cardinality(c.confkey) = 1
        ORDER BY source_table.relname
      `);
      expect(
        Object.fromEntries(
          normalizedForeignKeys.rows.map((row) => [
            row.table_name,
            row.constraint_name,
          ]),
        ),
      ).toEqual(canonicalAreaForeignKeys);

      const fornitoriForeignKeys = await client.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_constraint c
        JOIN pg_class source_table ON source_table.oid = c.conrelid
        JOIN pg_namespace source_namespace ON source_namespace.oid = source_table.relnamespace
        JOIN pg_attribute source_column
          ON source_column.attrelid = c.conrelid
          AND source_column.attnum = ANY(c.conkey)
        WHERE c.contype = 'f'
          AND source_namespace.nspname = 'public'
          AND source_table.relname = 'fornitori'
          AND source_column.attname = 'area_operativa_id'
      `);
      expect(fornitoriForeignKeys.rows[0].count).toBe(0);

      await client.query("SAVEPOINT missing_fk");
      await client.query(
        "ALTER TABLE public.utenti DROP CONSTRAINT utenti_area_operativa_id_fk",
      );
      await expect(client.query(migrationSql)).rejects.toThrow(
        /nessuna FK semantica/,
      );
      await client.query("ROLLBACK TO SAVEPOINT missing_fk");

      await client.query("SAVEPOINT duplicate_fk");
      await client.query(`
        ALTER TABLE public.utenti
        ADD CONSTRAINT utenti_area_operativa_duplicate_fk
        FOREIGN KEY (area_operativa_id) REFERENCES public.aree_operative(id)
      `);
      await expect(client.query(migrationSql)).rejects.toThrow(
        /2 FK semantiche/,
      );
      await client.query("ROLLBACK TO SAVEPOINT duplicate_fk");

      await client.query("SAVEPOINT canonical_collision");
      await client.query(`
        ALTER TABLE public.utenti
        RENAME CONSTRAINT utenti_area_operativa_id_fk
        TO utenti_area_operativa_noncanonical_fk
      `);
      await client.query(`
        ALTER TABLE public.utenti
        ADD CONSTRAINT utenti_area_operativa_id_fk
        CHECK (area_operativa_id IS NULL OR area_operativa_id > 0)
      `);
      await expect(client.query(migrationSql)).rejects.toThrow(
        /nome canonico .* occupato da un constraint diverso/,
      );
      await client.query("ROLLBACK TO SAVEPOINT canonical_collision");

      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
