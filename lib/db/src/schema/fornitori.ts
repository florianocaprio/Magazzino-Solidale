import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fornitoriTable = pgTable("fornitori", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 150 }).notNull(),
  tipo: varchar("tipo", { length: 30 }).notNull(),
  partitaIva: varchar("partita_iva", { length: 20 }),
  codiceFiscale: varchar("codice_fiscale", { length: 20 }),
  indirizzo: varchar("indirizzo", { length: 200 }),
  comune: varchar("comune", { length: 80 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  referente: varchar("referente", { length: 120 }),
  siteWeb: varchar("site_web", { length: 200 }),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertFornitoreSchema = createInsertSchema(fornitoriTable).omit({ id: true, dataCreazione: true });
export type InsertFornitore = z.infer<typeof insertFornitoreSchema>;
export type Fornitore = typeof fornitoriTable.$inferSelect;
