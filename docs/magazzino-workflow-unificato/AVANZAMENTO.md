# Magazzino workflow unificato — Registro di avanzamento

## M0 — sviluppo

Data: 9 settembre 2026
Stato: **M0 pronto per `##test`, da validare**.

### Perimetro autorizzato

- fotografia Git/codice/test della baseline;
- specifica operativa e decisioni raccomandate, senza implementazione;
- backup in lettura del database locale e ripristino su copia isolata;
- bootstrap della baseline su DB verificato vuoto;
- documentazione di isolamento, ripristino e matrice di accettazione;
- controlli di sviluppo sicuri contro il solo ambiente M0.

Esplicitamente esclusi: modifiche UI/API business, nuovo schema di dominio, migrazioni del refactoring, correzioni incidentali, commit, push, merge, deploy e avvio M1A.

### Revisione

| Campo             | Valore                                 |
| ----------------- | -------------------------------------- |
| checkout iniziale | `feature/maps-2-1` @ `2e2f89d`, pulito |
| base M0 scelta    | `origin/main` @ `787d7c5`              |
| branch            | `codex/magazzino-workflow-unificato`   |
| `main` locale     | `8419dc7`, non modificato              |
| commit candidato  | nessuno; vietato in `##sviluppo M0`    |

### Deliverable modificati

| File                     | Scopo                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `BASELINE.md`            | stato Git, mappa codice/dipendenze, ambiente, evidenze e difetti preesistenti          |
| `DECISIONI.md`           | modello lotto/carico/richiesta, transizioni, quantità, audit, UX e decisioni bloccanti |
| `AMBIENTE_TEST.md`       | inventario risorse, backup/ripristino, fresh DB, isolamento, comandi e limiti          |
| `MATRICE_VALIDAZIONE.md` | ID originali, milestone, stato reale ed evidenza richiesta                             |
| `AVANZAMENTO.md`         | registro di perimetro, attività, blocchi e prossima autorizzazione                     |

Non sono stati aggiunti script o Compose alternativi: per M0 sono bastati PostgreSQL isolati e il gate esistente. Un Compose applicativo verrà aggiunto solo quando una prova Docker web/API lo richiederà.

### Evidenze ambientali

- Sorgente identificata e interrogata solo con transazione read-only e aggregati.
- Dump custom-format creato fuori dal repository, catalogo verificato e SHA-256 registrata.
- Ripristino riuscito su nuovo container, rete e volume.
- Sorgente/copia coincidenti per conteggi, hash inventario/movimenti, totali unità e prenotazioni controllate.
- Fresh DB verificato inizialmente con zero tabelle applicative.
- Gate fresh baseline superato: schema push sul solo DB vuoto, 33 migrazioni, seed, CRUD API, replay e checksum.
- Database/volume originali non azzerati e non migrati.

### Decisioni che richiedevano validazione al termine dello sviluppo

1. `lotti` resta dettaglio fisico; nuovo `lotto_logico` è contenitore multiprodotto.
2. “Generale” è unico per Area e non assorbe automaticamente il legacy.
3. Unità indivisibili governate da proprietà esplicita catalogo; nessun arrotondamento storico.
4. Pratica di carico separata dalle integrazioni immutabili.
5. Richiesta magazzino autonoma, rappresentabile con sole note.
6. Documento con destinatario tipizzato, mantenendo il trasferimento come workflow specializzato.
7. Stato “affidato/in trasporto” distinto da prenotato, consegnato e rientrato.
8. Proposta temporanea di una singola soglia minima Area; successivamente respinta e sostituita nella chiusura M0.
9. Registro audit comune transazionale con snapshot del codice autore.

### Difetti/rischi assegnati

