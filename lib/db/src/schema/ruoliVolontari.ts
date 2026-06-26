import { pgTable, serial, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ruoliVolontariTable = pgTable("ruoli_volontari", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 60 }).notNull().unique(),
  attivo: boolean("attivo").notNull().default(true),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertRuoloVolontarioSchema = createInsertSchema(ruoliVolontariTable).omit({ id: true, dataCreazione: true });
export type InsertRuoloVolontario = z.infer<typeof insertRuoloVolontarioSchema>;
export type RuoloVolontario = typeof ruoliVolontariTable.$inferSelect;
