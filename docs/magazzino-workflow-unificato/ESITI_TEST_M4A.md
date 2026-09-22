# M4A — Esiti della fase formale di test

Data: 19 settembre 2026

Stato: **NO-GO; candidato non committato e non pubblicato**.

## Base Git e candidato osservato

| Voce                   | Valore                                     |
| ---------------------- | ------------------------------------------ |
| branch                 | `codex/magazzino-workflow-unificato`       |
| HEAD locale iniziale   | `8df6b823bb14604af0123ea62ce7b237b32561c8` |
| HEAD remota dopo fetch | `8df6b823bb14604af0123ea62ce7b237b32561c8` |
| divergenza             | `0/0`                                      |
| `main` locale          | `8419dc7ff9d5177c39d90e66f04b19236021244d` |
| `origin/main`          | `787d7c5436d5fa4c0edb24be373d055946d402ce` |
| indice                 | nessuna modifica staged                    |
| commit M4A             | non creato                                 |
| push M4A               | non eseguito                               |

Il working tree di sviluppo è stato preservato. Il delta comprende 30 file
tracciati modificati e 22 file nuovi non tracciati prima di questi due report.
I file appartengono alle aree M4A, ma la revisione ha rilevato finding
bloccanti descritti in `REVISIONE_STATICA_M4A.md`.

## Ambiente

- Node.js `v22.23.2`; pnpm `10.34.5`.
- Docker è stato censito esclusivamente in lettura.
- I servizi protetti `magazzino-postgres`, `magazzino-api` e
  `magazzino-web` sono rimasti attivi; non sono stati riavviati, ricostruiti o
  migrati.
- Non sono stati creati container, reti, volumi o database M4A di test. Il
  NO-GO è emerso prima del gate PostgreSQL, evitando scritture e cleanup non
  necessari.
- Email, geocoding e altri servizi esterni non sono stati avviati.

## Comandi eseguiti

| Comando/attività                                                                                                                                                                                                                               | Risultato                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `git fetch origin codex/magazzino-workflow-unificato main --prune`                                                                                                                                                                             | superato; riferimenti invariati                        |
| inventario Git completo, staged/unstaged/untracked                                                                                                                                                                                             | superato                                               |
| `docker ps -a`, `docker network ls`, `docker volume ls`                                                                                                                                                                                        | sola lettura; nessuna risorsa M4A                      |
| conteggio migrazioni                                                                                                                                                                                                                           | 39 alla base, 40 nel working tree; prime 39 senza diff |
| `pnpm run typecheck`                                                                                                                                                                                                                           | PASS                                                   |
| `pnpm --filter @workspace/magazzino-solidale exec vitest run --config vitest.unit.config.ts src/lib/navigation-permissions.test.ts src/lib/moduli-servizi.test.ts src/lib/magazzino-hardening-ui.test.ts src/lib/emporio-bolla-stampa.test.ts` | **FAIL**: 4 file, 47 pass, 1 fail                      |
| `git diff --check` prima dei report                                                                                                                                                                                                            | PASS                                                   |

Failure osservata:

```text
navigation-permissions.test.ts > protegge trasferimenti con magazzino.view
expected undefined to be "magazzino.view"
```

Non sono state avviate suite complete, E2E, fresh o upgrade populated dopo
questa failure e i finding statici F1–F8. I risultati verdi dichiarati nella
fase di sviluppo non sono stati promossi a evidenza formale del candidato.

## Matrice M4A-T01–T32

Legenda: `FAIL` = controesempio/failure osservato; `PARZ` = evidenza limitata,
insufficiente al criterio; `NE` = non eseguito e quindi bloccante.

