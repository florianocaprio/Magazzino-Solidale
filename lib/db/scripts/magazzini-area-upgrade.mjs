// Integration proof: authenticated old schema/ledger 55 -> 56, no inferred Area.
// Requires a disposable PostgreSQL and lib/db extracted from the published base.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  getMigrationStatus,
  runMigrations,
  verifyMigrations,
} from "./migration-runner.mjs";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.REPORTING_TEST_DISPOSABLE_DB, "verified");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "59666");
assert.equal(url.pathname, "/m66_dev");
const baseline = path.resolve(process.argv[2] ?? "");
assert.ok(baseline.startsWith("/private/tmp/magazzino-m66-area-"));
assert.match(
  readFileSync(path.join(baseline, "src/schema/magazzini.ts"), "utf8"),
  /integer\("area_operativa_id"\)\.references/,
);
const current = fileURLToPath(new URL("../", import.meta.url));
const migration = "20261014_magazzini_area_obbligatoria.sql";
const options = (databaseUrl, directory = current) => ({
  databaseUrl,
  updatesDirectory: path.join(directory, "updates"),
  manifestPath: path.join(directory, "legacy-migrations-baseline.json"),
});
async function snapshot(client) {
  const tables = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const hash = createHash("sha256");
  for (const { tablename } of tables) {
    const rows = (
      await client.query(
        `SELECT to_jsonb(t)::text AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`,
      )
    ).rows;
    hash.update(JSON.stringify([tablename, rows]));
  }
  return hash.digest("hex");
}
async function schema(client) {
  return {
    columns: (
      await client.query(
        "SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position",
      )
    ).rows,
    constraints: (
      await client.query(
        "SELECT c.relname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,k.contype,pg_get_constraintdef(k.oid)",
      )
    ).rows,
    indexes: (
      await client.query(
        "SELECT c.relname,i.indisunique,i.indisprimary,pg_get_expr(i.indpred,i.indrelid) AS predicate,ARRAY(SELECT pg_get_indexdef(i.indexrelid,s,true) FROM generate_series(1,i.indnatts) s) AS keys FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname,i.indisunique,i.indisprimary,keys",
      )
    ).rows,
  };
}
const admin = new Client({ connectionString: url.href });
await admin.connect();
try {
  assert.equal((await verifyMigrations(options(url.href))).appliedFiles, 56);
  for (const [database, invalid] of [
    ["m66_area_upgrade", false],
    ["m66_area_invalid", true],
  ]) {
    await admin.query(`CREATE DATABASE ${database}`);
    const target = new URL(url);
    target.pathname = `/${database}`;
    const result = spawnSync(
      "pnpm",
      [
        "--filter",
        "@workspace/db",
        "exec",
        "drizzle-kit",
        "push",
        "--config",
        path.join(baseline, "drizzle.config.ts"),
      ],
      {
        env: { ...process.env, DATABASE_URL: target.href },
        stdio: "inherit",
      },
    );
    assert.equal(result.status, 0);
    await runMigrations(options(target.href, baseline));
    const oldStatus = await getMigrationStatus(options(target.href));
    assert.equal(oldStatus.appliedFiles, 55);
    assert.deepEqual(oldStatus.pendingFiles, [migration]);
    const client = new Client({ connectionString: target.href });
    await client.connect();
    try {
      const area = (
        await client.query(
          "INSERT INTO aree_operative(nome) VALUES ('Synthetic Area') RETURNING id",
        )
      ).rows[0].id;
      const warehouse = (
        await client.query(
          "INSERT INTO magazzini(codice,nome,area_operativa_id) VALUES ('UPGRADE','Synthetic warehouse',$1) RETURNING id",
          [invalid ? null : area],
        )
      ).rows[0].id;
      const product = (
        await client.query(
          "INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura) VALUES ('UPGRADE','Synthetic product','alimentare','kg') RETURNING id",
        )
      ).rows[0].id;
      const lot = (
        await client.query(
          "INSERT INTO lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua) VALUES ($1,$2,'UPGRADE','2026-10-14',0.123456,0.123456) RETURNING id",
          [product, warehouse],
        )
      ).rows[0].id;
      await client.query(
        "INSERT INTO movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,lotto_id,quantita,unita_misura) VALUES ('carico','entrata','2026-10-14',$1,$2,$3,0.123456,'kg')",
        [warehouse, product, lot],
      );
      let before = await snapshot(client);
      if (invalid) {
        await assert.rejects(
          runMigrations(options(target.href)),
          /MAGAZZINI_AREA_REQUIRED/,
        );
        assert.equal(await snapshot(client), before);
        assert.equal(
          (await getMigrationStatus(options(target.href))).appliedFiles,
          55,
        );
        assert.equal(
          (
            await client.query(
              "SELECT is_nullable FROM information_schema.columns WHERE table_name='magazzini' AND column_name='area_operativa_id'",
            )
          ).rows[0].is_nullable,
          "YES",
        );
        console.log(
          "INVALID LEGACY: migration refused; ledger 55 and every public row unchanged; no inferred assignment",
        );
        // Explicit synthetic operator reconciliation, never part of the migration.
        await client.query(
          "UPDATE magazzini SET area_operativa_id=$1 WHERE id=$2",
          [area, warehouse],
        );
        before = await snapshot(client);
      }
      const first = await runMigrations(options(target.href));
      assert.equal(first.appliedFiles, 1);
      assert.equal(first.skippedFiles, 55);
      assert.equal(
        (await verifyMigrations(options(target.href))).appliedFiles,
        56,
      );
      assert.equal(await snapshot(client), before);
      for (const [query, params, code] of [
        [
          "INSERT INTO magazzini(codice,nome) VALUES ('NULL','Invalid')",
          [],
          "23502",
        ],
        [
          "UPDATE magazzini SET area_operativa_id=NULL WHERE id=$1",
          [warehouse],
          "23502",
        ],
        [
          "UPDATE magazzini SET area_operativa_id=2147483647 WHERE id=$1",
          [warehouse],
          "23503",
        ],
        ["DELETE FROM aree_operative WHERE id=$1", [area], "23503"],
      ])
        await assert.rejects(
          client.query(query, params),
          (error) => error.code === code,
        );
      assert.equal(await snapshot(client), before);
      const replay = await runMigrations(options(target.href));
      assert.equal(replay.appliedFiles, 0);
      assert.equal(replay.skippedFiles, 56);
      assert.equal(await snapshot(client), before);
      assert.deepEqual(await schema(client), await schema(admin));
      console.log(
        JSON.stringify({
          database,
          upgrade: "55→56",
          applied: 1,
          replay: 0,
          dataFingerprint: before,
          publicSchemaParity: "PASS",
          constraints: "NOT NULL/FK/restrict PASS",
        }),
      );
    } finally {
      await client.end();
    }
  }
} finally {
  await admin.end();
}
