import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { utentiTable } from "./auth";
import { beneficiariTable } from "./beneficiari";
import { bolleTable } from "./bolle";
import { areeOperativeTable } from "./areeOperative";
import { zoneUdsTable } from "./zoneUds";
import { centriAscoltoTable } from "./centri";

export const interventiTable = pgTable(
  "interventi",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id, { onDelete: "restrict" }),
    bollaId: integer("bolla_id").references(() => bolleTable.id, {
      onDelete: "restrict",
    }),
    operatoreId: integer("operatore_id").references(() => utentiTable.id),
    dataIntervento: date("data_intervento"),
    tipoIntervento: varchar("tipo_intervento", { length: 120 }).notNull(),
    descrizione: text("descrizione"),
    risultato: text("risultato"),
    esito: text("esito"),
    prossimAzione: text("prossim_azione"),
    note: text("note"),
    noteUds: text("note_uds"),
    dataFollowup: date("data_followup"),
    scadenzaIsee: date("scadenza_isee"),
    scadenzaRinnovo: date("scadenza_rinnovo"),
    scadenzaAutodichiarazioneIndigenza: date(
      "scadenza_autodichiarazione_indigenza",
    ),
    stato: varchar("stato", { length: 30 }).notNull().default("concluso"),
    ambito: varchar("ambito", { length: 20 }),
    areaOperativaIdSnapshot: integer("area_operativa_id_snapshot").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    centroAscoltoIdSnapshot: integer("centro_ascolto_id_snapshot").references(
      () => centriAscoltoTable.id,
      { onDelete: "set null" },
    ),
    zonaUdsIdSnapshot: integer("zona_uds_id_snapshot").references(
      () => zoneUdsTable.id,
      { onDelete: "restrict" },
    ),
    priorita: varchar("priorita", { length: 20 }).notNull().default("normale"),
    dataOraPianificata: timestamp("data_ora_pianificata", {
      withTimezone: true,
    }),
    dataOraAvvio: timestamp("data_ora_avvio", { withTimezone: true }),
    dataOraConclusione: timestamp("data_ora_conclusione", {
      withTimezone: true,
    }),
    interventoPrecedenteId: integer("intervento_precedente_id").references(
      (): AnyPgColumn => interventiTable.id,
    ),
    sede: varchar("sede", { length: 255 }),
    motivoAnnullamento: text("motivo_annullamento"),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", {
      withTimezone: true,
    }).defaultNow(),
  },
  (table) => [
    index("interventi_beneficiario_idx").on(table.beneficiarioId),
    index("interventi_operatore_idx").on(table.operatoreId),
    index("interventi_stato_idx").on(table.stato),
    index("interventi_ambito_idx").on(table.ambito),
    index("interventi_uds_territorio_data_idx").on(
      table.ambito,
      table.areaOperativaIdSnapshot,
      table.zonaUdsIdSnapshot,
      table.dataIntervento,
    ),
    index("interventi_reporting_snapshot_idx").on(
      table.ambito,
      table.stato,
      table.dataIntervento,
      table.areaOperativaIdSnapshot,
      table.centroAscoltoIdSnapshot,
    ),
    index("interventi_priorita_idx").on(table.priorita),
    index("interventi_data_ora_pianificata_idx").on(table.dataOraPianificata),
    index("interventi_ambito_stato_pianificata_idx").on(
      table.ambito,
      table.stato,
      table.dataOraPianificata,
    ),
    index("interventi_precedente_idx").on(table.interventoPrecedenteId),
    check(
      "interventi_stato_check",
      sql`${table.stato} in ('da_pianificare', 'pianificato', 'in_corso', 'concluso', 'annullato', 'mancata_presentazione')`,
    ),
    check(
      "interventi_ambito_check",
      sql`${table.ambito} is null or ${table.ambito} in ('sociale', 'uds')`,
    ),
    check(
      "interventi_priorita_check",
      sql`${table.priorita} in ('bassa', 'normale', 'alta', 'urgente')`,
    ),
    check(
      "interventi_pianificato_data_check",
      sql`${table.stato} <> 'pianificato' or ${table.dataOraPianificata} is not null`,
    ),
    check(
      "interventi_timestamp_ordine_check",
      sql`${table.dataOraAvvio} is null or ${table.dataOraConclusione} is null or ${table.dataOraConclusione} >= ${table.dataOraAvvio}`,
    ),
    check(
      "interventi_precedente_diverso_check",
      sql`${table.interventoPrecedenteId} is null or ${table.interventoPrecedenteId} <> ${table.id}`,
    ),
    foreignKey({
      name: "interventi_uds_zona_area_snapshot_fk",
      columns: [table.zonaUdsIdSnapshot, table.areaOperativaIdSnapshot],
      foreignColumns: [zoneUdsTable.id, zoneUdsTable.areaOperativaId],
    }),
  ],
);

export const insertInterventoSchema = createInsertSchema(interventiTable).omit({
  id: true,
  dataCreazione: true,
  dataAggiornamento: true,
});
export type InsertIntervento = z.infer<typeof insertInterventoSchema>;
export type Intervento = typeof interventiTable.$inferSelect;
