---
name: Configurable volontari roles
description: How volunteer roles became an admin-managed picklist without an FK migration.
---

The 4 hardcoded volontari role options were replaced by an admin-managed CRUD lookup (`ruoli_volontari` table, admin page under amministrazione).

**Key design:** `volontari.ruolo` REMAINS a free-text string storing the role NAME — there is NO foreign key to `ruoli_volontari`. The table is purely a configurable picklist that drives the select options.

**Why:** avoids a migration/backfill and keeps existing rows valid. The table is seeded with the legacy keys (`magazziniere`, `autista`, `operatore_sportello`, `coordinatore`) so existing volunteers' stored values still match an option, and the existing `volontari.roles.<key>` i18n labels keep rendering.

**How to apply:**
- Display name = `t(\`volontari.roles.<nome>\`, { defaultValue: nome.replace(/_/g," ") })` — built-in keys translate, admin-added custom names show as typed. Same helper used on both the volontari form and the roles admin page.
- The volontari role select shows active roles OR the row's current value (so an existing volunteer on a now-inactive/renamed role still displays it).
- Deleting a role is free (no FK) — it just retires the option; volunteers keep their stored name.
- Roles are GLOBAL (no città/centro scoping). GET is readable by logistica (feeds the form); mutations are requireAdmin.
