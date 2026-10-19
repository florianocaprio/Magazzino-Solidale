import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  integer,
  varchar,
  boolean,
  timestamp,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { areeOperativeTable } from "./areeOperative";

export const configurazioniCodiciBeneficiariTable = pgTable(
  "configurazioni_codici_beneficiari",
  {
    id: serial("id").primaryKey(),
    scopeTipo: varchar("scope_tipo", { length: 16 })
      .notNull()
      .default("GLOBALE"),
    versione: integer("versione").notNull(),
    prefissoAssociazione: varchar("prefisso_associazione", { length: 12 }),
    includiCodiceArea: boolean("includi_codice_area").notNull().default(false),
    segmentoFisso: varchar("segmento_fisso", { length: 8 }),
    separatore: varchar("separatore", { length: 1 }).notNull().default("-"),
    cifreProgressivo: integer("cifre_progressivo").notNull().default(6),
    numeroIniziale: integer("numero_iniziale").notNull().default(1),
    ambitoProgressivo: varchar("ambito_progressivo", { length: 16 })
      .notNull()
      .default("GLOBALE"),
    attiva: boolean("attiva").notNull().default(true),
    aggiornataDa: integer("aggiornata_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("config_codici_benef_versione_unique").on(table.versione),
    uniqueIndex("config_codici_benef_attiva_scope_unique")
      .on(table.scopeTipo)
      .where(sql`${table.attiva} = true`),
    check(
      "config_codici_benef_scope_check",
      sql`${table.scopeTipo} = 'GLOBALE'`,
    ),
    check(
      "config_codici_benef_separatore_check",
      sql`${table.separatore} in ('','-','/')`,
    ),
    check(
      "config_codici_benef_cifre_check",
      sql`${table.cifreProgressivo} between 2 and 8`,
    ),
    check(
      "config_codici_benef_iniziale_check",
      sql`${table.numeroIniziale} > 0`,
    ),
    check(
      "config_codici_benef_ambito_check",
      sql`${table.ambitoProgressivo} in ('GLOBALE','PER_AREA')`,
    ),
  ],
);

export const progressiviCodiciBeneficiariTable = pgTable(
  "progressivi_codici_beneficiari",
  {
    id: serial("id").primaryKey(),
    configurazioneId: integer("configurazione_id")
      .notNull()
      .references(() => configurazioniCodiciBeneficiariTable.id, {
        onDelete: "restrict",
      }),
    scopeTipo: varchar("scope_tipo", { length: 16 }).notNull(),
    scopeKey: varchar("scope_key", { length: 80 }).notNull(),
    areaOperativaId: integer("area_operativa_id").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    ultimoNumero: integer("ultimo_numero").notNull(),
    versione: integer("versione").notNull().default(1),
    dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("progressivi_codici_benef_config_scope_unique").on(
      table.configurazioneId,
      table.scopeKey,
    ),
    check(
      "progressivi_codici_benef_scope_check",
      sql`${table.scopeTipo} in ('GLOBALE','AREA')`,
    ),
    check(
      "progressivi_codici_benef_numero_check",
      sql`${table.ultimoNumero} > 0`,
    ),
  ],
);
