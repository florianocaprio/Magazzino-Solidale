import assert from "node:assert/strict";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, beforeEach, describe, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import {
  GLOBAL_LOCK_KEY,
  LEGACY_LOCK_KEY,
  getMigrationStatus,
  loadMigrationPlan,
  runMigrations,
  sha256,
  verifyMigrations,
} from "./migration-runner.mjs";

const silentLogger = { info() {}, error() {} };
const temporaryDirectories = [];
const realUpdatesDirectory = fileURLToPath(
  new URL("../updates", import.meta.url),
);
const realManifestPath = fileURLToPath(
  new URL("../legacy-migrations-baseline.json", import.meta.url),
);

async function createFixture(files, legacyFilenames = Object.keys(files)) {
  const directory = await mkdtemp(path.join(tmpdir(), "magazzino-ledger-"));
  temporaryDirectories.push(directory);
  for (const [filename, sql] of Object.entries(files)) {
    await writeFile(path.join(directory, filename), sql, "utf8");
  }
  const manifest = {
    formatVersion: 1,
    algorithm: "sha256",
    files: legacyFilenames.sort().map((filename) => ({
      filename,
      checksumSha256: sha256(Buffer.from(files[filename], "utf8")),
    })),
  };
  const manifestPath = path.join(directory, "legacy-migrations-baseline.json");
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { directory, manifestPath };
}

async function writeMigration(fixture, filename, sql) {
  await writeFile(path.join(fixture.directory, filename), sql, "utf8");
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    return true;
  });
}

