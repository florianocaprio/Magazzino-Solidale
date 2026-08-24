import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { magazziniTable } from "./magazzini";
import { areeOperativeTable } from "./areeOperative";
import { centriAscoltoTable } from "./centri";

export const operazioniDistribuzioneMagazzinoTable = pgTable(
  "operazioni_distribuzione_magazzino",
  {
    id: serial("id").primaryKey(),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    dataDistribuzione: date("data_distribuzione").notNull(),
    canaleOperativo: varchar("canale_operativo", { length: 40 }).notNull(),
    dominioOrigine: varchar("dominio_origine", { length: 40 }).notNull(),
    entitaOrigineTipo: varchar("entita_origine_tipo", { length: 80 }).notNull(),
    entitaOrigineId: integer("entita_origine_id").notNull(),
    areaOperativaIdSnapshot: integer("area_operativa_id_snapshot").references(
      () => areeOperativeTable.id,
      { onDelete: "restrict" },
    ),
    centroAscoltoIdSnapshot: integer("centro_ascolto_id_snapshot").references(
      () => centriAscoltoTable.id,
      { onDelete: "restrict" },
    ),
    territorioClassificazione: varchar("territorio_classificazione", {
      length: 30,
    })
      .notNull()
      .default("legacy_sconosciuto"),
    numeroDocumento: varchar("numero_documento", { length: 100 }),
    numeroPacchi: integer("numero_pacchi"),
    numeroPasti: integer("numero_pasti"),
    indigentiSaltuari: integer("indigenti_saltuari"),
    indigentiContinuativi: integer("indigenti_continuativi"),
    stato: varchar("stato", { length: 30 }).notNull().default("confermata"),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("operazioni_distribuzione_sorgente_unique").on(
      table.dominioOrigine,
      table.entitaOrigineTipo,
      table.entitaOrigineId,
    ),
    index("operazioni_distribuzione_mag_data_idx").on(
      table.magazzinoId,
      table.dataDistribuzione,
    ),
    index("operazioni_distribuzione_canale_idx").on(table.canaleOperativo),
    index("operazioni_distribuzione_territorio_idx").on(
      table.territorioClassificazione,
      table.areaOperativaIdSnapshot,
      table.centroAscoltoIdSnapshot,
      table.dataDistribuzione,
    ),
    check(
      "operazioni_distribuzione_stato_check",
      sql`${table.stato} in ('confermata', 'parzialmente_stornata', 'stornata')`,
    ),
    check(
      "operazioni_distribuzione_conteggi_check",
      sql`(${table.numeroPacchi} is null or ${table.numeroPacchi} >= 0) and (${table.numeroPasti} is null or ${table.numeroPasti} >= 0) and (${table.indigentiSaltuari} is null or ${table.indigentiSaltuari} >= 0) and (${table.indigentiContinuativi} is null or ${table.indigentiContinuativi} >= 0)`,
    ),
    check(
      "operazioni_distribuzione_territorio_check",
      sql`(${table.territorioClassificazione} = 'attribuito' and ${table.areaOperativaIdSnapshot} is not null)
        or (${table.territorioClassificazione} in ('universale', 'legacy_sconosciuto')
          and ${table.areaOperativaIdSnapshot} is null and ${table.centroAscoltoIdSnapshot} is null)`,
    ),
  ],
);

export type OperazioneDistribuzioneMagazzino =
  typeof operazioniDistribuzioneMagazzinoTable.$inferSelect;
