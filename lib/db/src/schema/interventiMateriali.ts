import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { interventiTable } from "./interventi";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";

export const interventiMaterialiTable = pgTable(
  "interventi_materiali",
  {
    id: serial("id").primaryKey(),
    interventoId: integer("intervento_id")
      .notNull()
      .references(() => interventiTable.id, { onDelete: "cascade" }),
    prodottoId: integer("prodotto_id").references(() => prodottiTable.id, {
      onDelete: "set null",
    }),
    descrizioneSnapshot: varchar("descrizione_snapshot", {
      length: 255,
    }).notNull(),
    unitaMisuraSnapshot: varchar("unita_misura_snapshot", {
      length: 40,
    }).notNull(),
    quantitaPrevista: numeric("quantita_prevista", {
      precision: 12,
      scale: 3,
    })
      .notNull()
      .default("0"),
    quantitaConsegnata: numeric("quantita_consegnata", {
      precision: 12,
      scale: 3,
    })
      .notNull()
      .default("0"),
    statoPreparazione: varchar("stato_preparazione", { length: 30 })
      .notNull()
      .default("da_preparare"),
    magazzinoId: integer("magazzino_id").references(() => magazziniTable.id, {
      onDelete: "set null",
    }),
    note: text("note"),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("interventi_materiali_intervento_idx").on(table.interventoId),
    index("interventi_materiali_prodotto_idx").on(table.prodottoId),
    index("interventi_materiali_magazzino_idx").on(table.magazzinoId),
    index("interventi_materiali_stato_idx").on(table.statoPreparazione),
    index("interventi_materiali_preparazione_idx").on(
      table.statoPreparazione,
      table.prodottoId,
      table.magazzinoId,
      table.interventoId,
    ),
    check(
      "interventi_materiali_quantita_check",
      sql`${table.quantitaPrevista} >= 0 and ${table.quantitaConsegnata} >= 0`,
    ),
    check(
      "interventi_materiali_stato_check",
      sql`${table.statoPreparazione} in ('da_preparare', 'pronto', 'consegnato', 'annullato')`,
    ),
    check(
      "interventi_materiali_descrizione_check",
      sql`length(trim(${table.descrizioneSnapshot})) > 0 and length(trim(${table.unitaMisuraSnapshot})) > 0`,
    ),
  ],
);

export type InterventoMateriale = typeof interventiMaterialiTable.$inferSelect;
