import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { importazioniAgeaRigheTable, importazioniAgeaTable } from "./ageaImports";
import { utentiTable } from "./auth";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { movimentiTable } from "./movimenti";
import { operazioniDistribuzioneMagazzinoTable } from "./operazioniDistribuzioneMagazzino";
import { prodottiTable } from "./prodotti";

export const FSE_REPORTING_MODEL_VERSION = "MAGAZZINO_2_0C_V1";
export const FSE_EXPORT_FORMATS = [
  "FSE_CANONICAL_AUDIT_XLSX_V1",
  "SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1",
] as const;
export const FSE_EXPORT_STATES = [
  "GENERATA",
  "PRONTA_PER_INSERIMENTO_MANUALE",
  "INSERITA_MANUALMENTE",
  "ANNULLATA",
] as const;
export const FSE_RECONCILIATION_STATES = [
  "CALCOLATA",
  "DA_RIVEDERE",
  "RICONCILIATA",
  "CHIUSA_CON_SCOSTAMENTI",
  "ANNULLATA",
] as const;

export const rilevazioniMonitoraggioFseTable = pgTable(
  "rilevazioni_monitoraggio_fse",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id").notNull().references(() => magazziniTable.id),
    annoMese: varchar("anno_mese", { length: 7 }).notNull(),
    canaleUfficiale: varchar("canale_ufficiale", { length: 20 }).notNull(),
    operazioneDistribuzioneId: integer("operazione_distribuzione_id").references(
      () => operazioniDistribuzioneMagazzinoTable.id,
    ),
    dataRiferimento: date("data_riferimento").notNull(),
    minori18: integer("minori_18"),
    giovani18_29: integer("giovani_18_29"),
    donne: integer("donne"),
    over65: integer("over_65"),
    personeDisabilita: integer("persone_disabilita"),
    cittadiniPaesiTerzi: integer("cittadini_paesi_terzi"),
    origineStranieraMinoranze: integer("origine_straniera_minoranze"),
    senzatettoEsclusioneAbitativa: integer("senzatetto_esclusione_abitativa"),
    totaleSaltuari: integer("totale_saltuari"),
    fonte: varchar("fonte", { length: 40 }).notNull(),
    completezza: varchar("completezza", { length: 30 }).notNull(),
    versione: integer("versione").notNull().default(1),
    creatoDa: integer("creato_da").notNull().references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
    aggiornatoDa: integer("aggiornato_da").notNull().references(() => utentiTable.id),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true }).notNull().defaultNow(),
    noteAudit: text("note_audit"),
  },
  (table) => [
    uniqueIndex("rilevazioni_monitoraggio_fse_month_unique").on(
      table.magazzinoId,
      table.annoMese,
      table.canaleUfficiale,
    ),
    check("rilevazioni_monitoraggio_fse_month_check", sql`${table.annoMese} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("rilevazioni_monitoraggio_fse_channel_check", sql`${table.canaleUfficiale} in ('PACCHI', 'MENSA', 'STRADA')`),
    check("rilevazioni_monitoraggio_fse_version_check", sql`${table.versione} >= 1`),
  ],
);

export const esportazioniFseTable = pgTable(
  "esportazioni_fse",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id").notNull().references(() => magazziniTable.id),
    dataDa: date("data_da").notNull(),
    dataA: date("data_a").notNull(),
    dataAsOf: date("data_as_of").notNull(),
    timezone: varchar("timezone", { length: 40 }).notNull().default("Europe/Rome"),
    formatCode: varchar("format_code", { length: 60 }).notNull(),
    modelVersion: varchar("model_version", { length: 40 }).notNull(),
    stato: varchar("stato", { length: 40 }).notNull(),
    maxMovimentoId: integer("max_movimento_id").notNull(),
    maxOperazioneDistribuzioneId: integer("max_operazione_distribuzione_id").notNull(),
    canonicalHash: varchar("canonical_hash", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull(),
    eventiTotali: integer("eventi_totali").notNull(),
    righeTotali: integer("righe_totali").notNull(),
    righeBloccanti: integer("righe_bloccanti").notNull(),
    righeWarning: integer("righe_warning").notNull(),
    creatoDa: integer("creato_da").notNull().references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
    annullatoDa: integer("annullato_da").references(() => utentiTable.id),
    dataAnnullamento: timestamp("data_annullamento", { withTimezone: true }),
    motivazioneAnnullamento: text("motivazione_annullamento"),
    marcatoInseritoDa: integer("marcato_inserito_da").references(() => utentiTable.id),
    dataInserimentoEsterno: timestamp("data_inserimento_esterno", { withTimezone: true }),
    riferimentoEsterno: text("riferimento_esterno"),
    versione: integer("versione").notNull().default(1),
  },
  (table) => [
    uniqueIndex("esportazioni_fse_idempotency_unique").on(table.idempotencyKey),
    index("esportazioni_fse_mag_period_state_idx").on(table.magazzinoId, table.dataDa, table.dataA, table.stato),
    check("esportazioni_fse_period_check", sql`${table.dataDa} <= ${table.dataA} and ${table.dataAsOf} >= ${table.dataA}`),
    check("esportazioni_fse_hash_check", sql`${table.canonicalHash} ~ '^[0-9a-f]{64}$' and ${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`),
    check("esportazioni_fse_version_check", sql`${table.versione} >= 1`),
  ],
);

export const esportazioniFseEventiTable = pgTable(
  "esportazioni_fse_eventi",
  {
    id: serial("id").primaryKey(),
    esportazioneId: integer("esportazione_id").notNull().references(() => esportazioniFseTable.id),
    eventKey: varchar("event_key", { length: 160 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    sourceType: varchar("source_type", { length: 80 }).notNull(),
    sourceId: integer("source_id").notNull(),
    eventDate: date("event_date").notNull(),
    officialActivity: varchar("official_activity", { length: 30 }),
    internalChannel: varchar("internal_channel", { length: 40 }),
    documentNumber: varchar("document_number", { length: 100 }),
    packs: integer("packs"),
    meals: integer("meals"),
    occasionalPeople: integer("occasional_people"),
    continuousPeople: integer("continuous_people"),
    status: varchar("status", { length: 40 }).notNull(),
    qualityCodesJson: jsonb("quality_codes_json").$type<string[]>().notNull().default([]),
    activeCoverage: boolean("active_coverage").notNull().default(true),
  },
  (table) => [
    uniqueIndex("esportazioni_fse_eventi_key_unique").on(table.esportazioneId, table.eventKey),
    uniqueIndex("esportazioni_fse_eventi_active_coverage_unique")
      .on(table.eventKey)
      .where(sql`${table.activeCoverage} = true`),
    check("esportazioni_fse_eventi_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const esportazioniFseRigheTable = pgTable(
  "esportazioni_fse_righe",
  {
    id: serial("id").primaryKey(),
    esportazioneEventoId: integer("esportazione_evento_id").notNull().references(() => esportazioniFseEventiTable.id),
    lineKey: varchar("line_key", { length: 180 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    movimentoId: integer("movimento_id").notNull().references(() => movimentiTable.id),
    movimentoOrigineId: integer("movimento_origine_id").references(() => movimentiTable.id),
    accountingNature: varchar("accounting_nature", { length: 50 }).notNull(),
    fund: varchar("fund", { length: 50 }).notNull(),
    productId: integer("product_id").notNull().references(() => prodottiTable.id),
    productCodeSnapshot: varchar("product_code_snapshot", { length: 30 }).notNull(),
    productNameSnapshot: varchar("product_name_snapshot", { length: 150 }).notNull(),
    lotId: integer("lot_id").references(() => lottiTable.id),
    lotCodeSnapshot: varchar("lot_code_snapshot", { length: 80 }),
    expirySnapshot: date("expiry_snapshot"),
    quantityPiecesSigned: numeric("quantity_pieces_signed", { precision: 18, scale: 6 }),
    quantityKgLtSigned: numeric("quantity_kg_lt_signed", { precision: 18, scale: 6 }),
    factorKgLtPiece: numeric("factor_kg_lt_piece", { precision: 18, scale: 9 }),
    unitSnapshot: varchar("unit_snapshot", { length: 20 }).notNull(),
    sourceLineageJson: jsonb("source_lineage_json").$type<Record<string, unknown>>().notNull(),
    reportingDisposition: varchar("reporting_disposition", { length: 60 }).notNull(),
    qualityCodesJson: jsonb("quality_codes_json").$type<string[]>().notNull().default([]),
    activeCoverage: boolean("active_coverage").notNull().default(true),
  },
  (table) => [
    uniqueIndex("esportazioni_fse_righe_key_unique").on(table.esportazioneEventoId, table.lineKey),
    uniqueIndex("esportazioni_fse_righe_active_coverage_unique")
      .on(table.lineKey)
      .where(sql`${table.activeCoverage} = true`),
    check("esportazioni_fse_righe_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const riconciliazioniFseTable = pgTable(
  "riconciliazioni_fse",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id").notNull().references(() => magazziniTable.id),
    importazioneAgeaId: integer("importazione_agea_id").notNull().references(() => importazioniAgeaTable.id),
    importazioneAgeaPrecedenteId: integer("importazione_agea_precedente_id").references(() => importazioniAgeaTable.id),
    dataRiferimento: date("data_riferimento").notNull(),
    maxMovimentoId: integer("max_movimento_id").notNull(),
    maxOperazioneDistribuzioneId: integer("max_operazione_distribuzione_id").notNull(),
    modelVersion: varchar("model_version", { length: 40 }).notNull(),
    canonicalHash: varchar("canonical_hash", { length: 64 }).notNull(),
    stato: varchar("stato", { length: 40 }).notNull(),
    versione: integer("versione").notNull().default(1),
    totaleRighe: integer("totale_righe").notNull().default(0),
    riconciliate: integer("riconciliate").notNull().default(0),
    soloLocali: integer("solo_locali").notNull().default(0),
    soloAgea: integer("solo_agea").notNull().default(0),
    scostamenti: integer("scostamenti").notNull().default(0),
    ambigue: integer("ambigue").notNull().default(0),
    bloccanti: integer("bloccanti").notNull().default(0),
    creatoDa: integer("creato_da").notNull().references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
    ricalcolatoDa: integer("ricalcolato_da").references(() => utentiTable.id),
    dataRicalcolo: timestamp("data_ricalcolo", { withTimezone: true }),
    chiusoDa: integer("chiuso_da").references(() => utentiTable.id),
    dataChiusura: timestamp("data_chiusura", { withTimezone: true }),
    annullatoDa: integer("annullato_da").references(() => utentiTable.id),
    dataAnnullamento: timestamp("data_annullamento", { withTimezone: true }),
    motivazioneChiusura: text("motivazione_chiusura"),
  },
  (table) => [
    index("riconciliazioni_fse_import_state_idx").on(table.importazioneAgeaId, table.stato),
    check("riconciliazioni_fse_hash_check", sql`${table.canonicalHash} ~ '^[0-9a-f]{64}$'`),
    check("riconciliazioni_fse_version_check", sql`${table.versione} >= 1`),
  ],
);

export const riconciliazioniFseRigheTable = pgTable(
  "riconciliazioni_fse_righe",
  {
    id: serial("id").primaryKey(),
    riconciliazioneId: integer("riconciliazione_id").notNull().references(() => riconciliazioniFseTable.id),
    tipoRiga: varchar("tipo_riga", { length: 40 }).notNull(),
    businessKey: varchar("business_key", { length: 255 }).notNull(),
    matchMethod: varchar("match_method", { length: 40 }).notNull(),
    localEventKey: varchar("local_event_key", { length: 160 }),
    localLineKey: varchar("local_line_key", { length: 180 }),
    movimentoId: integer("movimento_id").references(() => movimentiTable.id),
    operazioneDistribuzioneId: integer("operazione_distribuzione_id").references(() => operazioniDistribuzioneMagazzinoTable.id),
    externalMovementId: integer("external_movement_id"),
    importazioneAgeaRigaId: integer("importazione_agea_riga_id").references(() => importazioniAgeaRigheTable.id),
    fundLocal: varchar("fund_local", { length: 50 }),
    fundExternal: varchar("fund_external", { length: 50 }),
    productIdLocal: integer("product_id_local").references(() => prodottiTable.id),
    productIdExternal: integer("product_id_external").references(() => prodottiTable.id),
    lotLocal: varchar("lot_local", { length: 80 }),
    lotExternal: varchar("lot_external", { length: 80 }),
    dateLocal: date("date_local"),
    dateExternal: date("date_external"),
    piecesLocal: numeric("pieces_local", { precision: 18, scale: 6 }),
    piecesExternal: numeric("pieces_external", { precision: 18, scale: 6 }),
    kgLtLocal: numeric("kg_lt_local", { precision: 18, scale: 6 }),
    kgLtExternal: numeric("kg_lt_external", { precision: 18, scale: 6 }),
    differencePieces: numeric("difference_pieces", { precision: 18, scale: 6 }),
    differenceKgLt: numeric("difference_kg_lt", { precision: 18, scale: 6 }),
    channelLocal: varchar("channel_local", { length: 40 }),
    channelExternal: varchar("channel_external", { length: 40 }),
    status: varchar("status", { length: 60 }).notNull(),
    blocking: boolean("blocking").notNull(),
    qualityCodesJson: jsonb("quality_codes_json").$type<string[]>().notNull().default([]),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
  },
  (table) => [
    uniqueIndex("riconciliazioni_fse_righe_key_unique").on(table.riconciliazioneId, table.businessKey),
    index("riconciliazioni_fse_righe_state_block_idx").on(table.status, table.blocking),
    check("riconciliazioni_fse_righe_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const riconciliazioniFseRisoluzioniTable = pgTable(
  "riconciliazioni_fse_risoluzioni",
  {
    id: serial("id").primaryKey(),
    riconciliazioneRigaId: integer("riconciliazione_riga_id").notNull().references(() => riconciliazioniFseRigheTable.id),
    azione: varchar("azione", { length: 40 }).notNull(),
    motivazione: text("motivazione").notNull(),
    oldStateJson: jsonb("old_state_json").$type<Record<string, unknown>>().notNull(),
    newStateJson: jsonb("new_state_json").$type<Record<string, unknown>>().notNull(),
    creatoDa: integer("creato_da").notNull().references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("riconciliazioni_fse_risoluzioni_row_idx").on(table.riconciliazioneRigaId)],
);

export type EsportazioneFse = typeof esportazioniFseTable.$inferSelect;
export type EsportazioneFseEvento = typeof esportazioniFseEventiTable.$inferSelect;
export type EsportazioneFseRiga = typeof esportazioniFseRigheTable.$inferSelect;
export type RilevazioneMonitoraggioFse = typeof rilevazioniMonitoraggioFseTable.$inferSelect;
export type RiconciliazioneFse = typeof riconciliazioniFseTable.$inferSelect;
