/* @vitest-environment node */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  bollaRigheTable,
  pool,
  prenotazioniMagazzinoTable,
  trasferimentoRigheTable,
} from "@workspace/db";
import type { PoolClient } from "pg";

type Owner = {
  bollaId?: number | null;
  rigaBollaId?: number | null;
  trasferimentoId?: number | null;
  rigaTrasferimentoId?: number | null;
};

type Fixture = {
  magazzinoId: number;
  prodottoId: number;
  lottoId: number;
  bollaA: number;
  bollaB: number;
  rigaBollaA: number;
  rigaBollaB: number;
  trasferimentoA: number;
  trasferimentoB: number;
  rigaTrasferimentoA: number;
  rigaTrasferimentoB: number;
};

async function insertedId(
  client: PoolClient,
  query: string,
  params: unknown[],
): Promise<number> {
  const result = await client.query<{ id: number }>(query, params);
  return result.rows[0].id;
}

async function seedFixture(client: PoolClient): Promise<Fixture> {
  const suffix = randomUUID().slice(0, 8);
  const magazzinoId = await insertedId(
    client,
    "INSERT INTO magazzini (codice, nome) VALUES ($1, $2) RETURNING id",
    [`OFK-A-${suffix}`, "Owner FK origine"],
  );
  const destinazioneId = await insertedId(
    client,
    "INSERT INTO magazzini (codice, nome) VALUES ($1, $2) RETURNING id",
    [`OFK-B-${suffix}`, "Owner FK destinazione"],
  );
  const prodottoId = await insertedId(
    client,
    `INSERT INTO prodotti (codice, nome, tipo_prodotto, unita_misura)
     VALUES ($1, 'Owner FK prodotto', 'alimentare', 'pz') RETURNING id`,
    [`OFK-P-${suffix}`],
  );
  const lottoId = await insertedId(
    client,
    `INSERT INTO lotti
       (prodotto_id, magazzino_id, data_carico, quantita_caricata, quantita_residua)
     VALUES ($1, $2, '2026-09-24', 10, 10) RETURNING id`,
    [prodottoId, magazzinoId],
  );
  const beneficiarioId = await insertedId(
    client,
    `INSERT INTO beneficiari (codice, nome, cognome, sesso)
     VALUES ($1, 'Owner', 'FK', 'X') RETURNING id`,
    [`OFK-BEN-${suffix}`],
  );
  const bolla = async (label: string) =>
    insertedId(
      client,
      `INSERT INTO bolle (numero_bolla, data_bolla, beneficiario_id, magazzino_id)
       VALUES ($1, '2026-09-24', $2, $3) RETURNING id`,
      [`OFK-BOL-${label}-${suffix}`, beneficiarioId, magazzinoId],
    );
  const bollaA = await bolla("A");
  const bollaB = await bolla("B");
  const bollaRiga = async (bollaId: number) =>
    insertedId(
      client,
      `INSERT INTO bolla_righe (bolla_id, prodotto_id, quantita, unita_misura)
       VALUES ($1, $2, 1, 'pz') RETURNING id`,
      [bollaId, prodottoId],
    );
  const rigaBollaA = await bollaRiga(bollaA);
  const rigaBollaB = await bollaRiga(bollaB);
  const trasferimento = async (label: string) =>
    insertedId(
      client,
      `INSERT INTO trasferimenti
         (codice, magazzino_origine_id, magazzino_destino_id, data_richiesta)
       VALUES ($1, $2, $3, '2026-09-24') RETURNING id`,
      [`OFK-TR-${label}-${suffix}`, magazzinoId, destinazioneId],
    );
  const trasferimentoA = await trasferimento("A");
  const trasferimentoB = await trasferimento("B");
  const trasferimentoRiga = async (trasferimentoId: number) =>
    insertedId(
      client,
      `INSERT INTO trasferimento_righe
         (trasferimento_id, prodotto_id, quantita, unita_misura)
       VALUES ($1, $2, 1, 'pz') RETURNING id`,
      [trasferimentoId, prodottoId],
    );
  const rigaTrasferimentoA = await trasferimentoRiga(trasferimentoA);
  const rigaTrasferimentoB = await trasferimentoRiga(trasferimentoB);
  return {
    magazzinoId,
    prodottoId,
    lottoId,
    bollaA,
    bollaB,
    rigaBollaA,
    rigaBollaB,
    trasferimentoA,
    trasferimentoB,
    rigaTrasferimentoA,
    rigaTrasferimentoB,
  };
}

