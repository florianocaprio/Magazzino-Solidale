import { sql } from "drizzle-orm";
import {
  boolean,
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
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areeOperativeTable } from "./areeOperative";
import { utentiTable } from "./auth";

export const STATI_LOTTO_LOGICO = ["aperto", "chiuso", "archiviato"] as const;
export type StatoLottoLogico = (typeof STATI_LOTTO_LOGICO)[number];

export const lottiLogiciTable = pgTable(
  "lotti_logici",
  {
    id: serial("id").primaryKey(),
    areaOperativaId: integer("area_operativa_id")
      .notNull()
      .references(() => areeOperativeTable.id, { onDelete: "restrict" }),
    codice: varchar("codice", { length: 80 }).notNull(),
    descrizione: varchar("descrizione", { length: 200 }).notNull(),
    dataInizio: date("data_inizio"),
    dataFine: date("data_fine"),
    note: text("note"),
    stato: varchar("stato", { length: 20 }).notNull().default("aperto"),
    isGenerale: boolean("is_generale").notNull().default(false),
    creatoDa: integer("creato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    aggiornatoDa: integer("aggiornato_da").references(() => utentiTable.id, {
      onDelete: "set null",
    }),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataAggiornamento: timestamp("data_aggiornamento", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "lotti_logici_stato_check",
      sql`${table.stato} in ('aperto', 'chiuso', 'archiviato')`,
    ),
    check(
      "lotti_logici_generale_aperto_check",
      sql`not ${table.isGenerale} or ${table.stato} = 'aperto'`,
    ),
    uniqueIndex("lotti_logici_area_codice_unique").on(
      table.areaOperativaId,
      table.codice,
    ),
    uniqueIndex("lotti_logici_area_generale_unique")
      .on(table.areaOperativaId)
      .where(sql`${table.isGenerale} = true`),
    index("lotti_logici_area_stato_idx").on(table.areaOperativaId, table.stato),
  ],
);

export const insertLottoLogicoSchema = createInsertSchema(
  lottiLogiciTable,
).omit({ id: true, dataCreazione: true, dataAggiornamento: true });
export type InsertLottoLogico = z.infer<typeof insertLottoLogicoSchema>;
export type LottoLogico = typeof lottiLogiciTable.$inferSelect;
