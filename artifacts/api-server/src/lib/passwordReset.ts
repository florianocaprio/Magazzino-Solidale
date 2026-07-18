import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db, passwordResetTokensTable } from "@workspace/db";
import { getAppBaseUrl, getPasswordResetTokenTtlMinutes } from "./emailService";

const PASSWORD_RESET_TOKEN_BYTES = 32;
const FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS = 5;
const FORGOT_PASSWORD_RATE_LIMIT_MAX_BUCKETS = 2000;

export const FORGOT_PASSWORD_RESPONSE_MESSAGE = "Se l’indirizzo è presente nel sistema, riceverai una mail con le istruzioni.";
export const RESET_PASSWORD_SUCCESS_MESSAGE = "Password modificata correttamente. Ora puoi effettuare l’accesso.";
export const RESET_PASSWORD_INVALID_TOKEN_MESSAGE = "Link di reset non valido o scaduto.";
export const RESET_PASSWORD_WEAK_PASSWORD_MESSAGE = "La password deve contenere almeno 8 caratteri, una lettera e un numero.";
export const RESET_PASSWORD_CONFIRM_MISMATCH_MESSAGE = "Le password non coincidono.";
export const ADMIN_RESET_EMAIL_INVALID_MESSAGE = "L’utente non ha un indirizzo email valido. Aggiorna prima il profilo.";
export const ADMIN_RESET_LINK_SENT_MESSAGE = "Link di reset password inviato all'indirizzo email dell'utente.";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const forgotPasswordRateLimits = new Map<string, RateLimitBucket>();

function nullableText(value: string | null | undefined, maxLength: number): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

export function createPasswordResetToken(): string {
  return randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
}

export function hashPasswordResetToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function buildPasswordResetUrl(token: string): string {
  return `${getAppBaseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export function validatePasswordForReset(password: string): string | null {
  if (password.length < 8) return RESET_PASSWORD_WEAK_PASSWORD_MESSAGE;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return RESET_PASSWORD_WEAK_PASSWORD_MESSAGE;
  }
  return null;
}

export function getPasswordResetExpiresAt(now = new Date()): {
  expiresAt: Date;
  expiresInMinutes: number;
} {
  const expiresInMinutes = getPasswordResetTokenTtlMinutes();
  return {
    expiresAt: new Date(now.getTime() + expiresInMinutes * 60 * 1000),
    expiresInMinutes,
  };
}

export async function invalidateActivePasswordResetTokens(utenteId: number, invalidatedAt = new Date(), exceptTokenId?: number): Promise<void> {
  const condition = exceptTokenId == null ? and(eq(passwordResetTokensTable.utenteId, utenteId), isNull(passwordResetTokensTable.usedAt), isNull(passwordResetTokensTable.invalidatedAt)) : and(eq(passwordResetTokensTable.utenteId, utenteId), ne(passwordResetTokensTable.id, exceptTokenId), isNull(passwordResetTokensTable.usedAt), isNull(passwordResetTokensTable.invalidatedAt));

  await db.update(passwordResetTokensTable).set({ invalidatedAt }).where(condition);
}

export async function createPasswordResetLinkForUser(params: { utenteId: number; ipAddress?: string | null; userAgent?: string | null; now?: Date }): Promise<{
  token: string;
  tokenHash: string;
  resetUrl: string;
  expiresAt: Date;
  expiresInMinutes: number;
}> {
  const now = params.now ?? new Date();
  await invalidateActivePasswordResetTokens(params.utenteId, now);

  const token = createPasswordResetToken();
  const tokenHash = hashPasswordResetToken(token);
  const { expiresAt, expiresInMinutes } = getPasswordResetExpiresAt(now);

  await db.insert(passwordResetTokensTable).values({
    utenteId: params.utenteId,
    tokenHash,
    expiresAt,
    createdIp: nullableText(params.ipAddress, 80),
    createdUserAgent: nullableText(params.userAgent, 500),
  });

  return {
    token,
    tokenHash,
    resetUrl: buildPasswordResetUrl(token),
    expiresAt,
    expiresInMinutes,
  };
}

function pruneForgotPasswordRateLimits(nowMs: number): void {
  if (forgotPasswordRateLimits.size <= FORGOT_PASSWORD_RATE_LIMIT_MAX_BUCKETS) {
    return;
  }
  for (const [key, bucket] of forgotPasswordRateLimits.entries()) {
    if (bucket.resetAt <= nowMs) {
      forgotPasswordRateLimits.delete(key);
    }
  }
}

export function checkForgotPasswordRateLimit(params: { email: string; ipAddress?: string | null; now?: Date }): { allowed: boolean; resetAt: Date } {
  const nowMs = (params.now ?? new Date()).getTime();
  const emailKey = params.email.trim().toLowerCase() || "__empty__";
  const ipKey = params.ipAddress?.trim() || "__unknown_ip__";
  const key = `${emailKey}|${ipKey}`;
  const current = forgotPasswordRateLimits.get(key);

  if (!current || current.resetAt <= nowMs) {
    const resetAt = nowMs + FORGOT_PASSWORD_RATE_LIMIT_WINDOW_MS;
    forgotPasswordRateLimits.set(key, { count: 1, resetAt });
    pruneForgotPasswordRateLimits(nowMs);
    return { allowed: true, resetAt: new Date(resetAt) };
  }

  current.count += 1;
  return {
    allowed: current.count <= FORGOT_PASSWORD_RATE_LIMIT_MAX_REQUESTS,
    resetAt: new Date(current.resetAt),
  };
}

export function clearForgotPasswordRateLimitsForTests(): void {
  forgotPasswordRateLimits.clear();
}
