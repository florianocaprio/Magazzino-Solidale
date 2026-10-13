# Handover tecnico — Magazzino Solidale — ottobre 2026

Data della ricognizione: **13 ottobre 2026, Europe/Rome**.
Destinatario: Solution Architect / responsabile tecnico subentrante.
Repository locale: `/Users/florianocaprio/Projects/Magazzino-Solidale`.
Repository GitHub: [florianocaprio/Magazzino-Solidale](https://github.com/florianocaprio/Magazzino-Solidale).

Il documento descrive lo stato osservato al momento della ricognizione. È stato
preparato leggendo Git, sorgenti, rapporti, risultati persistiti, identità Docker
e endpoint di health/readiness. Non sono state rieseguite suite, migration,
build o UAT durante la redazione. Nessun codice applicativo, configurazione,
database o risorsa Docker è stato modificato per produrre questo handover.

## 1. Stato da comprendere prima di qualsiasi intervento

**La versione pubblicata su GitHub non coincide con tutto il software installato
sulla 8082.** Dopo il correttivo Mensa/Magazzino pubblicato, sono stati sviluppati
e installati due ulteriori interventi presenti soltanto nel working tree:
preferenza del magazzino di approvvigionamento, con migration 55, e conferma
«Richiesta inviata» con badge di stato. La preview 8083 è stata successivamente
eliminata su richiesta esplicita di Floriano, compresi database e uploads di prova.

| Livello                                 | Identità / stato attuale                                                                               | Fonte verificata in questa ricognizione                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Branch corrente                         | `codex/magazzino-workflow-unificato`                                                                   | Git locale                                                                                                      |
| HEAD locale                             | `535e5a403fd7eb0d940256de2dc34ce67f7b0166`                                                             | `git rev-parse HEAD`                                                                                            |
| Branch remoto effettivo                 | `535e5a403fd7eb0d940256de2dc34ce67f7b0166`                                                             | `git ls-remote origin refs/heads/codex/magazzino-workflow-unificato`                                            |
| Divergenza locale/tracking              | 0 / 0                                                                                                  | `git rev-list --left-right --count HEAD...origin/codex/magazzino-workflow-unificato` e confronto remoto diretto |
| Main remoto                             | `787d7c5436d5fa4c0edb24be373d055946d402ce`                                                             | `git ls-remote origin refs/heads/main` ; main locale non utilizzato                                             |
| Staging                                 | Vuoto                                                                                                  | `git diff --cached --name-only`                                                                                 |
| Working tree prima di questo documento  | 18 file tracciati modificati + 10 file non tracciati                                                   | Inventario Git, sez. 9                                                                                          |
| Schema disponibile su GitHub            | Migration 1–54                                                                                         | Albero del commit pubblicato                                                                                    |
| Schema disponibile nel working tree     | Migration 1–55                                                                                         | 55 file SQL, migration 55 non tracciata                                                                         |
| Docker ufficiale 8082                   | API da candidato locale preferenza/55; WEB da candidato locale conferma invio                          | Immagini e manifest di build, sez. 7                                                                            |
| Ledger ufficiale corrente               | 55 applicate / 55 attese, zero pending, zero mismatch, zero file applicati mancanti, zero fuori ordine | GET `/api/readyz`, HTTP 200 durante la ricognizione                                                             |
| Preview 8083                            | Rimossa; nessun container/rete/volume della preview residuo                                            | Inventario Docker corrente e verbale cleanup                                                                    |
| Pubblicazione dei due ultimi correttivi | **NON ESEGUITA**                                                                                       | Il remoto è ancora `535e5a4…`; delta locale presente                                                            |
| UAT degli ultimi correttivi Mensa       | **Non attestata come conclusa**                                                                        | Richieste di disponibilità per test, senza successivo verbale PASS                                              |

Non basta annotare la SHA `535e5a4…` per ricostruire la 8082: occorrono anche il
delta locale, i manifest con fingerprint e le immagini effettivamente installate.
Un clone del solo branch remoto non contiene migration 55 né l'ultima UX.

## 2. Metodo di lettura delle evidenze

Nel documento si usano queste qualifiche:

- **V-CORRENTE**: osservazione read-only effettuata durante questo handover
  (Git, Docker, health, ledger esposto dalla readiness, hash di file).
- **V-EVIDENZA**: esecuzione precedente con log/JSON ancora presente e letto
  durante la ricognizione. Non è una nuova esecuzione del test.
- **RAPPORTO**: risultato descritto in un rapporto; ove non indicato diversamente,
  non è stato ricontrollato integralmente ogni dettaglio grezzo dell'esecuzione.
- **DICHIARATO-UTENTE**: validazione comunicata da Floriano; non sostituita con
  un test automatico e non estesa a interventi successivi.
- **PENDING / NE-MAN**: prova non attestata, decisione aperta o attività futura.

Il PASS di una campagna certifica il candidato e il perimetro di quella
campagna. Non rende automaticamente formale una fase di sviluppo, non chiude
la UAT e non si somma ai conteggi di campagne diverse. I rapporti inizialmente
FAIL/NO-GO restano parte della cronologia.

Le directory `/private/tmp` elencate sono evidenze locali effettivamente
disponibili durante la ricognizione, ma possono essere eliminate dal sistema.
Non sono su GitHub. Le directory `Backups` sono artefatti durevoli locali;
non devono finire nel repository e possono contenere dati riservati.

## 3. Architettura e invarianti da preservare

Il progetto è un monorepo pnpm / TypeScript. Le parti rilevanti sono:

| Componente                  | Percorso                                                             | Responsabilità                                                                            |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| WEB React/Vite              | `artifacts/magazzino-solidale`                                       | Pagine operative, componenti condivisi, i18n, React Query, test unitari ed E2E Playwright |
| API Express                 | `artifacts/api-server`                                               | Autorizzazioni correnti, comandi transazionali, servizi M4, audit, API/test PostgreSQL    |
| Database Drizzle/PostgreSQL | `lib/db`                                                             | Modello, migration SQL append-only, ledger/checksum e runner canonico                     |
| Contratto autorevole        | `lib/api-spec/openapi.yaml`                                          | Contratti API; generazione client e validatori                                            |
| Client React generato       | `lib/api-client-react/src/generated`                                 | Hook/DTO; non editarli manualmente                                                        |
| Zod generato                | `lib/api-zod/src/generated`                                          | Schemi/tipi derivati dal contratto                                                        |
| Harness stabilizzato        | `scripts/m63-test-guards.mjs` e test correlati                       | Lock, selezione gruppi browser e isolamento dei database                                  |
| Runtime Docker              | `Dockerfile.api`, `Dockerfile.web`, entrypoint API/WEB, `nginx.conf` | Build Linux, bootstrap/migration/readiness e proxy WEB/API                                |

Decisioni fondamentali ereditate e mantenute dagli interventi successivi a M6.4:

1. **Un solo motore inventariale M4**: movimenti reali, disponibilità,
   prenotazioni, FEFO, spedizione, ricezione, rientro e storno. Una richiesta
   esprime un bisogno; non è stock, prenotazione né trasferimento.
2. **Responsabilità distinte**: la Mensa descrive il bisogno e riceve; il
   Magazzino decide prodotti, quantità, lotti e origine effettiva, prepara e
   spedisce tramite M4. La quantità fornita può differire da quella descritta
   nel bisogno (scenario verificato: bisogno 20, fornitura 12).
3. **Autorizzazione ordinaria Mensa**: grant necessario AND territorio corrente
   AND assegnazione esplicita Utente↔Mensa. L'appartenenza a un Centro non
   autorizza tutte le Mense del Centro. I grant `mensa.*` non implicano globalità.
   Admin/ruoli misti conservano soltanto le capacità effettivamente autorizzate.
4. **Revoche efficaci a sessione aperta e sul replay**: scope, grant e assegnazioni
   sono rivalidati lato backend; nascondere un pulsante non è una guardia.
5. **Nessun backfill implicito**: non attribuire legacy, utenti, stock, fonti,
   fondi o Mense in assenza di prova. Snapshot storici e identità delle fonti
   restano conservati.
6. **Audit comune append-only e transazionale**, attore dalla sessione backend,
   non dal payload. Intenzioni/idempotenza distinguono replay e nuovo comando;
   un errore PDF o refetch non deve ripetere un movimento già riuscito.
7. **Lotto logico ≠ lotto fisico**: `Generale` è operativo per Area, non un
   codice produttore inventato. Quantità frazionabile e obbligo del lotto fisico
   sono proprietà esplicite; UOM dal Catalogo, senza conversioni arbitrarie.
8. **FSE+/AGEA separa fatti fisici e rendicontazione**: riconciliare non carica
   stock; claim M3B/M3A, snapshot, coperture e versioni non vengono riscritti.
   Nessuna statistica proporzionale inventata e nessuna compatibilità ufficiale
   SIFEAD dichiarata.
9. Migration append-only e runner canonico su DB popolati. Nessun `drizzle push`,
   reset, `down -v`, prune globale o downgrade improvvisato sul persistente.
10. API e browser mutanti non devono condividere contemporaneamente lo stesso
    database. Usare lock del launcher, DB fresh distinti, risorse effimere e
    cleanup nominativo; mai i dati della 8082 come fixture.

## 4. Cronologia Git e operativa

| Passaggio                            | Identità                                   | Stato e significato                                                            |
| ------------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------ |
| Base M6.3 chiusa                     | `eb5c3a7517d3ca9be332d288c236417c20eca905` | Base dell'analisi M6.4                                                         |
| Primo candidato M6.4                 | `200f03ce44ca5f6bb3cfa53a1e7a9dfd85bc9b0b` | Pubblicato per review; non equivalente alla certificazione finale              |
| Hardening M6.4                       | `1a2c6ca0a7a7c9a31b8dc3d913663ed835c6f36b` | Qualità, riconciliazione e lineage                                             |
| M6.4 certificata R5                  | `df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb` | Batch massivi R64-07 e tab FSE accessibili; ledger 53                          |
| Prima procedura ufficiale M6.4       | 12 ottobre, rapporto locale NO-GO          | Restore temporaneo fallito nel setup; ufficiale restava a M6.3/ledger 50       |
| Correttivo integrato Mensa/Magazzino | `535e5a403fd7eb0d940256de2dc34ce67f7b0166` | Unico commit pubblicato dopo `df9c9a9…`; include migration 54                  |
| Rilascio integrato effettivo         | 12 ottobre 23:53 Roma                      | Backup/restore e rehearsal 50→54 riusciti; API/WEB aggiornati, dati preservati |
| Preferenza approvvigionamento        | HEAD + delta locale                        | Migration 55, nuove API/DTO/UI/test; non pubblicata                            |
| Installazione preferenza/55          | 13 ottobre 09:54 Roma                      | API/WEB da working tree congelato, ledger ufficiale 55                         |
| Conferma richiesta e badge           | Ulteriore delta frontend locale            | Test frontend/E2E e rebuild WEB; non pubblicato                                |
| Ultimo rebuild WEB                   | 13 ottobre 10:30 Roma                      | Immagine `e74cd648…` effettivamente in esecuzione                              |
| Cleanup preview                      | Successivo al rebuild, su mandato utente   | Container 8083, rete e due volumi rimossi; ufficiale invariato                 |

GitHub, riferimenti immutabili:

- [Commit M6.4 certificato](https://github.com/florianocaprio/Magazzino-Solidale/commit/df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb).
- [Commit Mensa/Magazzino pubblicato](https://github.com/florianocaprio/Magazzino-Solidale/commit/535e5a403fd7eb0d940256de2dc34ce67f7b0166).
- [Delta pubblicato dopo M6.4](https://github.com/florianocaprio/Magazzino-Solidale/compare/df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb...535e5a403fd7eb0d940256de2dc34ce67f7b0166).
- [Albero della versione pubblicata](https://github.com/florianocaprio/Magazzino-Solidale/tree/535e5a403fd7eb0d940256de2dc34ce67f7b0166).
- [Rapporto del correttivo pubblicato](https://github.com/florianocaprio/Magazzino-Solidale/blob/535e5a403fd7eb0d940256de2dc34ce67f7b0166/docs/Correttivo-Mensa-Magazzino-Sviluppo.md).
- [Certificazione M6.4 R5](https://github.com/florianocaprio/Magazzino-Solidale/blob/df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb/docs/M6.4-FSE-AGEA-Test-Report-R5.md).

## 5. Interventi, decisioni e matrici di tracciabilità

### 5.1 Baseline M6.4: cosa resta acquisito e cosa resta aperto

M6.4 ha completato il raccordo amministrativo M3B e le rappresentazioni
minimizzate degli export. Le iniziali proposte D64-01/D64-02 sono state approvate
e implementate nei mandati successivi: le sezioni iniziali dei rapporti non sono
lo stato finale. La review ha separato qualità amministrativa e delta fisico,
corretto identità/cutoff/lineage e il trattamento massivo dei record.

| Requisito                      | Implementazione                                                                                        | File / fonte                                                                                        | Test ed evidenza                                                          | Risultato e limite                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| D64-01, fonte M3B versionata   | Manifest, osservazioni/revisioni, lineage, run/cutoff e baseline esplicita compatibile                 | Migration 52; `docs/M6.4-Decisioni.md`; rapporti R4/R5                                              | Fresh/upgrade 50→53 e 52→53, vincoli, freeze, rollback e browser fonti    | V-EVIDENZA/RAPPORTO: certificazione R5; non nuovo test qui              |
| D64-02, minimizzazione storici | Variante materializzata dallo snapshot, hash proprio; originale riservato con grant esplicito e motivo | Migration 51; decisioni D64; codice FSE della baseline                                              | API/export/download/revoca R5                                             | Certificato R5; nessuna promessa di recuperare byte XLSX mai conservati |
| R64-01…04, integrità           | Qualità distinta da quantità; cutoff ordinato; claim/lineage versionato                                | Migration 53 e rapporto correzioni R1/R5                                                            | SQL, upgrade con duplicati legacy respinto e dati/ledger intatti          | Certificato R5; nessun saldo corretto per far combaciare i report       |
| R64-06/07, grandi import       | Inserimenti batch e rollback atomico                                                                   | `artifacts/api-server/src/lib/fsePracticeImportService.ts`; `tests/fse-import-practice-m3b.test.ts` | Registro 5000, Giacenze 5000/10000, replay e failure dopo primo batch     | Certificato R5                                                          |
| Tab FSE touch                  | Sei trigger almeno 44×44 px nel consumer                                                               | `src/components/reporting/fse-operations.tsx`; `e2e/fse-m64.spec.ts`                                | Browser cinque viewport, selezione reale e controllo ergonomico invariato | Certificato R5                                                          |
| R64-05                         | Miglioramento UX differito                                                                             | Rapporti R3/R4/R5                                                                                   | Non implementato in R5                                                    | Aperto non bloccante, M6.6/intervento UX separato                       |
| SIFEAD                         | Nessuna certificazione ufficiale                                                                       | Decisioni/UAT M6.4                                                                                  | File originali autorizzati e profili osservati, non convalida ente        | `EXTERNAL_FORMAT_UNVERIFIED`                                            |

M6.4 R5: API **1842 PASS / 0 FAIL / 0 SKIP**, frontend **606 PASS**, browser
**119 PASS / 0 FAIL / 71 SKIP storici**. Il JSON API R5 riutilizzato è ancora
presente e i conteggi sono stati riletti; dettagli degli altri gate nel rapporto
R5. Floriano ha successivamente dichiarato **UAT M6.4 positiva sulla 8083** nel
mandato di rilascio: DICHIARATO-UTENTE, non nuova UAT effettuata durante l'handover.

### 5.2 Correttivo integrato Mensa → Richiesta → Magazzino → Trasferimento

Intervento **pubblicato** nel commit `535e5a4…`, installato prima a ledger 54 e
ora incluso nella 8082 con i correttivi ulteriori. Il vecchio form Mensa creava
direttamente un trasferimento imponendo prodotto, quantità e lotto. Il nuovo
flusso usa l'aggregato canonico `richieste_magazzino` e il motore M4.

| Requisito / problema                              | Implementazione                                                                                          | File principali (prefissi completi in sez. 9)                                     | Test                                                                  | Risultato                                                                   |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| AO: Area coerente in tutte le viste Mensa         | Provider comune, Area fissa per ordinario; scelta per admin, cache per attore/territorio e guardia draft | `mensa-operational-context.tsx`, `pages/mensa.tsx`, `mensa.ts`, `mensaScope.ts`   | `mensa-operational-context.test.tsx`, API AO/SEC, E2E cinque viewport | V-EVIDENZA: suite 614 frontend e API 1850; niente globalità dal solo Centro |
| CAM: scanner Postazione                           | Avvio ZXing quando il video nel portale è montato, rilascio stream e filtro callback ripetute/tardive    | `barcode-scanner-button.tsx`, `pages/mensa.tsx`                                   | Test scanner e Postazione                                             | Automatici PASS nel rapporto; fotocamera/lettore reali NE-MAN               |
| ABI: persone mai abilitate ricercabili            | Ricerca territoriale senza richiedere una precedente abilitazione, errori distinti da lista vuota        | `routes/mensa.ts`, pagina Mensa                                                   | `ABI-01`, suite Mensa                                                 | V-EVIDENZA: API completa; non accertata UAT fisica successiva               |
| RIC: bisogno libero senza stock all'invio         | POST canonico con `mensaId`; destinatario derivato dal server; no carrello/prodotti/lotti                | `routes/richieste-magazzino.ts`, `mensa-rifornimenti.tsx`, schema/54, OpenAPI     | `RIC-01/02/03`, conteggi prima/dopo, E2E due attori                   | PASS tecnico; nessuna movimentazione all'invio                              |
| Writer legacy da ritirare                         | POST legacy Mensa trasferimenti restituisce 410; vecchio payload non reinterpretato                      | `routes/mensa.ts`, OpenAPI/generated                                              | Test Mensa riconciliati, `TRA-03`                                     | PASS tecnico; eventuali client esterni devono adottare il nuovo percorso    |
| Magazzino decide fornitura                        | Presa in carico/preparazione nello Sheet esistente; 20 richiesti descrittivamente, 12 forniti realmente  | Richieste, `documento-operativo.tsx`, `transferWorkflow.ts`                       | `RIC-01…TRA-05`, E2E richiesta→ricezione                              | V-EVIDENZA: nuovo flusso PASS in tutte le cinque viewport                   |
| TRA: destinazione Mensa canonica                  | Resolver transazionale da magazzino destinatario, mismatch esplicito respinto                            | `mensaTransferDestination.ts`, servizi/route Trasferimenti                        | Test diretti e da richiesta                                           | PASS tecnico, nessuna seconda gestione stock                                |
| TRA: documento Mensa visibile al Magazzino        | Rimossa esclusione indiscriminata di `mensa_id`; mantenuti grant e scope                                 | `routes/trasferimenti.ts`, `routes/documenti-operativi.ts`, `m5bRequestAccess.ts` | Gruppi correttivo/M5; E2E continuità                                  | PASS; profilo solo Mensa non acquisisce azioni sull'origine                 |
| Legacy senza `mensaId`                            | Compatibilità solo se Mensa canonica `MEN-MAG-<id>` preesistente al documento e mai aggiornata           | `routes/mensa.ts`, test `TRA-01/02`                                               | Diretto visibile, casi non attribuibili conservati                    | PASS tecnico; non è ricostruzione esaustiva o backfill                      |
| UOM / limite partita                              | Unità dal Catalogo; `cf` non trasformato in `conf`; bottone coerente con disponibilità selezionata       | `pages/trasferimenti.tsx`, `trasferimenti-lotti.test.tsx`                         | Unit frontend, E2E lotto reale                                        | PASS; causa del singolo tentativo utente non acquisito non dimostrata       |
| SEC: revoca, ruoli misti, replay                  | Scope corrente e assegnazione rivalidati, lettura Magazzino distinta dalla scrittura Mensa               | `m5bRequestAccess.ts`, `mensaScope.ts`, richieste/trasferimenti                   | `SEC-01/02`, `TRA-03`, revoca stessa sessione, payload manomessi      | V-EVIDENZA: API; grant origine legacy non riabilitano operazioni Mensa      |
| RIC-04: annullamento pre-uscita                   | Orchestrazione M4 e rilascio prenotazioni senza scarico                                                  | Route Richieste e servizi M4 esistenti                                            | `RIC-04` nel test correttivo                                          | PASS tecnico; dopo uscita usare percorsi M4 di esito/rientro                |
| IDE/ERR: doppio clic, risposta persa, PDF/refetch | Registro intenzioni e blocco comandi pendenti; errore contestuale senza ripetizione automatica           | `mensa-rifornimenti.tsx`, pagina Trasferimenti                                    | `IDE-01`, API replay, E2E consumo storico                             | PASS tecnico; non una certificazione di carico/throughput                   |

Le failure iniziali sono state risolte e conservate nel rapporto pubblicato:
test del POST legacy obsoleti, mount path del middleware, filtro documenti
Mensa nella vista unificata, abilitazione bottone oltre il lotto, fixture senza
`Generale` e vecchia etichetta del form. Non sono state eliminate guardie di
sicurezza per ottenere i risultati finali.

### 5.3 Preferenza del magazzino di approvvigionamento

Intervento **locale non pubblicato**, con backend/schema/API installati sulla 8082. Decisione esplicita di Floriano: **preferenza modificabile dal Magazzino**.
Non è un vincolo che imponga quella origine al documento M4.

| Requisito                                 | Implementazione                                                                                      | File                                                               | Test                                                                 | Risultato                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------- |
| Scegliere magazzino nella richiesta Mensa | Selezione esplicita obbligatoria per nuove richieste, bisogno sempre libero                          | `src/components/mensa-rifornimenti.tsx`, i18n Mensa                | Unit RIC/preferenza, E2E                                             | V-EVIDENZA: frontend 616 e flusso browser cinque viewport |
| Solo magazzini pertinenti                 | GET con Area/Mensa, attivi, non destinazione Mensa, scope Centro/Area                                | `routes/mensa.ts`, OpenAPI, `listMagazziniMensaParams.ts` generato | «Magazzino richiesto: obbligatorio…»; «La stessa sessione rivalida…» | V-EVIDENZA: API, scope rivalidato anche dopo revoca       |
| Backend autoritativo                      | POST richiede preferenza nel ramo Mensa, rifiuta fuori contesto/non Mensa; snapshot nome lato server | `routes/richieste-magazzino.ts`                                    | Payload manomessi, inattivo, altra Area, proprio deposito            | PASS tecnico; UI non sostituisce la validazione           |
| Conservare scelta iniziale                | ID e nome snapshot immutabili dopo invio                                                             | Schema Richieste, migration 55                                     | «Preferenza persistita e immutabile…», trigger SQL/upgrade           | V-EVIDENZA; legacy resta NULL                             |
| Magazzino può scegliere altra origine     | Precompilazione se disponibile; documento registra origine reale, richiesta conserva preferenza      | `src/pages/richieste-magazzino.tsx`                                | API preparazione origine alternativa, browser                        | PASS tecnico; UAT specifica PENDING                       |
| Errori comprensibili                      | Campo obbligatorio rosso, lista vuota ed errore con cache distinti                                   | `mensa-rifornimenti.tsx`, relativi test/i18n                       | Errori cache, assenza scelte e invalidazione selezione               | V-EVIDENZA frontend                                       |
| Compatibilità DB                          | Append-only senza backfill, niente modifica 1–54                                                     | Migration 55/schema/contratti                                      | Fresh 55, upgrade autentico popolato 54→55, replay/parità            | V-EVIDENZA: `upgrade-result.json` e runner 24/24          |

La preferenza è memorizzata per audit/continuità; se diventa inattiva o non più
accessibile non si deve usarla silenziosamente come origine. L'operatore Magazzino
sceglie un'origine attualmente autorizzata. Nessun prodotto/lotto è scelto dalla
Mensa per effetto di questa preferenza.

### 5.4 Conferma «Richiesta inviata» e badge del riepilogo

Intervento **locale non pubblicato, frontend**, installato nell'ultimo WEB 8082.

| Requisito                                   | Implementazione                                                                                                 | File                                                      | Test                                                              | Risultato                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Invio riconoscibile                         | Al successo server, form sostituito da conferma persistente con codice                                          | `mensa-rifornimenti.tsx`, i18n IT/EN                      | Unit invio e failure/risposta persa, E2E richiesta reale          | V-EVIDENZA: 627 frontend e 13 E2E finali                                  |
| Mostrare richiesta appena inviata           | Riepilogo canonico aggiornato e ritorno a pagina 1; niente record fittizio ottimistico                          | Stesso componente                                         | Test invio da seconda pagina, errore refetch successivo al commit | PASS; errore refresh non ripete il comando                                |
| Chiudere conferma all'interazione Area/menu | Contatore interazioni Area, gruppo semantico; reset locale, smontaggio al cambio menu; pulsante nuova richiesta | `mensa-operational-context.tsx`, `mensa-rifornimenti.tsx` | Unit contesto/draft/smontaggio; clic Area E2E cinque viewport     | PASS; preservati i draft ancora non inviati                               |
| Colori comprensibili                        | INVIATA blu, PRESA IN CARICO ambra, COMPLETATA verde, ANNULLATA grigio; testo oltre al colore                   | Componente/i18n                                           | Test classi/stati e E2E del ciclo reale                           | PASS tecnico; UAT visiva utente PENDING                                   |
| Completamento fedele ai fatti               | Per richiesta presa in carico, visualizza COMPLETATA solo se trasferimento corrente è `completato`              | `requestDisplayStatus()` nel componente                   | Sei varianti positive/negative e ricezione reale                  | PASS UI; non modifica lo stato amministrativo nel DB                      |
| Nessuna falsa chiusura                      | Esclusi documento storico/non corrente, in transito, stornato o di altro tipo; annullata resta tale             | Stessa funzione; `m5RequestClosure.ts` invariato          | Unit negativi                                                     | PASS tecnico; chiusura amministrativa trasferimenti resta fuori perimetro |

**Distinzione essenziale**: il backend `m5RequestClosure.ts` conserva il motivo
`trasferimento_fuori_perimetro`. La UI può mostrare COMPLETATA dopo ricezione,
mentre `richieste_magazzino.stato` resta `presa_in_carico`. È una presentazione
dell'esito della fornitura, non un nuovo comando di chiusura. Altre API/report
che leggono lo stato grezzo possono quindi mostrare una descrizione diversa.
Una futura unificazione richiede decisione esplicita e test; non cambiare il DB
per far coincidere l'etichetta.

La prima campagna browser di questo correttivo non era verde: **3 PASS,
3 failure e 19 skip/interruzioni** nel JSON, a seguito dei timeout/interruzione.
Il clic Playwright sull'etichetta veniva risolto sul combobox disabilitato.
Il gruppo Area è stato nominato semanticamente e il test ora clicca il
contenitore corretto; intero gruppo rieseguito: **13 PASS, 12 skip storici,
zero failure/flaky**. Il primo risultato non viene cancellato o conteggiato
come successo. Anche l'errore typecheck intermedio sullo spread delle traduzioni
EN è stato corretto prima delle verifiche finali.

### 5.5 Rilasci e cleanup: matrice operativa

| Requisito                                     | Implementazione / operazione già eseguita                                                   | File / evidenza                                                                                         | Verifica                                                     | Risultato                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| Riprendere rilascio dopo restore M6.4 fallito | Nuovo backup, readiness TCP del restore, rehearsal sulla copia, poi 50→54 ufficiale         | `release-backup-verified.json`, `release-rehearsal.json`, `release-success.json` in evidenze correttivo | Restore 131 tabelle, ledger/dati, health                     | V-EVIDENZA: riuscito; il vecchio NO-GO resta storico                 |
| Installare preferenza/55                      | Backup fresco, restore verificato, rehearsal 54→55, runner ufficiale; soli API/WEB ricreati | Evidenze supplier55, backup durevole, override immagini                                                 | 137 tabelle, stock/documenti/uploads, ledger/checksum/replay | V-EVIDENZA: riuscito; V-CORRENTE ledger 55/55                        |
| Installare conferma e ricompilare 8082        | WEB Linux dal working tree congelato, Compose reale, soli WEB ricreati due volte            | Manifest conferma, ultimo `web-success.json`, override durevoli                                         | ID immagini, sorgenti, HTTP, identità API/PG/preview         | V-CORRENTE e V-EVIDENZA: ultimo WEB `e74cd648…`                      |
| Eliminare 8083                                | Stop/rm nominativi di tre container, rete e due volumi                                      | `/private/tmp/magazzino-preview8083-cleanup-yeaVYx/result.json`                                         | Inventario finale e confronto ufficiale prima/dopo           | V-CORRENTE: preview assente, ufficiale sano; dati di prova eliminati |

## 6. Migration e stato dei dati

| Numero ledger | File SQL                                          | Contenuto                                                    | Pubblicato             | Applicato ufficiale |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------ | ---------------------- | ------------------- |
| 1–50          | Baseline fino M6.3                                | Invariata nei correttivi descritti                           | Sì                     | Sì                  |
| 51            | `20261012_m64_administrative_sources_exports.sql` | Rappresentazioni export immutabili, identità/hash/versione   | Sì, M6.4               | Sì                  |
| 52            | `20261012_z_m64_reconciliation_versions.sql`      | Versioni/fonti/osservazioni/lineage e run di riconciliazione | Sì, M6.4               | Sì                  |
| 53            | `20261012_zz_m64_review_integrity.sql`            | Vincoli di versione/claim e ordine cutoff                    | Sì, M6.4               | Sì                  |
| 54            | `20261013_mensa_richieste_magazzino.sql`          | Raccordo richiesta↔Mensa, FK, indice, check e trigger        | Sì, `535e5a4…`         | Sì                  |
| 55            | `20261013_z_mensa_magazzino_richiesto.sql`        | Preferenza origine e nome snapshot, FK/check/immutabilità    | **No, file untracked** | **Sì**              |

Dettaglio 54: `richieste_magazzino.mensa_id` nullable, FK `mense` con delete
restrict, indice dedicato; solo `tipo_destinatario=magazzino`,
`sorgente=operativa`, senza Intervento. All'INSERT, Mensa/Area/deposito
destinatario devono coincidere; all'UPDATE `mensa_id` e, per richieste Mensa,
Area/destinazione non possono essere riscritti. Nessuna assegnazione legacy.

Dettaglio 55: `magazzino_richiesto_id` nullable FK `magazzini` delete restrict,
`magazzino_richiesto_nome_snapshot varchar(120)`; coppia entrambi NULL oppure
entrambi valorizzati, nome non vuoto, solo Mensa e origine diversa dalla
destinazione. Trigger UPDATE vieta di cambiare ID/nome della preferenza.
L'obbligatorietà per le nuove richieste Mensa e i controlli di attività/territorio
sono anche nel comando API. Legacy NULL resta valido e non viene backfillato.

Checksum SHA-256 letti dai file attuali:

```text
51 680386a717d881f9ffe75f1f4e45b9f112b0e4469644f54736457ddfc560fd92
52 37aa164bb4ea4d66f7735084837d351bb2e10660ee5305b68b2211e30a01d531
53 8b0490c32d9e6f675fdf15758696f9d6f4ae5704428dcfd92a3fbcd1c14f68c5
54 5b01e65016a2c1685a1248f2ef4594668193c242fd0fc612ff79256f6122b72d
55 5ef0fb3475a27d7435e9bbeee9dd1a32014540290fac473a5fe4b758e1be9f13
```

Le prove autentiche degli upgrade hanno usato sorgenti/schema/runner estratti
dalla SHA base, popolamento coerente con la versione precedente, snapshot,
sola migration nuova tramite ledger, confronto dati, replay e parità fresh.
Non sono prove ottenute creando direttamente il solo schema finale:

- 53→54, base `df9c9a9…`: `upgrade-result.json`, record invariati,
  legacy non assegnato, replay/parità true.
- 54→55, base `535e5a4…`: `upgrade-result.json`, record invariati,
  preferenza legacy NULL, replay/parità true.

Durante il deploy 55 il confronto ha preservato i dati di business; l'unica
differenza ammessa dal bootstrap riguarda `moduli_funzionali.data_aggiornamento`.
Non dichiarare identità assoluta di tutti i timestamp. Questa è un'evidenza del
rilascio, non una garanzia che successivi interventi manuali non abbiano scritto
dati. Non sono stati letti record utente o stock dettagliati per l'handover.

## 7. Docker effettivo e backup

### 7.1 Ufficiale 8082, osservazione corrente

Compose project: `magazzino-solidale`; rete: `magazzino-solidale_default`.
URL: `http://127.0.0.1:8082`, Mensa: `/mensa/trasferimenti`.

| Servizio   | Container ID                                                       | Immagine effettiva                                                        |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| WEB        | `547e8690dd3d556bf732adfc05b0c73b6138e6789e21d67d1f3fdea76feb7b91` | `sha256:e74cd648ab8b47e49878b093db71dd5cb10a6c739c3a79548641a9ca3a1a5da3` |
| API        | `a1b0560a0e930a27b9374e01ff548e4008eee45eabfef1a89a32604376faa6ce` | `sha256:d9c8ba73caa815e2fe7e1e84dea0c32e14388a016444813fbac47b1e3613519d` |
| PostgreSQL | `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797` | `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` |

- WEB tag: `magazzino-mensa-inviata-web:rebuild-uat-20261013`, avviato
  13 ottobre 10:30:36 Roma, porta host 8082 → 80.
- API tag: `magazzino-mensa-official-api:wt-supplier55-3359a275fcd8`, avviata
  13 ottobre 09:54:02 Roma, health Docker `healthy`; porta 8080 interna.
- PostgreSQL: `postgres:16-alpine`, health `healthy`, stesso avvio
  6 ottobre 16:06:51 Roma; porta host 5434 → 5432. Non è stato ricreato
  nei rilasci descritti.
- Volume DB: `magazzino-solidale_magazzino_pgdata` → `/var/lib/postgresql/data`.
- Volume uploads: `magazzino-solidale_magazzino_uploads` → `/app/uploads` API.
- HTTP root, `/config.js`, `/api/healthz`, `/api/readyz`: 200 nella ricognizione.
  La readiness restituisce database OK e ledger 55/55 integro. Non è uno smoke
  funzionale autenticato della GUI e non equivale a UAT.

### 7.2 Identità dei candidati e immagini precedenti

| Candidato                                             | Fingerprint SHA-256 del contesto software                          | Stato / confronto corrente                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Correttivo pubblicato (manifest sviluppo, 2079 input) | `941a726c27f5a60aa8451fd641a8693e43aa48ea8e5e3bc992d89caa76a8e53f` | Storico nel rapporto pubblicato; oggi il working tree è ulteriormente modificato            |
| Preferenza/55 (2081 input)                            | `3359a275fcd8ed02fbe27cf511dc3fdea946a3a96914d20ba983a83feea608e7` | Manifest presente; **6 file differiscono oggi**, tutti frontend/test della conferma         |
| Conferma / ultimo rebuild (2081 input)                | `3160a750941db0d526f898064f20726ba68bf601a4fb9855355af95c0c59648b` | Manifest conferma e ultimo rebuild riletti: **zero file input divergenti** dal working tree |

Questi fingerprint escludono documentazione, segreti e output di build;
non sono hash Git del commit né impronte dell'intero filesystem.
Il confronto del manifest supplier55 mostra identità di backend, test API,
schema, contratti e dipendenze: l'API 1853 PASS è applicabile a quegli input
ancora identici, ma non certifica il frontend modificato dopo di essa.

Precedente WEB prima dell'ultimo rebuild:
`sha256:e575418e88ed8bea1a178b85ad5f5c5d58f39ff6d7f04ab39330cdbcaf1d2f04`.
WEB precedente alla conferma:
`sha256:16a007ddeb7fe567df557338b981457f25a5f16d3ce60c1d945318f76698a955`.
I verbali di rilascio attestano la conservazione per rollback. La presenza di
tutte le vecchie immagini non è stata ricensita singolarmente per l'handover.
Non confondere le immagini di sola build (`84a6f178…`, `da495dd9…`) riportate
nel rapporto preferenza con quelle ufficiali effettivamente installate.

### 7.3 Compose reale: dipendenza operativa dai file locali

Le label del WEB indicano la composizione effettiva, in quest'ordine:

```text
/Users/florianocaprio/Projects/Magazzino-Solidale/docker-compose.yml
/Users/florianocaprio/Backups/Magazzino-Solidale/M6.3-Ufficiale-eb5c3a7-20261011-t02kmt/release-images.json
/Users/florianocaprio/Backups/Magazzino-Solidale/Mensa-Magazzino-535e5a403fd7-2026-10-12T215233-897Z/release-images.json
/Users/florianocaprio/Backups/Magazzino-Solidale/Mensa-Preferenza55-535e5a403fd7-2026-10-13T075258-126Z/release-images.json
/Users/florianocaprio/Backups/Magazzino-Solidale/Mensa-Inviata-WEB-2026-10-13T082641-500Z/web-image.json
/Users/florianocaprio/Backups/Magazzino-Solidale/Mensa-Inviata-WEB-2026-10-13T083035-785Z/web-image.json
```

API usa la stessa catena fino all'override Preferenza55; PostgreSQL il compose
base. `.env.docker` resta locale/privato. I file sotto Backups non sono soltanto
verbali: alcuni sono override ancora necessari a riprodurre l'installazione.
Non eliminarli durante una pulizia e non presumere che `docker compose up`
con il solo file base riproduca queste immagini. Qualsiasi consolidamento della
catena Compose è una futura attività separata, non svolta qui.

### 7.4 Backup verificati e limiti

| Directory sotto `/Users/florianocaprio/Backups/Magazzino-Solidale/` | Backup DB                            | Verifica disponibile                                                                     |
| ------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------- |
| `M6.4-Ufficiale-df9c9a9-2026-10-12T194316-991Z`                     | Backup del primo tentativo, pre-M6.4 | TOC leggibile; restore iniziale fallito nel setup. Non usarlo come prova di restore PASS |
| `Mensa-Magazzino-535e5a403fd7-2026-10-12T215233-897Z`               | 986642 byte; pre-upgrade 50→54       | Verbale restore 131 tabelle PASS; rehearsal e confronto, release-success ledger 54       |
| `Mensa-Preferenza55-535e5a403fd7-2026-10-13T075258-126Z`            | 1045546 byte; pre-upgrade 54→55      | Verbale restore 137 tabelle PASS; rehearsal, dati/upload e release-success ledger 55     |

SHA-256 riletti ora sui due dump più recenti:

```text
Mensa-Magazzino/database.dump
8c77e7d714de1445be563147940e226e630f2878bbb2022a1da6d39757c2a51d
Mensa-Preferenza55/database.dump
4e29a3a7d7a4c7fdbbe73e854988855d998ae7c6d2dd71d66ca1877e0e909e4c
uploads.tar.gz (entrambi, 87 byte)
1e0b37ed517c7bf15ce69619a7417858eb974410477daac3e3635fc20500d4d0
```

Gli uploads contenevano zero file al momento dei backup; estrazione e confronto
hash risultano verificati dai verbali. Non si presume che il volume sia ancora
vuoto dopo eventuali operazioni manuali successive. Il ricalcolo dei checksum
in questo handover prova la conservazione dei file, non ripete il restore.
Non è stato creato un nuovo backup post-migration55 durante questo mandato.

Le directory `Mensa-Inviata-WEB-2026-10-13T082641-500Z` e
`Mensa-Inviata-WEB-2026-10-13T083035-785Z` contengono manifest, override,
preflight e risultati WEB: **non nuovi dump DB**.

### 7.5 Cleanup 8083 e altre risorse

Eliminati definitivamente su mandato utente:

```text
container: magazzino-m64-uat-df9c9a94-web
container: magazzino-m64-uat-df9c9a94-api
container: magazzino-m64-uat-df9c9a94-db
network:   magazzino-m64-uat-df9c9a94-net
volume:    magazzino-m64-uat-df9c9a94-pgdata
volume:    magazzino-m64-uat-df9c9a94-uploads
```

Il verbale cleanup confronta ID/immagini/avvio/mount dell'ufficiale prima/dopo;
l'inventario corrente mostra soltanto i tre container ufficiali. I dati UAT
contenuti nei due volumi eliminati non sono più disponibili; nessun nuovo
backup della preview è attestato dal cleanup. Non tentare di ricostruirli dalla 8082. Non è stata richiesta né attestata la rimozione di tutte le immagini
Docker storiche.

Restano risorse di altri progetti e vecchie reti non rimosse dal mandato 8083:
volumi `aqse_frontend_node_modules`, `dms_dms_pgdata`,
`qkd-simulator_qkd_pgdata`, un volume anonimo; reti `fase5-2-net`,
`magazzino-m0-app-net`, `magazzino-m0-net`, `magazzino-m1a-candidate-net`,
`magazzino-m1b-candidate-net`, `magazzino-m1c-candidate-net`,
`magazzino-m2-candidate-net`, oltre alle reti Docker standard e ufficiale.
La loro proprietà/utilità non è stata riesaminata per autorizzarne la rimozione.
«Solo 8082» descrive lo stack applicativo rimasto, non l'assenza di ogni risorsa
Docker storica sull'host.

## 8. Test, prove mantenute e UAT

### 8.1 Risultati per candidato, senza sommare campagne

| Candidato / campagna               | API globale                                        | Frontend globale    | Browser / altre prove                                                             | Qualifica                                                              |
| ---------------------------------- | -------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| M6.4 R5 / `df9c9a9…`               | 1842 PASS, 0 FAIL, 0 SKIP                          | 606 PASS            | 119 PASS, 71 skip storici; runner 24; fresh 53, upgrade e parità                  | API JSON V-EVIDENZA; rapporto R5 per composizione gate                 |
| Correttivo pubblicato / `535e5a4…` | 1850 PASS, 0 FAIL, 0 SKIP, 145 file                | 614 PASS, 105 file  | Mensa 13 PASS/12 skip; M5 10 PASS; M4 8 PASS/32 skip; runner 24; 53→54            | V-EVIDENZA JSON/log e rapporto pubblicato                              |
| Preferenza/55 locale               | 1853 PASS, 0 FAIL, 0 SKIP, 145 file                | 616 PASS, 105 file  | Mensa 13 PASS/12 skip; M5 10 PASS; runner 24; 54→55                               | V-EVIDENZA JSON/log/upgrade                                            |
| Conferma invio locale finale       | **Non rieseguita globalmente**; 11 API mirati PASS | 627 PASS, 105 file  | Mensa 13 PASS/12 skip, zero flaky; typecheck, build WEB/Linux, budget, formatting | V-EVIDENZA; backend/test API/schema/contratti identici alla preferenza |
| Ultimo rebuild WEB                 | Nessuna suite nuova                                | Nessuna suite nuova | Stesso fingerprint del candidato precedente; build Linux, HTTP, bundle e immagini | V-CORRENTE/V-EVIDENZA, non nuova certificazione funzionale             |
| Questo handover                    | Nessuna suite                                      | Nessuna suite       | Git, manifest, hash backup, inventario e health/readiness read-only               | Non attribuisce ulteriori PASS di collaudo                             |

La denominazione `formal-*` dei log è ereditata dall'harness. Il rapporto del
correttivo pubblicato mantiene **collaudo formale separato PENDING**: i risultati
tecnici disponibili non vengono retroattivamente trasformati in quel mandato.
La pubblicazione e i deploy sono stati autorizzati direttamente da Floriano.

Cinque viewport: 390×844, 768×1024, 1024×768, 820×1180, 1440×900.
Nei gruppi Mensa, 12 skip corrispondono alle tre prove storiche eseguite solo
desktop e non replicate nelle quattro viewport touch (consumo con risposta
persa, persona temporanea/pasto, R2-04 lotto reale). Quelle tre prove passano
su desktop; il nuovo percorso richiesta→ricezione passa su tutte le viewport.
I 32 skip M4 sono analogamente repliche storiche desktop-only, non nuovi casi
saltati introdotti dal correttivo. Un'emulazione tablet non è un tablet fisico.

### 8.2 Evidenze locali utili e integrità

| Directory                                                 | Contenuto da consultare                                                                                                                                           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/private/tmp/magazzino-m64-r3-x0Ns8rBw`                  | `formal-r5-freeze-final.json`, `r5-certification.json`, `r5-reused-evidence.json`, `recovery/formal-api.json`, R5/R5b browser                                     |
| `/private/tmp/magazzino-mensa-fix-SHSMf3yo`               | `upgrade-result.json`, `frontend-final.log`, `campaign2/formal-api.json`, `campaign2/browser-mensa.json`, `browser-m5.json`, `browser-m4.json`, release e cleanup |
| `/private/tmp/magazzino-mensa-preferenza-nv0Q49mM`        | `upgrade-result.json`, `formal-api.json`, `frontend-final.log`, browser Mensa/M5, runner, `supplier55-context-manifest.json`, cleanup                             |
| `/private/tmp/magazzino-mensa-supplier55-deploy-6HT4tAiN` | `release-backup-verified.json`, `release-rehearsal.json`, `release-success.json`, `release-cleanup.json`                                                          |
| `/private/tmp/magazzino-mensa-inviata-RqFhZeFa`           | `frontend-group.log`, `typecheck-group.log`, `api-target.log`, `browser-mensa-final.json`, primo browser non verde, `source-delta.json`, manifest e cleanup       |
| `/private/tmp/magazzino-mensa-web-rebuild-pJFSzxlL`       | `rebuild-uat-20261013-context-manifest.json`, log build, `web-preflight.json`, `web-success.json`                                                                 |
| `/private/tmp/magazzino-preview8083-cleanup-yeaVYx`       | `before.json`, `result.json` cleanup                                                                                                                              |

Hash di tre risultati grezzi riletti, per identificare esattamente le evidenze:

```text
Correttivo/campaign2/formal-api.json
35e357b5b0f43906188c1e9cdff5e299029e7ca3af32a4f96de2e548860aaeca
Preferenza/formal-api.json
87824b660b13f55036149f0f742d9153d8d8ddab9a5c14e6f595430a4d89f69d
Conferma/browser-mensa-final.json
c7cfc2422b44454820bf6ec826e04e3ffd2c2bce07a9c364edc6db10c4921797
```

Codegen deterministico, build Linux API/WEB e runtime con caratteri speciali
sono riportati PASS per i candidati correzione/preferenza. Nell'ultima UX sono
stati rieseguiti frontend, typecheck, build WEB nativa/Linux e budget
1402,0 KiB / 388,2 KiB gzip; contratto/backend non sono cambiati.

Su macOS l'installazione offline ha restituito
`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`: non è stato forzato lo svuotamento
di `node_modules`. Comandi nativi con binari Darwin già disponibili fuori repo;
build Linux con install frozen canonica. Non dichiarare l'installazione locale
offline riuscita né cambiare LightningCSS/policy multipiattaforma per aggirarla.

### 8.3 Stato manuale

| Perimetro                                          | Stato                       | Motivazione                                                                              |
| -------------------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------- |
| M6.4 sulla vecchia preview 8083                    | DICHIARATO-UTENTE: positiva | Comunicazione esplicita nel mandato di rilascio; preview poi rimossa                     |
| Correttivo integrato Mensa/Magazzino               | PENDING come UAT conclusa   | Rapporto pubblicato e disponibilità per UAT; nessuna dichiarazione finale PASS acquisita |
| Preferenza modificabile e origine alternativa      | PENDING                     | Decisione approvata, prove automatiche verdi, installata; manca esito manuale attestato  |
| Conferma invio, colori e interazione Area/menu     | PENDING                     | Utente ha chiesto la ricompilazione per test; nessun successivo PASS manuale             |
| Fotocamera/lettore fisico e tablet fisico          | NE-MAN                      | Test simulati/browser non equivalenti a hardware reale                                   |
| Smoke autenticato dell'ultima GUI durante handover | Non eseguito                | Effettuati soltanto endpoint pubblici/tecnici read-only                                  |

## 9. Inventario completo dei file dopo M6.4

### 9.1 Delta pubblicato `df9c9a9…` → `535e5a4…`

Fonte: `git diff --name-status df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb
535e5a403fd7eb0d940256de2dc34ce67f7b0166`.
Diffstat Git: **48 entry, 3541 inserimenti, 1451 rimozioni**. Il rename conta
come una entry e interessa due percorsi; l'inventario copre anche i generated
eliminati, non solo i file ancora presenti.

```text
M artifacts/api-server/src/lib/areas.ts
M artifacts/api-server/src/lib/m5bRequestAccess.ts
M artifacts/api-server/src/lib/mensaScope.ts
A artifacts/api-server/src/lib/mensaTransferDestination.ts
M artifacts/api-server/src/lib/transferWorkflow.ts
M artifacts/api-server/src/routes/documenti-operativi.ts
M artifacts/api-server/src/routes/mensa.ts
M artifacts/api-server/src/routes/richieste-magazzino.ts
M artifacts/api-server/src/routes/trasferimenti.ts
M artifacts/api-server/tests/m5a-contract-migration.test.ts
A artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts
M artifacts/api-server/tests/mensa.test.ts
A artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts
M artifacts/magazzino-solidale/e2e/mensa-workflows.spec.ts
M artifacts/magazzino-solidale/src/components/barcode-scanner-button.test.tsx
M artifacts/magazzino-solidale/src/components/barcode-scanner-button.tsx
M artifacts/magazzino-solidale/src/components/documento-operativo.tsx
A artifacts/magazzino-solidale/src/components/mensa-operational-context.test.tsx
A artifacts/magazzino-solidale/src/components/mensa-operational-context.tsx
M artifacts/magazzino-solidale/src/components/mensa-postazione.test.tsx
A artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx
A artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx
M artifacts/magazzino-solidale/src/components/trasferimenti-lotti.test.tsx
M artifacts/magazzino-solidale/src/lib/bolla-query-invalidation.ts
M artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts
M artifacts/magazzino-solidale/src/pages/mensa.tsx
M artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx
M artifacts/magazzino-solidale/src/pages/trasferimenti.tsx
A docs/Correttivo-Mensa-Magazzino-Sviluppo.md
M lib/api-client-react/src/generated/api.schemas.ts
M lib/api-client-react/src/generated/api.ts
M lib/api-spec/openapi.yaml
M lib/api-zod/src/generated/api.ts
D lib/api-zod/src/generated/types/createTrasferimentoMensa201.ts
R lib/api-zod/src/generated/types/createTrasferimentoMensa200.ts
  -> lib/api-zod/src/generated/types/createTrasferimentoMensa410.ts
M lib/api-zod/src/generated/types/index.ts
M lib/api-zod/src/generated/types/listMensaAbilitazioniParams.ts
M lib/api-zod/src/generated/types/listRichiesteMagazzinoParams.ts
D lib/api-zod/src/generated/types/listTrasferimentiMensa200.ts
M lib/api-zod/src/generated/types/listTrasferimentiMensaParams.ts
M lib/api-zod/src/generated/types/mensaTrasferimentiPage.ts
D lib/api-zod/src/generated/types/mensaTrasferimentiPageItemsItem.ts
A lib/api-zod/src/generated/types/mensaTrasferimentoSummary.ts
M lib/api-zod/src/generated/types/richiestaMagazzino.ts
M lib/api-zod/src/generated/types/richiestaMagazzinoCreate.ts
M lib/api-zod/src/generated/types/searchMensaBeneficiariParams.ts
M lib/db/src/schema/richiesteMagazzino.ts
A lib/db/updates/20261013_mensa_richieste_magazzino.sql
```

### 9.2 Delta locale non pubblicato rispetto a `535e5a4…`

Legenda intervento: **P55** preferenza magazzino; **UX** conferma invio/badge.
Nessuno di questi delta è già incluso nel commit remoto per il solo fatto che
il relativo file esista anche su GitHub.

| Stato | Percorso completo relativo al repository                                         | Intervento                                |
| ----- | -------------------------------------------------------------------------------- | ----------------------------------------- |
| M     | `artifacts/api-server/src/routes/mensa.ts`                                       | P55                                       |
| M     | `artifacts/api-server/src/routes/richieste-magazzino.ts`                         | P55                                       |
| M     | `artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts`                  | P55                                       |
| M     | `artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts`            | P55 + UX                                  |
| M     | `artifacts/magazzino-solidale/src/components/mensa-operational-context.test.tsx` | UX                                        |
| M     | `artifacts/magazzino-solidale/src/components/mensa-operational-context.tsx`      | UX                                        |
| M     | `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx`        | P55 + UX                                  |
| M     | `artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx`             | P55 + UX                                  |
| M     | `artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts`                  | P55 + UX                                  |
| M     | `artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx`                 | P55                                       |
| M     | `lib/api-client-react/src/generated/api.schemas.ts`                              | P55, canonico                             |
| M     | `lib/api-client-react/src/generated/api.ts`                                      | P55, canonico                             |
| M     | `lib/api-spec/openapi.yaml`                                                      | P55, fonte autorevole                     |
| M     | `lib/api-zod/src/generated/api.ts`                                               | P55, canonico                             |
| M     | `lib/api-zod/src/generated/types/index.ts`                                       | P55, canonico                             |
| M     | `lib/api-zod/src/generated/types/richiestaMagazzino.ts`                          | P55, canonico                             |
| M     | `lib/api-zod/src/generated/types/richiestaMagazzinoCreate.ts`                    | P55, canonico                             |
| M     | `lib/db/src/schema/richiesteMagazzino.ts`                                        | P55                                       |
| ??    | `lib/api-zod/src/generated/types/listMagazziniMensaParams.ts`                    | P55, nuovo generated necessario           |
| ??    | `lib/db/updates/20261013_z_mensa_magazzino_richiesto.sql`                        | P55, nuova migration già installata       |
| ??    | `docs/Mensa-Magazzino-Preferenza-Approvvigionamento.md`                          | Rapporto sviluppo P55, storico pre-deploy |
| ??    | `docs/Mensa-Richiesta-Inviata-UX.md`                                             | Rapporto UX e prima installazione WEB     |

Diffstat dei soli file già tracciati rispetto a HEAD, prima del documento:
**18 file, 981 inserimenti, 105 rimozioni**. Non comprende nuovi file SQL/tipi o
documenti untracked. I sei documenti estranei seguenti completano i 10 untracked
iniziali; questo handover aggiunge un undicesimo untracked, senza staging:

```text
docs/M6.2-A-Rilascio-Ufficiale-20261009.md
docs/M6.2-B-Rilascio-20261009.md
docs/M6.2-C-Pubblicazione-Preview.md
docs/M6.2-C-Rilascio-Ufficiale.md
docs/M6.3-Interventi-Rilascio-Ufficiale.md
docs/M6.4-FSE-AGEA-Rilascio-Ufficiale.md
```

Sono preservati fuori dal perimetro di qualsiasi staging automatico. Non usare
`git add .` per consolidare i correttivi. Non sono stati modificati preparando
questo documento.

## 10. Rapporti discordanti: regola di precedenza

| Documento / affermazione storica                                                         | Interpretazione corretta al 13 ottobre                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `M6.4-FSE-AGEA-Rilascio-Ufficiale.md`: NO-GO, ufficiale a ledger 50                      | Vero per il primo tentativo. Superato operativamente dal successivo rilascio integrato 50→54 verificato, poi 55; non cancellare il rapporto |
| `Correttivo-Mensa-Magazzino-Sviluppo.md`: deploy da eseguire                             | Stato della consegna sviluppo. Commit `535e5a4…` pubblicato e rilascio-success a 54 disponibili successivamente                             |
| `Mensa-Magazzino-Preferenza-Approvvigionamento.md`: solo effimero, persistente invariato | Vero alla consegna sviluppo; successivamente autorizzato e completato deploy 55, documentato in Backups/evidenze e readiness corrente       |
| `Mensa-Richiesta-Inviata-UX.md`: WEB `e575418…`                                          | Prima installazione della stessa UX. Ultimo rebuild installa `e74cd648…` con identico fingerprint software                                  |
| `M6.4-FSE-AGEA-UAT.md`: tutti PENDING / D64 da completare                                | Piano iniziale e appendici storiche. D64 implementata/certificata R5; Floriano ha poi dichiarato UAT M6.4 positiva                          |
| Rapporti generali `AVANZAMENTO.md` / matrici antiche                                     | Utili per invarianti e storia, non per dedurre automaticamente l'ultimo deploy o la UAT dei correttivi attuali                              |

Non selezionare il rapporto più favorevole ignorando gli altri: usare ordine
temporale, identità del candidato, evidenze e stato effettivo. Questo handover
riconcilia la cronologia senza riscrivere i verbali originali.

## 11. Problemi aperti, rischi concreti e roadmap

| Priorità    | Punto aperto                                              | Prossimo passo / criterio di completamento                                                                                                                           |
| ----------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alta        | Delta installato ma non pubblicato, migration 55 compresa | Review dell'intero delta P55+UX, inclusi file untracked; mandato di consolidamento/pubblicazione e verifiche candidate. Non è autorizzato un push da questo handover |
| Alta        | UAT Mensa successiva al correttivo non attestata          | Floriano verifica richiesta/preferenza/origine alternativa/ricezione e nuova conferma sulla 8082; registrare esiti separati e SHA/fingerprint                        |
| Alta        | Evidenze locali sotto `/private/tmp`                      | Prima di una pulizia futura, conservare in sede privata durevole risultati e manifest essenziali. Non pubblicare trace/dump/credenziali/dati reali                   |
| Media       | COMPLETATA UI ≠ chiusa amministrativamente                | Documentare la distinzione agli integratori. Eventuale convergenza del lifecycle richiede decisione funzionale; nessuna mutazione opportunistica                     |
| Media       | Hardware scanner/camera/tablet reale                      | UAT fisica con permessi e dispositivi reali; mantenere NE-MAN finché non attestata                                                                                   |
| Media       | Legacy trasferimenti non attribuibili alla Mensa          | Conservare storico consultabile dal Magazzino. Eventuale riclassificazione solo con prove e mandato, senza backfill permissivo                                       |
| Media       | Catena override Compose fuori repo                        | Conservare file e immagini; futura normalizzazione documentata del rilascio, mantenendo identità/mount/env e dati                                                    |
| Media       | Primo rapporto rilascio M6.4 resta NO-GO                  | Alla futura chiusura documentale, aggiungere un verbale successivo coerente; non alterare la failure storica                                                         |
| Media       | Formato ufficiale SIFEAD non verificato                   | Ottenere specifica/accettazione ufficiale prima di dichiarare compatibilità o invio certificato                                                                      |
| Pianificata | R64-05 UX                                                 | Intervento UX separato o M6.6, con requisiti espliciti                                                                                                               |
| Pianificata | M6.6 reporting/KPI trasversali                            | Definizioni comuni di filtri, denominatori, unità, fondi, snapshot e drill-down; preservare correttezza verticale e fatti reali                                      |
| Da definire | Eventuale M6.5 o ulteriori milestone                      | Nessun mandato/scopo M6.5 identificato nelle fonti lette; non inventarne contenuto o stato                                                                           |
| Da decidere | Conservazione originali amministrativi                    | M6.4 non autorizza conservazione illimitata né cancellazione automatica; richiede policy esplicita                                                                   |
| Limite noto | Throughput/pool sotto carico elevato                      | Non certificato dalle prove funzionali; misurazione separata se richiesta                                                                                            |

Non sono emerse nuove failure applicative eseguendo la sola ricognizione;
questa affermazione non equivale a una nuova campagna completa verde. Le
failure precedenti sono riconciliate nelle campagne indicate e non devono
essere riaperte come bug correnti senza riproduzione sul candidato corretto.

## 12. Indicazioni per il tecnico subentrante

### 12.1 Ricostruire la base pubblicata e il delta locale

Comandi di sola lettura, nel repository:

```bash
git branch --show-current
git rev-parse HEAD
git status --short --branch
git diff --cached --name-only
git ls-remote origin refs/heads/codex/magazzino-workflow-unificato refs/heads/main
git diff --name-status df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb HEAD
git diff --stat
git ls-files --others --exclude-standard
```

Non fare reset/clean/stash/checkout/rebase per «allineare» questo checkout:
si perderebbe la distinzione essenziale fra remoto e installato. La migration
55 e il tipo generato nuovo sono untracked ma necessari. I sei documenti
estranei non vanno inclusi indiscriminatamente nel futuro commit.

### 12.2 Pipeline canonica e validazione futura

Riferimenti ai comandi reali del progetto, **non eseguiti da questo handover**:

```bash
pnpm --filter @workspace/api-spec run codegen
pnpm run typecheck
pnpm --filter @workspace/magazzino-solidale run test
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/db run test:migrations
pnpm --filter @workspace/db run test:fresh
pnpm --filter @workspace/magazzino-solidale run build:budget
```

Codegen include Orval, fix upload binari, Prettier dei generated e typecheck
lib. Non produrre modifiche manuali ai generated. Le suite API richiedono
database effimeri correttamente predisposti e variabili/guardie del gruppo;
il comando generico sopra non è una configurazione pronta per l'ufficiale.

Gli harness precedenti sotto `/private/tmp` mostrano il provisioning usato,
ma contengono nomi/porte e talvolta ledger attesi per quella campagna: leggerli,
verificarli e predisporre un ambiente nuovo prima del riuso. Credenziali di
test precedenti sono state eliminate, i database tmpfs non esistono più.
Non ricreare la preview 8083 senza una nuova necessità/mandato dopo il cleanup.

Ordine consigliato per il consolidamento: identificare e congelare l'intero
candidato locale; verificare applicabilità delle evidenze; completare il
collaudo formale richiesto e la review; pubblicare esplicitamente sul branch
dedicato quando autorizzato; registrare la nuova SHA che contiene migration55
e l'UX; successivi rilasci dalla SHA pubblicata con backup fresco verificato.
Un eventuale ritorno al solo commit remoto non costituisce rollback DB sicuro.

### 12.3 UAT utile da registrare

1. Operatore Mensa realmente assegnato: Area corretta, Mensa corretta, elenco
   approvvigionamento senza depositi inattivi, altra Area o propria destinazione.
2. Invio bisogno con preferenza: nessun movimento stock all'invio; conferma con
   codice e richiesta INVIATA blu nel riepilogo, anche partendo da pagina 2.
3. Clic Area/conferma e cambio menu: schermata scompare; un semplice refresh
   del riepilogo non deve far perdere la prova visiva dell'invio riuscito.
4. Magazzino: presa in carico, preferenza originale visibile, possibile origine
   alternativa; prodotti/UOM/lotti/quantità da Catalogo/M4, niente doppio scarico.
5. Mensa: PRESA IN CARICO ambra; ricezione reale del trasferimento corrente;
   COMPLETATA verde dopo ricezione, consapevoli della distinzione amministrativa.
6. Revoca a sessione aperta e retry: diniego corrente, niente nuova creazione;
   prova su ambiente dedicato se comporta modifiche autorizzative/dati di test.
7. Camera/lettore e tablet fisici: registrare separatamente dispositivo ed esito.

Qualsiasi test manuale che scriva dati ufficiali deve essere eseguito con
consapevolezza dell'ambiente; il tecnico non deve creare automaticamente
fixture sulla 8082 per completare una checklist.

## 13. Consegna e stato finale del documento

Documento prodotto localmente: `docs/HANDOVER-MAGAZZINO-SOLIDALE-2026-10.md`.
SHA pubblicata verificata direttamente sul branch:
**`535e5a403fd7eb0d940256de2dc34ce67f7b0166`**.

Questo handover non è stato committato o pubblicato. Il working tree conserva
integralmente i correttivi P55/UX e i documenti precedenti; staging vuoto.
Nessun merge/push su main, nessun nuovo rilascio, nessun accesso diretto al DB,
nessuna creazione/rimozione Docker durante la preparazione. Il solo controllo
readiness attraversa normalmente l'API esistente in lettura.

Stato operativo: **8082 disponibile con ledger 55 e correttivi locali;
8083 eliminata; consolidamento Git e UAT degli ultimi correttivi ancora aperti.**

## 14. Appendice — consolidamento finale P55 e UX

13 ottobre 2026. Il successivo mandato «Consolidamento finale Mensa/Magazzino —
Verifica, commit e push» autorizza la pubblicazione dei correttivi già installati.
Le sezioni 1–13 conservano lo snapshot e la cronologia precedenti: le indicazioni
«non pubblicato» e «questo handover non committato» si riferiscono a quel momento.
Questa appendice accompagna il commit di consolidamento che contiene il documento.
La sua SHA si ottiene dal commit stesso, senza confonderla con la base
`535e5a403fd7eb0d940256de2dc34ce67f7b0166`. Il rapporto conclusivo locale
`docs/Mensa-Magazzino-Consolidamento-Finale.md`, prodotto dopo la verifica del
push, registra la SHA finale completa riletta dal remoto.

### 14.1 Identità e applicabilità delle prove

- Preflight: branch corretto, HEAD/tracking/remoto sulla base `535e5a4…`,
  divergenza nulla, staging inizialmente vuoto. Main remoto invariato
  `787d7c5436d5fa4c0edb24be373d055946d402ce`.
- Tutti i 2081 input del manifest dell'ultimo WEB sono stati confrontati con
  i file locali: zero differenze. Fingerprint software
  `3160a750941db0d526f898064f20726ba68bf601a4fb9855355af95c0c59648b`.
- Il manifest P55 e l'etichetta dell'immagine API installata identificano
  `3359a275fcd8ed02fbe27cf511dc3fdea946a3a96914d20ba983a83feea608e7`.
  Le sole sei differenze attuali rispetto a quel manifest sono i file UX
  frontend/test già elencati in 5.4 e coperti dalle prove finali: backend,
  test API, schema, migration, contratti, generated, dipendenze e configurazioni
  pertinenti sono identici.
- Migration 55 identica al manifest P55 e alle evidenze di installazione:
  SHA-256 `5ef0fb3475a27d7435e9bbeee9dd1a32014540290fac473a5fe4b758e1be9f13`.
  La readiness ufficiale prima della pubblicazione conferma 55/55, zero pending,
  mismatch, file mancanti e fuori ordine. Nessuna migration applicata o modificata
  in questa fase.
- Revisione del delta applicativo, test e generated: preferenza obbligatoria
  nel comando Mensa, snapshot immutabile, origine effettiva modificabile dal
  Magazzino, contratti coerenti e nuove query per Area/Mensa. La UX non modifica
  lo stato amministrativo: COMPLETATA resta derivata dalla ricezione del
  trasferimento corrente. Nessuna nuova funzionalità introdotta nel consolidamento.

### 14.2 Gate: esecuzioni precedenti riutilizzate e controlli correnti

| Gate                        | Evidenza applicabile riutilizzata                                         | Controllo corrente                                                                    |
| --------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| API completa                | P55 `formal-api.json`: 1853 PASS, 0 FAIL, 0 SKIP                          | JSON riletto; identità degli input API verificata                                     |
| Frontend completo           | UX `frontend-group.log`: 627 PASS, 105 file                               | Log riletto; tutti gli input finali identici                                          |
| E2E Mensa                   | UX `browser-mensa-final.json`: 13 PASS, 12 skip storici, 0 FAIL/flaky     | JSON e risultato processo riletti; nessun nuovo skip/retry                            |
| Fresh/upgrade/replay/parità | P55, autentico popolato 54→55, legacy NULL e record invariati             | Risultato upgrade e ledger 54/55 riletti; schema/migration invariati                  |
| Runner                      | P55 `runner-final.log`: 24 PASS, 0 FAIL/SKIP                              | Log e codice uscita 0 riletti; runner/dependency/config invariati                     |
| Typecheck                   | UX `typecheck-group.log`: workspace completato                            | Applicabile per identità del software                                                 |
| Codegen                     | P55 `codegen-final.json` status 0 e `codegen-determinism.json` equal true | Contratto, configurazione e generated identici; completezza del nuovo tipo verificata |
| Build Linux                 | API P55 e WEB UX/ultimo rebuild riusciti                                  | Log disponibili; ID immagini installate e manifest verificati                         |
| Budget                      | Ultimo WEB sotto il limite di progetto                                    | Comando budget rieseguito sulla build locale disponibile                              |
| Formatting / hygiene        | Stile del candidato precedente preservato                                 | Prettier check dei file supportati e documenti; diff e staging controllati            |

Non sono state ripetute suite o build già applicabili. I controlli correnti
sono verifica delle evidenze, revisione, identità, formatting/hygiene e budget;
non costituiscono una nuova esecuzione dei 1853/627/13 test. Le failure storiche
nei rapporti P55/UX e nelle sezioni precedenti restano conservate.

### 14.3 Perimetro del commit e protezioni operative

Inclusi esattamente i 20 file software/test/contratti/schema/migration della
sezione 9.2, i due rapporti specifici P55/UX e questo handover: **23 file**.
I sei documenti estranei elencati nella stessa sezione sono esclusi e preservati
localmente, insieme a backup e override Compose. Nessun file ambiente, dump,
credenziale, trace o manifest privato incluso. Non risultano hook Git attivi
nel repository o un percorso hook custom; il commit/push non avvia un deploy.

Il commit consolida il candidato già presente sulla 8082. Non attribuisce alle
immagini Docker una nuova provenienza di build: sono ancora quelle compilate
prima del consolidamento, dalla base più il delta, con i fingerprint sopra.
Il software pubblicato è confrontabile con quegli input anche se le etichette
storiche delle immagini conservano la base `535e5a4…`.

Nessun rebuild/riavvio Docker, migration, modifica dati o ricreazione preview.
Identità container e immagini, disponibilità della 8082 e assenza delle risorse
8083 sono ricontrollate in sola lettura dopo il push e registrate nel rapporto
conclusivo. Non è uno smoke autenticato o una UAT.

**Sviluppo P55/UX consolidato nel commit che contiene questa appendice;
pubblicazione verificata nel rapporto conclusivo. UAT formalmente chiusa:
NON attestata.** Restano hardware NE-MAN, distinzione fra stato visualizzato e
amministrativo, rinvii M6.4/M6.6 e gli altri limiti della sezione 11. Nessuna
nuova milestone avviata e nessuna operazione su main.
