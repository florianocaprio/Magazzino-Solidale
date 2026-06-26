---
name: areaGuard amministrazione auto-deny
description: Why mapping an API segment to "amministrazione" in AREA_BY_SEGMENT silently blocks ALL non-admins, even those holding another mapped area.
---

`areaGuard` grants admins unconditionally (`user.isAdmin` early-return), then denies if the mapped areas array `includes("amministrazione")` **OR** the user has none of the mapped areas. So `"amministrazione"` is treated as an admin-only sentinel.

**Consequence:** mapping a segment to `["logistica","amministrazione"]` does NOT mean "logistica OR admin can read" — the presence of `"amministrazione"` makes it admin-only and a non-admin logistica user gets 403, regardless of also having `"logistica"`.

**Rule:** to let a non-admin area READ an endpoint whose mutations are admin-only, map the segment to ONLY the non-admin area (e.g. `"logistica"`) and guard the write handlers with `requireAdmin` in the route. Admins still pass via the isAdmin early-return.

**Why:** discovered when configurable Volontari roles (`/ruoli-volontari`, GET must feed the volontari form for logistica staff, mutations admin-only) initially mapped to `["logistica","amministrazione"]` and broke role loading for non-admin logistica users.

**How to apply:** never add `"amministrazione"` to a mixed AREA_BY_SEGMENT array intending an OR; it is an admin-only marker. Use the non-admin area alone + per-handler `requireAdmin`.
