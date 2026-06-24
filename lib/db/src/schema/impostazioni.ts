import { pgTable, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Singleton: una sola riga (id = 1) con le impostazioni di stampa delle bolle.
export const impostazioniStampaTable = pgTable("impostazioni_stampa", {
  id: integer("id").primaryKey().default(1),
  templateBolla: varchar("template_bolla", { length: 40 }).notNull().default("standard"),
  footerBolla: text("footer_bolla"),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
});

export const updateImpostazioniStampaSchema = createInsertSchema(impostazioniStampaTable)
  .omit({ id: true, dataAggiornamento: true })
  .partial();
export type UpdateImpostazioniStampa = z.infer<typeof updateImpostazioniStampaSchema>;
export type ImpostazioniStampa = typeof impostazioniStampaTable.$inferSelect;
