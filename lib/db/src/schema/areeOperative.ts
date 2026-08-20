import { pgTable, serial, varchar, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const areeOperativeTable = pgTable("aree_operative", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  provincia: varchar("provincia", { length: 80 }),
  sigla: varchar("sigla", { length: 2 }),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertAreaOperativaSchema = createInsertSchema(areeOperativeTable).omit({ id: true, dataCreazione: true });
export type InsertAreaOperativa = z.infer<typeof insertAreaOperativaSchema>;
export type AreaOperativa = typeof areeOperativeTable.$inferSelect;
