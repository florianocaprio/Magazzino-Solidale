import { Router, type IRouter } from "express";
import { db, systemLogsTable } from "@workspace/db";
import { and, count, desc, eq, gte, ilike, lte, or, sql, type SQL } from "drizzle-orm";
import { requireSuperAdmin } from "../middlewares/auth";
import {
  getConfigurazioneAmbiente,
  listAuditConfigurazioni,
  listModuliFunzionali,
  updateConfigurazioneAmbiente,
  updateModuloAmbiente,
} from "../lib/configurazioneAmbiente";
import { auditMetaFromRequest, logConfigurazioneAudit } from "../lib/auditConfigurazioni";

const router: IRouter = Router();

router.use("/super-admin", requireSuperAdmin);

const SYSTEM_LOG_DEFAULT_LIMIT = 50;
const SYSTEM_LOG_MAX_LIMIT = 100;
const SENSITIVE_METADATA_KEYS = [
  "authorization",
  "cookie",
  "link",
  "mailpassword",
  "password",
  "resettoken",
  "reseturl",
  "secret",
  "token",
  "tokenhash",
] as const;

const STRING_FIELDS = [
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
  "descrizione",
  "indirizzo",
  "comune",
  "provincia",
  "codiceFiscale",
  "partitaIva",
  "email",
  "telefono",
  "sitoWeb",
  "logoDocumentiUrl",
  "logoTessereUrl",
  "footerDocumenti",
  "noteLegali",
  "privacyTestoBreve",
] as const;

const REQUIRED_STRING_FIELDS = new Set([
  "codiceAmbiente",
  "nomeAmbiente",
  "nomeAssociazione",
]);

type ConfigUpdate = Parameters<typeof updateConfigurazioneAmbiente>[0];
type ConfigRouteUpdate = Partial<
  Record<(typeof STRING_FIELDS)[number], string | null> & { attivo: boolean }
>;

type SystemLogQuery = {
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  email?: string;
  eventType?: string;
  eventStatus?: string;
  ipAddress?: string;
  limit: number;
  offset: number;
};

function parseConfigUpdate(body: unknown): { updates: ConfigRouteUpdate; error?: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { updates: {}, error: "Payload non valido" };
  }

  const source = body as Record<string, unknown>;
  const updates: ConfigRouteUpdate = {};

  for (const field of STRING_FIELDS) {
    if (!(field in source)) continue;
    const value = source[field];
    if (value === null || value === undefined) {
      if (REQUIRED_STRING_FIELDS.has(field)) {
        return { updates, error: `${field} non può essere vuoto` };
      }
      updates[field] = null;
      continue;
    }
    if (typeof value !== "string") {
      return { updates, error: `${field} deve essere una stringa` };
    }
    const normalized = value.trim();
    if (!normalized && REQUIRED_STRING_FIELDS.has(field)) {
      return { updates, error: `${field} non può essere vuoto` };
    }
    updates[field] = normalized || null;
  }

  if ("attivo" in source) {
    if (typeof source.attivo !== "boolean") {
      return { updates, error: "attivo deve essere booleano" };
    }
    updates.attivo = source.attivo;
  }

  return { updates };
}

function parseModuloUpdate(body: unknown): { attivo?: boolean; error?: string } {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Payload non valido" };
  }
  const source = body as Record<string, unknown>;
  if (typeof source.attivo !== "boolean") {
    return { error: "attivo deve essere booleano" };
  }
  return { attivo: source.attivo };
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) return firstString(value[0]);
  return undefined;
}

function parseDateFilter(
  value: string | undefined,
  endOfDay: boolean,
): { value?: Date; error?: string } {
  if (!value) return {};
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = new Date(
    dateOnly
      ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
      : value,
  );
  if (Number.isNaN(parsed.getTime())) {
    return { error: "Filtro data non valido" };
  }
  return { value: parsed };
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  max?: number,
) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function parseOffset(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return 0;
  return parsed;
}

function parseSystemLogQuery(query: Record<string, unknown>): SystemLogQuery | { error: string } {
  const dateFrom = parseDateFilter(firstString(query.dateFrom), false);
  if (dateFrom.error) return { error: dateFrom.error };
  const dateTo = parseDateFilter(firstString(query.dateTo), true);
  if (dateTo.error) return { error: dateTo.error };

  return {
    dateFrom: dateFrom.value,
    dateTo: dateTo.value,
    search: firstString(query.search),
    email: firstString(query.email),
    eventType: firstString(query.eventType)?.toUpperCase(),
    eventStatus: firstString(query.eventStatus)?.toUpperCase(),
    ipAddress: firstString(query.ipAddress),
    limit: parsePositiveInteger(firstString(query.limit), SYSTEM_LOG_DEFAULT_LIMIT, SYSTEM_LOG_MAX_LIMIT),
    offset: parseOffset(firstString(query.offset)),
  };
}

