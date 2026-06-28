import { pgTable, serial, varchar, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const fornitoriTable = pgTable("fornitori", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 150 }).notNull(),
  tipo: varchar("tipo", { length: 30 }).notNull(),
  partitaIva: varchar("partita_iva", { length: 20 }),
  codiceFiscale: varchar("codice_fiscale", { length: 20 }),
  indirizzo: varchar("indirizzo", { length: 200 }),
  comune: varchar("comune", { length: 80 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  referente: varchar("referente", { length: 120 }),
  siteWeb: varchar("site_web", { length: 200 }),
  // Fornitore/Donatore is scoped by Città ("Area"). NULL = valido per tutte le città.
  // The legacy centroAscoltoId column is kept for back-compat but no longer used for scoping.
  cittaId: integer("citta_id"),
  centroAscoltoId: integer("centro_ascolto_id"),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  noteOperative: text("note_operative"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertFornitoreSchema = createInsertSchema(fornitoriTable).omit({ id: true, dataCreazione: true });
export type InsertFornitore = z.infer<typeof insertFornitoreSchema>;
export type Fornitore = typeof fornitoriTable.$inferSelect;
