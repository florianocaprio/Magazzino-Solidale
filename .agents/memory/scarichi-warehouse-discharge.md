---
name: Scarichi (warehouse discharge)
description: How warehouse discharge ("scarico magazzino") works — its own bolla, FEFO, transactional, server-derived units.
---

# Scarico magazzino (warehouse discharge)

A scarico is a single record that IS its own "bolla di scarico" (mirrors the Trasferimenti
pattern — no separate bolla row). It unloads goods from one warehouse with a document-level
`causale` (deteriorata/rubata/scaduta/altro free-text in `causaleAltro`).

## Rules / decisions
- Stock decrement is FEFO over `lotti` ordered by `(dataScadenza, dataCarico)`; each lot delta
  is logged as a `movimenti` row with `tipoMovimento="scarico"` and `tipoDettaglio=causale`.
- **The create handler is wrapped in `db.transaction`** (insert scarico + righe + FEFO lot
  updates + movimenti). This is the one place that deviates from the repo's usual "no
  transactions" convention — discharge mutates stock across multiple lots/tables, so a partial
  failure would silently corrupt giacenze. Keep it transactional.
  **Why:** architect flagged the multi-table write as a data-integrity risk; atomicity is the fix.
- **`unitaMisura` is derived server-side from `prodotti.unitaMisura`**, NOT trusted from the
  client payload, so the audit record's unit always matches the product's canonical unit.
- Availability is validated per-product (summed across rows) against `giacenzaDisponibile`
  before the transaction.
- Shown in the Bolle list as read-only rows tagged "Scarico Magazzino" (red accent,
  PackageMinus icon) with a client-side PDF download. PDF helper exports `causaleLabel`/`CAUSALE_LABELS`.
- codice format: `SCAR-YYYY-NNNN`.
