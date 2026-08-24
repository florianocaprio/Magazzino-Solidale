import {
  index,
  pgTable,
  serial,
  varchar,
  text,
  boolean,
  timestamp,
  decimal,
  integer,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { utentiTable } from "./auth";
import { areeOperativeTable } from "./areeOperative";
import { centriAscoltoTable } from "./centri";

export const bolleTable = pgTable(
  "bolle",
  {
    id: serial("id").primaryKey(),
    numeroBolla: varchar("numero_bolla", { length: 30 }).notNull().unique(),
    dataBolla: date("data_bolla").notNull(),
    beneficiarioId: integer("beneficiario_id").notNull(),
    consegnaId: integer("consegna_id"),
    magazzinoId: integer("magazzino_id").notNull(),
    areaOperativaIdSnapshot: integer("area_operativa_id_snapshot").references(
      () => areeOperativeTable.id,
      { onDelete: "set null" },
    ),
    centroAscoltoIdSnapshot: integer("centro_ascolto_id_snapshot").references(
      () => centriAscoltoTable.id,
      { onDelete: "set null" },
    ),
    numeroComponentiNucleoSnapshot: integer(
      "numero_componenti_nucleo_snapshot",
    ),
    indirizzoConsegna: varchar("indirizzo_consegna", { length: 200 }),
    operatoreId: integer("operatore_id").references(() => utentiTable.id),
    volontarioConsegnaId: integer("volontario_consegna_id"),
    trasportatoreNome: varchar("trasportatore_nome", { length: 120 }),
    mezzoId: integer("mezzo_id"),
    mezzoAltro: boolean("mezzo_altro").notNull().default(false),
    stato: varchar("stato", { length: 20 }).notNull().default("bozza"),
    noteConsegna: text("note_consegna"),
    confermaRicezione: boolean("conferma_ricezione").notNull().default(false),
    noteRicezione: text("note_ricezione"),
    firmaNota: text("firma_nota"),
    ritiroNonEffettuatoAt: timestamp("ritiro_non_effettuato_at", {
      withTimezone: true,
    }),
    ritiroNonEffettuatoOperatoreId: integer(
      "ritiro_non_effettuato_operatore_id",
    ).references(() => utentiTable.id),
    ritiroNonEffettuatoMotivo: varchar("ritiro_non_effettuato_motivo", {
      length: 500,
    }),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  },
  (table) => [
    index("bolle_reporting_snapshot_idx").on(
      table.stato,
      table.dataBolla,
      table.areaOperativaIdSnapshot,
      table.centroAscoltoIdSnapshot,
    ),
  ],
);

export const bollaRigheTable = pgTable("bolla_righe", {
  id: serial("id").primaryKey(),
  bollaId: integer("bolla_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  lottoId: integer("lotto_id"),
  quantita: decimal("quantita", { precision: 14, scale: 6 }).notNull(),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull().default("pz"),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertBollaSchema = createInsertSchema(bolleTable).omit({ id: true, dataCreazione: true });
export type InsertBolla = z.infer<typeof insertBollaSchema>;
export type Bolla = typeof bolleTable.$inferSelect;

export const insertBollaRigaSchema = createInsertSchema(bollaRigheTable).omit({ id: true, dataCreazione: true });
export type InsertBollaRiga = z.infer<typeof insertBollaRigaSchema>;
export type BollaRiga = typeof bollaRigheTable.$inferSelect;
