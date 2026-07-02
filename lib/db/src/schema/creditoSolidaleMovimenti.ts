import { boolean, decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { centriAscoltoTable } from "./centri";
import { cittaTable } from "./citta";
import { politicheCreditoSolidaleTable } from "./politicheCreditoSolidale";

export const creditoSolidaleMovimentiTable = pgTable("credito_solidale_movimenti", {
  id: serial("id").primaryKey(),
  beneficiarioId: integer("beneficiario_id").notNull().references(() => beneficiariTable.id),
  centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
  cittaId: integer("citta_id").references(() => cittaTable.id),
  tipoMovimento: varchar("tipo_movimento", { length: 40 }).notNull(),
  variazioneCredito: decimal("variazione_credito", { precision: 10, scale: 2 }).notNull(),
  saldoPrima: decimal("saldo_prima", { precision: 10, scale: 2 }).notNull(),
  saldoDopo: decimal("saldo_dopo", { precision: 10, scale: 2 }).notNull(),
  periodoRiferimento: varchar("periodo_riferimento", { length: 7 }),
  politicaCreditoSolidaleId: integer("politica_credito_solidale_id").references(() => politicheCreditoSolidaleTable.id),
  quotaMensileAssegnata: decimal("quota_mensile_assegnata", { precision: 10, scale: 2 }),
  origine: varchar("origine", { length: 40 }),
  riferimentoId: integer("riferimento_id"),
  riferimentoTipo: varchar("riferimento_tipo", { length: 60 }),
  note: text("note"),
  motivo: text("motivo"),
  operatoreId: integer("operatore_id"),
  dataMovimento: timestamp("data_movimento").notNull().defaultNow(),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  annullato: boolean("annullato").notNull().default(false),
  annullatoDaMovimentoId: integer("annullato_da_movimento_id"),
});

export type CreditoSolidaleMovimento = typeof creditoSolidaleMovimentiTable.$inferSelect;
