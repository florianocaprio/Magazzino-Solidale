import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const centriAscoltoTable = pgTable("centri_di_ascolto", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  indirizzo: varchar("indirizzo", { length: 200 }),
  comune: varchar("comune", { length: 80 }),
  responsabile: varchar("responsabile", { length: 120 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertCentroAscoltoSchema = createInsertSchema(centriAscoltoTable).omit({ id: true, dataCreazione: true });
export type InsertCentroAscolto = z.infer<typeof insertCentroAscoltoSchema>;
export type CentroAscolto = typeof centriAscoltoTable.$inferSelect;
