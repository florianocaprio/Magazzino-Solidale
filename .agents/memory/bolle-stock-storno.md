---
name: Bolle stock accounting & storno
description: How delivery-document (bolle) stock deduction and reversal must be keyed and validated to avoid over/under-reverting lot quantities.
---

# Bolle stock accounting & storno (reversal)

Stock for a bolla is deducted from `lotti.quantita_residua` (FEFO when no lot chosen,
or directly when a specific lot is picked). Reversal happens on `annulla` and on
removing/editing a riga of a confirmed bolla.

## Rule: movements must be keyed by `bollaRigaId`, not just `bollaId` + `prodottoId`
**Why:** Two righe on the same bolla can carry the same product. If storno matches
movements by `bollaId + prodottoId`, removing one riga reverts the stock for ALL
righe of that product (over-reverting). The `movimenti.bollaRigaId` column ties each
scarico movement to its originating riga so storno targets exactly that riga.
**How to apply:** Every scarico insert (FEFO helper, manual-lot path in conferma, and
the immediate-deduct path when adding a riga to a confirmed bolla) MUST set
`bollaRigaId: riga.id`. `stornoRiga` filters movimenti by `bollaRigaId`. On `annulla`,
iterate ALL righe and call `stornoRiga` once per riga — do NOT dedupe by `prodottoId`.

## Rule: validate lot availability at conferma for manual-lot righe
**Why:** Bozza does not reserve stock, so two righe can each pass add-time validation
yet jointly exceed a single lot's residual, driving `quantita_residua` negative at
conferma. The product-level aggregate check does not catch same-lot overdraw across
multiple lots of the same product.
**How to apply:** In the conferma manual-lot branch, check `disp >= scala` before
decrementing and return 400 if insufficient.

## Known limitation (not fixed — low concurrency app)
conferma / annulla / confirmed add+remove are NOT wrapped in DB transactions or row
locks. Under concurrent requests, double-storno or partial FEFO fulfillment is
possible. Acceptable for this single-warehouse non-profit; revisit with
`SELECT ... FOR UPDATE` + transactions if concurrency grows.
