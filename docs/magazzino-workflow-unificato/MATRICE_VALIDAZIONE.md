# M0 — Matrice di validazione

Stato della matrice alla baseline `787d7c5`, aggiornato con la validazione umana della documentazione al commit `2966e1f892b61a03760b6687bbc7bcb0e7b2e78b`. “Presidio baseline” indica un componente esistente da riusare; non significa che il requisito futuro sia soddisfatto. Gli esiti avanzano solo con evidenza eseguita nella relativa fase `##test`, separatamente dall'approvazione del requisito.

Legenda: `NI` non implementato; `PV` proposta ancora da validare; `PB` presidio parziale di baseline; `PB-M2` fondazione M2 parziale di un requisito futuro; `NE` prova non eseguita; `NE-MAN` prova manuale/fisica non eseguita; `NE-MAN-CAMERA` prova con fotocamera reale non eseguita; `NE-MAN-TABLET` prova su tablet fisico non eseguita; `APP-M0` requisito approvato nella validazione umana M0; `OK-M1A` implementazione candidata con test automatici M1A superati; `DEV-M1B` implementazione candidata e controlli di sviluppo M1B eseguiti; `NE-TEST-M1B` fase separata `##test M1B` non ancora eseguita; `OK-M1B` implementazione candidata con test automatici M1B superati; `OK-MAN-M1B` dry run manuale M1B completato con esito positivo da Floriano; `DEV-M1C` implementazione candidata e controlli di sviluppo M1C eseguiti; `NE-TEST-M1C` fase separata `##test M1C` non ancora eseguita; `OK-M1C` implementazione candidata con test automatici M1C superati; `OK-MAN-M1C` dry run manuale M1C completato con esito positivo da Floriano; `DEV-M2` implementazione candidata e controlli di sviluppo M2 eseguiti; `NE-TEST-M2` fase separata `##test M2` non ancora eseguita; `OK-M2` implementazione candidata con test automatici M2 superati; `OK-MAN-M2` dry run manuale M2 completato con esito positivo da Floriano; `DEV-M3A` implementazione candidata e controlli di sviluppo M3A eseguiti; `NE-TEST-M3A` fase separata `##test M3A` non ancora eseguita; `OK-M3A` implementazione candidata con test automatici M3A superati; `OK-MAN-M3A` dry run manuale M3A completato con esito positivo da Floriano; `DEV-M3B` implementazione candidata e controlli mirati di sviluppo M3B eseguiti; `NE-TEST-M3B` fase separata `##test M3B` non ancora eseguita; `OK-M3B` implementazione candidata con gate automatici M3B completi superati; `OK-MAN-M3B` dry run manuale M3B completato con esito positivo da Floriano; `BLOCKED-M4A` fase formale M4A arrestata con finding o gate obbligatori non superati; `DEV-M4A-CORRETTO` finding del NO-GO corretti nel working tree con prove mirate della fase di sviluppo, senza rivalutazione di G1–G8 e senza equivalere a `OK-M4A`; `NE-TEST-M4A` nuova fase separata `##test M4A` non ancora eseguita; `OK-M0` evidenza ambientale eseguita in sviluppo M0; `OK-TEST-M0` prova automatica ripetuta nella fase `##test M0`. `APP-M0` non sostituisce mai `NI`, `PB` o `NE`; gli stati automatici non equivalgono da soli a validazione umana.

`OK-M4A` = implementazione M4A con gate automatici G1–G8 superati nel rerun
formale post-NO-GO. `OK-MAN-M4A` registra separatamente la validazione
funzionale manuale comunicata da Floriano alla chiusura. Le prove hardware
`NE-MAN-CAMERA` e `NE-MAN-TABLET` restano distinte e non bloccanti.

`DEV-M4B.1/NE-TEST/NE-MAN` indica implementazione candidata M4B.1 nel
working tree con sole prove di sviluppo, senza fase formale `##test M4B.1` né
validazione umana. Non modifica gli esiti chiusi di M4A.

