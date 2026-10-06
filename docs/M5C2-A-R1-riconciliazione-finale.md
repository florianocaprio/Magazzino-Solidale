# M5C2-A-R1 — test di riconciliazione finale

Data: 6 ottobre 2026. Branch `codex/magazzino-workflow-unificato`, HEAD `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`. Candidato: HEAD più tutto il working tree M5C2-A/R2.1/R1, inclusi i nuovi file. Rapporti precedenti conservati senza modifiche. Nessuna modifica applicativa, a schema, migration, OpenAPI o generati durante questa fase.

## Contratto usato per riconciliare

Il mandato M5C2-A e `docs/M5C2-A-handoff-bolla-pronta.md` stabiliscono che il Magazzino prepara la Bolla sociale, il Centro crea la pianificazione e la Consegna usa il motore M4. I comandi diretti di affidamento/consegna/conversione della Bolla collegata a Richiesta beneficiario non devono anticipare quel percorso. Alla consegna la Richiesta si chiude, senza concludere o duplicare l'Intervento. Il ramo Ente conserva il ciclo fisico M4. Quindi un semplice cambio di assert da 200 a 409 avrebbe perso le prove positive di autorizzazione e contabilità: la riconciliazione le mantiene su percorsi validi.

## Analisi delle nove failure

Evidenza iniziale: `/private/tmp/m5c2a-r1-api-final-20261006.json`, 1489 PASS, 9 FAIL, 4 SKIP. Le otto failure deterministiche terminavano tutte con il conflitto M5C2-A prima dell'operazione positiva attesa; i dinieghi di autorizzazione precedenti passavano.

| Caso                                                                  | Causa e classificazione                                                                                                                                                          | Riconciliazione / prova conservata                                                                                                                                                                                                                                                | Rerun singolo |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `m5b-r3-guardie-post-preparazione`, R3-B                              | Test storico incompatibile: dopo ripristino scope pretendeva Affida diretto su Bolla sociale                                                                                     | Ciclo fisico e replay sulla Bolla Ente collegata; conversione fuori scope ancora provata su Bolla beneficiario. Digest senza effetti e revoca stessa/nuova sessione conservati                                                                                                    | PASS          |
| stesso file, R3-G                                                     | Test storico incompatibile: scambiava il nuovo conflitto di workflow per diniego del grant                                                                                       | Positivi Affida Ente/Avvia Trasferimento, senza `prepare`; conservati casi Area/Centro incoerenti o inattivi, grant rimossi, utente disattivato/senza ruolo                                                                                                                       | PASS          |
| stesso file, R3-ADMIN                                                 | Test storico incompatibile: un admin globale non può bypassare il nuovo handoff sociale                                                                                          | Ente collegato per il positivo M4; admin assegnato resta scoped, globale esplicito opera senza territorio                                                                                                                                                                         | PASS          |
| stesso file, R3-D                                                     | Test storico incompatibile: consegna diretta sociale vietata                                                                                                                     | Pianificazione Centro tramite API, completamento Consegna, Bolla consegnata; revoca nega replay e storno, ripristino consente storno                                                                                                                                              | PASS          |
| stesso file, R3-PLAN                                                  | Test storico incompatibile: conversione M4 diretta non è più il canale sociale                                                                                                   | Ritiro non effettuato ancora registrabile; conversione 409 con motivo Centro; nuova pianificazione ufficiale 201 e ID reale                                                                                                                                                       | PASS          |
| stesso file, R3-RACE                                                  | Test storico incompatibile: il ramo comando-prima raggiungeva il divieto sociale invece dell'Affida positivo                                                                     | Ente collegato; stessi lock PostgreSQL osservabili, revoca-prima, comando-prima, rollback, digest e replay dopo revoca                                                                                                                                                            | PASS          |
| `richieste-magazzino-m5b`, LEDGER-M5B-DIRECT                          | Test storico incompatibile: consegna diretta sociale e aspettativa Richiesta ancora presa in carico                                                                              | Diniego diretto esplicito; attore Centro separato (operatore Magazzino non promosso), pianificazione e completamento. Stock 20→14, prenotazioni 6→0, un movimento anche dopo replay, link conservato, Richiesta chiusa, secondo documento negato, Intervento originale preservato | PASS          |
| stesso file, LEDGER-M5B-RETURN                                        | Test storico incompatibile: affidamento diretto del beneficiario non consentito dal nuovo handoff                                                                                | Ente collegato per il ciclo M4 ancora previsto. Stock 10→6→9, 3 idonee + 1 mancante, movimenti di affidamento/rientro unici, link corrente e divieto secondo documento conservati                                                                                                 | PASS          |
| `audit-centro-ascolto-hardening`, terminali immutabili/versione PATCH | Failure intermittente di trasporto: `socket hang up`, senza risposta HTTP/assert applicativo. Causa di basso livello non determinata; non è provata una regressione del prodotto | Nessuna modifica, skip o retry al test; rerun singolo e intero file nel gruppo correlato verdi. Restano intatti assert 400/409/200, versionamento e immutabilità                                                                                                                  | PASS          |

Nuovo test complementare `R3-SOCIAL-HANDOFF`: su sessione reale verifica 409 e motivo Centro per Affida/Consegna diretti, assenza di effetti, diniego della nuova pianificazione dopo rimozione Area/Centro o grant correnti, ripristino e pianificazione riuscita. Non elimina la copertura sociale trasferendo indiscriminatamente tutto su Ente.

