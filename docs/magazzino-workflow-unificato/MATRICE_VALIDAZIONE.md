# M0 — Matrice di validazione

Stato della matrice alla baseline `787d7c5`, aggiornato con la validazione umana della documentazione al commit `2966e1f892b61a03760b6687bbc7bcb0e7b2e78b`. “Presidio baseline” indica un componente esistente da riusare; non significa che il requisito futuro sia soddisfatto. Gli esiti avanzano solo con evidenza eseguita nella relativa fase `##test`, separatamente dall'approvazione del requisito.

Legenda: `NI` non implementato; `PV` proposta ancora da validare; `PB` presidio parziale di baseline; `NE` prova non eseguita; `NE-MAN` prova manuale/fisica non eseguita; `APP-M0` requisito approvato nella validazione umana M0; `OK-M1A` implementazione candidata con test automatici M1A superati; `DEV-M1B` implementazione candidata e controlli di sviluppo M1B eseguiti; `NE-TEST-M1B` fase separata `##test M1B` non ancora eseguita; `OK-M1B` implementazione candidata con test automatici M1B superati; `OK-MAN-M1B` dry run manuale M1B completato con esito positivo da Floriano; `OK-M0` evidenza ambientale eseguita in sviluppo M0; `OK-TEST-M0` prova automatica ripetuta nella fase `##test M0`. `APP-M0` non sostituisce mai `NI`, `PB` o `NE`; gli stati `OK-M1A`, `DEV-M1B` e `OK-M1B` non equivalgono da soli a validazione umana.

