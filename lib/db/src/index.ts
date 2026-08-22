import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

// numeric(p, 6) arriva da PostgreSQL con sei zeri anche per valori interi.
// Conserva il contratto legacy a due decimali senza perdere le ulteriori
// cifre significative introdotte dalla contabilità Magazzino 2.0A.
pg.types.setTypeParser(1700, (value) => {
  const [integer, fraction] = value.split(".");
  if (fraction == null || fraction.length <= 2) return value;
  return `${integer}.${fraction.replace(/0+$/, "").padEnd(2, "0")}`;
});

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
