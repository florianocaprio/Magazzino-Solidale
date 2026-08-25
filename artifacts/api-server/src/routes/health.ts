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
      SELECT status, pending_files
      FROM app_meta.schema_migration_runs
      ORDER BY id DESC
      LIMIT 1
    `);
    const latest = result.rows[0] as { status?: string; pending_files?: number } | undefined;
    const migrationsReady = latest != null
      && ["SUCCESS", "VERIFY_ONLY"].includes(latest.status ?? "")
      && Number(latest.pending_files) === 0;
    if (!migrationsReady) {
      res.status(503).json({
        error: "Servizio non pronto: stato migration non valido",
        code: "READINESS_MIGRATIONS_PENDING",
        details: { migrations: latest?.status ?? "MISSING", pending: Number(latest?.pending_files ?? -1) },
      });
      return;
    }
    res.json({
      status: "ok",
      checks: {
        database: "ok",
        migrations: latest.status,
        pendingMigrations: Number(latest.pending_files),
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
