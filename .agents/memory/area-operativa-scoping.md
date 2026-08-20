---
name: Area Operativa scoping (hard visibility boundary)
description: Second scoping axis "area operativa" — a HARD cross-operational area boundary, additive to the existing per-Centro scoping; how it composes and the write-path gotchas.
---

# Area Operativa scoping — hard visibility boundary

A second scoping axis, **area operativa**, sits above the per-Centro-di-Ascolto axis. It is a HARD boundary: a user bound to a area operativa never sees another area operativa's data. It is ADDITIVE to (composed with, never replacing) the existing centro scoping and the aree RBAC. Helpers live in `api-server/src/lib/centroScope.ts` alongside the centro helpers.

**Visibility rule:** a row is visible if its area operativa == caller's area operativa OR its area operativa IS NULL (shared/legacy). `req.user.areaOperativaId == null` = area operativa-global caller (no area operativa filtering). Exception: **utenti is STRICT** — own area operativa only, NO OR-NULL (a area operativa admin must not see global super-admins). `prodotti` stays fully GLOBAL (shared anagrafica, untouched).

**Four composition patterns** (each mirrors its centro counterpart):
- Direct `areaOperativaId` column → `areaOperativaScopeFilter(col, callerAreaOperativaId)` on lists + `canAccessAreaOperativa(rowArea Operativa, caller)` on detail.
- Via-magazzino → `visibleMagazzinoIds(centro, area operativa)` (now area operativa-aware) + `canAccessMagazzino(id, centro, area operativa)`.
- Via-centro (entities with no areaOperativaId col: fornitori/volontari/mezzi) → `visibleCentroIds(area operativa)` + `idSetScopeFilter` on lists + `inVisibleCentroSet` on detail.
- Via-beneficiario → `beneficiarioAreaOperativaId` + `canUseBeneficiario(id, centro, area operativa)` + `areaOperativaScopeFilter(beneficiari.areaOperativaId)` on lists.
- `report.ts`/`dashboard.ts` use raw SQL: area operativa subqueries on consegne/bolle/interventi via beneficiario, and the visible-magazzini set for lotti/movimenti/trasferimenti.

**Write-path gotcha (the bug class that bit us):** list/detail/patch/delete are easy to get right, but CREATE and DELETE paths silently leak. For a caller that is area operativa-scoped but NOT centro-scoped (`callerCentroId == null`, `callerAreaOperativaId != null`), a body-supplied `centroAscoltoId`/`magazzinoId` of another area operativa must be validated before insert/update — otherwise it's a cross-operational area write IDOR. Checklist whenever adding/editing a write path:
- POST with body centro/magazzino → validate against caller's area operativa (`inVisibleCentroSet(...visibleCentroIds(area operativa))` / `canAccessMagazzino`).
- DELETE → apply the SAME area operativa guard as GET/PATCH (utenti DELETE was the one that initially missed it).
- Nullable FK (e.g. approvvigionamenti.magazzinoId) → magazzino-only validation is NOT enough; also validate body `centroAscoltoId` so a `magazzinoId=null` shared record can't be tied to another area operativa's centro.

**Why:** the architect review caught exactly these (fornitori/volontari POST, utenti DELETE, approvvigionamenti POST/PATCH centroAscoltoId) after the read paths were already correct. Read-path correctness does not imply write-path correctness for a hard boundary.

**Regression safety:** all helpers return `undefined`/`null`/`true` for a area operativa-global caller, so existing global-user behavior is unchanged (scoping tests stub a `req.user` with no `areaOperativaId`, exercising the global path).

**Global-admin `?areaOperativaId` report narrowing:** the global reports accept an optional `?areaOperativaId` so a area operativa-global admin can drill into one area operativa. It is ANDed ON TOP of the existing own-area operativa-or-null scope (never replacing it), so a *scoped* caller passing another area operativa's id can only shrink results to zero — never leak. Mirror UDS reports' `udsScopeConds` pattern: parse the query param, push an extra `col = qArea Operativa` condition alongside `ownOrNullSql`. **Why:** a separate query filter must never bypass the hard boundary; it is purely additive.

## Zona UDS (soft axis) + canale persona + FE

- **Zona UDS** (municipio, `zone_uds` FK `areaOperativaId`) is a SOFT preference UNDER a area operativa — the operator sees their zone first but can filter the whole area operativa. It is NOT a hard cut (unlike area operativa). `utenti.zonaUdsId` nullable = all zones of the area operativa.
- **Canale persona**: ONE person record, no separate UDS table. `centroAscoltoId` set = centro member; explicit `uds` boolean = UDS person (independent of zona); both = visible to both staffs. A `uds=true` person must always have a non-null area operativa (hard-boundary invariant enforced on POST + PATCH).
- `beneficiari` carry `areaOperativaId` + `zonaUdsId` + `soprannome`; `centri_ascolto`/`magazzini` carry `areaOperativaId`.
- `/auth/me` exposes `areaOperativaId/aree-operativeNome/zonaUdsId/zonaUdsNome` so the FE can lock the area operativa select for scoped users.
- **FE Utenti form pattern**: Area Operativa select + DEPENDENT Zona UDS select. Zona query is `useListZoneUds({areaOperativaId})` with the Orval `enabled`+`queryKey` pattern; "Tutte le zone" = null; reset zona to null whenever area operativa changes; zona disabled until a area operativa is chosen; `zonaUdsId` forced null when area operativa is null. Admin CRUD pages `area operativa.tsx` + `zone-uds.tsx` live in area amministrazione.
