---
name: Consegne stato & bolla readiness
description: Delivery (consegne) state values, how readiness derives from the linked bolla, and completion rules.
---

# Consegne stato values
- DB/API stato values are `pianificata` (default) and `effettuata` (delivered). There is NO `programmata`/`completata` — those were a long-standing frontend bug where badges/actions referenced nonexistent states, so the "Completa" button never rendered.
- `report.ts` counts delivered consegne with `stato = 'effettuata'`. Keep the internal value `effettuata`; only the UI label says "Consegnata".
- **How to apply:** when touching consegne stato, use `pianificata`/`effettuata` in code and map to display labels "Pianificata"/"Consegnata".

# Bolla ↔ consegna readiness (no separate state column)
- A consegna's "bolla readiness" is DERIVED from the linked bolla via `bolle.consegnaId` (one bolla per consegna; route unlinks others on associate). Mapping: bolla `bozza` = "in preparazione", `confermato` = "pronta", `consegnato` = "consegnata". No new schema column was added.
- GET /consegne enriches rows with `bollaId/bollaNumero/bollaStato`, picking the highest-priority non-`annullato` linked bolla (consegnato > confermato > bozza).
- Associate endpoint `POST /consegne/:id/associa-bolla {bollaId|null}` validates: same beneficiario, not annullato, not already linked elsewhere.

# Bidirectional sync: marking a bolla consegnato keeps consegne aligned
- `POST /bolle/:id/consegna` calls `syncConsegnaDaBolla`: if the bolla is linked to a consegna, that consegna becomes `effettuata` (idempotent — skip if already effettuata); if NOT linked (or the link dangles to a missing consegna), it creates a `diretta` consegna (stato `effettuata`, dataPrevista = today, magazzino/beneficiario from the bolla) and links the bolla to it.
- Direct consegne use `tipoConsegna = 'diretta'`; the frontend renders a distinct "Consegna diretta dal centro di ascolto" label. Centro di ascolto is implicit via beneficiarioId (consegne GET joins beneficiari.centroAscoltoId for the centro filter).
- **Why:** the two views (Bolle and Consegne) must never diverge — delivering from either side must update the other. The reverse path (`/consegne/:id/completa`) already marks the linked bolla `consegnato`.

# Completing a consegna does NOT create its own intervento
- `POST /consegne/:id/completa` requires a linked bolla in `confermato`/`consegnato`; it promotes a `confermato` bolla to `consegnato` and sets consegna `effettuata`+dataEffettuata.
- The intervento is created by the existing `syncInterventoBolla` at bolla CONFERMA time, not at consegna completion. Completing must NOT create a second intervento — rely on the bolla-owned one to avoid duplicates.
- **Why:** memory `bolla-intervento-sync` — a confirmed bolla owns exactly one auto-synced intervento. Creating another on consegna completion would duplicate the beneficiary's intervento history.
