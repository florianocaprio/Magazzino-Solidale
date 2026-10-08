import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { fileURLToPath } from "node:url";
import {
  getMigrationStatus,
  runMigrations,
  verifyMigrations,
} from "./migration-runner.mjs";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.M61_TEST_DISPOSABLE_DB, "1");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "58461");
assert.equal(url.pathname, "/m61_upgrade");
const options = {
  databaseUrl: url.href,
  updatesDirectory: fileURLToPath(new URL("../updates", import.meta.url)),
  manifestPath: fileURLToPath(
    new URL("../legacy-migrations-baseline.json", import.meta.url),
  ),
};
const client = new Client({ connectionString: url.href });
async function insert(query, values) {
  return (await client.query(query, values)).rows[0].id;
}
async function snapshot() {
  const hash = createHash("sha256"),
    counts = {};
  const tables = (
    await client.query(
      "select tablename from pg_tables where schemaname='public' and tablename <> 'utenti_mense' order by tablename",
    )
  ).rows;
  for (const { tablename } of tables) {
    const rows = (
      await client.query(
        `select to_jsonb(t)::text as value from "${tablename}" t order by to_jsonb(t)::text`,
      )
    ).rows;
    counts[tablename] = rows.length;
    hash.update(tablename);
    for (const row of rows) hash.update(row.value);
  }
  return { sha256: hash.digest("hex"), counts };
}
async function semanticSchema(connection) {
  const columns = (
    await connection.query(
      "select table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
    )
  ).rows;
  const constraints = (
    await connection.query(
      "select c.relname as relation,k.contype,pg_get_constraintdef(k.oid) as definition from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,k.contype,pg_get_constraintdef(k.oid)",
    )
  ).rows;
  const indexes = (
    await connection.query(
      "select c.relname as relation,i.indisunique,i.indisprimary,pg_get_expr(i.indpred,i.indrelid) as predicate,array(select pg_get_indexdef(i.indexrelid,s,true) from generate_series(1,i.indnatts) s) as keys from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' order by c.relname,i.indisunique,i.indisprimary,keys",
    )
  ).rows;
  return { columns, constraints, indexes };
}
try {
  await client.connect();
  if (process.env.M61_PARITY_ONLY !== "1") {
    const before = await getMigrationStatus(options);
    assert.equal(before.appliedFiles, 46);
    assert.equal(before.totalFiles, 47);
    assert.deepEqual(before.pendingFiles, [
      "20261007_m61_assegnazioni_utenti_mense.sql",
    ]);
    assert.equal(
      (
        await client.query(
          "select to_regclass('public.utenti_mense') as relation",
        )
      ).rows[0].relation,
      null,
    );
    await client.query("BEGIN");
    // Dati coerenti con la sola base 46: custom, sede associata a un Centro,
    // stock decimale e Beneficiario/tessera/abilitazione, nessun dato M6.1.
    const area = await insert(
      "insert into aree_operative(nome) values ('M61 upgrade Area') returning id",
    );
    const center = await insert(
      "insert into centri_di_ascolto(nome,area_operativa_id) values ('M61 upgrade Centro',$1) returning id",
      [area],
    );
    const role = await insert(
      "insert into ruoli(nome,aree,permessi) values ('M61 custom preservato','[\"mensa\"]','[\"mensa.view\",\"mensa.consumption.manage\"]') returning id",
    );
    const user = await insert(
      "insert into utenti(username,password_hash,nome,ruolo_id,area_operativa_id,centro_ascolto_id) values ('m61_upgrade','synthetic-not-login','Operatore test',$1,$2,$3) returning id",
      [role, area, center],
    );
    const warehouse = await insert(
      "insert into magazzini(codice,nome,area_operativa_id,centro_ascolto_id,tipo_magazzino) values ('M61-UG-W','M61 stock',$1,$2,'mensa') returning id",
      [area, center],
    );
    const canteen = await insert(
      "insert into mense(codice,nome,area_operativa_id,magazzino_id,created_by) values ('M61-UG-M','M61 Mensa',$1,$2,$3) returning id",
      [area, warehouse, user],
    );
    const product = await insert(
      "insert into prodotti(codice,nome,tipo_prodotto,unita_misura,quantita_frazionabile) values ('M61-UG-P','Latte','alimentare','l',true) returning id",
    );
    const lot = await insert(
      "insert into lotti(prodotto_id,magazzino_id,codice_lotto,data_carico,quantita_caricata,quantita_residua) values ($1,$2,'M61 lotto','2026-10-07',0.3,0.3) returning id",
      [product, warehouse],
    );
    await client.query(
      "insert into movimenti(tipo_movimento,tipo_dettaglio,data_movimento,magazzino_id,prodotto_id,lotto_id,quantita,unita_misura,operatore_id) values ('carico','entrata','2026-10-07',$1,$2,$3,0.3,'l',$4)",
      [warehouse, product, lot, user],
    );
    const beneficiary = await insert(
      "insert into beneficiari(codice,nome,cognome,area_operativa_id,centro_ascolto_id) values ('M61-UG-B','Persona','Sintetica',$1,$2) returning id",
      [area, center],
    );
    await client.query(
      "insert into tessere_beneficiari(beneficiario_id,codice,created_by) values ($1,'M61-UG-C',$2)",
      [beneficiary, user],
    );
    await client.query(
      "insert into mensa_abilitazioni(beneficiario_id,mensa_id,data_inizio,created_by) values ($1,$2,'2026-10-01',$3)",
      [beneficiary, canteen, user],
    );
    await client.query("COMMIT");
    const pre = await snapshot();
    console.log("PRE 46/46", JSON.stringify(pre));
    const first = await runMigrations(options);
    assert.equal(first.appliedFiles, 1);
    assert.equal(first.skippedFiles, 46);
    const verified = await verifyMigrations(options);
    assert.equal(verified.appliedFiles, 47);
    assert.deepEqual(await snapshot(), pre);
    assert.equal(
      (await client.query("select count(*)::int as n from utenti_mense"))
        .rows[0].n,
      0,
    );
    const second = await runMigrations(options);
    assert.equal(second.appliedFiles, 0);
    assert.equal(second.skippedFiles, 47);
    assert.deepEqual(await snapshot(), pre);
    console.log(
      "POST 47/47: dati/stock/utenti/ruoli/grant identici; nessun backfill. SECOND applied=0 skipped=47",
    );
    await client.query("BEGIN");
    const assignment = await insert(
      "insert into utenti_mense(utente_id,mensa_id,assegnata_da) values ($1,$2,$1) returning id",
      [user, canteen],
    );
    for (const [query, parameters, code] of [
      [
        "insert into utenti_mense(utente_id,mensa_id,assegnata_da) values ($1,$2,$1)",
        [user, canteen],
        "23505",
      ],
      [
        "insert into utenti_mense(utente_id,mensa_id,assegnata_da) values (2147483647,$1,$2)",
        [canteen, user],
        "23503",
      ],
      [
        "update utenti_mense set attiva=false where id=$1",
        [assignment],
        "23514",
      ],
    ]) {
      await client.query("SAVEPOINT invalid");
      await assert.rejects(
        client.query(query, parameters),
        (error) => error.code === code,
      );
      await client.query("ROLLBACK TO SAVEPOINT invalid");
    }
    await client.query("ROLLBACK");
    console.log("VINCOLI: unicità, FK, revoca coerente PASS");
  }
  const freshUrl = new URL(url);
  freshUrl.pathname = "/m61_fresh";
  const fresh = new Client({ connectionString: freshUrl.href });
  try {
    await fresh.connect();
    const freshStatus = await verifyMigrations({
      ...options,
      databaseUrl: freshUrl.href,
    });
    assert.equal(freshStatus.appliedFiles, 47);
    assert.deepEqual(await semanticSchema(fresh), await semanticSchema(client));
    console.log(
      "PARITÀ schema pubblico fresh 47/47 e upgrade popolato 46→47 PASS (colonne, vincoli e indici, nomi FK non semantici esclusi)",
    );
  } finally {
    await fresh.end();
  }
} finally {
  await client.query("ROLLBACK").catch(() => {});
  await client.end();
}
