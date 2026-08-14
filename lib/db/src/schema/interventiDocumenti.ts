import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { interventiTable } from "./interventi";

export const interventiDocumentiTable = pgTable(
  "interventi_documenti",
  {
    id: serial("id").primaryKey(),
    interventoId: integer("intervento_id")
      .notNull()
      .references(() => interventiTable.id, { onDelete: "cascade" }),
    tipoDescrizione: varchar("tipo_descrizione", { length: 200 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull(),
    dataScadenza: date("data_scadenza"),
    note: text("note"),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("interventi_documenti_intervento_idx").on(table.interventoId),
    index("interventi_documenti_stato_idx").on(table.stato),
    index("interventi_documenti_scadenza_idx").on(table.dataScadenza),
    check(
      "interventi_documenti_stato_check",
      sql`${table.stato} in ('da_acquisire', 'da_verificare', 'acquisito', 'verificato', 'non_disponibile', 'annullato')`,
    ),
    check(
      "interventi_documenti_descrizione_check",
      sql`length(trim(${table.tipoDescrizione})) > 0`,
    ),
  ],
);

export type InterventoDocumento = typeof interventiDocumentiTable.$inferSelect;
