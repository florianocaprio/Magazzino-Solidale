---
name: Bolla → Intervento auto-sync
description: How a delivery bill (bolla) keeps a linked social intervento in sync, and the constraints that follow from it.
---

# Bolla → Intervento auto-sync

A confirmed bolla owns exactly one linked `interventi` row (FK `bollaId`). It is
created/updated/removed automatically; users do not hand-manage it.

- `tipoIntervento` is a **comma-joined** list of labels derived from the delivered
  product types (mapping lives in `bolle.ts`: alimentare→pacco_alimentare,
  vestiario→vestiti, igiene→igiene, medicinali/farmaci→medicinali). Multiple product
  types ⇒ multiple comma-joined labels, e.g. `"pacco_alimentare,igiene"`.
- Sync fires on: conferma, add/remove riga (only when bolla already confermato),
  and header patch when beneficiario changes on a confermato bolla. Removal fires on annulla.

**Why:** the intervento must always reflect what was actually delivered, across every
mutation path, without manual upkeep.

**How to apply (constraints this imposes):**
- **Never change a bolla's `stato` via `PATCH /bolle/:id`** — it rejects stato changes.
  Lifecycle transitions must go through the dedicated endpoints (`/conferma`,
  `/consegna`, `/annulla`) so stock scarico/storno AND intervento sync both run.
- **Any filter/equality on `interventi.tipoIntervento` must be token-aware**, not a plain
  `eq`, because auto-generated values can be comma-joined. The `/interventi` route uses
  `eq OR ilike` token matching. New code that filters interventi by type must do the same.
