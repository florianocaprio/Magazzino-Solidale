import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { beneficiariTable } from "./beneficiari";
import { cittaTable } from "./citta";
import { magazziniTable } from "./magazzini";
import { prodottiTable } from "./prodotti";
import { scarichiTable } from "./scarichi";
import { utentiTable } from "./auth";

export const menseTable = pgTable(
  "mense",
  {
    id: serial("id").primaryKey(),
    codice: varchar("codice", { length: 30 }).notNull(),
    nome: varchar("nome", { length: 160 }).notNull(),
    cittaId: integer("citta_id")
      .notNull()
      .references(() => cittaTable.id),
    magazzinoId: integer("magazzino_id")
      .notNull()
      .references(() => magazziniTable.id),
    indirizzo: varchar("indirizzo", { length: 255 }),
    attiva: boolean("attiva").notNull().default(true),
    note: text("note"),
    createdBy: integer("created_by").references(() => utentiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mense_codice_unique").on(table.codice),
    uniqueIndex("mense_magazzino_unique").on(table.magazzinoId),
    index("mense_citta_idx").on(table.cittaId),
    index("mense_attiva_idx").on(table.attiva),
  ],
);

export const mensaAbilitazioniTable = pgTable(
  "mensa_abilitazioni",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    dataInizio: date("data_inizio").notNull(),
    dataFine: date("data_fine"),
    stato: varchar("stato", { length: 20 }).notNull().default("attiva"),
    mensaPrincipale: boolean("mensa_principale").notNull().default(true),
    motivo: text("motivo"),
    createdBy: integer("created_by").references(() => utentiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("mensa_abilitazioni_beneficiario_idx").on(table.beneficiarioId),
    index("mensa_abilitazioni_mensa_idx").on(table.mensaId),
    index("mensa_abilitazioni_stato_idx").on(table.stato),
    uniqueIndex("mensa_abilitazioni_principale_attiva_unique")
      .on(table.beneficiarioId)
      .where(
        sql`${table.stato} = 'attiva' and ${table.mensaPrincipale} = true`,
      ),
    check(
      "mensa_abilitazioni_stato_check",
      sql`${table.stato} in ('attiva', 'sospesa', 'revocata', 'scaduta')`,
    ),
    check(
      "mensa_abilitazioni_date_check",
      sql`${table.dataFine} is null or ${table.dataFine} >= ${table.dataInizio}`,
    ),
  ],
);

export const tessereBeneficiariTable = pgTable(
  "tessere_beneficiari",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    codice: varchar("codice", { length: 64 }).notNull(),
    stato: varchar("stato", { length: 20 }).notNull().default("attiva"),
    dataEmissione: timestamp("data_emissione", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataScadenza: date("data_scadenza"),
    dataRevoca: timestamp("data_revoca", { withTimezone: true }),
    motivoRevoca: text("motivo_revoca"),
    createdBy: integer("created_by").references(() => utentiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("tessere_beneficiari_codice_unique").on(table.codice),
    uniqueIndex("tessere_beneficiari_attiva_unique")
      .on(table.beneficiarioId)
      .where(sql`${table.stato} = 'attiva'`),
    index("tessere_beneficiari_beneficiario_idx").on(table.beneficiarioId),
    index("tessere_beneficiari_stato_idx").on(table.stato),
    check(
      "tessere_beneficiari_stato_check",
      sql`${table.stato} in ('attiva', 'sospesa', 'revocata', 'scaduta')`,
    ),
  ],
);

export const mensaAutorizzazioniTemporaneeTable = pgTable(
  "mensa_autorizzazioni_temporanee",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    dataServizio: date("data_servizio").notNull(),
    motivo: text("motivo").notNull(),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_autorizzazioni_temporanee_giorno_unique").on(
      table.beneficiarioId,
      table.mensaId,
      table.dataServizio,
    ),
    index("mensa_autorizzazioni_temporanee_mensa_data_idx").on(
      table.mensaId,
      table.dataServizio,
    ),
  ],
);

