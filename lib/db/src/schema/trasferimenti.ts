import { pgTable, serial, varchar, text, timestamp, integer, date, decimal } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { utentiTable } from "./auth";

export const trasferimentiTable = pgTable("trasferimenti", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  magazzinoOrigineId: integer("magazzino_origine_id").notNull(),
  magazzinoDestinoId: integer("magazzino_destino_id").notNull(),
  dataRichiesta: date("data_richiesta").notNull(),
  dataEsecuzione: date("data_esecuzione"),
  dataConfermaRicezione: date("data_conferma_ricezione"),
  stato: varchar("stato", { length: 20 }).notNull().default("richiesto"),
  note: text("note"),
  operatoreId: integer("operatore_id").references(() => utentiTable.id),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const trasferimentoRigheTable = pgTable("trasferimento_righe", {
  id: serial("id").primaryKey(),
  trasferimentoId: integer("trasferimento_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  lottoId: integer("lotto_id"),
  quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  note: text("note"),
});

export const insertTrasferimentoSchema = createInsertSchema(trasferimentiTable).omit({ id: true, dataCreazione: true });
export type InsertTrasferimento = z.infer<typeof insertTrasferimentoSchema>;
export type Trasferimento = typeof trasferimentiTable.$inferSelect;

export const insertTrasferimentoRigaSchema = createInsertSchema(trasferimentoRigheTable).omit({ id: true });
export type InsertTrasferimentoRiga = z.infer<typeof insertTrasferimentoRigaSchema>;
export type TrasferimentoRiga = typeof trasferimentoRigheTable.$inferSelect;
