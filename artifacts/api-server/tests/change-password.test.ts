import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { db, utentiTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import authRouter from "../src/routes/auth";

/**
 * The password change flow was simplified: the endpoint no longer requires the
 * current password. Any authenticated session may set a new password as long as
 * it is at least 8 characters (the confirmation match is enforced client-side).
 */

const createdUserIds: number[] = [];

/** Mounts the auth router behind a stub session for the given user. */
function makeApp(sessionUserId: number): Express {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = {
      userId: sessionUserId,
    };
    next();
  });
  a.use(authRouter);
  return a;
}

async function createUser(mustChange: boolean): Promise<number> {
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: `cp_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      passwordHash: await bcrypt.hash("vecchiaPassword1", 10),
      nome: "Test",
      cognome: "CambioPwd",
      attivo: true,
      mustChangePassword: mustChange,
    })
    .returning({ id: utentiTable.id });
  createdUserIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  // nothing global to seed
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(utentiTable).where(inArray(utentiTable.id, createdUserIds));
  }
});

describe("POST /auth/change-password", () => {
  it("accepts a new password without the current one and clears mustChangePassword", async () => {
    const userId = await createUser(true);
    const app = makeApp(userId);

    const res = await request(app)
      .post("/auth/change-password")
      .send({ newPassword: "nuovaPassword1" });

    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, userId));
    expect(row.mustChangePassword).toBe(false);
    expect(await bcrypt.compare("nuovaPassword1", row.passwordHash)).toBe(true);
  });

  it("rejects a new password shorter than 8 characters", async () => {
    const userId = await createUser(false);
    const app = makeApp(userId);

    const res = await request(app)
      .post("/auth/change-password")
      .send({ newPassword: "corta1" });

    expect(res.status).toBe(400);

    // Password must remain unchanged.
    const [row] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, userId));
    expect(await bcrypt.compare("vecchiaPassword1", row.passwordHash)).toBe(
      true,
    );
  });

  it("ignores a currentPassword field if the client still sends one", async () => {
    const userId = await createUser(false);
    const app = makeApp(userId);

    const res = await request(app)
      .post("/auth/change-password")
      .send({ currentPassword: "qualsiasi", newPassword: "altraPassword9" });

    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, userId));
    expect(await bcrypt.compare("altraPassword9", row.passwordHash)).toBe(true);
  });
});
