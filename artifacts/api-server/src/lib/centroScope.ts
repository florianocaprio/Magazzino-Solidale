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
import { db, magazziniTable, beneficiariTable, centriAscoltoTable } from "@workspace/db";

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
  cittaId: number | null = null,
): Promise<number[] | null> {
  if (centroId == null && cittaId == null) return null;
  const cond = andScoped(
    centroScopeFilter(magazziniTable.centroAscoltoId, centroId),
    cittaScopeFilter(magazziniTable.cittaId, cittaId),
  );
  const rows = await db
    .select({ id: magazziniTable.id })
    .from(magazziniTable)
    .where(cond);
  return rows.map((r) => r.id);
}

/**
 * The set of centro ids visible to a caller scoped to `cittaId`: centri whose
 * città equals the caller's OR is NULL (shared). Returns `null` for a città-global
 * caller (no restriction). Used to scope centro-linked entities (fornitori,
 * volontari, mezzi) by città when they carry no direct cittaId column.
 */
export async function visibleCentroIds(
  cittaId: number | null,
): Promise<number[] | null> {
  if (cittaId == null) return null;
  const rows = await db
    .select({ id: centriAscoltoTable.id })
    .from(centriAscoltoTable)
    .where(
      or(
        eq(centriAscoltoTable.cittaId, cittaId),
        isNull(centriAscoltoTable.cittaId),
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
  cittaId: number | null = null,
): Promise<boolean> {
  if (beneficiarioId == null) return true;
  const [b] = await db
    .select({
      c: beneficiariTable.centroAscoltoId,
      ci: beneficiariTable.cittaId,
    })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  if (!b) return false;
  return canAccessCentro(b.c, centroId) && canAccessCitta(b.ci, cittaId);
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

/* ────────────────────────────────────────────────────────────────────────
 * Per-Città (city) data scoping — HARD visibility boundary.
 *
 * A user bound to a città (`req.user.cittaId != null`) may only see rows of
 * their own città plus città-unassigned (NULL) legacy/shared rows. They never
 * see another città's data. A user with no città (null) is global across
 * cities. This is ADDITIVE to the centro scoping above: an entity scoped by
 * both must satisfy BOTH filters. The optional UDS zona is a SOFT preference
 * (default view), not an enforcement boundary.
 * ──────────────────────────────────────────────────────────────────────── */

/** The caller's città id, or null if the user is global across cities. */
export function callerCittaId(req: Request): number | null {
  return req.user?.cittaId ?? null;
}

/** The caller's preferred UDS zona id, or null = all zones of the città. */
export function callerZonaUdsId(req: Request): number | null {
  return req.user?.zonaUdsId ?? null;
}

/**
 * HARD città boundary: rows whose città column equals the caller's città OR is
 * NULL (unassigned/shared legacy data, so existing rows stay visible until a
 * città is assigned). Returns `undefined` for a global caller (no filtering).
 */
export function cittaScopeFilter(
  column: Column,
  cittaId: number | null,
): SQL | undefined {
  if (cittaId == null) return undefined;
  return or(eq(column, cittaId), isNull(column));
}

/** Whether a stored città value is visible to a caller scoped to `cittaId`. */
export function canAccessCitta(
  rowCittaId: number | null | undefined,
  cittaId: number | null,
): boolean {
  if (cittaId == null) return true;
  return rowCittaId == null || rowCittaId === cittaId;
}

/** The città of a beneficiario, used to scope indirect-link entities. */
export async function beneficiarioCittaId(
  beneficiarioId: number | null | undefined,
): Promise<number | null> {
  if (beneficiarioId == null) return null;
  const [b] = await db
    .select({ c: beneficiariTable.cittaId })
    .from(beneficiariTable)
    .where(eq(beneficiariTable.id, beneficiarioId));
  return b?.c ?? null;
}

/**
 * WHERE condition limiting an entity to rows whose (centro-like) column is in a
 * visible id set OR is NULL (shared). `null` ids → no filtering; empty ids →
 * only shared (NULL) rows. Used to scope centro-linked entities (fornitori,
 * volontari, mezzi) by città via `visibleCentroIds`.
 */
export function idSetScopeFilter(
  column: Column,
  ids: number[] | null,
): SQL | undefined {
  if (ids == null) return undefined;
  if (ids.length === 0) return isNull(column);
  return or(inArray(column, ids), isNull(column));
}

/**
 * Whether a centro-linked row (fornitore, volontario, mezzo) is visible to a
 * caller restricted to a città's centro set (`visibleCentroIds`). A NULL centro
 * is shared/visible. `null` set → città-global caller → always visible.
 */
export function inVisibleCentroSet(
  centroAscoltoId: number | null | undefined,
  cittaCentroIds: number[] | null,
): boolean {
  if (cittaCentroIds == null) return true;
  return centroAscoltoId == null || cittaCentroIds.includes(centroAscoltoId);
}

/**
 * Whether a caller (scoped by centro and/or città) may access a given magazzino.
 * Global on both axes → always true. Otherwise the warehouse must be in the
 * visible set computed from both axes.
 */
export async function canAccessMagazzino(
  magazzinoId: number,
  centroId: number | null,
  cittaId: number | null = null,
): Promise<boolean> {
  if (centroId == null && cittaId == null) return true;
  const ids = await visibleMagazzinoIds(centroId, cittaId);
  return ids == null || ids.includes(magazzinoId);
}

/** Combine conditions, dropping undefined, returning undefined when none. */
export function andScoped(...conds: Array<SQL | undefined>): SQL | undefined {
  const present = conds.filter((c): c is SQL => c !== undefined);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return and(...present);
}
