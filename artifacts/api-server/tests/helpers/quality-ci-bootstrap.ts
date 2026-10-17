import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import { initDbExtensions } from "../../src/lib/dbInit";
import { ensureAmbienteModuli } from "../../src/lib/configurazioneAmbiente";

const expected = JSON.parse(process.env.QUALITY_TEST_IDENTITY ?? "null");
assert.ok(expected?.marker?.startsWith("quality-gates:"));
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.pathname, "/" + expected.database);
try {
  const {
    rows: [identity],
  } = await pool.query(`SELECT current_database() AS database,
    (pg_control_system()).system_identifier::text AS system_identifier,
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) AS marker`);
  assert.deepEqual(identity, {
    database: expected.database,
    system_identifier: expected.system_identifier,
    marker: expected.marker,
  });
  await initDbExtensions();
  await ensureAmbienteModuli();
} finally {
  await pool.end();
}
