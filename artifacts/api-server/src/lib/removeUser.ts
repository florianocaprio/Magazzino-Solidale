import { eq, sql } from "drizzle-orm";
import { db, utentiTable, userSessionsTable } from "@workspace/db";
import { revokeUserAccess } from "./userAccess";

/** Never remove a reference, including audit links or ON DELETE SET NULL FKs. */
export async function removeUser(
  userId: number,
  removeIfUnused: boolean,
  expected: typeof utentiTable.$inferSelect,
): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(utentiTable)
      .where(eq(utentiTable.id, userId))
      .for("update");
    if (!user) return null;
    for (const key of [
      "ruoloId",
      "isSuperAdmin",
      "attivo",
      "areaOperativaId",
      "centroAscoltoId",
      "zonaUdsId",
    ] as const) {
      if (user[key] !== expected[key]) return null;
    }
    let preserve = !removeIfUnused || user.ultimoAccesso != null;
    if (!preserve) {
      const [session] = await tx
        .select({ sid: userSessionsTable.sid })
        .from(userSessionsTable)
        .where(sql`${userSessionsTable.sess}->>'userId' = ${String(userId)}`)
        .limit(1);
      preserve = Boolean(session);
    }
    if (!preserve) {
      // Discover every actual FK, including SET NULL and CASCADE, instead of
      // relying on a list which would miss dependencies added by later modules.
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
        WHERE c.contype = 'f' AND c.confrelid = 'public.utenti'::regclass
          AND k.remote_key = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.utenti'::regclass AND attname = 'id')
        ORDER BY CASE WHEN r.relname = 'system_logs' THEN 0 ELSE 1 END
      `);
      for (const ref of references.rows) {
        const found = await tx.execute(
          sql`SELECT 1 FROM ${sql.identifier(ref.schema_name)}.${sql.identifier(ref.table_name)} WHERE ${sql.identifier(ref.column_name)} = ${userId} LIMIT 1`,
        );
        if (found.rows.length) {
          preserve = true;
          break;
        }
      }
    }
    if (preserve) {
      await tx
        .update(utentiTable)
        .set({ attivo: false })
        .where(eq(utentiTable.id, userId));
      await revokeUserAccess(userId, tx);
      return false;
    }
    // The row lock also blocks concurrent FK inserts and login's access stamp.
    await tx.delete(utentiTable).where(eq(utentiTable.id, userId));
    return true;
  });
}
