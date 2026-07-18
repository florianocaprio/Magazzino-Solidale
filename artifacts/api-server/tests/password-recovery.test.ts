import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";
import bcrypt from "bcryptjs";
import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { db, passwordResetTokensTable, pool, ruoliTable, systemLogsTable, utentiTable } from "@workspace/db";
import authRouter from "../src/routes/auth";
import utentiRouter from "../src/routes/utenti";
import { ADMIN_RESET_EMAIL_INVALID_MESSAGE, ADMIN_RESET_LINK_SENT_MESSAGE, clearForgotPasswordRateLimitsForTests, createPasswordResetLinkForUser, FORGOT_PASSWORD_RESPONSE_MESSAGE, RESET_PASSWORD_INVALID_TOKEN_MESSAGE, RESET_PASSWORD_SUCCESS_MESSAGE, RESET_PASSWORD_WEAK_PASSWORD_MESSAGE } from "../src/lib/passwordReset";

const ORIGINAL_ENV = { ...process.env };
const TEST_EMAIL_PREFIX = "pwrec_";
const createdUserIds: number[] = [];
const createdRoleIds: number[] = [];

function rnd(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function publicAuthApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
}

function appAs(userId: number): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: number } }).session = { userId };
    next();
  });
  app.use(utentiRouter);
  return app;
}

async function createRole(isAdmin: boolean): Promise<number> {
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `Password recovery ${rnd()}`, isAdmin, aree: [] })
    .returning({ id: ruoliTable.id });
  createdRoleIds.push(role.id);
  return role.id;
}

async function createUser(
  opts: {
    email?: string | null;
    emailDaAggiornare?: boolean;
    attivo?: boolean;
    ruoloId?: number | null;
    isSuperAdmin?: boolean;
    password?: string;
  } = {},
): Promise<{ id: number; username: string; email: string | null }> {
  const suffix = rnd();
  const email = opts.email === undefined ? `${TEST_EMAIL_PREFIX}${suffix}@example.org` : opts.email;
  const [user] = await db
    .insert(utentiTable)
    .values({
      username: `${TEST_EMAIL_PREFIX}${suffix}`,
      email,
      emailDaAggiornare: opts.emailDaAggiornare ?? email == null,
      passwordHash: await bcrypt.hash(opts.password ?? "VecchiaPassword1", 10),
      nome: "Password",
      cognome: "Recovery",
      ruoloId: opts.ruoloId ?? null,
      attivo: opts.attivo ?? true,
      isSuperAdmin: opts.isSuperAdmin ?? false,
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    })
    .returning({
      id: utentiTable.id,
      username: utentiTable.username,
      email: utentiTable.email,
    });
  createdUserIds.push(user.id);
  return user;
}

async function tokensForUser(userId: number) {
  return db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.utenteId, userId)).orderBy(asc(passwordResetTokensTable.id));
}

async function cleanup(): Promise<void> {
  await db.delete(systemLogsTable).where(ilike(systemLogsTable.userEmail, `${TEST_EMAIL_PREFIX}%@example.org`));
  if (createdUserIds.length > 0) {
    await db.delete(systemLogsTable).where(or(inArray(systemLogsTable.actorUserId, createdUserIds), inArray(systemLogsTable.targetUserId, createdUserIds)));
    await db.delete(passwordResetTokensTable).where(inArray(passwordResetTokensTable.utenteId, createdUserIds));
    await db.delete(utentiTable).where(inArray(utentiTable.id, createdUserIds.splice(0)));
  }
  if (createdRoleIds.length > 0) {
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, createdRoleIds.splice(0)));
  }
}

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.NODE_ENV = "test";
  process.env.APP_BASE_URL = "https://magazzino.example.org";
  delete process.env.MAIL_PROVIDER;
  delete process.env.MAIL_HOST;
  delete process.env.MAIL_PORT;
  delete process.env.MAIL_SECURE;
  delete process.env.MAIL_USER;
  delete process.env.MAIL_PASSWORD;
  delete process.env.MAIL_FROM;
  delete process.env.MAIL_REPLY_TO;
  clearForgotPasswordRateLimitsForTests();
  await cleanup();
});