| ID  | Stato | Evidenza reale e limite                                                                                                                                              |
| --- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T01 | PARZ  | Vincolo esclusivo presente e un test HTTP combinato; assenti prove SQL isolate, riferimenti inesistenti completi e Magazzino come destinatario nella stessa matrice. |
| T02 | NE    | CRUD/scope/disattivazione e gara disattivazione-creazione non provati; nessuna versione/idempotenza Enti.                                                            |
| T03 | NE    | Nessun E2E logout/login/ripresa sui tre destinatari.                                                                                                                 |
| T04 | NE    | Regressione completa comune+Consegne e doppio ingresso non eseguita.                                                                                                 |
| T05 | PARZ  | Happy path API Ente presente; nessuna matrice completa bozza/conferma/replay/sociale.                                                                                |
| T06 | FAIL  | `CONSEGNA_ENTE` è positiva in `fseAccounting`; reporting/export fisico non coerente.                                                                                 |
| T07 | NE    | Nessun E2E UI comune completo Trasferimento.                                                                                                                         |
| T08 | NE    | Regressioni same/cross-Area non ripetute sul candidato.                                                                                                              |
| T09 | NE    | Lotto esplicito e fallimenti atomici non provati nel ramo Ente/comune.                                                                                               |
| T10 | NE    | FEFO/selettori/lotto produttore non provati sul candidato finale.                                                                                                    |
| T11 | NE    | Quantità e righe ripetute sotto lock non provate per M4A.                                                                                                            |
| T12 | NE    | Nessuna barriera deterministica su disponibilità/scadenza mutata.                                                                                                    |
| T13 | PARZ  | Codice di annullamento pre-uscita presente; replay e adapter legacy non provati.                                                                                     |
| T14 | FAIL  | Blocco post-uscita presente, ma il precedente storno amministrativo runtime non ha un comando sostitutivo.                                                           |
| T15 | FAIL  | Versione/idempotency/hash mancanti su Enti/Bolle e creazione Trasferimento.                                                                                          |
| T16 | NE    | Nessun E2E con risposta persa dopo commit.                                                                                                                           |
| T17 | NE    | Nessun test PostgreSQL con lock e rilettura autorevole.                                                                                                              |
| T18 | NE    | Nessuna concorrenza reale fra Beneficiario/Ente/Trasferimento/Scarico.                                                                                               |
| T19 | NE    | Nessuna matrice A/B/C e audit failure per i nuovi rami.                                                                                                              |
| T20 | NE    | Scope/revoca/replay/PDF non provati con sessioni e RBAC reali.                                                                                                       |
| T21 | FAIL  | Facciata UI richiede `bolle.view`; test navigazione Trasferimenti fallito.                                                                                           |
| T22 | FAIL  | Route e pagina comune impongono i moduli Bolle anche al consumer Trasferimento.                                                                                      |
| T23 | NE    | Nessuna collisione reale Bolla N/Trasferimento N.                                                                                                                    |
| T24 | FAIL  | Mancano Area/date/ricerca/tipo/ordinamento/export; stati UI solo Bolla.                                                                                              |
| T25 | FAIL  | Redirect conserva solo la query e non prova identità/deep link/draft/race scope.                                                                                     |
| T26 | FAIL  | Letture e PDF preferiscono dati Ente live agli snapshot congelati.                                                                                                   |
| T27 | NE    | Nessun PDF reale per tre destinatari, più pagine e ispezione layout.                                                                                                 |
| T28 | NE    | Nessun E2E M4A desktop/tablet emulato/tastiera/sei lingue.                                                                                                           |
| T29 | NE    | Consumer verticali completi non eseguiti; storno legacy non preservato.                                                                                              |
| T30 | NE    | Regressioni complete M1–M3 non eseguite sul candidato formale.                                                                                                       |
| T31 | NE    | Upgrade autentico populated 39→40 non eseguito.                                                                                                                      |
| T32 | FAIL  | Typecheck verde, ma test frontend fallito; fresh/suite/codegen/build/budget/runtime mancanti.                                                                        |

`NE-MAN-CAMERA` e `NE-MAN-TABLET` restano separati e non sono la causa del
NO-GO. Le prove mancanti sopra sono automatiche e obbligatorie.

## Gate G1–G8

