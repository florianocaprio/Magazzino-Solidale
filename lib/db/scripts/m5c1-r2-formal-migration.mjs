import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "pg";
import {
  getMigrationStatus,
  runMigrations,
  verifyMigrations,
} from "./migration-runner.mjs";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/m5c1_r2_upgrade");
const root = fileURLToPath(new URL("../../../", import.meta.url));
const options = {
  databaseUrl: process.env.DATABASE_URL,
  updatesDirectory: path.join(root, "lib/db/updates"),
  manifestPath: path.join(root, "lib/db/legacy-migrations-baseline.json"),
  sourceVersion: "m5c1-r2-formal-upgrade",
};
const client = new Client({ connectionString: process.env.DATABASE_URL });

async function roles() {
  const { rows } = await client.query(
    "SELECT nome, aree, permessi, is_admin FROM ruoli ORDER BY nome",
  );
  return new Map(rows.map((row) => [row.nome, row]));
}

async function domainDigest() {
  const { rows: tables } = await client.query(
    "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' AND tablename <> 'ruoli' ORDER BY tablename",
  );
  const hash = createHash("sha256");
  const counts = {};
  for (const { tablename } of tables) {
    const { rows } = await client.query(
      `SELECT to_jsonb(t)::text AS row FROM "${tablename}" AS t ORDER BY to_jsonb(t)::text`,
    );
    counts[tablename] = rows.length;
    hash.update(tablename);
    for (const row of rows) hash.update(row.row);
  }
  return { sha256: hash.digest("hex"), counts };
}

function has(role, permission) {
  return role?.permessi.includes(permission);
}

try {
  await client.connect();
  const beforeStatus = await getMigrationStatus(options);
  assert.equal(beforeStatus.appliedFiles, 45);
  assert.equal(beforeStatus.totalFiles, 46);
  assert.deepEqual(beforeStatus.pendingFiles, [
    "20260929_m5c1_r2_enti_ownership.sql",
  ]);
  const beforeRoles = await roles();
  for (const name of [
    "Operatore",
    "Operatore Magazzino",
    "TEST-M5B Custom",
    "Amministratore",
    "SuperAdmin",
  ]) {
    assert.ok(has(beforeRoles.get(name), "enti-destinatari.manage"), name);
  }
  for (const permission of ["bolle.manage", "bolle.deliver", "bolle.cancel"])
    assert.ok(!has(beforeRoles.get("Operatore"), permission));
  const beforeDomain = await domainDigest();
  for (const table of ["enti_destinatari", "bolle", "movimenti", "lotti"])
    assert.ok(beforeDomain.counts[table] > 0, table);
  console.log(`PRE 45/45 domain=${beforeDomain.sha256}`);

  const applied = await runMigrations(options);
  assert.equal(applied.appliedFiles, 1);
  assert.equal(applied.skippedFiles, 45);
  const verified = await verifyMigrations(options);
  assert.equal(verified.appliedFiles, 46);
  assert.equal(verified.pendingFiles, 0);
  const afterRoles = await roles();
  assert.deepEqual(
    afterRoles.get("Operatore Magazzino").permessi,
    beforeRoles
      .get("Operatore Magazzino")
      .permessi.filter(
        (permission) => permission !== "enti-destinatari.manage",
      ),
  );
  assert.ok(
    has(afterRoles.get("Operatore Magazzino"), "enti-destinatari.view"),
  );
  for (const [name, role] of beforeRoles) {
    if (name !== "Operatore Magazzino")
      assert.deepEqual(afterRoles.get(name), role, name);
  }
  const afterDomain = await domainDigest();
  assert.deepEqual(afterDomain, beforeDomain);
  console.log(`POST 46/46 domain=${afterDomain.sha256} unchanged`);

  const second = await runMigrations(options);
  assert.equal(second.appliedFiles, 0);
  assert.equal(second.skippedFiles, 46);
  console.log("SECOND applied=0 skipped=46");

  const apiRoot = path.join(root, "artifacts/api-server");
  execFileSync(
    path.join(apiRoot, "node_modules/.bin/tsx"),
    [
      "-e",
      'import { seedRoles } from "./src/lib/seedRoles.ts"; import { pool } from "@workspace/db"; seedRoles().then(() => pool.end()).catch(async error => { console.error(error); await pool.end(); process.exitCode = 1; });',
    ],
    { cwd: apiRoot, env: process.env, stdio: "pipe" },
  );
  const seeded = await roles();
  assert.ok(!has(seeded.get("Operatore Magazzino"), "enti-destinatari.manage"));
  assert.ok(has(seeded.get("Operatore Magazzino"), "enti-destinatari.view"));
  assert.ok(has(seeded.get("Operatore"), "enti-destinatari.manage"));
  for (const permission of ["bolle.manage", "bolle.deliver", "bolle.cancel"])
    assert.ok(!has(seeded.get("Operatore"), permission));
  console.log("SEED roles ownership and M5C1 Bolla grants OK");
} finally {
  await client.end();
}
