import { randomUUID } from "node:crypto";
import type { Request } from "express";
import {
  auditEventiTable,
  type AuditJsonObject,
  type AuditJsonValue,
} from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

const SENSITIVE_PATTERN =
  /password|passwd|pwd|token|secret|authorization|cookie|session|credential|api[-_]?key|reset[-_]?link/i;
const MAX_AUDIT_DEPTH = 5;
const MAX_AUDIT_TEXT_LENGTH = 1_000;

export type AuditActorContext =
  | {
      actorType: "user";
      actorUserId: number;
      actorCodeSnapshot: string;
      initiatedByUserId: null;
      initiatedByCodeSnapshot: null;
    }
  | {
      actorType: "system";
      actorUserId: null;
      actorCodeSnapshot: string;
      initiatedByUserId: number | null;
      initiatedByCodeSnapshot: string | null;
    };

export interface AuditCommandContext {
  actor: AuditActorContext;
  correlationId: string;
  operationKey?: string | null;
}

export interface AllowlistedAuditFields {
  values: Record<string, unknown>;
  allowedKeys: readonly string[];
}

export function auditFields(
  values: Record<string, unknown>,
  allowedKeys: readonly string[],
): AllowlistedAuditFields {
  return { values, allowedKeys };
}

function sanitizeAuditText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized) return null;
  return SENSITIVE_PATTERN.test(normalized)
    ? "[redacted]"
    : normalized.slice(0, MAX_AUDIT_TEXT_LENGTH);
}

function sanitizeAuditValue(value: unknown, depth: number): AuditJsonValue {
  if (depth > MAX_AUDIT_DEPTH) return "[redacted]";
  if (
    value == null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value as number | boolean | null;
  }
  if (typeof value === "string") {
    return sanitizeAuditText(value) ?? "";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeAuditValue(item, depth + 1));
  }
  if (typeof value !== "object") return "[redacted]";

  const sanitized: Record<string, AuditJsonValue> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_PATTERN.test(key)) continue;
    sanitized[key] = sanitizeAuditValue(nested, depth + 1);
  }
  return sanitized;
}

