---
name: Carico / stock model
description: How loading stock into a warehouse actually works — what changes giacenze vs what is only an audit log.
---

# Loading stock (carico) into a warehouse

Giacenze (stock) is computed on-the-fly as `sum(lotti.quantitaResidua)` per product+warehouse. There is NO stock table.

**Consequence:** to actually add stock you MUST create a `lotto` (POST /lotti) — `quantitaResidua` is initialized to `quantitaCaricata`. A `movimento` row (POST /movimenti) does NOT change computed stock; it is only an audit-log/dashboard-feed entry.

**Why:** `movimenti` and `lotti` are decoupled in this app — the movimenti carico/scarico form writes a log row but never touches lot quantities. So a carico that only writes a movimento would show in the movements feed but leave giacenze unchanged.

**How to apply (e.g. the "Carica in magazzino" action on the Prodotti page):**
- Create the lotto first (this is the source of truth for stock), then create a carico movimento with `lottoId` for the audit trail/dashboard.
- Sequence them, don't fire in parallel — the movimento needs the returned `lotto.id`.
- Partial-failure rule: if the lotto succeeds but the movimento fails, the stock is ALREADY loaded. Do NOT keep the form open for retry (re-submitting creates a second lotto = double stock). Instead invalidate giacenze/lotti/movimenti, show a warning that only the log failed, and close.
- Invalidate `getListGiacenzeQueryKey()`, `getListLottiQueryKey()`, `getListMovimentiQueryKey()` after a carico.
