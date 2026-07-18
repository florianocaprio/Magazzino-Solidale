import { Router, type IRouter } from "express";
import { and, eq, gt, isNull, ne } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, passwordResetTokensTable, utentiTable } from "@workspace/db";
import { LoginUserBody, ChangePasswordBody, ForgotPasswordBody, ResetPasswordBody } from "@workspace/api-zod";
import { loadSessionUser, requireAuth, type SessionUser } from "../middlewares/auth";
import { isBootstrapMode } from "../lib/bootstrap";
import { logSystemEvent, systemLogMetaFromRequest } from "../lib/systemLog";
import { isValidUserEmail, normalizeEmail } from "../lib/userEmail";
import { sendPasswordChangedEmail, sendPasswordResetEmail } from "../lib/emailService";
import { checkForgotPasswordRateLimit, createPasswordResetLinkForUser, FORGOT_PASSWORD_RESPONSE_MESSAGE, hashPasswordResetToken, invalidateActivePasswordResetTokens, RESET_PASSWORD_CONFIRM_MISMATCH_MESSAGE, RESET_PASSWORD_INVALID_TOKEN_MESSAGE, RESET_PASSWORD_SUCCESS_MESSAGE, validatePasswordForReset } from "../lib/passwordReset";

const router: IRouter = Router();

const SESSION_COOKIE = "magazzino.sid";

// Public: tells the frontend whether the system still needs first-run setup
// (no administrator exists yet). When true, the app shows the setup screen
// instead of the login screen.
router.get("/auth/bootstrap-status", async (_req, res): Promise<void> => {
  res.json({ bootstrap: await isBootstrapMode() });
});

router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const meta = systemLogMetaFromRequest(req);
  const normalizedEmail = normalizeEmail(parsed.data.email);
  const rateLimit = checkForgotPasswordRateLimit({
    email: normalizedEmail,
    ipAddress: meta.ipAddress,
  });

  if (!rateLimit.allowed) {
    await logSystemEvent({
      evento: "PASSWORD_RESET_REQUESTED",
      esito: "INFO",
      userEmail: normalizedEmail || null,
      ...meta,
      details: { source: "self_service", outcome: "rate_limited" },
    });
    res.json({ message: FORGOT_PASSWORD_RESPONSE_MESSAGE });
    return;
  }

  if (!isValidUserEmail(normalizedEmail)) {
    await logSystemEvent({
      evento: "PASSWORD_RESET_REQUESTED",
      esito: "INFO",
      userEmail: normalizedEmail || null,
      ...meta,
      details: { source: "self_service", outcome: "not_eligible" },
    });
    res.json({ message: FORGOT_PASSWORD_RESPONSE_MESSAGE });
    return;
  }

  const [row] = await db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      email: utentiTable.email,
      emailDaAggiornare: utentiTable.emailDaAggiornare,
      nome: utentiTable.nome,
      attivo: utentiTable.attivo,
    })
    .from(utentiTable)
    .where(eq(utentiTable.email, normalizedEmail));

  if (!row || !row.attivo || row.emailDaAggiornare || !row.email || !isValidUserEmail(row.email)) {
    await logSystemEvent({
      evento: "PASSWORD_RESET_REQUESTED",
      esito: "INFO",
      userEmail: normalizedEmail,
      ...meta,
      details: { source: "self_service", outcome: "not_eligible" },
    });
    res.json({ message: FORGOT_PASSWORD_RESPONSE_MESSAGE });
    return;
  }

  await logSystemEvent({
    evento: "PASSWORD_RESET_REQUESTED",
    esito: "SUCCESS",
    targetUserId: row.id,
    userEmail: row.email,
    username: row.username,
    ...meta,
    details: { source: "self_service" },
  });

  let resetLink: Awaited<ReturnType<typeof createPasswordResetLinkForUser>>;
  try {
    resetLink = await createPasswordResetLinkForUser({
      utenteId: row.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  } catch (error) {
    req.log.error({ err: error, userId: row.id }, "Password reset token creation failed");
    await logSystemEvent({
      evento: "PASSWORD_RESET_EMAIL_SENT",
      esito: "FAILED",
      targetUserId: row.id,
      userEmail: row.email,
      username: row.username,
      ...meta,
      details: { source: "self_service", reason: "token_creation_failed" },
    });
    res.json({ message: FORGOT_PASSWORD_RESPONSE_MESSAGE });
    return;
  }

  try {
    const result = await sendPasswordResetEmail({
      to: row.email,
      nome: row.nome,
      username: row.username,
      resetUrl: resetLink.resetUrl,
      expiresInMinutes: resetLink.expiresInMinutes,
    });
    await logSystemEvent({
      evento: "PASSWORD_RESET_EMAIL_SENT",
      esito: result.sent ? "SUCCESS" : "INFO",
      targetUserId: row.id,
      userEmail: row.email,
      username: row.username,
      ...meta,
      details: { source: "self_service", mode: result.mode },
    });
  } catch (error) {
    req.log.error({ err: error, userId: row.id }, "Password reset email send failed");
    await invalidateActivePasswordResetTokens(row.id);
    await logSystemEvent({
      evento: "PASSWORD_RESET_EMAIL_SENT",
      esito: "FAILED",
      targetUserId: row.id,
      userEmail: row.email,
      username: row.username,
      ...meta,
      details: { source: "self_service", reason: "send_failed" },
    });
  }

  res.json({ message: FORGOT_PASSWORD_RESPONSE_MESSAGE });
});

