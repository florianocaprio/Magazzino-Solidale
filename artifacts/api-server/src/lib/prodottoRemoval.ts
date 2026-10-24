import { sql } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

export const PRODUCT_HISTORY_MESSAGE =
  "Il prodotto ha carichi, movimenti, documenti o associazioni da conservare e non può essere eliminato. Puoi disattivarlo.";

/** Hold the product FOR UPDATE until deletion commits. Foreign keys serialize new uses. */
export async function hasProdottoHistory(tx: InventoryTransaction, id: number) {
  const references = await tx.execute<{
    schema_name: string;
    table_name: string;
    column_name: string;
  }>(sql`
    SELECT n.nspname AS schema_name, r.relname AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(local_key, remote_key)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.local_key
    WHERE c.contype = 'f' AND c.confrelid = 'public.prodotti'::regclass
      AND k.remote_key = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.prodotti'::regclass AND attname = 'id')
  `);
  // Fail closed if a deployment has not applied the legacy-link protection migration.
  const protectedTables = new Set(
    references.rows
      .filter(
        (r) => r.schema_name === "public" && r.column_name === "prodotto_id",
      )
      .map((r) => r.table_name),
  );
  if (
    [
      "lotti",
      "movimenti",
      "bolla_righe",
      "approvvigionamento_righe",
      "scarico_righe",
      "trasferimento_righe",
    ].some((table) => !protectedTables.has(table))
  ) {
    throw new Error(
      "Protezione dei prodotti non aggiornata: applicare le migrazioni prima di abilitare l’eliminazione.",
    );
  }
  for (const reference of references.rows) {
    const result = await tx.execute(
      sql`SELECT 1 FROM ${sql.identifier(reference.schema_name)}.${sql.identifier(reference.table_name)} WHERE ${sql.identifier(reference.column_name)} = ${id} LIMIT 1`,
    );
    if (result.rows.length) return true;
  }
  return false;
}
