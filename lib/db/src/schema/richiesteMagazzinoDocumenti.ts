import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { bolleTable } from "./bolle";
import { interventiTable } from "./interventi";
import { richiesteMagazzinoTable } from "./richiesteMagazzino";
import { trasferimentiTable } from "./trasferimenti";
import { utentiTable } from "./auth";

/** Relazione M5B: un documento M4 corrente, con gli annullati nello storico. */
export const richiesteMagazzinoDocumentiTable = pgTable(
  "richieste_magazzino_documenti",
  {
    id: serial("id").primaryKey(),
    richiestaId: integer("richiesta_id")
      .notNull()
      .references(() => richiesteMagazzinoTable.id, { onDelete: "restrict" }),
    tipoDocumento: varchar("tipo_documento", { length: 20 }).notNull(),
    bollaId: integer("bolla_id").references(() => bolleTable.id, {
      onDelete: "restrict",
    }),
    trasferimentoId: integer("trasferimento_id").references(
      () => trasferimentiTable.id,
      { onDelete: "restrict" },
    ),
    corrente: boolean("corrente").notNull().default(true),
    creatoDa: integer("creato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    creatoAt: timestamp("creato_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    cessatoDa: integer("cessato_da").references(() => utentiTable.id, {
      onDelete: "restrict",
    }),
    cessatoAt: timestamp("cessato_at", { withTimezone: true }),
    eventoCessazione: varchar("evento_cessazione", { length: 40 }),
    motivoCessazione: varchar("motivo_cessazione", { length: 500 }),
  },
  (table) => [
    uniqueIndex("richieste_magazzino_documenti_corrente_unique")
      .on(table.richiestaId)
      .where(sql`${table.corrente} = true`),
    uniqueIndex("richieste_magazzino_documenti_bolla_unique")
      .on(table.bollaId)
      .where(sql`${table.bollaId} is not null`),
    uniqueIndex("richieste_magazzino_documenti_trasferimento_unique")
      .on(table.trasferimentoId)
      .where(sql`${table.trasferimentoId} is not null`),
    index("richieste_magazzino_documenti_storico_idx").on(
      table.richiestaId,
      table.creatoAt,
      table.id,
    ),
    check(
      "richieste_magazzino_documenti_tipo_check",
      sql`(${table.tipoDocumento} = 'bolla' and ${table.bollaId} is not null and ${table.trasferimentoId} is null) or (${table.tipoDocumento} = 'trasferimento' and ${table.bollaId} is null and ${table.trasferimentoId} is not null)`,
    ),
    check(
      "richieste_magazzino_documenti_corrente_check",
      sql`(${table.corrente} = true and ${table.cessatoDa} is null and ${table.cessatoAt} is null and ${table.eventoCessazione} is null and ${table.motivoCessazione} is null) or (${table.corrente} = false and ${table.cessatoDa} is not null and ${table.cessatoAt} is not null and ${table.eventoCessazione} = 'annullamento_m4' and ${table.motivoCessazione} is not null and length(btrim(${table.motivoCessazione})) between 1 and 500)`,
    ),
  ],
);

/** Delega permanente dell'erogazione catalogata di un Intervento a M4. */
export const interventiDelegheM4Table = pgTable(
  "interventi_deleghe_m4",
  {
    interventoId: integer("intervento_id")
      .primaryKey()
      .references(() => interventiTable.id, { onDelete: "restrict" }),
    primaRichiestaId: integer("prima_richiesta_id")
      .notNull()
      .references(() => richiesteMagazzinoTable.id, { onDelete: "restrict" }),
    delegatoDa: integer("delegato_da")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    delegatoAt: timestamp("delegato_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("interventi_deleghe_m4_richiesta_idx").on(table.primaRichiestaId),
  ],
);