export const mensaAccessiTable = pgTable(
  "mensa_accessi",
  {
    id: serial("id").primaryKey(),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    beneficiarioId: integer("beneficiario_id").references(
      () => beneficiariTable.id,
    ),
    tesseraId: integer("tessera_id").references(
      () => tessereBeneficiariTable.id,
    ),
    autorizzazioneTemporaneaId: integer(
      "autorizzazione_temporanea_id",
    ).references(() => mensaAutorizzazioniTemporaneeTable.id),
    dataOra: timestamp("data_ora", { withTimezone: true })
      .notNull()
      .defaultNow(),
    esito: varchar("esito", { length: 30 }).notNull(),
    motivoEsito: varchar("motivo_esito", { length: 50 }).notNull(),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    eccezioneId: integer("eccezione_id"),
    modalitaAccesso: varchar("modalita_accesso", { length: 20 }).notNull(),
    tipoServizio: varchar("tipo_servizio", { length: 40 }),
    idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_accessi_idempotency_unique").on(table.idempotencyKey),
    index("mensa_accessi_mensa_data_idx").on(table.mensaId, table.dataOra),
    index("mensa_accessi_beneficiario_data_idx").on(
      table.beneficiarioId,
      table.dataOra,
    ),
    check(
      "mensa_accessi_esito_check",
      sql`${table.esito} in ('consentito', 'negato', 'consentito_eccezione')`,
    ),
    check(
      "mensa_accessi_modalita_check",
      sql`${table.modalitaAccesso} in ('tessera', 'manuale', 'temporaneo')`,
    ),
    check(
      "mensa_accessi_tipo_servizio_check",
      sql`${table.tipoServizio} is null or ${table.tipoServizio} in ('pranzo', 'cena')`,
    ),
  ],
);

