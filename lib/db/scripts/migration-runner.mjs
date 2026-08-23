import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { Client } from "pg";

export const RUNNER_VERSION = 1;
export const GLOBAL_LOCK_KEY = "magazzino-solidale:schema-migrations";
export const DEFAULT_LOCK_TIMEOUT_MS = 120_000;
const LOCK_POLL_INTERVAL_MS = 100;
const MAX_ERROR_MESSAGE_LENGTH = 1_000;
const MIGRATION_NAME_PATTERN = /^\d{8}_[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/;
const CHECKSUM_PATTERN = /^[0-9a-f]{64}$/;

export class MigrationRunnerError extends Error {
  constructor(code, message, details = {}, options = {}) {
    super(message, options);
    this.name = "MigrationRunnerError";
    this.code = code;
    this.details = details;
  }
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function readPositiveInteger(value, fallback, name) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new MigrationRunnerError(
      "MIGRATION_CONFIGURATION_INVALID",
      `${name} deve essere un intero non negativo`,
    );
  }
  return parsed;
}

function sourceVersion(value) {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 255) : null;
}

function sanitizeErrorMessage(error) {
  const raw =
    error instanceof Error
      ? error.message
      : String(error ?? "Errore migration");
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, "[REDACTED_DATABASE_URL]")
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}

function errorCode(error, fallback = "MIGRATION_RUNNER_FAILED") {
  if (error && typeof error === "object" && typeof error.code === "string") {
    return error.code.slice(0, 100);
  }
  return fallback;
}

function normalizeError(error, fallbackCode = "MIGRATION_RUNNER_FAILED") {
  if (error instanceof MigrationRunnerError) return error;
  return new MigrationRunnerError(
    fallbackCode,
    sanitizeErrorMessage(error),
    { sqlState: errorCode(error, null) },
    { cause: error },
  );
}

function log(logger, level, message) {
  const method = logger?.[level] ?? logger?.log;
  if (typeof method === "function") method.call(logger, message);
}

async function loadManifest(manifestPath) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new MigrationRunnerError(
      "LEGACY_BASELINE_INVALID",
      `Manifest legacy non valido: ${sanitizeErrorMessage(error)}`,
      {},
      { cause: error },
    );
  }

  if (
    manifest == null ||
    manifest.formatVersion !== 1 ||
    manifest.algorithm !== "sha256" ||
    !Array.isArray(manifest.files)
  ) {
    throw new MigrationRunnerError(
      "LEGACY_BASELINE_INVALID",
      "Manifest legacy con formato o algoritmo non supportato",
    );
  }

  const names = new Set();
  let previousName = null;
  for (const entry of manifest.files) {
    if (
      entry == null ||
      typeof entry.filename !== "string" ||
      !MIGRATION_NAME_PATTERN.test(entry.filename) ||
      typeof entry.checksumSha256 !== "string" ||
      !CHECKSUM_PATTERN.test(entry.checksumSha256) ||
      names.has(entry.filename) ||
      (previousName != null && entry.filename <= previousName)
    ) {
      throw new MigrationRunnerError(
        "LEGACY_BASELINE_INVALID",
        "Manifest legacy duplicato, non ordinato o con campi non validi",
      );
    }
    names.add(entry.filename);
    previousName = entry.filename;
  }

  return manifest;
}

