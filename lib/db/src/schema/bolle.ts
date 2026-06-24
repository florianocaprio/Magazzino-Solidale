import { pgTable, serial, varchar, text, boolean, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bolleTable = pgTable("bolle", {
  id: serial("id").primaryKey(),
  numeroBolla: varchar("numero_bolla", { length: 30 }).notNull().unique(),
  dataBolla: date("data_bolla").notNull(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  consegnaId: integer("consegna_id"),
  magazzinoId: integer("magazzino_id").notNull(),
  indirizzoConsegna: varchar("indirizzo_consegna", { length: 200 }),
  operatoreId: integer("operatore_id"),
  volontarioConsegnaId: integer("volontario_consegna_id"),
  mezzoId: integer("mezzo_id"),
  stato: varchar("stato", { length: 20 }).notNull().default("bozza"),
  noteConsegna: text("note_consegna"),
  confermaRicezione: boolean("conferma_ricezione").notNull().default(false),
  noteRicezione: text("note_ricezione"),
  firmaNota: text("firma_nota"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertBollaSchema = createInsertSchema(bolleTable).omit({ id: true, dataCreazione: true });
export type InsertBolla = z.infer<typeof insertBollaSchema>;
export type Bolla = typeof bolleTable.$inferSelect;