| ID      | Milestone         | Stato                                         | Evidenza baseline / prova richiesta                                                                                                                                                                                                                                     |
| ------- | ----------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01   | M1A               | OK-M1A/NE-MAN                                 | Feedback immediato e stati persistenti del `Button` verificati per varianti, focus, disabled, `asChild` e target touch; prova fisica ancora pendente.                                                                                                                   |
| UX-02   | M1A               | OK-M1A/NE-MAN                                 | Apertura Radix, pending, `aria-busy` ed esclusione del doppio avvio XLSX/PDF verificati; prova visiva e percorso errore manuale restano pendenti.                                                                                                                       |
| UX-03   | M1A               | OK-M1A/NE-MAN                                 | Download e testo localizzato verificati; il click usa il generatore PDF esistente e non lascia stato persistente. Resta la prova browser del file prodotto.                                                                                                             |
| UX-04   | M1A               | OK-M1A/NE-MAN                                 | Toggle accessibile verificato per stato, focus, valore, autocomplete, non-submit, invio ed errore login; prova con tastiera/touch fisici ancora pendente.                                                                                                               |
| GEO-01  | M1B               | OK-M1B/OK-MAN-M1B                             | Suite completa e fixture A1=10, A2=20, B1=40, legacy null, precisione, prenotazioni, scadenze e lotti attivi superate; dry run manuale Floriano superato.                                                                                                               |
| GEO-02  | M1B               | OK-M1B/OK-MAN-M1B                             | Intersezione Area/Centro/comune e tentativi 400/403/404 verificati lato backend; dry run manuale Floriano superato.                                                                                                                                                     |
| GEO-03  | M1B               | OK-M1B/OK-MAN-M1B                             | Selettore Area→Magazzino, reset, query key e protezione dalla risposta tardiva verificati; dry run manuale Floriano superato.                                                                                                                                           |
| GEO-04  | M1B               | OK-M1B/OK-MAN-M1B/APP-M0                      | Soglie Area assenti, sottoscorta solo Magazzino e parità tabella/export verificate; dry run manuale Floriano superato.                                                                                                                                                  |
| AUD-01  | M1C               | OK-M1C/OK-MAN-M1C                             | Test automatici e dry run Floriano confermano audit append-only/transazionale, sequenza A crea/B conferma/C consegna, attori/snapshot distinti e movimento finale attribuito a C.                                                                                       |
| AUD-02  | M1C               | OK-M1C/OK-MAN-M1C                             | Attore di sessione, spoof e rollback atomico verificati automaticamente; il dry run multiutente ha confermato l'attribuzione operativa senza campi autore client.                                                                                                       |
| AUD-03  | M1C               | OK-M1C/OK-MAN-M1C                             | Snapshot, FK `SET NULL` e trigger append-only verificati automaticamente; la prova manuale ha confermato la visualizzazione esclusiva del codice/matricola.                                                                                                             |
| AUD-04  | M1C/M2            | OK-M1C/OK-MAN-M1C                             | Copia popolata invariata, 35 autori null conservati, nessun backfill e fallback API/UI snapshot→matricola/username→testo legacy verificati anche nel dry run Floriano.                                                                                                  |
| CAT-01  | M1B/M2            | OK-M1B/OK-MAN-M1B                             | Suite, ispezione e dry run manuale Floriano confermano Catalogo `/prodotti` globale, senza proprietà/filtro Area.                                                                                                                                                       |
| CAT-02  | M2/M3B            | OK-M2/OK-MAN-M2                               | CRUD e bulk globali, permessi, default e audit sono coperti automaticamente; il dry run Floriano ha validato il Catalogo come anagrafica e le proprietà M2.                                                                                                             |
| QTY-01  | M2                | OK-M2/OK-MAN-M2                               | Proprietà esplicita, default/override e precisione fixed-point sono coperti automaticamente; il dry run Floriano ha validato quantità intere e frazionabili senza arrotondamenti.                                                                                       |
| LOT-01  | M2                | OK-M2/OK-MAN-M2                               | Entità multiprodotto per Area, `Generale`, lifecycle, scope e collegamento fisico sono coperti automaticamente e validati nel dry run Floriano.                                                                                                                         |
| LOT-02  | M2/M4B            | PB-M2/NE-MAN                                  | M2 collega i nuovi dettagli senza fondere il legacy; same-Area preserva il lotto logico, cross-Area usa il `Generale` ricevente. Prenotazioni e visualizzazione completa restano M4B.                                                                                   |
| LOT-03  | M2/M4B            | PB-M2/NE-MAN                                  | M2 distingue `maiCaricato`, usa un esaurito prudente e riceve merce già partita anche se il lotto viene chiuso in transito; rientro e completamento restano M4B.                                                                                                        |
| LOAD-01 | M3A               | OK-M3A/OK-MAN-M3A/NE-MAN-CAMERA/NE-MAN-TABLET | Test DB/API, E2E e dry run reale Floriano confermano pratica persistente, bozza senza effetti stock, ripresa dopo interruzione e chiarezza fra righe pendenti e registrate; fotocamera reale e tablet fisico restano non eseguiti e non bloccanti.                      |
| LOAD-02 | M3A               | OK-M3A/OK-MAN-M3A/NE-MAN-CAMERA/NE-MAN-TABLET | Integrazioni immutabili, vincolo DB anti-doppio carico, 80+20=100, stale draft/lotto, concorrenza, lifecycle, Giacenze, Movimenti, audit e rettifica sono confermati anche dal dry run Floriano; fotocamera reale e tablet fisico restano non eseguiti e non bloccanti. |
| IMP-01  | M3B               | OK-M3B/OK-MAN-M3B/NE-MAN-CAMERA/NE-MAN-TABLET | T01–T24 e hardening H1–H4 sono coperti automaticamente; il dry run Floriano ha validato il workflow M3B. Fotocamera reale e tablet fisico restano non eseguiti e non bloccanti.                                                                                         |
| IMP-02  | M3B               | OK-M3B/OK-MAN-M3B/NE-MAN-CAMERA/NE-MAN-TABLET | Staging/revisioni, import parziale, mapping/creazione prodotti, barcode, anomalie, documenti per riga, conflitti e UI sono coperti automaticamente; il dry run Floriano ha validato il workflow M3B. Hardware fisico non eseguito.                                      |
| IMP-01A | M3B               | OK-M3B/OK-MAN-M3B                             | T25–T32 sono coperti automaticamente sui due originali; la validazione manuale Floriano ha approvato il workflow M3B, incluso il saldo iniziale e la copertura storica, senza sostituire le evidenze automatiche di dettaglio.                                          |
| IMP-01B | M3B               | OK-M3B/OK-MAN-M3B                             | T17/T27/T28/T33 sono coperti automaticamente; la validazione manuale Floriano ha approvato il workflow M3B e M3B è chiuso, senza attribuire al dry run evidenze automatiche non dichiarate.                                                                             |
| REQ-01  | M5A               | NI/APP-M0                                     | Approvata richiesta autonoma con sole note, al massimo un documento e una pianificazione attivi, mantenendo gli annullati. Implementazione/test restano M5A.                                                                                                            |
| PREP-01 | M5B               | PB/NE                                         | Prenotazione bolla usa transazione e lock lotti; testare due richieste concorrenti sull'ultima unità.                                                                                                                                                                   |
| PREP-02 | M5B               | NI                                            | Il riepilogo corrente aggrega tutto il richiesto e disponibilità meno prenotato; dimostrare che la stessa pratica non genera doppia sottrazione/carenza.                                                                                                                |
| DEL-01  | M4B/M5B           | PB/NE                                         | Bolla e consegna hanno sync bidirezionale; serve servizio comune con operation key e test da due sessioni/menu.                                                                                                                                                         |
| CAN-01  | M4B/M5B           | PB/NE                                         | M1C offre `audit_eventi.motivo` e Rettifica motivata, ma la Bolla ammette ancora annullamento senza motivo testuale. Obbligatorietà e UX restano da chiudere in M4B.                                                                                                    |
| CAN-02  | M4B/M5B           | PB/NE/APP-M0                                  | Approvati `in_trasporto` e `rientro_atteso`, senza parziali; per consegna finale mancano ancora implementazione e test del non reintegro automatico.                                                                                                                    |
| DDT-01  | M4A               | OK-M4A/OK-MAN-M4A                             | CR-M4A-01/02 chiusi, T01–T32 e G1–G8 GO automatici; API 1315, frontend 411, E2E 67 pass, fresh/upgrade 39→40 verdi. Floriano ha comunicato PASS manuale dell'ambiente M4A installato; NO-GO storico conservato.                                                         |
| DDT-01A | M4A               | OK-M4A/OK-MAN-M4A                             | Tre destinatari, `CONSEGNA_ENTE`, idempotenza, snapshot Ente, PDF A4 FEFO/multipagina verificati automaticamente; validazione funzionale manuale M4A approvata da Floriano, senza attribuire prove puntuali non documentate.                                            |
| DDT-01B | M4A               | OK-M4A/OK-MAN-M4A                             | Facciata e permessi per ramo, lista/export, draft/replay e Trasferimenti same/cross Area verificati automaticamente; validazione funzionale manuale M4A approvata da Floriano.                                                                                          |
| DDT-01C | M4A               | OK-M4A/OK-MAN-M4A                             | CR-M4A-01 e T09/T10 ricertificati: lotto fisico esplicito senza fallback, rifiuto atomico e concorrenza; FEFO senza scelta verificato automaticamente. Floriano ha approvato M4A manualmente.                                                                           |
| DDT-01D | M4A               | OK-M4A/OK-MAN-M4A                             | CR-M4A-02 ricertificato: scope Ente UDS Area/Zona e Beneficiario segregato verificati automaticamente in lista/dettaglio/export. Floriano ha approvato M4A manualmente.                                                                                                 |
| MOV-01  | M4B               | PB/NE                                         | Nature contabili e collegamento al movimento origine esistono; testare segni, autore e documento per entrata/storno.                                                                                                                                                    |
| DB-01   | M2+               | OK-M2                                         | Migrazione 36 provata su copia popolata: conteggi e quantità invariati, 21/21 dettagli legacy ancora null, 6 `Generale`, due anomalie legacy classificate e replay idempotente.                                                                                         |
| DB-02   | M0/M2+            | OK-TEST-M0/OK-M1C/OK-M2/OK-M3B                | Fresh/replay M3B da zero con 39 migrazioni e checksum/ordine verdi; upgrade populated 38→39 applica solo gli alias identità e conserva hash di ledger, movimenti, legacy e audit. Le prime 38 migrazioni restano byte-identiche.                                        |
| RUN-01  | M0/M6             | OK-TEST-M0                                    | Immagini web/API ricostruite senza cache dalla stessa SHA `787d7c5`, digest registrati; health, Nginx, runtime config e login browser verificati. Ripetere in M6.                                                                                                       |
| REG-01  | ogni milestone/M6 | OK-TEST-M0/OK-M1C/OK-M2/OK-M3B                | M3B post-review: suite API/frontend complete, H1–H4, E2E desktop e viewport tablet, originali, populated/fresh 39, runner, typecheck, build, bundle/runtime e hygiene verdi; OpenAPI/generated invariati, hardware fisico pendente.                                     |

