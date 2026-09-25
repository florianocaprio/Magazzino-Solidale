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

## M1C — sviluppo

Data: 15 settembre 2026

Base di sviluppo: `6f82e87300483aed86240bd135c13919d7b6eb3a`

Stato: **M1C pronto per `##test`, da validare** (`DEV-M1C/NE-TEST-M1C`).

### Contratto audit candidato

- La nuova tabella `audit_eventi` registra azione, entità, correlazione, attore o processo di sistema, snapshot dell'autore e dell'eventuale iniziatore, riferimenti documentali, contesto operativo, date distinte, motivo, differenze allowlist, metadati sanitizzati, operation key ed evento precedente.
- Gli ID di Area, Centro e Magazzino sono snapshot storici senza FK live. Le sole FK verso utente usano `ON DELETE SET NULL`; lo snapshot del codice resta obbligatoriamente conservato. Non è stato creato un utente fittizio `SYSTEM`.
- Un trigger DB impedisce `UPDATE` e `DELETE` degli eventi. L'unica eccezione tecnica ammessa è l'azzeramento delle FK attore/iniziatore causato da `ON DELETE SET NULL`, senza possibilità di cambiare gli altri campi o gli snapshot.
- `recordAuditEvent` usa la transaction ricevuta, non apre transazioni autonome e non effettua scritture best-effort. Se l'audit obbligatorio fallisce, falliscono anche testata, quantità e movimenti dello stesso comando.
- Il contesto umano è costruito dalla sessione backend; matricola e, in assenza, username diventano snapshot. I campi client che tentano di attribuire l'autore non vengono usati.
- Un correlation ID viene creato una volta per comando e condiviso dagli effetti della stessa transazione. Dove il dominio possiede già una idempotency key, l'operation key la riusa e il replay non genera un secondo evento.
- `previousEventId` indica l'ultimo evento già committato e osservabile della stessa coppia `entitaTipo + entitaId`. Non è una serializzazione globale: due comandi realmente concorrenti possono condividere lo stesso predecessore; la correlazione, l'identità dell'entità e il timestamp restano le chiavi autorevoli per la ricostruzione.
- `changes` e `metadata` accettano esclusivamente chiavi allowlist e applicano una seconda sanitizzazione ricorsiva. Password, token, cookie, autorizzazioni, credenziali SMTP, reset link e payload personali non necessari non vengono conservati.
- `motivo` viene normalizzato con trim, sanitizzato e limitato a 1.000 caratteri. Non riceve automaticamente note sociali o interi payload.

### Schema, migrazione e Lista movimenti

- La migrazione `20260911_m1c_audit_eventi.sql`, successiva alle 33 baseline, crea `audit_eventi`, i relativi indici e il trigger append-only, quindi aggiunge `movimenti.audit_evento_id` nullable con indice e FK.
- Nessun movimento legacy viene riscritto o collegato retroattivamente. `movimenti.operatore_id` resta compatibile; i nuovi movimenti umani M1C ricevono l'utente di sessione.
- `/movimenti` espone `operatoreCodice` e `auditEventoId`. La sorgente preferita è lo snapshot audit; per un record pre-M1C con autore usa il fallback `matricola corrente ?? username`; senza autore restituisce `null`.
- La Lista movimenti e il relativo export aggiungono soltanto la colonna localizzata `Operatore`. Il valore nullo è mostrato come “Non disponibile — dato precedente”; nome, cognome ed email non sono esposti.
- OpenAPI è la sorgente della modifica e i client React/Zod sono stati rigenerati con il codegen ufficiale. Non sono stati aggiunti endpoint o voci menu per consultare direttamente l'audit.

### Censimento dei registri esistenti

| Registro esistente                                                        | Finalità                                                            | Mantenuto | Sostituito | Relazione con `audit_eventi`                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------- | ---------- | ------------------------------------------------------------------------------- |
| `system_logs`                                                             | login, logout, sicurezza, diagnostica e log tecnici best-effort     | sì        | no         | resta distinto; non certifica le transazioni business                           |
| `audit_configurazioni` e audit verticali Mensa/Emporio                    | modifiche configurative e controlli specifici di modulo             | sì        | no         | proiezioni verticali; l'eventuale convergenza viene valutata nelle milestone    |
| `interventi_storico_stati`                                                | cronologia di dominio degli interventi                              | sì        | no         | continua a descrivere il workflow e non sostituisce l'autore comune del comando |
| staging/import AGEA, incluso `note_audit`                                 | acquisizione, classificazione e tracciabilità dell'import           | sì        | no         | integrazione completa rinviata a M3                                             |
| export/eventi e riconciliazioni FSE+                                      | rendicontazione, copertura degli eventi esportati e riconciliazione | sì        | no         | registro compliance verticale, non duplicato in M1C                             |
| `registro_volontari_eventi` e registri matricole/assegnazioni volontari 2 | storia immutabile e temporale del sottodominio volontari            | sì        | no         | resta verticale; non viene trasformato in audit inventariale                    |
| `movimenti`                                                               | ledger inventariale                                                 | sì        | no         | ogni nuovo movimento coperto punta all'evento business mediante `auditEventoId` |

### Censimento dei percorsi inventariali e documentali

| Percorso                                     | Servizio/scrittura                            | Transazionale | Autore candidato                             | Audit M1C | Decisione                                                                                                |
| -------------------------------------------- | --------------------------------------------- | ------------- | -------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------- |
| Carico magazzino multilinea                  | `createWarehouseLoad`                         | sì            | sessione backend                             | sì        | un evento per comando; tutti i lotti/movimenti condividono evento e autore; replay idempotente invariato |
| Rettifica inventariale esistente             | `rettificaInventariale`                       | sì            | sessione backend                             | sì        | nuovo evento motivato e movimento collegato                                                              |
| Carico/rettifica da route lotti legacy       | `createWarehouseLoad`/`rettificaInventariale` | sì            | sessione backend                             | sì        | gli adattatori esistenti passano il contesto comune                                                      |
| Ricezione approvvigionamento                 | `createWarehouseLoad`                         | sì            | sessione backend                             | sì        | il comando propaga un contesto stabile ai carichi generati                                               |
| Scarico manuale e FEFO                       | `creaScaricoInventariale`                     | sì            | sessione backend                             | sì        | un evento collega tutti i movimenti prodotti dai lotti FEFO                                              |
| Storno scarico invocato dai percorsi coperti | `stornaScaricoInventariale`                   | sì            | sessione backend propagata                   | sì        | movimento di storno collegato all'evento obbligatorio                                                    |
| Bolla: creazione                             | route `bolle`                                 | sì            | sessione backend                             | sì        | evento `BOLLA_CREATA`                                                                                    |
| Bolla: conferma/prenotazione                 | route `bolle`                                 | sì            | sessione backend                             | sì        | evento `BOLLA_CONFERMATA`; l'evento precedente conserva la sequenza                                      |
| Bolla: consegna/scarico                      | `completeBollaDelivery`                       | sì            | sessione backend                             | sì        | evento `BOLLA_CONSEGNATA`; movimenti attribuiti al consegnante                                           |
| Bolla: annullamento/storno                   | route `bolle` e `stornoRigaTx`                | sì            | sessione backend                             | sì        | evento `BOLLA_ANNULLATA`; gli eventuali storni puntano allo stesso evento                                |
| Trasferimento: creazione                     | `createTransferRequest`                       | sì            | sessione backend                             | sì        | operation key esistente riusata quando disponibile                                                       |
| Trasferimento: avvio/in-transito             | route `trasferimenti`                         | sì            | sessione backend                             | sì        | movimento uscita e transizione condividono l'evento                                                      |
| Trasferimento: ricezione                     | route `trasferimenti`                         | sì            | sessione backend                             | sì        | movimento entrata e transizione condividono l'evento                                                     |
| Creazione trasferimento Mensa                | route `mensa`/`createTransferRequest`         | sì            | sessione backend                             | sì        | coperto perché usa il servizio trasferimenti comune                                                      |
| Import/carichi AGEA                          | `createWarehouseLoad` da workflow import      | sì            | processo verticale esistente                 | no        | il ledger resta invariato; actor system/initiated-by e operation key dell'import vengono integrati in M3 |
| Scarichi verticali Interventi, Mensa e FSE+  | caller verticali di `scaricoInventory`        | sì            | semantica verticale esistente                | no        | non sono scarico manuale M1C; integrazione rinviata alle milestone M4/M5 e al censimento finale M6       |
| Movimenti Emporio                            | `speseEmporio`                                | sì            | semantica verticale Emporio esistente        | no        | modulo fuori dal perimetro M1C; convergenza audit rinviata al censimento M6                              |
| Seed/demo                                    | `environmentData`                             | sì            | processo di inizializzazione                 | no        | fixture ambientale, non comando business runtime; nessun evento storico artificiale                      |
| Catalogo e nuovo modello lotti               | route e servizi futuri                        | da definire   | da sessione backend                          | no        | rinviati a M2 come previsto da D6                                                                        |
| Richiesta magazzino e sociale                | servizi futuri                                | da definire   | da sessione backend o sistema con iniziatore | no        | rinviati a M5                                                                                            |

La presenza temporanea di un log tecnico e di un evento business per lo stesso comando non è una duplicazione semantica: il primo resta diagnostico/best-effort, il secondo è parte atomica dell'operazione.

### Evidenza migrazione su copia popolata

La prova ha usato una copia PostgreSQL isolata di `magazzino_m1b_manual`; il database originale `magazzino-postgres` e la porta `5434` non sono stati usati. I conteggi sono stati acquisiti prima e immediatamente dopo la migrazione, prima dell'esecuzione delle fixture di test.

| Dato                                | Prima M1C | Dopo M1C |
| ----------------------------------- | --------- | -------- |
| lotti                               | 21        | 21       |
| quantità caricata complessiva lotti | 1741      | 1741     |
| quantità residua complessiva lotti  | 1624      | 1624     |
| movimenti                           | 37        | 37       |
| quantità complessiva movimenti      | 1701      | 1701     |
| movimenti senza autore              | 35        | 35       |
| movimenti con `auditEventoId`       | —         | 0        |
| eventi `audit_eventi`               | —         | 0        |
| prenotazioni                        | 6         | 6        |
| bolle                               | 25        | 25       |
| trasferimenti                       | 3         | 3        |
| scarichi                            | 10        | 10       |
| carichi                             | 2         | 2        |

La migrazione è risultata applicata una volta e le altre 33 sono state riconosciute come già presenti. Quantità, conteggi, autore nullo e assenza di eventi retroattivi sono rimasti invariati.

### Controlli di sviluppo eseguiti

| Controllo                                                                                       | Esito                                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| test helper, append-only, sanitizzazione e migrazione DB                                        | superati nella regressione backend mirata                                                                                             |
| test carico/idempotenza/spoof/snapshot/rollback, scarico FEFO, bolle, trasferimenti e movimenti | superati: 8 file, 110 test, 0 falliti, su copia PostgreSQL isolata                                                                    |
| test frontend formatter operatore                                                               | superati: 1 file, 2 test, 0 falliti                                                                                                   |
| fresh database gate finale                                                                      | superato: schema, 34 migrazioni, seed, health/login/password, CRUD API, replay, checksum e stato con 0 pending/mismatch/out-of-order  |
| codegen ufficiale React/Zod                                                                     | superato; output rigenerato dalla sorgente OpenAPI                                                                                    |
| `pnpm run typecheck`                                                                            | superato per l'intero workspace                                                                                                       |
| Prettier sui file nuovi/già conformi e `git diff --check`                                       | superati; sui 16 file legacy già non conformi il check riproduce esclusivamente warning presenti nella HEAD, senza formatting massivo |

I test di sviluppo coprono la sequenza A crea/B conferma/C consegna, actor ID e snapshot distinti, movimento finale attribuito a C, spoof dei campi autore, conservazione dello snapshot dopo cambio matricola/disattivazione, rollback totale su errore audit, replay del carico senza duplicati, scarico FEFO su due lotti con un solo evento, storno bolla collegato all'annullamento, sanitizzazione dei JSON e fallback/null della Lista movimenti.

### Limiti e prossima fase

- Le integrazioni verticali rinviate nella matrice restano esplicite e non sono state adattate artificialmente prima delle rispettive milestone.
- L'append-only applicativo e DB impedisce correzioni in place; ogni futura rettifica dovrà creare un nuovo evento correlato.
- I controlli eseguiti appartengono a `##sviluppo M1C`: non equivalgono alla suite completa `##test M1C`, a una code review conclusiva o a validazione umana.
- Il candidato M1C resta intenzionalmente non committato nel working tree; non sono stati avviati M2, merge o modifiche a `main`.

## M1C — test automatici

Data: 15 settembre 2026

Base testata: `6f82e87300483aed86240bd135c13919d7b6eb3a`

Stato: **test automatici M1C superati; prova manuale non eseguita** (`OK-M1C/NE-MAN`).

### Correzioni e precisazioni consolidate in test

- La policy di `motivo` applica trim, sanitizzazione e limite di 1.000 caratteri.
- La suite del migration runner riconosce 35 file e verifica che `20260916_m1c_audit_hardening.sql` sia l'ultima migrazione in coda.
- I test verificano direttamente entrambe le FK utente `ON DELETE SET NULL`, preservando gli snapshot, e respingono `UPDATE`/`DELETE` applicativi dell'audit.
- La unique idempotente è composta da `(azione, operation_key)`: il replay della stessa azione restituisce lo stesso evento, mentre la stessa stringa in azioni/domìni differenti non collide.
- `previousEventId` resta circoscritto alla stessa entità; sotto concorrenza rappresenta un predecessore valido osservato e può ramificare, senza promettere una catena strettamente lineare.

### Censimento completo delle scritture `movimenti`