| Evidenza                                                          | Classificazione                                            | Fase           |
| ----------------------------------------------------------------- | ---------------------------------------------------------- | -------------- |
| 35/37 movimenti locali senza autore                               | dato legacy, non regressione M0                            | M1C/M2         |
| suite API usa direttamente `DATABASE_URL`                         | rischio ambiente baseline                                  | M0/ogni test   |
| fresh gate avvia job priorità e geocoding pubblico salvo override | rischio effetti esterni baseline                           | `##test M0`    |
| Giacenze non accetta Area selezionata                             | gap funzionale richiesto                                   | M1B            |
| Import AGEA accetta solo XLSX                                     | gap funzionale richiesto                                   | M3B            |
| due code materiali (bolle e interventi) non convergenti           | gap architetturale                                         | M5             |
| testata `operatoreId` non è cronologia                            | gap audit                                                  | M1C            |
| build root senza `PORT`/`BASE_PATH`                               | requisito ambientale preesistente; build configurata verde | M0             |
| deprecazione `client.query()` concorrente nei test                | debito tecnico baseline evitarlo prima di `pg@9`           | regressione/M6 |
| warning sourcemap/chunk Vite                                      | warning baseline non bloccante; budget dedicato verde      | regressione/M6 |

### Controlli di sviluppo

| Comando/attività                                                    | Esito                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `pnpm --filter @workspace/db run test:fresh` su DB M0 vuoto         | superato                                                           |
| backup, restore e confronto aggregato                               | superato                                                           |
| `env CI=true pnpm install --frozen-lockfile`                        | superato; lockfile invariato                                       |
| `pnpm run typecheck`                                                | superato                                                           |
| `pnpm --filter @workspace/api-server run test` con URL M0 esplicita | superato: 105 file, 1.142 passati, 2 saltati                       |
| unit test frontend                                                  | superato: 60 file, 328 test                                        |
| test runner migrazioni                                              | superato: 9 sottotest                                              |
| `pnpm run build` senza variabili                                    | fallito per `PORT`, poi `BASE_PATH`, richieste dal mockup baseline |
| `PORT=19176 BASE_PATH=/ pnpm run build`                             | superato con warning non bloccanti                                 |
| budget bundle frontend                                              | superato: 1249,9 KiB / 346,5 KiB gzip                              |
| test runtime config web                                             | superato                                                           |
| rebuild Docker web/API stessa SHA                                   | non eseguito; previsto nel successivo `##test M0`                  |
| prova tablet/fotocamera                                             | non eseguita; non dichiarabile automaticamente                     |

### Condizione di arresto e prossima azione

I controlli di sviluppo sono terminati; fermarsi senza commit. La prossima azione autorizzabile è `##test M0`, che dovrà validare decisioni aperte, isolamento, Docker della stessa revisione e persistenza sicura del backup. Nessuna milestone M1 può iniziare automaticamente.

## M0 — test

Data: 9 settembre 2026
Stato al termine della fase: **M0 test automatici superati — pronto per validazione Floriano/ChatGPT**. La validazione umana successiva è registrata nella sezione di chiusura.

### Perimetro ed esito

- È stata testata soltanto la baseline documentale M0 sul branch `codex/magazzino-workflow-unificato`, revisione applicativa `787d7c5436d5fa4c0edb24be373d055946d402ce`.
- Non sono stati modificati codice applicativo, schema, OpenAPI, tipi generati o `main`; M1A non è iniziata.
- I cinque documenti M0 costituiscono il solo contenuto del commit candidato; la sua SHA è riportata dal repository e nel resoconto della fase.

### Evidenze prodotte

- Backup durevole fuori repository/iCloud in `~/.local/share/magazzino-solidale/backups/m0/2026-09-09/magazzino-m0-baseline-787d7c5.dump`: 745.717 byte, modo `0600`, SHA-256 `a8735f915045b70e393d2a0a3590f270d26fc32ee40bb970886f55676a48e255`.
- Ripristino da zero del backup durevole in `magazzino-m0-durable-restore-db`; conteggi, hash completi campionati, aggregati e controlli degli orfani coincidono con il database originale.
- Database originale `magazzino` interrogato soltanto in lettura e rimasto invariato; replay migrazioni sulla copia popolata con 33 skip, checksum corretti e nessuna differenza operativa.
- Nuovo database `magazzino_m0_fresh_validation` verificato vuoto prima del gate; schema, 33 migrazioni, seed, smoke CRUD, replay e checksum completati.
- Immagini Docker ricostruite senza cache dalla stessa SHA: API `sha256:9fbae7b790898626b822798bd30a00fa3737f17f266294511d131eff75325a1d`, web `sha256:edd3831953faa71434089769902d694f230aa8c3a3ccd3b4abc2d09431e6cd39`.
- Health API diretto e via Nginx, pagina web, runtime config e login nel browser integrato verificati. I container applicativi sono stati arrestati intenzionalmente dopo gli smoke test; le risorse DB isolate restano disponibili.

