/* @vitest-environment node */

import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";
import { pool } from "@workspace/db";
import app from "../src/app";

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
