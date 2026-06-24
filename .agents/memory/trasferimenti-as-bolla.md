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
- Transfer creation does NOT move stock; the avvia/conferma workflow stays stato-only.
- Quantity-cap-at-available is enforced in the form submit (`hasEccesso` via origin giacenze), and POST validates `origine != destinazione` + positive quantities server-side.
