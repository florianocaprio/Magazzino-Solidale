import { pgTable, serial, varchar, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tipiInterventoTable = pgTable("tipi_intervento", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 60 }).notNull().unique(),
  attivo: boolean("attivo").notNull().default(true),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertTipoInterventoSchema = createInsertSchema(tipiInterventoTable).omit({ id: true, dataCreazione: true });
export type InsertTipoIntervento = z.infer<typeof insertTipoInterventoSchema>;
export type TipoIntervento = typeof tipiInterventoTable.$inferSelect;
