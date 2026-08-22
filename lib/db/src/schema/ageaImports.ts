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
import { utentiTable } from "./auth";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
} from "./carichiMagazzino";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";

export const AGEA_IMPORT_MODES = [
  "PRIMA_ACQUISIZIONE",
  "AGGIORNAMENTO",
  "SOLO_ANALISI",
] as const;
export type AgeaImportMode = (typeof AGEA_IMPORT_MODES)[number];

export const AGEA_IMPORT_STATES = [
  "ANALIZZATA",
  "DA_MAPPARE",
  "BLOCCATA",
  "PRONTA",
  "CONFERMATA",
  "ANNULLATA",
  "ERRORE",
] as const;
export type AgeaImportState = (typeof AGEA_IMPORT_STATES)[number];

export const AGEA_MOVEMENT_TYPES = [
  "CARICO",
  "DISTRIBUZIONE",
  "RESO",
  "MOVIMENTO_NEGATIVO_NON_CLASSIFICATO",
  "SEGNO_INCOERENTE",
  "RIGA_SENZA_MOVIMENTO",
] as const;
export type AgeaMovementType = (typeof AGEA_MOVEMENT_TYPES)[number];

export const AGEA_APPLICATION_STATES = [
  "NON_APPLICABILE_RIFERIMENTO",
  "DA_APPLICARE",
  "APPLICATO_INCREMENTALE",
  "ASSORBITO_SALDO_INIZIALE",
  "CONFLITTO_CONTENUTO",
] as const;

export const importazioniAgeaTable = pgTable(
  "importazioni_agea",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    nomeFile: varchar("nome_file", { length: 255 }).notNull(),
    mimeType: varchar("mime_type", { length: 150 }).notNull(),
    dimensioneBytes: integer("dimensione_bytes").notNull(),
    sha256File: varchar("sha256_file", { length: 64 }).notNull(),
    tracciatoCodice: varchar("tracciato_codice", { length: 80 }).notNull(),
    parserVersion: varchar("parser_version", { length: 30 }).notNull(),
    sheetName: varchar("sheet_name", { length: 100 }).notNull(),
    dataRiferimento: date("data_riferimento").notNull(),
    modalita: varchar("modalita", { length: 30 }).notNull(),
    stato: varchar("stato", { length: 30 }).notNull(),
    versione: integer("versione").notNull().default(1),
    righeTotali: integer("righe_totali").notNull().default(0),
    righeCarico: integer("righe_carico").notNull().default(0),
    righeDistribuzione: integer("righe_distribuzione").notNull().default(0),
    righeReso: integer("righe_reso").notNull().default(0),
    righeNonClassificate: integer("righe_non_classificate")
      .notNull()
      .default(0),
    righeNuove: integer("righe_nuove").notNull().default(0),
    righeDuplicate: integer("righe_duplicate").notNull().default(0),
    righeModificate: integer("righe_modificate").notNull().default(0),
    righeAmbigue: integer("righe_ambigue").notNull().default(0),
    righeBloccanti: integer("righe_bloccanti").notNull().default(0),
    partiteTotali: integer("partite_totali").notNull().default(0),
    partiteSaldoPositivo: integer("partite_saldo_positivo")
      .notNull()
      .default(0),
    bootstrapCaricoId: integer("bootstrap_carico_id").references(
      () => carichiMagazzinoTable.id,
    ),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confermatoDa: integer("confermato_da").references(() => utentiTable.id),
    dataConferma: timestamp("data_conferma", { withTimezone: true }),
    annullatoDa: integer("annullato_da").references(() => utentiTable.id),
    dataAnnullamento: timestamp("data_annullamento", { withTimezone: true }),
    noteAudit: jsonb("note_audit").$type<Record<string, unknown> | null>(),
  },
  (table) => [
    index("importazioni_agea_magazzino_data_idx").on(
      table.magazzinoId,
      table.dataCreazione,
    ),
    index("importazioni_agea_sha_idx").on(table.sha256File),
    check(
      "importazioni_agea_sha_check",
      sql`${table.sha256File} ~ '^[0-9a-f]{64}$'`,
    ),
    check("importazioni_agea_versione_check", sql`${table.versione} > 0`),
  ],
);

