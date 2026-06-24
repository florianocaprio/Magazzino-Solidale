---
name: FSE+ end-of-year report
description: How the FSE+ (Fondo Sociale Europeo Plus) annual report aggregates products and persons reached.
---

# FSE+ annual report (`GET /report/fse-plus?anno`)

The report serves EU social-fund (FSE+) end-of-year rendicontazione: products distributed + persons reached.

## What counts as "delivered FSE+"
- Provenance is on the **lot**: `lotti.fse_plus = true` (joined via `bolla_righe.lottoId`).
- A delivery counts only when its bolla `stato IN ('confermata','consegnata')` and the bolla's year (`EXTRACT(YEAR FROM data_bolla)`) matches `anno`.
- Product weight in kg = sum of `bolla_righe.quantita` only for products whose `unita_misura = 'kg'`; `pesoTotaleKg` sums those.

## Persons reached
- **Count ALL household members**, not just the titolare. Confirmed product decision.
- `personeTotali` = titolari (one per family that received FSE+) UNION ALL every `nucleo_familiare` member of those families.
- `beneficiariTotali` = count of distinct families (titolari), NOT persons.
- Each person carries `sesso` (M/F) for the M/F split; nucleo members inherit the **family-level** `area_provenienza` (UE / Extra-UE) from the titolare's `beneficiari.area_provenienza` — area is per-family, not per-person.
- Age derives from `data_nascita`: adult = `data_nascita <= CURRENT_DATE - INTERVAL '18 years'`, minor = present and younger. **Null birthdate counts in M/F and UE/Extra-UE totals but in neither adulti nor minori** — so adulti+minori can be less than the sesso total.

## Registry data that feeds it
- `beneficiari.sesso` (varchar 1), `beneficiari.area_provenienza` (varchar 10) — area is family-level.
- `nucleo_familiare.sesso` (varchar 1) — each member needs their own sesso; age from the member's `data_nascita`.
- Nucleo members are editable in the beneficiary detail page (add dialog + delete); there is a `DELETE /beneficiari/{id}/nucleo/{membroId}` endpoint scoped by both ids.

**Why:** the EU funder requires headcount split by sesso × (UE/Extra-UE) and adulti/minori, plus total kg of food distributed under the fund.