| Punto di scrittura                      | Origine runtime                      | `operatoreId` nuovi record | `auditEventoId` | Copertura                                                                   |
| --------------------------------------- | ------------------------------------ | -------------------------- | --------------- | --------------------------------------------------------------------------- |
| `routes/trasferimenti.ts` uscita FEFO   | richiesta umana autenticata          | sì, utente del comando     | sì              | M1C, evento avvio                                                           |
| `routes/trasferimenti.ts` entrata       | richiesta umana autenticata          | sì, utente ricevente       | sì              | M1C, evento ricezione distinto                                              |
| `lib/bollaDelivery.ts` consegna         | richiesta umana autenticata          | sì, utente consegnante     | sì              | M1C, evento consegna                                                        |
| `lib/bollaDelivery.ts` storno           | richiesta umana autenticata          | sì, utente annullante      | sì              | M1C, evento annullamento                                                    |
| `lib/scaricoInventory.ts` FEFO          | umano o caller verticale autenticato | sì                         | sì/null         | M1C per scarico manuale; audit verticale rinviato, autore comunque presente |
| `lib/scaricoInventory.ts` lotto esatto  | umano o caller verticale autenticato | sì                         | sì/null         | stessa regola del FEFO                                                      |
| `lib/scaricoInventory.ts` storno        | umano o caller verticale autenticato | sì                         | sì/null         | M1C nei percorsi coperti; audit verticale rinviato                          |
| `lib/inventoryLedger.ts` carico         | umano o processo con iniziatore      | sì per richieste umane     | sì/null         | M1C nei carichi coperti; integrazione AGEA completa rinviata a M3           |
| `lib/inventoryLedger.ts` rettifica      | richiesta umana autenticata          | sì                         | sì              | M1C                                                                         |
| `lib/speseEmporio.ts` scarico           | richiesta umana autenticata          | sì                         | null            | audit Emporio rinviato; anonimato vietato e testato                         |
| `lib/speseEmporio.ts` storno            | richiesta umana autenticata          | sì                         | null            | audit Emporio rinviato; anonimato vietato e testato                         |
| `lib/environmentData.ts` movimento demo | inizializzazione sistema             | null                       | null            | ammesso: dato sintetico, non richiesta umana                                |

I caller verticali Interventi, Mensa, FSE+ ed Emporio sono stati provati esplicitamente: tutti i nuovi movimenti prodotti dalle richieste umane riportano l'utente autenticato. I percorsi seed/demo restano gli unici nuovi record intenzionalmente senza autore; i record legacy non vengono alterati.

### Database isolati e migrazioni

- Copia popolata: container `magazzino-m1c-populated-test-20260915`, database `magazzino_m1c_populated_test`, porta host `55442`, derivato in sola lettura dalla baseline M1B.
- Fresh DB: container `magazzino-m1c-fresh-test-20260915`, database `magazzino_m1c_fresh_test`, porta host `55443`.
- Regressione mirata preliminare: database disposable M1C v3 sulla porta `55441`.
- `magazzino-postgres` e la porta `5434` non sono stati usati. Sul populated DB non è stato eseguito `drizzle-kit push`; il precedente prompt interattivo osservato in sviluppo non costituisce un errore M1C e non è stato ripetuto.

La copia popolata è passata da 33 a 34 migrazioni tramite il solo runner versionato. Il replay ha prodotto `0 applied / 34 skipped`; checksum, pending e out-of-order sono a zero. Prima e dopo sono rimasti invariati: 21 lotti, quantità residua 1.624, 37 movimenti di cui 35 senza autore, 6 prenotazioni, 25 bolle, 3 trasferimenti, 10 scarichi e 2 carichi. Subito dopo la migrazione erano presenti 0 eventi audit e 0 collegamenti retroattivi dai movimenti.

Il fresh gate su database realmente vuoto ha completato schema, 34 migrazioni, seed, login e cambio password, CRUD smoke, replay, checksum e stato finale senza pending/mismatch/out-of-order. Tabella, trigger append-only, indice operation key e FK movimento sono presenti anche nello schema fresh finale.

### Esiti dei gate

| Gate                                 | Esito                                                                                           |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| regressione backend mirata           | 10 file, 260 test passati, 0 fallimenti                                                         |
| migration runner con PostgreSQL      | 24 test passati, 0 skip, 0 fallimenti                                                           |
| API completa, esecuzione finale      | 108 file, 1.169 test passati, 2 skip, 0 fallimenti                                              |
| frontend completa                    | 66 file, 364 test passati, 0 fallimenti                                                         |
| codegen React/Zod                    | completato dalla sorgente OpenAPI; nessuna differenza inattesa                                  |
| `pnpm run typecheck`                 | completato per l'intero workspace                                                               |
| build con `PORT=19176 BASE_PATH=/`   | completata; warning Vite sourcemap/chunk e dimensione bundle API già appartenenti alla baseline |
| bundle budget                        | superato: entry 1.256,2 KiB / 348,0 KiB gzip                                                    |
| runtime config web                   | superato                                                                                        |
| Prettier mirato e `git diff --check` | superati; nessun formatting massivo dei file legacy                                             |

La prima esecuzione API completa ha registrato un singolo 404/403 nel test UDS, estraneo a M1C. Lo stesso test è passato isolatamente e il rerun completo è risultato interamente verde; non è stato modificato codice UDS. Restano warning non bloccanti del driver `pg` sui test concorrenti e i warning build baseline sopra indicati; non sono emersi nuovi warning funzionali M1C.

### Evidenze funzionali M1C

- AUD-01: A crea, B conferma e C consegna; eventi, snapshot e correlation ID sono distinti, la testata indica C e il movimento finale è attribuito a C senza perdere A/B.
- AUD-02: `operatoreId`, `actorUserId` e `creatoDa` inviati dal client non cambiano l'attore, sempre derivato dalla sessione. Il fallimento audit causa rollback sia del carico sia della conferma Bolla, lasciando stock, movimenti, prenotazioni e stato documento invariati.
- AUD-03: lo snapshot matricola resta invariato dopo cambio/disattivazione e cancellazione account; senza matricola viene usato lo username.
- AUD-04: nessun backfill; la Lista movimenti usa snapshot audit, fallback matricola/username corrente per legacy noto e null localizzato per legacy sconosciuto, senza esporre nome, cognome o email.
- Carico multilinea: un evento, più movimenti con lo stesso audit/autore e quantità totale corretta; replay e payload incompatibile con stessa key non duplicano audit, stock o movimenti.
- FEFO, Bolle e Trasferimenti: movimenti multipli condividono l'evento del comando; creazione/conferma/consegna/annullamento e creazione/avvio/ricezione producono gli eventi attesi; uscita e ricezione trasferimento usano i rispettivi utenti.
- Sanitizzazione: allowlist e filtro ricorsivo coprono password/hash, token, cookie, authorization, segreti SMTP, reset link, session identifier e valori annidati; non viene salvato l'intero `req.body`.

La validazione manuale/fisica resta esplicitamente non eseguita. Non sono stati avviati Docker candidato, M2, merge o modifiche a `main`.

## M1C — correzione post-code-review

Data: 16 settembre 2026

Base corretta: `0cecd5cd4857b17afbeb65672a75a579a5c6343d`

Stato: **hardening M1C verificato automaticamente; prova manuale non eseguita** (`OK-M1C/NE-MAN`).

### Idempotenza audit e integrità DB

- Ogni `operationKey` audit acquisisce ora un advisory transaction lock deterministico e non globale, namespaced su `audit-operation:<azione>:<operationKey>`, prima del lookup.
- Il replay con stessa azione, chiave, `entitaTipo` ed `entitaId` restituisce lo stesso evento. La stessa azione/chiave associata a un tipo o ID differente solleva `AUDIT_OPERATION_KEY_CONFLICT`; l'errore resta nella transazione del comando e ne provoca il rollback, senza eventi o collegamenti spuri.
- Il test PostgreSQL concorrente avvia due transazioni sulla stessa azione/chiave/entità: entrambe completano con lo stesso ID e resta una sola riga audit.
- La nuova migrazione incrementale `20260916_m1c_audit_hardening.sql` non modifica la migrazione M1C già pubblicata. Il vincolo ammette un attore di puro sistema senza iniziatore, un iniziatore attivo con ID e snapshot e un iniziatore storico con ID azzerato e snapshot conservato; respinge invece un ID iniziatore privo di snapshot.
- La cancellazione dell'iniziatore continua a usare la FK `ON DELETE SET NULL`: il trigger append-only consente il solo azzeramento tecnico dell'ID e conserva lo snapshot.

### Confini funzionali confermati

- Il registro supporta eventi con `actorType=system`, `actorUserId=null` e nessun iniziatore umano. Questo non abilita automaticamente i servizi inventariali a omettere `operatoreId` o `creatoDa`: i percorsi umani M1C restano obbligatoriamente attribuiti tramite sessione e `auditUserId()`.
- Le operazioni realmente automatiche senza operatore umano saranno integrate nel rispettivo workflow quando necessario, in particolare in M3 e nel censimento finale M6; schema e servizi Carichi non sono stati ampliati in questa correzione.
- `audit_eventi.motivo`, trim, limite e sanitizzazione sono disponibili in M1C. La Rettifica usa già una causale strutturata obbligatoria e richiede il testo quando `causale=altro`.
- L'annullamento Bolla continua invece a poter avvenire senza motivo testuale. L'obbligatorietà della ragione e la relativa esperienza utente restano requisito CAN-01 di M4B: M1C non lo completa e il flusso Bolla non è stato modificato.

### Gate della correzione

- Populated DB isolato: partenza con 34 migrazioni applicate, applicazione della sola 35ª e replay con `0 applied / 35 skipped`. Prima e dopo restano 21 lotti, quantità residua 1.624, 37 movimenti di cui 35 senza autore, 6 prenotazioni, 25 bolle, 3 trasferimenti, 10 scarichi e 2 carichi; restano inoltre 0 eventi audit e 0 collegamenti retroattivi dai movimenti. Pending, checksum mismatch e out-of-order sono a zero.
- Fresh DB isolato: bootstrap da database vuoto, schema Drizzle, 35 migrazioni, seed, health/login/cambio password, CRUD, replay, verifica checksum e stato finale senza pending/mismatch/out-of-order completati. Trigger append-only e nuovo vincolo validato sono presenti.
- Test backend mirati: 5 file e 83 test superati, inclusi helper audit, migrazioni M1C/hardening, idempotenza e rollback Carichi, Bolle e Trasferimenti.
- Migration runner PostgreSQL: 24 test superati. Suite API completa: 108 file, 1.173 test superati e 2 skip, senza fallimenti; resta il warning baseline del driver `pg` sui test concorrenti.
- `pnpm install --frozen-lockfile --offline`, typecheck workspace e codegen React/Zod sono completati; OpenAPI e output generati non hanno differenze. Prettier mirato e `git diff --check` sono i controlli documentali finali.

Non sono stati costruiti container Docker applicativi, né avviati M2 o merge su `main`.

## M1C — validazione manuale

Data: 16 settembre 2026

Candidato validato: `42352c37cb7b3e7eea4ddb38844d1527b711a8c5`

Stato: **M1C validato manualmente da Floriano** (`OK-M1C/OK-MAN-M1C`).

Floriano ha completato con esito positivo il dry run manuale del candidato Docker M1C. La validazione copre AUD-01, AUD-02, AUD-03 e AUD-04: sequenza multiutente A crea/B opera/C conclude, attribuzione dei nuovi movimenti tramite matricola dell'utente autenticato, storico legacy con fallback sicuro, coerenza di stock e prenotazioni, assenza di una nuova UI Audit e permanenza del registro comune come infrastruttura backend.

Gli esiti automatici M1C e del successivo hardening restano invariati. Questa chiusura documentale non modifica codice, schema, API, migrazioni o output generati e costituisce la base autorizzata per M2.

## M2 — sviluppo

Data: 16 settembre 2026

SHA iniziale richiesta: `42352c37cb7b3e7eea4ddb38844d1527b711a8c5`

Commit documentale di chiusura M1C: `44e05ac14e4af22f4385573285f2e42401cf8f2e`

Base M2: `44e05ac14e4af22f4385573285f2e42401cf8f2e`

Stato: **M2 pronto per `##test`, da validare** (`DEV-M2/NE-TEST-M2`). Il candidato M2 resta intenzionalmente nel working tree: non è stato creato né pubblicato alcun commit applicativo M2.

### Catalogo globale e quantità

- `prodotti` resta globale: non riceve Area, Magazzino o Centro. Il Catalogo conserva CRUD, ricerca, import e download barcode, ma non presenta più azione `Carica`, `CaricoForm`, selettori di deposito/fornitore o quantità di stock.
- `quantitaFrazionabile` è una proprietà persistita `NOT NULL`. Il default backend e la proposta iniziale della UI sono `true` soltanto per `kg`, `l` e `lt`; `pz`, `cf`, `conf` e le altre unità sono `false`. Dopo una scelta esplicita, il cambio U.M. non sovrascrive il valore.
- Il controllo di dominio comune `validateProductOperationalQuantity` usa `InventoryDecimal`: accetta interi semantici per prodotti non frazionabili e respinge nuove frazioni, senza `Math.round` o conversioni anticipate a `number`.
- La validazione è applicata a Carico, Scarico, Bolla, Trasferimento e agli input umani Emporio/Mensa. Le rettifiche inventariali motivate restano escluse dal blocco, così una frazione legacy può essere sanata senza autorizzare nuovi flussi ordinari frazionari.
- L'import bulk supporta i due nuovi campi, applica i default backend se la colonna non è presente, conserva `magazzino.products.manage` e registra audit per ogni prodotto creato. Creazione, modifica, attivazione e disattivazione Catalogo sono transazionali con audit M1C allowlist e attore di sessione.

### Lotto fisico e lotto logico

- La scelta definitiva per il precedente `gestioneLotto` è `lottoFisicoObbligatorio`. La migrazione rinomina la colonna, preserva tutti i valori preesistenti e il nuovo contratto elimina l'ambiguità: il flag richiede solo il codice del produttore; tutti i prodotti possono appartenere a un lotto logico.
- La nuova entità `lotti_logici` appartiene a un'Area e contiene codice, descrizione, date organizzative, note, stato `aperto|chiuso|archiviato`, flag `isGenerale`, autori e timestamp. Sono presenti FK Area, codice univoco nell'Area, unico `Generale` parziale per Area e check di stato/`Generale` aperto.
- Ogni Area esistente, anche inattiva, riceve esattamente un `GENERALE`; ogni nuova Area lo crea nella stessa transazione tramite helper idempotente. L'audit usa actor system `m2-area-general` e conserva l'utente iniziatore. `Generale` non è modificabile, chiudibile o archiviabile dall'API e non esiste endpoint distruttivo.
- I comandi espliciti create/update/close/reopen/archive usano `magazzino.view` in lettura e `magazzino.stock.receive` in gestione, rispettano lo scope Area e richiedono un motivo per la riapertura. Le mutazioni e i relativi eventi audit avvengono nella stessa transazione.
- `lotti.lottoLogicoId` è una FK nullable. Tutti i 21 dettagli fisici storici restano `null`; non vengono assegnati retroattivamente a `Generale`. I nuovi carichi risolvono il `Generale` quando il chiamante legacy omette l'ID e rifiutano magazzini senza Area, lotti di un'altra Area o non aperti.
- La business key fisica include magazzino, prodotto, lotto logico, fondo, fornitore, codice produttore normalizzato, scadenza e fattore. Un codice uguale in `Generale` e in una raccolta non viene fuso; fattori o scadenze differenti restano dettagli separati. Senza codice fisico non viene inventato `GENERALE`, `N/A` o altro valore sintetico.
- `maiCaricato` è distinto da `esaurito`. Quest'ultimo è derivato solo in presenza di dettagli, residuo preciso zero e assenza dimostrata di trasferimenti `in_transito`; non è una colonna o uno stato persistito. LOT-02/LOT-03 restano fondazioni parziali da completare in M4B.

