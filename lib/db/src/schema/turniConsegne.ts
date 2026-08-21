import {
  pgTable,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { consegneTable } from "./consegne";
import { mezziTable } from "./mezzi";
import { turniTable } from "./turni";
import { volontariTable } from "./volontari";

/**
 * Provenienza persistita delle assegnazioni create dalla pianificazione
 * Consegne. L'assenza di una riga indica deliberatamente origine
 * manuale/legacy: la migration non deduce relazioni dai dati storici.
 */
export const turniConsegneTable = pgTable(
  "turni_consegne",
  {
    id: serial("id").primaryKey(),
    turnoId: integer("turno_id")
      .notNull()
      .references(() => turniTable.id, { onDelete: "restrict" }),
    consegnaId: integer("consegna_id")
      .notNull()
      .references(() => consegneTable.id, { onDelete: "restrict" }),
    volontarioId: integer("volontario_id").references(() => volontariTable.id, {
      onDelete: "restrict",
    }),
    mezzoId: integer("mezzo_id").references(() => mezziTable.id, {
      onDelete: "restrict",
    }),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("turni_consegne_consegna_unique").on(table.consegnaId),
  ],
);

export type TurnoConsegna = typeof turniConsegneTable.$inferSelect;
