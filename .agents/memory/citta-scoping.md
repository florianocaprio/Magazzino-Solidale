---
name: Città scoping (hard visibility boundary)
description: Second scoping axis "città" — a HARD cross-city boundary, additive to the existing per-Centro scoping; how it composes and the write-path gotchas.
---

# Città scoping — hard visibility boundary

A second scoping axis, **città**, sits above the per-Centro-di-Ascolto axis. It is a HARD boundary: a user bound to a città never sees another città's data. It is ADDITIVE to (composed with, never replacing) the existing centro scoping and the aree RBAC. Helpers live in `api-server/src/lib/centroScope.ts` alongside the centro helpers.

**Visibility rule:** a row is visible if its città == caller's città OR its città IS NULL (shared/legacy). `req.user.cittaId == null` = città-global caller (no città filtering). Exception: **utenti is STRICT** — own città only, NO OR-NULL (a città admin must not see global super-admins). `prodotti` stays fully GLOBAL (shared anagrafica, untouched).

**Four composition patterns** (each mirrors its centro counterpart):
- Direct `cittaId` column → `cittaScopeFilter(col, callerCittaId)` on lists + `canAccessCitta(rowCitta, caller)` on detail.
- Via-magazzino → `visibleMagazzinoIds(centro, citta)` (now città-aware) + `canAccessMagazzino(id, centro, citta)`.
- Via-centro (entities with no cittaId col: fornitori/volontari/mezzi) → `visibleCentroIds(citta)` + `idSetScopeFilter` on lists + `inVisibleCentroSet` on detail.
- Via-beneficiario → `beneficiarioCittaId` + `canUseBeneficiario(id, centro, citta)` + `cittaScopeFilter(beneficiari.cittaId)` on lists.
- `report.ts`/`dashboard.ts` use raw SQL: città subqueries on consegne/bolle/interventi via beneficiario, and the visible-magazzini set for lotti/movimenti/trasferimenti.

**Write-path gotcha (the bug class that bit us):** list/detail/patch/delete are easy to get right, but CREATE and DELETE paths silently leak. For a caller that is città-scoped but NOT centro-scoped (`callerCentroId == null`, `callerCittaId != null`), a body-supplied `centroAscoltoId`/`magazzinoId` of another città must be validated before insert/update — otherwise it's a cross-city write IDOR. Checklist whenever adding/editing a write path:
- POST with body centro/magazzino → validate against caller's città (`inVisibleCentroSet(...visibleCentroIds(citta))` / `canAccessMagazzino`).
- DELETE → apply the SAME città guard as GET/PATCH (utenti DELETE was the one that initially missed it).
- Nullable FK (e.g. approvvigionamenti.magazzinoId) → magazzino-only validation is NOT enough; also validate body `centroAscoltoId` so a `magazzinoId=null` shared record can't be tied to another città's centro.

**Why:** the architect review caught exactly these (fornitori/volontari POST, utenti DELETE, approvvigionamenti POST/PATCH centroAscoltoId) after the read paths were already correct. Read-path correctness does not imply write-path correctness for a hard boundary.

**Regression safety:** all helpers return `undefined`/`null`/`true` for a città-global caller, so existing global-user behavior is unchanged (the 118-test suite uses a stub req.user with no cittaId → all green).
