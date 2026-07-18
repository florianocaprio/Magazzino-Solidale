import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";

export const systemLogsTable = pgTable(
  "system_logs",
  {
    id: serial("id").primaryKey(),
    dataOra: timestamp("data_ora").notNull().defaultNow(),
    evento: varchar("evento", { length: 80 }).notNull(),
    esito: varchar("esito", { length: 40 }).notNull(),
    actorUserId: integer("actor_user_id").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    targetUserId: integer("target_user_id").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    userEmail: varchar("user_email", { length: 255 }),
    username: varchar("username", { length: 60 }),
    ipAddress: varchar("ip_address", { length: 80 }),
    userAgent: varchar("user_agent", { length: 500 }),
    details: jsonb("details").$type<Record<string, unknown> | null>(),
    note: text("note"),
  },
  (table) => [
    index("system_logs_data_ora_idx").on(table.dataOra),
    index("system_logs_evento_idx").on(table.evento),
    index("system_logs_esito_idx").on(table.esito),
    index("system_logs_actor_user_idx").on(table.actorUserId),
    index("system_logs_target_user_idx").on(table.targetUserId),
    index("system_logs_user_email_idx").on(table.userEmail),
  ],
);

export type SystemLog = typeof systemLogsTable.$inferSelect;