### API, frontend e generated

- La sorgente OpenAPI espone `quantitaFrazionabile`, `lottoFisicoObbligatorio`, `lottoLogicoId`, DTO e sette operazioni per i lotti logici. React client e validatori/tipi Zod sono stati rigenerati con il codegen ufficiale, senza modifiche manuali ai generated.
- Il Catalogo mostra controlli e badge localizzati per frazionabilità e lotto fisico nelle sei lingue esistenti. La UI non mostra quantità modificabili né strumenti di carico.
- Non è stata introdotta una voce top-level “Lotti” e non è stata costruita una UI temporanea separata: lifecycle e selector M2 sono verificabili via API; l'integrazione operativa definitiva resta nel Carico M3.
- La Giacenza M1B continua ad aggregare per prodotto e U.M.; il lotto logico non moltiplica le righe aggregate.

### Migrazione 36 e populated DB isolato

La migrazione aggiunta è `lib/db/updates/20260917_m2_catalogo_lotti_logici.sql`, successiva alle 35 M1C. La prova pulita ha usato una copia isolata del candidato M1C; `magazzino-postgres` e la porta `5434` non sono stati usati.

| Dato                                       | Prima M2      | Dopo M2     |
| ------------------------------------------ | ------------- | ----------- |
| prodotti                                   | 12            | 12          |
| distribuzione U.M.                         | `cf=2, pz=10` | invariata   |
| requisito lotto fisico true/false          | `6/6`         | `6/6`       |
| prodotti con scadenza                      | 7             | 7           |
| prodotti frazionabili                      | —             | 0           |
| lotti fisici                               | 21            | 21          |
| quantità caricata/residua                  | `1741/1624`   | `1741/1624` |
| movimenti / quantità                       | `37/1701`     | `37/1701`   |
| prenotazioni / quantità                    | `6/60,01`     | `6/60,01`   |
| righe Bolla / quantità                     | `24/114,01`   | `24/114,01` |
| righe Trasferimento / quantità             | `3/25`        | `3/25`      |
| righe Scarico / quantità                   | `13/31`       | `13/31`     |
| righe Carico / quantità operativa          | `2/234`       | `2/234`     |
| eventi audit                               | 0             | 0           |
| Aree / Magazzini con Area / Magazzini null | `6/9/1`       | `6/9/1`     |
| lotti logici `Generale`                    | —             | 6           |
| dettagli fisici legacy con lotto logico    | —             | `0/21`      |

La diagnostica ha trovato due record reali `anomalia_quantita_legacy`, uno in `bolla_righe.quantita` e uno in `prenotazioni_magazzino.quantita`. Sono rimasti invariati e leggibili. Una fixture isolata aggiuntiva con caricato `500,5` e residuo `417,5` ha confermato che la migrazione non arrotonda neppure i dettagli fisici; la vista diagnostica li classifica senza correggerli. Il replay SQL è idempotente.

### Fresh DB e controlli di sviluppo

- Il fresh gate isolato ha completato schema, tutte le 36 migrazioni, seed, bootstrap mode senza utenti predefiniti, creazione del primo Super Admin tramite setup, login/cambio password, CRUD Area con `Generale`, replay, checksum e stato senza pending, mismatch o out-of-order.
- Test Catalogo/quantità/lotti logici e helper fixed-point: 2 file, 31 test passati.
- Regressioni Carico e Scarico: 3 file, 42 test passati; Trasferimenti, Bolle e Giacenze M1B: 3 file, 61 test passati.
- Regressione AGEA: 19 test passati e 1 fixture esterna opzionale saltata. Regressioni Emporio, Mensa e FSE: 5 file, 143 test passati.
- Frontend Catalogo/hardening/Giacenze: 3 file, 28 test passati; contratto OpenAPI/generated: 2 test passati.
- Dopo codegen e pulizia del diff, la riesecuzione mirata backend ha chiuso 6 file/96 test e quella frontend i 3 file/28 test pertinenti. In precedenza lo script unit frontend, pur invocato indicando i tre file, aveva eseguito anche l'intera suite unit del workspace: 66 file/364 test, tutti verdi. Questo controllo aggiuntivo non apre né sostituisce la fase separata `##test M2`; suite backend finale completa, Docker e manuale restano non eseguiti.
- `pnpm run typecheck`, codegen ufficiale, Prettier pertinente e `git diff --check` completati con esito positivo.

### Limiti e arresto

- La pratica Carico persistente M3A, l'import unificato M3B, il DDT e gli stati consegna M4, la richiesta Magazzino M5 e la regressione integrata non sono stati anticipati.
- Il lifecycle lotto logico è disponibile via API, non tramite una nuova pagina primaria. La selezione contestuale definitiva appartiene a M3.
- Non sono stati costruiti container applicativi M2, eseguiti test manuali M2, creati commit M2, effettuati push M2 o merge su `main`.

Condizione di arresto: **M2 pronto per `##test`, da validare**.

## M2 — test automatici

Data: 16 settembre 2026

Base M2 verificata: `44e05ac14e4af22f4385573285f2e42401cf8f2e`

Stato: **test automatici M2 superati; prova Docker/manuale non eseguita** (`OK-M2/NE-MAN`).

### Correzioni emerse durante la validazione

- La ricezione di un trasferimento conserva il lotto logico sorgente fra magazzini della stessa Area, anche se il lotto viene chiuso mentre la merce è in transito. Fra Aree differenti assegna invece il `Generale` dell'Area di destinazione, senza clonare il lotto nominativo e conservando il lineage tramite trasferimento, movimenti e `movimentoOrigineId`.
- Il seed/demo crea e riusa transazionalmente il `Generale` dell'Area e collega a esso tutti i nuovi dettagli fisici. I percorsi di reset eliminano i lotti logici prima delle Aree interessate.
- Le fixture di compatibilità che creano Aree o magazzini sono state adeguate al vincolo M2 senza modificare la semantica dei flussi esistenti. Il test del migration runner ora attende 36 migrazioni.

### Migrazione e database isolati

- Populated gate: copia M1C isolata con 35 migrazioni, aggiornata esclusivamente dal runner ufficiale alla migrazione 36. Il replay ha saltato tutte le 36 migrazioni e lo stato finale riporta zero pending, mismatch o out-of-order.
- I conteggi applicativi sono rimasti invariati: 12 prodotti, 21 lotti fisici, 37 movimenti, 6 prenotazioni, 24 righe Bolla, 3 trasferimenti, 10 scarichi e 2 carichi. Checksum del precedente requisito lotto fisico e delle quantità dei lotti invariati.
- Sono stati creati 6 `Generale` aperti per 6 Aree; tutti i 21 dettagli fisici legacy mantengono `lotto_logico_id=null`.
- Le due anomalie frazionarie reali preesistenti, in `bolla_righe` e `prenotazioni_magazzino`, restano identiche e leggibili. Nessuna quantità è stata arrotondata o corretta.
- Fresh gate: database realmente vuoto con 36 migrazioni, seed base senza utenti, bootstrap del primo Super Admin, login e cambio password, CRUD Area con `Generale`, prodotti `pz`/`kg`, lotto logico, carico frazionario coerente e Giacenze completati. Il replay e i checksum sono verdi.
- Il database originale `magazzino-postgres` non è stato interrogato né modificato e sul populated DB non è stato usato `drizzle-kit push`.

### Evidenze funzionali e di sicurezza

- Il rename runtime è univoco su `lottoFisicoObbligatorio`; `gestioneLotto` resta solo nella migrazione, nella documentazione storica e nei test di compatibilità espliciti. I valori dei prodotti esistenti sono preservati.
- Default backend e UI, override espliciti e PATCH dell'unità senza riscrivere la frazionabilità sono verificati. Il validatore comune usa `InventoryDecimal` e protegge Carico, Lotto/Carico legacy, Scarico, Bolla, Trasferimento, Emporio, Mensa, FSE+ e AGEA; la rettifica amministrativa motivata resta l'unico percorso ammesso per sanare una frazione legacy.
- CRUD e bulk Catalogo richiedono `magazzino.products.manage`, restano globali e producono audit transazionale con attore di sessione e payload allowlist. Un errore audit provoca rollback della mutazione.
- Il Catalogo frontend è solo anagrafica: non contiene `Carica`, quantità di stock, selettori di magazzino/fornitore o altre azioni inventariali. Le proprietà M2 sono localizzate nelle sei lingue e non è stata aggiunta una voce primaria “Lotti”.
- Lotto logico multiprodotto, dettagli fisici distinti per business key, codice produttore nullable quando consentito, scope Area, protezioni del `Generale`, lifecycle completo e audit/rollback sono verificati. Un utente limitato all'Area A non può gestire o usare un lotto dell'Area B.
- La Giacenza M1B continua a raggruppare per prodotto e unità, include il legacy con lotto logico nullo e non moltiplica le righe per lotto logico.
- LOT-02 e LOT-03 restano parziali: M2 dimostra collegamento, trasferimento same/cross-Area e ricezione a lotto chiuso; prenotazioni, visualizzazione completa, rientro e completamento del workflow restano M4B.

### Esiti dei gate finali

| Gate                              | Esito                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| migration runner PostgreSQL reale | 2 file, 24 test passati, 0 fallimenti                                               |
| suite API completa                | 111 file, 1.216 test passati, 2 skip, 0 fallimenti                                  |
| suite frontend completa           | 67 file, 368 test passati, 0 fallimenti                                             |
| E2E desktop reali                 | 4 test passati: Catalogo, Carico, Scarico+Bolla/FEFO e Trasferimento                |
| codegen React/Zod                 | due esecuzioni ufficiali con output identico; nessuna modifica manuale ai generated |
| `pnpm run typecheck`              | completato senza errori per l'intero workspace                                      |
| build workspace                   | completata con `PORT=4173 BASE_PATH=/`; API, frontend e mockup senza errori         |
| bundle budget                     | entry 1.257,4 KiB / 348,5 KiB gzip; delta M1C +1,2 KiB / +0,5 KiB gzip              |
| runtime config web                | PASS                                                                                |
| Prettier e `git diff --check`     | controlli pertinenti superati; nessun formatting massivo introdotto                 |

Gli skip API sono invariati e non nascondono scenari M2; la fixture esterna AGEA resta opzionale e documentata. Restano non bloccanti i warning baseline del driver `pg`, i warning sourcemap/chunk Vite e il warning di dimensione del bundle API. Il bootstrap fresh registra inoltre il warning best-effort preesistente del system log con attore tecnico `0`; i file responsabili sono invariati rispetto alla base M2.

Non sono stati costruiti container Docker candidati, eseguiti test manuali, avviati M3, effettuati merge o modifiche a `main`.

Condizione di arresto: **M2 test automatici superati — pronto per code review**.

## M2 — correzione post-code-review dello stato derivato

Data: 16 settembre 2026

Base corretta: `7868aaff9a3442f4c17b8361750496f98c50134a`

Stato: **hardening LOT-03 verificato automaticamente; prova Docker/manuale non eseguita** (`OK-M2/NE-MAN`).

Il calcolo `inTransito` del lotto logico non usa più `trasferimento_righe.lotto_id`, perché una riga richiesta può omettere la partita e lasciare che sia FEFO a selezionarla soltanto durante l'avvio. La fonte attendibile è ora il ledger materializzato: la query cerca un trasferimento con stato `in_transito`, un movimento collegato con `tipoMovimento=trasferimento` e `tipoDettaglio=uscita`, quindi risale dal `lottoId` effettivo al relativo `lottoLogicoId`. La ricerca si arresta alla prima corrispondenza.

Le semantiche derivate restano:

- `maiCaricato=true` soltanto senza alcun dettaglio fisico;
- `inTransito=true` quando almeno una partita del lotto logico è realmente uscita per un trasferimento ancora in transito;
- `esaurito=true` soltanto con almeno un dettaglio fisico, residuo complessivo zero e nessun trasferimento materializzato in transito.

La regressione su PostgreSQL isolato copre:

- riga Trasferimento senza `lottoId`, FEFO su una partita da 10, residuo origine zero, `inTransito=true` ed `esaurito=false`;
- FEFO su due partite da 5 dello stesso lotto logico, con due movimenti di uscita reali e stato derivato ancora in transito;
- trasferimento parziale di 5 su 20, con residuo 15, `inTransito=true` ed `esaurito=false`;
- ricezione same-Area, che rimuove il transito e conserva lotto logico e residuo complessivo a destinazione;
- ricezione cross-Area, che rimuove il transito dalla raccolta sorgente, assegna la merce al `Generale` ricevente e conserva il lineage nei movimenti.

I test mirati Lotto Logico M2, Trasferimenti e Giacenze M1B hanno chiuso 3 file e 48 test senza fallimenti. Il typecheck dell'intero workspace, Prettier pertinente e `git diff --check` sono verdi. Non sono stati modificati schema, migrazioni, OpenAPI, generated o modello Trasferimenti.

LOT-03 riconosce quindi correttamente il transito già materializzato nel ledger; resta parziale soltanto per rientro e altri comportamenti M4B non ancora implementati. Non sono stati costruiti container applicativi candidati, avviati M3 o effettuati merge/modifiche a `main`.

## M2 — validazione manuale

Floriano ha dichiarato esplicitamente M2 validato sul candidato `ca1b3aa5c0444aef8be61d1caf349c41dc436abc` dopo il rebuild Docker e il dry run Catalogo/Lotti/Quantità.

CAT-02, QTY-01 e LOT-01 passano a `OK-M2/OK-MAN-M2`. LOT-02 e LOT-03 restano fondazioni parziali M2: la validazione manuale non certifica prenotazioni, rientro, visualizzazione completa o gli altri completamenti demandati a M4B. Gli esiti automatici, i dati legacy e le milestone precedenti restano invariati.

Questa chiusura documentale non modifica codice, schema, API, migrazioni o output generati e costituisce la base autorizzata per M3A.

## M3A — sviluppo Carico Merce persistente

Data: 17 settembre 2026

Base reale M3A: `fdb856164f2316f100759ae16e7157f9f9e87676`, commit documentale che registra la validazione manuale M2 sulla SHA `ca1b3aa5c0444aef8be61d1caf349c41dc436abc`.

Stato: **candidato locale di sviluppo** (`DEV-M3A/NE-TEST-M3A`). Le modifiche M3A restano intenzionalmente senza commit e senza push; Docker candidato, suite complete, E2E reale e validazione manuale appartengono alla fase separata `##test M3A`.

### Mappatura D3 e semantica

