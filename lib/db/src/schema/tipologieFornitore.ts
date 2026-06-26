import { pgTable, serial, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tipologieFornitoreTable = pgTable("tipologie_fornitore", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 30 }).notNull().unique(),
  attivo: boolean("attivo").notNull().default(true),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertTipologiaFornitoreSchema = createInsertSchema(tipologieFornitoreTable).omit({ id: true, dataCreazione: true });
export type InsertTipologiaFornitore = z.infer<typeof insertTipologiaFornitoreSchema>;
export type TipologiaFornitore = typeof tipologieFornitoreTable.$inferSelect;
