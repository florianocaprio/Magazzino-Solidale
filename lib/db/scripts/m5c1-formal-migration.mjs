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

const mode = process.argv[2];
assert.ok(mode === "upgrade" || mode === "fresh", "Atteso upgrade|fresh");
assert.ok(process.env.DATABASE_URL?.includes("127.0.0.1:53824/m5c1_"));

const root = fileURLToPath(new URL("../../../", import.meta.url));
const options = {
  databaseUrl: process.env.DATABASE_URL,
  updatesDirectory: path.join(root, "lib/db/updates"),
  manifestPath: path.join(root, "lib/db/legacy-migrations-baseline.json"),
  sourceVersion: `m5c1-formal-${mode}`,
  logger: { info() {}, error() {} },
};
const client = new Client({ connectionString: process.env.DATABASE_URL });
const domainTables = [
  "aree_operative",
  "centri_di_ascolto",
  "beneficiari",
  "magazzini",
  "prodotti",
  "lotti",
  "utenti",
  "interventi",
  "interventi_materiali",
  "bolle",
  "bolla_righe",
  "consegne",
  "richieste_magazzino",
  "richieste_magazzino_documenti",
  "movimenti",
  "prenotazioni_magazzino",
  "operazioni_distribuzione_magazzino",
  "audit_eventi",
  "comandi_operativi",
];
const writeGrants = ["bolle.manage", "bolle.deliver", "bolle.cancel"];

async function roles() {
  const { rows } = await client.query(
    "SELECT nome, aree, permessi, is_admin FROM ruoli ORDER BY nome",
  );
  return new Map(rows.map((row) => [row.nome, row]));
}

async function domainDigest() {
  const hash = createHash("sha256");
  const counts = {};
  for (const table of domainTables) {
    const { rows } = await client.query(
      `SELECT to_jsonb(t)::text AS row FROM ${table} AS t ORDER BY to_jsonb(t)::text`,
    );
    counts[table] = rows.length;
    hash.update(table);
    for (const row of rows) hash.update(row.row);
  }
  return { sha256: hash.digest("hex"), counts };
}

function assertNoBollaWrite(role) {
  assert.ok(role, "Ruolo Operatore assente");
  assert.ok(role.permessi.includes("bolle.view"));
  for (const grant of writeGrants) assert.ok(!role.permessi.includes(grant));
}

function runSeedRoles() {
  const apiRoot = path.join(root, "artifacts/api-server");
  const code = `import { seedRoles } from "./src/lib/seedRoles.ts"; import { pool } from "@workspace/db"; seedRoles().then(() => pool.end()).catch(async (error) => { console.error(error); await pool.end(); process.exitCode = 1; });`;
  const output = execFileSync(
    path.join(apiRoot, "node_modules/.bin/tsx"),
    ["-e", code],
    {
      cwd: apiRoot,
      env: process.env,
      encoding: "utf8",
    },
  );
  console.log(
    `seedRoles(): exit 0, outputLines=${output.trim().split("\n").length}`,
  );
}

try {
  await client.connect();
  const beforeStatus = await getMigrationStatus(options);
  assert.equal(beforeStatus.appliedFiles, mode === "upgrade" ? 44 : 0);
  assert.equal(beforeStatus.totalFiles, 45);
  console.log(`${mode}: ledger prima=${beforeStatus.appliedFiles}/45`);

  let beforeRoles;
  let beforeDomain;
  if (mode === "upgrade") {
    beforeRoles = await roles();
    const canonical = beforeRoles.get("Operatore");
    assert.ok(canonical?.permessi.includes("bolle.view"));
    for (const grant of writeGrants)
      assert.ok(canonical.permessi.includes(grant));
    for (const name of [
      "Operatore Magazzino",
      "Amministratore",
      "SuperAdmin",
      "TEST-M5B Social",
    ])
      assert.ok(beforeRoles.has(name));
    beforeDomain = await domainDigest();
    assert.ok(beforeDomain.counts.utenti >= 7);
    assert.ok(beforeDomain.counts.bolle > 0);
    assert.ok(beforeDomain.counts.movimenti > 0);
    assert.ok(beforeDomain.counts.richieste_magazzino > 0);
    console.log(`upgrade: digest prima=${beforeDomain.sha256}`);
    console.log(
      `upgrade: conteggi prima=${JSON.stringify(beforeDomain.counts)}`,
    );
  }

  const applied = await runMigrations(options);
  assert.equal(applied.appliedFiles, mode === "upgrade" ? 1 : 45);
  const verified = await verifyMigrations(options);
  assert.equal(verified.appliedFiles, 45);
  assert.equal(verified.pendingFiles, 0);
  console.log(`${mode}: ledger dopo=45/45 applicate=${applied.appliedFiles}`);

  const afterRoles = await roles();
  if (mode === "upgrade") {
    const expected = beforeRoles.get("Operatore");
    assert.deepEqual(
      afterRoles.get("Operatore").permessi,
      expected.permessi.filter(
        (permission) => !writeGrants.includes(permission),
      ),
    );
    assert.deepEqual(afterRoles.get("Operatore").aree, expected.aree);
    assert.equal(afterRoles.get("Operatore").is_admin, expected.is_admin);
    for (const [name, role] of beforeRoles) {
      if (name !== "Operatore") assert.deepEqual(afterRoles.get(name), role);
    }
    const afterDomain = await domainDigest();
    assert.deepEqual(afterDomain, beforeDomain);
    console.log(`upgrade: digest dopo=${afterDomain.sha256}`);
  }
  if (afterRoles.has("Operatore"))
    assertNoBollaWrite(afterRoles.get("Operatore"));

  const replay = await runMigrations(options);
  assert.equal(replay.appliedFiles, 0);
  assert.equal(replay.skippedFiles, 45);
  console.log(`${mode}: secondo run applicate=0 skipped=45`);

  runSeedRoles();
  assertNoBollaWrite((await roles()).get("Operatore"));
  console.log(`${mode}: seedRoles dopo migration non riaggiunge grant Bolla`);
} finally {
  await client.end();
}