async function withFixture(
  run: (client: PoolClient, fixture: Fixture) => Promise<void>,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await run(client, await seedFixture(client));
  } finally {
    try {
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }
}

function insertReservation(client: PoolClient, fixture: Fixture, owner: Owner) {
  return client.query<{ id: number }>(
    `INSERT INTO prenotazioni_magazzino
       (bolla_id, riga_bolla_id, trasferimento_id, riga_trasferimento_id,
        prodotto_id, lotto_id, magazzino_id, quantita)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 1) RETURNING id`,
    [
      owner.bollaId ?? null,
      owner.rigaBollaId ?? null,
      owner.trasferimentoId ?? null,
      owner.rigaTrasferimentoId ?? null,
      fixture.prodottoId,
      fixture.lottoId,
      fixture.magazzinoId,
    ],
  );
}

async function expectConstraint(
  client: PoolClient,
  fixture: Fixture,
  owner: Owner,
  code: string,
  constraint: string,
) {
  await client.query("SAVEPOINT owner_fk_probe");
  try {
    await expect(
      insertReservation(client, fixture, owner),
    ).rejects.toMatchObject({
      code,
      constraint,
    });
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT owner_fk_probe");
    await client.query("RELEASE SAVEPOINT owner_fk_probe");
  }
}

afterAll(async () => {
  await pool.end();
});

