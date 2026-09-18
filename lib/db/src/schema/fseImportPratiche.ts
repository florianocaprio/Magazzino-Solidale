import { sql } from "drizzle-orm";
import {
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
import { areeOperativeTable } from "./areeOperative";
import { utentiTable } from "./auth";
import { carichiMagazzinoRigheTable } from "./carichiMagazzino";
import { caricoPraticaRigheTable, caricoPraticheTable } from "./caricoPratiche";
import { lottiLogiciTable } from "./lottiLogici";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";

export const FSE_IMPORT_MODES = ["NUOVI_CARICHI", "SALDO_INIZIALE"] as const;
export const FSE_IMPORT_SESSION_STATES = [
  "IN_ANALISI",
  "DA_COMPLETARE",
  "PRONTA",
  "IN_PRATICA",
  "REGISTRATA",
  "ANNULLATA",
] as const;
export const FSE_CLAIM_STATES = [
  "RISERVATA",
  "REGISTRATA",
  "COPERTA_SALDO",
  "RILASCIATA",
  "CONFLITTO",
] as const;

export const fseSourceRegistriesTable = pgTable(
  "fse_source_registries",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 80 }).notNull(),
    descrizione: text("descrizione").notNull(),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    attiva: integer("attiva").notNull().default(1),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_source_registries_codice_unique").on(table.codice),
    index("fse_source_registries_area_idx").on(table.areaOperativaId),
    check("fse_source_registries_attiva_check", sql`${table.attiva} in (0, 1)`),
  ],
);

