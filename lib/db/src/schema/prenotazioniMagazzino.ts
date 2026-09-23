import { sql } from "drizzle-orm";
import {
  check,
  decimal,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { bolleTable, bollaRigheTable } from "./bolle";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";
import { trasferimentiTable, trasferimentoRigheTable } from "./trasferimenti";

export const prenotazioniMagazzinoTable = pgTable(
  "prenotazioni_magazzino",
  {
    id: serial("id").primaryKey(),
    bollaId: integer("bolla_id").references(() => bolleTable.id),
    rigaBollaId: integer("riga_bolla_id").references(() => bollaRigheTable.id),
    trasferimentoId: integer("trasferimento_id").references(
      () => trasferimentiTable.id,
    ),
    rigaTrasferimentoId: integer("riga_trasferimento_id").references(
      () => trasferimentoRigheTable.id,
    ),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id),
    lottoId: integer("lotto_id")
      .notNull()
      .references(() => lottiTable.id),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    quantita: decimal("quantita", { precision: 14, scale: 6 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull().default("attiva"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("prenotazioni_magazzino_mag_prod_stato_idx").on(
      table.magazzinoId,
      table.prodottoId,
      table.stato,
    ),
    index("prenotazioni_magazzino_lotto_stato_idx").on(
      table.lottoId,
      table.stato,
    ),
    index("prenotazioni_magazzino_bolla_idx").on(table.bollaId),
    index("prenotazioni_magazzino_riga_bolla_idx").on(table.rigaBollaId),
    index("prenotazioni_magazzino_trasferimento_stato_idx").on(
      table.trasferimentoId,
      table.stato,
    ),
    index("prenotazioni_magazzino_riga_trasferimento_idx").on(
      table.rigaTrasferimentoId,
    ),
    index("prenotazioni_magazzino_stato_idx").on(table.stato),
    check(
      "prenotazioni_magazzino_quantita_positive",
      sql`${table.quantita} > 0`,
    ),
    check(
      "prenotazioni_magazzino_owner_exclusive",
      sql`(${table.bollaId} is not null and ${table.rigaBollaId} is not null and ${table.trasferimentoId} is null and ${table.rigaTrasferimentoId} is null) or (${table.bollaId} is null and ${table.rigaBollaId} is null and ${table.trasferimentoId} is not null and ${table.rigaTrasferimentoId} is not null)`,
    ),
  ],
);

export const insertPrenotazioneMagazzinoSchema = createInsertSchema(
  prenotazioniMagazzinoTable,
).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPrenotazioneMagazzino = z.infer<
  typeof insertPrenotazioneMagazzinoSchema
>;
export type PrenotazioneMagazzino =
  typeof prenotazioniMagazzinoTable.$inferSelect;
