import { pgTable, serial, varchar, text, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const interventiTable = pgTable("interventi", {
  id: serial("id").primaryKey(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  dataIntervento: date("data_intervento").notNull(),
  tipoIntervento: varchar("tipo_intervento", { length: 50 }).notNull(),
  descrizione: text("descrizione"),
  esito: text("esito"),
  prossimAzione: text("prossim_azione"),
  dataFollowup: date("data_followup"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertInterventoSchema = createInsertSchema(interventiTable).omit({ id: true, dataCreazione: true });
export type InsertIntervento = z.infer<typeof insertInterventoSchema>;
export type Intervento = typeof interventiTable.$inferSelect;
