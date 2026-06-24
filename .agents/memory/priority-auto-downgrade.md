---
name: Priority auto-downgrade job
description: How/why beneficiary priorità is auto-set to 'bassa' after 2 years and its known limitation
---

A scheduled job (api-server `lib/priorityDowngrade.ts`, wired in `index.ts` after seedAdmin) sets `beneficiari.priorita='bassa'` for every beneficiary whose registration date `COALESCE(dataPresaInCarico, dataCreazione)` is older than 2 years and whose priorità is not already 'bassa'. Runs once at startup, then on a daily interval (`timer.unref()`).

**Why:** business rule — long-registered beneficiaries should naturally drop to low priority unless re-triaged.

**How to apply:** the job re-runs daily and is idempotent, so it WILL re-force 'bassa' even if an operator manually bumps a >2yr beneficiary back up to media/alta/urgente. If a future request needs manual bumps to "stick", add an opt-out (e.g. a manual-override timestamp or flag) rather than just changing the query — otherwise the next daily tick reverts the bump. Priorità values: bassa/media/alta/urgente.
