// Disposable M5B browser-test accounts. Never run against an operational DB.
import assert from "node:assert/strict";
import { pool } from "@workspace/db";
import bcrypt from "bcryptjs";

const {
  DATABASE_URL,
  M5B_EXPECTED_DATABASE,
  M5B_EXPECTED_MARKER,
  M5B_EXPECTED_SYSTEM,
  M5B_E2E_PASSWORD,
} = process.env;
if (
  !DATABASE_URL ||
  !M5B_EXPECTED_DATABASE ||
  !M5B_EXPECTED_MARKER ||
  !M5B_EXPECTED_SYSTEM ||
  !M5B_E2E_PASSWORD
)
  throw new Error(
    "Explicit disposable database identity and test password required",
  );

const client = await pool.connect();
try {
  const {
    rows: [identity],
  } = await client.query(`
    SELECT current_database() AS database, current_user AS username,
      (pg_control_system()).system_identifier::text AS system_identifier,
      (SELECT shobj_description(oid, 'pg_database') FROM pg_database
       WHERE datname=current_database()) AS marker
  `);
  assert.equal(identity.database, M5B_EXPECTED_DATABASE);
  assert.equal(identity.username, process.env.M5B_EXPECTED_USER ?? "m5b_test");
  assert.equal(identity.system_identifier, M5B_EXPECTED_SYSTEM);
  assert.equal(identity.marker, M5B_EXPECTED_MARKER);
  const {
    rows: [{ count }],
  } = await client.query(
    "SELECT count(*)::integer AS count FROM app_meta.schema_migrations",
  );
  assert.equal(count, 44);

  const passwordHash = await bcrypt.hash(M5B_E2E_PASSWORD, 10);
  const { rows: areas } = await client.query(
    "SELECT id, nome FROM aree_operative WHERE nome IN ('TEST-M5B Area A', 'TEST-M5B Area B')",
  );
  const areaA = areas.find((row) => row.nome === "TEST-M5B Area A")?.id;
  const areaB = areas.find((row) => row.nome === "TEST-M5B Area B")?.id;
  assert.ok(areaA && areaB);
  const { rows: centers } = await client.query(
    "SELECT id, nome FROM centri_di_ascolto WHERE nome LIKE 'TEST-M5B Centro %'",
  );
  const center = (name) => {
    const id = centers.find((row) => row.nome === name)?.id;
    assert.ok(id, `Missing ${name}`);
    return id;
  };
  await client.query("BEGIN");
  const {
    rows: [readerRole],
  } = await client.query(`
    INSERT INTO ruoli (nome, aree, permessi, is_admin)
    VALUES ('TEST-M5B Reader', '["magazzino"]'::jsonb,
      '["richieste_magazzino.view","magazzino.view"]'::jsonb, false)
    ON CONFLICT (nome) DO UPDATE SET permessi=EXCLUDED.permessi
    RETURNING id
  `);
  const { rows: roles } = await client.query(
    "SELECT id, nome FROM ruoli WHERE nome IN ('SuperAdmin', 'Operatore', 'Operatore Magazzino')",
  );
  const role = (name) => {
    const id = roles.find((row) => row.nome === name)?.id;
    assert.ok(id, `Missing role ${name}`);
    return id;
  };
  const accounts = [
    ["sadmin", role("SuperAdmin"), null, null],
    [
      "test-m5b-center-a1",
      role("Operatore"),
      areaA,
      center("TEST-M5B Centro A1"),
    ],
    ["test-m5b-warehouse-a", role("Operatore Magazzino"), areaA, null],
    ["test-m5b-reader-a", readerRole.id, areaA, null],
    [
      "test-m5b-other-center-a2",
      role("Operatore"),
      areaA,
      center("TEST-M5B Centro A2"),
    ],
    [
      "test-m5b-other-area-b",
      role("Operatore Magazzino"),
      areaB,
      center("TEST-M5B Centro B1"),
    ],
  ];
  for (const [username, roleId, areaId, centerId] of accounts) {
    await client.query(
      `
      INSERT INTO utenti
        (username, password_hash, nome, cognome, ruolo_id, area_operativa_id,
         centro_ascolto_id, must_change_password)
      VALUES ($1, $2, 'TEST-M5B', 'Browser', $3, $4, $5, false)
      ON CONFLICT (username) DO UPDATE SET password_hash=EXCLUDED.password_hash,
        ruolo_id=EXCLUDED.ruolo_id, area_operativa_id=EXCLUDED.area_operativa_id,
        centro_ascolto_id=EXCLUDED.centro_ascolto_id, attivo=true,
        must_change_password=false
    `,
      [username, passwordHash, roleId, areaId, centerId],
    );
  }
  await client.query("COMMIT");
  console.log(
    `M5B_E2E_SEED_OK accounts=${accounts.map(([name]) => name).join(",")}`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
