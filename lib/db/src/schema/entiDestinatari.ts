import {
  boolean,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areeOperativeTable } from "./areeOperative";

/** Anagrafica minima degli enti esterni destinatari di documenti di consegna. */
export const entiDestinatariTable = pgTable(
  "enti_destinatari",
  {
    id: serial("id").primaryKey(),
    denominazione: varchar("denominazione", { length: 200 }).notNull(),
    indirizzo: varchar("indirizzo", { length: 250 }).notNull(),
    telefono: varchar("telefono", { length: 50 }),
    email: varchar("email", { length: 200 }),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    attivo: boolean("attivo").notNull().default(true),
    versione: integer("versione").notNull().default(1),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("enti_destinatari_area_attivo_idx").on(
      table.areaOperativaId,
      table.attivo,
      table.denominazione,
    ),
  ],
);

export const insertEnteDestinatarioSchema = createInsertSchema(
  entiDestinatariTable,
).omit({ id: true, dataCreazione: true, dataAggiornamento: true });
export type InsertEnteDestinatario = z.infer<
  typeof insertEnteDestinatarioSchema
>;
export type EnteDestinatario = typeof entiDestinatariTable.$inferSelect;
