// Synthetic browser fixture: refuse any DB other than this disposable M5C1 instance.
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";

assert.ok(process.env.DATABASE_URL);
const target = new URL(process.env.DATABASE_URL);
assert.equal(target.protocol, "postgresql:");
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, process.env.M5C1_E2E_EXPECTED_PORT ?? "53824");
const expectedDatabase = process.env.M5C1_E2E_EXPECTED_DATABASE ?? "m5c1_fresh";
const expectedLedger = Number(process.env.M5C1_E2E_EXPECTED_LEDGER ?? "45");
assert.ok(/^m5c1_[a-z0-9_]+$/.test(expectedDatabase));
assert.equal(target.pathname, `/${expectedDatabase}`);
assert.equal(process.env.M5C1_TEST_DISPOSABLE_DB, "verified");
assert.ok(process.env.M5C1_E2E_PASSWORD);
const client = await pool.connect();
try {
  const {
    rows: [identity],
  } = await client.query(`
    SELECT current_database() AS database,
      (SELECT count(*)::integer FROM app_meta.schema_migrations) AS migrations
  `);
  assert.deepEqual(identity, {
    database: expectedDatabase,
    migrations: expectedLedger,
  });
  const hash = await bcrypt.hash(process.env.M5C1_E2E_PASSWORD, 10);
  await client.query("BEGIN");
  const {
    rows: [area],
  } = await client.query(
    "INSERT INTO aree_operative(nome) VALUES ('M5C1 E2E Area') RETURNING id",
  );
  const {
    rows: [centre],
  } = await client.query(
    "INSERT INTO centri_di_ascolto(nome, area_operativa_id) VALUES ('M5C1 E2E Centro', $1) RETURNING id",
    [area.id],
  );
  const {
    rows: [beneficiary],
  } = await client.query(
    "INSERT INTO beneficiari(codice, nome, cognome, centro_ascolto_id, area_operativa_id) VALUES ('M5C1-E2E-B1', 'Ada', 'Sintetica', $1, $2) RETURNING id",
    [centre.id, area.id],
  );
  const {
    rows: [warehouse],
  } = await client.query(
    "INSERT INTO magazzini(codice, nome, area_operativa_id, centro_ascolto_id) VALUES ('M5C1-E2E-MA', 'M5C1 E2E Deposito', $1, $2) RETURNING id",
    [area.id, centre.id],
  );
  await client.query(
    `INSERT INTO consegne(codice, beneficiario_id, tipo_consegna, data_prevista,
      magazzino_id, area_operativa_id_snapshot, centro_ascolto_id_snapshot, stato)
     VALUES ('M5C1-E2E-C1', $1, 'ritiro', DATE '2026-10-01', $2, $3, $4, 'pianificata')`,
    [beneficiary.id, warehouse.id, area.id, centre.id],
  );
  const {
    rows: [legacyRole],
  } = await client.query(`
    INSERT INTO ruoli(nome, aree, permessi)
    VALUES ('M5C1 E2E Sociale legacy', '["sociale"]'::jsonb,
      '["beneficiari.view","sociale.interventi.view","sociale.interventi.create",
        "sociale.interventi.update","richieste_magazzino.view","richieste_magazzino.create",
        "consegne.view","consegne.manage","bolle.view","bolle.manage","bolle.deliver","bolle.cancel"]'::jsonb)
    RETURNING id
  `);
  const { rows: roles } = await client.query(
    "SELECT id, nome FROM ruoli WHERE nome IN ('Operatore', 'Operatore Magazzino', 'SuperAdmin')",
  );
  const role = (name) => {
    const found = roles.find((row) => row.nome === name);
    assert.ok(found, `Missing ${name}`);
    return found.id;
  };
  for (const [username, roleId, centreId] of [
    ["m5c1-e2e-social", role("Operatore"), centre.id],
    ["m5c1-e2e-legacy", legacyRole.id, centre.id],
    ["m5c1-e2e-warehouse", role("Operatore Magazzino"), null],
    ["m5c1-e2e-admin", role("SuperAdmin"), null],
  ]) {
    await client.query(
      `INSERT INTO utenti(username, password_hash, nome, ruolo_id, area_operativa_id,
          centro_ascolto_id, must_change_password)
       VALUES ($1, $2, $1, $3, $4, $5, false)`,
      [username, hash, roleId, area.id, centreId],
    );
  }
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      fixture: "M5C1_E2E_OK",
      area: area.id,
      centre: centre.id,
      beneficiary: beneficiary.id,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
