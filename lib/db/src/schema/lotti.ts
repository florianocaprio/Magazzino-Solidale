import { pgTable, serial, varchar, text, boolean, timestamp, decimal, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const lottiTable = pgTable("lotti", {
  id: serial("id").primaryKey(),
  prodottoId: integer("prodotto_id").notNull(),
  codiceLotto: varchar("codice_lotto", { length: 80 }),
  dataScadenza: date("data_scadenza"),
  dataCarico: date("data_carico").notNull(),
  quantitaCaricata: decimal("quantita_caricata", { precision: 10, scale: 2 }).notNull(),
  quantitaResidua: decimal("quantita_residua", { precision: 10, scale: 2 }).notNull(),
  magazzinoId: integer("magazzino_id").notNull(),
  fornitoreId: integer("fornitore_id"),
  documentoCarico: varchar("documento_carico", { length: 100 }),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertLottoSchema = createInsertSchema(lottiTable).omit({ id: true, dataCreazione: true });
export type InsertLotto = z.infer<typeof insertLottoSchema>;
export type Lotto = typeof lottiTable.$inferSelect;
