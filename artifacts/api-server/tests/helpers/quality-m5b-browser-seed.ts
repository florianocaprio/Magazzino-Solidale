// Current-schema CI fixture. The historical 43 -> 44 upgrade fixture is untouched.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";
import { getMigrationStatus } from "../../../../lib/db/scripts/migration-runner.mjs";

const expected = JSON.parse(process.env.QUALITY_TEST_IDENTITY ?? "null");
assert.ok(expected?.marker?.startsWith("quality-gates:"));
const target = new URL(process.env.DATABASE_URL!);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "58621");
assert.equal(target.pathname, "/m5b_ci_e2e");
assert.equal(process.env.M5B_TEST_DISPOSABLE_DB, "verified");
assert.ok(process.env.E2E_PASSWORD);
const client = await pool.connect();
try {
  const {
    rows: [identity],
  } = await client.query(`SELECT current_database() AS database,
    (pg_control_system()).system_identifier::text AS system_identifier,
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) AS marker`);
  assert.deepEqual(identity, {
    database: expected.database,
    system_identifier: expected.system_identifier,
    marker: expected.marker,
  });
  const status = await getMigrationStatus({
    databaseUrl: target.toString(),
    updatesDirectory: fileURLToPath(
      new URL("../../../../lib/db/updates", import.meta.url),
    ),
    manifestPath: fileURLToPath(
      new URL(
        "../../../../lib/db/legacy-migrations-baseline.json",
        import.meta.url,
      ),
    ),
  });
  assert.ok(status.initialized && status.totalFiles > 0);
  assert.equal(status.appliedFiles, status.totalFiles);
  for (const key of [
    "pendingFiles",
    "checksumMismatches",
    "appliedFilesMissing",
    "outOfOrderFiles",
  ])
    assert.deepEqual(status[key], []);

  const one = async (sql: string, values: unknown[] = []) => {
    const { rows } = await client.query(sql, values);
    assert.equal(rows.length, 1);
    return rows[0].id as number;
  };
  await client.query("BEGIN");
  const a = await one(
    "INSERT INTO aree_operative(nome) VALUES ('TEST-M5B Area A') RETURNING id",
  );
  const b = await one(
    "INSERT INTO aree_operative(nome) VALUES ('TEST-M5B Area B') RETURNING id",
  );
  const centers: number[] = [];
  for (const [name, area] of [
    ["A1", a],
    ["A2", a],
    ["B1", b],
  ] as const)
    centers.push(
      await one(
        "INSERT INTO centri_di_ascolto(nome,area_operativa_id) VALUES ($1,$2) RETURNING id",
        ["TEST-M5B Centro " + name, area],
      ),
    );
  const roles = new Map(
    (
      await client.query(
        "SELECT nome,id FROM ruoli WHERE nome IN ('SuperAdmin','Operatore','Operatore Magazzino')",
      )
    ).rows.map((row) => [row.nome, row.id]),
  );
  for (const name of ["SuperAdmin", "Operatore", "Operatore Magazzino"])
    assert.ok(roles.has(name), `Canonical role missing: ${name}`);
  const reader = await one(`INSERT INTO ruoli(nome,aree,permessi,is_admin)
    VALUES ('TEST-M5B Reader','["magazzino"]','["richieste_magazzino.view","magazzino.view"]',false) RETURNING id`);
  const password = await bcrypt.hash(process.env.E2E_PASSWORD!, 10);
  const accounts = [
    ["test-m5b-center-a1", roles.get("Operatore"), a, centers[0]],
    ["test-m5b-warehouse-a", roles.get("Operatore Magazzino"), a, null],
    ["test-m5b-reader-a", reader, a, null],
    ["test-m5b-other-center-a2", roles.get("Operatore"), a, centers[1]],
    ["test-m5b-other-area-b", roles.get("Operatore Magazzino"), b, centers[2]],
  ];
  const users: number[] = [];
  for (const [username, role, area, center] of accounts)
    users.push(
      await one(
        `INSERT INTO utenti(username,password_hash,nome,ruolo_id,area_operativa_id,centro_ascolto_id,must_change_password)
      VALUES ($1,$2,'TEST-M5B Browser',$3,$4,$5,false) RETURNING id`,
        [username, password, role, area, center],
      ),
    );
  const warehouses: number[] = [];
  for (const [suffix, area, center] of [
    ["A1", a, centers[0]],
    ["A2", a, centers[1]],
    ["B1", b, centers[2]],
  ] as const)
    warehouses.push(
      await one(
        `INSERT INTO magazzini(codice,nome,area_operativa_id,centro_ascolto_id)
      VALUES ($1,$2,$3,$4) RETURNING id`,
        ["TEST-M5B-M" + suffix, "TEST-M5B Deposito " + suffix, area, center],
      ),
    );
  const beneficiary = await one(
    `INSERT INTO beneficiari(codice,nome,cognome,centro_ascolto_id,area_operativa_id,num_componenti)
    VALUES ('TEST-M5B-B1','Ada','Sintetica',$1,$2,4) RETURNING id`,
    [centers[0], a],
  );
  const entity = await one(
    "INSERT INTO enti_destinatari(denominazione,indirizzo,area_operativa_id) VALUES ('TEST-M5B Ente','Via sintetica CI 1',$1) RETURNING id",
    [a],
  );
  const product = await one(
    "INSERT INTO prodotti(codice,nome,tipo_prodotto,unita_misura) VALUES ('TEST-M5B-P','TEST-M5B Pasta','alimentare','pz') RETURNING id",
  );
  const lot = await one(
    `INSERT INTO lotti(prodotto_id,data_carico,quantita_caricata,quantita_residua,magazzino_id,codice_lotto)
     VALUES ($1,CURRENT_DATE,10,10,$2,'TEST-M5B-LOT-CI') RETURNING id`,
    [product, warehouses[0]],
  );
  await client.query(
    `INSERT INTO movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,lotto_id,quantita,unita_misura,operatore_id)
     VALUES ('carico','entrata',CURRENT_DATE,$1,$2,$3,10,'pz',$4)`,
    [warehouses[0], product, lot, users[1]],
  );
  const intervention = await one(
    `INSERT INTO interventi(beneficiario_id,operatore_id,tipo_intervento,stato,ambito,area_operativa_id_snapshot,centro_ascolto_id_snapshot)
    VALUES ($1,$2,'TEST-M5B in corso','in_corso','sociale',$3,$4) RETURNING id`,
    [beneficiary, users[0], a, centers[0]],
  );
  for (const taken of [false, true])
    await client.query(
      `INSERT INTO richieste_magazzino(codice,tipo_destinatario,beneficiario_id,area_operativa_id,centro_ascolto_id,
      sorgente,intervento_id,destinatario_nome_snapshot,area_nome_snapshot,centro_nome_snapshot,bisogno,stato,versione,inviato_da,
      preso_in_carico_da,preso_in_carico_codice_snapshot,preso_in_carico_at)
      VALUES ($1,'beneficiario',$2,$3,$4,$5,$6,'Ada Sintetica','TEST-M5B Area A','TEST-M5B Centro A1','Bisogno sintetico',$7,$8,$9,$10,$11,$12)`,
      [
        taken ? "TEST-M5B-R-TAKEN" : "TEST-M5B-R-SENT",
        beneficiary,
        a,
        centers[0],
        taken ? "intervento_sociale" : "beneficiario",
        taken ? intervention : null,
        taken ? "presa_in_carico" : "inviata",
        taken ? 2 : 1,
        users[0],
        taken ? users[1] : null,
        taken ? "test-m5b-warehouse-a" : null,
        taken ? new Date() : null,
      ],
    );
  for (const [kind, destination, name] of [
    ["ente", entity, "TEST-M5B Ente"],
    ["magazzino", warehouses[1], "TEST-M5B Deposito A2"],
  ] as const)
    await client.query(
      `INSERT INTO richieste_magazzino(codice,tipo_destinatario,ente_destinatario_id,magazzino_destinatario_id,
      area_operativa_id,sorgente,destinatario_nome_snapshot,area_nome_snapshot,bisogno,stato,versione,inviato_da,
      preso_in_carico_da,preso_in_carico_codice_snapshot,preso_in_carico_at)
      VALUES ($1,$2,$3,$4,$5,'operativa',$6,'TEST-M5B Area A','Bisogno sintetico','presa_in_carico',2,$7,$7,'test-m5b-warehouse-a',now())`,
      [
        kind === "ente" ? "TEST-M5B-R-ENTE" : "TEST-M5B-R-TRANSFER",
        kind,
        kind === "ente" ? destination : null,
        kind === "magazzino" ? destination : null,
        a,
        name,
        users[1],
      ],
    );
  await client.query("COMMIT");
  console.log(
    "QUALITY_M5B_BROWSER_FIXTURE_OK: canonical roles, two Areas, three Centres; synthetic stock10 with matching entry ledger",
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
