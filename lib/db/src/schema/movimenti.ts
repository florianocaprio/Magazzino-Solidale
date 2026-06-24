import { pgTable, serial, varchar, text, timestamp, decimal, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const movimentiTable = pgTable("movimenti", {
  id: serial("id").primaryKey(),
  tipoMovimento: varchar("tipo_movimento", { length: 20 }).notNull(),
  tipoDettaglio: varchar("tipo_dettaglio", { length: 40 }).notNull(),
  dataMovimento: date("data_movimento").notNull(),
  magazzinoId: integer("magazzino_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  lottoId: integer("lotto_id"),
  quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  fornitoreId: integer("fornitore_id"),
  beneficiarioId: integer("beneficiario_id"),
  bollaId: integer("bolla_id"),
  trasferimentoId: integer("trasferimento_id"),
  documentoRiferimento: varchar("documento_riferimento", { length: 100 }),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertMovimentoSchema = createInsertSchema(movimentiTable).omit({ id: true, dataCreazione: true });
export type InsertMovimento = z.infer<typeof insertMovimentoSchema>;
export type Movimento = typeof movimentiTable.$inferSelect;
