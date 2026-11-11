import { beneficiariTable, db, tessereBeneficiariTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function hasReferences(
  tx: Transaction,
  table: "beneficiari" | "tessere_beneficiari",
  id: number,
) {
  // Include CASCADE and SET NULL links, which would otherwise change history.
  const refs = await tx.execute<{
    schema_name: string;
    table_name: string;
    column_name: string;
  }>(sql`
    SELECT DISTINCT n.nspname AS schema_name, r.relname AS table_name,
                    a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_class r ON r.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = r.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey, c.confkey) AS k(local_key, remote_key)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.local_key
    JOIN pg_attribute target ON target.attrelid = c.confrelid AND target.attnum = k.remote_key
    WHERE c.contype = 'f'
      AND c.confrelid = ${`public.${table}`}::regclass
      AND target.attname = 'id'
      AND NOT (${table} = 'beneficiari' AND n.nspname = 'public'
        AND r.relname = 'tessere_beneficiari' AND a.attname = 'beneficiario_id')
  `);
  for (const ref of refs.rows) {
    const result = await tx.execute(sql`
      SELECT 1 FROM ${sql.identifier(ref.schema_name)}.${sql.identifier(ref.table_name)}
      WHERE ${sql.identifier(ref.column_name)} = ${id} LIMIT 1
    `);
    if (result.rows.length) return true;
  }
  return false;
}

/** The caller holds a FOR UPDATE lock on the beneficiary until commit. */
export async function deleteUnusedBeneficiario(tx: Transaction, id: number) {
  if (await hasReferences(tx, "beneficiari", id)) return false;
  const cards = await tx
    .select({
      id: tessereBeneficiariTable.id,
      initial: sql<boolean>`
      ${tessereBeneficiariTable.stato} = 'attiva'
      AND ${tessereBeneficiariTable.dataScadenza} IS NULL
      AND ${tessereBeneficiariTable.dataRevoca} IS NULL
      AND ${tessereBeneficiariTable.createdAt} = ${tessereBeneficiariTable.updatedAt}
      AND ${tessereBeneficiariTable.createdAt} = (
        SELECT ${beneficiariTable.dataCreazione} AT TIME ZONE current_setting('TimeZone')
        FROM ${beneficiariTable} WHERE ${beneficiariTable.id} = ${id}
      )
    `,
    })
    .from(tessereBeneficiariTable)
    .where(eq(tessereBeneficiariTable.beneficiarioId, id))
    .limit(2)
    .for("update");
  if (cards.length > 1) return false;
  const [card] = cards;
  if (card) {
    if (
      !card.initial ||
      (await hasReferences(tx, "tessere_beneficiari", card.id))
    )
      return false;
    await tx
      .delete(tessereBeneficiariTable)
      .where(eq(tessereBeneficiariTable.id, card.id));
  }
  await tx.delete(beneficiariTable).where(eq(beneficiariTable.id, id));
  return true;
}
