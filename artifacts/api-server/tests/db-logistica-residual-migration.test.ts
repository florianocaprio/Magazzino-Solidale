/* @vitest-environment node */

import { readdir, readFile } from "node:fs/promises";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";

const centroAscoltoMigrationUrl = new URL(
  "../../../lib/db/updates/20260819_audit_centro_ascolto_hardening.sql",
  import.meta.url,
);
const replayGuardMigrationUrl = new URL(
  "../../../lib/db/updates/20260821_zz_logistica_turno_fk_replay_guard.sql",
  import.meta.url,
);
const residualMigrationUrl = new URL(
  "../../../lib/db/updates/20260822_logistica_residual_reconciliation.sql",
  import.meta.url,
);
const updatesUrl = new URL("../../../lib/db/updates/", import.meta.url);

type TestClient = Awaited<ReturnType<typeof pool.connect>>;
type SemanticFk = { conname: string; confdeltype: string };

const semanticFkQuery = `
  SELECT c.conname, c.confdeltype
  FROM pg_constraint c
  WHERE c.conrelid = 'public.turni_volontari'::regclass
    AND c.contype = 'f'
    AND c.confrelid = 'public.turni'::regclass
    AND cardinality(c.conkey) = 1
    AND cardinality(c.confkey) = 1
    AND c.conkey[1] = (
      SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = c.conrelid AND a.attname = 'turno_id'
        AND NOT a.attisdropped
    )
    AND c.confkey[1] = (
      SELECT a.attnum FROM pg_attribute a
      WHERE a.attrelid = c.confrelid AND a.attname = 'id'
        AND NOT a.attisdropped
    )
  ORDER BY c.conname
`;

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

async function getSemanticFks(client: TestClient) {
  return (await client.query<SemanticFk>(semanticFkQuery)).rows;
}

async function dropSemanticFks(client: TestClient) {
  for (const fk of await getSemanticFks(client)) {
    await client.query(
      `ALTER TABLE public.turni_volontari DROP CONSTRAINT ${quoteIdentifier(fk.conname)}`,
    );
  }
}

async function addSemanticFk(
  client: TestClient,
  name: string,
  action: "CASCADE" | "RESTRICT",
) {
  await client.query(`
    ALTER TABLE public.turni_volontari
      ADD CONSTRAINT ${quoteIdentifier(name)}
      FOREIGN KEY (turno_id) REFERENCES public.turni(id)
      ON DELETE ${action} NOT VALID
  `);
}

async function expectCanonicalRestrict(client: TestClient) {
  expect(await getSemanticFks(client)).toEqual([
    {
      conname: "turni_volontari_turno_restrict_fk",
      confdeltype: "r",
    },
  ]);
}

async function getBusinessCounts(client: TestClient) {
  return (
    await client.query(`
      SELECT
        (SELECT count(*)::int FROM turni) AS turni,
        (SELECT count(*)::int FROM turni_volontari) AS turni_volontari,
        (SELECT count(*)::int FROM consegne) AS consegne
    `)
  ).rows[0];
}

afterAll(async () => {
  await pool.end();
});

describe("migration residui Logistica", () => {
  it("ordina il replay guard tra 20260821 e la riconciliazione 20260822", async () => {
    const updates = (await readdir(updatesUrl))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    const guardIndex = updates.indexOf(
      "20260821_zz_logistica_turno_fk_replay_guard.sql",
    );
    expect(guardIndex).toBeGreaterThan(
      updates.indexOf("20260821_audit_uds_operational_hardening.sql"),
    );
    expect(guardIndex).toBeLessThan(
      updates.indexOf("20260822_logistica_residual_reconciliation.sql"),
    );
  });

  it("normalizza per semantica tutti gli stati FK senza modificare dati business", async () => {
    const centroAscoltoSql = await readFile(centroAscoltoMigrationUrl, "utf8");
    const replayGuardSql = await readFile(replayGuardMigrationUrl, "utf8");
    const residualSql = await readFile(residualMigrationUrl, "utf8");
    expect(replayGuardSql).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(replayGuardSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(replayGuardSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(residualSql).not.toMatch(
      /INSERT\s+INTO\s+public\.turni_consegne\s+SELECT/i,
    );

    const replayChain = async (client: TestClient) => {
      await client.query(centroAscoltoSql);
      await client.query(replayGuardSql);
      await client.query(residualSql);
    };

    const scenarios: Array<{
      name: string;
      constraints: Array<[string, "CASCADE" | "RESTRICT"]>;
    }> = [
      { name: "nessuna FK", constraints: [] },
      {
        name: "solo CASCADE legacy",
        constraints: [["turni_volontari_turno_fk", "CASCADE"]],
      },
      {
        name: "solo RESTRICT legacy",
        constraints: [["turni_volontari_turno_legacy_restrict_fk", "RESTRICT"]],
      },
      {
        name: "solo RESTRICT canonica",
        constraints: [["turni_volontari_turno_restrict_fk", "RESTRICT"]],
      },
      {
        name: "CASCADE e RESTRICT",
        constraints: [
          ["turni_volontari_turno_fk", "CASCADE"],
          ["turni_volontari_turno_restrict_fk", "RESTRICT"],
        ],
      },
      {
        name: "due RESTRICT duplicate",
        constraints: [
          ["turni_volontari_turno_restrict_fk", "RESTRICT"],
          ["turni_volontari_turno_legacy_restrict_fk", "RESTRICT"],
        ],
      },
      {
        name: "più FK duplicate",
        constraints: [
          ["turni_volontari_turno_fk", "CASCADE"],
          ["turni_volontari_turno_restrict_fk", "RESTRICT"],
          ["turni_volontari_turno_legacy_restrict_fk", "RESTRICT"],
        ],
      },
    ];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const before = await getBusinessCounts(client);
      for (const scenario of scenarios) {
        await dropSemanticFks(client);
        for (const [name, action] of scenario.constraints) {
          await addSemanticFk(client, name, action);
        }
        await replayChain(client);
        await expectCanonicalRestrict(client);
        expect(await getBusinessCounts(client), scenario.name).toEqual(before);
      }

      // Due replay completi: 20260819 ricrea ogni volta la CASCADE legacy,
      // il guard la elimina e 20260822 osserva una sola RESTRICT canonica.
      await replayChain(client);
      await expectCanonicalRestrict(client);
      await replayChain(client);
      await expectCanonicalRestrict(client);
      expect(await getBusinessCounts(client)).toEqual(before);

      await client.query("SAVEPOINT canonical_name_conflict");
      await dropSemanticFks(client);
      await client.query(`
        ALTER TABLE public.turni_volontari
          ADD CONSTRAINT turni_volontari_turno_restrict_fk
          FOREIGN KEY (volontario_id) REFERENCES public.volontari(id)
          ON DELETE RESTRICT NOT VALID
      `);
      await expect(client.query(replayGuardSql)).rejects.toThrow(
        /constraint semanticamente diverso/i,
      );
      await client.query("ROLLBACK TO SAVEPOINT canonical_name_conflict");

      await replayChain(client);
      await expectCanonicalRestrict(client);

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
      expect(await getBusinessCounts(client)).toEqual({
        ...before,
        turni: before.turni + 1,
        turni_volontari: before.turni_volontari + 1,
      });
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  });
});
