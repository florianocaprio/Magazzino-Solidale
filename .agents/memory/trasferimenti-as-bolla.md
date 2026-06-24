---
name: Trasferimenti as transfer-bolla
description: Why warehouse transfers reuse the trasferimenti record as their "bolla" and how the PDF/Bolle integration works.
---

# Trasferimenti = the transfer bolla

A warehouse transfer ("bolla di trasferimento") IS the `trasferimenti` record — there is no separate bolla row for transfers.

**Why:** `bolle.beneficiarioId` is NOT NULL, so consegna bolle require a beneficiary; transfers have none. Forcing transfers into the `bolle` table would break that constraint. The `Trasferimento` schema already carries both warehouse names + righe, so no DB/OpenAPI/codegen change is needed.

**How to apply:**
- The transfer PDF is generated **client-side** from the trasferimento data (`artifacts/magazzino-solidale/src/lib/trasferimento-pdf.ts`, reusing `loadAssociationLogo` + footer from `bolla-pdf.ts`).
- In the Bolle screen, transfers are **merged in as read-only rows** tagged "Trasferimento Interno" (not real bolle) — they show origine→destinazione and a PDF download button; they do NOT open the consegna bolla detail sheet.
- The LIST `/trasferimenti` endpoint must populate `magazzinoDestinoNome` and full `righe` (with `prodottoNome`, via batched `inArray`) — the table count, Bolle merge, and PDF all depend on it.
- Transfer **creation** does NOT move stock. The 2-phase avvia/conferma workflow DOES move stock: **avvia** FEFO-deducts the righe quantities from origin lots (validating availability per product first, 400 otherwise) and logs `movimenti(tipoMovimento="trasferimento", tipoDettaglio="uscita")` per origin lot touched (each carrying the origin `lottoId`); **conferma** rebuilds destination lots from those uscita movimenti (re-reading the origin lotto to copy scadenza/codiceLotto/fornitore/fsePlus so FEFO/provenance survive the move) and logs `tipoDettaglio="entrata"` movimenti. Both phases are wrapped in `db.transaction`. Stato guards: avvia only from richiesto/preparato, conferma only from in_transito.
- Editing righe (PATCH) is blocked once avvia has run (stato must be richiesto/preparato) — this is what keeps giacenze in sync with deducted stock.
- Quantity-cap-at-available is enforced in the form submit (`hasEccesso` via origin giacenze), and POST validates `origine != destinazione` + positive quantities server-side.
- Origine/destino **addresses** (indirizzo/comune/zona) are NOT stored on `trasferimenti` — they are derived by joining `magazzini` at GET time (both list and single). Do not add address columns to the transfer.
- **Trasportatore** is mutually-exclusive: either `trasportatoreVolontarioId` (FK to a volontario) OR `trasportatoreNome` (free text for the "Altro" option). Server nulls the free name when a volontario id is set. GET returns a convenience `trasportatoreVolontarioNome` (joined). PDF shows volontario name → free name → "—" fallback so legacy transfers without a transporter never crash.
