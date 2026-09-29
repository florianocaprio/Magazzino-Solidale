# M5C1-R2 — collaudo tecnico formale completo

Data: 30 settembre 2026. Esito: **PASS TECNICO**, in attesa di pubblicazione, review e validazione manuale. Questo rapporto non costituisce una validazione manuale.

## Candidato e perimetro

- Branch: `codex/magazzino-workflow-unificato`.
- HEAD locale e remoto di base: `95bad0aca6891a44e1c77bb54784d4d39a99050c`.
- Candidato: HEAD più l'intero working tree M5C1-R2, inclusi file nuovi e migration 46. Staging vuoto; nessun commit, push, merge o deploy.
- `origin/main` al preflight: `787d7c5436d5fa4c0edb24be373d055946d402ce`.
- Il codice applicativo, lo schema, la migration 46 e i generated non sono stati corretti durante `##test`. Sono stati adeguati soltanto test, harness e questo rapporto.
- Lo stack Docker e il database persistenti sono rimasti fuori perimetro. M5C2 non è stata avviata.

La review statica ha incluso route e UI Interventi, Richieste, Bolle, Enti e Mensa, trasferimenti, contratti OpenAPI, generated, `seedRoles.ts`, migration 46 e i documenti di raccordo M5A/M5B/M5C1/R1/R2/R3. Il delta non introduce un secondo motore di stock o prenotazione.

File modificati/creati **durante questo `##test`** (non il delta applicativo R2 preesistente): `artifacts/api-server/tests/m5c1-e2e-seed.mjs`, `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`, `artifacts/magazzino-solidale/e2e/m5c1-centro-richiesta.spec.ts`, `artifacts/magazzino-solidale/e2e/mensa-workflows.spec.ts`, `artifacts/magazzino-solidale/e2e/m5c1-r2-formal.spec.ts`, `lib/db/scripts/m5c1-r2-formal-migration.mjs`, `lib/db/scripts/migration-runner.test.mjs` e questo rapporto.

## Migration 46 e RBAC

PostgreSQL 16 effimero, indipendente dal persistente, senza volume: upgrade autentico con i 45 SQL della SHA base, ledger 45/45 e dati sintetici popolati. Prima della migration erano presenti ruoli canonici, custom con grant legacy, Enti, Bolle, movimenti e lotti. Lo script `lib/db/scripts/m5c1-r2-formal-migration.mjs` ha applicato **solo** `20260929_m5c1_r2_enti_ownership.sql` tramite runner ufficiale:

- 45 → 46/46, un file applicato; verifica checksum/ordine positiva.
- Solo `Operatore Magazzino` perde `enti-destinatari.manage` e conserva `view`; `Operatore` Sociale, custom, Amministratore e SuperAdmin invariati dalla migration.
- Digest SHA-256 di tutte le tabelle di dominio esclusi i ruoli: `eb554da8c10cdb5c1bcbfa305521cc1d4249bda71242b3cc342fe380736f6ad7` prima e dopo, con conteggi invariati.
- Seconda esecuzione: zero migration applicate, 46 skipped.
- `seedRoles()` reale non reintroduce il grant `manage` nel Magazzino né i grant `bolle.manage/deliver/cancel` nell'Operatore Sociale.
- Fresh 46/46 e secondo run 0/46; runner migrations con PostgreSQL reale: 24/24 test verdi. Il suo test di manifest è stato aggiornato da 45 a 46 senza cambiare il runner.

## R2-01 — Centro e Intervento

**GO.** E2E con sessione Sociale: Intervento senza data presente come record nella lista `Da pianificare`, riapertura, prima pianificazione, passaggio del medesimo record in `Pianificati`, seconda modifica di data/ora e verifica API/DB dopo reload. Nessuna Richiesta nasce automaticamente. L'invio contestuale produce una sola Richiesta con beneficiario/intervento/priorità/data corretti, senza prodotto, lotto o magazzino copiati dal Centro; dopo il submit si ritorna al dettaglio dello stesso Intervento con `interventoId`, codice/stato e link `Apri richiesta`. Il reload conserva lo stato.

## R2-02 — Presa in carico, Bolla e volontario

**GO.** E2E con sessione Magazzino reale: richiesta `inviata` → `Prendi in carico` → scelta esplicita del Magazzino → creazione e apertura della Bolla collegata. Verificati link documento e percorso deep-link. Le regressioni API coprono il replay senza seconda Bolla.

