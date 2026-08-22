import { sql } from "drizzle-orm";
import { pgTable, serial, varchar, text, boolean, timestamp, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { areeOperativeTable } from "./areeOperative";

export const zoneUdsTable = pgTable("zone_uds", {
  id: serial("id").primaryKey(),
  areaOperativaId: integer("area_operativa_id")
    .notNull()
    .references(() => areeOperativeTable.id),
  nome: varchar("nome", { length: 120 }).notNull(),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  versione: integer("versione").notNull().default(1),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("zone_uds_id_area_unique").on(table.id, table.areaOperativaId),
  uniqueIndex("zone_uds_area_nome_attiva_unique")
    .on(table.areaOperativaId, sql`lower(trim(${table.nome}))`)
    .where(sql`${table.attivo} = true`),
]);

export const insertZonaUdsSchema = createInsertSchema(zoneUdsTable).omit({ id: true, versione: true, dataCreazione: true, dataAggiornamento: true });
export type InsertZonaUds = z.infer<typeof insertZonaUdsSchema>;
export type ZonaUds = typeof zoneUdsTable.$inferSelect;
