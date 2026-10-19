import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, passwordResetTokensTable, userSessionsTable } from "@workspace/db";

export function passwordSessionVersion(hash: string): string {
  return createHash("sha256").update(hash).digest("hex");
}

export async function revokeUserAccess(
  userId: number,
  executor: Pick<typeof db, "delete" | "update"> = db,
  now = new Date(),
): Promise<void> {
  await executor
    .delete(userSessionsTable)
    .where(sql`${userSessionsTable.sess}->>'userId' = ${String(userId)}`);
  await executor
    .update(passwordResetTokensTable)
    .set({ invalidatedAt: now })
    .where(
      and(
        eq(passwordResetTokensTable.utenteId, userId),
        isNull(passwordResetTokensTable.usedAt),
        isNull(passwordResetTokensTable.invalidatedAt),
      ),
    );
}

/** Gli account operano per Area: Centro e Zona legacy non restringono il profilo. */
export function areaOnlyUserScope<T extends { centroAscoltoId: number | null; zonaUdsId: number | null }>(user: T): T {
  return { ...user, centroAscoltoId: null, zonaUdsId: null };
}
