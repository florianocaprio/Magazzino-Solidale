import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { runMigrations, sha256 } from "./migration-runner.mjs";

// Eseguire solo nel successivo ##test con un server PostgreSQL temporaneo e
// M5A_MIGRATION_TEST_ADMIN_URL esplicito. DATABASE_URL non viene letto.
const adminConnection = process.env.M5A_MIGRATION_TEST_ADMIN_URL;
const expectedSession = process.env.M5A_MIGRATION_TEST_SESSION_TOKEN;
const expectedSystemId = process.env.M5A_MIGRATION_TEST_SYSTEM_IDENTIFIER;
const expectedPort = process.env.M5A_MIGRATION_TEST_PORT;
const migrationFilename = "20260925_m5a_richieste_magazzino.sql";
const baselineFilename = "20260924_m5a_test_baseline.sql";
const migrationSqlPath = new URL(
  `../updates/${migrationFilename}`,
  import.meta.url,
);

test(
  "M5A: ledger su baseline isolata, secondo run e vincoli PostgreSQL",
  { skip: !adminConnection },
  async () => {
    const adminUrl = new URL(adminConnection);
    assert.equal(
      adminUrl.pathname,
      "/postgres",
      "Usare un URL amministrativo esplicito verso il DB postgres di test",
    );
    const name =
      process.env.M5A_MIGRATION_TEST_DATABASE_NAME ??
      `m5a_migration_${randomUUID().replaceAll("-", "")}`;
    if (expectedSession) {
      assert.match(name, /^m5a_reduced_[0-9a-f]{12}$/);
      assert.equal(adminUrl.hostname, "127.0.0.1");
      assert.equal(adminUrl.port, expectedPort);
      assert.equal(adminUrl.username, "m5a_test");
    }
    const databaseUrl = new URL(adminUrl);
    databaseUrl.pathname = `/${name}`;
    const directory = await mkdtemp(path.join(tmpdir(), "m5a-ledger-"));
    const admin = new Client({ connectionString: adminUrl.toString() });
    let client;
    let created = false;
    try {
      const baseline = `
      CREATE TABLE aree_operative (id integer PRIMARY KEY);
      CREATE TABLE centri_di_ascolto (id integer PRIMARY KEY);
      CREATE TABLE beneficiari (id integer PRIMARY KEY);
      CREATE TABLE enti_destinatari (id integer PRIMARY KEY);
      CREATE TABLE magazzini (id integer PRIMARY KEY);
      CREATE TABLE interventi (id integer PRIMARY KEY);
      CREATE TABLE utenti (id integer PRIMARY KEY);
      INSERT INTO aree_operative VALUES (1);
      INSERT INTO centri_di_ascolto VALUES (1);
      INSERT INTO beneficiari VALUES (1);
      INSERT INTO enti_destinatari VALUES (1);
      INSERT INTO magazzini VALUES (1);
      INSERT INTO interventi VALUES (1);
      INSERT INTO utenti VALUES (1);
    `;
      await writeFile(path.join(directory, baselineFilename), baseline);
      await writeFile(
        path.join(directory, migrationFilename),
        await readFile(migrationSqlPath),
      );
      const manifestPath = path.join(
        directory,
        "legacy-migrations-baseline.json",
      );
      await writeFile(
        manifestPath,
        JSON.stringify({
          formatVersion: 1,
          algorithm: "sha256",
          files: [
            {
              filename: baselineFilename,
              checksumSha256: sha256(Buffer.from(baseline)),
            },
          ],
        }),
      );
      await admin.connect();
      if (expectedSession) {
        const identity = (
          await admin.query(
            "SELECT (pg_control_system()).system_identifier::text AS id, (SELECT token FROM m5a_test_meta.session_marker) AS token",
          )
        ).rows[0];
        assert.equal(identity.id, expectedSystemId);
        assert.equal(identity.token, expectedSession);
      }
      await admin.query(`CREATE DATABASE "${name}" TEMPLATE template0`);
      created = true;
      if (expectedSession)
        await admin.query(
          `COMMENT ON DATABASE "${name}" IS 'm5a-test:${expectedSession}'`,
        );
      const options = {
        databaseUrl: databaseUrl.toString(),
        updatesDirectory: directory,
        manifestPath,
        sourceVersion: "m5a-migration-test",
        logger: { info() {}, error() {} },
      };
      const first = await runMigrations(options);
      assert.equal(first.appliedFiles, 2);
      const second = await runMigrations(options);
      assert.equal(second.appliedFiles, 0);
      assert.equal(second.skippedFiles, 2);
      client = new Client({ connectionString: databaseUrl.toString() });
      await client.connect();
      assert.equal(
        (await client.query("SELECT count(*)::integer AS n FROM beneficiari"))
          .rows[0].n,
        1,
      );
      const insert = (code, intervention = null) =>
        client.query(
          `
      INSERT INTO richieste_magazzino (codice, tipo_destinatario, beneficiario_id,
        area_operativa_id, centro_ascolto_id, sorgente, intervento_id,
        destinatario_nome_snapshot, area_nome_snapshot, bisogno, inviato_da)
      VALUES ($1, 'beneficiario', 1, 1, 1, $2, $3, 'Ada Test', 'Area A', 'Pacco', 1)
      RETURNING id
    `,
          [
            code,
            intervention == null ? "beneficiario" : "intervento_sociale",
            intervention,
          ],
        );
      const firstRequest = await insert("RM-TEST-1", 1);
      await assert.rejects(insert("RM-TEST-2", 1), { code: "23505" });
      await assert.rejects(insert("RM-TEST-1"), { code: "23505" });
      await assert.rejects(
        client.query(
          "UPDATE richieste_magazzino SET versione = 0 WHERE id = $1",
          [firstRequest.rows[0].id],
        ),
        { code: "23514" },
      );
      await assert.rejects(
        client.query(
          "UPDATE richieste_magazzino SET tipo_destinatario = 'ente' WHERE id = $1",
          [firstRequest.rows[0].id],
        ),
        { code: "23514" },
      );
      await client.query(
        "UPDATE richieste_magazzino SET stato = 'annullata', annullato_da = 1, annullato_at = now(), motivo_annullamento = 'Sostituita' WHERE id = $1",
        [firstRequest.rows[0].id],
      );
      await insert("RM-TEST-3", 1);
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::integer AS n FROM app_meta.schema_migrations",
          )
        ).rows[0].n,
        2,
      );
    } finally {
      try {
        if (client) await client.end().catch(() => {});
        if (created) {
          if (expectedSession) {
            const identity = (
              await admin.query(
                "SELECT (pg_control_system()).system_identifier::text AS id, (SELECT shobj_description(oid, 'pg_database') FROM pg_database WHERE datname = $1) AS marker",
                [name],
              )
            ).rows[0];
            assert.equal(identity.id, expectedSystemId);
            assert.equal(identity.marker, `m5a-test:${expectedSession}`);
          }
          await admin.query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
            [name],
          );
          await admin.query(`DROP DATABASE "${name}"`);
        }
      } finally {
        await admin.end().catch(() => {});
        await rm(directory, { recursive: true, force: true });
      }
    }
  },
);
