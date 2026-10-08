import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { menseTable } from "./mensa";

/** Assegnazione esplicita; la revoca non cancella relazione o audit. */
export const utentiMenseTable = pgTable(
  "utenti_mense",
  {
    id: serial("id").primaryKey(),
    utenteId: integer("utente_id")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id, { onDelete: "restrict" }),
    attiva: boolean("attiva").notNull().default(true),
    assegnataDa: integer("assegnata_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    assegnataAt: timestamp("assegnata_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revocataDa: integer("revocata_da").references(() => utentiTable.id, {
      onDelete: "restrict",
    }),
    revocataAt: timestamp("revocata_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("utenti_mense_coppia_unique").on(table.utenteId, table.mensaId),
    index("utenti_mense_mensa_idx").on(table.mensaId),
    check(
      "utenti_mense_revoca_check",
      sql`(${table.attiva} and ${table.revocataDa} is null and ${table.revocataAt} is null) or (not ${table.attiva} and ${table.revocataDa} is not null and ${table.revocataAt} is not null and ${table.revocataAt} >= ${table.assegnataAt})`,
    ),
  ],
);
