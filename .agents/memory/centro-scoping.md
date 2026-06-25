---
name: Centro di Ascolto data scoping
description: How per-centro data/user scoping is enforced server-side, additive to aree RBAC; the non-obvious exceptions (utenti strict, write-side re-validation, report/dashboard).
---

# Centro di Ascolto scoping

A caller with `req.user.centroAscoltoId != null` is "scoped": they may only see/operate on
records whose centro == their centro OR IS NULL (null = comune/shared). A null-centro caller
is global (sees everything, still gated by the existing aree RBAC). Helpers live in
`api-server/src/lib/centroScope.ts` (`callerCentroId`, `centroScopeFilter`,
`visibleMagazzinoIds`, `magazzinoScopeFilter`, `trasferimentoScopeFilter`,
`beneficiarioCentroId`, `canAccessCentro`, `andScoped`).

**Why:** centro scoping is an ADDITIONAL filter on top of aree RBAC, enforced server-side
(FE filter locking is UX only). The area-guard precedent is the model.

**How to apply / gotchas (the non-obvious parts):**
- **Write-side IDOR:** detail/PATCH/DELETE must re-validate the *post-update* FK, not just the
  existing row. When a PATCH body can change `beneficiarioId` (consegne, interventi, bolle) or
  `magazzinoId` (lotti, bolle), re-check the NEW value's centro/visibility before writing, else a
  scoped caller reassigns a record to out-of-centro data. Create paths auto-assign+lock the
  caller's centro and must validate any body-supplied `magazzinoId`/`beneficiarioId`.
- **utenti is intentionally STRICT** (`eq(centroAscoltoId, caller)`, NOT `OR IS NULL`): a centro
  admin must NOT see/manage global (null-centro) super-admins. This deliberately diverges from
  the general "OR NULL" rule — the spec requires users see only their own centre's users.
- **Existence-aware FK guards on writes:** treating a missing FK as "null/shared" is a hole — a
  bogus `beneficiarioId`/`magazzinoId` would pass a centro check. Use `canUseBeneficiario` /
  `canUseMagazzino` (reject when the row doesn't exist) on create + FK-change PATCH paths, NOT a
  bare `canAccessCentro(beneficiarioCentroId(...))` which returns null for both missing and shared.
- **report.ts & dashboard.ts ARE in scope** (the Analisi/report area must be scoped too). They use raw
  `db.execute(sql\`...\`)`, so scoping is injected as SQL fragments: magazzini via
  `mg.centro_ascolto_id = caller OR IS NULL`; consegne/interventi/bolle via a
  `beneficiario_id IN (SELECT id FROM beneficiari WHERE centro_ascolto_id = caller OR IS NULL)`
  subquery; lotti/movimenti/trasferimenti via the visible-magazzini set. prodotti stays GLOBAL.
- **mezzi effective centro** = `volontario.centroAscoltoId` when `volontarioId` set, else mezzo's
  own `centroAscoltoId`; null on either path = visible to all centri.
- 403 convention: `{ error: "... non accessibile per il tuo centro" }`.