### M4B.1 — test automatici GO; review e validazione manuale pendenti

| ID         | Stato                | Evidenza funzionale                                                                                                                                                                       |
| ---------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PREP-TR-01 | OK-TEST-M4B.1/NE-MAN | Richiesto senza prenotazione o movimento, campi conservati; API/UI e DB isolato.                                                                                                          |
| PREP-TR-02 | OK-TEST-M4B.1/NE-MAN | Pronto atomico completo; rollback di riga insufficiente, righe ripetute e quantità fixed-point.                                                                                           |
| PREP-TR-03 | OK-TEST-M4B.1/NE-MAN | FEFO multi-partita, ripartizioni, disponibilità comune e lineage.                                                                                                                         |
| PREP-TR-04 | OK-TEST-M4B.1/NE-MAN | Lotto esplicito vincolante senza fallback; prodotto/deposito/scadenza/requisito fisico.                                                                                                   |
| PREP-TR-05 | OK-TEST-M4B.1/NE-MAN | Bolla vs Trasferimento su ultima unità, barriera PostgreSQL, più prodotti con ordini inversi; nessuna sovraprenotazione.                                                                  |
| PREP-TR-06 | OK-TEST-M4B.1/NE-MAN | Doppio Pronto/replay/mismatch/stale; un solo effetto, audit e ricevuta coerenti.                                                                                                          |
| PREP-TR-07 | OK-TEST-M4B.1/NE-MAN | Partenza solo da Pronto, proprie riserve esatte; nuovo FEFO non le sostituisce, 6+4 condivisi e retry unici.                                                                              |
| PREP-TR-08 | OK-TEST-M4B.1/NE-MAN | Annullamento motivato pre-uscita, no reintegro; righe immutabili e gara Annulla/Avvia.                                                                                                    |
| PREP-TR-09 | OK-TEST-M4B.1/NE-MAN | Versione/hash/replay, revoca prima o durante lock, attore backend e rollback audit obbligatorio.                                                                                          |
| PREP-TR-10 | OK-TEST-M4B.1/NE-MAN | Permessi distinti e nessun grant Mensa implicito; due sessioni reali Magazzino/Mensa E2E, ricezione storico/same/cross Area.                                                              |
| REG-M4A    | OK-TEST-M4B.1/NE-MAN | Rerun API finale completo: 117 file, 1336 pass/0 fail/2 skip AGEA opzionali; Scarico 2.0A con lock osservato, cleanup e PACCHI 201. Frontend/E2E mantenuti con verifica di applicabilità. |

