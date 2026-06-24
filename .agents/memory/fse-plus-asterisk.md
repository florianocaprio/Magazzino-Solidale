---
name: FSE+ asterisk on bill documents
description: How FSE+ products are marked with an asterisk across all bill-like documents (bolle, trasferimenti, scarichi).
---

# FSE+ asterisk marking on documents

Requirement: in ANY bill-like document, FSE+ products must be flagged with an
asterisk. "Qualsiasi bolla" was interpreted to include all three doc types shown in
the Bolle area: delivery bolle, trasferimenti (internal transfers), scarichi
(discharges).

## How fsePlus is derived per riga
- Each riga's `fsePlus` is computed server-side and added to the API contract
  (`BollaRiga`, `TrasferimentoRiga`, `ScaricoRiga` all carry a required `fsePlus`).
- **Rule:** if the riga references a specific lotto (`lottoId` set), the LOT's
  `lotti.fse_plus` is authoritative; otherwise fall back to the product default
  `prodotti.fse_plus`. Scarico righe have NO lottoId, so they always use the product
  flag.
**Why:** provenance (FSE+ vs fornitore) lives on the lotto, not the product; the
product flag is only a default/pre-selection. A specific chosen lot can differ from
the product default, so the lot wins when known.

## Where it renders
- PDFs (bolla/trasferimento/scarico): append " *" to the product name in the table
  and print a footnote "* Prodotto FSE+ (Fondo Sociale Europeo Plus)" when any riga
  is FSE+. PDF text stays Italian-only (project convention — PDFs are not i18n'd).
- On-screen: only the delivery-bolla detail has a product-name table → shows a "*"
  marker + a translated legend (`bolle.fsePlusLegend`, 6 langs). Trasferimenti/scarichi
  on-screen views show only article COUNTS (no product-name table), so nothing to mark
  there.

## Gotcha: both detail AND list route paths
Each of bolle/trasferimenti/scarichi builds righe in TWO places — the single-entity
detail builder and the batched list builder. Add the fsePlus join/derivation to BOTH
or the list payload silently omits it.
