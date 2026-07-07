import { pgTable, serial, varchar, boolean, timestamp, integer, jsonb, json, index, uniqueIndex } from "drizzle-orm/pg-core";
import { centriAscoltoTable } from "./centri";
import { cittaTable } from "./citta";
import { zoneUdsTable } from "./zoneUds";

export const ruoliTable = pgTable("ruoli", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 60 }).notNull().unique(),
  descrizione: varchar("descrizione", { length: 200 }),
  aree: jsonb("aree").$type<string[]>().notNull().default([]),
  isAdmin: boolean("is_admin").notNull().default(false),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const utentiTable = pgTable(
  "utenti",
  {
    id: serial("id").primaryKey(),
    username: varchar("username", { length: 60 }).notNull().unique(),
    passwordHash: varchar("password_hash", { length: 200 }).notNull(),
    nome: varchar("nome", { length: 120 }).notNull(),
    cognome: varchar("cognome", { length: 120 }),
    matricola: varchar("matricola", { length: 40 }),
    ruoloId: integer("ruolo_id").references(() => ruoliTable.id),
    centroAscoltoId: integer("centro_ascolto_id").references(() => centriAscoltoTable.id),
    cittaId: integer("citta_id").references(() => cittaTable.id),
    zonaUdsId: integer("zona_uds_id").references(() => zoneUdsTable.id),
    attivo: boolean("attivo").notNull().default(true),
    isSuperAdmin: boolean("is_super_admin").notNull().default(false),
    mustChangePassword: boolean("must_change_password").notNull().default(false),
    ultimoAccesso: timestamp("ultimo_accesso"),
    dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
  },
  (table) => [uniqueIndex("utenti_matricola_unique").on(table.matricola)],
);

// Session store table for connect-pg-simple. Defined here (instead of relying
// on createTableIfMissing) because the bundled server can't read the library's
// table.sql; pushing the schema creates it deterministically.
export const userSessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: json("sess").notNull(),
    expire: timestamp("expire", { precision: 6 }).notNull(),
  },
  (table) => [index("IDX_user_sessions_expire").on(table.expire)],
);

export type Ruolo = typeof ruoliTable.$inferSelect;
export type Utente = typeof utentiTable.$inferSelect;
