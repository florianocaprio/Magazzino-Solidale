import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { creditoSolidaleMovimentiTable } from "./creditoSolidaleMovimenti";

// Destinatari congelati all'avvio: una ripartenza non allarga la mensilità.
export const creditoRicaricheMensiliTable = pgTable(
  "credito_ricariche_mensili",
  {
    periodo: varchar("periodo", { length: 7 }).primaryKey(),
    avviataAt: timestamp("avviata_at", { withTimezone: true }).notNull(),
    completataAt: timestamp("completata_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "credito_ricariche_periodo_check",
      sql`${t.periodo} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
  ],
);

export const creditoRicaricheDestinatariTable = pgTable(
  "credito_ricariche_destinatari",
  {
    id: serial("id").primaryKey(),
    periodo: varchar("periodo", { length: 7 })
      .notNull()
      .references(() => creditoRicaricheMensiliTable.periodo),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    stato: varchar("stato", { length: 20 }).notNull().default("pendente"),
    causa: text("causa"),
    movimentoId: integer("movimento_id").references(
      () => creditoSolidaleMovimentiTable.id,
    ),
    aggiornataAt: timestamp("aggiornata_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("credito_ricariche_beneficiario_periodo_unique").on(
      t.beneficiarioId,
      t.periodo,
    ),
    check(
      "credito_ricariche_stato_check",
      sql`${t.stato} in ('pendente','elaborato','gia_elaborato','escluso','errore')`,
    ),
    check(
      "credito_ricariche_ricevuta_check",
      sql`(${t.stato} in ('elaborato','gia_elaborato') and ${t.movimentoId} is not null) or (${t.stato} not in ('elaborato','gia_elaborato') and ${t.movimentoId} is null)`,
    ),
  ],
);