### Test automatici

| Controllo                                                                       | Esito finale                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `env CI=true pnpm install --frozen-lockfile`                                    | superato; lockfile invariato                                             |
| `pnpm run typecheck`                                                            | superato                                                                 |
| `pnpm --filter @workspace/db run test:migrations`                               | superato: 10 test; suite PostgreSQL opzionale non attivata               |
| `pnpm --filter @workspace/magazzino-solidale run test`                          | superato: 60 file, 328 test                                              |
| `pnpm --filter @workspace/api-server run test`                                  | superato nel rerun finale: 105 file, 1.142 passati, 2 saltati, 0 falliti |
| `env PORT=19176 BASE_PATH=/ MAPS_PUBLIC_GEOCODING_ALLOWED=false pnpm run build` | superato                                                                 |
| `pnpm --filter @workspace/magazzino-solidale run build:budget`                  | superato: 1249,9 KiB / 346,5 KiB gzip                                    |
| `pnpm exec bash scripts/test-web-runtime-config.sh`                             | superato                                                                 |

Due esecuzioni diagnostiche complete della suite API, svolte mentre i container applicativi pubblicavano `58080`/`58082`, hanno registrato un errore intermittente ciascuna in test diversi. La risposta HTML Nginx ricevuta da Supertest ha dimostrato una collisione con la gamma di porte effimere del sistema. Dopo l'arresto dei soli container applicativi, il rerun completo sopra indicato è risultato verde.

### Decisioni consolidate e decisioni umane aperte al termine dei test

Sono confermati come vincoli dello scenario: distinzione lotto logico/dettaglio fisico, un solo input quantità, richiesta iniziale anche con sole note, selezione Area→Magazzino, autore derivato esclusivamente dalla sessione backend, cronologia append-only e assenza di consegne parziali implicite.

Al termine dei test restavano proposte da approvare: cardinalità del lotto “Generale” per Area, proprietà `quantitaFrazionabile`, pratica di carico, richiesta/cardinalità, stati interni, policy della scorta minima di Area e audit comune. La sezione di chiusura registra l'esito umano e le due rettifiche.

### Avvisi e passaggi manuali

- Verificare manualmente che il filesystem contenente il backup durevole sia cifrato e incluso nella policy di conservazione prevista.
- La validazione umana, allora pendente, è stata completata nella chiusura M0.
- Tablet, tastiera touch e fotocamera richiedono prova fisica nelle milestone pertinenti; non sono certificati da M0.
- Restano non bloccanti la deprecazione PostgreSQL `client.query()` nei test, i warning Vite sourcemap/chunk e il requisito `PORT`/`BASE_PATH` della build root.
- Evitare porte host nella gamma effimera durante i test Supertest oppure arrestare preventivamente i container applicativi.

### Condizione di arresto

Il gate automatico M0 è stato completato e il commit candidato `2966e1f892b61a03760b6687bbc7bcb0e7b2e78b` è stato pubblicato sul solo branch M0. La chiusura resta documentale: nessun merge, nessuna modifica di `main` e nessun avvio di M1A.

## M0 — chiusura e validazione umana

Data: 9 settembre 2026
Base validata: `2966e1f892b61a03760b6687bbc7bcb0e7b2e78b`
Stato: **M0 validato umanamente e chiuso; requisiti successivi non implementati e relativi test non eseguiti**.

### Perimetro della chiusura

- aggiornamento esclusivamente documentale sul branch `codex/magazzino-workflow-unificato`;
- nessuna modifica a codice applicativo, schema, OpenAPI, migrazioni o file generati;
- nessun merge o push di `main`;
- nessun avvio di M1A.

### Decisioni approvate

