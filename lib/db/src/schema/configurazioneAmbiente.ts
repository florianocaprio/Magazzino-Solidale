import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";

export const configurazioneAmbienteTable = pgTable("configurazione_ambiente", {
  id: integer("id").primaryKey().default(1),
  codiceAmbiente: varchar("codice_ambiente", { length: 80 }).notNull().default("angeli-in-moto"),
  nomeAmbiente: varchar("nome_ambiente", { length: 160 }).notNull().default("Magazzino Solidale AIM"),
  nomeAssociazione: varchar("nome_associazione", { length: 200 }).notNull().default("Angeli in Moto"),
  descrizione: text("descrizione"),
  indirizzo: varchar("indirizzo", { length: 240 }),
  comune: varchar("comune", { length: 120 }),
  provincia: varchar("provincia", { length: 80 }),
  codiceFiscale: varchar("codice_fiscale", { length: 32 }),
  partitaIva: varchar("partita_iva", { length: 32 }),
  email: varchar("email", { length: 255 }),
  telefono: varchar("telefono", { length: 40 }),
  sitoWeb: varchar("sito_web", { length: 255 }),
  logoDocumentiUrl: text("logo_documenti_url"),
  logoTessereUrl: text("logo_tessere_url"),
  footerDocumenti: text("footer_documenti"),
  noteLegali: text("note_legali"),
  privacyTestoBreve: text("privacy_testo_breve"),
  attivo: boolean("attivo").notNull().default(true),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  aggiornatoDaId: integer("aggiornato_da_id").references(() => utentiTable.id),
});

export const moduliFunzionaliTable = pgTable(
  "moduli_funzionali",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 80 }).notNull(),
    nome: varchar("nome", { length: 160 }).notNull(),
    descrizione: text("descrizione"),
    categoria: varchar("categoria", { length: 80 }).notNull(),
    core: boolean("core").notNull().default(false),
    ordine: integer("ordine").notNull().default(0),
    attivoDefault: boolean("attivo_default").notNull().default(true),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("moduli_funzionali_codice_unique").on(table.codice)],
);

export const ambienteModuliTable = pgTable(
  "ambiente_moduli",
  {
    id: serial("id").primaryKey(),
    configurazioneAmbienteId: integer("configurazione_ambiente_id")
      .notNull()
      .references(() => configurazioneAmbienteTable.id),
    moduloId: integer("modulo_id")
      .notNull()
      .references(() => moduliFunzionaliTable.id),
    attivo: boolean("attivo").notNull().default(true),
    abilitatoDaId: integer("abilitato_da_id").references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ambiente_moduli_config_modulo_unique").on(
      table.configurazioneAmbienteId,
      table.moduloId,
    ),
    index("ambiente_moduli_modulo_idx").on(table.moduloId),
  ],
);

export const auditConfigurazioniTable = pgTable(
  "audit_configurazioni",
  {
    id: serial("id").primaryKey(),
    area: varchar("area", { length: 80 }).notNull(),
    chiave: varchar("chiave", { length: 160 }).notNull(),
    valorePrecedente: jsonb("valore_precedente").$type<Record<string, unknown> | null>(),
    valoreNuovo: jsonb("valore_nuovo").$type<Record<string, unknown> | null>(),
    utenteId: integer("utente_id").references(() => utentiTable.id),
    azione: varchar("azione", { length: 80 }).notNull(),
    dataOra: timestamp("data_ora").notNull().defaultNow(),
    ip: varchar("ip", { length: 80 }),
    note: text("note"),
  },
  (table) => [
    index("audit_configurazioni_data_ora_idx").on(table.dataOra),
    index("audit_configurazioni_area_idx").on(table.area),
  ],
);

export type ConfigurazioneAmbiente = typeof configurazioneAmbienteTable.$inferSelect;
export type ModuloFunzionale = typeof moduliFunzionaliTable.$inferSelect;
export type AmbienteModulo = typeof ambienteModuliTable.$inferSelect;
export type AuditConfigurazione = typeof auditConfigurazioniTable.$inferSelect;