export async function loadMigrationPlan({ updatesDirectory, manifestPath }) {
  let entries;
  try {
    entries = await readdir(updatesDirectory, { withFileTypes: true });
  } catch (error) {
    throw new MigrationRunnerError(
      "MIGRATION_DIRECTORY_INVALID",
      `Directory migration non leggibile: ${sanitizeErrorMessage(error)}`,
      {},
      { cause: error },
    );
  }

  const sqlEntries = entries
    .filter((entry) => entry.name.endsWith(".sql"))
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );
  const seen = new Set();
  const files = [];
  for (const entry of sqlEntries) {
    if (
      !entry.isFile() ||
      !MIGRATION_NAME_PATTERN.test(entry.name) ||
      seen.has(entry.name)
    ) {
      throw new MigrationRunnerError(
        "MIGRATION_DIRECTORY_INVALID",
        `File migration non valido: ${entry.name}`,
      );
    }
    seen.add(entry.name);
    const filePath = path.join(updatesDirectory, entry.name);
    const bytes = await readFile(filePath);
    files.push({
      filename: entry.name,
      checksumSha256: sha256(bytes),
      sql: bytes.toString("utf8"),
    });
  }

  const manifest = await loadManifest(manifestPath);
  const filesByName = new Map(files.map((file) => [file.filename, file]));
  for (const entry of manifest.files) {
    const file = filesByName.get(entry.filename);
    if (!file) {
      throw new MigrationRunnerError(
        "LEGACY_BASELINE_FILE_MISSING",
        `Migration legacy mancante: ${entry.filename}`,
        { filename: entry.filename },
      );
    }
    if (file.checksumSha256 !== entry.checksumSha256) {
      throw new MigrationRunnerError(
        "LEGACY_BASELINE_CHECKSUM_MISMATCH",
        `Checksum legacy non corrispondente per ${entry.filename}: expected=${entry.checksumSha256} actual=${file.checksumSha256}`,
        {
          filename: entry.filename,
          expectedChecksum: entry.checksumSha256,
          actualChecksum: file.checksumSha256,
        },
      );
    }
  }

  return { files, manifest };
}

const metadataSql = `
  CREATE SCHEMA IF NOT EXISTS app_meta;

  CREATE TABLE IF NOT EXISTS app_meta.schema_migrations (
    filename text PRIMARY KEY,
    checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    applied_at timestamptz NOT NULL DEFAULT now(),
    duration_ms integer NOT NULL CHECK (duration_ms >= 0),
    runner_version integer NOT NULL CHECK (runner_version >= 1),
    source_version varchar(255),
    adoption_mode varchar(32) NOT NULL CHECK (
      adoption_mode IN ('REPLAY_AND_REGISTER', 'NORMAL')
    )
  );

  CREATE TABLE IF NOT EXISTS app_meta.schema_migration_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status varchar(20) NOT NULL CHECK (
      status IN ('RUNNING', 'SUCCESS', 'FAILED', 'LOCK_TIMEOUT', 'VERIFY_ONLY', 'ABORTED')
    ),
    runner_version integer NOT NULL CHECK (runner_version >= 1),
    source_version varchar(255),
    host_name varchar(255) NOT NULL,
    process_id integer NOT NULL,
    total_files integer NOT NULL CHECK (total_files >= 0),
    pending_files integer NOT NULL CHECK (pending_files >= 0),
    applied_files integer NOT NULL DEFAULT 0 CHECK (applied_files >= 0),
    skipped_files integer NOT NULL DEFAULT 0 CHECK (skipped_files >= 0),
    failed_filename text,
    error_code varchar(100),
    error_message varchar(1000),
    legacy_adoption boolean NOT NULL DEFAULT false
  );

  CREATE TABLE IF NOT EXISTS app_meta.schema_migration_run_items (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id bigint NOT NULL REFERENCES app_meta.schema_migration_runs(id) ON DELETE CASCADE,
    filename text NOT NULL,
    checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
    status varchar(20) NOT NULL CHECK (
      status IN ('PENDING', 'APPLIED', 'SKIPPED', 'FAILED')
    ),
    started_at timestamptz,
    finished_at timestamptz,
    duration_ms integer CHECK (duration_ms IS NULL OR duration_ms >= 0),
    error_code varchar(100),
    error_message varchar(1000),
    UNIQUE (run_id, filename)
  );

  CREATE INDEX IF NOT EXISTS schema_migration_runs_started_idx
    ON app_meta.schema_migration_runs (started_at DESC);
  CREATE INDEX IF NOT EXISTS schema_migration_runs_status_idx
    ON app_meta.schema_migration_runs (status);
  CREATE INDEX IF NOT EXISTS schema_migration_run_items_run_idx
    ON app_meta.schema_migration_run_items (run_id, status);
`;

