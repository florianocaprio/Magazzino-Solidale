// Compare only the M5B catalog objects on two explicitly named disposable DBs.
import assert from "node:assert/strict";
import pg from "pg";

const urls = [
  process.env.M5B_FRESH_DATABASE_URL,
  process.env.M5B_UPGRADE_DATABASE_URL,
];
const names = [
  process.env.M5B_FRESH_DATABASE,
  process.env.M5B_UPGRADE_DATABASE,
];
if (
  urls.some((url) => !url) ||
  names.some((name) => !name || !name.startsWith("m5b_"))
)
  throw new Error("Explicit M5B disposable database URLs and names required");

async function catalog(url, expectedName) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const identity = (
      await client.query(
        "SELECT current_database() AS name, current_user AS username",
      )
    ).rows[0];
    assert.equal(identity.name, expectedName);
    const tables = ["richieste_magazzino_documenti", "interventi_deleghe_m4"];
    const columns = (
      await client.query(
        `
      SELECT c.relname AS table_name, a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS data_type,
        a.attnotnull AS not_null, a.attidentity AS identity,
        a.attgenerated AS generated, pg_get_expr(d.adbin, d.adrelid) AS default_sql
      FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
        AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
      ORDER BY c.relname, a.attnum`,
        [tables],
      )
    ).rows;
    const constraints = (
      await client.query(
        `
      SELECT c.relname AS table_name, con.conname AS name, con.contype AS type,
        pg_get_constraintdef(con.oid) AS definition, con.convalidated AS validated,
        con.confdeltype AS delete_action, con.confupdtype AS update_action,
        con.condeferrable AS deferrable
      FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid
      WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1)
      ORDER BY c.relname, con.contype, pg_get_constraintdef(con.oid)`,
        [tables],
      )
    ).rows;
    const indexes = (
      await client.query(
        `
      SELECT tablename AS table_name, indexname AS name, indexdef AS definition
      FROM pg_indexes WHERE schemaname = 'public' AND tablename = ANY($1)
      ORDER BY tablename, indexname`,
        [tables],
      )
    ).rows;
    const serialSequence = (
      await client.query(`
      SELECT pg_get_serial_sequence('public.richieste_magazzino_documenti','id') AS name`)
    ).rows[0].name;
    return { identity, columns, constraints, indexes, serialSequence };
  } finally {
    await client.end();
  }
}

const [fresh, upgrade] = await Promise.all([
  catalog(urls[0], names[0]),
  catalog(urls[1], names[1]),
]);
const namesOnly = (entry) => ({
  table_name: entry.table_name,
  name: entry.name,
});
const semantic = (entry) => {
  const { name, ...rest } = entry;
  return rest;
};
assert.deepEqual(fresh.columns, upgrade.columns, "M5B columns/defaults differ");
assert.deepEqual(fresh.indexes, upgrade.indexes, "M5B indexes differ");
assert.deepEqual(
  fresh.constraints.map(semantic),
  upgrade.constraints.map(semantic),
  "M5B constraints differ semantically",
);
assert.equal(
  fresh.serialSequence,
  upgrade.serialSequence,
  "M5B serial sequence differs",
);
console.log(
  JSON.stringify(
    {
      result: "M5B_SCHEMA_PARITY_OK",
      freshDatabase: fresh.identity.name,
      upgradeDatabase: upgrade.identity.name,
      columns: fresh.columns.length,
      constraints: fresh.constraints.length,
      indexes: fresh.indexes.length,
      serialSequence: fresh.serialSequence,
      freshConstraintNames: fresh.constraints.map(namesOnly),
      upgradeConstraintNames: upgrade.constraints.map(namesOnly),
    },
    null,
    2,
  ),
);
