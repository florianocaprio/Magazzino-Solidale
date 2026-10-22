import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  utentiTable,
  passwordResetTokensTable,
  systemLogsTable,
  userSessionsTable,
} from "@workspace/db";
import app from "../src/app";

const users: number[] = [];
const password = "Profilo-Test-1234";
async function account() {
  const username = `profile_${randomUUID()}`;
  const [user] = await db
    .insert(utentiTable)
    .values({
      username,
      nome: "Profilo",
      email: `${username}@example.org`,
      passwordHash: await bcrypt.hash(password, 10),
      attivo: true,
      mustChangePassword: false,
      emailDaAggiornare: false,
      emailVerifiedAt: new Date(),
    })
    .returning();
  users.push(user.id);
  return user;
}
async function login(user: Awaited<ReturnType<typeof account>>) {
  const agent = request.agent(app);
  expect(
    (
      await agent
        .post("/api/auth/login")
        .send({ username: user.username, password })
    ).status,
  ).toBe(200);
  return agent;
}
async function token(userId: number) {
  const [row] = await db
    .insert(passwordResetTokensTable)
    .values({
      utenteId: userId,
      tokenHash: randomUUID(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return row;
}
afterEach(async () => {
  if (!users.length) return;
  await db
    .delete(systemLogsTable)
    .where(
      or(
        inArray(systemLogsTable.actorUserId, users),
        inArray(systemLogsTable.targetUserId, users),
      ),
    );
  await db.delete(userSessionsTable).where(
    sql`${userSessionsTable.sess}->>'userId' IN (${sql.join(
      users.map((id) => sql`${String(id)}`),
      sql`, `,
    )})`,
  );
  await db
    .delete(passwordResetTokensTable)
    .where(inArray(passwordResetTokensTable.utenteId, users));
  await db.delete(utentiTable).where(inArray(utentiTable.id, users.splice(0)));
});
afterAll(async () => {
  await pool.end();
});

describe("Profilo personale con login e sessioni reali", () => {
  it("nega la modifica senza autenticazione", async () => {
    expect(
      (
        await request(app)
          .patch("/api/auth/profile")
          .send({ email: "test@example.org" })
      ).status,
    ).toBe(401);
  });
  it("consente al non amministratore anche senza Area di aggiornare solo la propria email", async () => {
    const user = await account(),
      other = await account();
    const agent = await login(user);
    const [before] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, user.id));
    const email = `updated_${randomUUID()}@example.org`;
    expect(
      (
        await agent
          .patch("/api/auth/profile")
          .send({ email: ` ${email.toUpperCase()} ` })
      ).status,
    ).toBe(204);
    const [after] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, user.id));
    expect(after).toEqual({
      ...before,
      email,
      emailDaAggiornare: false,
      emailVerifiedAt: null,
    });
    expect((await agent.get("/api/auth/me")).body.email).toBe(email);
    expect(
      (
        await db.select().from(utentiTable).where(eq(utentiTable.id, other.id))
      )[0],
    ).toEqual(other);
    const audit = await db
      .select()
      .from(systemLogsTable)
      .where(eq(systemLogsTable.targetUserId, user.id));
    expect(
      audit.filter((row) => row.evento === "USER_EMAIL_CHANGED"),
    ).toHaveLength(1);
  });
  it.each([
    "id",
    "ruoloId",
    "isSuperAdmin",
    "attivo",
    "username",
    "passwordHash",
  ])("rifiuta il campo estraneo %s senza cambiare l'account", async (key) => {
    const user = await account(),
      agent = await login(user);
    expect(
      (
        await agent
          .patch("/api/auth/profile")
          .send({ email: "valid@example.org", [key]: 1 })
      ).status,
    ).toBe(400);
    const me = await agent.get("/api/auth/me");
    expect(me.body.email).toBe(user.email);
    expect(me.body.isAdmin).toBe(false);
    expect(me.body.isSuperAdmin).toBe(false);
  });
  it.each([
    "",
    "invalid",
    "not an@email.org",
    "a".repeat(256) + "@example.org",
  ])("rifiuta un'email non valida senza scritture", async (email) => {
    const user = await account(),
      agent = await login(user);
    expect(
      (await agent.patch("/api/auth/profile").send({ email })).status,
    ).toBe(400);
    expect((await agent.get("/api/auth/me")).body.email).toBe(user.email);
  });
  it("email duplicata: annulla anche l'invalidazione dei link di recupero", async () => {
    const user = await account(),
      other = await account(),
      link = await token(user.id);
    const agent = await login(user);
    expect(
      (await agent.patch("/api/auth/profile").send({ email: other.email }))
        .status,
    ).toBe(409);
    expect((await agent.get("/api/auth/me")).body.email).toBe(user.email);
    expect(
      (
        await db
          .select()
          .from(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.id, link.id))
      )[0].invalidatedAt,
    ).toBeNull();
  });
  it("il cambio email invalida i vecchi link; salvare la stessa email non invalida quelli nuovi", async () => {
    const user = await account(),
      old = await token(user.id),
      agent = await login(user);
    const email = `new_${randomUUID()}@example.org`;
    expect(
      (await agent.patch("/api/auth/profile").send({ email })).status,
    ).toBe(204);
    expect(
      (
        await db
          .select()
          .from(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.id, old.id))
      )[0].invalidatedAt,
    ).not.toBeNull();
    const fresh = await token(user.id);
    expect(
      (await agent.patch("/api/auth/profile").send({ email })).status,
    ).toBe(204);
    expect(
      (
        await db
          .select()
          .from(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.id, fresh.id))
      )[0].invalidatedAt,
    ).toBeNull();
  });
  it("cambio password dal profilo: conserva la sessione corrente e revoca l'altra", async () => {
    const user = await account(),
      current = await login(user),
      other = await login(user);
    const newPassword = "Profilo-Nuova-5678";
    expect(
      (await current.post("/api/auth/change-password").send({ newPassword }))
        .status,
    ).toBe(204);
    expect((await current.get("/api/auth/me")).status).toBe(200);
    expect((await other.get("/api/auth/me")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ username: user.username, password })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ username: user.username, password: newPassword })
      ).status,
    ).toBe(200);
  });
});
