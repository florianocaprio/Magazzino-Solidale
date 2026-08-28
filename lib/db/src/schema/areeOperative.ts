import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const areeOperativeTable = pgTable(
  "aree_operative",
  {
    id: serial("id").primaryKey(),
    nome: varchar("nome", { length: 120 }).notNull(),
    provincia: varchar("provincia", { length: 80 }),
    sigla: varchar("sigla", { length: 2 }),
    codiceMatricola: varchar("codice_matricola", { length: 8 }),
    attivo: boolean("attivo").notNull().default(true),
    note: text("note"),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("aree_operative_codice_matricola_unique")
      .on(table.codiceMatricola)
      .where(sql`${table.codiceMatricola} is not null`),
  ],
);

export const insertAreaOperativaSchema = createInsertSchema(areeOperativeTable).omit({ id: true, dataCreazione: true });
export type InsertAreaOperativa = z.infer<typeof insertAreaOperativaSchema>;
export type AreaOperativa = typeof areeOperativeTable.$inferSelect;
