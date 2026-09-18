import { sql } from "drizzle-orm";
import {
  check,
  boolean,
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
import { auditEventiTable } from "./auditEventi";
import { utentiTable } from "./auth";
import {
  carichiMagazzinoRigheTable,
  carichiMagazzinoTable,
} from "./carichiMagazzino";
import { fornitoriTable } from "./fornitori";
import { lottiLogiciTable } from "./lottiLogici";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { movimentiTable } from "./movimenti";
import { prodottiTable } from "./prodotti";

export const CARICO_PRATICA_STATI = [
  "bozza",
  "aperta",
  "chiusa",
  "annullata",
] as const;

export type CaricoPraticaStato = (typeof CARICO_PRATICA_STATI)[number];

export const caricoPraticheTable = pgTable(
  "carico_pratiche",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 40 }).notNull(),
    versione: integer("versione").notNull().default(1),
    stato: varchar("stato", { length: 20 }).notNull().default("bozza"),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id, { onDelete: "restrict" }),
    lottoLogicoId: integer("lotto_logico_id")
      .notNull()
      .references(() => lottiLogiciTable.id, { onDelete: "restrict" }),
    origineCarico: varchar("origine_carico", { length: 40 }).notNull(),
    tipoPratica: varchar("tipo_pratica", { length: 30 })
      .notNull()
      .default("ORDINARIA"),
    dataCarico: date("data_carico").notNull(),
    descrizione: text("descrizione").notNull(),
    fornitoreId: integer("fornitore_id").references(() => fornitoriTable.id, {
      onDelete: "restrict",
    }),
    numeroDocumento: varchar("numero_documento", { length: 100 }),
    dataDocumento: date("data_documento"),
    note: text("note"),
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
    uniqueIndex("carico_pratiche_codice_unique").on(table.codice),
    index("carico_pratiche_area_magazzino_idx").on(
      table.areaOperativaId,
      table.magazzinoId,
      table.dataCarico,
    ),
    index("carico_pratiche_stato_idx").on(table.stato),
    check(
      "carico_pratiche_stato_check",
      sql`${table.stato} in ('bozza', 'aperta', 'chiusa', 'annullata')`,
    ),
    check(
      "carico_pratiche_tipo_check",
      sql`${table.tipoPratica} in ('ORDINARIA', 'SALDO_INIZIALE')`,
    ),
    check("carico_pratiche_versione_check", sql`${table.versione} > 0`),
    check(
      "carico_pratiche_descrizione_check",
      sql`length(btrim(${table.descrizione})) > 0`,
    ),
  ],
);

export const caricoPraticaRigheTable = pgTable(
  "carico_pratica_righe",
  {
    id: serial("id").primaryKey(),
    caricoPraticaId: integer("carico_pratica_id")
      .notNull()
      .references(() => caricoPraticheTable.id, { onDelete: "cascade" }),
    clientId: varchar("client_id", { length: 100 }),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id, { onDelete: "restrict" }),
    fondoOrigine: varchar("fondo_origine", { length: 50 })
      .notNull()
      .default("NESSUN_FONDO"),
    quantita: numeric("quantita", { precision: 14, scale: 6 }),
    codiceLottoProduttore: varchar("codice_lotto_produttore", { length: 80 }),
    dataScadenza: date("data_scadenza"),
    fattoreKgLtPezzo: numeric("fattore_kg_lt_pezzo", {
      precision: 18,
      scale: 9,
    }),
    note: text("note"),
    numeroDocumentoEsterno: varchar("numero_documento_esterno", {
      length: 100,
    }),
    dataDocumentoEsterna: date("data_documento_esterna"),
    dataOperativaFonte: varchar("data_operativa_fonte", { length: 40 }),
    unitaMisuraSnapshot: varchar("unita_misura_snapshot", { length: 20 }),
    quantitaFrazionabileSnapshot: boolean("quantita_frazionabile_snapshot"),
    registrataAt: timestamp("registrata_at", { withTimezone: true }),
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
    uniqueIndex("carico_pratica_righe_client_unique")
      .on(table.caricoPraticaId, table.clientId)
      .where(sql`${table.clientId} is not null`),
    index("carico_pratica_righe_pratica_idx").on(table.caricoPraticaId),
    index("carico_pratica_righe_prodotto_idx").on(table.prodottoId),
    check(
      "carico_pratica_righe_quantita_check",
      sql`${table.quantita} is null or ${table.quantita} > 0`,
    ),
    check(
      "carico_pratica_righe_snapshot_check",
      sql`(${table.registrataAt} is null and ${table.unitaMisuraSnapshot} is null and ${table.quantitaFrazionabileSnapshot} is null)
          or (${table.registrataAt} is not null and ${table.quantita} is not null and ${table.unitaMisuraSnapshot} is not null and ${table.quantitaFrazionabileSnapshot} is not null)`,
    ),
  ],
);

