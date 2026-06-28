---
name: Turni (shift planning) assignment endpoint
description: IDOR + atomicity rules for the weekly Pianificazione Turni feature
---

# Turni — assignment endpoint guards

`PUT /turni` is an upsert keyed by `(centroAscoltoId, data, fascia)` that REPLACES the
volunteer set. It joins `volontari` on read (`GET /turni`), so the write path must guard
who can be attached.

**Rule:** validate every assigned `volontarioId` server-side before insert — each must be
universal (`volontari.centroAscoltoId IS NULL`) OR belong to the turno's centro. Otherwise a
scoped caller attaches out-of-scope volunteers and reads their names back via the GET join
(cross-centro/città data leak). Mirror this on any future record→record assignment endpoint.

**Why:** code review flagged it as broken access control / IDOR. The centro itself is
città-validated, but the FK payload (volontari) was not.

**How to apply:** dedupe the payload by volontarioId (no DB unique constraint — low-concurrency
design), then `inArray` fetch the referenced volontari and reject (403) if any fail the
centro filter. The find-or-create + delete-all + insert-all replace runs inside `db.transaction`
so a double-submit can't leave a partial state.