- `carico_pratiche` conserva ID/codice stabile, versione ottimistica, stati `bozza|aperta|chiusa|annullata`, Area, Magazzino, lotto logico, provenienza/documento, autori e timestamp.
- `carico_pratica_righe` conserva le righe di lavoro anche incomplete. Una bozza non crea lotti fisici, carichi contabili o movimenti; una riga registrata riceve gli snapshot di U.M. e frazionabilità e non è più modificabile o eliminabile dagli endpoint ordinari.
- `carico_integrazioni` collega ogni comando idempotente alla testata contabile preesistente `carichi_magazzino`; `carico_integrazione_righe` collega univocamente la riga di lavoro alla riga contabile e impedisce a livello DB una seconda contabilizzazione.
- Gli effetti inventariali riusano esclusivamente `createWarehouseLoad` nella stessa transazione di integrazione, link, snapshot, audit e avanzamento versione. I consumer legacy `/carichi` e AGEA restano invariati e continuano a usare lo stesso servizio.
- `carico_pratica_rettifiche` collega la rettifica negativa motivata e idempotente a pratica, riga, lotto, movimento e audit. Se una partita consolida più fonti, la merce è prenotata/distribuita o le rettifiche precedenti esauriscono la quota ricostruibile, il comando viene bloccato senza forzare attribuzioni.

### Concorrenza, lifecycle e audit

- Ogni mutazione controlla la versione richiesta; un dato superato restituisce `409`. La registrazione usa chiave stabile, hash semantico, advisory lock e lock della pratica; il replay concluso precede la nuova validazione di versione/stato ma resta subordinato allo scope attuale.
- La prima registrazione porta la pratica ad `aperta`; le successive aggiungono integrazioni. `chiusa` blocca nuove righe, `riapri` e `annulla` richiedono motivo, e l'annullamento M3A è ammesso soltanto su bozza senza effetti. Chiudere la pratica non chiude il lotto logico.
- Creazione/modifica bozza, righe, registrazione, chiusura, riapertura, annullamento e rettifica usano attore di sessione e audit nella transazione. Il test di errore audit sulla rettifica dimostra rollback di quantità, movimento e link.

### API e interfaccia

- OpenAPI espone elenco/dettaglio, testata, righe, registrazione, rettifica e lifecycle; client React e Zod sono rigenerati dal codegen ufficiale.
- La voce primaria Magazzino è ora `Carico Merce` e apre `/carico-merce`; `/lotti`, storico Partite, rettifiche e import AGEA restano raggiungibili come percorso legacy.
- La pagina elenca pratiche per Area, Magazzino opzionale, ricerca, stato e date; il dettaglio mostra testata, righe da registrare, righe già registrate e integrazioni. Per i nuovi ingressi propone soltanto magazzini attivi della stessa Area.
- Il prodotto si sceglie da elenco scorrevole, ricerca nome/codice/barcode o `BarcodeScannerButton`. Barcode ignoto e fotocamera non disponibile non eliminano il lavoro; letture duplicate ravvicinate sono ignorate. La quantità usa un solo input per U.M. e normalizza la virgola senza arrotondare.
- `Generale — nessuna raccolta specifica` è il default visibile; una raccolta aperta può essere scelta o creata contestualmente usando il servizio M2. Pending, conferma prima della registrazione, idempotency key conservata dopo esito incerto e avviso di uscita con modifiche locali sono inclusi.

### Migrazione 37 e database isolati

La migrazione aggiunta è `20260918_m3a_carico_pratiche.sql`, successiva alle 36 pubblicate. Il runner ufficiale ha aggiornato una nuova copia populated da 35 a 37 migrazioni; M2 e M3A sono state applicate in ordine, poi verificate senza pending o checksum mismatch.

| Evidenza populated                           | Prima                                                                   | Dopo      |
| -------------------------------------------- | ----------------------------------------------------------------------- | --------- |
| prodotti / lotti / movimenti                 | 12 / 21 / 37                                                            | invariati |
| prenotazioni / carichi / audit               | 6 / 2 / 0                                                               | invariati |
| quantità prenotata / movimenti               | 60,010000 / 1701,000000                                                 | invariate |
| hash stock per magazzino/prodotto/fondo/U.M. | `d05b63e2f6ae6ef2aa59b207377ae1ae`                                      | identico  |
| hash prenotazioni / movimenti                | `ec87615b7ad5bccf4af768b6baa2fab9` / `1ca0c6d395d4a2659b9d4234616325a9` | identici  |
| pratiche / rettifiche M3A                    | —                                                                       | 0 / 0     |

Il fresh gate separato è partito da zero tabelle, ha materializzato lo schema, applicato e ripetuto tutte le 37 migrazioni, eseguito lo smoke API/CRUD e chiuso con zero pending, mismatch o out-of-order. L'utente `sadmin` e le password usate dal gate sono esclusivamente fixture temporanee del database isolato e non sono state scritte nel repository; il bootstrap applicativo e i suoi test preesistenti non sono stati modificati.

### Controlli di sviluppo eseguiti

- Backend M3A: 11 test passati su bozza cross-sessione, autori/versioni, 80+20, atomicità, retry sequenziale/concorrente, payload/key incompatibili, immutabilità, rettifica/impegni/audit rollback, lifecycle, gara registrazione/chiusura, riga estranea, lotto chiuso e scope.
- Regressione M1B/M1C/M2 e consumer legacy carichi/AGEA: 8 file, 101 test passati e 1 skip opzionale preesistente.
- Frontend M3A e hardening esistente: 2 file, 10 test passati. Lo scenario Playwright reale 80+20 è predisposto ma non eseguito, come richiesto dal confine fra sviluppo e `##test`.
- Migration runner: 10 test passati; fresh gate e replay 37/37 verdi.
- Codegen ufficiale React/Zod, typecheck API/frontend/librerie e Prettier pertinente eseguiti. Suite complete, build/budget, Docker candidato e prova fisica fotocamera/tablet non sono stati eseguiti in questa fase.

### Confine e rischi residui

- M3B non è iniziato: XLSX/XLS/CSV FSE+/AGEA non confluiscono ancora nella pratica M3A; il percorso import corrente è preservato e dichiarato legacy.
- La rettifica collegata è volutamente prudente: una partita consolidata da più apporti viene bloccata perché l'attribuzione non è affidabile. Non è stata introdotta una procedura generale di reso/storno logistico M4B.
- L'E2E preparato, la prova scanner su dispositivo reale e l'ispezione UX nelle sei lingue restano evidenze della successiva fase `##test M3A`; non sono considerate validate ora.
- Database originale `magazzino-postgres`, servizi/volumi originali, Docker candidato M2 e remoto di produzione non sono stati usati o modificati.

Condizione di arresto: **M3A pronto per `##test`, da validare**.

## M3A — test automatici Carico Merce persistente

Data: 17 settembre 2026

Base verificata: `fdb856164f2316f100759ae16e7157f9f9e87676`.

Stato: **test automatici M3A superati** (`OK-M3A/NE-MAN`). Docker candidato, prova scanner su dispositivo fisico e validazione manuale restano intenzionalmente non eseguiti.

### Correzioni emerse durante il test

- I selettori M3A hanno ora etichette accessibili distinte per Area, Magazzino, stato e attività, riutilizzando le traduzioni esistenti.
- Lo scenario Playwright non riusa più la stessa pagina: crea una bozza, chiude il primo contesto browser, accede da un secondo contesto e riprende la pratica. Un terzo contesto verifica il conflitto `409` fra due versioni concorrenti.
- La verifica Giacenze attende esplicitamente la risposta della seconda registrazione, così il controllo finale di 80+20=100 misura lo stock contabilizzato e non una risposta anticipata.

### Migrazioni e database isolati

- Su una copia popolata M2 con 35 migrazioni registrate, il runner ufficiale ha applicato M2 e M3A fino a 37/37. Il secondo passaggio ha applicato zero migrazioni; verifica e stato hanno chiuso con zero pending, mismatch, mancanti o fuori ordine.
- Prodotti, lotti fisici, movimenti, prenotazioni, carichi e bolle sono rimasti invariati. Gli hash semantici pre/post di stock, movimenti e prenotazioni sono rispettivamente `16355aa31bdc0c107614f89ef5670649`, `225b58842ed693e96c4daa288b20f610` e `6543192f88adc65f2606ae208050b9a3`.
- Il fresh gate è partito da zero tabelle, ha materializzato lo schema e registrato tutte le 37 migrazioni. Senza utenti iniziali, il primo account creato dall'API è diventato SuperAdmin, ha completato login e cambio password obbligatorio, quindi ha creato Area, lotto `Generale`, Magazzino e prodotto.
- Sul database fresh la bozza non ha prodotto carichi, lotti o movimenti; la registrazione ha creato una sola integrazione, un carico, un lotto e un movimento, con residuo e Giacenze pari a 10.

### Funzionale, concorrenza e regressione

- Backend M3A: 1 file, 11/11 test passati. Sono coperti bozza cross-sessione, autori/versioni, 80+20, atomicità, replay, richieste incompatibili, concorrenza, immutabilità, rettifica e lifecycle.
- Migration runner con PostgreSQL reale: 24/24 test passati, inclusi 14 test di integrazione.
- Frontend completo: 68 file, 374/374 test passati.
- Playwright desktop 1440×900: 1/1 scenario passato con tre contesti browser, ripresa reale della bozza, due integrazioni e conflitto di versione concorrente.
- Suite backend completa: i tentativi concorrente e seriale hanno evidenziato soltanto test preesistenti sensibili a isolamento/ordine. Ogni caso emerso è passato isolatamente: `fase5-super-admin`, `consegne-pagination-rbac` e `volontari-2-api` insieme 43/43; `m2-catalogo-lotti-logici` 14/14. Non è stata introdotta una correzione estranea a M3A.
- Codegen React/Zod eseguito due volte con output byte-identico. Typecheck workspace, build con `PORT=5173 BASE_PATH=/`, Prettier pertinente e `git diff --check` sono verdi.
- Bundle frontend principale: 1277,7 KiB, 353,6 KiB gzip, entro il budget corrente. Restano gli avvisi preesistenti Vite su sourcemap e chunk oltre 500 KiB.

### Limiti e osservazioni

- Il bootstrap fresh emette ancora un warning preesistente quando tenta il log di sistema `USER_CREATED` con attore sintetico `0`; la creazione, il ruolo SuperAdmin e il flusso successivo riescono. Il codice bootstrap non è stato modificato in M3A.
- Non sono state eseguite la prova fisica fotocamera/tablet, l'ispezione manuale nelle sei lingue o la validazione umana.
- Non è stata costruita un'immagine Docker applicativa candidata. PostgreSQL, reti e volumi usati dai gate sono esclusivamente temporanei e separati dagli ambienti originali.
- M3B non è iniziato; import XLSX/XLS/CSV e flussi logistici successivi restano fuori perimetro.

Condizione di arresto: **M3A test automatici superati — pronto per code review**.

## M3A — hardening post-code-review

Data: 17 settembre 2026

Base del correttivo: `c49cc0a99f88df90d074659a1b0a186285770873`.

### Coerenza fra draft e registrazione

- Ogni riga confronta deterministicamente il draft locale con lo snapshot persistito, normalizzando quantità, valori vuoti/null e testo secondo la stessa semantica del salvataggio.
- Una riga con quantità soltanto locale resta non selezionabile. Se una riga già selezionata contiene quantità, fondo, lotto produttore, scadenza, fattore o note non salvati, `Registra` è disabilitato e mostra un messaggio localizzato; il comando applica anche lo stesso controllo difensivo prima della chiamata API.
- Non è stato introdotto autosave: dopo `Salva bozza` il dettaglio aggiornato riallinea draft e persistenza, quindi la riga torna registrabile.
- Il guard delle modifiche non salvate riusa il dialogo comune e ora intercetta anche i link interni e la sidebar, oltre a refresh/chiusura browser e pulsante di ritorno.

Lo scenario E2E verifica una riga persistita con quantità 5, lotto `LOT-A` e scadenza `2027-12-31`, modificata localmente in quantità 8, lotto `LOT-B` e scadenza `2028-01-31`. Prima del salvataggio il comando resta bloccato, la navigazione verso Giacenze chiede conferma e, scegliendo di restare, conserva il draft; stock, integrazioni e movimenti restano a zero. Dopo il salvataggio, la registrazione produce una sola integrazione, un solo movimento da 8 e una sola partita `LOT-B` con la nuova scadenza.

### Gate suite API candidato/base

Entrambi i database sono partiti vuoti e hanno seguito lo stesso ordine: `pnpm --filter @workspace/db run push`, migration runner ufficiale `pnpm --filter @workspace/db run update`, nessun seed, quindi Vitest con `fileParallelism=false`, `--maxWorkers=1` e report JSON. La suite candidata ha eseguito per primo `accessi-emporio.test.ts`, il test M3A in posizione 24 e per ultimo `volontari-save-validation.test.ts`; la base ha lo stesso primo e ultimo file, senza il test M3A.

| Revisione                               | File | Passati | Skip | Falliti |
| --------------------------------------- | ---- | ------- | ---- | ------- |
| candidato `c49cc0a` + correttivo locale | 112  | 1.229   | 2    | 0       |
| base `fdb8561`                          | 111  | 1.218   | 2    | 0       |

Un tentativo preliminare basato sul solo `drizzle push` non è stato considerato un gate: mancavano i trigger e gli oggetti SQL del migration runner, a partire dalla protezione append-only dell'audit, e la conseguente cascata di errori era dovuta a un database inizializzato in modo incompleto. Con il flusso repository corretto, le failure intermittenti osservate nella precedente fase `##test M3A` non si riproducono né sul candidato né sulla base. Non sono quindi una regressione M3A riproducibile, né vengono dichiarate baseline provata. Fixture, cleanup scoped, stato dei moduli e concorrenza M3A non lasciano residui rilevati dalla suite completa.

### Regressione

- Backend M3A mirato: 1 file, 11/11 test passati.
- Frontend completo: 68 file, 376/376 test passati.
- Playwright M3A desktop: 2/2 test passati, inclusi stale draft e navigazione interna.
- Typecheck, Prettier pertinente e `git diff --check` superati.
- Nessun file backend, schema, OpenAPI, generated o migrazione è stato modificato dal correttivo.

Docker candidato e prova manuale non sono stati eseguiti; M3B non è iniziato.

Condizione di arresto: **M3A code review hardening completato — pronto per Docker**.

## M3A — validazione manuale e chiusura

Data: 17 settembre 2026

Base validata: `6eaf91c53e1990b8f157f938a668c9aea1e35264`.

Stato: **M3A validato manualmente e chiuso** (`OK-M3A/OK-MAN-M3A`).