| Gate | Esito           | Motivazione                                                                                               |
| ---- | --------------- | --------------------------------------------------------------------------------------------------------- |
| G1   | GO              | Branch/base/remoto verificati, main invariato, working tree atteso e preservato.                          |
| G2   | **NO-GO**       | F1–F8 includono reporting errato, guard incompatibili, comandi non idempotenti e snapshot non autorevoli. |
| G3   | **NO-GO**       | T01–T32 non coperti; più criteri hanno controesempi statici.                                              |
| G4   | **NO-GO**       | Primo set frontend pertinente: 1 test fallito; suite complete/E2E non eseguiti.                           |
| G5   | **NO-GO/NE**    | Fresh formale e upgrade populated 39→40 non eseguiti.                                                     |
| G6   | **NO-GO/PARZ**  | Typecheck e diff check verdi; codegen doppio, build, budget, runtime e formatter finali non eseguiti.     |
| G7   | GO per il NO-GO | I report descrivono il candidato senza attribuire validazione o chiusura M4A.                             |
| G8   | GO              | Nessuna risorsa test creata; ambiente persistente solo censito e non modificato.                          |

## Decisione

Non è stato eseguito alcun commit o push. La correzione richiede un nuovo ciclo
di hardening M4A, seguito dalla ripetizione integrale dei gate sul medesimo
candidato finale. M4B non è stato avviato.

## Correzioni post NO-GO — verifiche mirate

Data: 19 settembre 2026

Stato corrente:
**`DEV-M4A-CORRETTO/NE-TEST-M4A/NE-MAN`**.

Questa sezione è cronologicamente successiva al rapporto NO-GO sopra
riportato, che resta intatto e valido come esito dell'ultima fase formale. Le
prove seguenti dimostrano il lavoro correttivo sul working tree, ma non
rivalutano automaticamente T01–T32 o G1–G8, non costituiscono un nuovo
`##test M4A` e non autorizzano commit o push.

### Base e confine

| Voce                   | Valore                                                        |
| ---------------------- | ------------------------------------------------------------- |
| branch                 | `codex/magazzino-workflow-unificato`                          |
| base pubblicata        | `8df6b823bb14604af0123ea62ce7b237b32561c8`                    |
| indice                 | nessuna modifica staged                                       |
| commit/push correttivo | non eseguiti                                                  |
| review conclusiva      | nessun blocker residuo rilevato nel perimetro M4A             |
| stato formale          | `NE-TEST-M4A`; i gate storici non sono stati convertiti in GO |
| validazione manuale    | `NE-MAN`                                                      |

### Esecuzioni sul delta corretto

| Ambito                                    | Esito                                                                                                     | Limite formale                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| primo avvio fresh conclusivo              | non eseguito: connessione locale bloccata dal sandbox con `connect EPERM`, prima di creare fixture        | stesso comando ripetuto con accesso locale autorizzato      |
| fresh DB `magazzino_m4a_correction_final` | PASS: 40/40 migrazioni, seed, smoke, replay e verify                                                      | prova mirata finale, non G5 formale                         |
| upgrade autentico populated 39→40         | PASS nella fase correttiva, distinto dal fresh                                                            | da ripetere/ricontrollare nel nuovo `##test`                |
| primo backend coordinato post-hardening   | FAIL: 3/11 file, 267/273 test PASS; 6 failure su replay concorrente Bolle/Consegne e compatibilità Mensa  | failure usate per correggere codice e fixture, non nascoste |
| backend coordinato                        | PASS: 11 file, 273 test                                                                                   | batteria mirata ai consumer corretti                        |
| Mensa isolata                             | PASS: 72/72 test                                                                                          | verifica di compatibilità dell'adapter                      |
| Bolle isolata                             | PASS: 2 file, 57 test                                                                                     | verifica mirata Bolle/Consegne/storni/concorrenza           |
| frontend completo                         | PASS: 74 file, 408 test                                                                                   | prova automatica, non validazione manuale                   |
| Playwright desktop                        | primo run FAIL per locator ambiguo; dopo la correzione puntuale, rerun 3/3 PASS                           | percorso mirato; il FAIL iniziale non è cancellato          |
| percorso E2E Beneficiario                 | PASS: retry dopo risposta persa senza duplicazione                                                        | da ripetere nel ciclo formale                               |
| percorso E2E Ente                         | PASS: snapshot congelato e fallback legacy                                                                | da ripetere nel ciclo formale                               |
| percorso E2E Trasferimento                | PASS: facciata comune e conservazione del draft                                                           | da ripetere nel ciclo formale                               |
| PDF reale Ente                            | PASS: A4, una pagina, 3,2 MiB; snapshot A presente e dato live B assente; render leggibile e non tagliato | prova visiva mirata, validazione Floriano ancora `NE-MAN`   |
| codegen                                   | PASS: due generazioni, 842 file byte-identici                                                             | nessuna modifica manuale rivendicata ai generated           |
| installazione dipendenze                  | primo tentativo abortito senza TTY; rerun `CI=true --frozen-lockfile --offline` PASS, lockfile invariato  | nessun download o cambio versione                           |
| workspace typecheck                       | PASS                                                                                                      | prova tecnica correttiva                                    |
| migration runner                          | PASS: 10/10                                                                                               | prova tecnica correttiva                                    |
| build API                                 | PASS                                                                                                      | prova tecnica correttiva                                    |
| build frontend                            | PASS con warning sourcemap/chunk non bloccanti                                                            | warning conservati, non nascosti                            |
| budget frontend                           | PASS: 1306,8 KiB / 361,4 KiB gzip                                                                         | prova tecnica correttiva                                    |
| Prettier del delta non generato           | PASS; i generated restano output del codegen ufficiale e non sono stati editati manualmente               | controllo meccanico finale                                  |
| `git diff --check`                        | PASS                                                                                                      | controllo meccanico finale                                  |
| processi API/frontend temporanei          | porte 18181 e 4173 chiuse                                                                                 | nessun aggiornamento del runtime persistente                |

