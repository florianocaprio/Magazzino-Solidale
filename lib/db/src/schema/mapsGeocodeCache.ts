import { index, pgTable, serial, timestamp, uniqueIndex, varchar, decimal } from "drizzle-orm/pg-core";

/** Cache tecnico: conserva esclusivamente l'indirizzo necessario alla localizzazione. */
export const mapsGeocodeCacheTable = pgTable("maps_geocode_cache", {
  id: serial("id").primaryKey(),
  normalizedAddress: varchar("normalized_address", { length: 500 }).notNull(),
  originalAddress: varchar("original_address", { length: 500 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  provider: varchar("provider", { length: 80 }).notNull(),
  status: varchar("status", { length: 20 }).notNull(),
  lastAttemptAt: timestamp("last_attempt_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("maps_geocode_cache_normalized_address_uidx").on(table.normalizedAddress),
  index("maps_geocode_cache_status_last_attempt_idx").on(table.status, table.lastAttemptAt),
]);
