import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  date,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { areeOperativeTable } from "./areeOperative";
import { prodottiTable } from "./prodotti";
import { utentiTable } from "./auth";

export const lottiProduttoreTable = pgTable(
  "lotti_produttore",
  {
    id: serial("id").primaryKey(),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id, { onDelete: "restrict" }),
    codiceOriginale: varchar("codice_originale", { length: 80 }),
    codiceCanonico: varchar("codice_canonico", { length: 240 }),
    riferimentoInterno: varchar("riferimento_interno", {
      length: 80,
    }).notNull(),
    dataScadenza: date("data_scadenza"),
    produttore: varchar("produttore", { length: 200 }),
    produttoreCanonico: varchar("produttore_canonico", { length: 600 }),
    note: text("note"),
    origine: varchar("origine", { length: 20 }),
    fonte: text("fonte"),
    primoAutoreId: integer("primo_autore_id").references(() => utentiTable.id, {
      onDelete: "restrict",
    }),
    primaCreazioneAt: timestamp("prima_creazione_at", { withTimezone: true }),
    dataAssociazione: timestamp("data_associazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    idempotencyKey: varchar("idempotency_key", { length: 100 }),
    requestHash: varchar("request_hash", { length: 64 }),
  },
  (t) => [
    uniqueIndex("lotti_produttore_codice_unique")
      .on(t.areaOperativaId, t.prodottoId, t.codiceCanonico)
      .where(sql`${t.codiceCanonico} is not null`),
    uniqueIndex("lotti_produttore_ref_unique").on(t.riferimentoInterno),
    uniqueIndex("lotti_produttore_command_unique")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    check(
      "lotti_produttore_origine_check",
      sql`${t.origine} is null or ${t.origine} in ('MANUALE','AUTOMATICO','IMPORTATO')`,
    ),
  ],
);