Il laboratorio PostgreSQL e gli output temporanei sono descritti in
`AMBIENTE_TEST.md`. Il cleanup finale nominativo del container e degli output
PDF/render/Playwright è completato e verificato; nessuna risorsa persistente è
stata modificata.

### Lettura correttiva della matrice M4A-T01–T32

Legenda locale: `PASS-MIRATO` indica evidenza eseguita nella fase correttiva,
non un gate formale; `PARZ-MIRATO` indica copertura utile ma da completare o
ripetere nel nuovo `##test`; `NE-FORMALE` ricorda che la rivalutazione formale
non è ancora avvenuta.

| ID  | Evidenza post-NO-GO                                                                                                                                                                      | Stato della fase correttiva |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| T01 | Vincoli destinatario e riferimenti sono coperti dalla batteria backend corretta e dal fresh 40/40.                                                                                       | PASS-MIRATO / NE-FORMALE    |
| T02 | CRUD, scope, disattivazione e replay Ente rientrano nella batteria backend coordinata.                                                                                                   | PASS-MIRATO / NE-FORMALE    |
| T03 | E2E copre logout/login e ripresa Beneficiario, oltre ai dettagli Ente e Trasferimento; non copre ancora ripresa e dirty guard di una bozza Ente non vuota per tutti e tre i destinatari. | PARZ-MIRATO / NE-FORMALE    |
| T04 | Consumer Bolle/Consegne e ingressi adattati coperti dalle suite coordinate e isolate.                                                                                                    | PASS-MIRATO / NE-FORMALE    |
| T05 | Happy path e ciclo Ente coperti da backend, E2E e PDF reale.                                                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T06 | `CONSEGNA_ENTE` è verificata come uscita fisica senza incremento dei conteggi sociali.                                                                                                   | PASS-MIRATO / NE-FORMALE    |
| T07 | E2E Trasferimento dalla facciata comune passa nel rerun 3/3.                                                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T08 | Same/cross Area e ricezione Trasferimento rientrano nella suite backend corretta.                                                                                                        | PASS-MIRATO / NE-FORMALE    |
| T09 | Lotto esplicito e rollback atomico sono esercitati nei test backend pertinenti.                                                                                                          | PASS-MIRATO / NE-FORMALE    |
| T10 | FEFO e selezione lotti sono coperti dai test Trasferimenti/Bolle coordinati.                                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T11 | Quantità, righe ripetute e pre-lock globale sono coperte dalla batteria concorrenza.                                                                                                     | PASS-MIRATO / NE-FORMALE    |
| T12 | Lock, rilettura e mutazione concorrente sono coperti con prove PostgreSQL deterministiche.                                                                                               | PASS-MIRATO / NE-FORMALE    |
| T13 | Annullamento pre-uscita, motivo e replay sono coperti dalla suite Bolle isolata.                                                                                                         | PASS-MIRATO / NE-FORMALE    |
| T14 | Storno amministrativo distinto, auditato e con rollback è coperto dalla suite Bolle.                                                                                                     | PASS-MIRATO / NE-FORMALE    |
| T15 | Chiave, hash semantico, versione e ricevuta comune sono coperti per i comandi adattati.                                                                                                  | PASS-MIRATO / NE-FORMALE    |
| T16 | L'E2E Beneficiario copre risposta persa e retry della creazione Bolla con la stessa intenzione; i comandi versionati successivi non sono ancora attraversati dallo stesso fault E2E.     | PARZ-MIRATO / NE-FORMALE    |
| T17 | Le suite backend coprono lock e rilettura autorevole nella stessa transazione.                                                                                                           | PASS-MIRATO / NE-FORMALE    |
| T18 | Concorrenza documentale/inventariale e ordine globale dei lock sono coperti dai test mirati.                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T19 | Audit obbligatorio, rollback e snapshot sono coperti dalle suite backend isolate/coordinate.                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T20 | Scope corrente prima del replay e revoca sono verificati nei test autorizzativi.                                                                                                         | PASS-MIRATO / NE-FORMALE    |
| T21 | La regressione `magazzino.view` è corretta senza concedere mutazioni Bolle.                                                                                                              | PASS-MIRATO / NE-FORMALE    |
| T22 | Filtri per ramo/modulo/scope precedono conteggio, paginazione ed export.                                                                                                                 | PASS-MIRATO / NE-FORMALE    |
| T23 | Identità composta Bolla/Trasferimento e collisione ID sono coperte dai test URL/frontend.                                                                                                | PASS-MIRATO / NE-FORMALE    |
| T24 | Filtri, ordinamento, totale ed export comuni sono coperti dalla batteria backend/frontend.                                                                                               | PASS-MIRATO / NE-FORMALE    |
| T25 | Redirect/deep link/draft e protezione da risposte tardive sono coperti da frontend ed E2E.                                                                                               | PASS-MIRATO / NE-FORMALE    |
| T26 | Snapshot congelato A prevale sul live B; il fallback legacy resta esplicito.                                                                                                             | PASS-MIRATO / NE-FORMALE    |
| T27 | PDF reale A4 verificato per testo e render; la matrice completa dei documenti sarà ripetuta formalmente.                                                                                 | PARZ-MIRATO / NE-FORMALE    |
| T28 | E2E desktop 3/3 e frontend completo sono verdi; tablet emulato, tastiera, sei lingue, dispositivi fisici e validazione umana restano non eseguiti.                                       | PARZ-MIRATO / NE-FORMALE    |
| T29 | Consumer verticali, Mensa e storno amministrativo sono coperti dalle suite coordinate/isolate.                                                                                           | PASS-MIRATO / NE-FORMALE    |
| T30 | Frontend completo è verde; le regressioni API selezionate sono verdi, ma la certificazione completa M1–M3 appartiene al nuovo `##test`.                                                  | PARZ-MIRATO / NE-FORMALE    |
| T31 | Upgrade autentico populated 39→40 e fresh finale 40/40 sono verdi.                                                                                                                       | PASS-MIRATO / NE-FORMALE    |
| T32 | Codegen, typecheck, runner, build e budget sono verdi; warning FE registrati.                                                                                                            | PASS-MIRATO / NE-FORMALE    |

