import { pgTable, serial, varchar, text, boolean, timestamp, decimal, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { utentiTable } from "./auth";

export const bolleTable = pgTable("bolle", {
  id: serial("id").primaryKey(),
  numeroBolla: varchar("numero_bolla", { length: 30 }).notNull().unique(),
  dataBolla: date("data_bolla").notNull(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  consegnaId: integer("consegna_id"),
  magazzinoId: integer("magazzino_id").notNull(),
  indirizzoConsegna: varchar("indirizzo_consegna", { length: 200 }),
  operatoreId: integer("operatore_id").references(() => utentiTable.id),
  volontarioConsegnaId: integer("volontario_consegna_id"),
  trasportatoreNome: varchar("trasportatore_nome", { length: 120 }),
  mezzoId: integer("mezzo_id"),
  stato: varchar("stato", { length: 20 }).notNull().default("bozza"),
  noteConsegna: text("note_consegna"),
  confermaRicezione: boolean("conferma_ricezione").notNull().default(false),
  noteRicezione: text("note_ricezione"),
  firmaNota: text("firma_nota"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const bollaRigheTable = pgTable("bolla_righe", {
  id: serial("id").primaryKey(),
  bollaId: integer("bolla_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  lottoId: integer("lotto_id"),
  quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull().default("pz"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertBollaSchema = createInsertSchema(bolleTable).omit({ id: true, dataCreazione: true });
export type InsertBolla = z.infer<typeof insertBollaSchema>;
export type Bolla = typeof bolleTable.$inferSelect;

export const insertBollaRigaSchema = createInsertSchema(bollaRigheTable).omit({ id: true, dataCreazione: true });
export type InsertBollaRiga = z.infer<typeof insertBollaRigaSchema>;
export type BollaRiga = typeof bollaRigheTable.$inferSelect;