router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, newPassword, confirmPassword } = parsed.data;
  const meta = systemLogMetaFromRequest(req);
  if (confirmPassword != null && confirmPassword !== newPassword) {
    res.status(400).json({ error: RESET_PASSWORD_CONFIRM_MISMATCH_MESSAGE });
    return;
  }
  const passwordError = validatePasswordForReset(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const tokenHash = hashPasswordResetToken(token);
  const now = new Date();
  const [tokenRow] = await db.select().from(passwordResetTokensTable).where(eq(passwordResetTokensTable.tokenHash, tokenHash));

  if (!tokenRow || tokenRow.usedAt || tokenRow.invalidatedAt || tokenRow.expiresAt <= now) {
    await logSystemEvent({
      evento: "PASSWORD_RESET_COMPLETED",
      esito: "FAILED",
      ...meta,
      details: { reason: "invalid_token" },
    });
    res.status(400).json({ error: RESET_PASSWORD_INVALID_TOKEN_MESSAGE });
    return;
  }

  const [user] = await db
    .select({
      id: utentiTable.id,
      username: utentiTable.username,
      email: utentiTable.email,
      nome: utentiTable.nome,
      attivo: utentiTable.attivo,
    })
    .from(utentiTable)
    .where(eq(utentiTable.id, tokenRow.utenteId));

  if (!user || !user.attivo) {
    await logSystemEvent({
      evento: "PASSWORD_RESET_COMPLETED",
      esito: "FAILED",
      targetUserId: tokenRow.utenteId,
      userEmail: user?.email ?? null,
      username: user?.username ?? null,
      ...meta,
      details: { reason: "user_not_active" },
    });
    res.status(400).json({ error: RESET_PASSWORD_INVALID_TOKEN_MESSAGE });
    return;
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  try {
    await db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(passwordResetTokensTable)
        .set({ usedAt: now })
        .where(and(eq(passwordResetTokensTable.id, tokenRow.id), isNull(passwordResetTokensTable.usedAt), isNull(passwordResetTokensTable.invalidatedAt), gt(passwordResetTokensTable.expiresAt, now)))
        .returning({ id: passwordResetTokensTable.id });

      if (!consumed) {
        throw new Error("PASSWORD_RESET_TOKEN_NOT_ACTIVE");
      }

      const [updatedUser] = await tx
        .update(utentiTable)
        .set({
          passwordHash,
          mustChangePassword: false,
          lastPasswordChangeAt: now,
        })
        .where(and(eq(utentiTable.id, user.id), eq(utentiTable.attivo, true)))
        .returning({ id: utentiTable.id });

      if (!updatedUser) {
        throw new Error("PASSWORD_RESET_USER_NOT_ACTIVE");
      }

      await tx
        .update(passwordResetTokensTable)
        .set({ invalidatedAt: now })
        .where(and(eq(passwordResetTokensTable.utenteId, user.id), ne(passwordResetTokensTable.id, tokenRow.id), isNull(passwordResetTokensTable.usedAt), isNull(passwordResetTokensTable.invalidatedAt)));
    });
  } catch (error) {
    req.log.warn({ err: error, userId: user.id }, "Password reset token consumption failed");
    await logSystemEvent({
      evento: "PASSWORD_RESET_COMPLETED",
      esito: "FAILED",
      targetUserId: user.id,
      userEmail: user.email,
      username: user.username,
      ...meta,
      details: { reason: "token_consumption_failed" },
    });
    res.status(400).json({ error: RESET_PASSWORD_INVALID_TOKEN_MESSAGE });
    return;
  }

  try {
    if (user.email && isValidUserEmail(user.email)) {
      await sendPasswordChangedEmail({
        to: user.email,
        nome: user.nome,
        username: user.username,
      });
    }
  } catch (error) {
    req.log.warn({ err: error, userId: user.id }, "Password changed confirmation email failed");
  }

  await logSystemEvent({
    evento: "PASSWORD_RESET_COMPLETED",
    esito: "SUCCESS",
    targetUserId: user.id,
    userEmail: user.email,
    username: user.username,
    ...meta,
  });

  res.json({ message: RESET_PASSWORD_SUCCESS_MESSAGE });
});