### Decisione dopo la correzione

Il working tree è predisposto per un nuovo `##test M4A`, ma non è stato
pubblicato. Il NO-GO storico non viene cancellato; G1–G8 non sono rivalutati in
questa fase, lo stato resta `NE-TEST-M4A` e la validazione manuale resta
`NE-MAN`. Nessun commit, staging per pubblicazione, push, aggiornamento del
Docker persistente o avvio di M4B è stato eseguito.

## Rerun formale finale post-correzione NO-GO

Data: 22 settembre 2026. Questa sezione è successiva al NO-GO storico e alla
fase correttiva sopra descritti; non li cancella. Il candidato finale parte da
`8df6b823bb14604af0123ea62ce7b237b32561c8`, sul solo branch
`codex/magazzino-workflow-unificato`. Dopo `git fetch` del solo branch, HEAD e
`origin/codex/magazzino-workflow-unificato` sono ancora coincidenti (divergenza
`0/0`); `main` non è stato modificato.

### Failure incontrate e correzioni nel rerun

| Failure                                                                           | Diagnosi verificata                                                                                                                  | Correzione e controprova                                                                                                                        |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Il vecchio E2E Trasferimento cercava direttamente il form e le azioni nella riga. | M4A introduce la scelta del tipo documento e colloca Avvia/Ricevi nel dettaglio comune; lo snapshot Playwright mostrava la nuova UI. | Adattato solo `e2e/magazzino-workflows.spec.ts`; il percorso completo richiesto → in transito → ricevuto passa isolato e nella suite completa.  |
| Il test M3B di risposta interrotta vedeva temporaneamente zero righe.             | Nel trace il GET iniziava prima della risposta `201` del POST intercettato; la risposta applicativa riportava `addedRows: 1`.        | Il test attende il dato persistito con `expect.poll`; caso isolato e suite completa verdi. Nessuna modifica al flusso applicativo M3B.          |
| Una run completa non leggeva l'Excel originale.                                   | Nel comando di prova era stato scritto `in Moto` invece del nome reale `in_Moto`; errore `ENOENT` prima della lettura.               | Verificati esistenza e SHA-256 dei due allegati, ripetuto il caso reale isolato e poi l'intera suite su un database pulito con percorsi esatti. |