P1 e P2 aggiunti tramite UI risultano visibili subito, dopo chiusura/riapertura e reload, e sono due righe DB reali. Una riga viene poi rimossa: UI immediata, riapertura, reload e DB concordano sulla sola riga rimasta. Il test usa il campo codice prodotto della stessa UI per selezionare i due prodotti senza dipendere dallo scorrimento di un menu lungo. Il codice di invalidazione copre facciata documento, Bolla canonica, liste, richiesta collegata e giacenze pertinenti.

Volontario permanente approvato e coperto: PATCH, UI, reload e FK della Bolla coerenti. La scelta resta facoltativa; i temporanei non sono offerti in assenza di data affidabile (regressione API). Forzando un volontario divenuto inattivo, il backend nega la PATCH e la UI mostra il messaggio effettivo del backend. La Bolla non crea nuovi volontari.

## R2-03 — Enti Esterni

**GO.** La sessione Sociale vede la pagina sotto Centro, crea, modifica, disattiva e riattiva l'Ente nel proprio scope. Sei Enti sintetici con nomi simili verificano ricerca incrementale case-insensitive; la ricerca per indirizzo univoco restringe a un record. La risposta è paginata/limitata, non una directory illimitata.

La sessione Magazzino legge gli Enti autorizzati e li seleziona nella Bolla, senza accesso alla pagina di gestione Centro. Un ruolo custom solo Magazzino con `enti-destinatari.manage` legacy riceve 403 sui POST/PATCH diretti, senza effetti DB. Nella creazione Bolla non appare il mini-form `Nuovo Ente`; combobox e ricerca scelgono l'Ente esistente, la scelta del Magazzino è esplicita, i campi mancanti producono feedback visibile. La Bolla creata conserva l'Ente dopo riapertura e reload, con FK verificata. I test API includono i confini Area/scope.

## R2-04 — Mensa e lotto fisico

**GO.** Fixture P1 con lotto obbligatorio, P2 senza obbligo, L1=10, L2=58, lotto scaduto, lotto di altro prodotto e lotto di altro Magazzino. Endpoint minimizzato e scoped: solo L1/L2, ordine FEFO e disponibilità reale. In UI il campo Lotto appare solo quando richiesto; assenza lotto e quantità 11 su L1 sono bloccate, quantità 10 è valida. La richiesta passa `lottoId=L1` alla riga M4; preparazione e prenotazione M4 restano su L1, senza sostituzione FEFO silenziosa. API negative per lotto mancante/scaduto/altro prodotto/altro Magazzino/quantità eccessiva. P2 continua senza lotto. K1+L1 replay idempotente; K1+L2 conflitto. E2E Mensa e test API mirati verdi.

## Regressione e build

| Gate                                                                | Risultato                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Suite API completa single-worker su PostgreSQL effimero fresh 46/46 | **129 file PASS; 1479 PASS, 4 SKIP storici**                                                                                             |
| Frontend completa                                                   | **86 file PASS; 456 PASS**                                                                                                               |
| E2E desktop R2-01…04 + M4A                                          | **15/15 PASS**                                                                                                                           |
| Typecheck workspace                                                 | **PASS**                                                                                                                                 |
| Codegen OpenAPI                                                     | **PASS**, 390 file generated con checksum identici prima/dopo                                                                            |
| Build Linux Docker API/WEB dal working tree                         | **PASS**                                                                                                                                 |
| Budget WEB                                                          | **PASS**, entry 388,04 KiB gzip (limite 400 KiB)                                                                                         |
| Runner migration PostgreSQL                                         | **24/24 PASS**                                                                                                                           |
| Prettier                                                            | **PASS** sui 34 file sorgente/test/documentali modificati; gli 11 generated sono esclusi perché emessi dal codegen, che è deterministico |
| `git diff --check`                                                  | **PASS**                                                                                                                                 |

I quattro skip storici dipendono da fixture esterne non fornite: `fse-import-parser-m3b`, `fse-import-practice-m3b`, `agea-import` e `agea-sifead-parser`. Non sono stati aggiunti skip/retry per ottenere il verde.