1. Un lotto logico di sistema `Generale` è unico per Area operativa, sempre disponibile, non archiviabile e non assegnato retroattivamente ai dati legacy.
2. `quantitaFrazionabile` è una proprietà esplicita del catalogo: `pz` e `cf` non frazionabili, kg/litri frazionabili di default, senza arrotondamento automatico del legacy.
3. La pratica di carico è persistente e distinta dalle contabilizzazioni incrementali immutabili.
4. `richiesta_magazzino` è autonoma e può nascere con sole note, senza prodotti.
5. Una richiesta ha al massimo un documento operativo attivo e una pianificazione/consegna attiva; i collegamenti annullati restano nello storico.
6. Gli stati interni `in_trasporto` e `rientro_atteso` sono ammessi senza consegne parziali.
7. L'interfaccia nasconde la macchina a stati dietro azioni operative semplici.
8. L'audit comune è append-only e transazionale, con attore dalla sessione backend, snapshot codice/matricola e correlation ID.
9. Il legacy senza autore resta nullo ed è mostrato come “Non disponibile — dato precedente”.
10. In M1B l'Area mostra quantità aggregate senza essere dichiarata sotto/sopra scorta mediante una soglia arbitraria.

### Rettifiche registrate

- Il lotto logico/operativo selezionato dal volontario è distinto dall'eventuale lotto fisico/produttore. Può contenere più prodotti e più dettagli fisici dello stesso prodotto con scadenze diverse.
- Il codice lotto fisico non è obbligatorio per il solo fatto che il prodotto partecipa alla gestione lotti. Un requisito di tracciabilità separato, con nome ancora da scegliere, sarà definito e implementato in M2.
- Il lotto `Generale` è il lotto logico operativo di default, ma non rappresenta né inventa un codice lotto fisico.
- È respinta la precedente proposta `max(prodotti.scortaMinima)` per l'Area. M1B mantiene la soglia sul singolo magazzino e può mostrare “N magazzini sotto scorta”; non somma né moltiplica soglie. Un'eventuale policy esplicita di Area o prodotto×magazzino è demandata a M2.

### Stato di implementazione e prova

La validazione riguarda i requisiti, non il software futuro. Le righe pertinenti di `MATRICE_VALIDAZIONE.md` riportano quindi insieme `APP-M0` e lo stato tecnico effettivo `NI`, `PB` o `NE`. Nessuna delle approvazioni viene dichiarata già implementata o testata.

### Condizione di arresto

M0 è chiuso. Dopo il commit e il push di questa registrazione sul solo branch M0, fermarsi. L'avvio di M1A richiede un prompt successivo esplicito.

## M1A — sviluppo e test automatici

Sviluppo: 9 settembre 2026; test automatici: 10 settembre 2026
Base di sviluppo: `3ebbcaab04206be16530c2ddb5298c0bbdb74f12`
Stato: **M1A test automatici superati — pronto per revisione e validazione manuale**.

### Perimetro autorizzato

- feedback immediato e stato persistente per il componente `Button` comune;
- chiarezza delle quattro azioni principali del Catalogo prodotti;
- semantica di download per la generazione dei codici a barre;
- controllo accessibile per mostrare o nascondere la password nel login;
- test frontend mirati e soli controlli di sviluppo pertinenti.

Sono rimasti esclusi schema, migrazioni, API, OpenAPI, tipi generati, logiche di dominio e workflow operativi. Non sono state avviate M1B o M1C; il commit e il push riguardano esclusivamente il candidato M1A e non coinvolgono `main`.

### Modifiche implementate

- Il `Button` comune ora espone un feedback di pressione immediato e rende visibili gli stati persistenti `data-state=open/on`, `aria-expanded=true`, `aria-pressed=true` e `aria-selected=true`, conservando focus da tastiera, stato disabilitato, varianti, `asChild` e area tattile minima.
- Nel Catalogo i comandi restano nello stesso ordine e con gli stessi permessi: Esporta mostra anche lo stato asincrono e blocca avvii duplicati; Codici a barre usa icona e testo espliciti di download; Importa e Nuovo prodotto dichiarano apertura e stato dei rispettivi dialoghi.
- La generazione barcode conserva il flusso PDF esistente: la modifica riguarda solo la semantica visiva del comando.
- Il login offre mostra/nascondi password con pulsante non-submit, etichetta accessibile localizzata, `aria-pressed` e valore/autocomplete invariati.
- Le nuove stringhe sono presenti nelle sei lingue già gestite dall'applicazione.

