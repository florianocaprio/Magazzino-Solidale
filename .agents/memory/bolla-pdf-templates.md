---
name: Bolla PDF templates & print settings
description: Where the bolla PDF template enum lives and the centro-logo storage choice; what must stay in lockstep.
---

# Bolla PDF template system

The set of valid bolla PDF templates (`standard | moderno | minimal`) is duplicated in four places and must be changed in lockstep, or PDF generation/validation breaks:
- DB column `impostazioni_stampa.template_bolla` (plain varchar, no DB constraint)
- OpenAPI `ImpostazioniStampa`/`ImpostazioniStampaUpdate` `templateBolla` enum
- API `PUT /impostazioni-stampa` validation list (`VALID_TEMPLATES`)
- Frontend PDF generator `ACCENT` map keyed by template (client casts the stored string to the union)

**Why:** the generator indexes `ACCENT[template]` and dereferences the color tuple immediately; an unknown stored value would crash. The generator now also has a defensive fallback to `standard`, but the enum is still the real guard.

**How to apply:** when adding/renaming a template, update all four spots + re-run `pnpm --filter @workspace/api-spec run codegen`.

# Print settings + centro logo storage

- Print settings (`impostazioni-stampa`) is a singleton row (id=1). Init is lazy + atomic via `insert().onConflictDoNothing()` then select — safe under first-request concurrency.
- Centro di Ascolto logo is stored as a **base64 data URL** in the `centri.logo_url` text column (NOT object storage). Pragmatic for small logos / low volume; jsPDF `addImage` consumes the data URL directly, and the upload UI caps file size (~500 KB).
- Association logo for the PDF footer is loaded at print time from `public/logo-aim.png` via `BASE_URL` and converted to a data URL.
- In the bolla print dialog the centro is resolved indirectly: bolla → beneficiary (`useListBeneficiari`) → `centroAscoltoId` → centro (`useListCentriAscolto`). The bolla detail payload does NOT carry centro info.
