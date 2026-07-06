import { boolean, decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { centriAscoltoTable } from "./centri";
import { cittaTable } from "./citta";

export const politicheCreditoSolidaleTable = pgTable("politiche_credito_solidale", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 120 }).notNull(),
  descrizione: text("descrizione"),
  centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
  cittaId: integer("citta_id").references(() => cittaTable.id),
  attiva: boolean("attiva").notNull().default(true),
  creditoBaseNucleo: decimal("credito_base_nucleo", { precision: 10, scale: 2 }).notNull().default("50"),
  creditoPerComponente: decimal("credito_per_componente", { precision: 10, scale: 2 }).notNull().default("10"),
  bonusMinore: decimal("bonus_minore", { precision: 10, scale: 2 }).notNull().default("5"),
  bonusAnziano: decimal("bonus_anziano", { precision: 10, scale: 2 }).notNull().default("5"),
  bonusDisabile: decimal("bonus_disabile", { precision: 10, scale: 2 }).notNull().default("10"),
  creditoMinimoMensile: decimal("credito_minimo_mensile", { precision: 10, scale: 2 }).notNull().default("0"),
  creditoMassimoMensile: decimal("credito_massimo_mensile", { precision: 10, scale: 2 }),
  giornoRicaricaMensile: integer("giorno_ricarica_mensile").notNull().default(1),
  ricaricaAutomaticaAbilitata: boolean("ricarica_automatica_abilitata").notNull().default(false),
  arrotondamento: varchar("arrotondamento", { length: 30 }).notNull().default("nessuno"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento"),
});

export const insertPoliticaCreditoSolidaleSchema = createInsertSchema(politicheCreditoSolidaleTable).omit({
  id: true,
  dataCreazione: true,
  dataAggiornamento: true,
});

export type InsertPoliticaCreditoSolidale = z.infer<typeof insertPoliticaCreditoSolidaleSchema>;
export type PoliticaCreditoSolidale = typeof politicheCreditoSolidaleTable.$inferSelect;