### Controlli di sviluppo e test

| Controllo                                                                                                                                                                                                                                    | Esito                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `pnpm --filter @workspace/magazzino-solidale exec vitest run --config vitest.unit.config.ts src/components/ui/button.test.tsx src/components/export-buttons.test.tsx src/components/prodotti-m1a.test.tsx src/components/login-m1a.test.tsx` | superato: 4 file, 13 test, 0 falliti   |
| `pnpm --filter @workspace/magazzino-solidale run test`                                                                                                                                                                                       | superato: 64 file, 341 test, 0 falliti |
| `pnpm run typecheck`                                                                                                                                                                                                                         | superato per l'intero workspace        |
| `PORT=19176 BASE_PATH=/ MAPS_PUBLIC_GEOCODING_ALLOWED=false pnpm run build`                                                                                                                                                                  | superato; soli warning baseline        |
| `pnpm --filter @workspace/magazzino-solidale run build:budget`                                                                                                                                                                               | superato: 1252,2 KiB / 347,2 KiB gzip  |
| `pnpm exec bash scripts/test-web-runtime-config.sh`                                                                                                                                                                                          | superato                               |
| Prettier write/check su 11 file M1A                                                                                                                                                                                                          | superato                               |
| Prettier check integrale su `pages/prodotti.tsx` e `i18n/namespaces/prodotti.ts`                                                                                                                                                             | warning di baseline riprodotto su HEAD |
| `git diff --check`                                                                                                                                                                                                                           | superato                               |
| verifica fisica tablet/touch/tastiera                                                                                                                                                                                                        | non eseguita; richiede prova manuale   |

I test mirati coprono tutte le varianti del pulsante comune, azioni non persistenti, stati aperto/premuto/selezionato, disabled, `asChild`, focus e target touch; apertura/chiusura Radix, race di doppio avvio XLSX/PDF e contenuto passato agli exporter; semantica e permessi del Catalogo; apertura e chiusura di Import/Sheet; toggle, focus, submit ed errore login. Il ripristino del loading in caso di errore è inoltre garantito dal blocco `finally` presente in entrambi i percorsi export.

Le quattro nuove chiavi risultano presenti una sola volta per ciascuna delle sei lingue, senza stringhe UI hard-coded; inizializzazione dei namespace e accessi tipizzati sono coperti dal typecheck. La suite passa da 60 file/328 test della baseline M0 a 64 file/341 test per i quattro file e tredici test M1A.

Il prompt di test riportava un diff precedente di 13 file, `+1323/-1253`. Al preflight il churn esteso era già stato rimosso: 9 file tracciati `+222/-84` e 4 nuovi test per 598 righe. Il candidato finale è di 13 file, `+946/-52`, incluse 749 righe di test; `--ignore-all-space` ha isolato formattazione locale e riallineamenti Markdown, senza line ending, riordini automatici o whitespace estranei.

I due file Catalogo erano già integralmente non conformi a Prettier nella revisione di partenza. Le sole porzioni M1A sono state allineate all'output del formatter; la formattazione completa avrebbe prodotto un diff esteso e non funzionale, quindi è stata esclusa dal perimetro conservativo della milestone.

### Condizione di arresto e prossima azione

Il candidato M1A viene raccolto in un singolo commit e pubblicato esclusivamente sul branch autorizzato. La successiva ricostruzione Docker e la validazione visiva/manuale dovranno usare quella SHA; fino ad allora non devono essere avviate M1B o M1C né effettuati merge su `main`.

## M1B — sviluppo

Data: 10 settembre 2026
Base di sviluppo: `cb502b949d31c820ef7cc3be171fc0413cd699ae`
Stato: **M1B pronto per `##test`, da validare** (`DEV-M1B/NE-TEST-M1B`).

### Perimetro autorizzato

