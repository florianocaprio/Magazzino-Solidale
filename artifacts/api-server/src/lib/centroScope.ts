import type { Request } from "express";
import {
  and,
  eq,
  inArray,
  isNull,
  or,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import { db, magazziniTable, beneficiariTable } from "@workspace/db";

/**
 * Per-Centro-di-Ascolto data scoping.
 *
 * A user bound to a centro (`req.user.centroAscoltoId != null`) may only see and
 * operate on records tied to their centro, plus "comune"/shared records whose
 * centro is NULL. A user with no centro (null) is global and sees everything
 * (still gated by the existing aree RBAC). This is the server-side enforcement
 * boundary — frontend filtering is UX only.
 */

/** The caller's centro id, or null if the user is global (sees everything). */
export function callerCentroId(req: Request): number | null {
  return req.user?.centroAscoltoId ?? null;
}

/**
 * WHERE condition limiting a direct-link entity to rows whose centro column
 * equals the caller's centro OR is NULL (shared/comune). Returns `undefined`
 * for a global caller (no filtering).
 */
export function centroScopeFilter(
  column: Column,
  centroId: number | null,
): SQL | undefined {
  if (centroId == null) return undefined;
  return or(eq(column, centroId), isNull(column));
}

/**
 * Whether a stored centro value is visible to a caller scoped to `centroId`.
 * Global callers (centroId == null) can access everything; scoped callers can
 * access their own centro and shared (null) records.
 */
export function canAccessCentro(
  rowCentroId: number | null | undefined,
  centroId: number | null,
): boolean {
  if (centroId == null) return true;
  return rowCentroId == null || rowCentroId === centroId;
}

/**
 * The set of magazzino ids visible to a caller scoped to `centroId`: warehouses
 * whose centro equals the caller's OR is NULL (comune). Returns `null` for a
 * global caller (meaning: no restriction).
 */
export async function visibleMagazzinoIds(
  centroId: number | null,
): Promise<number[] | null> {
  if (centroId == null) return null;
  const rows = await db
    .select({ id: magazziniTable.id })
    .from(magazziniTable)
    .where(
      or(
        eq(magazziniTable.centroAscoltoId, centroId),
        isNull(magazziniTable.centroAscoltoId),
      ),
    );
  return rows.map((r) => r.id);
}

/**
 * WHERE condition limiting a magazzino-derived entity to a set of visible
 * warehouse ids. `null` ids → no filtering (global caller); empty ids → match
 * nothing.
 */
export function magazzinoScopeFilter(
  column: Column,
  ids: number[] | null,
): SQL | undefined {
  if (ids == null) return undefined;
  if (ids.length === 0) return sql`false`;
  return inArray(column, ids);
}

/**
 * WHERE condition for transfers: visible when EITHER the origin OR the
 * destination warehouse is in the visible set.
 */
export function trasferimentoScopeFilter(
  originColumn: Column,
  destColumn: Column,
  ids: number[] | null,
): SQL | undefined {
  if (ids == null) return undefined;
  if (ids.length === 0) return sql`false`;
  return or(inArray(originColumn, ids), inArray(destColumn, ids));
}

/**
 * The centro of a beneficiario, used to scope indirect-link entities (consegne,
 * bolle, interventi) that reach their centro via the beneficiario. Returns null
 * when the beneficiario has no centro or does not exist.
 */
export async function beneficiarioCentroId(
  beneficiarioId: number | null | undefined,
): Promise<number | null> {
  if (beneficiarioId == null) return null;
  const [b] = await db
    .select({ c: beneficiariTable.centroAscoltoId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  return b?.c ?? null;
}

/**
 * Whether a scoped caller may attach an indirect-link record (consegna, bolla,
 * intervento) to `beneficiarioId`. A missing beneficiario is NOT treated as
 * shared/null — it is rejected for scoped callers so a bogus id can't bypass
 * isolation. Global callers (centroId == null) can use any existing beneficiario.
 */
export async function canUseBeneficiario(
  beneficiarioId: number | null | undefined,
  centroId: number | null,
): Promise<boolean> {
  if (beneficiarioId == null) return true;
  const [b] = await db
    .select({ c: beneficiariTable.centroAscoltoId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!b) return false;
  return canAccessCentro(b.c, centroId);
}

/**
 * Whether a scoped caller may attach a record to `magazzinoId`. A missing
 * warehouse is rejected for scoped callers (not treated as shared). Global
 * callers (centroId == null) can use any existing warehouse.
 */
export async function canUseMagazzino(
  magazzinoId: number | null | undefined,
  centroId: number | null,
): Promise<boolean> {
  if (magazzinoId == null) return true;
  if (centroId == null) return true;
  const [m] = await db
    .select({ c: magazziniTable.centroAscoltoId })
    .from(magazziniTable)
    .where(eq(magazziniTable.id, magazzinoId));
  if (!m) return false;
  return canAccessCentro(m.c, centroId);
}

/** Combine conditions, dropping undefined, returning undefined when none. */
export function andScoped(...conds: Array<SQL | undefined>): SQL | undefined {
  const present = conds.filter((c): c is SQL => c !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return and(...present);
}
