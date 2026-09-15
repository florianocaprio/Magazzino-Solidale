import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { utentiTable } from "./auth";

export type AuditJsonValue =
  | string
  | number
  | boolean
  | null
  | AuditJsonValue[]
  | { [key: string]: AuditJsonValue };

export type AuditJsonObject = Record<string, AuditJsonValue>;

export const auditEventiTable = pgTable(
  "audit_eventi",
  {
    id: serial("id").primaryKey(),
    correlationId: uuid("correlation_id").notNull(),
    azione: varchar("azione", { length: 100 }).notNull(),
    entitaTipo: varchar("entita_tipo", { length: 80 }).notNull(),
    entitaId: integer("entita_id").notNull(),
    actorType: varchar("actor_type", { length: 20 }).notNull(),
    actorUserId: integer("actor_user_id").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    actorCodeSnapshot: varchar("actor_code_snapshot", {
      length: 160,
    }).notNull(),
    initiatedByUserId: integer("initiated_by_user_id").references(
      () => utentiTable.id,
      { onDelete: "set null" },
    ),
    initiatedByCodeSnapshot: varchar("initiated_by_code_snapshot", {
      length: 160,
    }),
    documentoTipo: varchar("documento_tipo", { length: 80 }),
    documentoId: integer("documento_id"),
    areaOperativaIdSnapshot: integer("area_operativa_id_snapshot"),
    centroAscoltoIdSnapshot: integer("centro_ascolto_id_snapshot"),
    magazzinoIdSnapshot: integer("magazzino_id_snapshot"),
    dataOperativa: date("data_operativa"),
    registratoAt: timestamp("registrato_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    motivo: text("motivo"),
    changes: jsonb("changes").$type<AuditJsonObject | null>(),
    metadata: jsonb("metadata").$type<AuditJsonObject | null>(),
    operationKey: varchar("operation_key", { length: 200 }),
    previousEventId: integer("previous_event_id").references(
      (): AnyPgColumn => auditEventiTable.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    check(
      "audit_eventi_actor_type_check",
      sql`${table.actorType} in ('user', 'system')`,
    ),
    check(
      "audit_eventi_actor_consistency_check",
      sql`(${table.actorType} = 'user'
            and ${table.initiatedByUserId} is null
            and ${table.initiatedByCodeSnapshot} is null)
          or (${table.actorType} = 'system' and ${table.actorUserId} is null)`,
    ),
    index("audit_eventi_correlation_idx").on(table.correlationId),
    index("audit_eventi_action_idx").on(table.azione),
    index("audit_eventi_entity_idx").on(table.entitaTipo, table.entitaId),
    index("audit_eventi_actor_idx").on(table.actorUserId),
    index("audit_eventi_document_idx").on(
      table.documentoTipo,
      table.documentoId,
    ),
    index("audit_eventi_registered_idx").on(table.registratoAt),
    index("audit_eventi_area_idx").on(table.areaOperativaIdSnapshot),
    index("audit_eventi_warehouse_idx").on(table.magazzinoIdSnapshot),
    uniqueIndex("audit_eventi_operation_key_unique")
      .on(table.azione, table.operationKey)
      .where(sql`${table.operationKey} is not null`),
  ],
);

export type AuditEvento = typeof auditEventiTable.$inferSelect;