afterEach(async () => {
  await cleanup();
  clearForgotPasswordRateLimitsForTests();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(async () => {
  await pool.end();
});

describe("password recovery", () => {
  it("forgot password risponde neutro se email inesistente", async () => {
    const beforeRows = await db.select({ id: passwordResetTokensTable.id }).from(passwordResetTokensTable);
    const res = await request(publicAuthApp())
      .post("/auth/forgot-password")
      .send({ email: `${TEST_EMAIL_PREFIX}missing@example.org` });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(FORGOT_PASSWORD_RESPONSE_MESSAGE);

    const afterRows = await db.select({ id: passwordResetTokensTable.id }).from(passwordResetTokensTable);
    expect(afterRows).toHaveLength(beforeRows.length);
  });

  it("forgot password risponde neutro se utente disattivato", async () => {
    const user = await createUser({ attivo: false });

    const res = await request(publicAuthApp()).post("/auth/forgot-password").send({ email: user.email });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(FORGOT_PASSWORD_RESPONSE_MESSAGE);
    expect(await tokensForUser(user.id)).toHaveLength(0);
  });

  it("forgot password genera un token hashato per utente valido", async () => {
    const user = await createUser({
      email: `${TEST_EMAIL_PREFIX}valid_${rnd()}@example.org`,
    });

    const res = await request(publicAuthApp())
      .post("/auth/forgot-password")
      .send({ email: `  ${user.email?.toUpperCase()}  ` });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(FORGOT_PASSWORD_RESPONSE_MESSAGE);
    const tokens = await tokensForUser(user.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(tokens[0].usedAt).toBeNull();
    expect(tokens[0].invalidatedAt).toBeNull();
    expect(tokens[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("non salva il token in chiaro", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });
    const [tokenRow] = await tokensForUser(user.id);

    expect(tokenRow.tokenHash).toBe(reset.tokenHash);
    expect(tokenRow.tokenHash).not.toBe(reset.token);
    expect(Object.prototype.hasOwnProperty.call(tokenRow as Record<string, unknown>, "token")).toBe(false);
  });

  it("un secondo forgot invalida i token precedenti", async () => {
    const user = await createUser();

    await request(publicAuthApp()).post("/auth/forgot-password").send({ email: user.email });
    await request(publicAuthApp()).post("/auth/forgot-password").send({ email: user.email });

    const tokens = await tokensForUser(user.id);
    expect(tokens).toHaveLength(2);
    expect(tokens[0].invalidatedAt).not.toBeNull();
    expect(tokens[1].invalidatedAt).toBeNull();
    expect(tokens[0].tokenHash).not.toBe(tokens[1].tokenHash);
  });

  it("reset password con token valido aggiorna password, marca il token usato e registra log", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });

    const res = await request(publicAuthApp()).post("/auth/reset-password").send({
      token: reset.token,
      newPassword: "NuovaPassword1",
      confirmPassword: "NuovaPassword1",
    });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(RESET_PASSWORD_SUCCESS_MESSAGE);

    const [updatedUser] = await db.select().from(utentiTable).where(eq(utentiTable.id, user.id));
    expect(await bcrypt.compare("NuovaPassword1", updatedUser.passwordHash)).toBe(true);
    expect(updatedUser.mustChangePassword).toBe(false);
    expect(updatedUser.lastPasswordChangeAt).not.toBeNull();

    const [tokenRow] = await tokensForUser(user.id);
    expect(tokenRow.usedAt).not.toBeNull();

    const [logRow] = await db
      .select()
      .from(systemLogsTable)
      .where(and(eq(systemLogsTable.targetUserId, user.id), eq(systemLogsTable.evento, "PASSWORD_RESET_COMPLETED"), eq(systemLogsTable.esito, "SUCCESS")));
    expect(logRow).toBeTruthy();
  });

  it("reset password con token già usato fallisce", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });

    await request(publicAuthApp()).post("/auth/reset-password").send({ token: reset.token, newPassword: "NuovaPassword1" });
    const reused = await request(publicAuthApp()).post("/auth/reset-password").send({ token: reset.token, newPassword: "AltraPassword1" });

    expect(reused.status).toBe(400);
    expect(reused.body.error).toBe(RESET_PASSWORD_INVALID_TOKEN_MESSAGE);
  });

  it("reset password con token scaduto fallisce", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });
    await db
      .update(passwordResetTokensTable)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(passwordResetTokensTable.tokenHash, reset.tokenHash));

    const res = await request(publicAuthApp()).post("/auth/reset-password").send({ token: reset.token, newPassword: "NuovaPassword1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RESET_PASSWORD_INVALID_TOKEN_MESSAGE);
    const [tokenRow] = await tokensForUser(user.id);
    expect(tokenRow.usedAt).toBeNull();
  });

  it("reset password con token invalidato fallisce", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });
    await db.update(passwordResetTokensTable).set({ invalidatedAt: new Date() }).where(eq(passwordResetTokensTable.tokenHash, reset.tokenHash));

    const res = await request(publicAuthApp()).post("/auth/reset-password").send({ token: reset.token, newPassword: "NuovaPassword1" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RESET_PASSWORD_INVALID_TOKEN_MESSAGE);
  });

  it("reset password con password debole fallisce", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });

    const res = await request(publicAuthApp()).post("/auth/reset-password").send({ token: reset.token, newPassword: "solotesto" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RESET_PASSWORD_WEAK_PASSWORD_MESSAGE);
    const [tokenRow] = await tokensForUser(user.id);
    expect(tokenRow.usedAt).toBeNull();
  });

  it("reset password con conferma diversa fallisce", async () => {
    const user = await createUser();
    const reset = await createPasswordResetLinkForUser({ utenteId: user.id });

    const res = await request(publicAuthApp()).post("/auth/reset-password").send({
      token: reset.token,
      newPassword: "NuovaPassword1",
      confirmPassword: "DiversaPassword1",
    });

    expect(res.status).toBe(400);
    const [tokenRow] = await tokensForUser(user.id);
    expect(tokenRow.usedAt).toBeNull();
  });

  it("admin può inviare link reset a utente con email valida", async () => {
    const adminRoleId = await createRole(true);
    const admin = await createUser({ ruoloId: adminRoleId });
    const target = await createUser();

    const res = await request(appAs(admin.id)).post(`/utenti/${target.id}/reset-password`).send({ newPassword: "CampoIgnorato1" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe(ADMIN_RESET_LINK_SENT_MESSAGE);
    const tokens = await tokensForUser(target.id);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("admin riceve errore se utente senza email valida", async () => {
    const adminRoleId = await createRole(true);
    const admin = await createUser({ ruoloId: adminRoleId });
    const target = await createUser({ email: null, emailDaAggiornare: true });

    const res = await request(appAs(admin.id)).post(`/utenti/${target.id}/reset-password`);

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(ADMIN_RESET_EMAIL_INVALID_MESSAGE);
    expect(await tokensForUser(target.id)).toHaveLength(0);
  });

  it("utente non admin non può usare azione admin", async () => {
    const roleId = await createRole(false);
    const operator = await createUser({ ruoloId: roleId });
    const target = await createUser();

    const res = await request(appAs(operator.id)).post(`/utenti/${target.id}/reset-password`);

    expect(res.status).toBe(403);
    expect(await tokensForUser(target.id)).toHaveLength(0);
  });
});