function metadataKeyIsSensitive(key: string) {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return SENSITIVE_METADATA_KEYS.some((sensitive) =>
    normalized.includes(sensitive),
  );
}

function sanitizeText(value: string) {
  if (/https?:\/\//i.test(value)) return "[redacted-link]";
  if (/(password|token|secret|authorization|cookie)\s*=/i.test(value)) {
    return "[redacted]";
  }
  return value.length > 500 ? `${value.slice(0, 500)}...` : value;
}

function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") return sanitizeText(value);
  if (depth >= 4) return "[redacted-object]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const safe: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (metadataKeyIsSensitive(key)) continue;
      safe[key] = sanitizeLogValue(raw, depth + 1);
    }
    return safe;
  }
  return null;
}

function sanitizeLogDetails(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sanitized = sanitizeLogValue(value);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return null;
  }
  return Object.keys(sanitized).length > 0
    ? (sanitized as Record<string, unknown>)
    : null;
}

function systemLogFilters(q: SystemLogQuery): SQL {
  const filters: SQL[] = [];
  if (q.dateFrom) filters.push(gte(systemLogsTable.dataOra, q.dateFrom));
  if (q.dateTo) filters.push(lte(systemLogsTable.dataOra, q.dateTo));
  if (q.eventType) filters.push(eq(systemLogsTable.evento, q.eventType));
  if (q.eventStatus) filters.push(eq(systemLogsTable.esito, q.eventStatus));
  if (q.email) filters.push(ilike(systemLogsTable.userEmail, `%${q.email}%`));
  if (q.ipAddress) filters.push(ilike(systemLogsTable.ipAddress, `%${q.ipAddress}%`));
  if (q.search) {
    const pattern = `%${q.search}%`;
    filters.push(
      or(
        ilike(systemLogsTable.username, pattern),
        ilike(systemLogsTable.userEmail, pattern),
      )!,
    );
  }
  return filters.length > 0 ? and(...filters)! : sql`true`;
}

function formatSystemLog(row: typeof systemLogsTable.$inferSelect) {
  return {
    id: row.id,
    createdAt: row.dataOra.toISOString(),
    eventType: row.evento,
    eventStatus: row.esito,
    actorUserId: row.actorUserId ?? null,
    targetUserId: row.targetUserId ?? null,
    username: row.username ?? null,
    userEmail: row.userEmail ?? null,
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    details: sanitizeLogDetails(row.details),
    note: row.note ? sanitizeText(row.note) : null,
  };
}

router.get("/super-admin/configurazione-ambiente", async (_req, res) => {
  res.json(await getConfigurazioneAmbiente());
});

router.patch("/super-admin/configurazione-ambiente", async (req, res): Promise<void> => {
  const parsed = parseConfigUpdate(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const before = await getConfigurazioneAmbiente();
  const updates = {
    ...parsed.updates,
    aggiornatoDaId: req.user?.id ?? null,
  } as ConfigUpdate;
  const after = await updateConfigurazioneAmbiente(updates);

  await logConfigurazioneAudit({
    area: "configurazione_ambiente",
    chiave: "singleton",
    azione: "update",
    valorePrecedente: { ...before },
    valoreNuovo: { ...after },
    ...auditMetaFromRequest(req),
  });

  res.json(after);
});

router.get("/super-admin/moduli", async (_req, res) => {
  res.json(await listModuliFunzionali());
});

router.patch("/super-admin/moduli/:codice", async (req, res): Promise<void> => {
  const parsed = parseModuloUpdate(req.body);
  if (parsed.error) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const codice = String(req.params.codice ?? "");
  const before = (await listModuliFunzionali()).find(
    (m) => m.codice === codice.trim().toUpperCase(),
  );
  const result = await updateModuloAmbiente(
    codice,
    parsed.attivo!,
    req.user?.id ?? null,
  );
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  await logConfigurazioneAudit({
    area: "moduli_funzionali",
    chiave: result.codice,
    azione: "toggle",
    valorePrecedente: before ? { ...before } : null,
    valoreNuovo: { ...result },
    ...auditMetaFromRequest(req),
  });

  res.json(result);
});

router.get("/super-admin/audit-configurazioni", async (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : 100;
  res.json(await listAuditConfigurazioni(limit));
});

router.get("/super-admin/log-sistema", async (req, res): Promise<void> => {
  const parsed = parseSystemLogQuery(req.query as Record<string, unknown>);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const where = systemLogFilters(parsed);
  const [totalRow] = await db
    .select({ total: count() })
    .from(systemLogsTable)
    .where(where);
  const rows = await db
    .select()
    .from(systemLogsTable)
    .where(where)
    .orderBy(desc(systemLogsTable.dataOra), desc(systemLogsTable.id))
    .limit(parsed.limit)
    .offset(parsed.offset);

  res.json({
    items: rows.map(formatSystemLog),
    total: totalRow?.total ?? 0,
    limit: parsed.limit,
    offset: parsed.offset,
  });
});

export default router;
