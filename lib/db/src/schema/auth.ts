import { pgTable, serial, varchar, boolean, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

export const ruoliTable = pgTable("ruoli", {
  id: serial("id").primaryKey(),
  nome: varchar("nome", { length: 60 }).notNull().unique(),
  descrizione: varchar("descrizione", { length: 200 }),
  aree: jsonb("aree").$type<string[]>().notNull().default([]),
  isAdmin: boolean("is_admin").notNull().default(false),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export const utentiTable = pgTable("utenti", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 60 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 200 }).notNull(),
  nome: varchar("nome", { length: 120 }).notNull(),
  ruoloId: integer("ruolo_id").references(() => ruoliTable.id),
  attivo: boolean("attivo").notNull().default(true),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  ultimoAccesso: timestamp("ultimo_accesso"),
  dataCreazione: timestamp("data_creazione").notNull().defaultNow(),
});

export type Ruolo = typeof ruoliTable.$inferSelect;
export type Utente = typeof utentiTable.$inferSelect;
