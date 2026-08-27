import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, boolean, timestamp, integer, uniqueIndex, index, date, check } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { centriAscoltoTable } from "./centri";
import { ruoliVolontariTable } from "./ruoliVolontari";

export const volontariTable = pgTable(
  "volontari",
  {
    id: serial("id").primaryKey(),
    nome: varchar("nome", { length: 80 }).notNull(),
    cognome: varchar("cognome", { length: 80 }).notNull(),
    matricola: varchar("matricola", { length: 40 }),
    tipoVolontario: varchar("tipo_volontario", { length: 20 }).notNull().default("PERMANENTE"),
    centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
    telefono: varchar("telefono", { length: 20 }),
    telefonoSecondario: varchar("telefono_secondario", { length: 20 }),
    email: varchar("email", { length: 120 }),
    luogoNascita: varchar("luogo_nascita", { length: 120 }),
    dataNascita: date("data_nascita"),
    indirizzoResidenza: varchar("indirizzo_residenza", { length: 240 }),
    codiceFiscale: varchar("codice_fiscale", { length: 32 }),
    codiceFiscaleNormalizzato: varchar("codice_fiscale_normalizzato", { length: 32 }),
    dataInizioImportata: date("data_inizio_importata"),
    categoriaImportataOriginale: varchar("categoria_importata_originale", { length: 160 }),
    gruppoImportatoOriginale: varchar("gruppo_importato_originale", { length: 160 }),
    ruolo: varchar("ruolo", { length: 40 }).notNull(),
    ruoloVolontarioId: integer("ruolo_volontario_id").references(
      () => ruoliVolontariTable.id,
      { onDelete: "restrict" },
    ),
    patente: boolean("patente").notNull().default(false),
    mezzoPersonale: boolean("mezzo_personale").notNull().default(false),
    maxConsegneTurno: integer("max_consegne_turno").notNull().default(5),
    attivo: boolean("attivo").notNull().default(false),
    statoApprovazione: varchar("stato_approvazione", { length: 20 }).notNull().default("in_attesa"),
    note: text("note"),
    versione: integer("versione").notNull().default(1),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("volontari_matricola_unique").on(table.matricola),
    index("volontari_codice_fiscale_norm_idx").on(table.codiceFiscaleNormalizzato),
    index("volontari_tipo_idx").on(table.tipoVolontario),
    check(
      "volontari_tipo_check",
      sql`${table.tipoVolontario} in ('PERMANENTE','TEMPORANEO')`,
    ),
  ],
);

export const insertVolontarioSchema = createInsertSchema(volontariTable).omit({
  id: true,
  versione: true,
  dataCreazione: true,
  dataAggiornamento: true,
});
export type InsertVolontario = z.infer<typeof insertVolontarioSchema>;
export type Volontario = typeof volontariTable.$inferSelect;
