import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import express, { type Request } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import request from "supertest";
import bcrypt from "bcryptjs";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import {
  db,
  pool,
  utentiTable,
  ruoliTable,
  userSessionsTable,
  passwordResetTokensTable,
  systemLogsTable,
  areeOperativeTable,
} from "@workspace/db";
import authRouter from "../src/routes/auth";
import utentiRouter from "../src/routes/utenti";
import {
  requireAuth,
  requireAdmin,
  requirePasswordChange,
  loadSessionUser,
} from "../src/middlewares/auth";
import { createPasswordResetLinkForUser } from "../src/lib/passwordReset";
import { logger } from "../src/lib/logger";

const PgSession = connectPgSimple(session);
const store = new PgSession({
  pool,
  tableName: "user_sessions",
  createTableIfMissing: false,
  pruneSessionInterval: false,
});
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.log = logger;
  next();
});
app.use(
  session({
    store,
    secret: "synthetic-bug01-session-secret",
    resave: false,
    saveUninitialized: false,
  }),
);
let beforeAuth: ((req: Request) => Promise<void>) | null = null;
app.use(async (req, _res, next) => {
  await beforeAuth?.(req);
  next();
});
app.use(authRouter);
app.use(requireAuth, requirePasswordChange);
app.use(utentiRouter);
app.get("/protected", (_req, res) => res.sendStatus(204));
app.get("/admin-only", requireAdmin, (_req, res) => res.sendStatus(204));

const ids: number[] = [],
  roles: number[] = [],
  areas: number[] = [];
const initial = "SyntheticInitial42";
const temporary = "SyntheticTemporary43";
const final = "SyntheticFinal44";
async function user(
  options: Partial<typeof utentiTable.$inferInsert> = {},
  admin = false,
) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [role] = await db
    .insert(ruoliTable)
    .values({ nome: `BUG01-${suffix}`, isAdmin: admin, aree: ["magazzino"] })
    .returning();
  roles.push(role.id);
  const [row] = await db
    .insert(utentiTable)
    .values({
      username: `bug01-${suffix}`,
      nome: "Synthetic",
      cognome: "User",
      ruoloId: role.id,
      passwordHash: await bcrypt.hash(initial, 4),
      attivo: true,
      ...options,
    })
    .returning();
  ids.push(row.id);
  return row;
}
async function login(row: { username: string }, password = initial) {
  const agent = request.agent(app);
  expect(
    (await agent.post("/auth/login").send({ username: row.username, password }))
      .status,
  ).toBe(200);
  return agent;
}
afterEach(async () => {
  beforeAuth = null;
  vi.restoreAllMocks();
  if (ids.length) {
    await db.delete(userSessionsTable).where(
      sql`${userSessionsTable.sess}->>'userId' IN (${sql.join(
        ids.map((id) => sql`${String(id)}`),
        sql`, `,
      )})`,
    );
    await db
      .delete(systemLogsTable)
      .where(
        or(
          inArray(systemLogsTable.actorUserId, ids),
          inArray(systemLogsTable.targetUserId, ids),
          inArray(systemLogsTable.username, ids.map(String)),
        ),
      );
    await db
      .delete(passwordResetTokensTable)
      .where(inArray(passwordResetTokensTable.utenteId, ids));
    await db.delete(utentiTable).where(inArray(utentiTable.id, ids.splice(0)));
  }
  if (roles.length)
    await db.delete(ruoliTable).where(inArray(ruoliTable.id, roles.splice(0)));
  if (areas.length)
    await db
      .delete(areeOperativeTable)
      .where(inArray(areeOperativeTable.id, areas.splice(0)));
});
afterAll(async () => {
  await store.close();
  await pool.end();
});