export const mappatureProdottiEsterniTable = pgTable(
  "mappature_prodotti_esterni",
  {
    id: serial("id").primaryKey(),
    fonte: varchar("fonte", { length: 40 }).notNull(),
    codiceEsterno: varchar("codice_esterno", { length: 100 }),
    descrizioneEsterna: text("descrizione_esterna").notNull(),
    chiaveDescrizioneNormalizzata: text(
      "chiave_descrizione_normalizzata",
    ).notNull(),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id),
    attiva: boolean("attiva").notNull().default(true),
    versione: integer("versione").notNull().default(1),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataPrimaAssociazione: timestamp("data_prima_associazione", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    aggiornatoDa: integer("aggiornato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataUltimoAggiornamento: timestamp("data_ultimo_aggiornamento", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    dataUltimoRiscontro: timestamp("data_ultimo_riscontro", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mappature_prodotti_esterni_fonte_descrizione_unique").on(
      table.fonte,
      table.chiaveDescrizioneNormalizzata,
    ),
    index("mappature_prodotti_esterni_prodotto_idx").on(table.prodottoId),
  ],
);

export const importazioniAgeaRigheTable = pgTable(
  "importazioni_agea_righe",
  {
    id: serial("id").primaryKey(),
    importazioneId: integer("importazione_id")
      .notNull()
      .references(() => importazioniAgeaTable.id, { onDelete: "cascade" }),
    numeroRiga: integer("numero_riga").notNull(),
    rawJson: jsonb("raw_json").$type<Record<string, unknown>>().notNull(),
    fondoRaw: text("fondo_raw"),
    fondoNormalizzato: varchar("fondo_normalizzato", { length: 50 }),
    prodottoRaw: text("prodotto_raw").notNull(),
    prodottoNormalizzato: text("prodotto_normalizzato").notNull(),
    lottoRaw: text("lotto_raw"),
    lottoNormalizzato: text("lotto_normalizzato"),
    numeroDocumentoRaw: text("numero_documento_raw"),
    numeroDocumentoNormalizzato: text("numero_documento_normalizzato"),
    dataDocumentoRaw: text("data_documento_raw"),
    dataDocumento: date("data_documento"),
    dataCaricoMagazzinoRaw: text("data_carico_magazzino_raw"),
    dataCaricoRisolta: date("data_carico_risolta"),
    dataCaricoFonte: varchar("data_carico_fonte", { length: 40 }),
    mittenteDestinatarioRaw: text("mittente_destinatario_raw"),
    movimentoKgLtRaw: text("movimento_kg_lt_raw"),
    movimentoKgLt: numeric("movimento_kg_lt", { precision: 18, scale: 6 }),
    movimentoPezziRaw: text("movimento_pezzi_raw"),
    movimentoPezzi: numeric("movimento_pezzi", { precision: 18, scale: 6 }),
    saldoMovimentoKgLtRaw: text("saldo_movimento_kg_lt_raw"),
    saldoMovimentoKgLt: numeric("saldo_movimento_kg_lt", {
      precision: 18,
      scale: 6,
    }),
    saldoMovimentoPezziRaw: text("saldo_movimento_pezzi_raw"),
    saldoMovimentoPezzi: numeric("saldo_movimento_pezzi", {
      precision: 18,
      scale: 6,
    }),
    saldoFinaleKgLtRaw: text("saldo_finale_kg_lt_raw"),
    saldoFinaleKgLt: numeric("saldo_finale_kg_lt", { precision: 18, scale: 6 }),
    saldoFinalePezziRaw: text("saldo_finale_pezzi_raw"),
    saldoFinalePezzi: numeric("saldo_finale_pezzi", {
      precision: 18,
      scale: 6,
    }),
    noteRaw: text("note_raw"),
    attivitaRaw: text("attivita_raw"),
    attivitaNormalizzata: varchar("attivita_normalizzata", { length: 30 }),
    pacchiRaw: text("pacchi_raw"),
    pastiRaw: text("pasti_raw"),
    saltuariRaw: text("saltuari_raw"),
    continuativiRaw: text("continuativi_raw"),
    tipoMovimentoEsterno: varchar("tipo_movimento_esterno", {
      length: 60,
    }).notNull(),
    identityBaseHash: varchar("identity_base_hash", { length: 64 }).notNull(),
    identityOccurrence: integer("identity_occurrence").notNull(),
    identityKey: varchar("identity_key", { length: 140 }).notNull(),
    contentHash: varchar("content_hash", { length: 64 }).notNull(),
    movimentoEsternoId: integer("movimento_esterno_id"),
    mappingProdottoId: integer("mapping_prodotto_id").references(
      () => mappatureProdottiEsterniTable.id,
    ),
    prodottoIdSnapshot: integer("prodotto_id_snapshot").references(
      () => prodottiTable.id,
    ),
    descrizioneProdottoSnapshot: text("descrizione_prodotto_snapshot"),
    unitaMisuraSnapshot: varchar("unita_misura_snapshot", { length: 20 }),
    caricoMagazzinoRigaId: integer("carico_magazzino_riga_id").references(
      () => carichiMagazzinoRigheTable.id,
    ),
    statoRiga: varchar("stato_riga", { length: 60 }).notNull(),
    blocking: boolean("blocking").notNull().default(false),
    errorCodesJson: jsonb("error_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    warningCodesJson: jsonb("warning_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("importazioni_agea_righe_numero_unique").on(
      table.importazioneId,
      table.numeroRiga,
    ),
    index("importazioni_agea_righe_identity_idx").on(table.identityKey),
    index("importazioni_agea_righe_preview_idx").on(
      table.importazioneId,
      table.statoRiga,
    ),
  ],
);

export const importazioniAgeaPartiteTable = pgTable(
  "importazioni_agea_partite",
  {
    id: serial("id").primaryKey(),
    importazioneId: integer("importazione_id")
      .notNull()
      .references(() => importazioniAgeaTable.id, { onDelete: "cascade" }),
    partyKey: varchar("party_key", { length: 255 }).notNull(),
    fondoOrigine: varchar("fondo_origine", { length: 50 }).notNull(),
    prodottoId: integer("prodotto_id").references(() => prodottiTable.id),
    prodottoNormalizzato: text("prodotto_normalizzato").notNull(),
    lottoRaw: text("lotto_raw"),
    lottoNormalizzato: text("lotto_normalizzato"),
    existingLottoId: integer("existing_lotto_id").references(
      () => lottiTable.id,
    ),
    saldoFinalePezzi: numeric("saldo_finale_pezzi", {
      precision: 18,
      scale: 6,
    }),
    saldoFinaleKgLt: numeric("saldo_finale_kg_lt", { precision: 18, scale: 6 }),
    quantitaOperativa: numeric("quantita_operativa", {
      precision: 18,
      scale: 6,
    }),
    unitaMisuraOperativa: varchar("unita_misura_operativa", { length: 20 }),
    fattoreKgLtPezzo: numeric("fattore_kg_lt_pezzo", {
      precision: 18,
      scale: 9,
    }),
    dataScadenzaRisolta: date("data_scadenza_risolta"),
    dataScadenzaFonte: varchar("data_scadenza_fonte", { length: 40 }),
    stato: varchar("stato", { length: 60 }).notNull(),
    blocking: boolean("blocking").notNull().default(false),
    errorCodesJson: jsonb("error_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    warningCodesJson: jsonb("warning_codes_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("importazioni_agea_partite_key_unique").on(
      table.importazioneId,
      table.partyKey,
    ),
    index("importazioni_agea_partite_preview_idx").on(
      table.importazioneId,
      table.stato,
    ),
  ],
);

export const movimentiEsterniAgeaTable = pgTable(
  "movimenti_esterni_agea",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    identityKey: varchar("identity_key", { length: 140 }).notNull(),
    identityBaseHash: varchar("identity_base_hash", { length: 64 }).notNull(),
    identityOccurrence: integer("identity_occurrence").notNull(),
    acceptedContentHash: varchar("accepted_content_hash", {
      length: 64,
    }).notNull(),
    acceptedImportRowId: integer("accepted_import_row_id").notNull(),
    tipoMovimentoEsterno: varchar("tipo_movimento_esterno", {
      length: 60,
    }).notNull(),
    prodottoIdSnapshot: integer("prodotto_id_snapshot").references(
      () => prodottiTable.id,
    ),
    firstSeenImportId: integer("first_seen_import_id")
      .notNull()
      .references(() => importazioniAgeaTable.id),
    lastSeenImportId: integer("last_seen_import_id")
      .notNull()
      .references(() => importazioniAgeaTable.id),
    statoApplicazione: varchar("stato_applicazione", { length: 60 }).notNull(),
    caricoMagazzinoRigaId: integer("carico_magazzino_riga_id").references(
      () => carichiMagazzinoRigheTable.id,
    ),
    assorbitoDaBootstrapRigaId: integer(
      "assorbito_da_bootstrap_riga_id",
    ).references(() => carichiMagazzinoRigheTable.id),
    dataPrimaAcquisizione: timestamp("data_prima_acquisizione", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    dataUltimoRiscontro: timestamp("data_ultimo_riscontro", {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("movimenti_esterni_agea_magazzino_identity_unique").on(
      table.magazzinoId,
      table.identityKey,
    ),
    index("movimenti_esterni_agea_import_idx").on(table.lastSeenImportId),
  ],
);

export type ImportazioneAgea = typeof importazioniAgeaTable.$inferSelect;
export type ImportazioneAgeaRiga =
  typeof importazioniAgeaRigheTable.$inferSelect;
export type ImportazioneAgeaPartita =
  typeof importazioniAgeaPartiteTable.$inferSelect;
