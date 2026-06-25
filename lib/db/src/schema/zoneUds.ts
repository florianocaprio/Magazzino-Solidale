import { pgTable, serial, varchar, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { cittaTable } from "./citta";

export const zoneUdsTable = pgTable("zone_uds", {
  id: serial("id").primaryKey(),
  cittaId: integer("citta_id")
    .notNull()
    .references(() => cittaTable.id),
  nome: varchar("nome", { length: 120 }).notNull(),
  attivo: boolean("attivo").notNull().default(true),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertZonaUdsSchema = createInsertSchema(zoneUdsTable).omit({ id: true, dataCreazione: true });
export type InsertZonaUds = z.infer<typeof insertZonaUdsSchema>;
export type ZonaUds = typeof zoneUdsTable.$inferSelect;
