import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  timestamp,
  text,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { areeOperativeTable } from "./areeOperative";
import { utentiTable } from "./auth";

/** Diritto corrente per Area, distinto da tessere, saldo e preferenza Emporio.
 * Transizioni nell'audit append-only; nessun backfill legacy. */
export const emporioAbilitazioniTable = pgTable(
  "emporio_abilitazioni",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id),
    stato: varchar("stato", { length: 20 }).notNull(),
    dataEffetto: timestamp("data_effetto", { withTimezone: true })
      .notNull()
      .defaultNow(),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    motivo: text("motivo").notNull(),
  },
  (t) => [
    uniqueIndex("emporio_abilitazioni_beneficiario_area_unique").on(
      t.beneficiarioId,
      t.areaOperativaId,
    ),
    check(
      "emporio_abilitazioni_stato_check",
      sql`${t.stato} in ('attivo','sospeso','revocato')`,
    ),
    check(
      "emporio_abilitazioni_motivo_check",
      sql`length(trim(${t.motivo})) > 0`,
    ),
  ],
);