async function metadataInitialized(client) {
  const result = await client.query(
    "SELECT to_regclass('app_meta.schema_migrations') IS NOT NULL AS initialized",
  );
  return result.rows[0].initialized === true;
}

async function ensureMetadata(client) {
  await client.query("BEGIN");
  try {
    await client.query(metadataSql);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new MigrationRunnerError(
      "MIGRATION_METADATA_INITIALIZATION_FAILED",
      `Impossibile inizializzare app_meta: ${sanitizeErrorMessage(error)}`,
      {},
      { cause: error },
    );
  }
}

async function verifyMetadata(client) {
  const requiredColumns = {
    schema_migrations: [
      "filename",
      "checksum_sha256",
      "applied_at",
      "duration_ms",
      "runner_version",
      "source_version",
      "adoption_mode",
    ],
    schema_migration_runs: [
      "id",
      "started_at",
      "finished_at",
      "status",
      "runner_version",
      "source_version",
      "host_name",
      "process_id",
      "total_files",
      "pending_files",
      "applied_files",
      "skipped_files",
      "failed_filename",
      "error_code",
      "error_message",
      "legacy_adoption",
    ],
    schema_migration_run_items: [
      "id",
      "run_id",
      "filename",
      "checksum_sha256",
      "status",
      "started_at",
      "finished_at",
      "duration_ms",
      "error_code",
      "error_message",
    ],
  };
  const columns = (
    await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'app_meta'
        AND table_name IN (
          'schema_migrations',
          'schema_migration_runs',
          'schema_migration_run_items'
        )
    `)
  ).rows;
  const actual = new Map();
  for (const row of columns) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }
  for (const [tableName, names] of Object.entries(requiredColumns)) {
    for (const columnName of names) {
      if (!actual.get(tableName)?.has(columnName)) {
        throw new MigrationRunnerError(
          "MIGRATION_METADATA_INVALID",
          `Metadata app_meta incompleti: manca ${tableName}.${columnName}`,
        );
      }
    }
  }

  const constraints = await client.query(`
    SELECT
      EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'app_meta.schema_migrations'::regclass
          AND c.contype = 'p'
          AND ARRAY(
            SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY key(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
            ORDER BY key.ord
          ) = ARRAY['filename']::name[]
      ) AS migration_pk,
      EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conrelid = 'app_meta.schema_migration_run_items'::regclass
          AND c.contype = 'u'
          AND ARRAY(
            SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY key(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = key.attnum
            ORDER BY key.ord
          ) = ARRAY['run_id', 'filename']::name[]
      ) AS run_item_unique
  `);
  if (
    constraints.rows[0].migration_pk !== true ||
    constraints.rows[0].run_item_unique !== true
  ) {
    throw new MigrationRunnerError(
      "MIGRATION_METADATA_INVALID",
      "Metadata app_meta privi dei constraint PK/unique richiesti",
    );
  }
}

async function acquireGlobalLock(
  client,
  { lockTimeoutMs, lockPollIntervalMs },
) {
  const startedAt = Date.now();
  while (true) {
    const result = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [GLOBAL_LOCK_KEY],
    );
    if (result.rows[0].acquired === true) return;
    if (Date.now() - startedAt >= lockTimeoutMs) {
      throw new MigrationRunnerError(
        "MIGRATION_LOCK_TIMEOUT",
        `Timeout acquisizione lock migration dopo ${lockTimeoutMs} ms`,
      );
    }
    await wait(Math.min(lockPollIntervalMs, Math.max(lockTimeoutMs, 1)));
  }
}

async function releaseGlobalLock(client) {
  await client.query(
    "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released",
    [GLOBAL_LOCK_KEY],
  );
}

async function markStaleRuns(client) {
  await client.query(`
    UPDATE app_meta.schema_migration_runs
    SET status = 'ABORTED',
        finished_at = now(),
        error_code = 'STALE_RUN',
        error_message = 'Run RUNNING privo del lock globale al successivo avvio'
    WHERE status = 'RUNNING'
  `);
}

async function readLedger(client) {
  return (
    await client.query(`
      SELECT filename, checksum_sha256, applied_at, adoption_mode
      FROM app_meta.schema_migrations
      ORDER BY filename
    `)
  ).rows;
}

function analyzeLedger(files, ledger) {
  const filesByName = new Map(files.map((file) => [file.filename, file]));
  const ledgerByName = new Map(ledger.map((row) => [row.filename, row]));
  const appliedFilesMissing = ledger
    .filter((row) => !filesByName.has(row.filename))
    .map((row) => ({
      filename: row.filename,
      expectedChecksum: row.checksum_sha256,
    }));
  const checksumMismatches = ledger
    .filter((row) => {
      const file = filesByName.get(row.filename);
      return file && file.checksumSha256 !== row.checksum_sha256;
    })
    .map((row) => ({
      filename: row.filename,
      expectedChecksum: row.checksum_sha256,
      actualChecksum: filesByName.get(row.filename).checksumSha256,
    }));
  const pendingFiles = files.filter((file) => !ledgerByName.has(file.filename));
  const lastAppliedFilename = ledger.length
    ? ledger
        .map((row) => row.filename)
        .sort()
        .at(-1)
    : null;
  const outOfOrderFiles = lastAppliedFilename
    ? pendingFiles.filter((file) => file.filename < lastAppliedFilename)
    : [];
  return {
    appliedFilesMissing,
    checksumMismatches,
    pendingFiles,
    outOfOrderFiles,
    lastAppliedFilename,
  };
}

function assertLedgerCoherent(analysis) {
  if (analysis.appliedFilesMissing.length) {
    const issue = analysis.appliedFilesMissing[0];
    throw new MigrationRunnerError(
      "MIGRATION_APPLIED_FILE_MISSING",
      `Migration applicata non più presente: ${issue.filename}`,
      issue,
    );
  }
  if (analysis.checksumMismatches.length) {
    const issue = analysis.checksumMismatches[0];
    throw new MigrationRunnerError(
      "MIGRATION_CHECKSUM_MISMATCH",
      `Checksum migration non corrispondente per ${issue.filename}: expected=${issue.expectedChecksum} actual=${issue.actualChecksum}`,
      issue,
    );
  }
  if (analysis.outOfOrderFiles.length) {
    const file = analysis.outOfOrderFiles[0];
    throw new MigrationRunnerError(
      "MIGRATION_OUT_OF_ORDER",
      `Migration pendente fuori ordine: ${file.filename} precede ${analysis.lastAppliedFilename}`,
      {
        filename: file.filename,
        lastAppliedFilename: analysis.lastAppliedFilename,
      },
    );
  }
}

async function createRun(client, { files, ledger, source, legacyAdoption }) {
  const ledgerNames = new Set(ledger.map((row) => row.filename));
  const pending = files.filter((file) => !ledgerNames.has(file.filename));
  const skipped = files.length - pending.length;
  const result = await client.query(
    `
      INSERT INTO app_meta.schema_migration_runs (
        status, runner_version, source_version, host_name, process_id,
        total_files, pending_files, applied_files, skipped_files,
        legacy_adoption
      ) VALUES ('RUNNING', $1, $2, $3, $4, $5, $6, 0, $7, $8)
      RETURNING id
    `,
    [
      RUNNER_VERSION,
      source,
      hostname().slice(0, 255),
      process.pid,
      files.length,
      pending.length,
      skipped,
      legacyAdoption,
    ],
  );
  const runId = result.rows[0].id;
  for (const file of files) {
    const isSkipped = ledgerNames.has(file.filename);
    await client.query(
      `
        INSERT INTO app_meta.schema_migration_run_items (
          run_id, filename, checksum_sha256, status,
          started_at, finished_at, duration_ms
        ) VALUES ($1, $2, $3, $4::varchar,
          CASE WHEN $4::varchar = 'SKIPPED' THEN now() ELSE NULL END,
          CASE WHEN $4::varchar = 'SKIPPED' THEN now() ELSE NULL END,
          CASE WHEN $4::varchar = 'SKIPPED' THEN 0 ELSE NULL END
        )
      `,
      [
        runId,
        file.filename,
        file.checksumSha256,
        isSkipped ? "SKIPPED" : "PENDING",
      ],
    );
  }
  return { runId, pending, skipped };
}

async function markRunFailed(client, runId, error, counters = {}) {
  const normalized = normalizeError(error);
  const filename = normalized.details?.filename ?? null;
  const code = normalized.details?.sqlState ?? errorCode(normalized);
  const message = sanitizeErrorMessage(normalized);
  if (filename) {
    const checksum =
      normalized.details?.actualChecksum ??
      normalized.details?.expectedChecksum ??
      "0".repeat(64);
    await client.query(
      `
        INSERT INTO app_meta.schema_migration_run_items (
          run_id, filename, checksum_sha256, status, started_at, finished_at,
          duration_ms, error_code, error_message
        ) VALUES ($1, $2, $3, 'FAILED', now(), now(), 0, $4, $5)
        ON CONFLICT (run_id, filename) DO UPDATE SET
          status = 'FAILED',
          started_at = COALESCE(app_meta.schema_migration_run_items.started_at, now()),
          finished_at = now(),
          duration_ms = COALESCE(app_meta.schema_migration_run_items.duration_ms, 0),
          error_code = EXCLUDED.error_code,
          error_message = EXCLUDED.error_message
      `,
      [runId, filename, checksum, code, message],
    );
  }
  await client.query(
    `
      UPDATE app_meta.schema_migration_runs
      SET status = 'FAILED', finished_at = now(), failed_filename = $2,
          error_code = $3, error_message = $4,
          applied_files = $5, skipped_files = $6
      WHERE id = $1
    `,
    [
      runId,
      filename,
      code,
      message,
      counters.appliedFiles ?? 0,
      counters.skippedFiles ?? 0,
    ],
  );
  return normalized;
}

async function markLockTimeout(client, plan, source, error) {
  if (!(await metadataInitialized(client))) return;
  await client.query(
    `
      INSERT INTO app_meta.schema_migration_runs (
        started_at, finished_at, status, runner_version, source_version,
        host_name, process_id, total_files, pending_files, applied_files,
        skipped_files, error_code, error_message, legacy_adoption
      ) VALUES (now(), now(), 'LOCK_TIMEOUT', $1, $2, $3, $4, $5, 0, 0, 0, $6, $7, false)
    `,
    [
      RUNNER_VERSION,
      source,
      hostname().slice(0, 255),
      process.pid,
      plan.files.length,
      errorCode(error),
      sanitizeErrorMessage(error),
    ],
  );
}

function resolveOptions(options) {
  if (
    !options?.databaseUrl ||
    !options?.updatesDirectory ||
    !options?.manifestPath
  ) {
    throw new MigrationRunnerError(
      "MIGRATION_CONFIGURATION_INVALID",
      "databaseUrl, updatesDirectory e manifestPath sono obbligatori",
    );
  }
  return {
    ...options,
    logger: options.logger ?? console,
    lockTimeoutMs: readPositiveInteger(
      options.lockTimeoutMs ?? process.env.DB_MIGRATION_LOCK_TIMEOUT_MS,
      DEFAULT_LOCK_TIMEOUT_MS,
      "DB_MIGRATION_LOCK_TIMEOUT_MS",
    ),
    lockPollIntervalMs: readPositiveInteger(
      options.lockPollIntervalMs,
      LOCK_POLL_INTERVAL_MS,
      "lockPollIntervalMs",
    ),
    source: sourceVersion(
      options.sourceVersion ??
        process.env.MIGRATION_SOURCE_VERSION ??
        process.env.GIT_SHA,
    ),
  };
}

export async function runMigrations(options) {
  const resolved = resolveOptions(options);
  const plan = await loadMigrationPlan(resolved);
  const client = new Client({ connectionString: resolved.databaseUrl });
  let lockAcquired = false;
  let runId = null;
  let runClosed = false;
  let appliedFiles = 0;
  let skippedFiles = 0;
  try {
    await client.connect();
    try {
      await acquireGlobalLock(client, resolved);
      lockAcquired = true;
    } catch (error) {
      const normalized = normalizeError(error, "MIGRATION_LOCK_TIMEOUT");
      await markLockTimeout(client, plan, resolved.source, normalized);
      throw normalized;
    }

    await ensureMetadata(client);
    await verifyMetadata(client);
    await markStaleRuns(client);
    const ledger = await readLedger(client);
    const manifestNames = new Set(
      plan.manifest.files.map((entry) => entry.filename),
    );
    const ledgerNames = new Set(ledger.map((row) => row.filename));
    const legacyAdoption = plan.manifest.files.some(
      (entry) => !ledgerNames.has(entry.filename),
    );
    const createdRun = await createRun(client, {
      files: plan.files,
      ledger,
      source: resolved.source,
      legacyAdoption,
    });
    runId = createdRun.runId;
    skippedFiles = createdRun.skipped;
    const analysis = analyzeLedger(plan.files, ledger);
    try {
      assertLedgerCoherent(analysis);
    } catch (error) {
      runClosed = true;
      throw await markRunFailed(client, runId, error, {
        appliedFiles,
        skippedFiles,
      });
    }

    log(
      resolved.logger,
      "info",
      `Migration run ${runId}: modalità=${legacyAdoption ? "REPLAY_AND_REGISTER" : "NORMAL"} totale=${plan.files.length} pending=${analysis.pendingFiles.length}`,
    );
    for (const file of plan.files) {
      if (ledgerNames.has(file.filename)) {
        log(
          resolved.logger,
          "info",
          `SKIPPED ${file.filename} checksum verificato`,
        );
        continue;
      }
      const startedAt = Date.now();
      await client.query(
        `UPDATE app_meta.schema_migration_run_items
         SET started_at = now() WHERE run_id = $1 AND filename = $2`,
        [runId, file.filename],
      );
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        const durationMs = Math.max(0, Date.now() - startedAt);
        await client.query(
          `
            INSERT INTO app_meta.schema_migrations (
              filename, checksum_sha256, duration_ms, runner_version,
              source_version, adoption_mode
            ) VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [
            file.filename,
            file.checksumSha256,
            durationMs,
            RUNNER_VERSION,
            resolved.source,
            legacyAdoption && manifestNames.has(file.filename)
              ? "REPLAY_AND_REGISTER"
              : "NORMAL",
          ],
        );
        await client.query(
          `
            UPDATE app_meta.schema_migration_run_items
            SET status = 'APPLIED', finished_at = now(), duration_ms = $3
            WHERE run_id = $1 AND filename = $2
          `,
          [runId, file.filename, durationMs],
        );
        await client.query("COMMIT");
        appliedFiles += 1;
        log(
          resolved.logger,
          "info",
          `APPLIED ${file.filename} ${durationMs}ms`,
        );
      } catch (error) {
        await client.query("ROLLBACK");
        const migrationError = new MigrationRunnerError(
          "MIGRATION_EXECUTION_FAILED",
          `Migration ${file.filename} fallita: ${sanitizeErrorMessage(error)}`,
          { filename: file.filename, sqlState: errorCode(error, null) },
          { cause: error },
        );
        runClosed = true;
        throw await markRunFailed(client, runId, migrationError, {
          appliedFiles,
          skippedFiles,
        });
      }
    }

    await client.query(
      `
        UPDATE app_meta.schema_migration_runs
        SET status = 'SUCCESS', finished_at = now(), applied_files = $2,
            skipped_files = $3
        WHERE id = $1
      `,
      [runId, appliedFiles, skippedFiles],
    );
    runClosed = true;
    return {
      runId,
      totalFiles: plan.files.length,
      appliedFiles,
      skippedFiles,
      legacyAdoption,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    if (runId && !runClosed) {
      await markRunFailed(client, runId, normalized, {
        appliedFiles,
        skippedFiles,
      });
    }
    throw normalized;
  } finally {
    if (lockAcquired) {
      try {
        await releaseGlobalLock(client);
      } catch (error) {
        log(
          resolved.logger,
          "error",
          `MIGRATION_LOCK_RELEASE_FAILED: ${sanitizeErrorMessage(error)}`,
        );
      }
    }
    await client.end();
  }
}

