import { pgTable, serial, varchar, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const turniTable = pgTable("turni", {
  id: serial("id").primaryKey(),
  centroAscoltoId: integer("centro_ascolto_id").notNull(),
  data: date("data").notNull(),
  fascia: varchar("fascia", { length: 20 }).notNull(),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const turniVolontariTable = pgTable("turni_volontari", {
  id: serial("id").primaryKey(),
  turnoId: integer("turno_id").notNull(),
  volontarioId: integer("volontario_id").notNull(),
  ruolo: varchar("ruolo", { length: 80 }),
});

export const insertTurnoSchema = createInsertSchema(turniTable).omit({ id: true, dataCreazione: true });
export type InsertTurno = z.infer<typeof insertTurnoSchema>;
export type Turno = typeof turniTable.$inferSelect;
export type TurnoVolontario = typeof turniVolontariTable.$inferSelect;