`OK-TEST-M4B.1` indica i gate automatici G1–G8 superati nel rerun finale,
non la validazione manuale. I precedenti NO-GO/G6 e NO-GO/G3-G4 restano
registrati cronologicamente in `ESITI_TEST_M4B1.md`. Code review ChatGPT
e validazione manuale M4B.1 restano da svolgere. I test con hardware fisico
`NE-MAN-CAMERA` e `NE-MAN-TABLET` restano non eseguiti e non bloccano il
gate automatico. M4B complessiva non è chiusa; M4B.2 non è iniziata.

## Copertura minima per fase

Le righe DDT-01/01A/01B conservano anche l'evidenza storica del candidato
`187659257...`; la review successiva aveva riaperto M4A. Il rerun formale
post-hardening ha ricertificato T09/T10 e T01–T32 sul candidato corretto con
G1–G8 GO automatici; DDT-01C/01D passano da prove mirate di sviluppo a
`OK-M4A/NE-MAN` al momento del rerun. La successiva validazione umana di
Floriano porta le cinque righe DDT a `OK-M4A/OK-MAN-M4A` e chiude M4A.
T27 include sette PDF reali A4, con FEFO e tre pagine per 60 righe;
T28 resta `NE-MAN-TABLET/NE-MAN-CAMERA` per hardware fisico; T30 include
suite API/frontend/E2E complete e i due XLSX originali M3B. La matrice
T01–T32 dettagliata è in `ESITI_TEST_M4A.md`.

