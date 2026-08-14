import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { interventiTable } from "./interventi";

export const interventiStoricoStatiTable = pgTable(
  "interventi_storico_stati",
  {
    id: serial("id").primaryKey(),
    interventoId: integer("intervento_id")
      .notNull()
      .references(() => interventiTable.id, { onDelete: "cascade" }),
    statoPrecedente: varchar("stato_precedente", { length: 30 }),
    statoNuovo: varchar("stato_nuovo", { length: 30 }).notNull(),
    operatoreId: integer("operatore_id").references(() => utentiTable.id),
    dataTransizione: timestamp("data_transizione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    motivo: text("motivo"),
  },
  (table) => [
    index("interventi_storico_intervento_data_idx").on(
      table.interventoId,
      table.dataTransizione,
      table.id,
    ),
  ],
);

export type InterventoStoricoStato =
  typeof interventiStoricoStatiTable.$inferSelect;