- gerarchia obbligatoria Area Operativa → eventuale Magazzino nella consultazione Giacenze;
- aggregazione backend precisa delle quantità per prodotto e unità canonica entro l'Area selezionata;
- intersezione tra scope scelto e autorizzazioni Area/Centro già esistenti;
- DTO/OpenAPI esplicito, codegen React/Zod, interfaccia, export e test di sviluppo;
- soli adattamenti tecnici dei consumer di `/giacenze` in Scarichi, Trasferimenti, Bolle e nei relativi test E2E per inviare l'Area del magazzino già selezionato.

Sono rimasti esclusi schema e migrazioni, modello lotti, audit M1C, Catalogo prodotti, logiche di carico/consegna/movimento e qualsiasi attività M1C/M2. Nessun commit, push o merge è stato eseguito in questa fase.

### Implementazione candidata

- `/giacenze` richiede un `areaOperativaId` intero positivo, verifica esistenza e accessibilità, e accetta il `magazzinoId` solo se esistente, appartenente alla stessa Area e accessibile al caller.
- Senza Magazzino, i soli depositi dell'Area scelta vengono intersecati con lo scope Centro e aggregati in memoria dopo il calcolo prodotto×magazzino esistente. Somme, impegnato e disponibile usano `InventoryDecimal`; prossima scadenza e lotti attivi sono aggregati senza conversioni premature.
- I magazzini legacy con `areaOperativaId = null` non entrano in alcun aggregato Area e non vengono assegnati o corretti retroattivamente.
- Il DTO distingue `ambito: area|magazzino` e riporta Area e Magazzino in modo esplicito. Nell'aggregato Area `magazzinoId`, `magazzinoNome`, soglie e stato sottoscorta sono `null`.
- `sottoscortaOnly=true` senza Magazzino restituisce HTTP 400; sul singolo Magazzino conserva la semantica baseline.
- La UI non abilita la query quantitativa senza Area, preseleziona soltanto l'unica Area attiva accessibile e filtra il secondo selettore sull'Area. Il cambio Area azzera Magazzino e sottoscorta.
- Le query conservano la chiave generata parametrizzata e l'`AbortSignal` TanStack. Prima del rendering la risposta viene inoltre verificata contro Area/ambito/Magazzino correnti, evitando la visualizzazione di dati tardivi del vecchio scope.
- Tabella ed export ricevono la stessa collezione: la modalità Area omette soglia/stato e usa filename `inventario_area_*`; la modalità Magazzino mantiene soglia/stato e usa `inventario_magazzino_*`. FSE+ resta disponibile in entrambe.
- Il nuovo `AreaMagazzinoSelector` è usato soltanto in Giacenze. Il Catalogo prodotti e `/prodotti` restano globali.

### Controlli di sviluppo eseguiti

| Controllo                                                                     | Esito                                                                                                                  |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| codegen ufficiale `pnpm --filter @workspace/api-spec run codegen`             | superato; client React e Zod rigenerati dalla sorgente OpenAPI                                                         |
| `CI=true pnpm install --frozen-lockfile`                                      | superato; lockfile invariato, warning sul build script `core-js` ignorato da pnpm                                      |
| typecheck API server                                                          | superato                                                                                                               |
| typecheck frontend                                                            | superato                                                                                                               |
| test backend mirati M1B/prenotazioni/scoping su PostgreSQL M0 fresh isolato   | superato: 3 file, 36 test, 0 falliti                                                                                   |
| test frontend mirati M1B                                                      | superato: 1 file, 18 test, 0 falliti                                                                                   |
| raccolta Playwright sui tre file E2E adattati                                 | superata: 30 casi elencati e compilati, nessun workflow eseguito                                                       |
| test E2E                                                                      | non eseguiti in sviluppo; i consumer HTTP diretti sono stati adeguati al contratto Area obbligatoria                   |
| Prettier write/check sui file M1B non generati nuovi o integralmente lavorati | superato                                                                                                               |
| Prettier check sui sette file legacy modificati solo con hunk locali          | warning preesistente riprodotto sulla HEAD                                                                             |
| Prettier check sui sette output del codegen coinvolti                         | warning dello stile Orval riprodotto sui sei file già presenti nella HEAD; il nuovo resta output ufficiale non editato |

