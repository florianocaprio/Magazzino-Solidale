// Explicitly disposable SQL regression. Never accepts the official DB name.
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL);
if (
  process.env.M67_RECONCILIATION_DISPOSABLE_DB !== "verified" ||
  !["m67_reconcile_clone", "m67_reconcile_fresh"].includes(
    url.pathname.slice(1),
  ) ||
  !["localhost", "127.0.0.1"].includes(url.hostname)
)
  throw Error("Verified isolated reconciliation database required");

const sql = fs.readFileSync(
  new URL(
    "../updates/20261016_z_schema_invariant_reconciliation.sql",
    import.meta.url,
  ),
  "utf8",
);
const rules = [
  ...sql.matchAll(/\('([^']+)', '([^']+)', \$ddl\$([^]*?)\$ddl\$\)/g),
].map(([, table, name]) => ({ table, name }));
assert.equal(rules.length, 81);
const db = new pg.Client({ connectionString: url.toString() });
const quote = (name) => '"' + name.replaceAll('"', '""') + '"';
const results = [];
await db.connect();
try {
  assert.equal(
    (await db.query("select current_database() name")).rows[0].name,
    url.pathname.slice(1),
  );
  await db.query("begin");
  for (const rule of rules) {
    const row = (
      await db.query(
        `
      select con.contype type, pg_get_constraintdef(con.oid) definition,
        a.attname column_name, format_type(a.atttypid,a.atttypmod) column_type
      from pg_constraint con
      join pg_attribute a on a.attrelid=con.conrelid and a.attnum=con.conkey[1]
      where con.conrelid=$1::regclass and con.conname=$2`,
        ["public." + rule.table, rule.name],
      )
    ).rows;
    assert.equal(row.length, 1, rule.name + " missing");
    const c = row[0];
    await db.query(
      `create temp table probe as select * from public.${quote(rule.table)} with no data`,
    );
    let definition = c.definition;
    if (c.type === "f") {
      const reference = /REFERENCES ([a-z_]+)\(id\)/.exec(definition);
      assert.ok(reference, "Explicit single-key canonical FK required");
      await db.query(
        `create temp table parent_probe as select id from public.${quote(reference[1])} with no data`,
      );
      await db.query("alter table parent_probe add primary key(id)");
      definition = definition.replace(
        reference[0],
        "REFERENCES parent_probe(id)",
      );
    }
    await db.query(`alter table probe add constraint probe_rule ${definition}`);
    // A nullable reference/count remains permitted. This is NOT a test of
    // application required-field validation or a business workflow fixture.
    await db.query("insert into probe default values");
    let invalid;
    if (c.type === "f") invalid = -2147483000;
    else if (/^(integer|smallint|bigint|numeric)/.test(c.column_type))
      invalid = -1;
    else invalid = c.definition.includes("length(") ? "" : "__INVALID_M67__";
    await db.query("savepoint rejected_value");
    let error;
    try {
      await db.query(
        `insert into probe (${quote(c.column_name)}) values ($1)`,
        [invalid],
      );
    } catch (caught) {
      error = caught;
    }
    await db.query("rollback to savepoint rejected_value");
    assert.equal(
      error?.code,
      c.type === "f" ? "23503" : "23514",
      rule.name + " must reject invalid value",
    );
    assert.equal(error.constraint, "probe_rule");
    if (c.type === "f") {
      await db.query("insert into parent_probe values(1)");
      await db.query(`insert into probe (${quote(c.column_name)}) values(1)`);
      await db.query("savepoint referenced_parent");
      let deletionError;
      try {
        await db.query("delete from parent_probe where id=1");
      } catch (e) {
        deletionError = e;
      }
      await db.query("rollback to savepoint referenced_parent");
      assert.equal(
        deletionError?.code,
        "23503",
        rule.name + " must protect referenced parent",
      );
    }
    await db.query("drop table probe");
    if (c.type === "f") await db.query("drop table parent_probe");
    results.push({
      ...rule,
      type: c.type,
      nullAccepted: true,
      invalidRejected: error.code,
    });
  }

  // Exercise the real table's CHECK set, not a hand-written substitute.
  await db.query(
    "create temp table disability_probe (like public.fse_fascicoli_sociali including defaults including constraints)",
  );
  for (const value of [null, 0, 7])
    await db.query(
      "insert into disability_probe (id,beneficiario_id,persone_disabilita) values(-1,-1,$1)",
      [value],
    );
  await db.query("savepoint negative_disability");
  let disabilityError;
  try {
    await db.query(
      "insert into disability_probe (id,beneficiario_id,persone_disabilita) values(-1,-1,-1)",
    );
  } catch (e) {
    disabilityError = e;
  }
  await db.query("rollback to savepoint negative_disability");
  assert.equal(disabilityError?.code, "23514");
  // Exact SQL proofs for the narrow catalog-equivalence rules.
  const semanticProof = (
    await db.query(`
    select
      (select bool_and((value in ('pranzo','cena')) is not true or length(trim(value)) > 0)
        from (values (null::varchar),(''),(' '),('pranzo'),('cena'),('altro')) v(value)) meal_enum_implies_nonblank,
      (select bool_and(trim(value) is not distinct from btrim(value::text))
        from (values (null::varchar),(''),(' '),(' à '),('pranzo')) v(value)) trim_equivalent,
      (select bool_and(((a and b) is not false) = ((a is not false) and (b is not false)))
        from (values(true),(false),(null::boolean)) x(a)
        cross join (values(true),(false),(null::boolean)) y(b)) and_check_equivalent
  `)
  ).rows[0];
  assert.ok(Object.values(semanticProof).every((v) => v === true));
  for (const partial of [false, true]) {
    await db.query("create temp table unique_probe (key text)");
    await db.query(
      `create unique index unique_probe_idx on unique_probe(key) ${partial ? "where key is not null" : ""}`,
    );
    await db.query("insert into unique_probe values(null),(null),('key')");
    await db.query("savepoint unique_duplicate");
    let duplicateError;
    try {
      await db.query("insert into unique_probe values('key')");
    } catch (e) {
      duplicateError = e;
    }
    await db.query("rollback to savepoint unique_duplicate");
    assert.equal(duplicateError?.code, "23505");
    await db.query("drop table unique_probe");
  }
  const unvalidated = (
    await db.query(
      "select conrelid::regclass::text table_name,conname name from pg_constraint where connamespace='public'::regnamespace and not convalidated order by conrelid::regclass::text,conname",
    )
  ).rows;
  const legacyValidation = [];
  for (const c of unvalidated) {
    await db.query("savepoint legacy_diagnostic");
    try {
      await db.query(
        `alter table public.${quote(c.table_name)} validate constraint ${quote(c.name)}`,
      );
      legacyValidation.push({ ...c, result: "PASS" });
    } catch (error) {
      // Record the real failure, without row identifiers/PII, and continue
      // independent diagnostics. A failed legacy check is NOT a green gate.
      legacyValidation.push({ ...c, result: "FAIL", sqlState: error.code });
    }
    await db.query("rollback to savepoint legacy_diagnostic");
  }
  // This verification is rolled back: legacy validation state is preserved.
  await db.query("rollback");
  const orphanCounts = (
    await db.query(`select
    count(*) filter(where not exists(select 1 from turni t where t.id=tv.turno_id))::int missing_turno,
    count(*) filter(where not exists(select 1 from volontari v where v.id=tv.volontario_id))::int missing_volontario,
    count(*) filter(where not exists(select 1 from turni t where t.id=tv.turno_id)
      or not exists(select 1 from volontari v where v.id=tv.volontario_id))::int distinct_orphan_rows
    from turni_volontari tv`)
  ).rows[0];
  console.log(
    JSON.stringify({
      database: url.pathname.slice(1),
      rules: results,
      disability: { validValues: 3, negativeRejected: "23514" },
      semanticProof,
      uniqueNullProofs: 2,
      historicalNotValidDiagnostics: legacyValidation,
      orphanCounts,
      legacyDataGate: legacyValidation.some((r) => r.result === "FAIL")
        ? "FAIL"
        : "PASS",
      operationalWritesCommitted: 0,
    }),
  );
} finally {
  await db.query("rollback").catch(() => {});
  await db.end();
}
