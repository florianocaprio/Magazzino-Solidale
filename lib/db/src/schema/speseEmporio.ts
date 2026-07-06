import { decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { beneficiariTable } from "./beneficiari";
import { bolleTable, bollaRigheTable } from "./bolle";
import { centriAscoltoTable } from "./centri";
import { cittaTable } from "./citta";
import { consegneTable } from "./consegne";
import { creditoSolidaleMovimentiTable } from "./creditoSolidaleMovimenti";
import { lottiTable } from "./lotti";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";
import { scarichiTable } from "./scarichi";
import { sessioniCassaEmporioRigheTable } from "./sessioniCassaEmporioRighe";
import { sessioniCassaEmporioTable } from "./sessioniCassaEmporio";

export const speseEmporioTable = pgTable("spese_emporio", {
  id: serial("id").primaryKey(),
  sessioneCassaId: integer("sessione_cassa_id").notNull().references(() => sessioniCassaEmporioTable.id).unique(),
  accessoEmporioId: integer("accesso_emporio_id").notNull().references(() => consegneTable.id),
  beneficiarioId: integer("beneficiario_id").notNull().references(() => beneficiariTable.id),
  centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
  cittaId: integer("citta_id").references(() => cittaTable.id),
  magazzinoEmporioId: integer("magazzino_emporio_id").notNull().references(() => magazziniTable.id),
  scaricoId: integer("scarico_id").references(() => scarichiTable.id),
  bollaId: integer("bolla_id").references(() => bolleTable.id),
  movimentoCreditoSolidaleId: integer("movimento_credito_solidale_id").references(() => creditoSolidaleMovimentiTable.id),
  numeroSpesa: varchar("numero_spesa", { length: 80 }).notNull().unique(),
  dataChiusura: timestamp("data_chiusura").notNull().defaultNow(),
  totaleCreditoConsumati: decimal("totale_credito_consumati", { precision: 10, scale: 2 }).notNull(),
  saldoPrima: decimal("saldo_prima", { precision: 10, scale: 2 }).notNull(),
  saldoDopo: decimal("saldo_dopo", { precision: 10, scale: 2 }).notNull(),
  statoSpesa: varchar("stato_spesa", { length: 40 }).notNull().default("chiusa"),
  operatoreChiusuraId: integer("operatore_chiusura_id").references(() => utentiTable.id),
  emailBollaStato: varchar("email_bolla_stato", { length: 40 }).notNull().default("non_preparata"),
  emailBollaDestinatari: text("email_bolla_destinatari"),
  emailBollaDataInvio: timestamp("email_bolla_data_invio"),
  emailBollaDataUltimoClick: timestamp("email_bolla_data_ultimo_click"),
  emailBollaOperatoreId: integer("email_bolla_operatore_id").references(() => utentiTable.id),
  emailBollaOggetto: text("email_bolla_oggetto"),
  emailBollaErrore: text("email_bolla_errore"),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const speseEmporioRigheTable = pgTable("spese_emporio_righe", {
  id: serial("id").primaryKey(),
  spesaEmporioId: integer("spesa_emporio_id").notNull().references(() => speseEmporioTable.id),
  sessioneCassaRigaId: integer("sessione_cassa_riga_id").references(() => sessioniCassaEmporioRigheTable.id),
  prodottoId: integer("prodotto_id").notNull().references(() => prodottiTable.id),
  lottoId: integer("lotto_id").references(() => lottiTable.id),
  codiceProdotto: varchar("codice_prodotto", { length: 80 }),
  descrizioneProdotto: text("descrizione_prodotto").notNull(),
  quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
  creditoUnitario: decimal("credito_unitario", { precision: 10, scale: 2 }).notNull(),
  creditoTotale: decimal("credito_totale", { precision: 10, scale: 2 }).notNull(),
  scaricoId: integer("scarico_id").references(() => scarichiTable.id),
  bollaRigaId: integer("bolla_riga_id").references(() => bollaRigheTable.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SpesaEmporio = typeof speseEmporioTable.$inferSelect;
export type SpesaEmporioRiga = typeof speseEmporioRigheTable.$inferSelect;
