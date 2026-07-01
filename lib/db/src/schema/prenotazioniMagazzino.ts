import { sql } from "drizzle-orm";
import { check, decimal, index, integer, pgTable, serial, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bolleTable, bollaRigheTable } from "./bolle";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";

export const prenotazioniMagazzinoTable = pgTable(
  "prenotazioni_magazzino",
  {
    id: serial("id").primaryKey(),
    bollaId: integer("bolla_id").notNull().references(() => bolleTable.id),
    rigaBollaId: integer("riga_bolla_id").notNull().references(() => bollaRigheTable.id),
    prodottoId: integer("prodotto_id").notNull().references(() => prodottiTable.id),
    lottoId: integer("lotto_id").notNull().references(() => lottiTable.id),
    magazzinoId: integer("magazzino_id").notNull().references(() => magazziniTable.id),
    quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull().default("attiva"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("prenotazioni_magazzino_mag_prod_stato_idx").on(table.magazzinoId, table.prodottoId, table.stato),
    index("prenotazioni_magazzino_lotto_stato_idx").on(table.lottoId, table.stato),
    index("prenotazioni_magazzino_bolla_idx").on(table.bollaId),
    index("prenotazioni_magazzino_riga_bolla_idx").on(table.rigaBollaId),
    index("prenotazioni_magazzino_stato_idx").on(table.stato),
    check("prenotazioni_magazzino_quantita_positive", sql`${table.quantita} > 0`),
  ],
);

export const insertPrenotazioneMagazzinoSchema = createInsertSchema(prenotazioniMagazzinoTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPrenotazioneMagazzino = z.infer<typeof insertPrenotazioneMagazzinoSchema>;
export type PrenotazioneMagazzino = typeof prenotazioniMagazzinoTable.$inferSelect;
