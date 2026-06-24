---
name: Lotto provenienza (FSE+ vs fornitore)
description: Every lot's provenance is mutually-exclusive FSE+ OR fornitore; lots are created in two separate forms that must stay in sync.
---

# Lotto provenance

A lot's provenance is EITHER FSE+ (`lotti.fse_plus=true`, `fornitoreId` null) OR a supplier (`fornitoreId` set, `fse_plus=false`). The two states are mutually exclusive and enforced server-side in `POST /lotti` (returns 400 if both or neither).

**Why:** plain OpenAPI/Zod can't express "exactly one of two fields", so the invariant lives in the route handler — any new lot-write path must re-apply it.

**How to apply:** lots are created in TWO frontend places — the Lotti page "Nuovo Lotto" dialog AND the prodotti page "Carica in magazzino" CaricoForm. Both must send `fsePlus`/`fornitoreId` and have the provenance selector. When touching lot creation, update BOTH or one path will silently create lots with no/invalid provenance. The selected product's own `fsePlus` flag / default `fornitoreId` pre-selects the provenance in both forms.
