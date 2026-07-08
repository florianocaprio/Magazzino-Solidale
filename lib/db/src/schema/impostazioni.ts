import { pgTable, integer, varchar, text, timestamp, boolean } from "drizzle-orm/pg-core";
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

// Singleton: una sola riga (id = 1) con la configurazione email.
// provider: "connector" = connettore Gmail Replit (default); "smtp" = SMTP custom.
// smtpPassword è write-only: mai restituita dalle API (solo flag hasPassword).
export const impostazioniEmailTable = pgTable("impostazioni_email", {
  id: integer("id").primaryKey().default(1),
  provider: varchar("provider", { length: 20 }).notNull().default("connector"),
  mittenteEmail: varchar("mittente_email", { length: 255 }),
  mittenteNome: varchar("mittente_nome", { length: 255 }),
  adminEmail: varchar("admin_email", { length: 255 }),
  smtpHost: varchar("smtp_host", { length: 255 }),
  smtpPort: integer("smtp_port"),
  smtpSecure: boolean("smtp_secure").notNull().default(false),
  smtpUser: varchar("smtp_user", { length: 255 }),
  smtpPassword: text("smtp_password"),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
});

export type ImpostazioniEmail = typeof impostazioniEmailTable.$inferSelect;

// Legacy compatibility only: runtime module flags live in ambiente_moduli.
export const impostazioniModuliTable = pgTable("impostazioni_moduli", {
  id: integer("id").primaryKey().default(1),
  emporioAbilitato: boolean("emporio_abilitato").notNull().default(false),
  unitaStradaAbilitata: boolean("unita_strada_abilitata").notNull().default(true),
  dataAggiornamento: timestamp("data_aggiornamento"),
});

export type ImpostazioniModuli = typeof impostazioniModuliTable.$inferSelect;
