import { boolean, decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { lottiTable } from "./lotti";
import { prodottiTable } from "./prodotti";
import { sessioniCassaEmporioTable } from "./sessioniCassaEmporio";

export const sessioniCassaEmporioRigheTable = pgTable("sessioni_cassa_emporio_righe", {
  id: serial("id").primaryKey(),
  sessioneCassaId: integer("sessione_cassa_id").notNull().references(() => sessioniCassaEmporioTable.id),
  prodottoId: integer("prodotto_id").notNull().references(() => prodottiTable.id),
  lottoId: integer("lotto_id").references(() => lottiTable.id),
  codiceProdotto: varchar("codice_prodotto", { length: 80 }),
  descrizioneProdotto: text("descrizione_prodotto").notNull(),
  quantita: integer("quantita").notNull(),
  creditoUnitario: decimal("credito_unitario", { precision: 10, scale: 2 }).notNull(),
  creditoTotale: decimal("credito_totale", { precision: 10, scale: 2 }).notNull(),
  giacenzaDisponibileAlMomento: integer("giacenza_disponibile_al_momento"),
  limitePerSpesa: integer("limite_per_spesa"),
  limiteMensile: integer("limite_mensile"),
  superaLimitePerSpesa: boolean("supera_limite_per_spesa").notNull().default(false),
  superaLimiteMensile: boolean("supera_limite_mensile").notNull().default(false),
  superaGiacenza: boolean("supera_giacenza").notNull().default(false),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  dataAggiornamento: timestamp("data_aggiornamento").notNull().defaultNow(),
});

export type SessioneCassaEmporioRiga = typeof sessioniCassaEmporioRigheTable.$inferSelect;
