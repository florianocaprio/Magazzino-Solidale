import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

router.get("/readyz", async (req, res) => {
  try {
    const result = await db.execute(sql`
      WITH latest_run AS (
        SELECT id, status, total_files
        FROM app_meta.schema_migration_runs
        ORDER BY id DESC
        LIMIT 1
      ),
      expected AS (
        SELECT item.filename, item.checksum_sha256
        FROM app_meta.schema_migration_run_items item
        INNER JOIN latest_run latest ON latest.id = item.run_id
      ),
      ledger AS (
        SELECT filename, checksum_sha256
        FROM app_meta.schema_migrations
      )
      SELECT
        latest.status,
        latest.total_files,
        (SELECT count(*)::int FROM expected) AS expected_files,
        (SELECT count(*)::int FROM ledger) AS applied_files,
        (
          SELECT count(*)::int
          FROM expected
          LEFT JOIN ledger USING (filename)
          WHERE ledger.filename IS NULL
        ) AS pending_files,
        (
          SELECT count(*)::int
          FROM expected
          INNER JOIN ledger USING (filename)
          WHERE expected.checksum_sha256 <> ledger.checksum_sha256
        ) AS checksum_mismatches,
        (
          SELECT count(*)::int
          FROM ledger
          LEFT JOIN expected USING (filename)
          WHERE expected.filename IS NULL
        ) AS applied_files_missing,
        (
          SELECT count(*)::int
          FROM expected
          LEFT JOIN ledger USING (filename)
          WHERE ledger.filename IS NULL
            AND expected.filename < (SELECT max(filename) FROM ledger)
        ) AS out_of_order_files
      FROM latest_run latest
    `);
    const latest = result.rows[0] as
      | {
          status?: string;
          total_files?: number;
          expected_files?: number;
          applied_files?: number;
          pending_files?: number;
          checksum_mismatches?: number;
          applied_files_missing?: number;
          out_of_order_files?: number;
        }
      | undefined;
    const migrationState = {
      migrations: latest?.status ?? "MISSING",
      totalMigrations: Number(latest?.total_files ?? -1),
      expectedMigrationFiles: Number(latest?.expected_files ?? -1),
      appliedMigrations: Number(latest?.applied_files ?? -1),
      pendingMigrations: Number(latest?.pending_files ?? -1),
      checksumMismatches: Number(latest?.checksum_mismatches ?? -1),
      appliedFilesMissing: Number(latest?.applied_files_missing ?? -1),
      outOfOrderMigrations: Number(latest?.out_of_order_files ?? -1),
    };
    const migrationsReady =
      latest != null &&
      ["SUCCESS", "VERIFY_ONLY"].includes(migrationState.migrations) &&
      migrationState.totalMigrations ===
        migrationState.expectedMigrationFiles &&
      migrationState.appliedMigrations === migrationState.totalMigrations &&
      migrationState.pendingMigrations === 0 &&
      migrationState.checksumMismatches === 0 &&
      migrationState.appliedFilesMissing === 0 &&
      migrationState.outOfOrderMigrations === 0;
    if (!migrationsReady) {
      res.status(503).json({
        error: "Servizio non pronto: stato migration non valido",
        code: "READINESS_MIGRATIONS_PENDING",
        details: migrationState,
      });
      return;
    }
    res.json({
      status: "ok",
      checks: {
        database: "ok",
        ...migrationState,
      },
    });
  } catch (error) {
    req.log.error({ err: error }, "Readiness check failed");
    res.status(503).json({
      error: "Servizio non pronto",
      code: "READINESS_DATABASE_UNAVAILABLE",
      details: null,
    });
  }
});

export default router;