export async function verifyMigrations(options) {
  const resolved = resolveOptions(options);
  const plan = await loadMigrationPlan(resolved);
  const client = new Client({ connectionString: resolved.databaseUrl });
  let lockAcquired = false;
  let runId = null;
  let runClosed = false;
  try {
    await client.connect();
    if (!(await metadataInitialized(client))) {
      return {
        initialized: false,
        appliedFiles: 0,
        pendingFiles: plan.files.length,
      };
    }
    await acquireGlobalLock(client, resolved);
    lockAcquired = true;
    await verifyMetadata(client);
    await markStaleRuns(client);
    const ledger = await readLedger(client);
    const analysis = analyzeLedger(plan.files, ledger);
    const createdRun = await createRun(client, {
      files: plan.files,
      ledger,
      source: resolved.source,
      legacyAdoption: false,
    });
    runId = createdRun.runId;
    try {
      assertLedgerCoherent(analysis);
    } catch (error) {
      runClosed = true;
      throw await markRunFailed(client, runId, error, {
        skippedFiles: createdRun.skipped,
      });
    }
    await client.query(
      `
        UPDATE app_meta.schema_migration_runs
        SET status = 'VERIFY_ONLY', finished_at = now(),
            applied_files = 0, skipped_files = $2
        WHERE id = $1
      `,
      [runId, createdRun.skipped],
    );
    runClosed = true;
    return {
      initialized: true,
      appliedFiles: ledger.length,
      pendingFiles: analysis.pendingFiles.length,
      runId,
    };
  } catch (error) {
    const normalized = normalizeError(error);
    if (runId && !runClosed) await markRunFailed(client, runId, normalized);
    throw normalized;
  } finally {
    if (lockAcquired) await releaseGlobalLock(client);
    await client.end();
  }
}

