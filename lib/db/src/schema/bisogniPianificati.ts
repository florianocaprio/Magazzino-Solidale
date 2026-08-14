import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { interventiTable } from "./interventi";

export const bisogniPianificatiTable = pgTable(
  "bisogni_pianificati",
  {
    id: serial("id").primaryKey(),
    interventoId: integer("intervento_id")
      .notNull()
      .references(() => interventiTable.id),
    tipo: varchar("tipo", { length: 20 }).notNull(),
    descrizione: varchar("descrizione", { length: 500 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull().default("da_pianificare"),
    dataPrevista: date("data_prevista"),
    priorita: varchar("priorita", { length: 20 }).notNull().default("normale"),
    note: varchar("note", { length: 2000 }),
    dataCompletamento: timestamp("data_completamento"),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    index("bisogni_pianificati_intervento_idx").on(table.interventoId),
    index("bisogni_pianificati_stato_idx").on(table.stato),
    index("bisogni_pianificati_data_prevista_idx").on(table.dataPrevista),
    check(
      "bisogni_pianificati_tipo_check",
      sql`${table.tipo} in ('richiesta', 'azione')`,
    ),
    check(
      "bisogni_pianificati_stato_check",
      sql`${table.stato} in ('da_pianificare', 'pianificato', 'completato', 'annullato')`,
    ),
    check(
      "bisogni_pianificati_priorita_check",
      sql`${table.priorita} in ('bassa', 'normale', 'alta', 'urgente')`,
    ),
    check(
      "bisogni_pianificati_pianificato_data_check",
      sql`${table.stato} <> 'pianificato' or ${table.dataPrevista} is not null`,
    ),
  ],
);

export type BisognoPianificato = typeof bisogniPianificatiTable.$inferSelect;
export type InsertBisognoPianificato =
  typeof bisogniPianificatiTable.$inferInsert;