describe("manifest legacy", { concurrency: false }, () => {
  test("accetta un manifest valido", async () => {
    const fixture = await createFixture({
      "20260101_init.sql": "SELECT 1;\n",
    });
    const plan = await loadMigrationPlan({
      updatesDirectory: fixture.directory,
      manifestPath: fixture.manifestPath,
    });
    assert.equal(plan.files.length, 1);
  });

  test("usa lo stesso ordinamento code-unit del runner storico", async () => {
    const files = {
      "20260101_base.sql": "SELECT 1;\n",
      "20260101_base_r1.sql": "SELECT 2;\n",
    };
    const fixture = await createFixture(files);
    const plan = await loadMigrationPlan({
      updatesDirectory: fixture.directory,
      manifestPath: fixture.manifestPath,
    });
    assert.deepEqual(
      plan.files.map((file) => file.filename),
      ["20260101_base.sql", "20260101_base_r1.sql"],
    );
  });

  test("blocca checksum legacy errato", async () => {
    const fixture = await createFixture({
      "20260101_init.sql": "SELECT 1;\n",
    });
    await writeMigration(fixture, "20260101_init.sql", "SELECT 2;\n");
    await expectCode(
      loadMigrationPlan({
        updatesDirectory: fixture.directory,
        manifestPath: fixture.manifestPath,
      }),
      "LEGACY_BASELINE_CHECKSUM_MISMATCH",
    );
  });

  test("blocca file legacy mancante", async () => {
    const fixture = await createFixture({
      "20260101_init.sql": "SELECT 1;\n",
    });
    await unlink(path.join(fixture.directory, "20260101_init.sql"));
    await expectCode(
      loadMigrationPlan({
        updatesDirectory: fixture.directory,
        manifestPath: fixture.manifestPath,
      }),
      "LEGACY_BASELINE_FILE_MISSING",
    );
  });

  test("blocca manifest malformato", async () => {
    const fixture = await createFixture({
      "20260101_init.sql": "SELECT 1;\n",
    });
    await writeFile(fixture.manifestPath, "{not-json", "utf8");
    await expectCode(
      loadMigrationPlan({
        updatesDirectory: fixture.directory,
        manifestPath: fixture.manifestPath,
      }),
      "LEGACY_BASELINE_INVALID",
    );
  });

  test("mantiene 21 file legacy e accetta Beneficiari 2.0, Reporting 2.0 e le migration 2.0C/R1/R2 in coda", async () => {
    const plan = await loadMigrationPlan({
      updatesDirectory: realUpdatesDirectory,
      manifestPath: realManifestPath,
    });
    assert.equal(plan.manifest.files.length, 21);
    assert.equal(plan.files.length, 27);
    assert.ok(
      plan.files.some(
        (file) => file.filename === "20260827_beneficiari_2_0_fse.sql",
      ),
    );
    assert.ok(
      plan.files.some(
        (file) =>
          file.filename === "20260828_reporting_2_0_final_alignment.sql",
      ),
    );
    assert.ok(
      plan.files.some(
        (file) => file.filename === "20260829_reporting_2_0_hardening.sql",
      ),
    );
    assert.equal(
      plan.files.at(-2).filename,
      "20260828_reporting_2_0_final_alignment.sql",
    );
    assert.equal(
      plan.files.at(-1).filename,
      "20260829_reporting_2_0_hardening.sql",
    );
    assert.equal(
      plan.legacyBoundaryFilename,
      "20260823_magazzino_2_0b_r1_agea_hardening.sql",
    );
  });

  for (const filename of [
    "20260102_backdated.sql",
    "20260103_a_before_boundary.sql",
  ]) {
    test(`blocca ${filename} non censito entro il confine legacy`, async () => {
      const files = {
        "20260101_init.sql": "SELECT 1;\n",
        "20260103_legacy.sql": "SELECT 3;\n",
      };
      const fixture = await createFixture(files);
      await writeMigration(fixture, filename, "SELECT 2;\n");
      await expectCode(
        loadMigrationPlan({
          updatesDirectory: fixture.directory,
          manifestPath: fixture.manifestPath,
        }),
        "MIGRATION_LEGACY_BOUNDARY_VIOLATION",
      );
    });
  }

  test("consente un nuovo file strettamente successivo al confine legacy", async () => {
    const files = {
      "20260101_init.sql": "SELECT 1;\n",
      "20260103_legacy.sql": "SELECT 3;\n",
    };
    const fixture = await createFixture(files);
    await writeMigration(fixture, "20260104_append.sql", "SELECT 4;\n");
    const plan = await loadMigrationPlan({
      updatesDirectory: fixture.directory,
      manifestPath: fixture.manifestPath,
    });
    assert.deepEqual(
      plan.files.map((file) => file.filename),
      ["20260101_init.sql", "20260103_legacy.sql", "20260104_append.sql"],
    );
  });

  test("update, verify e status applicano il confine prima della connessione DB", async () => {
    const files = {
      "20260101_init.sql": "SELECT 1;\n",
      "20260103_legacy.sql": "SELECT 3;\n",
    };
    const fixture = await createFixture(files);
    await writeMigration(
      fixture,
      "20260102_backdated.sql",
      "CREATE TABLE boundary_must_not_run (id integer);\n",
    );
    const invalidDatabaseOptions = {
      databaseUrl: "postgresql://127.0.0.1:1/must-not-connect",
      updatesDirectory: fixture.directory,
      manifestPath: fixture.manifestPath,
      logger: silentLogger,
    };
    for (const operation of [
      runMigrations,
      verifyMigrations,
      getMigrationStatus,
    ]) {
      await expectCode(
        operation(invalidDatabaseOptions),
        "MIGRATION_LEGACY_BOUNDARY_VIOLATION",
      );
    }
  });
});

const sourceDatabaseUrl = process.env.DATABASE_URL;
const databaseTestName = `migration_ledger_${process.pid}_${Date.now()}`;
let databaseUrl;
let adminClient;

function quoteIdentifier(value) {
  assert.match(value, /^[a-z0-9_]+$/);
  return `"${value}"`;
}

async function databaseClient() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

async function resetDatabase() {
  const client = await databaseClient();
  try {
    await client.query("DROP SCHEMA IF EXISTS app_meta CASCADE");
    await client.query("DROP SCHEMA public CASCADE");
    await client.query("CREATE SCHEMA public AUTHORIZATION CURRENT_USER");
  } finally {
    await client.end();
  }
}

