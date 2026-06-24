import { pgTable, serial, varchar, text, boolean, timestamp, decimal, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const prodottiTable = pgTable("prodotti", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  nome: varchar("nome", { length: 150 }).notNull(),
  descrizione: text("descrizione"),
  tipoProdotto: varchar("tipo_prodotto", { length: 20 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  codiceBarre: varchar("codice_barre", { length: 50 }),
  gestioneLotto: boolean("gestione_lotto").notNull().default(false),
  gestioneScadenza: boolean("gestione_scadenza").notNull().default(false),
  scortaMinima: decimal("scorta_minima", { precision: 10, scale: 2 }).notNull().default("0"),
  scortaConsigliata: decimal("scorta_consigliata", { precision: 10, scale: 2 }).notNull().default("0"),
  conservazione: varchar("conservazione", { length: 20 }),
  taglia: varchar("taglia", { length: 20 }),
  genere: varchar("genere", { length: 20 }),
  stagione: varchar("stagione", { length: 20 }),
  condizione: varchar("condizione", { length: 30 }),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  fornitoreId: integer("fornitore_id"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertProdottoSchema = createInsertSchema(prodottiTable).omit({ id: true, dataCreazione: true });
export type InsertProdotto = z.infer<typeof insertProdottoSchema>;
export type Prodotto = typeof prodottiTable.$inferSelect;