function authUserResponse(u: SessionUser) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    emailDaAggiornare: u.emailDaAggiornare,
    nome: u.nome,
    cognome: u.cognome,
    matricola: u.matricola,
    ruoloId: u.ruoloId,
    ruoloNome: u.ruoloNome,
    centroAscoltoId: u.centroAscoltoId,
    centroAscoltoNome: u.centroAscoltoNome,
    cittaId: u.cittaId,
    cittaNome: u.cittaNome,
    zonaUdsId: u.zonaUdsId,
    zonaUdsNome: u.zonaUdsNome,
    isSuperAdmin: u.isSuperAdmin,
    isAdmin: u.isAdmin,
    aree: u.aree,
    mustChangePassword: u.mustChangePassword,
  };
}

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { username, password } = parsed.data;

  const [row] = await db.select().from(utentiTable).where(eq(utentiTable.username, username));

  if (!row || !row.attivo) {
    await logSystemEvent({
      evento: "LOGIN_FAILED",
      esito: "FAILED",
      username,
      ...systemLogMetaFromRequest(req),
      details: { reason: "invalid_credentials_or_inactive" },
    });
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  const ok = await bcrypt.compare(password, row.passwordHash);
  if (!ok) {
    await logSystemEvent({
      evento: "LOGIN_FAILED",
      esito: "FAILED",
      targetUserId: row.id,
      userEmail: row.email,
      username: row.username,
      ...systemLogMetaFromRequest(req),
      details: { reason: "invalid_password" },
    });
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  await db.update(utentiTable).set({ ultimoAccesso: new Date() }).where(eq(utentiTable.id, row.id));

  const user = await loadSessionUser(row.id);
  if (!user) {
    res.status(401).json({ error: "Credenziali non valide" });
    return;
  }

  // Regenerate the session id on login to prevent session fixation.
  req.session.regenerate((regenErr) => {
    if (regenErr) {
      req.log.error({ err: regenErr }, "Failed to regenerate session on login");
      res.status(500).json({ error: "Errore di sessione" });
      return;
    }
    req.session.userId = row.id;
    req.session.save((err) => {
      if (err) {
        req.log.error({ err }, "Failed to persist session on login");
        res.status(500).json({ error: "Errore di sessione" });
        return;
      }
      void logSystemEvent({
        evento: "LOGIN_SUCCESS",
        esito: "SUCCESS",
        actorUserId: row.id,
        targetUserId: row.id,
        userEmail: row.email,
        username: row.username,
        ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
        userAgent: req.get("user-agent") ?? null,
      });
      res.json(authUserResponse(user));
    });
  });
});

router.post("/auth/logout", (req, res): void => {
  const userId = req.session?.userId ?? null;
  req.session.destroy(() => {
    void logSystemEvent({
      evento: "LOGOUT",
      esito: "SUCCESS",
      actorUserId: userId,
      targetUserId: userId,
      ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
      userAgent: req.get("user-agent") ?? null,
    });
    res.clearCookie(SESSION_COOKIE);
    res.status(204).send();
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  res.json(authUserResponse(req.user!));
});

router.post("/auth/change-password", requireAuth, async (req, res): Promise<void> => {
  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { newPassword } = parsed.data;

  const [row] = await db.select().from(utentiTable).where(eq(utentiTable.id, req.user!.id));

  if (!row) {
    res.status(401).json({ error: "Non autenticato" });
    return;
  }

  const hash = await bcrypt.hash(newPassword, 10);
  await db
    .update(utentiTable)
    .set({
      passwordHash: hash,
      mustChangePassword: false,
      lastPasswordChangeAt: new Date(),
    })
    .where(eq(utentiTable.id, row.id));

  await logSystemEvent({
    evento: "PASSWORD_CHANGED_BY_USER",
    esito: "SUCCESS",
    targetUserId: row.id,
    userEmail: row.email,
    username: row.username,
    ...systemLogMetaFromRequest(req),
  });

  res.status(204).send();
});

export default router;
