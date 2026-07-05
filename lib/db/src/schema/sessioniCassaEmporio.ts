import { decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { centriAscoltoTable } from "./centri";
import { cittaTable } from "./citta";
import { consegneTable } from "./consegne";
import { magazziniTable } from "./magazzini";

export const sessioniCassaEmporioTable = pgTable("sessioni_cassa_emporio", {
  id: serial("id").primaryKey(),
  accessoEmporioId: integer("accesso_emporio_id").notNull().references(() => consegneTable.id),
  beneficiarioId: integer("beneficiario_id").notNull().references(() => beneficiariTable.id),
  magazzinoEmporioId: integer("magazzino_emporio_id").notNull().references(() => magazziniTable.id),
  centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
  cittaId: integer("citta_id").references(() => cittaTable.id),
  statoSessione: varchar("stato_sessione", { length: 40 }).notNull().default("aperta"),
  saldoCreditoIniziale: decimal("saldo_credito_iniziale", { precision: 10, scale: 2 }).notNull().default("0"),
  totaleCreditoPrevisto: decimal("totale_credito_previsto", { precision: 10, scale: 2 }).notNull().default("0"),
  creditoResiduoPrevisto: decimal("credito_residuo_previsto", { precision: 10, scale: 2 }).notNull().default("0"),
  operatoreAperturaId: integer("operatore_apertura_id"),
  operatoreUltimaModificaId: integer("operatore_ultima_modifica_id"),
  dataApertura: timestamp("data_apertura").notNull().defaultNow(),
  dataUltimaModifica: timestamp("data_ultima_modifica").notNull().defaultNow(),
  dataSospensione: timestamp("data_sospensione"),
  dataAnnullamento: timestamp("data_annullamento"),
  motivoAnnullamento: text("motivo_annullamento"),
  note: text("note"),
});

export type SessioneCassaEmporio = typeof sessioniCassaEmporioTable.$inferSelect;
