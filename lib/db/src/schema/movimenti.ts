import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  decimal,
  integer,
  date,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const movimentiTable = pgTable("movimenti", {
  id: serial("id").primaryKey(),
  tipoMovimento: varchar("tipo_movimento", { length: 20 }).notNull(),
  tipoDettaglio: varchar("tipo_dettaglio", { length: 40 }).notNull(),
  dataMovimento: date("data_movimento").notNull(),
  magazzinoId: integer("magazzino_id").notNull(),
  prodottoId: integer("prodotto_id").notNull(),
  lottoId: integer("lotto_id"),
  quantita: decimal("quantita", { precision: 14, scale: 6 }).notNull(),
  quantitaPezzi: decimal("quantita_pezzi", { precision: 14, scale: 6 }),
  quantitaKgLt: decimal("quantita_kg_lt", { precision: 14, scale: 6 }),
  unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
  fornitoreId: integer("fornitore_id"),
  beneficiarioId: integer("beneficiario_id"),
  bollaId: integer("bolla_id"),
  bollaRigaId: integer("bolla_riga_id"),
  trasferimentoId: integer("trasferimento_id"),
  movimentoOrigineId: integer("movimento_origine_id"),
  fondoOrigine: varchar("fondo_origine", { length: 50 })
    .notNull()
    .default("NESSUN_FONDO"),
  naturaContabile: varchar("natura_contabile", { length: 50 })
    .notNull()
    .default("LEGACY"),
  dominioOrigine: varchar("dominio_origine", { length: 40 }),
  entitaOrigineTipo: varchar("entita_origine_tipo", { length: 80 }),
  entitaOrigineId: integer("entita_origine_id"),
  rigaOrigineId: integer("riga_origine_id"),
  caricoMagazzinoRigaId: integer("carico_magazzino_riga_id"),
  operazioneDistribuzioneId: integer("operazione_distribuzione_id"),
  canaleOperativo: varchar("canale_operativo", { length: 40 }),
  operatoreId: integer("operatore_id"),
  documentoRiferimento: varchar("documento_riferimento", { length: 100 }),
  note: text("note"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const insertMovimentoSchema = createInsertSchema(movimentiTable).omit({
  id: true,
  dataCreazione: true,
});
export type InsertMovimento = z.infer<typeof insertMovimentoSchema>;
export type Movimento = typeof movimentiTable.$inferSelect;
