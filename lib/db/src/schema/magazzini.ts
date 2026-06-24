import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const magazziniTable = pgTable("magazzini", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 20 }).notNull().unique(),
  nome: varchar("nome", { length: 120 }).notNull(),
  indirizzo: varchar("indirizzo", { length: 200 }),
  comune: varchar("comune", { length: 80 }),
  zona: varchar("zona", { length: 80 }),
  responsabile: varchar("responsabile", { length: 120 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  stato: varchar("stato", { length: 20 }).notNull().default("attivo"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertMagazzinoSchema = createInsertSchema(magazziniTable).omit({ id: true, dataCreazione: true });
export type InsertMagazzino = z.infer<typeof insertMagazzinoSchema>;
export type Magazzino = typeof magazziniTable.$inferSelect;
