# M5C1-R1 — rapporto `##test` formale

**Esito:** PASS tecnico, in attesa di pubblicazione, code review e prova manuale di Floriano. Il test non costituisce validazione manuale né deploy.

## Identità e perimetro

- Branch: `codex/magazzino-workflow-unificato`.
- HEAD locale e `origin/codex/magazzino-workflow-unificato`: `52e04c820ea57d77687c63352572b03cc87971bb`; divergenza `0/0`. Staging vuoto. Il candidato è HEAD più tutto il delta R1 locale, compresi i file non tracciati.
- `origin/main`: `787d7c5436d5fa4c0edb24be373d055946d402ce`; `main` locale preesistente: `8419dc7ff9d5177c39d90e66f04b19236021244d`. Nessuno dei due è stato modificato.
- Il delta R1 comprende `src/pages/interventi.tsx`, `src/lib/interventi-sociali-filters.ts`, `src/lib/i18n/namespaces/interventi.ts`, `vitest.unit.config.ts`, i test pagina/filtri/dettaglio, l'E2E `m5c1-centro-richiesta.spec.ts` e `docs/M5C1-R1-continuita-ux.md`. In questa fase formale sono stati modificati solo l'E2E/harness e il presente rapporto; il codice applicativo non è stato corretto.
- `artifacts/api-server/**`, `lib/db/src/schema/**`, `lib/db/updates/**`, OpenAPI, generated e `pnpm-lock.yaml` sono byte-identici a HEAD. La migration 45 ha SHA-256 `a7dce4addda53491d71cb652654d683d73dff098eea6ed732c6db0805afcfe1f` ed è invariata; non è stato ripetuto un upgrade 44→45.

## Gate Vitest discovery

Ho confrontato `vitest list --filesOnly --json` con una copia temporanea del config esatto di HEAD e con quello R1; la copia è stata poi rimossa.

| Config | File scoperti | Esito                                            |
| ------ | ------------: | ------------------------------------------------ |
| HEAD   |            84 | Tutti ancora presenti nel candidato              |
| R1     |            85 | Aggiunto solo `src/pages/interventi-r1.test.tsx` |

I tre include originari (`src/lib`, `src/hooks`, `src/components`) sono conservati; R1 aggiunge `src/pages/**/*.test.{ts,tsx}` senza `exclude`, skip o riduzioni. Insieme base ⊆ insieme candidato; file persi: **0**.

## Percorso operatore verificato nelle liste reali

L'E2E parte da **Annullati** con ricerca, priorità, operatore, tipo, data, stato e legacy incompatibili, mantenendo Area 1 e Centro 1.

1. `Registra intervento da pianificare` senza data/ora restituisce `201`; API/DB espongono `stato=da_pianificare` e `dataOraPianificata=null`. La vista diventa **Da pianificare**, l'URL include il nuovo `interventoId` e il dettaglio si apre.
2. Dopo reload, il dettaglio del medesimo ID si riapre. La sezione **Richiesta al Magazzino** è presente; nessuna richiesta aperta è stata creata. Chiudendo il dettaglio, l'E2E asserisce sulla riga realmente visibile `data-intervento-id=<id>`: codice beneficiario `M5C1-E2E-B1`, tipo restituito dall'API e priorità **Normale**. Non si limita al contatore.
3. La riga viene riaperta **dalla lista**. `Pianifica` con `15/10/2026 10:30` produce stato `pianificato` e timestamp `2026-10-15T08:30:00.000Z` (Europe/Rome). Vista **Pianificati**, dettaglio e deep-link restano coerenti anche dopo reload.
4. Dopo chiusura, la stessa riga è realmente in **Pianificati**, con beneficiario e data/ora mostrati. Passando a **Da pianificare** la riga è assente; tornando a **Pianificati** è presente e riapribile. Il contatore Da pianificare cala di 1 e Pianificati cresce di 1 rispetto ai valori acquisiti prima della transizione.
5. La CTA della richiesta da intervento **senza data** passa `interventoId` e `beneficiarioId`, priorità `normale` e data desiderata vuota. Da intervento **pianificato** passa gli stessi ID/priorità e data civile `2026-10-15`. In nessun caso precompila prodotto, quantità, magazzino o lotto. Prima dell'invio non esistono richieste aperte; il submit esplicito restituisce `201`, produce una sola richiesta aperta, e il dettaglio mostra **Apri richiesta**.
6. I filtri non territoriali incompatibili sono rimossi dopo creazione/transizione; Area e Centro restano nell'URL. Il reload non duplica l'intervento.

Un secondo scenario crea direttamente da **Conclusi** tramite `Pianifica nuovo intervento`: data e ora vuote mostrano due errori obbligatori; dopo compilazione il record è `pianificato`, il dettaglio nuovo ID è aperto, la riga con beneficiario e `16/10/2026 11:30` compare realmente in **Pianificati** anche dopo reload, e nessuna richiesta nasce automaticamente.

