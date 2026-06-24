import { pgTable, serial, varchar, text, timestamp, integer, date, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scarichiTable = pgTable("scarichi", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  magazzinoId: integer("magazzino_id").notNull(),
  dataScarico: date("data_scarico").notNull(),
  causale: varchar("causale", { length: 30 }).notNull(),
  causaleAltro: text("causale_altro"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const scaricoRigheTable = pgTable("scarico_righe", {
  id: serial("id").primaryKey(),
  scaricoId: integer("scarico_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  note: text("note"),
});

export const insertScaricoSchema = createInsertSchema(scarichiTable).omit({ id: true, dataCreazione: true });
export type InsertScarico = z.infer<typeof insertScaricoSchema>;
export type Scarico = typeof scarichiTable.$inferSelect;

export const insertScaricoRigaSchema = createInsertSchema(scaricoRigheTable).omit({ id: true });
export type InsertScaricoRiga = z.infer<typeof insertScaricoRigaSchema>;
export type ScaricoRiga = typeof scaricoRigheTable.$inferSelect;