export async function getMigrationStatus(options) {
  const resolved = resolveOptions(options);
  const plan = await loadMigrationPlan(resolved);
  const client = new Client({ connectionString: resolved.databaseUrl });
  try {
    await client.connect();
    if (!(await metadataInitialized(client))) {
      return {
        initialized: false,
        totalFiles: plan.files.length,
        appliedFiles: 0,
        pendingFiles: plan.files.map((file) => file.filename),
        checksumMismatches: [],
        appliedFilesMissing: [],
        outOfOrderFiles: [],
        lastRun: null,
      };
    }
    await verifyMetadata(client);
    const ledger = await readLedger(client);
    const analysis = analyzeLedger(plan.files, ledger);
    const lastRun =
      (
        await client.query(`
          SELECT status, started_at, finished_at
          FROM app_meta.schema_migration_runs
          ORDER BY id DESC LIMIT 1
        `)
      ).rows[0] ?? null;
    return {
      initialized: true,
      totalFiles: plan.files.length,
      appliedFiles: ledger.length,
      pendingFiles: analysis.pendingFiles.map((file) => file.filename),
      checksumMismatches: analysis.checksumMismatches,
      appliedFilesMissing: analysis.appliedFilesMissing,
      outOfOrderFiles: analysis.outOfOrderFiles.map((file) => file.filename),
      lastRun,
    };
  } finally {
    await client.end();
  }
}