export const caricoIntegrazioniTable = pgTable(
  "carico_integrazioni",
  {
    id: serial("id").primaryKey(),
    caricoPraticaId: integer("carico_pratica_id")
      .notNull()
      .references(() => caricoPraticheTable.id, { onDelete: "restrict" }),
    caricoMagazzinoId: integer("carico_magazzino_id")
      .notNull()
      .references(() => carichiMagazzinoTable.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    versioneRichiesta: integer("versione_richiesta").notNull(),
    versioneRisultante: integer("versione_risultante").notNull(),
    attoreId: integer("attore_id")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    resultSnapshot: jsonb("result_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    dataRegistrazione: timestamp("data_registrazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carico_integrazioni_idempotency_unique").on(
      table.idempotencyKey,
    ),
    uniqueIndex("carico_integrazioni_carico_unique").on(
      table.caricoMagazzinoId,
    ),
    index("carico_integrazioni_pratica_idx").on(table.caricoPraticaId),
    check(
      "carico_integrazioni_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const caricoIntegrazioneRigheTable = pgTable(
  "carico_integrazione_righe",
  {
    id: serial("id").primaryKey(),
    caricoIntegrazioneId: integer("carico_integrazione_id")
      .notNull()
      .references(() => caricoIntegrazioniTable.id, { onDelete: "restrict" }),
    caricoPraticaRigaId: integer("carico_pratica_riga_id")
      .notNull()
      .references(() => caricoPraticaRigheTable.id, { onDelete: "restrict" }),
    caricoMagazzinoRigaId: integer("carico_magazzino_riga_id")
      .notNull()
      .references(() => carichiMagazzinoRigheTable.id, {
        onDelete: "restrict",
      }),
  },
  (table) => [
    uniqueIndex("carico_integrazione_righe_pratica_riga_unique").on(
      table.caricoPraticaRigaId,
    ),
    uniqueIndex("carico_integrazione_righe_contabile_unique").on(
      table.caricoMagazzinoRigaId,
    ),
    index("carico_integrazione_righe_integrazione_idx").on(
      table.caricoIntegrazioneId,
    ),
  ],
);

export const caricoPraticaRettificheTable = pgTable(
  "carico_pratica_rettifiche",
  {
    id: serial("id").primaryKey(),
    caricoPraticaRigaId: integer("carico_pratica_riga_id")
      .notNull()
      .references(() => caricoPraticaRigheTable.id, { onDelete: "restrict" }),
    caricoIntegrazioneRigaId: integer("carico_integrazione_riga_id")
      .notNull()
      .references(() => caricoIntegrazioneRigheTable.id, {
        onDelete: "restrict",
      }),
    lottoId: integer("lotto_id")
      .notNull()
      .references(() => lottiTable.id, { onDelete: "restrict" }),
    movimentoId: integer("movimento_id")
      .notNull()
      .references(() => movimentiTable.id, { onDelete: "restrict" }),
    auditEventoId: integer("audit_evento_id")
      .notNull()
      .references(() => auditEventiTable.id, { onDelete: "restrict" }),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    quantita: numeric("quantita", { precision: 14, scale: 6 }).notNull(),
    motivo: text("motivo").notNull(),
    attoreId: integer("attore_id")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    resultSnapshot: jsonb("result_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    dataRettifica: timestamp("data_rettifica", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("carico_pratica_rettifiche_idempotency_unique").on(
      table.idempotencyKey,
    ),
    uniqueIndex("carico_pratica_rettifiche_movimento_unique").on(
      table.movimentoId,
    ),
    index("carico_pratica_rettifiche_riga_idx").on(table.caricoPraticaRigaId),
    check(
      "carico_pratica_rettifiche_quantita_check",
      sql`${table.quantita} > 0`,
    ),
    check(
      "carico_pratica_rettifiche_motivo_check",
      sql`length(btrim(${table.motivo})) > 0`,
    ),
    check(
      "carico_pratica_rettifiche_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export type CaricoPratica = typeof caricoPraticheTable.$inferSelect;
export type CaricoPraticaRiga = typeof caricoPraticaRigheTable.$inferSelect;
export type CaricoIntegrazione = typeof caricoIntegrazioniTable.$inferSelect;
export type CaricoPraticaRettifica =
  typeof caricoPraticaRettificheTable.$inferSelect;
