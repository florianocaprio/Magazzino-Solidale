import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  date,
  jsonb,
  timestamp,
  uniqueIndex,
  check,
  numeric,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { magazziniTable } from "./magazzini";
import {
  fseSourceRegistriesTable,
  fseImportSessionsTable,
  fseImportFilesTable,
  fseImportRowsTable,
  fseImportStockRowsTable,
  fseImportRowRevisionsTable,
  fseMovementClaimsTable,
} from "./fseImportPratiche";
import { carichiMagazzinoRigheTable } from "./carichiMagazzino";

export const fseAdministrativeVersionsTable = pgTable(
  "fse_administrative_versions",
  {
    id: serial("id").primaryKey(),
    sourceRegistryId: integer("source_registry_id")
      .notNull()
      .references(() => fseSourceRegistriesTable.id),
    sessionId: integer("session_id")
      .notNull()
      .references(() => fseImportSessionsTable.id),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    sessionVersion: integer("session_version").notNull(),
    referenceDate: date("reference_date").notNull(),
    mode: varchar("mode", { length: 30 }).notNull(),
    manifestHash: varchar("manifest_hash", { length: 64 }).notNull(),
    manifestJson: jsonb("manifest_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("fse_administrative_versions_manifest_unique").on(
      t.sessionId,
      t.manifestHash,
    ),
    check(
      "fse_administrative_versions_hash_check",
      sql`${t.manifestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "fse_administrative_versions_mode_check",
      sql`${t.mode} IN ('NUOVI_CARICHI','SALDO_INIZIALE') AND ${t.sessionVersion} > 0`,
    ),
  ],
);

export const fseAdministrativeFilesTable = pgTable(
  "fse_administrative_files",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => fseAdministrativeVersionsTable.id),
    fileId: integer("file_id")
      .notNull()
      .references(() => fseImportFilesTable.id),
    role: varchar("role", { length: 20 }).notNull(),
    fileHash: varchar("file_hash", { length: 64 }).notNull(),
  },
  (t) => [
    uniqueIndex("fse_administrative_files_version_file_unique").on(
      t.versionId,
      t.fileId,
    ),
    check(
      "fse_administrative_files_check",
      sql`${t.role} IN ('REGISTRO','GIACENZE') AND ${t.fileHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fseAdministrativeObservationsTable = pgTable(
  "fse_administrative_observations",
  {
    id: serial("id").primaryKey(),
    versionId: integer("version_id")
      .notNull()
      .references(() => fseAdministrativeVersionsTable.id),
    sourceFileId: integer("source_file_id")
      .notNull()
      .references(() => fseAdministrativeFilesTable.id),
    rowId: integer("row_id").references(() => fseImportRowsTable.id),
    stockRowId: integer("stock_row_id").references(
      () => fseImportStockRowsTable.id,
    ),
    revisionId: integer("revision_id").references(
      () => fseImportRowRevisionsTable.id,
    ),
    rawHash: varchar("raw_hash", { length: 64 }).notNull(),
    identityHash: varchar("identity_hash", { length: 64 }).notNull(),
    occurrence: integer("occurrence").notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    originalJson: jsonb("original_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    interpretedJson: jsonb("interpreted_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    qualityJson: jsonb("quality_json").$type<string[]>().notNull(),
  },
  (t) => [
    uniqueIndex("fse_administrative_observations_row_unique").on(
      t.versionId,
      t.rowId,
    ),
    uniqueIndex("fse_administrative_observations_stock_unique").on(
      t.versionId,
      t.stockRowId,
    ),
    check(
      "fse_administrative_observations_reference_check",
      sql`num_nonnulls(${t.rowId},${t.stockRowId}) = 1 AND (${t.revisionId} IS NULL OR ${t.rowId} IS NOT NULL) AND ${t.occurrence} > 0`,
    ),
    check(
      "fse_administrative_observations_hash_check",
      sql`${t.rawHash} ~ '^[0-9a-f]{64}$' AND ${t.identityHash} ~ '^[0-9a-f]{64}$' AND ${t.contentHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const fseAdministrativeLineageTable = pgTable(
  "fse_administrative_lineage",
  {
    id: serial("id").primaryKey(),
    observationId: integer("observation_id")
      .notNull()
      .references(() => fseAdministrativeObservationsTable.id),
    claimId: integer("claim_id")
      .notNull()
      .references(() => fseMovementClaimsTable.id),
    loadRowId: integer("load_row_id").references(
      () => carichiMagazzinoRigheTable.id,
    ),
    claimState: varchar("claim_state", { length: 30 }).notNull(),
    pieces: numeric("pieces", { precision: 18, scale: 6 }),
    kgLt: numeric("kg_lt", { precision: 18, scale: 6 }),
  },
  (t) => [
    uniqueIndex("fse_administrative_lineage_unique").on(
      t.observationId,
      t.claimId,
    ),
  ],
);
