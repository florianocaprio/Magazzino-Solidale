# M5A — rapporto `##test` su PostgreSQL effimero

Esito: **M5A — `##test` PARZIALE/BLOCCATO**. L'upgrade autentico dello schema completo 42→43 e le verifiche PostgreSQL/API/frontend sotto elencate sono passati. Build WEB, budget bundle ed E2E browser non sono stati superati per una dipendenza nativa LightningCSS assente nell'ambiente locale. Nessun commit, push, merge o deploy è autorizzato da questo risultato; la validazione manuale resta da eseguire.

## Candidato e isolamento

- Branch: `codex/magazzino-workflow-unificato`; HEAD/base locale e riferimento remoto letti: `07bd2c676eb247a759d39a5af2dede13fc13e50e`. Il candidato è **HEAD + delta M5A non committato**, inclusi i nuovi file.
- Le 42 migration SQL storiche e il manifest legacy coincidono con la base; `20260925_m5a_richieste_magazzino.sql` è l'unica nuova migration. Nessun file SQL storico è stato riscritto.
- Il prompt precedente `Prompt_Codex_M5A_TEST_Magazzino_Solidale.md` non era disponibile sul disco al momento della ripresa. Sono stati consultati il prompt di ripresa PostgreSQL effimero, il prompt M5A di sviluppo, l'handoff e `docs/M5A-richieste-magazzino.md`; non si attribuiscono al documento mancante prove non eseguite.
- Ambiente test: solo `postgres:16-alpine`, image ID `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, PostgreSQL `16.15`, Docker client/server `29.5.3`, contesto locale `desktop-linux`; sessione `d214b8860a51`, rete bridge dedicata e container dedicato, mapping `127.0.0.1:53316`, dati PostgreSQL su tmpfs, nessun volume o mount del repository. Identità verificata con ID container/rete, label, endpoint, DB allowlisted, utente, system identifier e marker di sessione. I segreti sono in un file temporaneo `0600`, non in questo rapporto.
- DB principali: `m5a_upgrade_d214b8860a51` e `m5a_fresh_d214b8860a51`. DB aggiuntivi `m5a_runner_d214b8860a51` e `m5a_reduced_d214b8860a51` sono stati creati e rimossi dai rispettivi test. Nessun accesso al Compose o al DB/volumi persistenti.
- Un primo tentativo di setup della sessione `aae78959c299` è stato fermato da una guardia harness troppo restrittiva sui metadati tmpfs: Docker esponeva il tmpfs in `HostConfig.Tmpfs`, ma non in `.Mounts`. Il container e la rete esatti di quel tentativo sono stati rimossi dopo verifica dell'identità. La sessione successiva ha verificato anche il mount effettivo in `/proc/mounts`.
- Il primo fresh è stato fermato dalla guardia perché il marker tecnico iniziale era uno schema extra, mentre il fresh canonico richiede uno schema applicativo vuoto. Dopo verifica dell'istanza il marker è stato spostato nel commento del DB, separato dal dominio; il fresh è stato ripetuto integralmente. Nessun assert di dominio o migration è stato indebolito.

## Upgrade popolato 42→43

La SHA base è stata estratta con `git archive` in una directory temporanea, senza checkout. Solo i sorgenti e lo schema della base hanno creato lo schema del DB upgrade vuoto; il runner storico ha applicato 42 migration. Il ledger risultava a 42, senza pending rispetto alla base e senza `richieste_magazzino`.

Sono stati inseriti dati **sintetici** conformi alla versione 42 in 19 delle 123 tabelle pubbliche: due Aree/Centri, utenti e ruoli standard/custom, Beneficiari, Interventi sociali/UDS/materiali, lotti e movimenti, Bolla/righe/prenotazioni, Consegna e Trasferimenti in stati pertinenti. È stato acquisito lo snapshot ordinato con conteggi e SHA-256 del contenuto di tutte le 123 tabelle, comprensivo di quantità decimali esatte (residuo lotto `8.000000`), stati, riferimenti, versioni e timestamp.

Il runner corrente ha applicato **solo** la nuova migration (`applied=1`, `skipped=42`), ottenendo ledger 43 e tabella richieste vuota. Il confronto del contenuto delle 123 tabelle preesistenti ha dato **zero differenze**; non è stato eseguito backfill operativo. Il secondo run sullo stesso DB ha dato `applied=0`, `skipped=43`, ledger 43, zero differenze business. La verifica del ledger ha zero pending. Questa è una prova di **upgrade dello schema completo alla SHA base, ledger 42→43, popolato con dati sintetici**, non un clone né una verifica dei dati persistenti reali.

## Fresh, parità e vincoli

- Fresh M5A canonico sul DB separato: schema iniziale, 43 migration, seed e smoke previsti, secondo run e verifica ledger: **PASS, 43/43**.
- Cataloghi fresh/upgrade: tabelle, colonne, tipi, nullability, default, vincoli e indici senza differenze semantiche. Il confronto grezzo mostrava 18 sole differenze di nome relative a 9 FK M5A generate da percorsi Drizzle/SQL diversi; normalizzate **solo** tali denominazioni, le definizioni sono identiche. Nessuna differenza di colonna, indice o comportamento dei vincoli è stata ignorata.
- Vincoli PostgreSQL: **10/10 PASS**, inclusi codice univoco, FK, CHECK di stato/attore/versione/destinatario, Area non nulla, unicità parziale per Intervento attivo, riutilizzo dopo annullamento e due transazioni concorrenti con lock osservato e perdente SQLSTATE `23505`. Il test lascia la tabella richieste vuota e il contenuto originario invariato.
- Runner migration: **24/24 PASS** sull'istanza effimera, con DB addizionale allowlisted poi rimosso. Il test ridotto `m5a-migration.test.mjs`: **1/1 PASS**; resta una prova focalizzata e non sostituisce l'upgrade completo.

## API, autorizzazioni e zero effetti

- Test M5A mirati su PostgreSQL: **22/22 PASS** fra route, contratto/migration e full-app con login/sessione/`areaGuard` reali. Coperti sette endpoint, create/update/take/cancel, versioni, idempotenza/replay, scope Centro/Area/UDS, profili Centro/Magazzino/sola lettura, conteggi filtrati, DTO minimizzato, 401/403/404/409, flag, mass assignment, lock e concorrenza. Il test full-app verifica che il Magazzino non legga il dossier sociale e che un altro Centro della stessa Area non veda lista, conteggio o dettaglio.
- I test confrontano digest del contenuto, non soltanto conteggi, per 11 tabelle legacy pertinenti a stock, documenti, distribuzioni e Interventi; i comandi M5A non le modificano. L'Intervento origine resta immutato. È coperto il rollback dell'intero comando quando l'audit fallisce, senza richiesta né ricevuta residua; replay e click concorrenti non duplicano evento/effetto.
- Suite API completa finale: **122 file PASS; 1399 test PASS, 4 SKIP**. I quattro skip sono test storici condizionati a fixture/import esterni (`fse-import-parser-m3b`, `agea-sifead-parser`, `fse-import-practice-m3b`, `agea-import`); non sono stati aggiunti skip né retry per ottenere il verde.
- Durante il collaudo sono state corrette soltanto fixture, guardie e cleanup dei test: ricevute e audit append-only restano nel DB disposable fino alla sua eliminazione; le fixture UDS hanno Area/Centro e flag coerenti. Non sono stati modificati route, permessi, schema, contratto o migration applicativi per far passare i test.
- La prima esecuzione mirata aveva 14 failure su 15 test: il teardown del test tentava di cancellare ricevute append-only e due fixture UDS non erano coerenti con le policy correnti. Dopo le sole correzioni del test/harness, la suite mirata è stata rieseguita ed è verde. Anche la prima suite frontend aveva 15 failure per mock storici privi dei nuovi hook; dopo l'aggiornamento dei tre mock, la suite completa è stata rieseguita ed è verde.

## Frontend, build e prove non concluse

- Suite frontend completa finale: **82 file / 439 test PASS**. Tre mock di test storici sono stati aggiornati per i nuovi hook M5A, senza toccare i componenti applicativi. Typecheck API/WEB e workspace: **PASS**.
- Codegen eseguito nella copia temporanea del candidato (inclusi delta non tracciato): **PASS**, client/validatori generati identici al working tree. Build API nella copia: **PASS**. Test del generatore runtime config WEB: **PASS**.
- Build WEB nella copia: **BLOCKED** prima della compilazione per `Cannot find module '../lightningcss.darwin-arm64.node'` in `lightningcss@1.32.0`. L'identico errore si riproduce sulla SHA base estratta con le stesse dipendenze: è un prerequisito nativo dell'ambiente, non una regressione attribuibile a M5A da questa prova. Installazioni host, cambio policy multipiattaforma e download di immagini/browser non sono autorizzati dal mandato.
- Di conseguenza build riproducibile completa, controllo budget bundle e E2E browser M5A/legacy: **BLOCKED/NE**, non PASS. Nessun server E2E preesistente è stato riusato e nessun dato è stato creato nel persistente. Il test Playwright non è stato avviato perché richiede la partenza WEB/Vite bloccata.
- La verifica Prettier dei nuovi test/harness è positiva eccetto due test frontend storici già non conformi alla SHA base (`beneficiari-provvisori.test.tsx`, `beneficiario-tessera.test.tsx`); non sono stati riformattati integralmente file estranei. `git diff --check`: **PASS**. Nessun test è dichiarato verde se non eseguito.

## Artefatti e arresto

Manifest senza segreti, log, snapshot, prove ledger/constraint/parity, inventario SHA-256 e patch completa non staged sono conservati nella directory di artefatti della sessione: `/var/folders/j_/q5hy3r690mnd0xwtwmb4m_w40000gn/T/m5a-test-d214b8860a51-R6iUBD`. La password temporanea viene rimossa al cleanup. Il report non contiene URL con credenziali.

Cleanup completato: container `1d541e5104aa377f3b10da95ab17989cb55157e608ed3cd24dc3b1ce4f3924ca` e rete `aaddf65588de2fc530cda19c740c7c217b213b433c7a789eb89ef6d6ff534ed7` sono stati rimossi solo dopo confronto di ID e label. Le liste Docker filtrate sulla sessione sono vuote; `postgres.password` e `postgres.env` non esistono più. Nessuna immagine, volume o risorsa di altri progetti è stata rimossa.

Il working tree M5A resta intenzionalmente modificato, senza staging/commit/push. HEAD locale e tracking remoto restano alla SHA base, divergenza `0/0`; `main` non è stato modificato. Il contenuto applicativo M5A non è stato corretto nella fase `##test`: il confronto con la copia del candidato predisposta prima delle correzioni di test mostra identici `artifacts/api-server/src`, `lib/db/src`, OpenAPI e nuova migration, e differenze nel frontend `src` limitate a un test riformattato. Le modifiche aggiunte riguardano test, harness e questo rapporto.