## Esecuzioni e regressioni

| Verifica                                       | Esito formale                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Frontend mirato R1 (pagina, filtri, dettaglio) | 3 file, 13 test PASS                                                                                             |
| Frontend completa                              | 85 file, 452 test PASS                                                                                           |
| E2E M5C1 completo                              | 20/20 PASS complessivi nelle 5 viewport: 390×844, 768×1024, 1024×768, 820×1180, 1440×900; 4 scenari per viewport |
| API M5C1/interventi pertinenti                 | 3 file, 58 test PASS sul PostgreSQL effimero                                                                     |
| Typecheck workspace                            | PASS                                                                                                             |
| Build Linux API e WEB                          | PASS; entrambe le build hanno eseguito `pnpm install --frozen-lockfile`                                          |
| Prettier sui file R1                           | PASS                                                                                                             |
| `git diff --check`                             | PASS                                                                                                             |

La suite API **completa** non è stata rieseguita in questo `##test`: il prompt la rende facoltativa se il backend è byte-identico, condizione verificata. Il precedente risultato di sviluppo (1.473 PASS/4 skip) non è conteggiato come gate formale corrente. Nessun test manuale è stato eseguito.

Il primo giro E2E mobile ha prodotto 3 PASS/1 failure **di harness**: un selettore `getByRole(tab)` non vedeva i tab sottostanti mentre il dettaglio modale, correttamente, li escludeva dall'albero accessibile. La trace è conservata. Ho sostituito soltanto il locator del test con un locator DOM; scenario mobile mirato PASS, poi suite completa 20/20 PASS. Un secondo run completo 20/20 PASS ha generato il report JUnit. Nessuna modifica applicativa, assert indebolito, skip o retry.

Le etichette italiane sono distinte (`Registra intervento da pianificare` / `Pianifica nuovo intervento`); controllo delle chiavi `actions`, `titles` e `descriptions` positivo per `it`, `en`, `es`, `fr`, `de`, `ar`, senza fallback tecnico. Il primo controllo i18n via `tsx -e` è stato negato dalla sandbox sulla pipe locale; lo stesso comando read-only, approvato, è passato.

## Ambiente, evidenze e cleanup

Collaudo isolato su rete `m5c1-r1-formal-net-20260929`, PostgreSQL `m5c1-r1-formal-pg-20260929` con data directory **tmpfs** (nessun volume), API/WEB `m5c1-r1-formal-api-20260929` e `m5c1-r1-formal-web-20260929`, browser Playwright `--rm`. Il database sintetico `m5c1_fresh` ha ledger 45/45. Le due immagini create avevano ID `sha256:393617a1bd1e4be921c856ae410ac7fbbe16d218602fc307bcaee9a97f467002` (API) e `sha256:9ec394d2cbfd93a32467cdbe6d43531bf34238078d65bcea02c669fb1da63df1` (WEB). Tutti e tre i container, la rete e le due immagini sono stati rimossi nominativamente; nessun volume test è stato creato.

Evidenze fuori repository: `/Users/florianocaprio/Documents/M5C1-R1-test-evidence-kxS1yV/`.

- `playwright-junit.xml`: 20 test, 0 failure/error/skip; SHA-256 `877da31ebaf4894a9702b3b1fd60cd9db07e167224091c62f7a5e02e29784e20`.
- `playwright/.last-run.json`: SHA-256 `91d1c43004802cd49950d78eb11c8fa7d05da8ffffe219a8b13b2f561bc00903`.
- `initial-harness-failure/trace.zip`: SHA-256 `02f4173eae039e69d3365442640f6868ec0b3250bde54df9174761c536f239d6`; screenshot e contesto nello stesso percorso.

Dopo il cleanup, `docker ps -a` mostra soltanto i tre container persistenti iniziali, con gli stessi ID: `magazzino-web` `310b9d2e4b0a`, `magazzino-api` `30a783d0da23`, `magazzino-postgres` `af6bd975d17d`. Rete `magazzino-solidale_default` e volumi `magazzino-solidale_magazzino_pgdata`/`magazzino-solidale_magazzino_uploads` preservati. Nessuna risorsa Docker R1 residua; nessun altro progetto toccato.

## Stato finale

Working tree intenzionalmente modificato/non staged, HEAD e remoto ancora alla SHA di base; nessun commit, staging, push, merge o deploy. `main` invariato. M5C2 non iniziata. Resta la validazione manuale di Floriano e il successivo ciclo di pubblicazione/review, fuori dal presente mandato.

**M5C1-R1 — ##test PASS TECNICO — IN ATTESA DI PUBBLICAZIONE E REVIEW.**
