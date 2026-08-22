import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { magazziniTable } from "./magazzini";

export const operazioniDistribuzioneMagazzinoTable = pgTable(
  "operazioni_distribuzione_magazzino",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    dataDistribuzione: date("data_distribuzione").notNull(),
    canaleOperativo: varchar("canale_operativo", { length: 40 }).notNull(),
    dominioOrigine: varchar("dominio_origine", { length: 40 }).notNull(),
    entitaOrigineTipo: varchar("entita_origine_tipo", { length: 80 }).notNull(),
    entitaOrigineId: integer("entita_origine_id").notNull(),
    numeroDocumento: varchar("numero_documento", { length: 100 }),
    numeroPacchi: integer("numero_pacchi"),
    numeroPasti: integer("numero_pasti"),
    indigentiSaltuari: integer("indigenti_saltuari"),
    indigentiContinuativi: integer("indigenti_continuativi"),
    stato: varchar("stato", { length: 20 }).notNull().default("confermata"),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operazioni_distribuzione_sorgente_unique").on(
      table.dominioOrigine,
      table.entitaOrigineTipo,
      table.entitaOrigineId,
    ),
    index("operazioni_distribuzione_mag_data_idx").on(
      table.magazzinoId,
      table.dataDistribuzione,
    ),
    index("operazioni_distribuzione_canale_idx").on(table.canaleOperativo),
    check(
      "operazioni_distribuzione_stato_check",
      sql`${table.stato} in ('confermata', 'stornata')`,
    ),
    check(
      "operazioni_distribuzione_conteggi_check",
      sql`(${table.numeroPacchi} is null or ${table.numeroPacchi} >= 0) and (${table.numeroPasti} is null or ${table.numeroPasti} >= 0) and (${table.indigentiSaltuari} is null or ${table.indigentiSaltuari} >= 0) and (${table.indigentiContinuativi} is null or ${table.indigentiContinuativi} >= 0)`,
    ),
  ],
);

export type OperazioneDistribuzioneMagazzino =
  typeof operazioniDistribuzioneMagazzinoTable.$inferSelect;