Floriano ha completato con esito positivo il dry run reale della pratica Carico Merce sul candidato Docker costruito dalla stessa SHA. La prova ha confermato `LOAD-01` e `LOAD-02`: creazione e persistenza della bozza senza effetti inventariali, ripresa dopo l'interruzione, distinzione fra righe pendenti e registrate, contabilizzazioni incrementali 80+20 senza duplicazioni, blocco dei draft locali non salvati, aggiornamento del lotto fisico prima della registrazione, quantità frazionabili e indivisibili, ricerca prodotto, protezione della navigazione, conflitto fra sessioni, lifecycle della pratica, riconciliazione di Giacenze e Movimenti, audit e rettifica prudente.

Restano esplicitamente non eseguite:

- `NE-MAN-CAMERA`: scansione con fotocamera reale;
- `NE-MAN-TABLET`: prova su dispositivo tablet fisico.

Queste due verifiche fisiche non bloccano la chiusura M3A e non sono dichiarate superate. Il percorso AGEA/FSE+ legacy resta separato dalla pratica; M3B non è stato avviato.

La chiusura modifica esclusivamente la documentazione M3A. Non modifica codice applicativo, schema, API, migrazioni o file generati e non coinvolge `main`.

## M3B — sviluppo Importa file FSE+

Data: 18 settembre 2026

Base M3B: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`.

Stato: **M3B pronto per `##test`, da validare** (`DEV-M3B/NE-TEST-M3B`). Il candidato resta intenzionalmente non committato e non pubblicato; non sono stati avviati `##test M3B`, Docker candidato, M4/M5 o merge su `main`.

### Flusso e contratti implementati

- Carico Merce espone un solo ingresso contestuale `Importa file FSE+`, dalla lista o da una pratica vuota compatibile, con quattro passaggi: file e sorgente, associazioni/correzioni, riepilogo e aggiunta alla pratica.
- Upload e aggiunta non cambiano le giacenze. Le righe entrano nello stock esclusivamente tramite il comando M3A `Registra`; testata e righe riservate AGEA/saldo non sono modificabili dai normali endpoint manuali.
- Il parser rileva il formato dal contenuto e supporta XLSX, XLS binario e CSV con BOM, separatori, quote, multilinea e virgola decimale. Intestazioni normalizzate, data dinamica del Registro, foglio ambiguo, date italiane/ISO/seriali Excel, lotti testuali e quantità fixed-point sono gestiti senza euristiche americane o ricostruzione di zeri persi.
- File e righe raw sono persistiti con SHA-256, versione parser e profilo. Identità semantica e hash contenuto sono separati; claim attive, versioni e idempotency key impediscono doppie prese in carico fra sessioni, pratiche o magazzini. Lo stesso comando è ripetibile; la stessa chiave con payload diverso restituisce conflitto.
- Mapping prodotto è scoped alla sorgente. Correzioni e accettazione del fallback data sono revisionate e motivate. Creazione prodotto/barcode resta dietro `magazzino.products.manage`; l'attore deriva dalla sessione backend.
- L'import ordinario consente selezione parziale e ripresa delle righe escluse. Numero/data documento esterni restano strutturati sulla singola riga della pratica, senza DDT fittizio di testata.
- Il saldo iniziale richiede Registro e Giacenze coerenti, data di taglio, permesso amministrativo e magazzino senza storia. Genera una pratica `SALDO_INIZIALE`; la registrazione è integrale e attiva la copertura storica nella stessa transazione del movimento contabile.
- Il writer AGEA legacy è conservato per la consultazione ma viene bloccato per un magazzino già gestito da M3B. Gli eventi legacy applicati e ricostruibili partecipano alla classificazione senza backfill o modifica degli audit storici.

### Schema, API e migrazione

- La migrazione 38 aggiunge registro sorgenti, sessioni/file/righe stock e Registro, revisioni, comandi idempotenti, claim e copertura del saldo; estende in modo limitato mapping prodotti e metadati riga M3A. Non carica campioni, non crea stock e non attribuisce dati legacy.
- OpenAPI descrive sorgenti, upload binario, sessioni, mapping, revisione e aggiunta alla pratica; client React e Zod sono rigenerati dal comando ufficiale. Due esecuzioni consecutive hanno prodotto lo stesso diff generato.
- Il fresh gate disposable ha applicato e verificato 38/38 migrazioni, seed, login, cambio password, CRUD Area e replay con zero pending/mismatch/out-of-order.
- La migrazione 38 è stata provata separatamente su una copia popolata allo stato 37. Prima/dopo sono rimasti invariati 8 pratiche, 12 righe pratica, 8 integrazioni, 15 carichi, 16 lotti, 21 movimenti e 13 prodotti; hash lotti `13b4787be73ef782766cffc2372acb41` e movimenti `cdfdfe67bcf444c7ff318869a4ea2ca6` sono identici. Replay: 38 skip, zero pending.

### Prove di sviluppo eseguite

- Parser M3B: 9/9 test passati su XLSX, vero XLS Biff8, CSV, lotto `006544`, date/fallback, identità stabile, molteplicità ambigua, fogli multipli, oversize, file corrotto e contenuto attivo.
- API M3B + regressione M3A: 2 file, 14/14 test passati. Fixture sintetiche verificano upload/replay, pratica parziale 80+20, retry idempotente, metadati documento, blocco modifica manuale, zero movimenti prima di `Registra`, claim registrate, saldo iniziale atomico e blocco di una copertura positiva assente dalle Giacenze.
- Regressioni AGEA/M1B/M1C/M2: 4 file, 52 test passati e 1 skip opzionale preesistente.
- Frontend mirato: 2 file, 11/11 test passati su ingresso unico, separazione dallo stock, permessi e sei lingue.
- Playwright desktop 1440×900: 1/1 scenario sintetico passato con upload reale via UI, mapping prodotto, aggiunta senza stock, logout/nuovo contesto, registrazione da 10 pezzi, metadato documento visibile e re-upload rinominato senza raddoppio.
- Migration runner unitario: 10/10 test passati; typecheck dell'intero workspace verde. Prettier pertinente e `git diff --check` superati.

Un ultimo run combinato di 6 file ha chiuso 65 test e 1 skip, ma il test M2 sull'ordine di quattro eventi audit con timestamp equivalenti ha osservato `PRODOTTO_ATTIVATO` prima di `PRODOTTO_CREATO`. Lo stesso file è passato subito isolato 14/14 senza modifiche, mentre il gate finale M3B+M3A è passato 14/14. Il run combinato non viene dichiarato verde né promosso a suite completa; l'instabilità d'ordinamento preesistente resta evidenza da sorvegliare nel successivo `##test M3B`.

### Campioni e limiti

Gli Excel originali indicati dalla specifica non erano presenti nei percorsi autorizzati. Non sono quindi stati verificati né i due SHA-256 attesi né i riscontri reali T01/T25 (7 righe e 1.177 pezzi). Tutte le prove file di sviluppo hanno usato fixture sintetiche generate in memoria; non costituiscono nuovi export ufficiali SIFEAD e non contengono un CodiceAccesso reale.

Suite complete API/frontend, matrice E2E multi-viewport, build/budget, concorrenza estesa, originali Excel e validazione manuale appartengono alla futura autorizzazione separata `##test M3B`. Nessuna di queste prove è dichiarata superata in sviluppo.

Condizione di arresto: **M3B pronto per `##test`, da validare**.

## M3B — test, review e candidato pubblicabile

Data: 18 settembre 2026

Base verificata: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`.

Stato: **gate automatici M3B superati; candidato GO al commit/push**
(`OK-M3B/NE-MAN-CAMERA/NE-MAN-TABLET`). Non sono stati avviati M4/M5,
Docker candidato applicativo o merge su `main`.

### Dati reali e comportamento

- I due Excel originali richiesti sono stati letti in sola lettura e verificati
  con gli SHA-256 attesi: Registro
  `4e4b8ba724a35cb048d42070299c34b3ecfe673206390c8fde2d67c20488c901`
  e Giacenze
  `e1b4ab9c0b647adb0f3fb48bb4f0f76b493aee005933cb0a223a3218cba554de`.
- T01 conferma 239 righe/19 colonne del Registro e 7 righe/15 colonne delle
  Giacenze, con 80 carichi, 158 distribuzioni, 1 reso e saldo 1.177 pezzi.
- T25 conferma zero stock prima di `Registra` e una sola inizializzazione da
  1.177 pezzi dopo il comando. Le 24.216 entrate storiche non sono state
  trasformate in un carico operativo.
- La matrice T01–T35 è verde con evidenza automatica. Rimangono esplicitamente
  non eseguite la fotocamera reale (`NE-MAN-CAMERA`) e il tablet fisico
  (`NE-MAN-TABLET`); l'emulazione Playwright non viene presentata come prova
  hardware.

### Review e correzioni

La review statica e la seconda review non lasciano finding bloccanti. Sono
stati irrobustiti claim cross-magazzino, RBAC, immutabilità, versione delle
sessioni parziali, copertura del saldo, concorrenza con writer ordinari,
rilascio claim su annullamento, seriali Excel 1904, separazione Registro/saldo,
error mapping, compatibilità AGEA, optimistic version UI e target touch.

Durante la suite completa sono state corrette due assunzioni di test:

- il test migrazione 2.0B verifica i due indici unici parziali M3B che
  sostituiscono il precedente vincolo globale delle mappature;
- l'assert AGEA sul cambio mapping è ora limitato alle righe create dal test e
  non ingloba fixture M3B concorrenti del database condiviso.

Non sono stati rimossi assert, aggiunti retry casuali o introdotti skip. La
failure M2 sull'ordine audit osservata in sviluppo non si riproduce nel run
combinato finale (6 file, 83 pass, 1 skip) né nella suite completa; resta
registrata come “failure precedente non riprodotta”.

### Gate finali

- installazione frozen: superata, lockfile invariato;
- parser/backend M3B: 11/11 e 17/17;
- API completa: 114 file, 1.257 pass, 2 skip opzionali legacy, zero failure;
- frontend completa: 69 file, 379 pass, zero failure;
- Playwright: desktop 6 scenari passati; landscape e portrait 1 scenario
  richiesto ciascuno, con soli skip condizionati al viewport;
- runner migrazioni: 10/10 unit e 24/24 su PostgreSQL reale;
- fresh 38/38 e populated 37→38: replay/verify senza pending, mismatch o
  out-of-order e hash semantici pre/post identici;
- typecheck, due codegen byte-identici, build workspace, budget bundle,
  runtime config, Prettier e `git diff --check`: superati.

Le evidenze dettagliate sono in `REVISIONE_STATICA_M3B.md` e
`ESITI_TEST_M3B.md`. Le risorse PostgreSQL/Docker disposable e i report
temporanei sono rimossi nominativamente a chiusura; i servizi originali e le
risorse di altri progetti restano invariati.

Condizione di arresto: **M3B test automatici e review superati — candidato
pubblicabile sul solo branch `codex/magazzino-workflow-unificato`**.

## M3B — hardening post-review indipendente

Data: 18 settembre 2026

Base revisionata: `32a6953d4b2d07a4db2f747f4febdeb1e5230f0f`.
HEAD iniziale reale preservata:
`fcd445576bae9c10e9c155b29659009de5fdf5a1`.

Stato: **H1/H2/H3/H4 corretti e gate automatici verdi; candidato pronto per
nuova code review** (`OK-M3B/NE-MAN-CAMERA/NE-MAN-TABLET`). Non sono stati
avviati Docker candidato, M4/M5 o merge su `main`.

### Correzioni

- H1 separa identità esterna originale, identità operativa accettata e alias
  verificati. La nuova migrazione 39 conserva alias per sorgente/evento
  canonico senza riscrivere le prime 38 migrazioni o i dati storici.
- H2 valida pratica, versione, stato e contesto esclusivamente dopo lock e
  rilettura autorevole; un update stale non aggiunge righe o claim.
- H3 consente per `NUOVI_CARICHI` l'aggiunta atomica delle sole righe valide
  selezionate anche con eccezioni pendenti. Le righe escluse restano
  riprendibili e non vengono riselezionate dopo refetch; il saldo resta
  integrale.
- H4 conserva idempotency key e payload canonico dopo una risposta incerta. Un
  retry ripete esattamente la stessa intenzione; una nuova intenzione usa una
  nuova key e un `409` resta definitivo e visibile.

### Evidenza finale

- backend M3B 25/25 e frontend dedicato 5/5;
- API completa finale su database fresco e dipendenze da lockfile: 114 file,
  1.263 pass, 4 skip, zero failure;
- frontend completa: 69 file, 381 pass;
- Playwright desktop: 22 pass e 4 skip di viewport; tablet emulato portrait e
  landscape: 2 pass e 8 skip desktop intenzionali;
- T01/T25 sui due originali: sette partite, 1.177 pezzi, nessun effetto prima
  di `Registra` e nessun carico storico al reimport;
- runner 24/24, fresh/replay 39/39 e upgrade populated 38→39 con ledger,
  movimenti, legacy e audit invariati;
- typecheck, build, budget, runtime config, Prettier e `git diff --check`
  verdi;
- OpenAPI e generated invariati; codegen non pertinente al delta.

Restano non eseguite e non dichiarate superate la fotocamera reale
(`NE-MAN-CAMERA`) e il tablet fisico (`NE-MAN-TABLET`). Nessuna validazione
umana è implicata.

Condizione di arresto: **M3B hardening post-review completato — candidato
automatico pronto per nuova code review ChatGPT**.

## M3B — validazione manuale e chiusura M3

Data: 18 settembre 2026

Candidato validato: `c4da09c1c16d62bd25cddf36a04e8e7871e417d4`.

Stato: **M3B validato manualmente da Floriano e chiuso**
(`OK-M3B/OK-MAN-M3B/NE-MAN-CAMERA/NE-MAN-TABLET`).

Floriano ha completato con esito positivo il dry run manuale e ha approvato il
workflow M3B. Le prove automatiche e le evidenze dettagliate già registrate
restano valide e distinte dalla validazione umana; questa chiusura non le
duplica né attribuisce al dry run verifiche di dettaglio non fornite.

Restano esplicitamente non eseguite e non dichiarate superate:

- `NE-MAN-CAMERA`: prova con fotocamera reale;
- `NE-MAN-TABLET`: prova su dispositivo tablet fisico.

Le due prove hardware non bloccano la chiusura. M3A è chiuso e validato,
M3B è chiuso e validato e **M3 complessivamente è CHIUSO**.

Il workflow Carico Merce consolidato comprende pratica persistente e
riprendibile, contabilizzazioni incrementali, barcode, quantità coerenti con
M2, import FSE+/AGEA XLS/XLSX/CSV, associazione o creazione prodotti, gestione
anomalie, import parziale, anti-sovrapposizione, identità esterna preservata,
retry idempotente, saldo iniziale, copertura storica, protezioni di
concorrenza e integrazione con ledger e audit comuni.

Questa chiusura modifica esclusivamente la documentazione M3B. Non modifica
codice applicativo, schema, API, migrazioni, OpenAPI o file generati, non
coinvolge `main` e non avvia né descrive come implementato M4/M5.

## M4A — sviluppo documento operativo comune

Data: 19 settembre 2026

Base locale/remota: `8df6b823bb14604af0123ea62ce7b237b32561c8` sul branch
`codex/magazzino-workflow-unificato`. M3 complessivamente chiuso; fotocamera
reale e tablet fisico restano `NE-MAN-CAMERA`/`NE-MAN-TABLET`.

Stato: **sviluppo M4A predisposto, fase formale `##test` non eseguita**
(`DEV-M4A/NE-TEST-M4A/NE-MAN`).

