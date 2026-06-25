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
