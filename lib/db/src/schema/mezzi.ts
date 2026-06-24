import { pgTable, serial, varchar, text, boolean, timestamp, integer, decimal, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const mezziTable = pgTable("mezzi", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 20 }).notNull().unique(),
  tipo: varchar("tipo", { length: 20 }).notNull(),
  targa: varchar("targa", { length: 15 }),
  proprieta: varchar("proprieta", { length: 20 }).notNull(),
  proprietarioNome: varchar("proprietario_nome", { length: 120 }),
  capacitaColli: integer("capacita_colli"),
  capacitaKg: decimal("capacita_kg", { precision: 8, scale: 2 }),
  stato: varchar("stato", { length: 20 }).notNull().default("disponibile"),
  scadenzaAssicurazione: date("scadenza_assicurazione"),
  scadenzaRevisione: date("scadenza_revisione"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertMezzoSchema = createInsertSchema(mezziTable).omit({ id: true, dataCreazione: true });
export type InsertMezzo = z.infer<typeof insertMezzoSchema>;
export type Mezzo = typeof mezziTable.$inferSelect;
