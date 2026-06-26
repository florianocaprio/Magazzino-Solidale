---
name: Utenti matricola auto-generation
description: How operator matricola is auto-generated when left blank on user creation
---

Users (`utenti`) capture `nome` and `cognome` separately (`cognome` is a nullable column but required on the create form/input). On `POST /utenti`, if `matricola` is blank it is auto-generated server-side (`routes/utenti.ts` `generateMatricola`) in the format:

`<InitialNome><InitialCognome><yy>-<SIGLA>-<NNNNNN>` (uppercased)

- `yy` = last 2 digits of the insertion year.
- `SIGLA` = the user's città `citta.sigla` (a dedicated editable 2-letter field, uppercased server-side on POST/PATCH /citta) OR, as fallback, the first 2 letters of the città name; `OO` for global users (`cittaId` null).
- `NNNNNN` = random 6-digit number.
- Collision handling: on a full-matricola DB collision the FIRST character of the number becomes a letter (A, B, C…); final fallback uses a timestamp tail.

Example: Mario Rossi inserted 2026, città Milano (sigla MI) → `MR26-MI-482910`.

**Why:** the previous format (`MR2426`, day+year, no uniqueness) wasn't unique and carried no città context. The città sigla + random number make codes city-scoped and collision-safe.

**How to apply:** generation is server-side only and async (it queries `cittaTable` for the sigla and checks `matricolaExists` for uniqueness). nome/cognome are trimmed before generating initials. The seed admin has only `nome` (cognome null → single initial, fine).

**One-off bonifica:** `pnpm --filter @workspace/scripts run bonifica:matricole` (`scripts/src/bonificaMatricole.ts`) regenerates ALL existing matricole into the new format, taking each user's year from their `dataCreazione`. Uniqueness is enforced within the batch via an in-memory `seen` set (safe because it overwrites every row). Re-running produces different random numbers — run only when intentionally resetting.
