---
name: Utenti nome/cognome + matricola auto-generation
description: How operator matricola is auto-generated when left blank on user creation
---

Users (`utenti`) capture `nome` and `cognome` separately (`cognome` is a nullable column but required on the create form/input). On `POST /utenti`, if `matricola` is blank it is auto-generated as `initial(nome)+initial(cognome)+ddyy`, uppercased — dd = day-of-month (zero-padded), yy = last 2 digits of year. Example: Mario Rossi on 24 June 2026 → `MR2426`.

**Why:** gives every operator a printable code on bolle even when the admin doesn't supply one.

**How to apply:** generation is server-side only in `routes/utenti.ts` (`generateMatricola`). No uniqueness/collision handling by design. nome/cognome are trimmed before storing and before generating initials. The seed admin has only `nome` (cognome stays null — fine since nullable).