Il delta introduce destinatari Beneficiario/Ente con vincolo esclusivo,
classificazione inventariale `CONSEGNA_ENTE`, facciata comune server-side per
lista/dettaglio Bolle e Trasferimenti, UI operativa unica con creazione e
azioni sull'aggregato autorevole, PDF tipizzato e compatibilità del vecchio
URL. Scarichi Manuali resta distinto; il trasferimento continua a usare il
workflow e il ledger esistenti.

È aggiunta la migrazione 40
`20260919_m4a_documenti_destinatari.sql`; le prime 39 non sono modificate.
OpenAPI è stato aggiornato prima del codegen e due generazioni consecutive non
hanno prodotto errori o churn. Il fresh gate isolato applica 40/40 migrazioni,
esegue seed/smoke/replay/verify senza pending o mismatch. I test backend mirati
Documento comune/Bolle/Trasferimenti passano 65/65; il test frontend PDF
mirato passa 1/1. Typecheck e `git diff --check` di sviluppo sono verdi. Un
primo run mirato ha evidenziato e permesso di correggere snapshot legacy,
motivo annullamento, query scope con array SQL e teardown della nuova FK; non
viene conteggiato come verde. Non è stata eseguita la fase formale `##test`, né
una suite completa, né Docker candidato/persistente, né validazione manuale.

Il ciclo affidamento/mancata consegna/rientro, le prenotazioni Trasferimento e
la chiusura complessiva di CAN-02/LOT-02/LOT-03 restano M4B.

## M4A — test formale bloccato in revisione

Data: 19 settembre 2026

Base verificata: `8df6b823bb14604af0123ea62ce7b237b32561c8`.

Stato: **NO-GO; candidato locale preservato, nessun commit/push**
(`BLOCKED-M4A/NE-TEST-M4A/NE-MAN`).

La revisione statica ha rilevato finding bloccanti prima dei gate PostgreSQL:
`CONSEGNA_ENTE` non è propagata come uscita nei consumer contabili comuni; la
facciata Trasferimenti richiede modulo e permesso Bolle; i nuovi comandi non
dispongono del contratto completo versione/idempotency/hash; i dati Ente live
prevalgono sugli snapshot congelati; lista/export/URL comuni sono incompleti;
lo storno amministrativo Bolla precedente non è più raggiungibile da una route
runtime distinta.

Il controllo `pnpm run typecheck` è verde. Il primo run frontend pertinente ha
chiuso 47 test passati e 1 fallito: la regressione di navigazione attende ancora
la voce Trasferimenti protetta da `magazzino.view`. Fresh, upgrade populated
39→40, suite complete, E2E, build, budget, runtime e codegen finali non sono
stati eseguiti e non vengono dichiarati superati.

Le evidenze dettagliate e la matrice T01–T32 sono registrate in
`REVISIONE_STATICA_M4A.md` ed `ESITI_TEST_M4A.md`. Non sono state create
risorse Docker/PostgreSQL M4A; l'ambiente persistente è stato soltanto censito
in lettura e non aggiornato. M4B e `main` non sono stati toccati.

## M4A — correzione e completamento post-NO-GO

Data: 19 settembre 2026

Base pubblicata:
`8df6b823bb14604af0123ea62ce7b237b32561c8`, branch
`codex/magazzino-workflow-unificato`.

Stato corrente: **correzioni M4A completate nel working tree, nuova fase
formale non eseguita e validazione manuale non eseguita**
(`DEV-M4A-CORRETTO/NE-TEST-M4A/NE-MAN`).

Il **NO-GO** registrato nella sezione precedente resta l'esito storico
dell'ultima fase formale. Questa sezione non lo riscrive come GO, non chiude
M4A e non attribuisce alle prove di sviluppo lo stato di validazione formale o
umana.

### Correzioni consolidate

- `CONSEGNA_ENTE` è trattata come uscita fisica nei consumer contabili e di
  riconciliazione, senza quantità negative persistite o conteggi sociali
  fittizi.
- La facciata comune separa autorizzazioni Bolle e Trasferimenti prima di
  lista, totale, paginazione ed export. Il profilo con `magazzino.view`
  conserva la consultazione Trasferimenti senza ricevere mutazioni Bolle;
  Mensa mantiene il proprio contratto.
- I comandi adattati condividono chiave idempotente, hash semantico, versione,
  ricevuta transazionale, replay dopo rivalidazione dello scope e audit
  atomico. Lock e rilettura autorevole precedono gli effetti; l'ordine dei lock
  Bolla/Consegna/Beneficiario/Magazzino/planning/lotti è deterministico.
- Snapshot Ente congelati, campi null intenzionali e fallback legacy hanno una
  fonte esplicita e coerente fra dettaglio e PDF.
- Lista, ricerca, filtri, ordinamento, conteggio ed export comuni operano sullo
  stesso insieme autorizzato. URL e query key identificano l'aggregato con
  `bolla:<id>` o `trasferimento:<id>` e preservano deep link e draft.
- Lo storno amministrativo è nuovamente raggiungibile come comando distinto
  dall'annullamento ordinario, con permesso, motivo, idempotenza, audit e
  rollback atomico; non introduce i rientri previsti per M4B.
- La seconda rilettura indipendente del delta corretto non ha rilevato blocker
  M4A residui.

### Schema e contratti

La migrazione candidata 40 resta
`20260919_m4a_documenti_destinatari.sql`; le prime 39 migrazioni pubblicate
restano invariate. Il fresh finale applica 40/40 migrazioni e completa
seed/smoke/replay/verify. Anche l'upgrade autentico populated 39→40 è verde
nella fase correttiva. OpenAPI resta la fonte del contratto; due codegen
consecutivi producono 842 file byte-identici.

### Prove mirate conclusive

| Prova               | Esito                                                                              |
| ------------------- | ---------------------------------------------------------------------------------- |
| backend coordinato  | PASS, 11 file / 273 test                                                           |
| Mensa isolata       | PASS, 72/72 test                                                                   |
| Bolle isolata       | PASS, 2 file / 57 test                                                             |
| frontend completo   | PASS, 74 file / 408 test                                                           |
| Playwright desktop  | primo run FAIL per locator ambiguo; correzione puntuale; rerun 3/3 PASS            |
| PDF reale snapshot  | PASS, A4 una pagina, 3,2 MiB; A presente, B assente; render leggibile/non tagliato |
| migration runner    | PASS, 10/10 test                                                                   |
| workspace typecheck | PASS                                                                               |
| build API/frontend  | PASS; warning sourcemap/chunk frontend non bloccanti registrati                    |
| budget frontend     | PASS, 1306,8 KiB / 361,4 KiB gzip                                                  |
| Prettier pertinente | PASS sul delta non generato; generated lasciati all'output ufficiale del codegen   |
| `git diff --check`  | PASS                                                                               |

I tre E2E coprono Beneficiario con risposta persa, Ente con
snapshot/fallback legacy e Trasferimento con conservazione del draft. Le porte
temporanee API/frontend 18181 e 4173 risultano chiuse. Dettaglio dei comandi,
della lettura T01–T32 e dei limiti è in `ESITI_TEST_M4A.md`; la rilettura dei
finding resta in `REVISIONE_STATICA_M4A.md`.

### Ambiente e arresto

Le prove hanno usato esclusivamente il laboratorio effimero censito in
`AMBIENTE_TEST.md`; `magazzino-web`, `magazzino-api`, `magazzino-postgres` e i
relativi volumi persistenti sono rimasti invariati. Il cleanup nominativo
finale del container e degli output PDF/render/Playwright è completato e
verificato, senza prune o rimozioni globali.

Il working tree resta non pubblicato: nessun commit, staging per pubblicazione,
push, merge o modifica di `main`; nessun rebuild o migrazione del Docker locale
persistente. Il passo successivo resta un nuovo `##test M4A` completo. M4B non
è iniziata.

## M4A — rerun formale finale post-correzione

Data: 22 settembre 2026. Stato del candidato:
**`OK-M4A/NE-MAN`**. Il precedente NO-GO e la successiva fase
`DEV-M4A-CORRETTO/NE-TEST-M4A/NE-MAN` restano registrati sopra come storia,
non vengono retroattivamente trasformati in PASS.

Sul working tree corretto sono stati rivalutati F1–F8, T01–T32 e G1–G8:
tutti i gate automatici risultano GO. La suite API completa ha 1308 pass e
due skip opzionali AGEA; la frontend 408/408 pass; Playwright completo
`--retries=0` ha 66 pass e 99 skip di progetto/viewport previsti. La prova
E2E comprende tre destinatari, ripresa della bozza Ente, replay dopo risposta
persa anche della conferma versionata, PDF FEFO/multipagina e regressioni
M1–M3 con i due Excel originali. Il fresh 40/40, l'upgrade autentico
populated 39→40, il runner 24/24, il codegen ripetuto byte-identico,
typecheck, build, budget, runtime, Prettier e diff check sono verdi.

I tentativi intermedi e le correzioni minime dei test E2E sono documentati in
`ESITI_TEST_M4A.md`; la chiusura motivata F1–F8 è in
`REVISIONE_STATICA_M4A.md`. Gli output PDF/render e i tre container
PostgreSQL disposable M4A sono stati rimossi nominativamente; l'ambiente
Docker persistente non è stato ricostruito, migrato o modificato. Restano
`NE-MAN-CAMERA`, `NE-MAN-TABLET` e la validazione manuale M4A: non sono
dichiarati superati. M4B non è iniziata; `main` non è stato modificato.

## M4A — hardening post-code-review ChatGPT

Data: 23 settembre 2026. Base pubblicata locale/remota:
`18765925706ff4d1bcd6c8f57e0371d78a492136` sul branch
`codex/magazzino-workflow-unificato`. Il GO G1–G8 precedente resta storico;
la review ha riaperto M4A con CR-M4A-01 e CR-M4A-02. Stato attuale:
**correzioni nel working tree, `NE-TEST-M4A/NE-MAN`**, senza commit/push.

- CR-M4A-01: il Trasferimento rispetta il lotto fisico scelto sotto lock,
  rivalida disponibilità netta e non ripiega su FEFO; senza lotto conserva
  FEFO multi-partita. Form di creazione/modifica, draft, dirty guard e
  payload ora mantengono la selezione, obbligatoria quando richiesta dal
  prodotto. `GET /lotti` espone la disponibilità netta per il selettore;
  OpenAPI/client sono stati rigenerati. Nessuna migrazione/schema.
- CR-M4A-02: la Zona UDS filtra solo Bolle Beneficiario; Bolle Ente seguono
  Area, Magazzino visibile, RBAC e feature flag in liste, dettaglio ed export.
  La sessione UDS senza Area resta fail-closed, coerentemente fra lista e
  dettaglio, senza concedere visibilità globale all'Ente.

Prove di sviluppo: API M4A/Trasferimenti 44/44, frontend mirato 5/5 e
frontend completo 411/411, typecheck workspace, codegen e `git diff --check`
verdi. L'intera suite API esplorativa ha 1312 pass, 2 skip e 3 failure:
due per un percorso Excel originale digitato erroneamente e una per un test
M2 che asserisce un ordine SQL senza `ORDER BY`; i tre file ripetuti con il
percorso corretto passano 50/50. Il primo run API mirato aveva inoltre
individuato una fixture di cleanup non FK-safe per il nuovo lotto esplicito
e un'asserzione testuale troppo rigida; corretti e ripetuti verdi. Nessuna
failure è promossa a PASS della suite completa.

T09/T10 e i gate G1–G8 devono essere rivalutati su questo nuovo candidato
nel separato `##test M4A`. Docker persistente non aggiornato, M4B non avviato,
`main` invariato.

## M4A — rerun formale post-code-review hardening

Data: 23 settembre 2026. Base `18765925706ff4d1bcd6c8f57e0371d78a492136`;
**M4A post-code-review test automatici superati — candidato pronto per nuova
code review ChatGPT**. La revisione statica ha chiuso CR-M4A-01 (lotto fisico
esplicito nel Trasferimento, senza fallback FEFO) e CR-M4A-02 (scope UDS
coerente per Ente, senza indebolire il Beneficiario). T09/T10 e T01–T32 sono
stati rivalutati; G1–G8 risultano GO per il perimetro automatico.

Sul candidato finale: API completa 116 file/1315 pass/2 skip opzionali,
frontend completa 75 file/411 pass, Playwright completo senza retry 67 pass
e 103 skip di progetto/viewport. Fresh 40/40, upgrade populated 39→40,
runner migrazioni 24/24, codegen ripetuto con hash identico, typecheck,
build, budget, runtime, Prettier e diff check sono documentati in
`ESITI_TEST_M4A.md`. Le failure diagnostiche e le correzioni pertinenti
restano nello stesso rapporto; non sono state convertite retroattivamente
in PASS.

L'unico PostgreSQL disposable di questa fase e i file temporanei sono stati
rimossi nominativamente. `magazzino-web`, `magazzino-api`,
`magazzino-postgres` e i volumi persistenti sono invariati; nessun nuovo
Docker locale è stato costruito. Restano **NE-MAN** la validazione umana M4A,
**NE-MAN-CAMERA** la fotocamera reale e **NE-MAN-TABLET** il tablet fisico.
M4A non è dichiarato chiuso; M4B non è iniziata e `main` non è stato toccato.

## M4A — tentativo di aggiornamento Docker persistente: NO-GO