export const mensaEccezioniTable = pgTable(
  "mensa_eccezioni",
  {
    id: serial("id").primaryKey(),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    mensaPrincipaleId: integer("mensa_principale_id")
      .notNull()
      .references(() => menseTable.id),
    mensaDestinazioneId: integer("mensa_destinazione_id")
      .notNull()
      .references(() => menseTable.id),
    cittaId: integer("citta_id")
      .notNull()
      .references(() => cittaTable.id),
    motivo: text("motivo").notNull(),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    dataOra: timestamp("data_ora", { withTimezone: true })
      .notNull()
      .defaultNow(),
    accessoMensaId: integer("accesso_mensa_id")
      .notNull()
      .references(() => mensaAccessiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_eccezioni_accesso_unique").on(table.accessoMensaId),
    index("mensa_eccezioni_beneficiario_idx").on(table.beneficiarioId),
    index("mensa_eccezioni_mensa_data_idx").on(
      table.mensaDestinazioneId,
      table.dataOra,
    ),
  ],
);

export const mensaPastiTable = pgTable(
  "mensa_pasti",
  {
    id: serial("id").primaryKey(),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    beneficiarioId: integer("beneficiario_id")
      .notNull()
      .references(() => beneficiariTable.id),
    accessoMensaId: integer("accesso_mensa_id")
      .notNull()
      .references(() => mensaAccessiTable.id),
    dataOra: timestamp("data_ora", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dataServizio: date("data_servizio").notNull(),
    tipoServizio: varchar("tipo_servizio", { length: 40 }).notNull(),
    giornataServizioId: integer("giornata_servizio_id"),
    sessoSnapshot: varchar("sesso_snapshot", { length: 10 }),
    fasciaEtaSnapshot: varchar("fascia_eta_snapshot", { length: 20 }),
    fasciaEtaOrigineSnapshot: varchar("fascia_eta_origine_snapshot", {
      length: 20,
    }),
    anagraficaProvvisoriaSnapshot: boolean("anagrafica_provvisoria_snapshot"),
    temporaneoSnapshot: boolean("temporaneo_snapshot"),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    eccezioneId: integer("eccezione_id").references(
      () => mensaEccezioniTable.id,
    ),
    note: text("note"),
    override: boolean("override").notNull().default(false),
    motivoOverride: text("motivo_override"),
    idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_pasti_accesso_unique").on(table.accessoMensaId),
    uniqueIndex("mensa_pasti_idempotency_unique").on(table.idempotencyKey),
    uniqueIndex("mensa_pasti_servizio_giorno_unique")
      .on(table.beneficiarioId, table.dataServizio, table.tipoServizio)
      .where(sql`${table.override} = false`),
    index("mensa_pasti_mensa_servizio_idx").on(
      table.mensaId,
      table.dataServizio,
    ),
    index("mensa_pasti_beneficiario_servizio_idx").on(
      table.beneficiarioId,
      table.dataServizio,
    ),
    check(
      "mensa_pasti_tipo_check",
      sql`${table.tipoServizio} in ('pranzo', 'cena')`,
    ),
    check(
      "mensa_pasti_override_motivo_check",
      sql`${table.override} = false or length(trim(coalesce(${table.motivoOverride}, ''))) > 0`,
    ),
  ],
);

export const mensaGiornateServizioTable = pgTable(
  "mensa_giornate_servizio",
  {
    id: serial("id").primaryKey(),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    dataServizio: date("data_servizio").notNull(),
    tipoServizio: varchar("tipo_servizio", { length: 40 }).notNull(),
    stato: varchar("stato", { length: 20 }).notNull().default("aperta"),
    apertaDa: integer("aperta_da").references(() => utentiTable.id),
    apertaAt: timestamp("aperta_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    chiusaDa: integer("chiusa_da").references(() => utentiTable.id),
    chiusaAt: timestamp("chiusa_at", { withTimezone: true }),
    riapertaDa: integer("riaperta_da").references(() => utentiTable.id),
    riapertaAt: timestamp("riaperta_at", { withTimezone: true }),
    motivoRiapertura: text("motivo_riapertura"),
    noteChiusura: text("note_chiusura"),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_giornate_servizio_unique").on(
      table.mensaId,
      table.dataServizio,
      table.tipoServizio,
    ),
    index("mensa_giornate_servizio_mensa_data_idx").on(
      table.mensaId,
      table.dataServizio,
    ),
    check(
      "mensa_giornate_servizio_tipo_check",
      sql`${table.tipoServizio} in ('pranzo', 'cena')`,
    ),
    check(
      "mensa_giornate_servizio_stato_check",
      sql`${table.stato} in ('aperta', 'chiusa')`,
    ),
  ],
);

export const mensaConsumiTable = pgTable(
  "mensa_consumi",
  {
    id: serial("id").primaryKey(),
    giornataServizioId: integer("giornata_servizio_id")
      .notNull()
      .references(() => mensaGiornateServizioTable.id),
    mensaId: integer("mensa_id")
      .notNull()
      .references(() => menseTable.id),
    scaricoId: integer("scarico_id")
      .notNull()
      .references(() => scarichiTable.id),
    dataServizio: date("data_servizio").notNull(),
    tipoServizio: varchar("tipo_servizio", { length: 40 }).notNull(),
    prodottoId: integer("prodotto_id")
      .notNull()
      .references(() => prodottiTable.id),
    quantita: decimal("quantita", { precision: 10, scale: 2 }).notNull(),
    unitaMisura: varchar("unita_misura", { length: 20 }).notNull(),
    causale: varchar("causale", { length: 20 }).notNull(),
    note: text("note"),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    idempotencyKey: varchar("idempotency_key", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_consumi_idempotency_unique").on(table.idempotencyKey),
    index("mensa_consumi_giornata_idx").on(table.giornataServizioId),
    index("mensa_consumi_mensa_data_idx").on(table.mensaId, table.dataServizio),
    check(
      "mensa_consumi_tipo_check",
      sql`${table.tipoServizio} in ('pranzo', 'cena')`,
    ),
    check(
      "mensa_consumi_causale_check",
      sql`${table.causale} in ('consumo', 'scarto')`,
    ),
    check("mensa_consumi_quantita_check", sql`${table.quantita} > 0`),
  ],
);

export const mensaConsumiStorniTable = pgTable(
  "mensa_consumi_storni",
  {
    id: serial("id").primaryKey(),
    consumoId: integer("consumo_id")
      .notNull()
      .references(() => mensaConsumiTable.id),
    motivo: text("motivo").notNull(),
    operatoreId: integer("operatore_id")
      .notNull()
      .references(() => utentiTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("mensa_consumi_storni_consumo_unique").on(table.consumoId),
  ],
);

export type Mensa = typeof menseTable.$inferSelect;
export type MensaAbilitazione = typeof mensaAbilitazioniTable.$inferSelect;
export type TesseraBeneficiario = typeof tessereBeneficiariTable.$inferSelect;
export type MensaAutorizzazioneTemporanea =
  typeof mensaAutorizzazioniTemporaneeTable.$inferSelect;
export type MensaAccesso = typeof mensaAccessiTable.$inferSelect;
export type MensaEccezione = typeof mensaEccezioniTable.$inferSelect;
export type MensaPasto = typeof mensaPastiTable.$inferSelect;
export type MensaGiornataServizio =
  typeof mensaGiornateServizioTable.$inferSelect;
export type MensaConsumo = typeof mensaConsumiTable.$inferSelect;
