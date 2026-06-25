---
name: UDS (Unità di Strada) module
description: How the street-outreach module reuses the shared person/intervento records and the città/zona scoping axis.
---

# UDS module

The UDS (street-outreach) module does NOT have its own entities. It reuses the existing `beneficiari` (person) and `interventi` records.

- A "UDS person" is a `beneficiario` with an explicit `uds` boolean flag set (independent of zona/centro). A person can be UDS, Centro, or BOTH — one record, no duplication.
- A "UDS intervento" is a normal `intervento` linked to that person; the UDS page maps bisogni → `descrizione` (free note) and materiale given → `note`. No UDS-specific intervento type table.
- A separate UDS-only follow-up note lives in `interventi.noteUds` (col `note_uds`), distinct from `note` (which the UDS view already uses for Materiale). When adding ANY new field consumed by the UDS interventi list, the `GET /interventi` LIST mapper must explicitly emit it — the list hand-builds its response (does not spread the row), so a field added only to the schema/POST/PATCH/detail will silently be missing from the list and break list-driven UI state.

**Why:** the whole feature brief is "one person record, shared anagrafica, lightweight UDS". Adding parallel tables would split the registry and break the anti-duplicate goal.

**How to apply:**
- The `uds` area exists alongside `sociale`. `AREA_BY_SEGMENT` maps the `beneficiari` and `interventi` segments to BOTH `["sociale","uds"]`, and `areaGuard` grants access if ANY mapped area matches — so a UDS-only operator can reach those shared endpoints without being given `sociale`.
- Channel (canale) is driven by the EXPLICIT `uds` boolean (UDS) + `centroAscoltoId` (Centro): uds ⇒ UDS, centro ⇒ Centro, both ⇒ Entrambi, neither ⇒ unclassified. **Why:** zona-inferred channel could not represent a UDS person who hadn't been assigned a zona yet, so a dedicated flag was added. The UDS list filters on `uds=true`; the standard create form has an "anche UDS" toggle and the detail page toggles `uds` via PATCH.
- The `uds` flag is normalized server-side (`toBool`) before the boundary guard AND before persistence in both POST and PATCH, so a loosely-typed body (`uds:"true"`, `uds:1`) can't bypass the città check via type confusion.

## Città = hard boundary, Zona UDS = soft

`cittaId` is a HARD visibility boundary enforced server-side (an operator never sees another città's people). `zonaUdsId` is a SOFT preference: the operator defaults to their own zona but can widen to the whole città.

**How to apply on the frontend:**
- Default the zona filter from `user.zonaUdsId`; offer "tutta la città" to clear it. The città filter only appears for the global super-admin (`user.cittaId == null`).
- A UDS person must NEVER have a null città (it would be visible across every città). Enforced for `uds=true` on BOTH POST and PATCH, for any path that can set the flag (UDS form, standard "anche UDS" toggle, detail toggle): scoped callers auto-pin their own città (incl. legacy null-città rows on PATCH); città-global callers must supply a città explicitly or get 400. Mirror this invariant on any future mutating path that can set `uds`.
- Guarded pages only mount once `user` is loaded (the route Guard's `hasArea` returns false while `user` is null), so deriving initial filter state from `user` at first render is safe — no effect-sync needed.
- **Cross-linking a UDS page to a shared person screen needs a multi-area FE guard.** The backend lets a `uds`-only operator reach beneficiari/interventi (via `AREA_BY_SEGMENT`), but the wouter route Guard checks ONE area. Any Link from a UDS page to a `sociale`-guarded route (e.g. `/beneficiari/:id` detail) silently 403s for uds-only users unless the Guard accepts BOTH areas. **Why:** nav-hiding/guards are area-keyed and easy to forget when the destination lives under another area. **How to apply:** give the Guard a `string | string[]` area (grant if ANY matches) and pass `["sociale","uds"]` to shared-person routes.

## Fuzzy anti-duplicate search

`GET /beneficiari/cerca-simili` (pg_trgm) SUGGESTS possible existing people at insert time; it never merges. It must respect the SAME città hard boundary as everything else (scoped caller → own città OR NULL legacy rows; global caller may narrow with `?cittaId`) — a cross-città match would defeat the privacy boundary.

**Why:** the brief's anti-duplicate goal ("Ammed Solin ≈ Hamed Saolin") only works because there's ONE person record per human; suggesting duplicates across città would both leak data and re-fragment the registry.

**How to apply:**
- The route MUST be registered before `/beneficiari/:id` or Express captures `cerca-simili` as an `:id`.
- Raw SQL uses Drizzle `sql` tagged-template bindings (`${...}`) — never string-concatenate query input. Coerce numeric query params NaN-safely (return null, don't pass NaN into `::int`).
- pg_trgm is enabled idempotently at startup, not via a migration file (the esbuild CJS bundle doesn't pick up extension SQL); see `lib/dbInit.ts`.
- The two insert forms react differently to a hit: UDS attaches the person to the operator's zona (PATCH `zonaUdsId`); the standard centro form just links out to the existing person's detail. Both offer "continue as new".
