import {
  decimal,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { utentiTable } from "./auth";
import { creditoSolidaleMovimentiTable } from "./creditoSolidaleMovimenti";
import { movimentiTable } from "./movimenti";
import { speseEmporioRigheTable, speseEmporioTable } from "./speseEmporio";

export const speseEmporioStorniTable = pgTable("spese_emporio_storni", {
  id: serial("id").primaryKey(),
  spesaEmporioId: integer("spesa_emporio_id")
    .notNull()
    .references(() => speseEmporioTable.id),
  motivo: text("motivo").notNull(),
  operatoreId: integer("operatore_id").references(() => utentiTable.id),
  creditoRestituito: decimal("credito_restituito", {
    precision: 10,
    scale: 2,
  })
    .notNull()
    .default("0"),
  movimentoCreditoSolidaleId: integer(
    "movimento_credito_solidale_id",
  ).references(() => creditoSolidaleMovimentiTable.id),
  idempotencyKey: varchar("idempotency_key", { length: 100 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const speseEmporioStorniRigheTable = pgTable(
  "spese_emporio_storni_righe",
  {
    id: serial("id").primaryKey(),
    stornoId: integer("storno_id")
      .notNull()
      .references(() => speseEmporioStorniTable.id),
    spesaRigaId: integer("spesa_riga_id")
      .notNull()
      .references(() => speseEmporioRigheTable.id),
    quantita: decimal("quantita", { precision: 14, scale: 6 }).notNull(),
    creditoRestituito: decimal("credito_restituito", {
      precision: 10,
      scale: 2,
    }).notNull(),
    movimentoInventarioId: integer("movimento_inventario_id").references(
      () => movimentiTable.id,
    ),
    movimentoInventarioOriginaleId: integer(
      "movimento_inventario_originale_id",
    ).references(() => movimentiTable.id),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

export type SpesaEmporioStorno = typeof speseEmporioStorniTable.$inferSelect;
export type SpesaEmporioStornoRiga =
  typeof speseEmporioStorniRigheTable.$inferSelect;
