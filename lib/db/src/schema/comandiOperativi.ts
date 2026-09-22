import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Registro tecnico dei comandi HTTP idempotenti introdotti con M4A.
 *
 * La riga viene scritta nella stessa transazione dell'effetto e dell'audit.
 * Non sostituisce l'audit funzionale: conserva soltanto l'impronta della
 * richiesta e la risposta necessaria a riprodurre in sicurezza un retry.
 */
export const comandiOperativiTable = pgTable(
  "comandi_operativi",
  {
    id: serial("id").primaryKey(),
    tipoComando: varchar("tipo_comando", { length: 80 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    aggregatoTipo: varchar("aggregato_tipo", { length: 40 }).notNull(),
    aggregatoId: integer("aggregato_id").notNull(),
    versioneRichiesta: integer("versione_richiesta"),
    versioneRisultante: integer("versione_risultante"),
    resultSnapshot: jsonb("result_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    // Snapshot tecnico dell'attore che possedeva la sessione. L'audit comune
    // conserva il riferimento/snapshot autorevole; nessuna FK qui, perché il
    // registro è immutabile e non deve bloccare l'eventuale pulizia utenti.
    actorUserId: integer("actor_user_id").notNull(),
    dataCreazione: timestamp("data_creazione", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("comandi_operativi_tipo_chiave_unique").on(
      table.tipoComando,
      table.idempotencyKey,
    ),
    index("comandi_operativi_aggregato_idx").on(
      table.aggregatoTipo,
      table.aggregatoId,
      table.dataCreazione,
    ),
    check(
      "comandi_operativi_request_hash_check",
      sql`${table.requestHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "comandi_operativi_versioni_check",
      sql`(${table.versioneRichiesta} is null or ${table.versioneRichiesta} > 0)
          and (${table.versioneRisultante} is null or ${table.versioneRisultante} > 0)`,
    ),
  ],
);

export type ComandoOperativo = typeof comandiOperativiTable.$inferSelect;
