---
name: Turno carico & mezzo allocation (B6)
description: How per-day volunteer delivery limits are counted/scoped and why mezzo/volontario assignment FKs are FE-only scoped.
---

## Turno = calendar day; carico counting
- A "turno" for the per-volontario delivery limit (`volontari.maxConsegneTurno`, `<=0`/null = no limit) is a full calendar day (the consegna/bolla date).
- Carico for a volontario on a date = consegne with that `dataPrevista` (by `volontarioId`) + bolle with that `dataBolla` (by `volontarioConsegnaId`) that are `consegnaId IS NULL` and `stato != 'annullato'`.
- **Bolle linked to a consegna are intentionally NOT counted** — the consegna they belong to already counts. The server guard mirrors this: it skips the over-limit check on a bolla when `consegnaId` is set. This is anti-double-count by design, NOT a bug.

## `/volontari/carico` — global counts, scoped rows
- Counts are computed GLOBALLY (no centro/città filter) because a volontario's daily limit spans all centri (a universal volontario delivers anywhere); scoping the count would undercount and let the limit be exceeded.
- **Why:** correctness of the limit requires the true daily total.
- The RETURNED rows are then filtered to the caller's visible volontari (centro + città HARD boundary), so cross-perimeter volontario activity is not exposed. **How to apply:** keep the count global, filter the output map by the caller's visible volontario id set.

## Assignment FKs are FE-only scoped
- `volontarioId`/`volontarioConsegnaId` and `mezzoId` are *assignment* FKs: their centro/città filtering is done FE-side only (picker shows in-scope options), with no server-side IDOR guard.
- Contrast: *ownership* FKs (`beneficiarioId`, `magazzinoId`) DO get server-side scope guards on POST/PATCH.
- **Why:** consistent with the pre-existing volontario treatment; don't make mezzo stricter than its sibling volontario.