describe("M4B.1 — FK owner composti delle prenotazioni", () => {
  it("OWNER-FK-01: riga Bolla B non appartiene a Bolla A", async () => {
    await withFixture(async (client, fixture) => {
      await expectConstraint(
        client,
        fixture,
        { bollaId: fixture.bollaA, rigaBollaId: fixture.rigaBollaB },
        "23503",
        "prenotazioni_magazzino_bolla_riga_owner_fk",
      );
    });
  });

  it("OWNER-FK-02: riga Trasferimento B non appartiene a Trasferimento A", async () => {
    await withFixture(async (client, fixture) => {
      await expectConstraint(
        client,
        fixture,
        {
          trasferimentoId: fixture.trasferimentoA,
          rigaTrasferimentoId: fixture.rigaTrasferimentoB,
        },
        "23503",
        "prenotazioni_magazzino_trasferimento_riga_owner_fk",
      );
    });
  });

  it("OWNER-FK-03: accetta una riga della propria Bolla", async () => {
    await withFixture(async (client, fixture) => {
      const result = await insertReservation(client, fixture, {
        bollaId: fixture.bollaA,
        rigaBollaId: fixture.rigaBollaA,
      });
      expect(result.rows).toHaveLength(1);
    });
  });

  it("OWNER-FK-04: accetta una riga del proprio Trasferimento", async () => {
    await withFixture(async (client, fixture) => {
      const result = await insertReservation(client, fixture, {
        trasferimentoId: fixture.trasferimentoA,
        rigaTrasferimentoId: fixture.rigaTrasferimentoA,
      });
      expect(result.rows).toHaveLength(1);
    });
  });

  it("OWNER-FK-05: owner misti o incompleti violano owner_exclusive", async () => {
    await withFixture(async (client, fixture) => {
      for (const owner of [
        { bollaId: fixture.bollaA },
        { trasferimentoId: fixture.trasferimentoA },
        {
          bollaId: fixture.bollaA,
          rigaBollaId: fixture.rigaBollaA,
          trasferimentoId: fixture.trasferimentoA,
          rigaTrasferimentoId: fixture.rigaTrasferimentoA,
        },
      ]) {
        await expectConstraint(
          client,
          fixture,
          owner,
          "23514",
          "prenotazioni_magazzino_owner_exclusive",
        );
      }
    });
  });

  it("Drizzle, migration 41 e catalogo PostgreSQL concordano sui FK owner", async () => {
    const expected = [
      {
        name: "prenotazioni_magazzino_bolla_riga_owner_fk",
        columns: ["riga_bolla_id", "bolla_id"],
        foreignTable: "bolla_righe",
        foreignColumns: ["id", "bolla_id"],
        onDelete: "restrict",
      },
      {
        name: "prenotazioni_magazzino_trasferimento_riga_owner_fk",
        columns: ["riga_trasferimento_id", "trasferimento_id"],
        foreignTable: "trasferimento_righe",
        foreignColumns: ["id", "trasferimento_id"],
        onDelete: "restrict",
      },
    ];
    const drizzle = getTableConfig(prenotazioniMagazzinoTable)
      .foreignKeys.filter((fk) => fk.getName().endsWith("_riga_owner_fk"))
      .map((fk) => {
        const reference = fk.reference();
        return {
          name: fk.getName(),
          columns: reference.columns.map((column) => column.name),
          foreignTable: getTableName(reference.foreignTable),
          foreignColumns: reference.foreignColumns.map((column) => column.name),
          onDelete: fk.onDelete,
        };
      });
    expect(drizzle).toEqual(expected);

    const migration = readFileSync(
      new URL(
        "../../../lib/db/updates/20260923_m4b1_prenotazioni_trasferimenti.sql",
        import.meta.url,
      ),
      "utf8",
    ).replace(/\s+/g, " ");
    for (const row of expected) {
      expect(migration).toContain(
        `CONSTRAINT ${row.name} FOREIGN KEY (${row.columns.join(", ")}) REFERENCES ${row.foreignTable}(${row.foreignColumns.join(", ")}) ON DELETE RESTRICT`,
      );
    }

    const parentKeys = [
      {
        table: bollaRigheTable,
        name: "bolla_righe_id_bolla_unique",
        columns: ["id", "bolla_id"],
      },
      {
        table: trasferimentoRigheTable,
        name: "trasferimento_righe_id_trasferimento_unique",
        columns: ["id", "trasferimento_id"],
      },
    ];
    for (const key of parentKeys) {
      const config = getTableConfig(key.table);
      expect(
        config.uniqueConstraints
          .find((constraint) => constraint.getName() === key.name)
          ?.columns.map((column) => column.name),
      ).toEqual(key.columns);
      expect(migration).toContain(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${key.name} ON ${config.name}(${key.columns.join(", ")})`,
      );
    }
    const indexes = await pool.query<{
      tablename: string;
      indexname: string;
      indexdef: string;
    }>(
      `SELECT tablename, indexname, indexdef FROM pg_indexes
       WHERE schemaname = 'public' AND indexname = ANY($1::text[])
       ORDER BY indexname`,
      [parentKeys.map((key) => key.name)],
    );
    expect(indexes.rows).toHaveLength(2);
    for (const key of parentKeys) {
      const index = indexes.rows.find((row) => row.indexname === key.name);
      expect(index?.tablename).toBe(getTableConfig(key.table).name);
      expect(index?.indexdef).toContain("CREATE UNIQUE INDEX");
      expect(index?.indexdef).toContain(`(${key.columns.join(", ")})`);
    }

    const catalog = await pool.query<{
      name: string;
      columns: string[];
      foreign_table: string;
      foreign_columns: string[];
      on_delete: string;
    }>(
      `SELECT c.conname AS name,
         to_json(ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
               ORDER BY k.ord)) AS columns,
         c.confrelid::regclass::text AS foreign_table,
         to_json(ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
               ORDER BY k.ord)) AS foreign_columns,
         c.confdeltype::text AS on_delete
       FROM pg_constraint c
       WHERE c.conrelid = 'public.prenotazioni_magazzino'::regclass
         AND c.conname = ANY($1::text[])
       ORDER BY c.conname`,
      [expected.map((row) => row.name)],
    );
    expect(
      catalog.rows.map((row) => ({
        name: row.name,
        columns: row.columns,
        foreignTable: row.foreign_table,
        foreignColumns: row.foreign_columns,
        onDelete: row.on_delete === "r" ? "restrict" : row.on_delete,
      })),
    ).toEqual(expected);
  });
});
