---
name: Operatore stamping on bolle/trasferimenti/scarichi
description: How the logged-in operator is recorded and surfaced on delivery documents
---

# Operatore stamping

bolle, trasferimenti, scarichi AND interventi each carry a nullable `operatoreId` FK → `utenti`.
It records the operator who **last touched** the document (not just the creator).

**Rule:** stamp `operatoreId: req.user!.id` on create AND on every mutating endpoint —
bolle POST/PATCH/righe-add/righe-delete/conferma/consegna/annulla;
trasferimenti POST/PATCH/avvia/conferma; scarichi POST; interventi POST/PATCH.
Miss one and the operator silently goes stale.

**Auto-synced interventi:** an intervento can be created/updated by `syncInterventoBolla`
(bolla → intervento sync), not just by the interventi routes. That sync reloads the bolla
fresh AFTER the bolla's operator was stamped, so set the intervento's `operatoreId` to
`bolla.operatoreId` there — no extra param needed.

**Display code is non-personal:** API returns `operatoreCodice = matricola ?? username`
(never the full name). `utenti.matricola` is optional; falls back to username.
**Why:** the printed bill must identify the operator with a code, not expose PII.

**How it's surfaced:**
- Single-row/dettaglio queries: `leftJoin(utentiTable, eq(table.operatoreId, utentiTable.id))`
  selecting matricola+username, compute codice in JS.
- List queries that use plain `.select()` (trasferimenti, scarichi): don't restructure the
  select — batch-fetch a `utenti` id→codice Map via `inArray` and look it up per row
  (mirrors the existing magMap pattern).
- All three PDFs print "Operatore: <operatoreCodice>" only when present.

`req.user` is available because requireAuth runs globally before the routers.
