import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  varchar,
  timestamp,
  integer,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { centriAscoltoTable } from "./centri";
import { mezziTable } from "./mezzi";
import { volontariTable } from "./volontari";

export const turniTable = pgTable(
  "turni",
  {
    id: serial("id").primaryKey(),
    centroAscoltoId: integer("centro_ascolto_id")
      .notNull()
      .references(() => centriAscoltoTable.id, { onDelete: "restrict" }),
    data: date("data").notNull(),
    fascia: varchar("fascia", { length: 20 }).notNull(),
    mezzoId: integer("mezzo_id").references(() => mezziTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("turni_centro_data_fascia_unique").on(
      table.centroAscoltoId,
      table.data,
      table.fascia,
    ),
    uniqueIndex("turni_mezzo_data_fascia_unique")
      .on(table.mezzoId, table.data, table.fascia)
      .where(sql`${table.mezzoId} is not null`),
  ],
);

export const turniVolontariTable = pgTable(
  "turni_volontari",
  {
    id: serial("id").primaryKey(),
    turnoId: integer("turno_id")
      .notNull()
      .references(() => turniTable.id, { onDelete: "cascade" }),
    volontarioId: integer("volontario_id")
      .notNull()
      .references(() => volontariTable.id, { onDelete: "restrict" }),
    ruolo: varchar("ruolo", { length: 80 }),
  },
  (table) => [
    uniqueIndex("turni_volontari_turno_volontario_unique").on(
      table.turnoId,
      table.volontarioId,
    ),
  ],
);

export const insertTurnoSchema = createInsertSchema(turniTable).omit({
  id: true,
  dataCreazione: true,
});
export type InsertTurno = z.infer<typeof insertTurnoSchema>;
export type Turno = typeof turniTable.$inferSelect;
export type TurnoVolontario = typeof turniVolontariTable.$inferSelect;
