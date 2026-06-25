import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cittaTable = pgTable("citta", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  provincia: varchar("provincia", { length: 80 }),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertCittaSchema = createInsertSchema(cittaTable).omit({ id: true, dataCreazione: true });
export type InsertCitta = z.infer<typeof insertCittaSchema>;
export type Citta = typeof cittaTable.$inferSelect;
