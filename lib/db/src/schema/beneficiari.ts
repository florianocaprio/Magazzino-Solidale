import { pgTable, serial, varchar, text, boolean, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { cittaTable } from "./citta";
import { zoneUdsTable } from "./zoneUds";
import { magazziniTable } from "./magazzini";

export const beneficiariTable = pgTable("beneficiari", {
  id: serial("id").primaryKey(),
  codice: varchar("codice", { length: 20 }).notNull().unique(),
  codiceFiscale: varchar("codice_fiscale", { length: 16 }),
  cognome: varchar("cognome", { length: 80 }).notNull(),
  nome: varchar("nome", { length: 80 }).notNull(),
  soprannome: varchar("soprannome", { length: 80 }),
  dataNascita: date("data_nascita"),
  sesso: varchar("sesso", { length: 10 }),
  cittadinanza: varchar("cittadinanza", { length: 60 }),
  areaProvenienza: varchar("area_provenienza", { length: 10 }),
  residenza: varchar("residenza", { length: 200 }),
  domicilio: varchar("domicilio", { length: 200 }),
  comune: varchar("comune", { length: 80 }),
  zonaMunicipio: varchar("zona_municipio", { length: 80 }),
  telefono: varchar("telefono", { length: 20 }),
  email: varchar("email", { length: 120 }),
  statoCivile: varchar("stato_civile", { length: 30 }),
  numComponenti: integer("num_componenti").notNull().default(1),
  numFigliMaschi: integer("num_figli_maschi").notNull().default(0),
  numFiglieFemmine: integer("num_figlie_femmine").notNull().default(0),
  numMinori: integer("num_minori").notNull().default(0),
  numAnziani: integer("num_anziani").notNull().default(0),
  numDisabili: integer("num_disabili").notNull().default(0),
  restrizioniAlimentari: text("restrizioni_alimentari"),
  allergie: text("allergie"),
  notePaccoAlimentare: text("note_pacco_alimentare"),
  priorita: varchar("priorita", { length: 10 }).notNull().default("media"),
  consegnaDomicilio: boolean("consegna_domicilio").notNull().default(false),
  motivoConsegnaDomicilio: varchar("motivo_consegna_domicilio", { length: 60 }),
  centroAscoltoId: integer("centro_ascolto_id"),
  creditoSolidaleAbilitato: boolean("credito_solidale_abilitato").notNull().default(false),
  creditoSolidaleStato: varchar("credito_solidale_stato", { length: 30 }).notNull().default("non_abilitato"),
  creditoSolidaleDataAbilitazione: timestamp("credito_solidale_data_abilitazione"),
  creditoSolidaleNote: text("credito_solidale_note"),
  magazzinoEmporioPreferitoId: integer("magazzino_emporio_preferito_id").references(() => magazziniTable.id),
  uds: boolean("uds").notNull().default(false),
  cittaId: integer("citta_id").references(() => cittaTable.id),
  zonaUdsId: integer("zona_uds_id").references(() => zoneUdsTable.id),
  attivo: boolean("attivo").notNull().default(true),
  dataPresaInCarico: date("data_presa_in_carico"),
  noteInterne: text("note_interne"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
});

export const nucleoFamiliareTable = pgTable("nucleo_familiare", {
  id: serial("id").primaryKey(),
  beneficiarioId: integer("beneficiario_id").notNull(),
  nome: varchar("nome", { length: 80 }),
  cognome: varchar("cognome", { length: 80 }),
  dataNascita: date("data_nascita"),
  sesso: varchar("sesso", { length: 10 }),
  areaProvenienza: varchar("area_provenienza", { length: 10 }),
  relazione: varchar("relazione", { length: 60 }),
  tagliaVestiti: varchar("taglia_vestiti", { length: 20 }),
  numeroScarpe: varchar("numero_scarpe", { length: 10 }),
  esigenzeParticolari: text("esigenze_particolari"),
  note: text("note"),
});

export const insertBeneficiarioSchema = createInsertSchema(beneficiariTable).omit({ id: true, dataCreazione: true, dataAggiornamento: true });
export type InsertBeneficiario = z.infer<typeof insertBeneficiarioSchema>;
export type Beneficiario = typeof beneficiariTable.$inferSelect;

export const insertNucleoFamiliareSchema = createInsertSchema(nucleoFamiliareTable).omit({ id: true });
export type InsertNucleoFamiliare = z.infer<typeof insertNucleoFamiliareSchema>;
export type NucleoFamiliare = typeof nucleoFamiliareTable.$inferSelect;
