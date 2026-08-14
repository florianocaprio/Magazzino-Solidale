import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { tipiInterventoTable } from "./tipiIntervento";
import { interventiTable } from "./interventi";
import { utentiTable } from "./auth";

export const interventiAttivitaTable = pgTable(
  "interventi_attivita",
  {
    id: serial("id").primaryKey(),
    interventoId: integer("intervento_id")
      .notNull()
      .references(() => interventiTable.id, { onDelete: "cascade" }),
    tipologiaId: integer("tipologia_id").references(
      () => tipiInterventoTable.id,
      { onDelete: "set null" },
    ),
    tipologiaSnapshot: varchar("tipologia_snapshot", { length: 120 }).notNull(),
    descrizione: text("descrizione").notNull(),
    risultato: text("risultato"),
    operatoreId: integer("operatore_id").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("interventi_attivita_intervento_idx").on(table.interventoId),
    index("interventi_attivita_tipologia_idx").on(table.tipologiaId),
  ],
);

export type InterventoAttivita = typeof interventiAttivitaTable.$inferSelect;
