---
name: Bolla trasportatore & PDF addresses
description: How a delivery bill records its transporter and how the PDF gets warehouse/recipient addresses.
---

A bolla's transporter is EITHER a volunteer (`bolle.volontarioConsegnaId`) OR a free-text
`bolle.trasportatoreNome` (self-pickup at the warehouse, default "Ritiro presso il magazzino").
They are mutually exclusive: setting one clears the other in both the create dialog and the
detail "Chi effettua la consegna" selector (a Select of active volontari + an "Altro" option
that reveals a free-text Input).

**Why:** the user wanted every delivery bill PDF to name who transports the goods, mirroring
the trasferimenti transporter pattern (volontario select + "Altro" free text) for consistency.

**How to apply:**
- The bolla detail selector value resolves: `volontarioConsegnaId` → its id; else
  `trasportatoreNome` → "__altro__"; else `noteConsegna` → "__centro__".
- `GET /bolle/{id}` (buildDettaglio) joins `magazzini` (indirizzo/comune) and `beneficiari`
  (telefono + address with domicilio→residenza→comune fallback as `beneficiarioIndirizzo`) so
  the client PDF can render the full warehouse + recipient addresses and a "Trasportatore:" line.
- `volontarioNome` (from the volontari join) takes precedence over `trasportatoreNome` for display.
