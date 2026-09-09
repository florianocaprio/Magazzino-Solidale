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

### Decisioni che richiedono validazione

1. `lotti` resta dettaglio fisico; nuovo `lotto_logico` è contenitore multiprodotto.
2. “Generale” è unico per Area e non assorbe automaticamente il legacy.
3. Unità indivisibili governate da proprietà esplicita catalogo; nessun arrotondamento storico.
4. Pratica di carico separata dalle integrazioni immutabili.
5. Richiesta magazzino autonoma, rappresentabile con sole note.
6. Documento con destinatario tipizzato, mantenendo il trasferimento come workflow specializzato.
7. Stato “affidato/in trasporto” distinto da prenotato, consegnato e rientrato.
8. Soglia minima Area usata una volta, non moltiplicata, finché non esiste policy per deposito.
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
Stato: **M0 test automatici superati — pronto per validazione Floriano/ChatGPT**.

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

### Decisioni consolidate e decisioni umane aperte

Sono confermati come vincoli dello scenario: distinzione lotto logico/dettaglio fisico, un solo input quantità, richiesta iniziale anche con sole note, selezione Area→Magazzino, autore derivato esclusivamente dalla sessione backend, cronologia append-only e assenza di consegne parziali implicite.

Restano proposte da approvare prima dell'implementazione: cardinalità esatta del lotto “Generale” per Area, proprietà `quantitaFrazionabile`, nomi/cardinalità/stati delle nuove entità, policy della soglia minima di Area e forma tecnica del registro audit comune. `DECISIONI.md` distingue questi punti dai vincoli già imposti dallo scenario.

### Avvisi e passaggi manuali

- Verificare manualmente che il filesystem contenente il backup durevole sia cifrato e incluso nella policy di conservazione prevista.
- Eseguire con Floriano la validazione delle proposte architetturali ancora aperte.
- Tablet, tastiera touch e fotocamera richiedono prova fisica nelle milestone pertinenti; non sono certificati da M0.
- Restano non bloccanti la deprecazione PostgreSQL `client.query()` nei test, i warning Vite sourcemap/chunk e il requisito `PORT`/`BASE_PATH` della build root.
- Evitare porte host nella gamma effimera durante i test Supertest oppure arrestare preventivamente i container applicativi.

### Condizione di arresto

Il gate automatico M0 è completato. Dopo la creazione e pubblicazione del solo commit candidato sul branch M0, fermarsi senza merge, senza modificare `main` e senza avviare M1A.
