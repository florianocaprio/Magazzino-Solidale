---
name: UDS (Unità di Strada) module
description: How the street-outreach module reuses the shared person/intervento records and the città/zona scoping axis.
---

# UDS module

The UDS (street-outreach) module does NOT have its own entities. It reuses the existing `beneficiari` (person) and `interventi` records.

- A "UDS person" is just a `beneficiario` with `zonaUdsId` + `cittaId` set and `centroAscoltoId = null`. A person can be UDS, Centro, or BOTH — one record, no duplication.
- A "UDS intervento" is a normal `intervento` linked to that person; the UDS page maps bisogni → `descrizione` (free note) and materiale given → `note`. No UDS-specific intervento type table.

**Why:** the whole feature brief is "one person record, shared anagrafica, lightweight UDS". Adding parallel tables would split the registry and break the anti-duplicate goal.

**How to apply:**
- The `uds` area exists alongside `sociale`. `AREA_BY_SEGMENT` maps the `beneficiari` and `interventi` segments to BOTH `["sociale","uds"]`, and `areaGuard` grants access if ANY mapped area matches — so a UDS-only operator can reach those shared endpoints without being given `sociale`.
- Channel (canale) of a person is INFERRED, not stored: `zonaUdsId` set ⇒ UDS, `centroAscoltoId` set ⇒ Centro, both ⇒ Entrambi, neither ⇒ unclassified. Don't add an `isUds` flag.

## Città = hard boundary, Zona UDS = soft

`cittaId` is a HARD visibility boundary enforced server-side (an operator never sees another città's people). `zonaUdsId` is a SOFT preference: the operator defaults to their own zona but can widen to the whole città.

**How to apply on the frontend:**
- Default the zona filter from `user.zonaUdsId`; offer "tutta la città" to clear it. The città filter only appears for the global super-admin (`user.cittaId == null`).
- On create, città must be set for the hard boundary to hold. For a global admin creating a person, REQUIRE a città selection (a null-città person would be invisible to every scoped operator and leak across boundaries). Scoped operators get città auto-assigned server-side.
- Guarded pages only mount once `user` is loaded (the route Guard's `hasArea` returns false while `user` is null), so deriving initial filter state from `user` at first render is safe — no effect-sync needed.

## Fuzzy anti-duplicate search

`GET /beneficiari/cerca-simili` (pg_trgm) SUGGESTS possible existing people at insert time; it never merges. It must respect the SAME città hard boundary as everything else (scoped caller → own città OR NULL legacy rows; global caller may narrow with `?cittaId`) — a cross-città match would defeat the privacy boundary.

**Why:** the brief's anti-duplicate goal ("Ammed Solin ≈ Hamed Saolin") only works because there's ONE person record per human; suggesting duplicates across città would both leak data and re-fragment the registry.

**How to apply:**
- The route MUST be registered before `/beneficiari/:id` or Express captures `cerca-simili` as an `:id`.
- Raw SQL uses Drizzle `sql` tagged-template bindings (`${...}`) — never string-concatenate query input. Coerce numeric query params NaN-safely (return null, don't pass NaN into `::int`).
- pg_trgm is enabled idempotently at startup, not via a migration file (the esbuild CJS bundle doesn't pick up extension SQL); see `lib/dbInit.ts`.
- The two insert forms react differently to a hit: UDS attaches the person to the operator's zona (PATCH `zonaUdsId`); the standard centro form just links out to the existing person's detail. Both offer "continue as new".
