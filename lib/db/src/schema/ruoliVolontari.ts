import { pgTable, serial, varchar, boolean, timestamp, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ruoliVolontariTable = pgTable("ruoli_volontari", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 60 }).notNull().unique(),
  // Nullable only for compatibility with historical fixture/setup code. Every
  // application write fills it and the migration backfills all existing rows.
  nomeNormalizzato: varchar("nome_normalizzato", { length: 80 }),
  descrizione: text("descrizione"),
  attivo: boolean("attivo").notNull().default(true),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("ruoli_volontari_nome_normalizzato_unique").on(table.nomeNormalizzato),
]);

export const insertRuoloVolontarioSchema = createInsertSchema(ruoliVolontariTable).omit({ id: true, dataCreazione: true, dataAggiornamento: true });
export type InsertRuoloVolontario = z.infer<typeof insertRuoloVolontarioSchema>;
export type RuoloVolontario = typeof ruoliVolontariTable.$inferSelect;