async function assertBothMigrationLocksAvailable() {
  const client = await databaseClient();
  let legacyAcquired = false;
  let globalAcquired = false;
  try {
    legacyAcquired = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
        [LEGACY_LOCK_KEY],
      )
    ).rows[0].acquired;
    globalAcquired = (
      await client.query(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
        [GLOBAL_LOCK_KEY],
      )
    ).rows[0].acquired;
    assert.equal(legacyAcquired, true);
    assert.equal(globalAcquired, true);
  } finally {
    if (globalAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [
        GLOBAL_LOCK_KEY,
      ]);
    }
    if (legacyAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [
        LEGACY_LOCK_KEY,
      ]);
    }
    await client.end();
  }
}

function options(fixture, overrides = {}) {
  return {
    databaseUrl,
    updatesDirectory: fixture.directory,
    manifestPath: fixture.manifestPath,
    sourceVersion: "migration-runner-test",
    logger: silentLogger,
    lockTimeoutMs: 2_000,
    lockPollIntervalMs: 10,
    ...overrides,
  };
}

describe(
  "migration ledger PostgreSQL",
  { concurrency: false, skip: !sourceDatabaseUrl },
  () => {
    before(async () => {
      const adminUrl = new URL(sourceDatabaseUrl);
      adminUrl.pathname = "/postgres";
      adminUrl.search = "";
      adminClient = new Client({ connectionString: adminUrl.toString() });
      await adminClient.connect();
      await adminClient.query(
        `CREATE DATABASE ${quoteIdentifier(databaseTestName)} TEMPLATE template0`,
      );
      const testUrl = new URL(sourceDatabaseUrl);
      testUrl.pathname = `/${databaseTestName}`;
      testUrl.search = "";
      databaseUrl = testUrl.toString();
    });

    beforeEach(async () => {
      await resetDatabase();
    });

    test("verify non adottato riporta tutti i pending e rilascia entrambi i lock", async () => {
      const fixture = await createFixture({
        "20260101_verify_pending.sql":
          "CREATE TABLE ledger_verify_pending (id integer);",
      });
      const verified = await verifyMigrations(options(fixture));
      assert.deepEqual(verified, {
        initialized: false,
        appliedFiles: 0,
        pendingFiles: 1,
      });
      await assertBothMigrationLocksAvailable();
    });

    test("prima adozione registra la storia e il secondo run salta tutto", async () => {
      const fixture = await createFixture({
        "20260101_init.sql": `
          CREATE TABLE IF NOT EXISTS ledger_adoption_a (id integer PRIMARY KEY);
          INSERT INTO ledger_adoption_a VALUES (1) ON CONFLICT DO NOTHING;
        `,
        "20260102_second.sql": `
          CREATE TABLE IF NOT EXISTS ledger_adoption_b (id integer PRIMARY KEY);
          INSERT INTO ledger_adoption_b VALUES (1) ON CONFLICT DO NOTHING;
        `,
      });

      const first = await runMigrations(options(fixture));
      assert.equal(first.legacyAdoption, true);
      assert.equal(first.appliedFiles, 2);
      const client = await databaseClient();
      const appliedAtBefore = await client.query(`
        SELECT filename, applied_at, adoption_mode
        FROM app_meta.schema_migrations ORDER BY filename
      `);
      assert.equal(appliedAtBefore.rowCount, 2);
      assert.deepEqual(
        appliedAtBefore.rows.map((row) => row.adoption_mode),
        ["REPLAY_AND_REGISTER", "REPLAY_AND_REGISTER"],
      );

      const second = await runMigrations(options(fixture));
      assert.equal(second.legacyAdoption, false);
      assert.equal(second.appliedFiles, 0);
      assert.equal(second.skippedFiles, 2);
      const appliedAtAfter = await client.query(`
        SELECT filename, applied_at FROM app_meta.schema_migrations ORDER BY filename
      `);
      assert.deepEqual(
        appliedAtAfter.rows,
        appliedAtBefore.rows.map((row) => ({
          filename: row.filename,
          applied_at: row.applied_at,
        })),
      );
      const audit = await client.query(`
        SELECT status, applied_files, skipped_files, legacy_adoption
        FROM app_meta.schema_migration_runs ORDER BY id
      `);
      assert.deepEqual(audit.rows, [
        {
          status: "SUCCESS",
          applied_files: 2,
          skipped_files: 0,
          legacy_adoption: true,
        },
        {
          status: "SUCCESS",
          applied_files: 0,
          skipped_files: 2,
          legacy_adoption: false,
        },
      ]);
      await client.end();

      const status = await getMigrationStatus(options(fixture));
      assert.equal(status.initialized, true);
      assert.deepEqual(status.pendingFiles, []);
      const verified = await verifyMigrations(options(fixture));
      assert.equal(verified.pendingFiles, 0);
    });

    test("applica una nuova migration in coda una volta sola", async () => {
      const files = {
        "20260101_init.sql": "CREATE TABLE ledger_append_a (id integer);",
      };
      const fixture = await createFixture(files);
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_append.sql",
        "CREATE TABLE ledger_append_b (id integer);",
      );
      const appended = await runMigrations(options(fixture));
      assert.equal(appended.appliedFiles, 1);
      assert.equal(appended.legacyAdoption, false);
      const repeated = await runMigrations(options(fixture));
      assert.equal(repeated.appliedFiles, 0);
      assert.equal(repeated.skippedFiles, 2);

      const client = await databaseClient();
      const mode = await client.query(`
        SELECT adoption_mode FROM app_meta.schema_migrations
        WHERE filename = '20260102_append.sql'
      `);
      assert.equal(mode.rows[0].adoption_mode, "NORMAL");
      await client.end();
    });

    test("prima adozione registra legacy e append con modalità distinte", async () => {
      const files = {
        "20260101_init.sql": "CREATE TABLE ledger_boundary_a (id integer);",
        "20260103_legacy.sql": "CREATE TABLE ledger_boundary_b (id integer);",
        "20260104_append.sql":
          "CREATE TABLE ledger_boundary_append (id integer);",
      };
      const fixture = await createFixture(files, [
        "20260101_init.sql",
        "20260103_legacy.sql",
      ]);
      const first = await runMigrations(options(fixture));
      assert.equal(first.legacyAdoption, true);
      assert.equal(first.appliedFiles, 3);
      const second = await runMigrations(options(fixture));
      assert.equal(second.appliedFiles, 0);
      assert.equal(second.skippedFiles, 3);

      const client = await databaseClient();
      const modes = await client.query(`
        SELECT filename, adoption_mode
        FROM app_meta.schema_migrations ORDER BY filename
      `);
      assert.deepEqual(modes.rows, [
        {
          filename: "20260101_init.sql",
          adoption_mode: "REPLAY_AND_REGISTER",
        },
        {
          filename: "20260103_legacy.sql",
          adoption_mode: "REPLAY_AND_REGISTER",
        },
        { filename: "20260104_append.sql", adoption_mode: "NORMAL" },
      ]);
      await client.end();
    });

    test("blocca checksum applicato modificato prima di un pending", async () => {
      const fixture = await createFixture({
        "20260101_init.sql": "CREATE TABLE ledger_checksum_a (id integer);",
      });
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_applied.sql",
        "CREATE TABLE ledger_checksum_b (id integer);",
      );
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_applied.sql",
        "CREATE TABLE ledger_checksum_b_changed (id integer);",
      );
      await writeMigration(
        fixture,
        "20260103_pending.sql",
        "CREATE TABLE ledger_checksum_pending (id integer);",
      );
      await expectCode(
        runMigrations(options(fixture)),
        "MIGRATION_CHECKSUM_MISMATCH",
      );
      const client = await databaseClient();
      const pending = await client.query(
        "SELECT to_regclass('public.ledger_checksum_pending') AS relation",
      );
      assert.equal(pending.rows[0].relation, null);
      await client.end();
    });

    test("blocca una migration applicata rimossa", async () => {
      const fixture = await createFixture({
        "20260101_init.sql": "CREATE TABLE ledger_missing_a (id integer);",
      });
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_applied.sql",
        "CREATE TABLE ledger_missing_b (id integer);",
      );
      await runMigrations(options(fixture));
      await unlink(path.join(fixture.directory, "20260102_applied.sql"));
      await expectCode(
        runMigrations(options(fixture)),
        "MIGRATION_APPLIED_FILE_MISSING",
      );
    });

    test("blocca una migration nuova fuori ordine", async () => {
      const fixture = await createFixture({
        "20260101_init.sql": "CREATE TABLE ledger_order_a (id integer);",
      });
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260103_forward.sql",
        "CREATE TABLE ledger_order_forward (id integer);",
      );
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_late.sql",
        "CREATE TABLE ledger_order_late (id integer);",
      );
      await expectCode(
        runMigrations(options(fixture)),
        "MIGRATION_OUT_OF_ORDER",
      );
    });

    test("rollback atomico e ripresa dal file fallito", async () => {
      const fixture = await createFixture({
        "20260101_init.sql": "CREATE TABLE ledger_resume_a (id integer);",
      });
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_failure.sql",
        "CREATE TABLE ledger_resume_b (id integer); SELECT 1 / 0;",
      );
      await writeMigration(
        fixture,
        "20260103_after.sql",
        "CREATE TABLE ledger_resume_c (id integer);",
      );
      await expectCode(
        runMigrations(options(fixture)),
        "MIGRATION_EXECUTION_FAILED",
      );
      const client = await databaseClient();
      const failedState = await client.query(`
        SELECT
          to_regclass('public.ledger_resume_b') AS failed_relation,
          to_regclass('public.ledger_resume_c') AS later_relation,
          (SELECT count(*)::int FROM app_meta.schema_migrations) AS applied
      `);
      assert.deepEqual(failedState.rows[0], {
        failed_relation: null,
        later_relation: null,
        applied: 1,
      });
      const failedAudit = await client.query(`
        SELECT r.status, r.failed_filename, i.status AS item_status,
               r.error_message, i.error_message AS item_error
        FROM app_meta.schema_migration_runs r
        JOIN app_meta.schema_migration_run_items i ON i.run_id = r.id
        WHERE r.status = 'FAILED' AND i.filename = '20260102_failure.sql'
        ORDER BY r.id DESC LIMIT 1
      `);
      assert.equal(failedAudit.rows[0].status, "FAILED");
      assert.equal(failedAudit.rows[0].item_status, "FAILED");
      assert.doesNotMatch(failedAudit.rows[0].error_message, /CREATE TABLE/);
      assert.doesNotMatch(failedAudit.rows[0].item_error, /postgresql:\/\//);
      await client.end();

      await writeMigration(
        fixture,
        "20260102_failure.sql",
        "CREATE TABLE ledger_resume_b (id integer);",
      );
      const resumed = await runMigrations(options(fixture));
      assert.equal(resumed.appliedFiles, 2);
      await assertBothMigrationLocksAvailable();
    });

    test("due runner concorrenti applicano una sola volta", async () => {
      const fixture = await createFixture({
        "20260101_concurrent.sql": `
          SELECT pg_sleep(0.25);
          CREATE TABLE ledger_concurrency (id integer PRIMARY KEY);
          INSERT INTO ledger_concurrency VALUES (1);
        `,
      });
      const results = await Promise.all([
        runMigrations(options(fixture)),
        runMigrations(options(fixture)),
      ]);
      assert.equal(
        results.reduce((total, result) => total + result.appliedFiles, 0),
        1,
      );
      const client = await databaseClient();
      const counts = await client.query(`
        SELECT
          (SELECT count(*)::int FROM ledger_concurrency) AS business_rows,
          (SELECT count(*)::int FROM app_meta.schema_migrations) AS ledger_rows,
          (SELECT count(*)::int FROM app_meta.schema_migration_runs WHERE status = 'SUCCESS') AS successful_runs
      `);
      assert.deepEqual(counts.rows[0], {
        business_rows: 1,
        ledger_rows: 1,
        successful_runs: 2,
      });
      await client.end();
      await assertBothMigrationLocksAvailable();
    });

    test("il lock transazionale legacy blocca il runner senza applicare SQL", async () => {
      const fixture = await createFixture({
        "20260101_init.sql":
          "CREATE TABLE ledger_legacy_lock_base (id integer);",
      });
      await runMigrations(options(fixture));
      await writeMigration(
        fixture,
        "20260102_legacy_lock.sql",
        "CREATE TABLE ledger_legacy_lock (id integer);",
      );
      const holder = await databaseClient();
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        LEGACY_LOCK_KEY,
      ]);
      try {
        await assert.rejects(
          runMigrations(
            options(fixture, { lockTimeoutMs: 40, lockPollIntervalMs: 10 }),
          ),
          (error) => {
            assert.equal(error.code, "MIGRATION_LOCK_TIMEOUT");
            assert.equal(error.details.lockName, "legacy");
            return true;
          },
        );
        const observer = await databaseClient();
        const state = await observer.query(
          "SELECT to_regclass('public.ledger_legacy_lock') AS relation",
        );
        assert.equal(state.rows[0].relation, null);
        const audit = await observer.query(`
          SELECT status, error_code, error_message
          FROM app_meta.schema_migration_runs ORDER BY id DESC LIMIT 1
        `);
        assert.equal(audit.rows[0].status, "LOCK_TIMEOUT");
        assert.equal(audit.rows[0].error_code, "MIGRATION_LOCK_TIMEOUT");
        assert.match(audit.rows[0].error_message, /lock migration legacy/);
        const globalAvailable = await observer.query(
          "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
          [GLOBAL_LOCK_KEY],
        );
        assert.equal(globalAvailable.rows[0].acquired, true);
        await observer.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [GLOBAL_LOCK_KEY],
        );
        await observer.end();
      } finally {
        await holder.query("ROLLBACK");
        await holder.end();
      }
      const rerun = await runMigrations(options(fixture));
      assert.equal(rerun.appliedFiles, 1);
      await assertBothMigrationLocksAvailable();
    });

    test("il runner attende il lock legacy e prosegue dopo il rilascio", async () => {
      const fixture = await createFixture({
        "20260101_legacy_wait.sql":
          "CREATE TABLE ledger_legacy_wait (id integer);",
      });
      const holder = await databaseClient();
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        LEGACY_LOCK_KEY,
      ]);
      let settled = false;
      const pendingRun = runMigrations(
        options(fixture, { lockTimeoutMs: 1_000, lockPollIntervalMs: 10 }),
      ).finally(() => {
        settled = true;
      });
      await delay(60);
      assert.equal(settled, false);
      await holder.query("ROLLBACK");
      await holder.end();
      const result = await pendingRun;
      assert.equal(result.appliedFiles, 1);
      await assertBothMigrationLocksAvailable();
    });

    test("il lock legacy del nuovo runner blocca il runner storico", async () => {
      const fixture = await createFixture({
        "20260101_new_blocks_old.sql":
          "SELECT pg_sleep(0.25); CREATE TABLE ledger_new_blocks_old (id integer);",
      });
      const pendingRun = runMigrations(options(fixture));
      const oldRunner = await databaseClient();
      let legacyAvailable = true;
      const deadline = Date.now() + 1_000;
      while (legacyAvailable && Date.now() < deadline) {
        await oldRunner.query("BEGIN");
        legacyAvailable = (
          await oldRunner.query(
            "SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired",
            [LEGACY_LOCK_KEY],
          )
        ).rows[0].acquired;
        if (legacyAvailable) {
          await oldRunner.query("ROLLBACK");
          await delay(10);
        }
      }
      assert.equal(legacyAvailable, false);
      await oldRunner.query("ROLLBACK");
      await oldRunner.end();
      const result = await pendingRun;
      assert.equal(result.appliedFiles, 1);
      await assertBothMigrationLocksAvailable();
    });

    test("i due lock condividono un unico budget di timeout", async () => {
      const fixture = await createFixture({
        "20260101_shared_budget.sql":
          "CREATE TABLE ledger_shared_budget (id integer);",
      });
      const legacyHolder = await databaseClient();
      const globalHolder = await databaseClient();
      await legacyHolder.query("BEGIN");
      await legacyHolder.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
        LEGACY_LOCK_KEY,
      ]);
      await globalHolder.query(
        "SELECT pg_advisory_lock(hashtextextended($1, 0))",
        [GLOBAL_LOCK_KEY],
      );
      const startedAt = Date.now();
      const pendingRun = runMigrations(
        options(fixture, { lockTimeoutMs: 1_000, lockPollIntervalMs: 10 }),
      );
      await delay(600);
      await legacyHolder.query("ROLLBACK");
      await legacyHolder.end();
      try {
        await assert.rejects(pendingRun, (error) => {
          assert.equal(error.code, "MIGRATION_LOCK_TIMEOUT");
          assert.equal(error.details.lockName, "global");
          return true;
        });
        assert.ok(Date.now() - startedAt < 1_400);
      } finally {
        await globalHolder.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [GLOBAL_LOCK_KEY],
        );
        await globalHolder.end();
      }
      await assertBothMigrationLocksAvailable();
    });

    test("timeout del lock termina non-zero e viene auditato", async () => {
      const fixture = await createFixture({
        "20260101_lock.sql": "CREATE TABLE ledger_lock (id integer);",
      });
      await runMigrations(options(fixture));
      const holder = await databaseClient();
      await holder.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [
        GLOBAL_LOCK_KEY,
      ]);
      try {
        await assert.rejects(
          runMigrations(
            options(fixture, { lockTimeoutMs: 40, lockPollIntervalMs: 10 }),
          ),
          (error) => {
            assert.equal(error.code, "MIGRATION_LOCK_TIMEOUT");
            assert.equal(error.details.lockName, "global");
            assert.doesNotMatch(error.message, /postgresql:\/\//);
            return true;
          },
        );
        const probe = await databaseClient();
        const legacyAvailable = await probe.query(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [LEGACY_LOCK_KEY],
        );
        assert.equal(legacyAvailable.rows[0].acquired, true);
        await probe.query("SELECT pg_advisory_unlock(hashtext($1))", [
          LEGACY_LOCK_KEY,
        ]);
        await probe.end();
      } finally {
        await holder.query(
          "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
          [GLOBAL_LOCK_KEY],
        );
        await holder.end();
      }
      const client = await databaseClient();
      const audit = await client.query(`
        SELECT status, error_code, error_message
        FROM app_meta.schema_migration_runs
        ORDER BY id DESC LIMIT 1
      `);
      assert.equal(audit.rows[0].status, "LOCK_TIMEOUT");
      assert.equal(audit.rows[0].error_code, "MIGRATION_LOCK_TIMEOUT");
      assert.match(audit.rows[0].error_message, /lock migration global/);
      await client.end();
      await assertBothMigrationLocksAvailable();
    });
  },
);

after(async () => {
  for (const directory of temporaryDirectories) {
    await rm(directory, { recursive: true, force: true });
  }
  if (adminClient && databaseUrl) {
    await adminClient.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseTestName],
    );
    await adminClient.query(
      `DROP DATABASE ${quoteIdentifier(databaseTestName)}`,
    );
    await adminClient.end();
  }
});
