import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { fornitoriTable } from "./fornitori";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";

export const carichiMagazzinoTable = pgTable(
  "carichi_magazzino",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    origineCarico: varchar("origine_carico", { length: 40 }).notNull(),
    numeroDocumento: varchar("numero_documento", { length: 100 }),
    dataDocumento: date("data_documento"),
    dataCarico: date("data_carico").notNull(),
    descrizione: text("descrizione"),
    fornitoreId: integer("fornitore_id").references(() => fornitoriTable.id),
    note: text("note"),
    idempotencyKey: varchar("idempotency_key", { length: 120 }),
    requestHash: varchar("request_hash", { length: 64 }),
    stato: varchar("stato", { length: 20 }).notNull().default("confermato"),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carichi_magazzino_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("carichi_magazzino_magazzino_data_idx").on(
      table.magazzinoId,
      table.dataCarico,
    ),
    index("carichi_magazzino_documento_idx").on(
      table.magazzinoId,
      table.numeroDocumento,
    ),
    check(
      "carichi_magazzino_stato_check",
      sql`${table.stato} in ('confermato', 'stornato')`,
    ),
    check(
      "carichi_magazzino_request_hash_check",
      sql`${table.requestHash} is null or ${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const carichiMagazzinoRigheTable = pgTable(
  "carichi_magazzino_righe",
  {
    id: serial("id").primaryKey(),
    caricoMagazzinoId: integer("carico_magazzino_id")
      .notNull()
      .references(() => carichiMagazzinoTable.id),
    numeroRiga: integer("numero_riga").notNull(),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id),
    lottoId: integer("lotto_id")
      .notNull()
      .references(() => lottiTable.id),
    fondoOrigine: varchar("fondo_origine", { length: 50 }).notNull(),
    quantitaOperativa: numeric("quantita_operativa", {
      precision: 14,
      scale: 6,
    }).notNull(),
    unitaMisuraOperativa: varchar("unita_misura_operativa", {
      length: 20,
    }).notNull(),
    quantitaPezzi: numeric("quantita_pezzi", { precision: 14, scale: 6 }),
    quantitaKgLt: numeric("quantita_kg_lt", { precision: 14, scale: 6 }),
    fattoreKgLtPezzo: numeric("fattore_kg_lt_pezzo", {
      precision: 18,
      scale: 9,
    }),
    codiceLottoOriginale: varchar("codice_lotto_originale", { length: 80 }),
    dataScadenza: date("data_scadenza"),
    descrizioneEsterna: text("descrizione_esterna"),
    riferimentoEsterno: varchar("riferimento_esterno", { length: 160 }),
    note: text("note"),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carichi_magazzino_righe_numero_unique").on(
      table.caricoMagazzinoId,
      table.numeroRiga,
    ),
    index("carichi_magazzino_righe_lotto_idx").on(table.lottoId),
    index("carichi_magazzino_righe_fondo_idx").on(table.fondoOrigine),
    check(
      "carichi_magazzino_righe_quantita_check",
      sql`${table.quantitaOperativa} > 0 and (${table.quantitaPezzi} is null or ${table.quantitaPezzi} >= 0) and (${table.quantitaKgLt} is null or ${table.quantitaKgLt} >= 0)`,
    ),
  ],
);

export type CaricoMagazzino = typeof carichiMagazzinoTable.$inferSelect;
export type CaricoMagazzinoRiga =
  typeof carichiMagazzinoRigheTable.$inferSelect;
