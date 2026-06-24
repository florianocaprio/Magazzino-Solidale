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

## Rule: subtract quantity-already-in-bolla at add time (bozza only)
**Why:** Bozza does not decrement stock, so the naive check "lot/giacenza residual >=
requested" lets the SAME product or lot be added repeatedly across multiple righe of one
bolla, cumulatively exceeding availability (only failing later at conferma). Confirmed
bolle already decremented stock, so subtracting again would double-count.
**How to apply:** In `POST /bolle/:id/righe`, for the non-lotto path subtract
`quantitaGiaInBolla(bollaId, prodottoId)`, and for the lotto path subtract
`quantitaGiaInBollaLotto(bollaId, lottoId)` — BOTH guarded by `stato === 'bozza'`. The
client `AddProdottoDialog` must mirror this: it fetches the current bolla
(`useGetBolla`) and computes `maxDisponibile = base − giaInBolla(prodotto|lotto)` only
when bozza, so the suggested max + disabled state match the server. Clamp suggested
"disponibili" with `Math.max(0, …)` so stale/negative values never display.

## Rule: validate lot availability at conferma for manual-lot righe (per-lot AGGREGATE)
**Why:** Two righe can each pass add-time validation yet jointly exceed a single lot's
residual. A per-riga check inside the decrement loop is too late: the first riga already
decremented stock + inserted a movimento before the second riga's check fails, and
conferma has no transaction → partial scarico corruption + bolla stuck in bozza.
**How to apply:** Before the conferma scarico loop, build a `byLotto` map summing
requested qty per lottoId and reject (400) if any lot's residual < its total — mirroring
the existing `byProdotto` aggregate pre-check. Do this BEFORE any decrement.

## Known limitation (not fixed — low concurrency app)
conferma / annulla / confirmed add+remove are NOT wrapped in DB transactions or row
locks. Under concurrent requests, double-storno or partial FEFO fulfillment is
possible. Acceptable for this single-warehouse non-profit; revisit with
`SELECT ... FOR UPDATE` + transactions if concurrency grows.
