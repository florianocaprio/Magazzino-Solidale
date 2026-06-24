import { pgTable, serial, varchar, text, timestamp, integer, date, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const approvvigionamentiTable = pgTable("approvvigionamenti", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  fornitoreId: integer("fornitore_id"),
  dataRichiesta: date("data_richiesta").notNull(),
  dataPrevista: date("data_prevista"),
  stato: varchar("stato", { length: 30 }).notNull().default("bozza"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const approvvigionamentoRigheTable = pgTable("approvvigionamento_righe", {
  id: serial("id").primaryKey(),
  approvvigionamentoId: integer("approvvigionamento_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  quantitaRichiesta: decimal("quantita_richiesta", { precision: 10, scale: 2 }).notNull(),
  quantitaRicevuta: decimal("quantita_ricevuta", { precision: 10, scale: 2 }).notNull().default("0"),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  note: text("note"),
});

export const insertApprovvigionamentoSchema = createInsertSchema(approvvigionamentiTable).omit({ id: true, dataCreazione: true });
export type InsertApprovvigionamento = z.infer<typeof insertApprovvigionamentoSchema>;
export type Approvvigionamento = typeof approvvigionamentiTable.$inferSelect;
