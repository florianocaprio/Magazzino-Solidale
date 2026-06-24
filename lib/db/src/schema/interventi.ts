import { pgTable, serial, varchar, text, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { utentiTable } from "./auth";

export const interventiTable = pgTable("interventi", {
  id: serial("id").primaryKey(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  bollaId: integer("bolla_id"),
  operatoreId: integer("operatore_id").references(() => utentiTable.id),
  dataIntervento: date("data_intervento").notNull(),
  tipoIntervento: varchar("tipo_intervento", { length: 120 }).notNull(),
  descrizione: text("descrizione"),
  esito: text("esito"),
  prossimAzione: text("prossim_azione"),
  dataFollowup: date("data_followup"),
  scadenzaIsee: date("scadenza_isee"),
  scadenzaRinnovo: date("scadenza_rinnovo"),
  scadenzaAutodichiarazioneIndigenza: date("scadenza_autodichiarazione_indigenza"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertInterventoSchema = createInsertSchema(interventiTable).omit({ id: true, dataCreazione: true });
export type InsertIntervento = z.infer<typeof insertInterventoSchema>;
export type Intervento = typeof interventiTable.$inferSelect;