I test backend coprono Area A con A1=10 e A2=20, Area B con B1=40, deposito legacy null, dettaglio per Magazzino, mismatch 400, Area e Magazzino non autorizzati 403, intersezione Centro, sottoscorta, somma decimale esatta, aggregazione degli impegni e filtro FSE+. I test UI coprono tutti i sedici scenari richiesti, compresa la risposta tardiva Area A dopo il passaggio ad Area B, più casi distinti per assenza di Aree attive e filtro FSE+ nei due ambiti.

Il primo avvio backend nel sandbox non ha raggiunto PostgreSQL (`connect EPERM`) e non ha eseguito fixture. Il rerun autorizzato ha usato esclusivamente `magazzino-m0-fresh-db` su `127.0.0.1:55435`, con URL costruita dal file temporaneo protetto già previsto da M0. Il database originale `magazzino-postgres` su `5434` non è stato usato né modificato.

### Limiti e prossima fase

- Le Aree inattive non sono proposte come scelta operativa; l'eventuale consultazione storica richiede una decisione esplicita futura.
- I magazzini legacy senza Area non sono selezionabili come origine nei soli consumer adattati di `/giacenze`; M1B non modifica né assegna i relativi dati.
- Il valore Dashboard `Area Operativa = undefined` resta un follow-up fuori perimetro: non è necessario al selettore Giacenze e non è stato corretto.
- I controlli di sviluppo non costituiscono la fase separata `##test M1B` né validazione umana.

### Condizione di arresto

Il working tree resta senza commit e contiene soltanto il candidato M1B. La prossima azione autorizzabile è `##test M1B`; M1C/M2, commit, push e merge restano esclusi.

## M1B — test automatici

Data: 10 settembre 2026
Base candidata: `cb502b949d31c820ef7cc3be171fc0413cd699ae`
Stato: **M1B test automatici superati — pronto per code review e validazione manuale** (`OK-M1B/NE-MAN`).

### Revisione e correzioni della fase test

- Il censimento integrale dei consumer ha confermato richieste quantitative in Giacenze, Bolle, Scarichi e Trasferimenti, oltre ai fetch diretti dei tre workflow E2E. Tutti inviano l'Area; i restanti `getListGiacenzeQueryKey()` senza parametri sono invalidazioni a prefisso e non richieste globali.
- Un'Area con ID formalmente valido ma inesistente restituisce ora HTTP 404; gli ID malformati restano 400 e un caller vincolato a un'altra Area riceve 403 prima della lookup.
- I test M1B coprono anche Area vuota, deposito comune ammesso dallo scope Centro, permanenza del legacy senza Area, precisione completa, confronto Area=A1+A2 per le prenotazioni, scadenze trascorse, lotti omonimi, FSE+ nei due ambiti, query key, ritorno all'aggregato e parsing Zod.
- Il controllo E2E ha rilevato nel helper condiviso della baseline M1A un locator password diventato ambiguo dopo l'aggiunta di “Mostra password”. È stato ristretto da `/password/i` a `/^password$/i`, senza modificare login o workflow applicativi.

### Gate eseguiti

| Controllo                                    | Esito                                                                  |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| test backend mirati M1B/prenotazioni/scoping | superato: 3 file, 38 test                                              |
| suite API completa                           | superata: 106 file, 1.153 test passati, 2 skipped                      |
| test frontend mirati M1B                     | superato: 1 file, 20 test                                              |
| suite frontend completa                      | superata: 65 file, 361 test                                            |
| tre file Playwright modificati               | superati: 6 workflow eseguiti, 24 skip previsti dalla matrice viewport |
| fresh DB E2E, replay e stato migrazioni      | superati: 33 applicate, 0 pendenti, 0 mismatch/out-of-order            |
| codegen React/Zod ripetuto                   | superato; hash del diff generated invariato prima/dopo                 |
| `pnpm run typecheck` e build completo        | superati; soli warning sourcemap/chunk baseline                        |
| budget frontend                              | superato: 1.255,7 KiB / 347,9 KiB gzip, +3,5 / +0,7 KiB rispetto a M1A |
| runtime config WEB                           | superato                                                               |
| Prettier pertinente e `git diff --check`     | superati; restano soltanto warning baseline già documentati            |

