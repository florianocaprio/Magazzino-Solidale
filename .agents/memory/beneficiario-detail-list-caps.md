---
name: Beneficiario detail endpoint caps nested lists
description: GET /beneficiari/:id truncates nested interventi/consegne, so don't use it for exports
---

The `GET /beneficiari/:id` (BeneficiarioDettaglio) response caps its nested `interventi`
and `consegne` arrays (limit 20 each) — it is built for the detail page UI, not full data.

**Why:** A "scheda"/profile export that reused `b.interventi` from this payload would silently
drop records for beneficiaries with >20 interventi.

**How to apply:** For any export or report that needs the COMPLETE list, fetch from the
dedicated list endpoint instead — e.g. `useListInterventi({ beneficiarioId })` (cap 200) —
rather than the nested array on the detail object.
