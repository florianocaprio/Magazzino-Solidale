import { sql } from "drizzle-orm";
import {
  check,
  date,
  decimal,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { bolleTable } from "./bolle";
import { trasferimentiTable } from "./trasferimenti";
import { movimentiTable } from "./movimenti";
import { lottiTable } from "./lotti";
import { prodottiTable } from "./prodotti";
import { magazziniTable } from "./magazzini";
import { utentiTable } from "./auth";
import { scarichiTable } from "./scarichi";

export const rientriTrasportoTable = pgTable(
  "rientri_trasporto",
  {
    id: serial("id").primaryKey(),
    bollaId: integer("bolla_id").references(() => bolleTable.id, {
      onDelete: "restrict",
    }),
    trasferimentoId: integer("trasferimento_id").references(
      () => trasferimentiTable.id,
      { onDelete: "restrict" },
    ),
    magazzinoOrigineId: integer("magazzino_origine_id")
      .notNull()
      .references(() => magazziniTable.id, { onDelete: "restrict" }),
    dataRientro: date("data_rientro").notNull(),
    note: text("note"),
    createdBy: integer("created_by")
      .notNull()
      .references(() => utentiTable.id, { onDelete: "restrict" }),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("rientri_trasporto_bolla_unique").on(table.bollaId),
    uniqueIndex("rientri_trasporto_trasferimento_unique").on(
      table.trasferimentoId,
    ),
    unique("rientri_trasporto_id_bolla_unique").on(table.id, table.bollaId),
    unique("rientri_trasporto_id_trasferimento_unique").on(
      table.id,
      table.trasferimentoId,
    ),
    check(
      "rientri_trasporto_owner_exclusive",
      sql`(${table.bollaId} IS NOT NULL AND ${table.trasferimentoId} IS NULL) OR (${table.bollaId} IS NULL AND ${table.trasferimentoId} IS NOT NULL)`,
    ),
  ],
);

export const rientroTrasportoRigheTable = pgTable(
  "rientro_trasporto_righe",
  {
    id: serial("id").primaryKey(),
    rientroId: integer("rientro_id")
      .notNull()
      .references(() => rientriTrasportoTable.id, { onDelete: "restrict" }),
    bollaId: integer("bolla_id"),
    trasferimentoId: integer("trasferimento_id"),
    movimentoUscitaId: integer("movimento_uscita_id")
      .notNull()
      .references(() => movimentiTable.id, { onDelete: "restrict" }),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id, { onDelete: "restrict" }),
    lottoId: integer("lotto_id")
      .notNull()
      .references(() => lottiTable.id, { onDelete: "restrict" }),
    tipoEsito: varchar("tipo_esito", { length: 20 }).notNull(),
    quantita: decimal("quantita", { precision: 14, scale: 6 }).notNull(),
    nota: text("nota"),
    scaricoId: integer("scarico_id").references(() => scarichiTable.id, {
      onDelete: "restrict",
    }),
    movimentoRientroId: integer("movimento_rientro_id").references(
      () => movimentiTable.id,
      { onDelete: "restrict" },
    ),
    movimentoEsitoId: integer("movimento_esito_id").references(
      () => movimentiTable.id,
      { onDelete: "restrict" },
    ),
  },
  (table) => [
    index("rientro_trasporto_righe_uscita_idx").on(table.movimentoUscitaId),
    uniqueIndex("rientro_trasporto_righe_esito_unique").on(
      table.rientroId,
      table.movimentoUscitaId,
      table.tipoEsito,
    ),
    check(
      "rientro_trasporto_righe_quantita_positive",
      sql`${table.quantita} > 0`,
    ),
    check(
      "rientro_trasporto_righe_tipo_esito_check",
      sql`${table.tipoEsito} IN ('idonea', 'deteriorata', 'scaduta', 'mancante', 'rubata')`,
    ),
    check(
      "rientro_trasporto_righe_owner_exclusive",
      sql`(${table.bollaId} IS NOT NULL AND ${table.trasferimentoId} IS NULL) OR (${table.bollaId} IS NULL AND ${table.trasferimentoId} IS NOT NULL)`,
    ),
    foreignKey({
      name: "rientro_trasporto_righe_bolla_owner_fk",
      columns: [table.rientroId, table.bollaId],
      foreignColumns: [rientriTrasportoTable.id, rientriTrasportoTable.bollaId],
    }).onDelete("restrict"),
    foreignKey({
      name: "rientro_trasporto_righe_trasferimento_owner_fk",
      columns: [table.rientroId, table.trasferimentoId],
      foreignColumns: [
        rientriTrasportoTable.id,
        rientriTrasportoTable.trasferimentoId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "rientro_trasporto_righe_bolla_uscita_fk",
      columns: [
        table.movimentoUscitaId,
        table.bollaId,
        table.prodottoId,
        table.lottoId,
      ],
      foreignColumns: [
        movimentiTable.id,
        movimentiTable.bollaId,
        movimentiTable.prodottoId,
        movimentiTable.lottoId,
      ],
    }).onDelete("restrict"),
    foreignKey({
      name: "rientro_trasporto_righe_trasferimento_uscita_fk",
      columns: [
        table.movimentoUscitaId,
        table.trasferimentoId,
        table.prodottoId,
        table.lottoId,
      ],
      foreignColumns: [
        movimentiTable.id,
        movimentiTable.trasferimentoId,
        movimentiTable.prodottoId,
        movimentiTable.lottoId,
      ],
    }).onDelete("restrict"),
  ],
);
