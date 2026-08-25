/* @vitest-environment node */

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";

type MigrationRunStatus =
  | "RUNNING"
  | "SUCCESS"
  | "FAILED"
  | "LOCK_TIMEOUT"
  | "VERIFY_ONLY"
  | "ABORTED";

type ExpectedMigration = {
  filename: string;
  checksumSha256: string;
};

async function createReadinessRun({
  status = "SUCCESS",
  historicalPendingFiles = 0,
  extraExpected = [],
  omitFilename,
  checksumMismatchFilename,
  totalFilesDelta = 0,
}: {
  status?: MigrationRunStatus;
  historicalPendingFiles?: number;
  extraExpected?: ExpectedMigration[];
  omitFilename?: string;
  checksumMismatchFilename?: string;
  totalFilesDelta?: number;
} = {}) {
  const ledger = await pool.query<{
    filename: string;
    checksum_sha256: string;
  }>(`
    SELECT filename, checksum_sha256
    FROM app_meta.schema_migrations
    ORDER BY filename
  `);
  const expected = ledger.rows
    .filter((row) => row.filename !== omitFilename)
    .map((row) => ({
      filename: row.filename,
      checksumSha256:
        row.filename === checksumMismatchFilename
          ? row.checksum_sha256 === "0".repeat(64)
            ? "1".repeat(64)
            : "0".repeat(64)
          : row.checksum_sha256,
    }))
    .concat(extraExpected);
  const appliedFiles = Math.min(historicalPendingFiles, expected.length);
  const run = await pool.query<{ id: string }>(
    `
    INSERT INTO app_meta.schema_migration_runs (
      started_at, finished_at, status, runner_version, source_version,
      host_name, process_id, total_files, pending_files, applied_files,
      skipped_files, legacy_adoption
    ) VALUES (
      now(), CASE WHEN $1 = 'RUNNING' THEN NULL ELSE now() END,
      $1, 1, 'readyz-test', 'readyz-test', 1, $2, $3, $4, $5, false
    )
    RETURNING id
  `,
    [
      status,
      expected.length + totalFilesDelta,
      historicalPendingFiles,
      appliedFiles,
      Math.max(0, expected.length - appliedFiles),
    ],
  );
  const runId = run.rows[0].id;
  for (const [index, migration] of expected.entries()) {
    const itemStatus = index < appliedFiles ? "APPLIED" : "SKIPPED";
    await pool.query(
      `
      INSERT INTO app_meta.schema_migration_run_items (
        run_id, filename, checksum_sha256, status,
        started_at, finished_at, duration_ms
      ) VALUES ($1, $2, $3, $4, now(), now(), 0)
    `,
      [runId, migration.filename, migration.checksumSha256, itemStatus],
    );
  }
  return {
    runId,
    ledger: ledger.rows,
    totalExpected: expected.length,
  };
}

async function deleteReadinessRun(runId: string) {
  await pool.query("DELETE FROM app_meta.schema_migration_runs WHERE id = $1", [
    runId,
  ]);
}

afterAll(async () => {
  await pool.end();
});

describe("health, readiness e correlation ID", () => {
  it("genera un correlation ID e conserva quello valido ricevuto", async () => {
    const generated = await request(app).get("/api/healthz");
    expect(generated.status).toBe(200);
    expect(generated.headers["x-correlation-id"]).toMatch(/^[A-Za-z0-9._-]+$/);

    const supplied = await request(app)
      .get("/api/healthz")
      .set("X-Correlation-Id", "review-pr26-123");
    expect(supplied.status).toBe(200);
    expect(supplied.headers["x-correlation-id"]).toBe("review-pr26-123");
  });

  it("verifica database e migration ledger nella readiness", async () => {
    const response = await request(app).get("/api/readyz");
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      status: "ok",
      checks: { database: "ok", pendingMigrations: 0 },
    });
  });

  it("usa il ledger finale dopo un run SUCCESS partito con tre pending", async () => {
    const fixture = await createReadinessRun({ historicalPendingFiles: 3 });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        checks: {
          database: "ok",
          migrations: "SUCCESS",
          totalMigrations: fixture.totalExpected,
          expectedMigrationFiles: fixture.totalExpected,
          appliedMigrations: fixture.totalExpected,
          pendingMigrations: 0,
          checksumMismatches: 0,
          appliedFilesMissing: 0,
          outOfOrderMigrations: 0,
        },
      });
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it.each(["FAILED", "ABORTED", "LOCK_TIMEOUT", "RUNNING"] as const)(
    "rifiuta l'ultimo run in stato %s",
    async (status) => {
      const fixture = await createReadinessRun({ status });
      try {
        const response = await request(app).get("/api/readyz");
        expect(response.status).toBe(503);
        expect(response.body.details).toMatchObject({
          migrations: status,
          pendingMigrations: 0,
          checksumMismatches: 0,
          appliedFilesMissing: 0,
          outOfOrderMigrations: 0,
        });
      } finally {
        await deleteReadinessRun(fixture.runId);
      }
    },
  );

  it("rifiuta migration realmente pendenti anche se il run dichiara zero pending", async () => {
    const fixture = await createReadinessRun({
      extraExpected: [
        {
          filename: "99991231_readyz_pending.sql",
          checksumSha256: "0".repeat(64),
        },
      ],
    });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(503);
      expect(response.body.details).toMatchObject({
        pendingMigrations: 1,
        outOfOrderMigrations: 0,
      });
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it("rifiuta checksum non coerenti con il ledger", async () => {
    const ledger = await pool.query<{ filename: string }>(`
      SELECT filename FROM app_meta.schema_migrations ORDER BY filename LIMIT 1
    `);
    const fixture = await createReadinessRun({
      checksumMismatchFilename: ledger.rows[0].filename,
    });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(503);
      expect(response.body.details.checksumMismatches).toBe(1);
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it("rifiuta file applicati non più presenti nell'insieme atteso", async () => {
    const ledger = await pool.query<{ filename: string }>(`
      SELECT filename FROM app_meta.schema_migrations ORDER BY filename LIMIT 1
    `);
    const fixture = await createReadinessRun({
      omitFilename: ledger.rows[0].filename,
    });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(503);
      expect(response.body.details.appliedFilesMissing).toBe(1);
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it("rifiuta migration pendenti fuori ordine", async () => {
    const fixture = await createReadinessRun({
      extraExpected: [
        {
          filename: "00000000_readyz_out_of_order.sql",
          checksumSha256: "0".repeat(64),
        },
      ],
    });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(503);
      expect(response.body.details).toMatchObject({
        pendingMigrations: 1,
        outOfOrderMigrations: 1,
      });
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it("rifiuta un totale dichiarato incoerente con i file attesi", async () => {
    const fixture = await createReadinessRun({ totalFilesDelta: 1 });
    try {
      const response = await request(app).get("/api/readyz");
      expect(response.status).toBe(503);
      expect(response.body.details).toMatchObject({
        totalMigrations: fixture.totalExpected + 1,
        expectedMigrationFiles: fixture.totalExpected,
      });
    } finally {
      await deleteReadinessRun(fixture.runId);
    }
  });

  it("aggiunge l'envelope compatibile agli errori esistenti", async () => {
    const response = await request(app)
      .get("/api/consegne")
      .set("X-Correlation-Id", "review-error-456");
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: expect.any(String),
      code: "CONSEGNE_UNAUTHENTICATED",
      message: expect.any(String),
      correlationId: "review-error-456",
      details: null,
    });
  });
});