| Fase | ID primari                                      | Evidenza richiesta prima di proseguire                                                                                                    |
| ---- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| M0   | DB-02, preparazione DB-01/RUN-01/REG-01         | completati baseline, backup+restore, fresh gate, suite/build e validazione umana; nessun requisito futuro risulta implementato per questo |
| M1A  | UX-01..04                                       | unit/component test, tastiera/touch e checklist manuale                                                                                   |
| M1B  | GEO-01..04, CAT-01                              | API+UI con due Aree, scope ristretto, cache, indicatori ed export                                                                         |
| M1C  | AUD-01..04                                      | audit transazionale, spoof, account disattivato e legacy null                                                                             |
| M2   | CAT-01..02, QTY-01, LOT-01..03, DB-01           | migrazione copia, anomalie legacy, riconciliazione quantità/fondi/unità                                                                   |
| M3A  | LOAD-01..02                                     | bozza cross-sessione, integrazione e concorrenza/retry                                                                                    |
| M3B  | IMP-01..02                                      | file rappresentativi XLSX/XLS/CSV, staging e antiduplicazione                                                                             |
| M4A  | DDT-01                                          | destinatari e classificazioni senza record fittizi                                                                                        |
| M4B  | LOT-02..03, PREP-01, DEL-01, CAN-01..02, MOV-01 | prenotazioni, scarico unico, trasferimento/rientro e segni                                                                                |
| M5A  | REQ-01                                          | richiesta con sole note, link stabile e ingressi deduplicati                                                                              |
| M5B  | PREP-01..02, DEL-01, CAN-01..02                 | coda, assegnazioni, pronto ed esiti sincronizzati                                                                                         |
| M6   | tutti, RUN-01, REG-01                           | regressione integrata, Docker, tablet, copia migrata e fresh finale                                                                       |

## Regole di aggiornamento

- Non usare “superato” senza comando/prova e revisione registrati.
- `test automatici superati` e `validato da Floriano` sono stati diversi.
- Un test obbligatorio non eseguibile resta `NE`/bloccato.
- Ogni regressione viene distinta da un difetto già presente in questa baseline.
- Le righe subordinate possono essere aggiunte, ma gli ID originari non vengono rinominati o rimossi.

## M4B.2 — sviluppo, prove mirate e validazione ancora pendente

La decisione sul rientro è approvata, ma nessuna riga qui sotto è una
validazione formale `##test M4` o manuale. `DEV-M4B.2/NE-TEST/NE-MAN`
indica implementazione candidata nel working tree con prove di sviluppo.