describe("BUG 01 — sessioni reali e azioni amministrative", () => {
  it("un reset intervenuto dopo l'autenticazione impedisce il cambio con la vecchia sessione", async () => {
    const target = await user(),
      old = await login(target);
    const replacement = await bcrypt.hash(temporary, 4);
    beforeAuth = async (req) => {
      if (req.path !== "/auth/change-password") return;
      // Model an identity already loaded by middleware when a concurrent
      // administrative reset commits, before the route reads the account.
      req.user = (await loadSessionUser(target.id))!;
      await db
        .update(utentiTable)
        .set({ passwordHash: replacement, mustChangePassword: true })
        .where(eq(utentiTable.id, target.id));
    };
    expect(
      (await old.post("/auth/change-password").send({ newPassword: final }))
        .status,
    ).toBe(401);
    const [record] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(record.passwordHash).toBe(replacement);
    expect(record.mustChangePassword).toBe(true);
  });

  it("non rimuove un utente spostato fuori ambito prima del lock", async () => {
    const inserted = await db
      .insert(areeOperativeTable)
      .values([
        { nome: `BUG01-A-${crypto.randomUUID()}` },
        { nome: `BUG01-B-${crypto.randomUUID()}` },
      ])
      .returning();
    areas.push(...inserted.map((a) => a.id));
    const operator = await login(
      await user({ areaOperativaId: inserted[0].id }, true),
    );
    const target = await user({ areaOperativaId: inserted[0].id });
    const transaction = db.transaction.bind(db);
    vi.spyOn(db, "transaction").mockImplementationOnce(
      async (...args: Parameters<typeof db.transaction>) => {
        await db
          .update(utentiTable)
          .set({ areaOperativaId: inserted[1].id })
          .where(eq(utentiTable.id, target.id));
        return transaction(...args);
      },
    );
    expect(
      (await operator.delete(`/utenti/${target.id}?removeIfUnused=true`))
        .status,
    ).toBe(409);
    const [record] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(record.attivo).toBe(true);
    expect(record.areaOperativaId).toBe(inserted[1].id);
  });
  it("non espone segreti nei log quando l'assegnazione fallisce", async () => {
    const operator = await login(await user({}, true)),
      target = await user();
    const error = vi.spyOn(logger, "error").mockImplementation(() => {});
    vi.spyOn(db, "transaction").mockRejectedValueOnce(
      new Error(`Synthetic DB failure ${temporary}`),
    );
    expect(
      (
        await operator
          .post(`/utenti/${target.id}/temporary-password`)
          .send({ newPassword: temporary })
      ).status,
    ).toBe(500);
    expect(error).toHaveBeenCalled();
    expect(JSON.stringify(error.mock.calls)).not.toContain(temporary);
    const [unchanged] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(unchanged.passwordHash).toBe(target.passwordHash);
  });
  it("assegna una password temporanea senza email, revoca sessioni/token e obbliga un cambio diverso", async () => {
    const admin = await user({}, true),
      target = await user();
    const operator = await login(admin),
      old = await login(target);
    const oldSessions = await db
      .select()
      .from(userSessionsTable)
      .where(sql`${userSessionsTable.sess}->>'userId' = ${String(target.id)}`);
    expect(oldSessions).toHaveLength(1);
    const token = await createPasswordResetLinkForUser({ utenteId: target.id });
    const reset = await operator
      .post(`/utenti/${target.id}/temporary-password`)
      .send({ newPassword: temporary });
    expect(reset.status).toBe(204);
    expect((await old.get("/protected")).status).toBe(401);
    // Simulate a delayed write by an in-flight request: the old session still fails.
    await db
      .insert(userSessionsTable)
      .values(oldSessions)
      .onConflictDoUpdate({
        target: userSessionsTable.sid,
        set: { sess: oldSessions[0].sess },
      });
    expect((await old.get("/protected")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/auth/reset-password")
          .send({ token: token.token, newPassword: final })
      ).status,
    ).toBe(400);
    const next = await login(target, temporary);
    const blocked = await next.get("/protected");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("Cambio password obbligatorio");
    expect(
      (
        await next
          .post("/auth/change-password")
          .send({ newPassword: temporary })
      ).status,
    ).toBe(400);
    expect(
      (await next.post("/auth/change-password").send({ newPassword: final }))
        .status,
    ).toBe(204);
    expect((await next.get("/protected")).status).toBe(204);
    expect((await old.get("/protected")).status).toBe(401);
    expect(
      (
        await request(app)
          .post("/auth/login")
          .send({ username: target.username, password: temporary })
      ).status,
    ).toBe(401);
    const [record] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(record.mustChangePassword).toBe(false);
    expect(await bcrypt.compare(final, record.passwordHash)).toBe(true);
    const audit = await db
      .select()
      .from(systemLogsTable)
      .where(
        and(
          eq(systemLogsTable.targetUserId, target.id),
          eq(systemLogsTable.evento, "PASSWORD_CHANGED_BY_ADMIN"),
        ),
      );
    expect(audit).toHaveLength(1);
    expect(audit[0].actorUserId).toBe(admin.id);
    for (const secret of [
      initial,
      temporary,
      final,
      token.token,
      token.tokenHash,
      record.passwordHash,
    ])
      expect(JSON.stringify(audit)).not.toContain(secret);
    expect((await next.get("/auth/me")).body).not.toHaveProperty(
      "passwordVersion",
    );
  });

  it("nega password deboli, account inattivi, non amministratori e SuperAdmin protetti", async () => {
    const admin = await user({}, true),
      target = await user();
    const operator = await login(admin),
      unprivileged = await login(target);
    for (const newPassword of ["short1", "onlyletters", "12345678"])
      expect(
        (
          await operator
            .post(`/utenti/${target.id}/temporary-password`)
            .send({ newPassword })
        ).status,
      ).toBe(400);
    expect(
      (
        await unprivileged
          .post(`/utenti/${admin.id}/temporary-password`)
          .send({ newPassword: temporary })
      ).status,
    ).toBe(403);
    const superAdmin = await user({ isSuperAdmin: true }, true);
    expect(
      (
        await operator
          .post(`/utenti/${superAdmin.id}/temporary-password`)
          .send({ newPassword: temporary })
      ).status,
    ).toBe(403);
    await db
      .update(utentiTable)
      .set({ attivo: false })
      .where(eq(utentiTable.id, target.id));
    expect(
      (
        await operator
          .post(`/utenti/${target.id}/temporary-password`)
          .send({ newPassword: temporary })
      ).status,
    ).toBe(400);
    const [unchanged] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(unchanged.passwordHash).toBe(target.passwordHash);
  });

  it("applica Area, Centro e Zona al reset e alla rimozione", async () => {
    const [area] = await db
      .insert(areeOperativeTable)
      .values({ nome: `BUG01-${crypto.randomUUID()}` })
      .returning();
    areas.push(area.id);
    const admin = await user({ areaOperativaId: area.id }, true),
      outside = await user();
    const operator = await login(admin);
    expect(
      (
        await operator
          .post(`/utenti/${outside.id}/temporary-password`)
          .send({ newPassword: temporary })
      ).status,
    ).toBe(403);
    expect(
      (await operator.delete(`/utenti/${outside.id}?removeIfUnused=true`))
        .status,
    ).toBe(403);
  });

  it("mantiene il cambio obbligatorio degli utenti appena creati", async () => {
    const admin = await user({}, true),
      operator = await login(admin);
    const suffix = crypto.randomUUID().slice(0, 8);
    const response = await operator.post("/utenti").send({
      username: `new-${suffix}`,
      email: `new-${suffix}@example.org`,
      nome: "Synthetic",
      cognome: "New",
      password: initial,
    });
    expect(response.status).toBe(201);
    ids.push(response.body.id);
    const newcomer = await login(response.body);
    expect((await newcomer.get("/protected")).status).toBe(403);
    expect(
      (
        await newcomer
          .post("/auth/change-password")
          .send({ newPassword: final })
      ).status,
    ).toBe(204);
    expect((await newcomer.get("/protected")).status).toBe(204);
  });

  it("rilegge i privilegi a ogni richiesta e la riattivazione non recupera le sessioni revocate", async () => {
    const admin = await user({}, true),
      target = await user({}, true);
    const operator = await login(admin),
      targetSession = await login(target);
    expect((await targetSession.get("/admin-only")).status).toBe(204);
    const reader = await user();
    expect(
      (
        await operator
          .patch(`/utenti/${target.id}`)
          .send({ ruoloId: reader.ruoloId })
      ).status,
    ).toBe(200);
    expect((await targetSession.get("/admin-only")).status).toBe(403);
    expect(
      (await operator.patch(`/utenti/${target.id}`).send({ attivo: false }))
        .status,
    ).toBe(200);
    expect((await targetSession.get("/protected")).status).toBe(401);
    expect(
      (await operator.patch(`/utenti/${target.id}`).send({ attivo: true }))
        .status,
    ).toBe(200);
    expect((await targetSession.get("/protected")).status).toBe(401);
    expect(
      (await operator.patch(`/utenti/${admin.id}`).send({ attivo: false }))
        .status,
    ).toBe(400);
    expect(
      (await operator.delete(`/utenti/${admin.id}?removeIfUnused=true`)).status,
    ).toBe(400);
    expect(
      (
        await operator
          .patch(`/utenti/${admin.id}`)
          .send({ ruoloId: reader.ruoloId })
      ).status,
    ).toBe(403);
  });

  it("Elimina rimuove definitivamente solo un record mai usato senza dipendenze", async () => {
    const operator = await login(await user({}, true)),
      target = await user();
    expect(
      (await operator.delete(`/utenti/${target.id}?removeIfUnused=true`))
        .status,
    ).toBe(204);
    expect(
      await db.select().from(utentiTable).where(eq(utentiTable.id, target.id)),
    ).toHaveLength(0);
    const [audit] = await db
      .select()
      .from(systemLogsTable)
      .where(
        and(
          eq(systemLogsTable.username, target.username),
          eq(systemLogsTable.evento, "USER_DELETED"),
        ),
      );
    expect(audit.targetUserId).toBeNull();
    expect(audit.details).toMatchObject({
      removedUserId: target.id,
      preservedForHistory: false,
    });
    await db.delete(systemLogsTable).where(eq(systemLogsTable.id, audit.id));
  });

  it("preserva utenti utilizzati, record dimostrativi collegati e dipendenze SET NULL/CASCADE", async () => {
    const operator = await login(await user({}, true));
    for (const kind of ["access", "audit", "token"] as const) {
      const target = await user({
        username: `demo-bug01-${kind}-${crypto.randomUUID().slice(0, 8)}`,
      });
      if (kind === "access")
        await db
          .update(utentiTable)
          .set({ ultimoAccesso: new Date() })
          .where(eq(utentiTable.id, target.id));
      if (kind === "audit")
        await db.insert(systemLogsTable).values({
          evento: "USER_CREATED",
          esito: "SUCCESS",
          targetUserId: target.id,
        });
      if (kind === "token")
        await createPasswordResetLinkForUser({ utenteId: target.id });
      expect(
        (await operator.delete(`/utenti/${target.id}?removeIfUnused=true`))
          .status,
      ).toBe(204);
      const [preserved] = await db
        .select()
        .from(utentiTable)
        .where(eq(utentiTable.id, target.id));
      expect(preserved.attivo).toBe(false);
      if (kind === "audit")
        expect(
          await db
            .select()
            .from(systemLogsTable)
            .where(
              and(
                eq(systemLogsTable.targetUserId, target.id),
                eq(systemLogsTable.evento, "USER_CREATED"),
              ),
            ),
        ).toHaveLength(1);
      if (kind === "token") {
        const [token] = await db
          .select()
          .from(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.utenteId, target.id));
        expect(token.invalidatedAt).not.toBeNull();
      }
    }
  });

  it("conserva il DELETE storico senza parametro", async () => {
    const operator = await login(await user({}, true)),
      target = await user();
    expect((await operator.delete(`/utenti/${target.id}`)).status).toBe(204);
    const [preserved] = await db
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, target.id));
    expect(preserved.attivo).toBe(false);
  });
});
