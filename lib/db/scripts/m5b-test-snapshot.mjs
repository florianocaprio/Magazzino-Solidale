// Read-only snapshot of an explicitly marked, disposable M5B PostgreSQL DB.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import pg from "pg";

const [mode, first, second] = process.argv.slice(2);
const hash = (value) => createHash("sha256").update(value).digest("hex");

if (mode === "compare") {
  const before = JSON.parse(await readFile(first, "utf8"));
  const after = JSON.parse(await readFile(second, "utf8"));
  assert.equal(before.identity.database, after.identity.database);
  assert.equal(
    before.identity.systemIdentifier,
    after.identity.systemIdentifier,
  );
  assert.equal(before.identity.marker, after.identity.marker);
  const differences = [];
  for (const [name, value] of Object.entries(before.tables)) {
    if (JSON.stringify(value) !== JSON.stringify(after.tables[name]))
      differences.push({
        category: "table",
        name,
        before: value,
        after: after.tables[name],
      });
  }
  for (const [name, value] of Object.entries(before.sequences)) {
    if (JSON.stringify(value) !== JSON.stringify(after.sequences[name]))
      differences.push({
        category: "sequence",
        name,
        before: value,
        after: after.sequences[name],
      });
  }
  for (const [name, value] of Object.entries(before.exactQuantities)) {
    if (JSON.stringify(value) !== JSON.stringify(after.exactQuantities[name]))
      differences.push({
        category: "quantity",
        name,
        before: value,
        after: after.exactQuantities[name],
      });
  }
  for (const entry of before.ledger) {
    const matching = after.ledger.find(
      (candidate) => candidate.filename === entry.filename,
    );
    if (JSON.stringify(entry) !== JSON.stringify(matching))
      differences.push({
        category: "ledger",
        name: entry.filename,
        before: entry,
        after: matching,
      });
  }
  console.log(
    JSON.stringify(
      { preserved: differences.length === 0, differences },
      null,
      2,
    ),
  );
  if (differences.length > 0) process.exitCode = 1;
} else if (mode === "snapshot" && first) {
  const databaseUrl = process.env.DATABASE_URL;
  const expectedDatabase = process.env.M5B_EXPECTED_DATABASE;
  const expectedMarker = process.env.M5B_EXPECTED_MARKER;
  const expectedSystem = process.env.M5B_EXPECTED_SYSTEM;
  if (!databaseUrl || !expectedDatabase || !expectedMarker || !expectedSystem)
    throw new Error("Explicit M5B disposable database identity is required");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const identity = (
      await client.query(`SELECT current_database() AS database,
        current_user AS username,
        (pg_control_system()).system_identifier::text AS "systemIdentifier",
        (SELECT shobj_description(oid, 'pg_database') FROM pg_database
          WHERE datname = current_database()) AS marker`)
    ).rows[0];
    assert.equal(identity.database, expectedDatabase);
    assert.equal(
      identity.username,
      process.env.M5B_EXPECTED_USER ?? "m5b_test",
    );
    assert.equal(identity.marker, expectedMarker);
    assert.equal(identity.systemIdentifier, expectedSystem);
    const tables = {};
    const tableNames = (
      await client.query(
        "SELECT tablename FROM pg_catalog.pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((row) => row.tablename);
    for (const name of tableNames) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const rows = (
        await client.query(
          `SELECT to_jsonb(t)::text AS payload FROM public.${quoted} t ORDER BY to_jsonb(t)::text`,
        )
      ).rows.map((row) => row.payload);
      tables[name] = { count: rows.length, sha256: hash(rows.join("\n")) };
    }
    const sequences = {};
    const sequenceNames = (
      await client.query(
        "SELECT sequencename FROM pg_catalog.pg_sequences WHERE schemaname='public' ORDER BY sequencename",
      )
    ).rows.map((row) => row.sequencename);
    for (const name of sequenceNames) {
      const quoted = `"${name.replaceAll('"', '""')}"`;
      const [row] = (
        await client.query(
          `SELECT last_value::text, is_called FROM public.${quoted}`,
        )
      ).rows;
      sequences[name] = row;
    }
    const ledger = (
      await client.query(
        "SELECT filename, checksum_sha256 FROM app_meta.schema_migrations ORDER BY filename",
      )
    ).rows;
    const exactQuantities = {};
    for (const [name, column] of [
      ["lotti", "quantita_residua"],
      ["movimenti", "quantita"],
      ["prenotazioni_magazzino", "quantita"],
      ["interventi_materiali", "quantita_consegnata"],
    ]) {
      exactQuantities[name] = (
        await client.query(
          `SELECT id, ${column}::text AS quantita FROM ${name} ORDER BY id`,
        )
      ).rows;
    }
    const snapshot = { identity, tables, sequences, ledger, exactQuantities };
    await writeFile(first, JSON.stringify(snapshot, null, 2));
    console.log(
      `SNAPSHOT_OK database=${identity.database} tables=${tableNames.length} ledger=${ledger.length}`,
    );
  } finally {
    await client.end();
  }
} else {
  throw new Error(
    "Usage: m5b-test-snapshot.mjs snapshot OUT | compare BEFORE AFTER",
  );
}
