---
name: Date-only expiry comparison
description: How to classify YYYY-MM-DD expiry dates into expired/soon without timezone drift or premature expiry
---

When classifying a date-only (`YYYY-MM-DD`) value as expired vs expiring-soon for UI alerts, compare on CALENDAR DAYS, not timestamps.

**Rule:** parse the `YYYY-MM-DD` part into a LOCAL date (`new Date(y, mo-1, d)`), compute the day diff against start-of-today, then: `diffDays < 0` = expired (RED), `0 <= diffDays <= 30` = soon (ORANGE), else ok. Today (`diffDays === 0`) is treated as still valid → orange, not red.

**Why:** `new Date(dateStr).getTime() - new Date().getTime()` compares an all-day date against the current timestamp, so a record expiring *today* flips to "expired" right after midnight. Also `new Date("YYYY-MM-DD")` parses as UTC midnight, which shifts a day in negative-offset timezones. Both cause vehicles/items to show as scaduto a day too early.

**How to apply:** any expiry highlighting on date-only columns (e.g. mezzi scadenzaRevisione/scadenzaAssicurazione in `pages/mezzi.tsx`'s `expiryStatus`). Reuse the same helper shape if adding expiry alerts elsewhere.