Data: 23 settembre 2026. Il commit applicativo approvato
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e` è rimasto invariato;
API e web M4A sono state costruite dalla stessa SHA dopo backup certificati
di DB e upload. Sul database locale **reale** (39 migrazioni), la nuova API
non ha potuto applicare la migrazione 40: la creazione dell'indice
`bolle_consegna_attiva_unique` incontra due Bolle legacy `consegnato`
(`3093`, `3094`) con lo stesso `consegna_id=3868`. La prova populated
automatica precedente non comprendeva questo caso. **M4A non è installato
né pronto per il dry run manuale.** Nessun dato legacy è stato corretto
automaticamente e il web M4A non è stato avviato.

La migrazione fallita è stata rollbackata transazionalmente: ledger 39,
schema M4A assente, conteggi e stock invariati. Le immagini precedenti
API/web sono state ripristinate; l'ambiente persistente precedente è di
nuovo operativo e healthy con gli stessi container DB/web e gli stessi
volumi. I backup durevoli verificati e la diagnosi completa sono in
`AMBIENTE_TEST.md`. Il solo delta Git è documentale e resta non committato;
nessun push/merge su `main` o sul branch dedicato.

Stato: test automatici del commit M4A già superati, ma **installazione
Docker M4A bloccata / NE-MAN**. Serve una decisione esplicita su come
trattare le due Bolle storiche o un hardening della migrazione M4A,
seguito da nuova prova su copia popolata rappresentativa e da un nuovo
tentativo protetto. Fotocamera e tablet fisici restano `NE-MAN-CAMERA` e
`NE-MAN-TABLET`. M4B non è iniziata.

## M4A — `##db-cleanup + docker`: NO-GO per FK del ledger

Il 23 settembre 2026 è stata autorizzata una pulizia distruttiva **solo** dei
documenti legacy incompatibili del DB locale, senza modificare `movimenti`,
audit o stock. Backup frozen e upload verificati per dimensione/hash;
PostgreSQL disposable con dump frozen ripristinato e poi rimosso. Il clone
contiene una sola collisione, Bolle 3093/3094 su `consegna_id=3868`.

Il censimento FK ha mostrato che anche la Bolla 3094 ha uno scarico fisico
reale (movimento 2296, 4 cf), con FK `ON DELETE RESTRICT` sia a `bolle` sia a
`bolla_righe`. Eliminarla lasciando il ledger invariato è impossibile con lo
schema corrente. In applicazione della clausola di arresto del prompt,
**nessuna cancellazione è stata effettuata** sul clone o sul DB reale; nessun
retry della migrazione 40, nessun cambio API/web. Stock e container
persistenti restano invariati. Il dettaglio è in `AMBIENTE_TEST.md`.

Stato: **NO-GO cleanup/upgrade Docker M4A; M4A non `READY-MANUAL`, NE-MAN**.
Occorre una nuova decisione esplicita sul trattamento del movimento storico
e dei suoi riferimenti documentali. Nessun commit/push; M4B non avviata,
`main` non toccato.

## M4A — reset storico Bolle/Consegne locale e installazione Docker

Il 23 settembre 2026 Floriano ha autorizzato un **nuovo perimetro**: azzerare
lo storico locale Bolle/Consegne e le sue dipendenze, inclusi i movimenti
inventariali Bolla, mantenendo stock fisico, lotti, Carichi, import,
Trasferimenti indipendenti e utenti. Il precedente NO-GO resta documentato.
Backup frozen DB/upload verificati e backup DB supplementare creato a
scritture congelate; dettagli, hash e grafo FK in `AMBIENTE_TEST.md`.

Sul clone tmpfs il reset transazionale ha eliminato 25 Bolle, 24 righe,
391 Consegne, 21 movimenti Bolla e le dipendenze Emporio/Interventi;
0 Bolle/Consegne, stock 1.079 pz / 388 cf e digest dei domini KEEP invariati.
Il runner ufficiale ha applicato solo la migrazione 40, status/verify 40/40 e
replay 0. API clone health/readiness 200; tre file test API mirati 53/53
verdi, più prova transazionale del vincolo una Bolla attiva per Consegna e
della nuova preparazione dopo annullamento. Laboratorio Docker rimosso.

Il medesimo SQL validato sul clone è stato poi eseguito sul DB persistente
con web/API fermati; gli assert sono passati e gli stessi conteggi sono
stati cancellati. Stock, lotti e record indipendenti sono rimasti invariati.
La nuova API/web alla SHA
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e` sono stati ricreati
separatamente nello stesso progetto Compose, mantenendo DB e volumi. API
healthy, migrazione 40 applicata, status/verify 40/40, indice unico presente;
HTTP health, readiness, login e route web 200. Bolle e Consegne finali zero.

**Smoke autenticato ancora non eseguito:** il Mac era bloccato e non sono state
usate credenziali; il login dell'utente esistente e la navigazione dei dati
nelle viste restano alla prossima verifica con Floriano. Non è stato
finalizzato alcun nuovo movimento reale. Fino a tale verifica, installazione
M4A riuscita ma `READY-MANUAL` non confermato integralmente; validazione
manuale M4A resta `NE-MAN`. Nessun commit/push, M4B non avviata, `main`
invariato.

## M4A — validazione manuale e chiusura

Floriano ha successivamente comunicato **«validazione manuale PERFETTA»** per
l'ambiente M4A installato alla SHA applicativa
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e`: esito funzionale manuale
**PASS**, ambiente locale operativo e applicazione utilizzabile, senza blocker
M4A residui segnalati. La dichiarazione completa lo stato che nel paragrafo
precedente era ancora `NE-MAN`; non attribuisce a Floriano singole prove non
documentate.

I gate automatici G1–G8 e la code review ChatGPT, incluso l'hardening
CR-M4A-01/02, erano già GO. Il Docker persistente usa la SHA sopra, il DB è
a 40/40 migrazioni dopo il reset locale autorizzato dello storico
Bolle/Consegne, e lo stock resta 1.079 pz e 388 cf. I backup frozen e
supplementare sono conservati. Durante il post-deploy, la schermata bianca
su `http://localhost:8082/` è stata ricondotta a un vecchio bundle JS nella
cache del browser `localhost`: `127.0.0.1` funzionava e la pulizia locale
dei dati/cache del sito ha risolto. È un incidente di cache browser
post-deploy, **non** un finding software; nessuna patch applicativa o modifica
di `nginx.conf` è stata necessaria.

**M4A CHIUSA — `OK-M4A/OK-MAN-M4A`.** Il documento operativo comune integra
destinatari Beneficiario/Ente/Altro Magazzino, Bolle e Trasferimenti,
snapshot Ente, PDF, lotto fisico esplicito/FEFO, scope, idempotenza, audit,
lista/export, migrazione e Docker persistente. Restano separati e non
bloccanti `NE-MAN-CAMERA` e `NE-MAN-TABLET`: non risultano dichiarate prove
con fotocamera reale o tablet fisico. M4B **non avviata**; nessun merge/push
su `main`.

## M4B.1 — sviluppo prenotazioni comuni e Trasferimento Pronto

Base: M4A chiusa, branch `codex/magazzino-workflow-unificato`, SHA iniziale
`be033bf565c82dccb8187d8cf72e2d1d1732a474`. Sviluppo solo nel working
tree: nessun commit, staging, push, merge, aggiornamento Docker persistente o
avvio di M4B.2.

La migrazione 41 estende `prenotazioni_magazzino` con owner Trasferimento
esclusivo e vincoli testata/riga; conserva le prenotazioni Bolla e i
Trasferimenti storici. Bolla e Trasferimento condividono ora il servizio di
prenotazione FEFO/lotto esplicito. La creazione del Trasferimento resta senza
effetto stock; il nuovo comando «Segna pronto» prenota tutte le righe in una
transazione, «Avvia» scarica esattamente le partite prenotate, «Annulla» prima
dell'uscita libera gli impegni senza movimento. Stato, scope, permessi,
versione, audit e ricevuta sono verificati nel comando. La UI comune,
Trasferimenti e Mensa distinguono Richiesto da Pronto.

Prove di sviluppo su PostgreSQL isolato: bootstrap e migrazioni 1–41
applicate e verificate (41 applicate, 0 pending); suite mirate
Trasferimenti/M4A/Mensa 121/121 e M4B.1/Bolle 58/58, frontend 411/411.
La suite API completa, ripetuta serialmente su un database nuovo, ha dato
117 file verdi, 1323 test superati e 4 skipped. Una corsa precedente sul DB
già usato da altre prove aveva un fallimento 404/409 in un test storico
Interventi: lo stesso file è passato isolatamente (24/24) e poi nell'intera
suite sul DB nuovo. Sono passati typecheck e build API; la build workspace
su macOS è bloccata dalla configurazione preesistente che esclude il binario
`lightningcss-darwin-arm64`, non da un errore TypeScript/M4B.1. La fase
formale `##test M4B.1`, la prova populated 40→41 e la validazione manuale
restano non eseguite.

**Stato: `DEV-M4B.1/NE-TEST/NE-MAN`**; M4A resta
`OK-M4A/OK-MAN-M4A`. Docker persistente non aggiornato.

## M4B.1 — validazione formale automatica post-sviluppo

Il `##test` ha ripreso e preservato il working tree M4B.1 dalla base
`be033bf565c82dccb8187d8cf72e2d1d1732a474` sul solo branch dedicato.
Il precedente stato `DEV-M4B.1/NE-TEST/NE-MAN` e i limiti di sviluppo sopra
restano parte della cronologia; i rapporti formali sono
`ESITI_TEST_M4B1.md` e `REVISIONE_STATICA_M4B1.md`. La revisione locale ha
chiuso l'escalation implicita dei nuovi permessi Mensa standard, l'attesa
obsoleta 40→41 del runner e ha aggiunto prove PostgreSQL/E2E per i casi
concorrenti e UI mancanti. Nessun refactoring fuori perimetro.

SQL diretto, fresh 41/41, runner e **upgrade autentico popolato 40→41**
sono verdi: vecchi record, impronte ordinate e stock per unità/fondo
invariati dalla sola migrazione, replay/verify 41/41, smoke documenti
storici riusciti. Suite API completa sul DB nuovo e in modalità seriale:
117 file, 1334 pass, 2 skip opzionali AGEA già presenti in M4A; i due
test con XLSX originali M3B sono stati eseguiti e sono verdi. Frontend
75 file/411 test verdi. La build macOS nativa resta bloccata dalla
dipendenza LightningCSS esclusa nella configurazione preesistente; la copia
hash-identica del candidato in Linux x64/glibc ha passato install frozen,
typecheck, build API/frontend/workspace, budget e smoke browser della build
di produzione. Codegen doppio byte-identico. Le failure intermedie di
laboratorio e i rerun integrali sono registrati, non cancellati.

E2E: i flussi comuni e le regressioni M4A sono stati provati su UI/API/DB
reali isolati; nuove azioni su desktop/tablet emulati, risposta persa,
annullamento e profili reali Mensa/Magazzino; sei lingue, RTL e controlli
tastiera/touch. La verifica finale dei gate, del cleanup e del candidato
pubblicabile è nel rapporto degli esiti. **Nessuna validazione manuale M4B.1
o chiusura dell'intera M4B** è implicata. `NE-MAN-CAMERA` e
`NE-MAN-TABLET` rimangono separati e non bloccanti. Docker persistente e
`main` non aggiornati; M4B.2 non avviata.

**Esito formale: `NO-GO-M4B.1/G6`.** Pur essendo verdi PREP-TR-01…10,
REG-M4A, suite API/frontend/E2E, fresh, upgrade, runner, codegen,
typecheck, build e budget, il test di escaping della runtime config WEB
fallisce su Linux Node/Debian e nel runtime effettivo Nginx Alpine: un
backslash seguito da `b` diventa backspace. La configurazione ordinaria e
il login di produzione funzionano, ma non compensano il difetto. Gli script
coinvolti sono byte-identici alla base M4A e la loro correzione è
infrastrutturale, non strettamente M4B.1. Servono mandato separato e rerun
dei gate interessati. Nessun commit, staging o push; working tree
conservato. Il laboratorio effimero è stato ripulito nominativamente;
ambiente persistente e `main` invariati. M4B.1 non è pubblicata né
validata manualmente; M4B.2 non iniziata e M4B complessiva non chiusa.

## M4B.1 — hotfix runtime WEB e ripresa G6

Il successivo mandato ha autorizzato la correzione del finding
**WEB-RUNTIME-01**, preesistente alla base M4A: il generatore `config.js`
interpretava in modo non portabile il backslash seguito da `b` nel runtime
Nginx Alpine. La serializzazione byte-per-byte usa ora soltanto strumenti
già disponibili nello stadio finale; default, contratto delle chiavi e
pubblicazione atomica restano invariati. RT-01…12, build WEB finale,
typecheck, codegen, bundle budget, Nginx e rendering browser reali sono
verdi su ambiente compatibile. La build nativa macOS resta bloccata dalla
policy LightningCSS preesistente, non risolta né dichiarata verde.

Il rerun frontend completo è 411/411; E2E M4B.1 è 10 pass/2 skip di
progetto sui tre viewport, dopo aver reso autonoma la fixture Mensa nel
solo test. Fresh 41/41 su due DB nuovi e runner 24/24 sono verdi; l'upgrade
popolato 40→41 e i controlli SQL diretti conservano l'evidenza precedente
perché migrazione e business code non sono cambiati nell'hotfix.

La suite API integrale ripetuta serialmente su DB nuovo ha invece dato
**1332 pass, 2 fail, 2 skip AGEA**. Le due failure sono nel vecchio file
Scarico manuale 2.0A, non modificato dalla base: il test di concorrenza
attende il messaggio 403 del controllo transazionale ma può ricevere il
403 del controllo preliminare dopo il cambio Area; interrompendosi prima
del ripristino, causa il secondo 403 a cascata. Due rerun mirati hanno
riprodotto la failure. Nessun test estraneo o route Scarichi è stato
riscritto per forzare il verde. I dettagli e la decisione formale sono in
`ESITI_TEST_M4B1.md`.

**Stato finale della ripresa: `NO-GO-M4B.1/G3-G4`**. G6 è GO, ma REG-M4A
e API completa non sono verdi in questa run: nessun staging, commit o
push. Working tree M4B.1 preservato sul branch dedicato; laboratorio
Docker disposable ripulito, ambiente persistente e `main` invariati.
M4B.2 non avviata, M4B non chiusa, code review ChatGPT e validazione
manuale M4B.1 non eseguite. Restano `NE-MAN-CAMERA` e `NE-MAN-TABLET`.

## M4B.1 — hardening Scarico 2.0A e rerun G3/G4

Il precedente NO-GO/G3-G4 resta storico. Con mandato separato è stato
corretto **solo il test** Scarico 2.0A: il timer da 50 ms non provava il
raggiungimento del lock e l'assert fallito saltava il ripristino della
fixture, contaminando il PACCHI seguente. SCAR-01/02 distinguono il 403
preliminare dal 403 transazionale; quest'ultimo è verificato soltanto
dopo una barriera PostgreSQL positiva su `pg_stat_activity` e
`pg_blocking_pids`. SCAR-03/04 provano cleanup e PACCHI 201; SCAR-05
è verde per dieci run consecutivi; SCAR-06 fallisce come previsto
nella copia diagnostica senza rivalidazione. Nessuna policy o route
Scarichi è stata modificata.

