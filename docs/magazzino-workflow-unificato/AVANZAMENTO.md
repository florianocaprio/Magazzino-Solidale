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