`pnpm install --frozen-lockfile --offline` è stato tentato ma pnpm ha rifiutato la rimozione interattiva di `node_modules` (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); le dipendenze già installate hanno eseguito suite, typecheck, codegen e build. Non è stato forzato alcun purge.

## Failure intermedie e riconciliazione

- Primo run API completo: 1474 PASS, 5 FAIL, 4 SKIP su race storica Cassa; il relativo file isolato è poi passato 52/52.
- Secondo run API completo: 1478 PASS, 1 FAIL, 4 SKIP su reso OpC concorrente FSE+; il file isolato è passato 9/9. Il run finale, su nuovo DB pulito con `SESSION_SECRET` sintetico e flag disposable M5A/M5B/M5C1, è passato 1479/1479. Le failure intermittenti restano osservazioni di stabilità del test storico, non sono state nascoste.
- Un tentativo API era privo dei flag disposable; è stato interrotto. Un altro era privo di `SESSION_SECRET` e non era valido come gate; entrambi sono stati sostituiti dal run finale correttamente configurato.
- I primi E2E hanno evidenziato mismatch di Origin nell'API effimera, locator obsoleti M4A/Enti, timeout di selezione in un menu prodotti molto lungo, un pool DB condiviso chiuso da due suite e una fixture temporanea Mensa segnalata come possibile duplicato dopo run ripetuti. Sono stati adeguati solo ambiente effimero e test/harness. L'assert del messaggio rete M4A ora verifica l'alert contestuale reale; il caso duplicato Mensa richiede conferma esplicita, senza accettare una creazione involontaria. Il run combinato finale è 15/15.
- Il runner migration aveva un'aspettativa storica fissa di 45 file: aggiornata a 46 nel solo test; runner PostgreSQL finale 24/24.

## Ambiente, evidenze e arresto

Risorse create esclusivamente per questo collaudo: container effimeri `magazzino-m5c1-r2-formal-pg-20260929`, `magazzino-m5c1-r2-formal-api-20260929`, `magazzino-m5c1-r2-formal-web-20260929`; rete `magazzino-m5c1-r2-formal-net-20260929`; immagini `m5c1-r2-formal-api:20260929` (`sha256:28443be1d416af59329a96d0fdc33084e4192b048c8a1c7d5876ff5436eaf2ed`) e `m5c1-r2-formal-web:20260929` (`sha256:7d9129221edfda5b934b94f877feb27fb81a9246b4803b0e66922e74b0606826`). PostgreSQL usa `tmpfs`, nessun volume. I database `m5c1_r2_*` sono confinati nel container effimero; il runner crea e rimuove il proprio database temporaneo. I file sorgente base estratti sono in `/private/tmp/m5c1-r2-base-OC5Lfp` fino al cleanup.

Cleanup nominativo completato: arrestati e rimossi automaticamente i tre container temporanei (tutti `--rm`), rimossa la sola rete `magazzino-m5c1-r2-formal-net-20260929`, rimosse le sole due immagini temporanee sopra identificate e cancellata la directory sorgente temporanea `/private/tmp/m5c1-r2-base-OC5Lfp`. Nessun volume M5C1-R2 era stato creato. La verifica finale `docker ps -a`, `docker network ls` e `docker volume ls` non mostra risorse disposable M5C1-R2 residue. I container persistenti `magazzino-web`, `magazzino-api`, `magazzino-postgres` hanno gli stessi ID iniziali (`f8c47f4ec5c7`, `30a783d0da23`, `af6bd975d17d`) e sono rimasti attivi; la rete `magazzino-solidale_default` e i volumi `magazzino-solidale_magazzino_pgdata`/`magazzino-solidale_magazzino_uploads` sono presenti e non sono stati toccati. Altre reti e volumi di altri progetti sono stati lasciati invariati.

Evidenze e checksum: `/Users/florianocaprio/Documents/M5C1-R2-test-evidence-20260930/`. Git finale: HEAD locale e origin dedicato invariati alla SHA di base, divergenza `0/0`, `origin/main` invariato, staging vuoto, working tree R2 intenzionalmente modificato e non committato. Nessun commit, push, merge o deploy.

**M5C1-R2 — ##test PASS TECNICO — IN ATTESA DI PUBBLICAZIONE E REVIEW.** Nessun commit/push/merge/deploy; DB persistente e main invariati; M5C2 non avviata.