| ID      | Milestone         | Stato                    | Evidenza baseline / prova richiesta                                                                                                                                       |
| ------- | ----------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01   | M1A               | OK-M1A/NE-MAN            | Feedback immediato e stati persistenti del `Button` verificati per varianti, focus, disabled, `asChild` e target touch; prova fisica ancora pendente.                     |
| UX-02   | M1A               | OK-M1A/NE-MAN            | Apertura Radix, pending, `aria-busy` ed esclusione del doppio avvio XLSX/PDF verificati; prova visiva e percorso errore manuale restano pendenti.                         |
| UX-03   | M1A               | OK-M1A/NE-MAN            | Download e testo localizzato verificati; il click usa il generatore PDF esistente e non lascia stato persistente. Resta la prova browser del file prodotto.               |
| UX-04   | M1A               | OK-M1A/NE-MAN            | Toggle accessibile verificato per stato, focus, valore, autocomplete, non-submit, invio ed errore login; prova con tastiera/touch fisici ancora pendente.                 |
| GEO-01  | M1B               | OK-M1B/OK-MAN-M1B        | Suite completa e fixture A1=10, A2=20, B1=40, legacy null, precisione, prenotazioni, scadenze e lotti attivi superate; dry run manuale Floriano superato.                 |
| GEO-02  | M1B               | OK-M1B/OK-MAN-M1B        | Intersezione Area/Centro/comune e tentativi 400/403/404 verificati lato backend; dry run manuale Floriano superato.                                                       |
| GEO-03  | M1B               | OK-M1B/OK-MAN-M1B        | Selettore Area→Magazzino, reset, query key e protezione dalla risposta tardiva verificati; dry run manuale Floriano superato.                                             |
| GEO-04  | M1B               | OK-M1B/OK-MAN-M1B/APP-M0 | Soglie Area assenti, sottoscorta solo Magazzino e parità tabella/export verificate; dry run manuale Floriano superato.                                                    |
| AUD-01  | M1C               | NI/APP-M0                | Approvato audit comune append-only/transazionale; manca ancora la sequenza immutabile A crea/B modifica/C consegna.                                                       |
| AUD-02  | M1C               | PB/NE/APP-M0             | Approvato attore esclusivo dalla sessione e separazione dall'incaricato; implementazione completa e test spoof restano M1C.                                               |
| AUD-03  | M1C               | NI/APP-M0                | Approvati snapshot codice/matricola e conservazione storia; implementazione e test account disattivato restano M1C.                                                       |
| AUD-04  | M1C/M2            | PB/NE/APP-M0             | Approvato: i 35/37 movimenti senza autore restano null e la UI mostra “Non disponibile — dato precedente”; implementazione/test pendenti.                                 |
| CAT-01  | M1B/M2            | OK-M1B/OK-MAN-M1B        | Suite, ispezione e dry run manuale Floriano confermano Catalogo `/prodotti` globale, senza proprietà/filtro Area.                                                         |
| CAT-02  | M2/M3B            | PB/NE                    | CRUD/bulk prodotto richiede `magazzino.products.manage`; verificare che barcode, mapping e import non aggirino il permesso.                                               |
| QTY-01  | M2                | NI/APP-M0                | Approvata `quantitaFrazionabile`: `pz`/`cf` false e kg/litri true di default, senza arrotondare il legacy. Implementazione e test restano M2.                             |
| LOT-01  | M2                | NI/APP-M0                | Approvato `lotto_logico` multiprodotto e separato dal dettaglio fisico; codice produttore nullable salvo futuro requisito distinto. Implementazione/test restano M2.      |
| LOT-02  | M2/M4B            | PB/NE                    | Bolla sottrae prenotazioni attive dal residuo e usa lock; verificare non riassegnabilità e visualizzazione prenotato.                                                     |
| LOT-03  | M2/M4B            | NI                       | Non esiste stato esaurito globale/logico; testare residuo in altro deposito e merce in transito.                                                                          |
| LOAD-01 | M3A               | NI/APP-M0                | Approvata pratica persistente; carichi attuali hanno solo `confermato`/`stornato`. Implementare e testare bozza, altra sessione e zero effetti stock.                     |
| LOAD-02 | M3A               | NI/APP-M0                | Approvate contabilizzazioni incrementali immutabili separate dalla pratica. Test 80+20=100, retry ed eventi/autori distinti restano M3A.                                  |
| IMP-01  | M3B               | PB/NE                    | Conferma AGEA ha replay/idempotenza; estendere a fingerprint XLSX/XLS/CSV e test ricarica senza raddoppio.                                                                |
| IMP-02  | M3B               | PB/NE                    | Staging/mapping/correzioni esistono; verificare permesso catalogo e conservazione pratica su descrizione sconosciuta.                                                     |
| REQ-01  | M5A               | NI/APP-M0                | Approvata richiesta autonoma con sole note, al massimo un documento e una pianificazione attivi, mantenendo gli annullati. Implementazione/test restano M5A.              |
| PREP-01 | M5B               | PB/NE                    | Prenotazione bolla usa transazione e lock lotti; testare due richieste concorrenti sull'ultima unità.                                                                     |
| PREP-02 | M5B               | NI                       | Il riepilogo corrente aggrega tutto il richiesto e disponibilità meno prenotato; dimostrare che la stessa pratica non genera doppia sottrazione/carenza.                  |
| DEL-01  | M4B/M5B           | PB/NE                    | Bolla e consegna hanno sync bidirezionale; serve servizio comune con operation key e test da due sessioni/menu.                                                           |
| CAN-01  | M4B/M5B           | PB/NE                    | Annulla bolla rilascia prenotazioni; richiesta/ragione/storia comune non esistono. Test motivo e collegamenti.                                                            |
| CAN-02  | M4B/M5B           | PB/NE/APP-M0             | Approvati `in_trasporto` e `rientro_atteso`, senza parziali; per consegna finale mancano ancora implementazione e test del non reintegro automatico.                      |
| DDT-01  | M4A               | NI/PV/APP-M0             | È approvato il limite di un documento operativo attivo per richiesta; forma esatta del documento/adattatore tipizzato e test ente/magazzino restano da definire in M4A.   |
| MOV-01  | M4B               | PB/NE                    | Nature contabili e collegamento al movimento origine esistono; testare segni, autore e documento per entrata/storno.                                                      |
| DB-01   | M2+               | NE                       | Il ripristino baseline è verificato, ma nessuna migrazione futura è stata applicata. Riconciliare la copia ad ogni schema nuovo.                                          |
| DB-02   | M0/M2+            | OK-TEST-M0               | Fresh baseline ripetuto da DB vuoto con 33 migrazioni, seed, smoke CRUD, replay e checksum. Ripetere sullo schema di ogni milestone; non certifica il refactoring finale. |
| RUN-01  | M0/M6             | OK-TEST-M0               | Immagini web/API ricostruite senza cache dalla stessa SHA `787d7c5`, digest registrati; health, Nginx, runtime config e login browser verificati. Ripetere in M6.         |
| REG-01  | ogni milestone/M6 | OK-TEST-M0/NE-M6         | Suite baseline complete, typecheck, build, budget e runtime config verdi in M0. Le regressioni vanno ripetute per ogni modifica e integralmente in M6.                    |

## Copertura minima per fase

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
