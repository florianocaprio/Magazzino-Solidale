import { pgTable, serial, varchar, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const volontariTable = pgTable("volontari", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 80 }).notNull(),
  cognome: varchar("cognome", { length: 80 }).notNull(),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  ruolo: varchar("ruolo", { length: 40 }).notNull(),
  patente: boolean("patente").notNull().default(false),
  mezzoPersonale: boolean("mezzo_personale").notNull().default(false),
  maxConsegneTurno: integer("max_consegne_turno").notNull().default(5),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertVolontarioSchema = createInsertSchema(volontariTable).omit({ id: true, dataCreazione: true });
export type InsertVolontario = z.infer<typeof insertVolontarioSchema>;
export type Volontario = typeof volontariTable.$inferSelect;
