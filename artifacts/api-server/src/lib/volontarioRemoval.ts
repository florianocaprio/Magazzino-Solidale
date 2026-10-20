import { todayRome } from "./volontariDomain";
import { auditConfigurazioniTable } from "@workspace/db";
import { eq, sql, type Column } from "drizzle-orm";
import type { InventoryTransaction } from "./scaricoInventory";

/** Call only while holding the volunteer row FOR UPDATE; preserve every dependency. */
export async function hasVolontarioHistory(tx: InventoryTransaction, id: number) {
  const [audit] = await tx.select({ id: auditConfigurazioniTable.id })
    .from(auditConfigurazioniTable).where(eq(auditConfigurazioniTable.chiave, `volontario:${id}`)).limit(1);
  if (audit) return true;
  const references = await tx.execute<{ schema_name: string; table_name: string; column_name: string }>(sql`
    SELECT n.nspname AS schema_name, r.relname AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(local_key, remote_key)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.local_key
    WHERE c.contype = 'f' AND c.confrelid = 'public.volontari'::regclass
      AND k.remote_key = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.volontari'::regclass AND attname = 'id')
  `);
  for (const reference of references.rows) {
    const result = await tx.execute(sql`SELECT 1 FROM ${sql.identifier(reference.schema_name)}.${sql.identifier(reference.table_name)} WHERE ${sql.identifier(reference.column_name)} = ${id} LIMIT 1`);
    if (result.rows.length) return true;
  }
  return false;
}

/** A cessation is a withdrawal from operations, not an approval or rejection. */
export function volontarioNotRemoved(id: number | Column) {
  return sql`not coalesce((select ev.tipo_evento = 'SOSPENSIONE' and ev.motivo = 'dimissioni_cessazione'
    from stati_volontari ev where ev.volontario_id = ${id} and ev.data_effettiva <= ${todayRome()}
    order by ev.data_effettiva desc, ev.id desc limit 1), false)`;
}
