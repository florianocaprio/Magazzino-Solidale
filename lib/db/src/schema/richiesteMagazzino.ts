import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { entiDestinatariTable } from "./entiDestinatari";
import { magazziniTable } from "./magazzini";
import { interventiTable } from "./interventi";
import { areeOperativeTable } from "./areeOperative";
import { centriAscoltoTable } from "./centri";
import { utentiTable } from "./auth";

/** M5A: richiesta_magazzino, senza effetti inventariali. */
export const richiesteMagazzinoTable = pgTable(
  "richieste_magazzino",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 40 }).notNull(),
    tipoDestinatario: varchar("tipo_destinatario", { length: 20 }).notNull(),
    beneficiarioId: integer("beneficiario_id").references(
      () => beneficiariTable.id,
      { onDelete: "restrict" },
    ),
    enteDestinatarioId: integer("ente_destinatario_id").references(
      () => entiDestinatariTable.id,
      { onDelete: "restrict" },
    ),
    magazzinoDestinatarioId: integer("magazzino_destinatario_id").references(
      () => magazziniTable.id,
      { onDelete: "restrict" },
    ),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    centroAscoltoId: integer("centro_ascolto_id").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    zonaUdsIdSnapshot: integer("zona_uds_id_snapshot"),
    sorgente: varchar("sorgente", { length: 30 }).notNull(),
    interventoId: integer("intervento_id").references(
      () => interventiTable.id,
      { onDelete: "restrict" },
    ),
    destinatarioCodiceSnapshot: varchar("destinatario_codice_snapshot", {
      length: 40,
    }),
    destinatarioNomeSnapshot: varchar("destinatario_nome_snapshot", {
      length: 200,
    }).notNull(),
    numComponentiSnapshot: integer("num_componenti_snapshot"),
    areaNomeSnapshot: varchar("area_nome_snapshot", { length: 120 }).notNull(),
    centroNomeSnapshot: varchar("centro_nome_snapshot", { length: 120 }),
    bisogno: varchar("bisogno", { length: 2000 }).notNull(),
    noteOperative: varchar("note_operative", { length: 2000 }),
    priorita: varchar("priorita", { length: 10 }).notNull().default("normale"),
    dataDesiderata: date("data_desiderata"),
    modalitaPreferita: varchar("modalita_preferita", { length: 20 })
      .notNull()
      .default("da_definire"),
    stato: varchar("stato", { length: 20 }).notNull().default("inviata"),
    versione: integer("versione").notNull().default(1),
    inviatoDa: integer("inviato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    presoInCaricoDa: integer("preso_in_carico_da").references(
      () => utentiTable.id,
      { onDelete: "restrict" },
    ),
    presoInCaricoCodiceSnapshot: varchar("preso_in_carico_codice_snapshot", {
      length: 120,
    }),
    presoInCaricoAt: timestamp("preso_in_carico_at", { withTimezone: true }),
    annullatoDa: integer("annullato_da").references(() => utentiTable.id, {
      onDelete: "restrict",
    }),
    annullatoAt: timestamp("annullato_at", { withTimezone: true }),
    motivoAnnullamento: varchar("motivo_annullamento", { length: 500 }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("richieste_magazzino_codice_unique").on(table.codice),
    uniqueIndex("richieste_magazzino_intervento_attivo_unique")
      .on(table.interventoId)
      .where(
        sql`${table.interventoId} is not null and ${table.stato} in ('inviata', 'presa_in_carico')`,
      ),
    index("richieste_magazzino_coda_idx").on(
      table.areaOperativaId,
      table.centroAscoltoId,
      table.stato,
      table.dataCreazione,
      table.id,
    ),
    index("richieste_magazzino_beneficiario_idx").on(table.beneficiarioId),
    index("richieste_magazzino_ente_idx").on(table.enteDestinatarioId),
    index("richieste_magazzino_magazzino_idx").on(
      table.magazzinoDestinatarioId,
    ),
    index("richieste_magazzino_intervento_idx").on(table.interventoId),
    check(
      "richieste_magazzino_destinatario_check",
      sql`(${table.tipoDestinatario} = 'beneficiario' and ${table.beneficiarioId} is not null and ${table.enteDestinatarioId} is null and ${table.magazzinoDestinatarioId} is null and ${table.centroAscoltoId} is not null) or (${table.tipoDestinatario} = 'ente' and ${table.beneficiarioId} is null and ${table.enteDestinatarioId} is not null and ${table.magazzinoDestinatarioId} is null) or (${table.tipoDestinatario} = 'magazzino' and ${table.beneficiarioId} is null and ${table.enteDestinatarioId} is null and ${table.magazzinoDestinatarioId} is not null)`,
    ),
    check(
      "richieste_magazzino_sorgente_check",
      sql`(${table.sorgente} = 'beneficiario' and ${table.tipoDestinatario} = 'beneficiario' and ${table.interventoId} is null) or (${table.sorgente} = 'intervento_sociale' and ${table.tipoDestinatario} = 'beneficiario' and ${table.interventoId} is not null) or (${table.sorgente} = 'operativa' and ${table.tipoDestinatario} in ('ente', 'magazzino') and ${table.interventoId} is null)`,
    ),
    check(
      "richieste_magazzino_contenuto_check",
      sql`length(btrim(${table.bisogno})) between 1 and 2000 and (${table.noteOperative} is null or length(${table.noteOperative}) <= 2000)`,
    ),
    check(
      "richieste_magazzino_priorita_check",
      sql`${table.priorita} in ('bassa', 'normale', 'alta', 'urgente')`,
    ),
    check(
      "richieste_magazzino_modalita_check",
      sql`${table.modalitaPreferita} in ('da_definire', 'ritiro', 'domicilio')`,
    ),
    check(
      "richieste_magazzino_stato_check",
      sql`${table.stato} in ('inviata', 'presa_in_carico', 'chiusa', 'annullata')`,
    ),
    check("richieste_magazzino_versione_check", sql`${table.versione} > 0`),
    check(
      "richieste_magazzino_presa_check",
      sql`(${table.presoInCaricoDa} is null) = (${table.presoInCaricoAt} is null) and (${table.presoInCaricoDa} is null) = (${table.presoInCaricoCodiceSnapshot} is null) and (${table.stato} <> 'inviata' or ${table.presoInCaricoDa} is null) and (${table.stato} not in ('presa_in_carico', 'chiusa') or ${table.presoInCaricoDa} is not null)`,
    ),
    check(
      "richieste_magazzino_annullamento_check",
      sql`(${table.stato} = 'annullata' and ${table.annullatoDa} is not null and ${table.annullatoAt} is not null and ${table.motivoAnnullamento} is not null and length(btrim(${table.motivoAnnullamento})) between 1 and 500) or (${table.stato} <> 'annullata' and ${table.annullatoDa} is null and ${table.annullatoAt} is null and ${table.motivoAnnullamento} is null)`,
    ),
  ],
);

export type RichiestaMagazzino = typeof richiesteMagazzinoTable.$inferSelect;