Durante l'adeguamento R3-B sono emersi due errori del solo harness: indirizzo obbligatorio omesso nella nuova fixture Ente; conversione personale erroneamente tentata sull'Ente invece che sul beneficiario. Corrette le fixture e la selezione del destinatario del test. Conservati i log dei tentativi; nessun assert RBAC indebolito. La fixture usa dati sintetici nel solo DB effimero.

## Sequenza ed evidenze

1. Git verificato in sola lettura; staging vuoto; candidato locale preservato.
2. PostgreSQL 16 effimero `magazzino-m5c2a-reconcile-db-20261006`, `--rm`, tmpfs, nessun volume. Database diagnostico `m5c2a_reconcile`, porta localhost 61882; bootstrap su database vuoto e runner ufficiale: 46 applicate, 0 pendenti.
3. Rerun singoli dei nove casi, con filtri nominativi. I test esclusi dal filtro sono segnalati come skipped da Vitest solo in questi run mirati: non sono nuovi skip nel codice.
4. Rerun del nuovo test sociale: PASS.
5. Gruppo correlato single-worker: **8 file / 163 test PASS**, nessun fallimento. Include M5B documenti, R2/R3, audit Centro, M5C2-A, R1, Bolle/prenotazioni e Trasferimenti.
6. Secondo database indipendente e vuoto `m5c2a_reconcile_final`, nello stesso container effimero, riservato al run completo. Bootstrap ufficiale fresh e 46/46 migration prima di qualsiasi test.
7. Suite API completa con `vitest run --maxWorkers=1`, configurazione `fileParallelism: false`; nessun riuso del DB diagnostico.

Evidenze: `/private/tmp/m5c2a-reconcile-R3-*.log`, `m5c2a-reconcile-LEDGER-M5B-*.log`, `m5c2a-reconcile-audit-single.log`, `m5c2a-reconcile-social-added.log`, `m5c2a-reconcile-group.{log,json}`, `m5c2a-reconcile-full.{log,json}`, bootstrap e typecheck con lo stesso prefisso. Nessun log o credenziale nel repository.

## Quattro skip preesistenti

Non modificati né aggiunti. Dipendono da originali esterni al repository non configurati per questa prova:

- `agea-import.test.ts`: bootstrap registro reale, sette righe; `AGEA_ACCEPTANCE_XLSX`.
- `agea-sifead-parser.test.ts`: acceptance aggregati registro reale; `AGEA_ACCEPTANCE_XLSX`.
- `fse-import-parser-m3b.test.ts`: T01/T04/T06 originali registro/giacenza; `FSE_REGISTRY_ORIGINAL_PATH` e `FSE_STOCK_ORIGINAL_PATH`.
- `fse-import-practice-m3b.test.ts`: T25 sette saldi/1177 pezzi/80 carichi; stesse due variabili FSE.

Questi quattro casi non sono dichiarati eseguiti. Non appartengono alle nove failure di riconciliazione.

## File modificati da questa fase

- `artifacts/api-server/tests/m5b-r3-guardie-post-preparazione.test.ts`.
- `artifacts/api-server/tests/richieste-magazzino-m5b.test.ts` (preservando il delta R1 preesistente).
- Questo rapporto nuovo.

Fingerprint iniziale e finale dei sorgenti API/frontend e `lib` (tracked e untracked, contenuti SHA-256): **identico**, `861cb05ce98ef3c9af39cbf5d15b1099eeb9b5e7f73570757761394b8e661023`. Typecheck workspace, Prettier sui file modificati e `git diff --check`: PASS. Nessun commit, staging, push, merge o deploy. Main e Docker/database persistenti fuori perimetro.

## Esito finale: PASS della riconciliazione

Suite completa sul database fresh separato: **131 file PASS, 1499 test PASS, 0 FAIL, 4 SKIP, totale 1503**, durata 213,12 secondi. Codice uscita 0 e JSON `success: true`. Il totale cresce di un test rispetto ai 1502 iniziali per la nuova regressione sociale complementare. Gli otto casi storici passano aggiornati; il nono caso socket passa senza modifiche sia singolarmente sia nel gruppo sia nella suite completa. Non è stata usata una policy retry, né aggiunto uno skip, né rimosso un test. La causa precisa della precedente interruzione socket resta non riprodotta: il PASS attesta questo candidato e questo run, non una diagnosi certa del trasporto precedente.

Ledger finale verificato nel solo DB effimero: `m5c2a_reconcile_final|46`. Cleanup completato: container `magazzino-m5c2a-reconcile-db-20261006` verificato con `mounts=[]` e `AutoRemove=true`, fermato e rimosso automaticamente. Eliminati con il tmpfs entrambi i database di test. Nessun volume, rete o immagine dedicati creati; immagine PostgreSQL preesistente conservata. Nessun prune o comando distruttivo globale. I tre container persistenti restano gli stessi (`magazzino-web` ad4578e60527, `magazzino-api` d376cbbd766b, `magazzino-postgres` af6bd975d17d), non ricreati né interrogati come database.

Git finale: branch corretto; HEAD e tracking remoto `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`; staging vuoto; working tree intenzionalmente modificato e preservato, con il delta dei due test e questo rapporto aggiunti. Main locale `8419dc7ff9d5177c39d90e66f04b19236021244d` e `origin/main` `787d7c5436d5fa4c0edb24be373d055946d402ce` invariati. Nessun fetch, commit, push, merge o deploy eseguito.

**M5C2-A-R1 — RICONCILIAZIONE API PASS — WORKING TREE PRESERVATO, NON PUBBLICATO.** Questo esito non sostituisce una validazione manuale o autorizza autonomamente un deploy.
