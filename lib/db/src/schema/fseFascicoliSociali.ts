import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { centriAscoltoTable } from "./centri";
import { areeOperativeTable } from "./areeOperative";
import { utentiTable } from "./auth";

export const fseImportBatchesTable = pgTable("fse_import_batches", {
  id: serial("id").primaryKey(),
  nomeFile: varchar("nome_file", { length: 255 }).notNull(),
  sha256File: varchar("sha256_file", { length: 64 }).notNull(),
  hashContenutoNormalizzato: varchar("hash_contenuto_normalizzato", { length: 64 }).notNull(),
  centroAscoltoId: integer("centro_ascolto_id").notNull().references(() => centriAscoltoTable.id, { onDelete: "restrict" }),
  areaOperativaId: integer("area_operativa_id").notNull().references(() => areeOperativeTable.id, { onDelete: "restrict" }),
  utenteId: integer("utente_id").references(() => utentiTable.id, { onDelete: "set null" }),
  numeroRighe: integer("numero_righe").notNull().default(0),
  creati: integer("creati").notNull().default(0),
  collegati: integer("collegati").notNull().default(0),
  aggiornati: integer("aggiornati").notNull().default(0),
  invariati: integer("invariati").notNull().default(0),
  conflitti: integer("conflitti").notNull().default(0),
  errori: integer("errori").notNull().default(0),
  stato: varchar("stato", { length: 20 }).notNull().default("analizzato"),
  dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("fse_import_batches_scope_idx").on(table.centroAscoltoId, table.areaOperativaId),
  check("fse_import_batches_stato_check", sql`${table.stato} in ('analizzato','confermato','parziale','fallito')`),
  check("fse_import_batches_sha256_file_check", sql`${table.sha256File} ~ '^[0-9a-f]{64}$'`),
  check("fse_import_batches_hash_contenuto_normalizzato_check", sql`${table.hashContenutoNormalizzato} ~ '^[0-9a-f]{64}$'`),
  check("fse_import_batches_counts_check", sql`${table.numeroRighe} >= 0 and ${table.creati} >= 0 and ${table.collegati} >= 0 and ${table.aggiornati} >= 0 and ${table.invariati} >= 0 and ${table.conflitti} >= 0 and ${table.errori} >= 0`),
]);

export const fseFascicoliSocialiTable = pgTable("fse_fascicoli_sociali", {
  id: serial("id").primaryKey(),
  beneficiarioId: integer("beneficiario_id").notNull().references(() => beneficiariTable.id, { onDelete: "cascade" }),
  codiceFascicolo: varchar("codice_fascicolo", { length: 255 }),
  codiceFascicoloNormalizzato: varchar("codice_fascicolo_normalizzato", { length: 255 }),
  origineFascicolo: varchar("origine_fascicolo", { length: 20 }).notNull().default("interno"),
  numeroComponentiImportato: integer("numero_componenti_importato"),
  donneImportate: integer("donne_importate"),
  uominiImportati: integer("uomini_importati"),
  eta017Importata: integer("eta_0_17_importata"),
  eta1829Importata: integer("eta_18_29_importata"),
  eta3064Importata: integer("eta_30_64_importata"),
  eta65PlusImportata: integer("eta_65_plus_importata"),
  origineStranieraMinoranze: integer("origine_straniera_minoranze"),
  cittadiniPaesiTerzi: integer("cittadini_paesi_terzi"),
  senzaTettoEsclusioneAbitativa: integer("senza_tetto_esclusione_abitativa"),
  tipologiaAttivitaImportata: varchar("tipologia_attivita_importata", { length: 80 }),
  statoAttualeImportato: varchar("stato_attuale_importato", { length: 80 }),
  ultimoImportBatchId: integer("ultimo_import_batch_id").references(() => fseImportBatchesTable.id, { onDelete: "set null" }),
  ultimoImportAt: timestamp("ultimo_import_at", { withTimezone: true }),
  ultimoExportAt: timestamp("ultimo_export_at", { withTimezone: true }),
  hashUltimaRigaImportata: varchar("hash_ultima_riga_importata", { length: 64 }),
  dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("fse_fascicoli_sociali_beneficiario_uidx").on(table.beneficiarioId),
  uniqueIndex("fse_fascicoli_sociali_codice_norm_uidx").on(table.codiceFascicoloNormalizzato).where(sql`${table.codiceFascicoloNormalizzato} is not null`),
  check("fse_fascicoli_sociali_origine_fascicolo_check", sql`${table.origineFascicolo} in ('interno','import_fse')`),
  check("fse_fascicoli_sociali_snapshot_check", sql`(
    ${table.numeroComponentiImportato} is null and ${table.donneImportate} is null and ${table.uominiImportati} is null
    and ${table.eta017Importata} is null and ${table.eta1829Importata} is null and ${table.eta3064Importata} is null and ${table.eta65PlusImportata} is null
  ) or (
    ${table.numeroComponentiImportato} > 0 and ${table.donneImportate} >= 0 and ${table.uominiImportati} >= 0
    and ${table.eta017Importata} >= 0 and ${table.eta1829Importata} >= 0 and ${table.eta3064Importata} >= 0 and ${table.eta65PlusImportata} >= 0
    and ${table.donneImportate} + ${table.uominiImportati} = ${table.numeroComponentiImportato}
    and ${table.eta017Importata} + ${table.eta1829Importata} + ${table.eta3064Importata} + ${table.eta65PlusImportata} = ${table.numeroComponentiImportato}
  )`),
  check("fse_fascicoli_sociali_specific_counts_check", sql`(${table.origineStranieraMinoranze} is null or ${table.origineStranieraMinoranze} >= 0) and (${table.cittadiniPaesiTerzi} is null or ${table.cittadiniPaesiTerzi} >= 0) and (${table.senzaTettoEsclusioneAbitativa} is null or ${table.senzaTettoEsclusioneAbitativa} >= 0)`),
]);

export type FseFascicoloSociale = typeof fseFascicoliSocialiTable.$inferSelect;