La suite API è stata eseguita su `magazzino_m1b_api_test`; fresh gate, seed demo ed E2E su `magazzino_m1b_e2e`. Entrambi sono database temporanei nel solo container `magazzino-m0-fresh-db`, esposto su `127.0.0.1:55435`. Nessun comando M1B ha puntato a `magazzino-postgres` o alla porta `5434`.

Il primo tentativo Playwright non ha avviato i workflow perché mancava `E2E_PASSWORD`; il secondo ha isolato il locator ambiguo; il rerun finale, dopo bootstrap CI e correzione del helper, ha eseguito con successo tutti i sei workflow previsti. Gli artefatti Playwright sono rimasti in directory temporanee esterne al repository.

### Stato residuo

- Restano da eseguire code review e validazione manuale del candidato; nessuna validazione è attribuita a Floriano in questa fase.
- Le Aree inattive restano escluse dalla scelta operativa; un eventuale percorso storico richiede una decisione futura.
- `Area Operativa = undefined` in Dashboard resta un follow-up non bloccante e fuori M1B.
- M1C, M2, rebuild Docker candidato e merge su `main` non sono stati avviati.

## M1B — correzione post-code-review

Data: 10 settembre 2026

Base della correzione: `f48e838b6d68b07f670ecac9afffb2689b31c802`

Stato: **M1B test automatici superati — pronto per validazione Docker/manuale** (`OK-M1B/NE-MAN`).

La code review ha rilevato una difformità tra l'aggregato Area, che include tutti i magazzini accessibili appartenenti esattamente all'Area, e il selector Giacenze, che mostrava soltanto quelli attivi. Poiché Giacenze è una vista consultiva, il helper è stato rinominato `warehousesForArea` e ora mantiene anche i depositi inattivi dell'Area selezionata. Nel menu questi sono identificati dal suffisso localizzato `common.inactive`; i magazzini di altre Aree e quelli legacy senza Area restano esclusi.

La fixture frontend dedicata verifica A1 attivo con 10 pezzi e A2 inattivo con 20 pezzi: l'aggregato Area continua a mostrare 30, A2 è selezionabile come consultazione e la query risultante contiene sia l'Area sia il relativo `magazzinoId`, mostrando i 20 pezzi del deposito. I filtri `stato === "attivo"` di Bolle, Scarichi e Trasferimenti sono rimasti invariati, quindi questa correzione non riabilita i magazzini inattivi per operazioni di scrittura.

| Controllo                                    | Esito                                                  |
| -------------------------------------------- | ------------------------------------------------------ |
| test frontend M1B mirati                     | superato: 1 file, 21 test                              |
| suite frontend completa                      | superata: 65 file, 362 test                            |
| test backend mirati M1B/prenotazioni/scoping | superato: 3 file, 38 test                              |
| `pnpm run typecheck`                         | superato per l'intero workspace                        |
| codegen React/Zod                            | superato; nessuna modifica a OpenAPI o output generati |
| Prettier pertinente e `git diff --check`     | superati                                               |

Backend, OpenAPI, generated code, schema e migrazioni sono invariati. La matrice GEO-01..04 resta `OK-M1B/NE-MAN`; rebuild Docker, validazione manuale, M1C, M2 e merge su `main` non sono stati avviati.

## M1B — validazione manuale

Data: 11 settembre 2026

Candidato validato: `27bff709565726b73f9fa09c2e0e3875fe0982b5`

Stato: **M1B validato manualmente da Floriano** (`OK-M1B/OK-MAN-M1B`).

Floriano ha completato con esito positivo il dry run manuale del candidato Docker M1B. La validazione copre GEO-01, GEO-02, GEO-03, GEO-04 e CAT-01: selezione Area→Magazzino, aggregato di Area, isolamento degli scope, reset al cambio Area, assenza di una soglia arbitraria di Area, consultazione dei magazzini inattivi, esclusione del legacy senza Area, export contestuali, filtro FSE+, consumer collegati e permanenza del Catalogo come anagrafica globale.

Gli esiti tecnici M1B già registrati restano invariati. Questa chiusura documentale non modifica codice, schema, API, migrazioni o output generati e non anticipa M1C o M2.
