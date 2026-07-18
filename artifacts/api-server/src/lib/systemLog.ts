import type { Request } from "express";
import { db, systemLogsTable } from "@workspace/db";
import { logger } from "./logger";

export const SYSTEM_LOG_EVENTS = [
  "LOGIN_SUCCESS",
  "LOGIN_FAILED",
  "LOGOUT",
  "PASSWORD_RESET_REQUESTED",
  "PASSWORD_RESET_EMAIL_SENT",
  "PASSWORD_RESET_COMPLETED",
  "PASSWORD_CHANGED_BY_USER",
  "PASSWORD_CHANGED_BY_ADMIN",
  "USER_CREATED",
  "USER_DISABLED",
  "USER_ROLE_CHANGED",
  "ACCOUNT_LOCKED",
  "ACCOUNT_UNLOCKED",
] as const;

export type SystemLogEvent = (typeof SYSTEM_LOG_EVENTS)[number];

export const SYSTEM_LOG_STATUSES = ["SUCCESS", "FAILED", "INFO"] as const;
export type SystemLogStatus = (typeof SYSTEM_LOG_STATUSES)[number];

const SENSITIVE_KEYS = [
  "password",
  "passwordHash",
  "newPassword",
  "currentPassword",
  "token",
  "tokenHash",
  "resetToken",
  "resetLink",
  "secret",
  "smtpPassword",
] as const;

export type SystemLogInput = {
  evento: SystemLogEvent;
  esito: SystemLogStatus;
  actorUserId?: number | null;
  targetUserId?: number | null;
  userEmail?: string | null;
  username?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown> | null;
  note?: string | null;
};

function sanitizeDetails(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;
  const sanitized: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_KEYS.some((sensitive) =>
        lowerKey.includes(sensitive.toLowerCase()),
      )
    ) {
      continue;
    }
    if (
      raw == null ||
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
    ) {
      sanitized[key] = raw;
    } else if (Array.isArray(raw)) {
      sanitized[key] = raw.filter((item) =>
        ["string", "number", "boolean"].includes(typeof item),
      );
    } else {
      sanitized[key] = "[redacted-object]";
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function systemLogMetaFromRequest(
  req: Request,
): Pick<SystemLogInput, "actorUserId" | "ipAddress" | "userAgent"> {
  return {
    actorUserId: req.user?.id ?? null,
    ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

export async function logSystemEvent(input: SystemLogInput): Promise<void> {
  try {
    await db.insert(systemLogsTable).values({
      evento: input.evento,
      esito: input.esito,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      userEmail: input.userEmail ?? null,
      username: input.username ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      details: sanitizeDetails(input.details),
      note: input.note ?? null,
    });
  } catch (error) {
    logger.warn(
      { err: error, evento: input.evento },
      "System log write failed",
    );
  }
}