La fase formale successiva ha eseguito 165 test API mirati, poi la suite
API completa su nuovo DB fresh 41/41: **117 file, 1336 pass, 0 fail,
2 skip AGEA opzionali**. Due run native macOS intermedie hanno avuto
singole failure non riprodotte nei test isolati; il primo run Linux
compatibile ha mostrato il timeout di 30 s del test FSE-R2 da 5.000
movimenti, che in isolamento termina in circa 34–35 s sul Linux x64
emulato. È stato elevato a 60 s soltanto il timeout di quel caso,
con assert/fixture invariati, e l'intera suite è stata rieseguita verde.

Frontend 411/411, E2E M4B.1 10 pass/2 skip di progetto, upgrade
popolato 40→41, runner 24/24, codegen, RT-01…12, build compatibile e
budget sono **evidenze precedenti mantenute con verifica di hash e
applicabilità**, non prove inventate in questa run. Fresh e typecheck
sono stati rieseguiti. WEB-RUNTIME-01 è preservato. Il limite della
build nativa macOS dovuto alla policy LightningCSS preesistente non è
risolto né dichiarato verde.

**Esito del perimetro automatico: `OK-TEST-M4B.1/NE-MAN`, G1–G8 GO.**
La code review ChatGPT e la validazione manuale M4B.1 restano
successive; `NE-MAN-CAMERA` e `NE-MAN-TABLET` restano non eseguiti.
M4B complessiva non è chiusa e M4B.2 non è iniziata. Il Docker
persistente e `main` rimangono invariati.

## M4B.1 — hardening code review CR-M4B1-01

Sul candidato pubblicato `9e4d9dd6c40b69d96a47f251920d716d5f990ccb`
la review ha rilevato che le due FK owner composte della migrazione 41
non erano dichiarate nel modello Drizzle delle prenotazioni. Sono state
aggiunte con stessi nomi, colonne e `ON DELETE RESTRICT`; le chiavi
parent `(id,bolla_id)` e `(id,trasferimento_id)` sono dichiarate
`unique` inline perché il bootstrap Drizzle crea le FK prima degli
indici post-tabella. FK singole, colonne nullable, `owner_exclusive`,
indici e logica applicativa restano invariati. Nessuna migrazione è
stata modificata o aggiunta.

OWNER-FK-01…05 e parità Drizzle/migrazione/catalogo sono **6/6 PASS**
sia sul fresh sia sulla copia con indici parent della migrazione 41.
Le regressioni mirate finali sono **117/117 PASS** su 5 file; il
fresh-db-gate ufficiale ha superato 41/41 migrazioni, seed, smoke,
replay e verify; runner 24/24 e typecheck sono verdi. Una run
intermedia aveva mostrato un 404 non riprodotto nel test storico di
conferma Trasferimento: il caso isolato e due gruppi successivi sono
verdi, ma la causa del 404 non è dimostrata e rimane segnalata nel
rapporto test.

Il percorso supportato sui DB popolati è il migration runner. Una
prova diagnostica di `drizzle-kit push` su copia **già migrata** con
indici parent ha incontrato collisione nome `42P07`: non si dichiara
quel comando verde né lo si usa sul Docker persistente. Il bootstrap
fresh con `push` è invece verde. La differenza fisica tra constraint
`UNIQUE` fresh e indice univoco della 41 è registrata; i due FK owner
e la loro protezione sono semanticamente coincidenti.

**Stato: CR-M4B1-01 corretto, `OK-TEST-M4B.1/NE-MAN`, pronto per la
chiusura della code review ChatGPT.** La validazione manuale M4B.1
non è eseguita; M4B non è chiusa, M4B.2 non avviata. Docker
persistente e `main` restano invariati.

## M4B.2 — sviluppo candidato sul branch dedicato

Sulla base verificata `98835207ed047dd764633b234ba91f87738c296b`,
senza staging/commit/push, è stato implementato il ciclo fisico: Bolla
`confermato → in_trasporto → consegnato` oppure `rientro_atteso →
rientrato`, e il ramo `in_transito → rientro_atteso → rientrato` del
Trasferimento. L'affidamento consuma una sola volta prenotazioni e stock;
la consegna dopo affidamento produce un esito neutro sul piano fisico;
la consegna diretta M4A conserva lo scarico originario. Il rientro è
integrale per le partite di uscita reali e va soltanto al Magazzino origine.

La decisione umana sopravvenuta è applicata: nessuna classe `altro`;
idonea/deteriorata/scaduta sono realmente rientrate, con Scarico automatico
transazionale per le ultime due; mancante/rubata sono anomalie documentate
senza un secondo decremento. Il ledger unico, il lineage, la migrazione 42,
le FK/constraint/trigger, le ricevute idempotenti, l'audit, i controlli
post-lock, il reporting fisico, OpenAPI/generated, UI i18n e PDF derivato
sono aggiornati. Il dettaglio delle prove è in `ESITI_SVILUPPO_M4B2.md`.

Le verifiche di sviluppo comprendono fresh 42/42 con replay, suite API
completa 119 file/1353 pass/4 skip, frontend 77 file/415 pass, runner
migrazioni 24/24, test mirati M4B.2, typecheck, codegen deterministico e
build API. La build nativa completa incontra la dipendenza LightningCSS
macOS non presente nel workspace, già nota; la build compatibile e i gate
formali restano al separato `##test M4`. Nessun test manuale è stato
eseguito. Stato: **`DEV-M4B.2/NE-TEST/NE-MAN`**. M4 complessiva non è chiusa,
M5 non avviata, Docker persistente e `main` invariati.

## M4 — validazione automatica integrata

Il separato `##test M4` ha ripreso il candidato M4B.2 sulla base pubblicata
`98835207ed047dd764633b234ba91f87738c296b`, senza ricominciare lo
sviluppo. Il verbale completo, compresi i tentativi falliti e le correzioni
circoscritte, è `ESITI_TEST_M4.md`. Fresh 42/42, upgrade autentico popolato
41→42, parità schema/migrazione, runner 24/24, test diretti e concorrenti,
report quantitativi, suite API finale 119 file/1373 pass/2 skip AGEA,
frontend 77 file/415 pass, 24 E2E pertinenti, codegen, typecheck,
build/budget/runtime Linux e rendering browser sono stati verificati.

La review ha corretto nomi FK della migration 42, proiezione FSE+ dei kg
distribuiti e fixture/assert di test direttamente bloccanti. Le failure
intermedie, incluso il run E2E aggregato non verde per pool singleton e
stock demo già consumato, non sono state cancellate dalla cronologia.
L'esito automatico non costituisce validazione umana M4B/M4. Fotocamera
reale e tablet fisico restano `NE-MAN-CAMERA`/`NE-MAN-TABLET`. Il Docker
persistente e `main` non sono stati aggiornati. Dopo i controlli finali e
il cleanup nominativo, G1–G10 sono GO: stato M4
**`OK-TEST-M4/NE-MAN`**, in attesa di code review ChatGPT e successivo
dry run umano autorizzato. M4 non è dichiarata `OK-MAN`.

## M4 — hardening code review CR-M4-01

Sulla base pubblicata `a64db9307008238cdc4265b5398fe2f0aa83b0fe`,
`Affida` aveva introdotto una violazione del contratto M4A: chiedeva
sempre un nome libero e poteva salvarlo insieme al volontario già
assegnato. La route ora conserva l'incaricato esclusivo (volontario
oppure nome esterno), rifiuta payload incoerenti e richiede un nome
soltanto se assente. La UI mostra l'assegnato senza reinserimento.

CR-M4-01-A…F, regressioni M4B.2/Bolle/Consegne e E2E pertinenti sono
verdi: API finale 119 file/1378 pass/2 skip AGEA storici, frontend
77 file/415 pass, M4B.2 6/6 e Consegne desktop/tablet simulato 2 prove
uniche. Build Linux API/WEB, typecheck e budget sono verdi. Fresh 42/42
è stato ripetuto; upgrade 41→42, runner, reporting, runtime e codegen
restano evidenze M4 applicabili per hash/input invariati. Dettagli e
failure ambientali risolte nel verbale `ESITI_TEST_M4.md`; review locale
in `REVISIONE_STATICA_M4.md`. Nessuna migration 43, modifica inventariale,
reporting o permessi. M4 resta **`OK-TEST-M4/NE-MAN`**, in attesa di nuova
code review ChatGPT; nessuna validazione manuale M4 è implicata. Docker
persistente e `main` invariati; M5 non avviata.

## UX-CARICO-01 — correttivi Carico Merce in sviluppo

Sulla base `d96680eeee82b2b5a4690602534168623826b544` del branch
dedicato è stato aggiornato soltanto il percorso UI del Carico Merce:
**Conferma carico a magazzino** esplicita l'operazione inventariale e le
righe selezionate; gli errori restano contestuali e persistenti; i campi
obbligatori vengono evidenziati già al salvataggio della riga, mantenendo
le bozze incomplete ammesse; **+ Nuova raccolta / attività** è sotto il
selettore. Il refetch dopo il salvataggio di una riga preserva le modifiche
locali alle altre. Nessuna modifica al motore inventariale o al contratto
API. Dettagli e risultati sono in `ESITI_SVILUPPO_UX_CARICO_01.md`.

Frontend completa 77 file/418 test, API completa 119 file/1376 pass/4 skip,
E2E UX desktop/tablet simulato e regressioni M3A/FSE pertinenti, typecheck
e build Linux API/WEB sono verdi. La build nativa WEB macOS resta limitata
dalla dipendenza LightningCSS assente; i tentativi iniziali non verdi e il
rerun completo sono nel rapporto. Il candidato Docker disposable è stato
eliminato; lo stack persistente non è stato aggiornato. Il documento locale
di deploy preesistente è stato conservato. Stato:
**`DEV-UX-CARICO-01/NE-TEST-UX/NE-MAN`**, pronto per il separato `##test`;
nessun commit/push/merge, `main` invariato e M5 non avviata.

## UX-CARICO-01 — test formale e dry run umano

Il separato `##test UX-CARICO-01` ha ripreso il delta esistente sulla base
`d96680eeee82b2b5a4690602534168623826b544`. Le prove A–J, frontend
completo 77 file/418 pass, API mirata 49 pass/1 skip, E2E UX/M3A 4 pass/2
skip, FSE 3 pass/7 skip, typecheck e build API/WEB sono verdi. La prima
run browser con fixture condivise e le correzioni di isolamento/ordinamento
sono conservate in `ESITI_TEST_UX_CARICO_01.md`. Nessuna modifica a backend,
schema, API o motore inventariale.

Floriano ha comunicato il **PASS** del dry run reale UX sul Docker locale:
pratica, raccolta, errori/campi, bozze e draft locali, conferma selettiva e
giacenza una sola volta. Stato UX: **`OK-UX-CARICO-01/OK-MAN-UX-CARICO-01`**.
La validazione è specifica di UX-CARICO-01: non attribuisce `OK-MAN-M4`
all'intera milestone. Il Docker persistente non è stato modificato durante
la fase `##test`; `main` e M5 restano fuori perimetro.

## UX-CARICO-LOTTI — Fase A di sviluppo

Sulla base chiusa e pubblicata `efa38a9c103186bc33946f1b5b751570911d861c`
sono stati introdotti i tab **Carichi**, **Raccolte / Attività** e
**Lotti fisici** dentro Carico Merce, con deep-link. UX-CARICO-01 resta
nel flusso Carichi: conferma selettiva, errori persistenti, evidenziazione,
bozze incomplete e draft locali non sono stati sostituiti. La creazione
della Raccolta usa un dialog comune; elenco, dettaglio, filtri e lifecycle
usano i lotti logici esistenti. La vista dei lotti fisici è consultiva,
include su richiesta gli esauriti e mostra provenienze/documenti multipli
dal lineage reale dei carichi. La rettifica preesistente resta disponibile
solo con permesso e su magazzino attivo.

Nel carico manuale sono esposti fornitore ordinario, numero/data DDT,
scanner del codice lotto produttore e suggerimenti che precompilano la
bozza senza effetti sullo stock. FSE+/AGEA resta nel suo wizard; il vecchio
`/lotti` reindirizza ai nuovi tab e non espone più un secondo writer di
nuovo stock. GET `/lotti` è estesa in modo additivo, senza migrazione o
modifiche al motore inventariale. Le verifiche e i limiti della Fase A
sono in `ESITI_SVILUPPO_UX_CARICO_LOTTI.md`.

Prove di sviluppo sul candidato finale: frontend 79 file/426 pass, API
119 file/1377 pass/4 skip storici, typecheck, build API e WEB Linux x64,
codegen deterministico, Prettier e diff check verdi. Il primo run API
non verde per `SESSION_SECRET` assente e timeout concorrenti è riportato
nel verbale; il rerun isolato è verde. Il database di test su tmpfs e i
container build one-shot sono stati rimossi; Docker persistente invariato.

Stato **`DEV-UX-CARICO-LOTTI/NE-TEST/NE-MAN`**: nessun commit, push o
deploy Docker; il separato `##test UX-CARICO-LOTTI` e la validazione
manuale non sono stati eseguiti. `main` e M5 invariati.

## UX-CARICO-LOTTI — test formale e consolidamento

Floriano ha dichiarato **PASS manuale** per tre tab e navigazione,
Raccolte/Attività, Lotti fisici, Carico Merce, salvataggio e auto-selezione,
carico parziale con righe incomplete non selezionate, colori «Lotto
richiesto» e regola lotto obbligatorio/facoltativo. Questo è
`OK-MAN-UX-CARICO-LOTTI`, non `OK-MAN-M4`; fotocamera reale e tablet fisico
restano `NE-MAN-CAMERA` e `NE-MAN-TABLET`.

La fase formale ha verificato routing reattivo, lifecycle della Raccolta
senza stock, lista lotti con storico/lineage multiplo, fornitore/DDT,
scanner e suggerimenti, UX-CARICO-01, auto-selezione e carico selettivo.
Risultato finale: frontend **81 file/436 pass**, API **119 file/1377 pass/4
skip storici**, E2E pertinenti **26 pass/29 skip viewport preesistenti**,
fresh DB e migration verify **42/42**, runner PostgreSQL **24/24**,
typecheck, build API e WEB Linux, budget, runtime, doppio codegen e
controlli diff verdi. Il primo run API completo non verde e la correzione
del test E2E M3B sono documentati senza cancellarne la storia in
`ESITI_TEST_UX_CARICO_LOTTI.md`.

Stato: **`OK-TEST-UX-CARICO-LOTTI/OK-MAN-UX-CARICO-LOTTI`** per il
candidato UX. Nessuna migration nuova, nessun deploy del Docker
persistente, nessun avvio M5 e nessun merge su `main`.