export const fseImportSessionsTable = pgTable(
  "fse_import_sessions",
  {
    id: serial("id").primaryKey(),
    sourceRegistryId: integer("source_registry_id")
      .notNull()
      .references(() => fseSourceRegistriesTable.id, { onDelete: "restrict" }),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id, { onDelete: "restrict" }),
    lottoLogicoId: integer("lotto_logico_id")
      .notNull()
      .references(() => lottiLogiciTable.id, { onDelete: "restrict" }),
    caricoPraticaId: integer("carico_pratica_id").references(
      () => caricoPraticheTable.id,
      { onDelete: "restrict" },
    ),
    modalita: varchar("modalita", { length: 30 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull().default("IN_ANALISI"),
    versione: integer("versione").notNull().default(1),
    dataRiferimentoSaldo: date("data_riferimento_saldo"),
    coperturaConfermata: integer("copertura_confermata").notNull().default(0),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    aggiornatoDa: integer("aggiornato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("fse_import_sessions_scope_idx").on(
      table.sourceRegistryId,
      table.magazzinoId,
      table.dataCreazione,
    ),
    check(
      "fse_import_sessions_modalita_check",
      sql`${table.modalita} in ('NUOVI_CARICHI', 'SALDO_INIZIALE')`,
    ),
    check(
      "fse_import_sessions_stato_check",
      sql`${table.stato} in ('IN_ANALISI', 'DA_COMPLETARE', 'PRONTA', 'IN_PRATICA', 'REGISTRATA', 'ANNULLATA')`,
    ),
    check("fse_import_sessions_versione_check", sql`${table.versione} > 0`),
    check(
      "fse_import_sessions_copertura_check",
      sql`${table.coperturaConfermata} in (0, 1)`,
    ),
  ],
);

export const fseImportAttachCommandsTable = pgTable(
  "fse_import_attach_commands",
  {
    id: serial("id").primaryKey(),
    sessioneId: integer("sessione_id")
      .notNull()
      .references(() => fseImportSessionsTable.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resultJson: jsonb("result_json")
      .$type<{
        practiceId: number;
        practiceVersion: number;
        addedRows: number;
      }>()
      .notNull(),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_import_attach_commands_key_unique").on(
      table.idempotencyKey,
    ),
    index("fse_import_attach_commands_session_idx").on(table.sessioneId),
    check(
      "fse_import_attach_commands_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fseImportFilesTable = pgTable(
  "fse_import_files",
  {
    id: serial("id").primaryKey(),
    sessioneId: integer("sessione_id")
      .notNull()
      .references(() => fseImportSessionsTable.id, { onDelete: "cascade" }),
    profilo: varchar("profilo", { length: 20 }).notNull(),
    nomeFile: varchar("nome_file", { length: 255 }).notNull(),
    formato: varchar("formato", { length: 10 }).notNull(),
    mimeTypeDichiarato: varchar("mime_type_dichiarato", { length: 150 }),
    dimensioneBytes: integer("dimensione_bytes").notNull(),
    sha256File: varchar("sha256_file", { length: 64 }).notNull(),
    tracciatoCodice: varchar("tracciato_codice", { length: 80 }).notNull(),
    parserVersion: varchar("parser_version", { length: 40 }).notNull(),
    sheetName: varchar("sheet_name", { length: 100 }).notNull(),
    dataRiferimento: date("data_riferimento"),
    warningsJson: jsonb("warnings_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    acquisitoDa: integer("acquisito_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataAcquisizione: timestamp("data_acquisizione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_import_files_session_profile_sha_unique").on(
      table.sessioneId,
      table.profilo,
      table.sha256File,
    ),
    index("fse_import_files_sha_idx").on(table.sha256File),
    check(
      "fse_import_files_sha_check",
      sql`${table.sha256File} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fse_import_files_profilo_check",
      sql`${table.profilo} in ('REGISTRO', 'GIACENZE')`,
    ),
    check(
      "fse_import_files_formato_check",
      sql`${table.formato} in ('XLSX', 'XLS', 'CSV')`,
    ),
  ],
);

export const fseImportRowsTable = pgTable(
  "fse_import_rows",
  {
    id: serial("id").primaryKey(),
    sessioneId: integer("sessione_id")
      .notNull()
      .references(() => fseImportSessionsTable.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => fseImportFilesTable.id, { onDelete: "cascade" }),
    numeroRiga: integer("numero_riga").notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().notNull(),
    semanticIdentityHash: varchar("semantic_identity_hash", {
      length: 64,
    }).notNull(),
    disambiguatore: varchar("disambiguatore", { length: 80 })
      .notNull()
      .default(""),
    movementContentHash: varchar("movement_content_hash", {
      length: 64,
    }).notNull(),
    summaryHash: varchar("summary_hash", { length: 64 }).notNull(),
    tipoMovimento: varchar("tipo_movimento", { length: 60 }).notNull(),
    fondoOrigine: varchar("fondo_origine", { length: 50 }),
    prodottoEsterno: text("prodotto_esterno").notNull(),
    prodottoNormalizzato: text("prodotto_normalizzato").notNull(),
    lottoFisico: varchar("lotto_fisico", { length: 80 }),
    numeroDocumento: varchar("numero_documento", { length: 100 }),
    dataDocumento: date("data_documento"),
    dataOperativaProposta: date("data_operativa_proposta"),
    dataOperativaFonte: varchar("data_operativa_fonte", { length: 40 }),
    quantitaPezzi: numeric("quantita_pezzi", { precision: 18, scale: 6 }),
    quantitaKgLt: numeric("quantita_kg_lt", { precision: 18, scale: 6 }),
    saldoFinalePezzi: numeric("saldo_finale_pezzi", {
      precision: 18,
      scale: 6,
    }),
    saldoFinaleKgLt: numeric("saldo_finale_kg_lt", {
      precision: 18,
      scale: 6,
    }),
    prodottoId: integer("prodotto_id").references(() => prodottiTable.id, {
      onDelete: "restrict",
    }),
    quantitaOperativa: numeric("quantita_operativa", {
      precision: 18,
      scale: 6,
    }),
    dataScadenza: date("data_scadenza"),
    fattoreKgLtPezzo: numeric("fattore_kg_lt_pezzo", {
      precision: 18,
      scale: 9,
    }),
    stato: varchar("stato", { length: 40 }).notNull(),
    errorCodesJson: jsonb("error_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    warningCodesJson: jsonb("warning_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    aggiornatoDa: integer("aggiornato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_import_rows_file_row_unique").on(
      table.fileId,
      table.numeroRiga,
    ),
    index("fse_import_rows_identity_idx").on(table.semanticIdentityHash),
    index("fse_import_rows_session_state_idx").on(
      table.sessioneId,
      table.stato,
    ),
    check(
      "fse_import_rows_hashes_check",
      sql`${table.semanticIdentityHash} ~ '^[0-9a-f]{64}$' and ${table.movementContentHash} ~ '^[0-9a-f]{64}$' and ${table.summaryHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fseImportStockRowsTable = pgTable(
  "fse_import_stock_rows",
  {
    id: serial("id").primaryKey(),
    sessioneId: integer("sessione_id")
      .notNull()
      .references(() => fseImportSessionsTable.id, { onDelete: "cascade" }),
    fileId: integer("file_id")
      .notNull()
      .references(() => fseImportFilesTable.id, { onDelete: "cascade" }),
    numeroRiga: integer("numero_riga").notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().notNull(),
    balanceKey: varchar("balance_key", { length: 64 }).notNull(),
    fondoOrigine: varchar("fondo_origine", { length: 50 }),
    prodottoEsterno: text("prodotto_esterno").notNull(),
    prodottoNormalizzato: text("prodotto_normalizzato").notNull(),
    lottoFisico: varchar("lotto_fisico", { length: 80 }),
    pesoUnita: numeric("peso_unita", { precision: 18, scale: 9 }),
    unitaMisuraPeso: varchar("unita_misura_peso", { length: 10 }),
    giacenzaPesoVolume: numeric("giacenza_peso_volume", {
      precision: 18,
      scale: 6,
    }),
    giacenzaPezzi: numeric("giacenza_pezzi", { precision: 18, scale: 6 }),
    pezziPerCollo: numeric("pezzi_per_collo", { precision: 18, scale: 6 }),
    giacenzaColli: numeric("giacenza_colli", { precision: 18, scale: 6 }),
    dataScadenza: date("data_scadenza"),
    prodottoId: integer("prodotto_id").references(() => prodottiTable.id, {
      onDelete: "restrict",
    }),
    quantitaOperativa: numeric("quantita_operativa", {
      precision: 18,
      scale: 6,
    }),
    stato: varchar("stato", { length: 40 }).notNull().default("DA_ASSOCIARE"),
    errorCodesJson: jsonb("error_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    warningCodesJson: jsonb("warning_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    uniqueIndex("fse_import_stock_rows_file_row_unique").on(
      table.fileId,
      table.numeroRiga,
    ),
    index("fse_import_stock_rows_balance_idx").on(table.balanceKey),
    index("fse_import_stock_rows_session_state_idx").on(
      table.sessioneId,
      table.stato,
    ),
  ],
);

export const fseImportRowRevisionsTable = pgTable(
  "fse_import_row_revisions",
  {
    id: serial("id").primaryKey(),
    rigaId: integer("riga_id")
      .notNull()
      .references(() => fseImportRowsTable.id, { onDelete: "restrict" }),
    versione: integer("versione").notNull(),
    acceptedValuesJson: jsonb("accepted_values_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    revisionHash: varchar("revision_hash", { length: 64 }).notNull(),
    motivo: text("motivo").notNull(),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_import_row_revisions_version_unique").on(
      table.rigaId,
      table.versione,
    ),
    check(
      "fse_import_row_revisions_hash_check",
      sql`${table.revisionHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fseMovementClaimsTable = pgTable(
  "fse_movement_claims",
  {
    id: serial("id").primaryKey(),
    sourceRegistryId: integer("source_registry_id")
      .notNull()
      .references(() => fseSourceRegistriesTable.id, { onDelete: "restrict" }),
    semanticIdentityHash: varchar("semantic_identity_hash", {
      length: 64,
    }).notNull(),
    disambiguatore: varchar("disambiguatore", { length: 80 })
      .notNull()
      .default(""),
    acceptedContentHash: varchar("accepted_content_hash", {
      length: 64,
    }).notNull(),
    acceptedRevisionId: integer("accepted_revision_id")
      .notNull()
      .references(() => fseImportRowRevisionsTable.id, {
        onDelete: "restrict",
      }),
    caricoPraticaRigaId: integer("carico_pratica_riga_id").references(
      () => caricoPraticaRigheTable.id,
      { onDelete: "restrict" },
    ),
    caricoMagazzinoRigaId: integer("carico_magazzino_riga_id").references(
      () => carichiMagazzinoRigheTable.id,
      { onDelete: "restrict" },
    ),
    magazzinoIdSnapshot: integer("magazzino_id_snapshot")
      .notNull()
      .references(() => magazziniTable.id, { onDelete: "restrict" }),
    stato: varchar("stato", { length: 30 }).notNull(),
    dataPresaInCarico: timestamp("data_presa_in_carico", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fse_movement_claims_identity_active_unique")
      .on(
        table.sourceRegistryId,
        table.semanticIdentityHash,
        table.disambiguatore,
      )
      .where(sql`${table.stato} <> 'RILASCIATA'`),
    uniqueIndex("fse_movement_claims_practice_row_unique")
      .on(table.caricoPraticaRigaId)
      .where(sql`${table.caricoPraticaRigaId} is not null`),
    check(
      "fse_movement_claims_stato_check",
      sql`${table.stato} in ('RISERVATA', 'REGISTRATA', 'COPERTA_SALDO', 'RILASCIATA', 'CONFLITTO')`,
    ),
  ],
);

export const fseInitialBalanceCoverageTable = pgTable(
  "fse_initial_balance_coverage",
  {
    id: serial("id").primaryKey(),
    sourceRegistryId: integer("source_registry_id")
      .notNull()
      .references(() => fseSourceRegistriesTable.id, { onDelete: "restrict" }),
    sessioneId: integer("sessione_id")
      .notNull()
      .references(() => fseImportSessionsTable.id, { onDelete: "restrict" }),
    caricoPraticaId: integer("carico_pratica_id")
      .notNull()
      .references(() => caricoPraticheTable.id, { onDelete: "restrict" }),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id, { onDelete: "restrict" }),
    dataTaglio: date("data_taglio").notNull(),
    stato: varchar("stato", { length: 20 }).notNull().default("PROPOSTA"),
    attivataDa: integer("attivata_da").references(() => utentiTable.id, {
      onDelete: "restrict",
    }),
    dataAttivazione: timestamp("data_attivazione", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("fse_initial_balance_coverage_source_active_unique")
      .on(table.sourceRegistryId)
      .where(sql`${table.stato} in ('PROPOSTA', 'ATTIVA')`),
    uniqueIndex("fse_initial_balance_coverage_warehouse_active_unique")
      .on(table.magazzinoId)
      .where(sql`${table.stato} in ('PROPOSTA', 'ATTIVA')`),
    uniqueIndex("fse_initial_balance_coverage_practice_unique").on(
      table.caricoPraticaId,
    ),
    check(
      "fse_initial_balance_coverage_stato_check",
      sql`${table.stato} in ('PROPOSTA', 'ATTIVA', 'ANNULLATA')`,
    ),
  ],
);

export type FseImportSession = typeof fseImportSessionsTable.$inferSelect;
export type FseImportRow = typeof fseImportRowsTable.$inferSelect;
