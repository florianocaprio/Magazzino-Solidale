import { pgTable, serial, varchar, text, boolean, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const consegneTable = pgTable("consegne", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  tipoConsegna: varchar("tipo_consegna", { length: 20 }).notNull(),
  dataPrevista: date("data_prevista").notNull(),
  fasciaOraria: varchar("fascia_oraria", { length: 30 }),
  indirizzoConsegna: varchar("indirizzo_consegna", { length: 200 }),
  zona: varchar("zona", { length: 80 }),
  magazzinoId: integer("magazzino_id").notNull(),
  volontarioId: integer("volontario_id"),
  mezzoId: integer("mezzo_id"),
  stato: varchar("stato", { length: 20 }).notNull().default("pianificata"),
  motivo_mancata: text("motivo_mancata"),
  noteOperative: text("note_operative"),
  dataEffettuata: timestamp("data_effettuata"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertConsegnaSchema = createInsertSchema(consegneTable).omit({ id: true, dataCreazione: true });
export type InsertConsegna = z.infer<typeof insertConsegnaSchema>;
export type Consegna = typeof consegneTable.$inferSelect;