function sanitizeAllowlistedFields(
  fields: AllowlistedAuditFields | null | undefined,
): AuditJsonObject | null {
  if (!fields) return null;
  const sanitized: AuditJsonObject = {};
  for (const key of fields.allowedKeys) {
    if (SENSITIVE_PATTERN.test(key) || !(key in fields.values)) continue;
    sanitized[key] = sanitizeAuditValue(fields.values[key], 0);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

export function auditContextFromRequest(
  req: Request,
  options: { correlationId?: string; operationKey?: string | null } = {},
): AuditCommandContext {
  const user = req.user;
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) {
    throw new Error("AUDIT_ACTOR_SESSION_REQUIRED");
  }
  return {
    actor: {
      actorType: "user",
      actorUserId: user.id,
      actorCodeSnapshot:
        user.matricola?.trim() || user.username?.trim() || `utente-${user.id}`,
      initiatedByUserId: null,
      initiatedByCodeSnapshot: null,
    },
    correlationId: options.correlationId ?? randomUUID(),
    operationKey: options.operationKey?.trim() || null,
  };
}

export function systemAuditContext(options: {
  actorCode: string;
  initiatedByUserId?: number | null;
  initiatedByCodeSnapshot?: string | null;
  correlationId?: string;
  operationKey?: string | null;
}): AuditCommandContext {
  const initiatedByUserId = options.initiatedByUserId ?? null;
  const initiatedByCodeSnapshot =
    options.initiatedByCodeSnapshot?.trim() || null;
  if ((initiatedByUserId == null) !== (initiatedByCodeSnapshot == null)) {
    throw new Error("AUDIT_INITIATOR_CONTEXT_INCOMPLETE");
  }
  return {
    actor: {
      actorType: "system",
      actorUserId: null,
      actorCodeSnapshot: options.actorCode.trim() || "system",
      initiatedByUserId,
      initiatedByCodeSnapshot,
    },
    correlationId: options.correlationId ?? randomUUID(),
    operationKey: options.operationKey?.trim() || null,
  };
}

export function auditUserId(context: AuditCommandContext): number {
  const id =
    context.actor.actorType === "user"
      ? context.actor.actorUserId
      : context.actor.initiatedByUserId;
  if (id == null) throw new Error("AUDIT_USER_ACTOR_REQUIRED");
  return id;
}

export interface RecordAuditEventInput {
  command: AuditCommandContext;
  azione: string;
  entitaTipo: string;
  entitaId: number;
  documentoTipo?: string | null;
  documentoId?: number | null;
  areaOperativaIdSnapshot?: number | null;
  centroAscoltoIdSnapshot?: number | null;
  magazzinoIdSnapshot?: number | null;
  dataOperativa?: string | null;
  motivo?: string | null;
  changes?: AllowlistedAuditFields | null;
  metadata?: AllowlistedAuditFields | null;
  previousEventId?: number | null;
}

export class AuditOperationKeyConflictError extends Error {
  readonly code = "AUDIT_OPERATION_KEY_CONFLICT";

  constructor() {
    super("AUDIT_OPERATION_KEY_CONFLICT");
    this.name = "AuditOperationKeyConflictError";
  }
}

/**
 * Inserisce un evento nella transazione del chiamante. Non apre transazioni e
 * non intercetta errori: un fallimento dell'audit annulla l'intero comando.
 */
export async function recordAuditEvent(
  tx: InventoryTransaction,
  input: RecordAuditEventInput,
): Promise<number> {
  const operationKey = input.command.operationKey?.trim() || null;
  if (operationKey) {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`audit-operation:${input.azione}:${operationKey}`}, 0))`,
    );
    const [existing] = await tx
      .select({
        id: auditEventiTable.id,
        entitaTipo: auditEventiTable.entitaTipo,
        entitaId: auditEventiTable.entitaId,
      })
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.azione, input.azione),
          eq(auditEventiTable.operationKey, operationKey),
        ),
      );
    if (existing) {
      if (
        existing.entitaTipo !== input.entitaTipo ||
        existing.entitaId !== input.entitaId
      ) {
        throw new AuditOperationKeyConflictError();
      }
      return existing.id;
    }
  }

  let previousEventId = input.previousEventId;
  if (previousEventId === undefined) {
    const [previous] = await tx
      .select({ id: auditEventiTable.id })
      .from(auditEventiTable)
      .where(
        and(
          eq(auditEventiTable.entitaTipo, input.entitaTipo),
          eq(auditEventiTable.entitaId, input.entitaId),
        ),
      )
      .orderBy(desc(auditEventiTable.id))
      .limit(1);
    previousEventId = previous?.id ?? null;
  }

  const [created] = await tx
    .insert(auditEventiTable)
    .values({
      correlationId: input.command.correlationId,
      azione: input.azione,
      entitaTipo: input.entitaTipo,
      entitaId: input.entitaId,
      actorType: input.command.actor.actorType,
      actorUserId: input.command.actor.actorUserId,
      actorCodeSnapshot: input.command.actor.actorCodeSnapshot,
      initiatedByUserId: input.command.actor.initiatedByUserId,
      initiatedByCodeSnapshot: input.command.actor.initiatedByCodeSnapshot,
      documentoTipo: input.documentoTipo ?? null,
      documentoId: input.documentoId ?? null,
      areaOperativaIdSnapshot: input.areaOperativaIdSnapshot ?? null,
      centroAscoltoIdSnapshot: input.centroAscoltoIdSnapshot ?? null,
      magazzinoIdSnapshot: input.magazzinoIdSnapshot ?? null,
      dataOperativa: input.dataOperativa ?? null,
      motivo: sanitizeAuditText(input.motivo),
      changes: sanitizeAllowlistedFields(input.changes),
      metadata: sanitizeAllowlistedFields(input.metadata),
      operationKey,
      previousEventId: previousEventId ?? null,
    })
    .returning({ id: auditEventiTable.id });
  if (!created) throw new Error("AUDIT_EVENT_INSERT_FAILED");
  return created.id;
}