Anche il controllo API post-formattazione ha conservato la cronologia dei
tentativi: una prima run aveva 1263 pass ma quattro suite non importabili
perché il comando ometteva `SESSION_SECRET`; una successiva aveva 1307 pass e
un test M2 audit fallito perché la query del test non dichiarava `ORDER BY`.
L'ordinamento per ID append-only è stato aggiunto soltanto al test; il caso M2
mirato passa 14/14. Un ulteriore run aveva 1307 pass e un `socket hang up`
Supertest nel caso Mensa, che passa isolato 72/72 sul medesimo database; non
è stato cambiato codice applicativo. La run API finale, con secret di test e
due Excel originali, è verde: 116 file, 1308 pass e 2 skip opzionali.

Nessun tentativo fallito è stato promosso a PASS. Le run finali E2E e API sono
integrali e verdi con database disposable separati; Playwright è stato
eseguito senza retry.

### Evidenze automatiche finali

| Gate tecnico                                                                      | Esito finale                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile --offline` con `CI=true`                          | PASS; lockfile invariato. Warning `core-js` per build script ignorato.                                                                                                                                                                                                                                                                       |
| API completa, Vitest sequenziale con PostgreSQL disposable e i due XLSX originali | 116 file; **1308 pass**, 2 skip opzionali AGEA che richiedono `acceptancePath`; nessuna failure.                                                                                                                                                                                                                                             |
| Frontend completo                                                                 | 74 file; **408/408 pass**.                                                                                                                                                                                                                                                                                                                   |
| Playwright completo, cinque viewport, `--retries=0`                               | **66 pass**, 99 skip previsti dalla selezione dei progetti, 0 fail e 0 non eseguiti per interruzione; include M4A, M3B e regressioni storiche.                                                                                                                                                                                               |
| Fresh PostgreSQL                                                                  | 40/40 migrazioni, seed, login/cambio password, CRUD smoke, replay 40 skipped, verify/status senza anomalie.                                                                                                                                                                                                                                  |
| Upgrade autentico populated 39→40                                                 | Base HEAD archiviata con 39/39; fixture Bolla, Trasferimento, pratica M3A, import M3B, movimenti e audit; applicata solo migrazione 40. Impronte MD5 di 18 tabelle preesistenti identiche prima/dopo; default legacy Bolla non inventa snapshot, FK integre; replay/verify verdi. Nessun `push` dello schema sul popolato.                   |
| Runner migrazioni                                                                 | 24/24 pass (10 manifest/unità, 14 PostgreSQL), incluso ordine, rollback, checksum e lock. Le prime 39 migrazioni restano senza diff.                                                                                                                                                                                                         |
| Codegen OpenAPI                                                                   | Due generazioni ufficiali consecutive, 843 file generati con hash-manifest identico `18ffdaea5b640ab4ade38c6be78479bee77e248f971bed9aacf93510059ce758`; nessuna modifica manuale ai generated.                                                                                                                                               |
| Typecheck workspace e build workspace                                             | PASS. Vite segnala sourcemap/chunk grandi non bloccanti; il budget dedicato resta PASS (entry 1306,8 KiB, 361,3 KiB gzip).                                                                                                                                                                                                                   |
| Runtime WEB                                                                       | `scripts/test-web-runtime-config.sh`: PASS.                                                                                                                                                                                                                                                                                                  |
| PDF reali                                                                         | Beneficiario bozza/confermata FEFO/multipagina, Ente bozza/confermata, Trasferimento bozza/in transito FEFO. Sette PDF A4; il caso da 60 righe occupa tre pagine. Testo, due lotti/fondi FEFO, snapshot e layout controllati con estrazione e render Poppler; stampa senza movimento di stock. Output temporanei eliminati dopo l'ispezione. |
| Hygiene                                                                           | Prettier e `git diff --check` sul candidato finale; nessuna credenziale, `.env`, screenshot, log o output temporaneo da pubblicare.                                                                                                                                                                                                          |

### Matrice T01–T32 rivalutata

`OK-AUTO-M4A` significa requisito implementato e prova automatica pertinente
eseguita, non validazione manuale. Le evidenze sono nei test API, frontend ed
E2E sopra; gli allegati PDF sono stati generati, ispezionati e rimossi come
output disposable. I casi reali di fotocamera e tablet fisico rimangono
`NE-MAN-CAMERA` e `NE-MAN-TABLET` e non bloccano il gate automatico.

| ID  | Stato              | Evidenza distintiva                                                                                                       |
| --- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| T01 | OK-AUTO-M4A        | Vincoli destinatario/FK SQL e riferimenti inesistenti, suite API e fresh.                                                 |
| T02 | OK-AUTO-M4A        | CRUD, scope, disattivazione e replay Enti nella suite API.                                                                |
| T03 | OK-AUTO-M4A        | E2E logout/login e ripresa dei tre tipi; Ente da bozza vuota e poi non vuota con dirty guard.                             |
| T04 | OK-AUTO-M4A        | Due ingressi Bolle/Consegne e regressioni coordinate API/frontend.                                                        |
| T05 | OK-AUTO-M4A        | Ciclo bozza/conferma Ente, replay, PDF e assenza di effetto sociale inventato.                                            |
| T06 | OK-AUTO-M4A        | `CONSEGNA_ENTE` uscita fisica corretta in ledger, reporting ed export.                                                    |
| T07 | OK-AUTO-M4A        | Trasferimento E2E dalla facciata comune fino alla ricezione.                                                              |
| T08 | OK-AUTO-M4A        | Same/cross Area, FEFO e ricezione nei test Trasferimenti.                                                                 |
| T09 | OK-AUTO-M4A        | Lotto esplicito e fallimenti atomici nei test DB.                                                                         |
| T10 | OK-AUTO-M4A        | FEFO e lotto produttore in API e PDF reale.                                                                               |
| T11 | OK-AUTO-M4A        | Quantità, righe ripetute e lock globale nei test DB.                                                                      |
| T12 | OK-AUTO-M4A        | Barriere PostgreSQL deterministiche su disponibilità/scadenza mutate.                                                     |
| T13 | OK-AUTO-M4A        | Annullamento ordinario pre-uscita e replay.                                                                               |
| T14 | OK-AUTO-M4A        | Storno amministrativo separato, autorizzato, auditato e rollback.                                                         |
| T15 | OK-AUTO-M4A        | Chiave/hash/versione/ricevuta sui comandi comuni e legacy.                                                                |
| T16 | OK-AUTO-M4A        | Risposta persa E2E sia su creazione sia su conferma Bolla versionata; retry stessa intenzione, una sola prenotazione.     |
| T17 | OK-AUTO-M4A        | Rilettura autorevole sotto lock nella stessa transazione.                                                                 |
| T18 | OK-AUTO-M4A        | Concorrenza documentale/inventariale e ordine dei lock.                                                                   |
| T19 | OK-AUTO-M4A        | Audit obbligatorio, snapshot e rollback su fallimento.                                                                    |
| T20 | OK-AUTO-M4A        | Sessione/scope/permessi correnti prima del replay e revoca.                                                               |
| T21 | OK-AUTO-M4A        | `magazzino.view` senza abilitazione indebita dei comandi Bolle.                                                           |
| T22 | OK-AUTO-M4A        | Filtri modulo/scope per ramo prima di conteggio/export.                                                                   |
| T23 | OK-AUTO-M4A        | Collisione ID Bolla/Trasferimento con identità URL composta.                                                              |
| T24 | OK-AUTO-M4A        | Lista, filtri, ordinamento, paginazione ed export comuni.                                                                 |
| T25 | OK-AUTO-M4A        | Deep link/redirect/refresh, draft e protezione da risposte tardive.                                                       |
| T26 | OK-AUTO-M4A        | Snapshot Ente congelato prevale sul live; fallback legacy esplicito.                                                      |
| T27 | OK-AUTO-M4A        | Sette PDF reali, FEFO/fondo, tre destinatari, bozza/stati e tre pagine per 60 righe.                                      |
| T28 | OK-AUTO-M4A/NE-MAN | E2E desktop, tablet emulato portrait/landscape, tastiera/touch, sei lingue e RTL; tablet fisico/fotocamera ancora NE-MAN. |
| T29 | OK-AUTO-M4A        | Consumer verticali e regressione Mensa/storno incluse nella suite completa.                                               |
| T30 | OK-AUTO-M4A        | API 1308 pass, frontend 408 pass, E2E 66 pass con originali M3B.                                                          |
| T31 | OK-AUTO-M4A        | Fresh e upgrade populated autentico 39→40 con impronte legacy identiche.                                                  |
| T32 | OK-AUTO-M4A        | Runner, codegen deterministico, typecheck, build, budget, runtime e hygiene.                                              |

### Gate G1–G8 sul candidato finale

| Gate | Esito | Fondamento                                                                                                                                           |
| ---- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | GO    | Branch corretto, base/remoto `0/0`, indice non staged prima della pubblicazione, nessuna modifica a main.                                            |
| G2   | GO    | F1–F8 chiusi come documentato nella revisione statica finale; delta riesaminato, senza refactoring estraneo.                                         |
| G3   | GO    | T01–T32 coperti automaticamente; prove fisiche/manuali separate e non dichiarate superate.                                                           |
| G4   | GO    | API/frontend/E2E completi e verdi sul codice finale.                                                                                                 |
| G5   | GO    | Fresh, upgrade populated 39→40 e runner ufficiale verdi.                                                                                             |
| G6   | GO    | Codegen byte-identico, typecheck, build, budget, runtime, Prettier e diff check verdi.                                                               |
| G7   | GO    | NO-GO e failure intermedie conservati; avanzamento/matrice/ambiente aggiornati senza attribuire validazione umana.                                   |
| G8   | GO    | Tre PostgreSQL M4A disposable rimossi nominativamente con dati tmpfs; nessuna rete/volume M4A creata; Docker persistente e altri progetti invariati. |

La decisione è **GO per i test automatici M4A**, non per la validazione
manuale. Lo stato da pubblicare è `OK-M4A/NE-MAN`; la code review ChatGPT e
l'eventuale prova umana sono fasi successive. M4B non è iniziata e il Docker
locale persistente non è stato aggiornato.
