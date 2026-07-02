import { pgTable, serial, varchar, text, boolean, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { magazziniTable } from "./magazzini";

export const consegneTable = pgTable("consegne", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 30 }).notNull().unique(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  tipoPianificazione: varchar("tipo_pianificazione", { length: 30 }).notNull().default("consegna_pacco"),
  tipoConsegna: varchar("tipo_consegna", { length: 20 }).notNull(),
  dataPrevista: date("data_prevista").notNull(),
  fasciaOraria: varchar("fascia_oraria", { length: 30 }),
  indirizzoConsegna: varchar("indirizzo_consegna", { length: 200 }),
  zona: varchar("zona", { length: 80 }),
  magazzinoId: integer("magazzino_id").notNull(),
  volontarioId: integer("volontario_id"),
  volontarioAltro: text("volontario_altro"),
  mezzoId: integer("mezzo_id"),
  mezzoAltro: boolean("mezzo_altro").notNull().default(false),
  stato: varchar("stato", { length: 20 }).notNull().default("pianificata"),
  motivo_mancata: text("motivo_mancata"),
  noteOperative: text("note_operative"),
  dataEffettuata: timestamp("data_effettuata"),
  magazzinoEmporioId: integer("magazzino_emporio_id").references(() => magazziniTable.id),
  dataOraInizio: timestamp("data_ora_inizio"),
  dataOraFine: timestamp("data_ora_fine"),
  statoAccessoEmporio: varchar("stato_accesso_emporio", { length: 40 }),
  motivoAnnullamento: text("motivo_annullamento"),
  noteAccessoEmporio: text("note_accesso_emporio"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertConsegnaSchema = createInsertSchema(consegneTable).omit({ id: true, dataCreazione: true });
export type InsertConsegna = z.infer<typeof insertConsegnaSchema>;
export type Consegna = typeof consegneTable.$inferSelect;
