---
name: Volontari centro-di-ascolto scoping
description: How volunteers are scoped to a listening centre and how delivery pickers filter them
---

A volontario has a nullable `centroAscoltoId` (FK → centri_ascolto). NULL means the volunteer is universal — usable for ALL centri. A non-null value restricts the volunteer to deliveries for that one centro.

**Picker filtering rule (delivery transporter/volunteer selects):** show a volunteer if `centroAscoltoId == null` OR it equals the *selected beneficiary's* centro. Derive the centro from the chosen beneficiary, NOT from any UI centro filter — when a UI centro filter is on "all" it must not unconditionally show every centre-specific volunteer.

**Why:** the requirement is that centre-specific volunteers only appear for their own centre's deliveries; the delivery's centre = the beneficiary's centre.

**How to apply:** in bolle create dialog and consegne create form, look up the selected beneficiary in the (unfiltered) beneficiari list and compare `beneficiario.centroAscoltoId`. The Volontario API response carries `centroAscoltoId` (+ `centroAscoltoNome` via leftJoin) for this client-side filtering — no server-side query param was added.