| ID                          | Stato                    | Prova di sviluppo presente; prova formale pendente                                                                                                  |
| --------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| BOLLA-DIRECT-REG, AFF-01…04 | DEV-M4B.2/NE-TEST/NE-MAN | Scarico diretto invariato; affidamento una volta, impegni convertiti, incaricato distinto dall'attore.                                              |
| DEL-01…04                   | DEV-M4B.2/NE-TEST/NE-MAN | Esito fisico zero dopo affidamento, Beneficiario/Ente distinti, replay unico.                                                                       |
| FAIL-01…02                  | DEV-M4B.2/NE-TEST/NE-MAN | Mancata consegna motivata, stato rientro atteso senza reintegro.                                                                                    |
| RET-01…10                   | DEV-M4B.2/NE-TEST/NE-MAN | Idonea, deteriorata, scaduta, mancante e rubata; 18/1/1 → 98, over/under-return e doppio comando respinti, stato terminale. Nessuna classe `altro`. |
| TR-RET-01…05, TR-REG-M4B1   | DEV-M4B.2/NE-TEST/NE-MAN | Rientro all'origine, nessuna entrata al destino, partita FEFO multipla, regressione del percorso ricevuto preservata.                               |
| DB-RET-01, CONC-AFF/RET-01  | DEV-M4B.2/NE-TEST/NE-MAN | FK composta su uscita/documento e serializzazione osservata con lock PostgreSQL.                                                                    |
| REP-M4B2                    | DEV-M4B.2/NE-TEST/NE-MAN | Proiezione fisica del ledger separata dal fatto contabile di distribuzione; test 100→80 e 100→98; riesame completo richiesto in `##test M4`.        |

Migrazione 42 fresh e runner, codegen, typecheck e suite di sviluppo sono
registrati in `ESITI_SVILUPPO_M4B2.md`. Restano `NE-MAN-CAMERA` e
`NE-MAN-TABLET`; non sono dichiarati superati.

## M4 — test formale integrato M4A + M4B.1 + M4B.2

`OK-TEST-M4/NE-MAN` indica che i gate automatici G1–G10 della milestone
integrata sono stati valutati sul candidato finale; **non** aggiunge una
validazione umana a M4B.1, M4B.2 o M4 complessiva. M4A conserva invece la
propria precedente validazione manuale `OK-MAN-M4A`. Le righe storiche di
sviluppo sopra restano come cronologia e non come stato corrente.

| Gruppo                        | Stato automatico M4   | Evidenza formale                                                                                                                           |
| ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| M4-DIRECT-01, REG-M4A         | OK-TEST-M4/NE-MAN-M4B | Consegna diretta con un solo scarico, Beneficiario/Ente e fatto finale corretti; regressioni M4A/API/E2E verdi.                            |
| PREP-TR-01…10                 | OK-TEST-M4/NE-MAN     | Richiesto, Pronto, FEFO, prenotazioni comuni, partenza, ricezione, scope e concorrenza preservati.                                         |
| M4-AFF-01…04, M4-DEL-01…03    | OK-TEST-M4/NE-MAN     | Uscita all'affidamento, autore/incaricato distinti, consegna Beneficiario/Ente come esito neutro, replay unico.                            |
| M4-FAIL-01, M4-RET-01…11      | OK-TEST-M4/NE-MAN     | Mancata consegna senza reintegro; cinque classi esclusive, stock/lineage, documenti automatici/anomalie e terminalità.                     |
| M4-TR-01…06, M4-TR-RET-01…06  | OK-TEST-M4/NE-MAN     | Ricezione normale e same/cross Area; rientro all'origine senza carico a destino.                                                           |
| STORNO-01…05, CONC-M4         | OK-TEST-M4/NE-MAN     | Effetto fisico dello storno, lock osservabili, idempotenza, stale, revoca, audit e ricevuta.                                               |
| REPORT-M4-A…D, REPORT-M4-B-KG | OK-TEST-M4/NE-MAN     | 100→80 diretto/trasportato, 100→98 misto, Ente senza sociale, kg FSE+ e as-of corretti.                                                    |
| DB-M4-42, REG-M4              | OK-TEST-M4/NE-MAN     | Fresh 42/42, upgrade popolato 41→42, parità, runner 24/24, API 1373/2 skip AGEA, frontend 415, E2E 24 prove uniche, build/runtime/codegen. |

Le failure intermedie e la composizione E2E multi-spec non verde sono
riportate in `ESITI_TEST_M4.md`, con le prove successivamente verdi. Gli
skip AGEA preesistenti sono opzionali e non coprono M4. `NE-MAN-CAMERA` e
`NE-MAN-TABLET` restano prove hardware fisiche non eseguite e non
equivalgono agli E2E su viewport simulato.
