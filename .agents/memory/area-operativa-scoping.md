---
name: Area Operativa scoping (hard visibility boundary)
description: Second scoping axis "Area Operativa" — a HARD cross-operational boundary, additive to the existing per-Centro scoping; how it composes and the write-path gotchas.
---

# Area Operativa scoping — hard visibility boundary

A second scoping axis, **Area Operativa**, sits above the per-Centro-di-Ascolto axis. It is a HARD boundary: a user bound to one Area Operativa never sees another Area Operativa's data. It is ADDITIVE to (composed with, never replacing) the existing centro scoping and the aree RBAC. Helpers live in `artifacts/api-server/src/lib/centroScope.ts` alongside the centro helpers.

**Visibility rule:** a row is visible if its `areaOperativaId` equals the caller's `areaOperativaId` OR the stored value is NULL (shared/legacy). `req.user.areaOperativaId == null` means a global caller with no Area Operativa filter. Exception: **utenti is STRICT** — exact own Area Operativa only, NO OR-NULL (an Area Operativa admin must not see global super-admins). `prodotti` stays fully GLOBAL (shared anagrafica, untouched).

**Four composition patterns** (each mirrors its centro counterpart):
- Direct `areaOperativaId` column → `areaOperativaScopeFilter(column, callerAreaOperativaId(req))` on lists + `canAccessAreaOperativa(rowAreaOperativaId, callerAreaOperativaId(req))` on detail.
- Via-magazzino → `visibleMagazzinoIds(callerCentroId(req), callerAreaOperativaId(req))` + `canAccessMagazzino(id, callerCentroId(req), callerAreaOperativaId(req))`.
- Via-centro (entities with no direct `areaOperativaId`, such as fornitori/volontari/mezzi) → `visibleCentroIds(callerAreaOperativaId(req))` + `idSetScopeFilter` on lists + `inVisibleCentroSet` on detail.
- Via-beneficiario → `beneficiarioAreaOperativaId(beneficiarioId)` + `canUseBeneficiario(id, callerCentroId(req), callerAreaOperativaId(req), callerZonaUdsId(req))` + `areaOperativaScopeFilter(beneficiariTable.areaOperativaId, callerAreaOperativaId(req))` on lists.
- `report.ts`/`dashboard.ts` use raw SQL: Area Operativa subqueries on consegne/bolle/interventi via beneficiario, and the visible-magazzini set for lotti/movimenti/trasferimenti. Physical DB references use `aree_operative` and `area_operativa_id`.

**Write-path gotcha (the bug class that bit us):** list/detail/patch/delete are easy to get right, but CREATE and DELETE paths silently leak. For a caller that is Area Operativa-scoped but NOT centro-scoped (`callerCentroId == null`, `callerAreaOperativaId != null`), a body-supplied `centroAscoltoId`/`magazzinoId` of another Area Operativa must be validated before insert/update — otherwise it's a cross-boundary write IDOR. Checklist whenever adding/editing a write path:
- POST with body centro/magazzino → validate against `callerAreaOperativaId` with `inVisibleCentroSet(...visibleCentroIds(callerAreaOperativaId))` or `canAccessMagazzino(id, callerCentroId, callerAreaOperativaId)`.
- DELETE → apply the SAME Area Operativa guard as GET/PATCH (utenti DELETE was the one that initially missed it).
- Nullable FK (e.g. `approvvigionamenti.magazzinoId`) → magazzino-only validation is NOT enough; also validate body `centroAscoltoId` so a `magazzinoId=null` shared record can't be tied to another Area Operativa's centro.

**Why:** the architect review caught exactly these (fornitori/volontari POST, utenti DELETE, approvvigionamenti POST/PATCH centroAscoltoId) after the read paths were already correct. Read-path correctness does not imply write-path correctness for a hard boundary.

**Regression safety:** all helpers return `undefined`/`null`/`true` for a global caller, so existing global-user behavior is unchanged (scoping tests stub a `req.user` with no `areaOperativaId`, exercising the global path).

**Global-admin `?areaOperativaId` report narrowing:** global reports accept an optional `?areaOperativaId` so a global admin can drill into one Area Operativa. It is ANDed ON TOP of the existing own-Area-Operativa-or-null scope (never replacing it), so a scoped caller passing another Area Operativa's id can only shrink results to zero — never leak. Mirror the UDS reports' `udsScopeConds` pattern: parse the query parameter into `qAreaOperativa`, then add a `column = qAreaOperativa` condition alongside `ownOrNullSql`. **Why:** a separate query filter must never bypass the hard boundary; it is purely additive.

## Zona UDS (soft axis) + canale persona + FE

- **Zona UDS** (municipio, `zone_uds.area_operativa_id` in the DB and `areaOperativaId` in TypeScript) is a SOFT preference UNDER an Area Operativa — the operator sees their zone first but can filter the whole Area Operativa. It is NOT a hard cut. `utenti.zonaUdsId` nullable means all zones of the Area Operativa.
- **Canale persona**: ONE person record, no separate UDS table. `centroAscoltoId` set = centro member; explicit `uds` boolean = UDS person (independent of zona); both = visible to both staffs. A `uds=true` person must always have a non-null `areaOperativaId` (hard-boundary invariant enforced on POST + PATCH).
- `beneficiariTable` carries `areaOperativaId` + `zonaUdsId` + `soprannome`; `centriAscoltoTable` and `magazziniTable` carry `areaOperativaId`. In PostgreSQL the physical references are `beneficiari.area_operativa_id`, `centri_di_ascolto.area_operativa_id` and `magazzini.area_operativa_id`.
- `/auth/me` exposes `areaOperativaId`, `areaOperativaNome`, `zonaUdsId` and `zonaUdsNome` so the FE can lock the Area Operativa select for scoped users.
- **FE Utenti form pattern**: Area Operativa select + DEPENDENT Zona UDS select. Zona query is `useListZoneUds({ areaOperativaId })` with the Orval `enabled`+`queryKey` pattern; "Tutte le zone" = null; reset zona to null whenever `areaOperativaId` changes; zona disabled until an Area Operativa is chosen; `zonaUdsId` forced null when `areaOperativaId` is null. Admin CRUD pages `aree-operative.tsx` + `zone-uds.tsx` live in area amministrazione; the public CRUD route is `/aree-operative` and the Drizzle table is `areeOperativeTable` (`aree_operative` in PostgreSQL).
