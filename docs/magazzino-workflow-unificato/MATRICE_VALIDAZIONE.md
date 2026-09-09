# M0 — Matrice di validazione

Stato della matrice alla baseline `787d7c5`. “Presidio baseline” indica un componente esistente da riusare; non significa che il requisito futuro sia soddisfatto. Gli esiti possono avanzare solo con evidenza eseguita nella relativa fase `##test` e, separatamente, con validazione umana.

Legenda: `NI` non implementato; `PV` proposta da validare; `PB` presidio parziale di baseline; `NE` prova non eseguita; `OK-M0` evidenza ambientale eseguita in sviluppo M0; `OK-TEST-M0` prova automatica ripetuta nella fase `##test M0`.

| ID      | Milestone         | Stato            | Evidenza baseline / prova richiesta                                                                                                                                       |
| ------- | ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UX-01   | M1A               | PB/NE            | I componenti `Tabs`, `Switch` e `Button` esistono, ma non è stata verificata sistematicamente la distinzione accessibile selezione/azione senza hover/colore.             |
| UX-02   | M1A               | PB/NE            | Diverse mutation disabilitano il submit e mostrano spinner/toast; manca contratto comune ed E2E pending/esito/errore.                                                     |
| UX-03   | M1A               | NI               | `pages/prodotti.tsx` usa icona `Barcode` per l'export; serve icona download e dicitura non ambigua, con prova PDF.                                                        |
| UX-04   | M1A               | NI               | `pages/login.tsx` ha solo `type=password`; testare toggle non-submit, valore invariato e tastiera.                                                                        |
| GEO-01  | M1B               | NI               | `/giacenze` aggrega prodotto+magazzino e non riceve Area scelta. Eseguire fixture A1=10, A2=20, B1=40.                                                                    |
| GEO-02  | M1B               | PB/NE            | `visibleMagazzinoIds` interseca scope utente, ma l'aggregato Area e la dicitura UI non esistono. Testare utente limitato ad A1.                                           |
| GEO-03  | M1B               | NI               | Giacenze non ha selettore Area; Preparazione resetta il deposito ma ammette “tutte le aree”. Testare cache/query pendenti.                                                |
| GEO-04  | M1B               | NI/PV            | Export Giacenze usa le righe caricate, ma serve lo stesso ambito Area e va validata la semantica scorta minima aggregata.                                                 |
| AUD-01  | M1C               | NI               | `operatoreId` su testate rappresenta spesso l'ultimo autore; manca sequenza immutabile A crea/B modifica/C consegna.                                                      |
| AUD-02  | M1C               | PB/NE            | Molti endpoint usano `req.user.id`; `interventi` ammette anche operatore assegnato. Distinguere incaricato e attore, testando spoof del payload.                          |
| AUD-03  | M1C               | NI               | I FK attuali possono diventare null; serve snapshot codice/matricola e test account disattivato.                                                                          |
| AUD-04  | M1C/M2            | PB/NE            | Nel dataset M0 35/37 movimenti hanno autore nullo. UI e migrazione devono mostrare “Non disponibile — dato precedente”.                                                   |
| CAT-01  | M1B/M2            | PB/NE            | `/prodotti` è globale; testare che cambio Area alteri solo quantità/dettagli territoriali.                                                                                |
| CAT-02  | M2/M3B            | PB/NE            | CRUD/bulk prodotto richiede `magazzino.products.manage`; verificare che barcode, mapping e import non aggirino il permesso.                                               |
| QTY-01  | M2                | NI/PV            | Esistono dimensioni e fattori coerenti, ma non un unico input con intero obbligatorio per unità indivisibili. Test 12 pz→6 kg e rifiuto frazione.                         |
| LOT-01  | M2                | NI/PV            | `lotti` è fisico e monoproduct; proposta `lotto_logico` superiore. Test stessa raccolta, più prodotti e due scadenze.                                                     |
| LOT-02  | M2/M4B            | PB/NE            | Bolla sottrae prenotazioni attive dal residuo e usa lock; verificare non riassegnabilità e visualizzazione prenotato.                                                     |
| LOT-03  | M2/M4B            | NI               | Non esiste stato esaurito globale/logico; testare residuo in altro deposito e merce in transito.                                                                          |
| LOAD-01 | M3A               | NI               | Carichi hanno solo `confermato`/`stornato`; testare bozza server, altra sessione e zero effetti stock.                                                                    |
| LOAD-02 | M3A               | NI/PV            | Idempotenza del singolo carico esiste, non l'integrazione successiva. Test 80+20=100 ed eventi/autori distinti.                                                           |
| IMP-01  | M3B               | PB/NE            | Conferma AGEA ha replay/idempotenza; estendere a fingerprint XLSX/XLS/CSV e test ricarica senza raddoppio.                                                                |
| IMP-02  | M3B               | PB/NE            | Staging/mapping/correzioni esistono; verificare permesso catalogo e conservazione pratica su descrizione sconosciuta.                                                     |
| REQ-01  | M5A               | NI/PV            | Coda bolle richiede righe e materiali intervento richiedono descrizione/unità. Proposta richiesta autonoma senza prodotti.                                                |
| PREP-01 | M5B               | PB/NE            | Prenotazione bolla usa transazione e lock lotti; testare due richieste concorrenti sull'ultima unità.                                                                     |
| PREP-02 | M5B               | NI               | Il riepilogo corrente aggrega tutto il richiesto e disponibilità meno prenotato; dimostrare che la stessa pratica non genera doppia sottrazione/carenza.                  |
| DEL-01  | M4B/M5B           | PB/NE            | Bolla e consegna hanno sync bidirezionale; serve servizio comune con operation key e test da due sessioni/menu.                                                           |
| CAN-01  | M4B/M5B           | PB/NE            | Annulla bolla rilascia prenotazioni; richiesta/ragione/storia comune non esistono. Test motivo e collegamenti.                                                            |
| CAN-02  | M4B/M5B           | PB/NE            | Trasferimento distingue transito; per consegna finale manca stato affidato/rientro atteso. Test nessun reintegro automatico.                                              |
| DDT-01  | M4A               | NI/PV            | Bolla richiede beneficiario, trasferimento e scarico sono record autonomi. Proposta documento/adattatore tipizzato; test ente e magazzino reali.                          |
| MOV-01  | M4B               | PB/NE            | Nature contabili e collegamento al movimento origine esistono; testare segni, autore e documento per entrata/storno.                                                      |
| DB-01   | M2+               | NE               | Il ripristino baseline è verificato, ma nessuna migrazione futura è stata applicata. Riconciliare la copia ad ogni schema nuovo.                                          |
| DB-02   | M0/M2+            | OK-TEST-M0       | Fresh baseline ripetuto da DB vuoto con 33 migrazioni, seed, smoke CRUD, replay e checksum. Ripetere sullo schema di ogni milestone; non certifica il refactoring finale. |
| RUN-01  | M0/M6             | OK-TEST-M0       | Immagini web/API ricostruite senza cache dalla stessa SHA `787d7c5`, digest registrati; health, Nginx, runtime config e login browser verificati. Ripetere in M6.         |
| REG-01  | ogni milestone/M6 | OK-TEST-M0/NE-M6 | Suite baseline complete, typecheck, build, budget e runtime config verdi in M0. Le regressioni vanno ripetute per ogni modifica e integralmente in M6.                    |

## Copertura minima per fase

| Fase | ID primari                                      | Evidenza richiesta prima di proseguire                                                                             |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| M0   | DB-02, preparazione DB-01/RUN-01/REG-01         | baseline identificata, backup+restore, fresh gate, suite/build e coerenza decisionale; approvazione umana separata |
| M1A  | UX-01..04                                       | unit/component test, tastiera/touch e checklist manuale                                                            |
| M1B  | GEO-01..04, CAT-01                              | API+UI con due Aree, scope ristretto, cache, indicatori ed export                                                  |
| M1C  | AUD-01..04                                      | audit transazionale, spoof, account disattivato e legacy null                                                      |
| M2   | CAT-01..02, QTY-01, LOT-01..03, DB-01           | migrazione copia, anomalie legacy, riconciliazione quantità/fondi/unità                                            |
| M3A  | LOAD-01..02                                     | bozza cross-sessione, integrazione e concorrenza/retry                                                             |
| M3B  | IMP-01..02                                      | file rappresentativi XLSX/XLS/CSV, staging e antiduplicazione                                                      |
| M4A  | DDT-01                                          | destinatari e classificazioni senza record fittizi                                                                 |
| M4B  | LOT-02..03, PREP-01, DEL-01, CAN-01..02, MOV-01 | prenotazioni, scarico unico, trasferimento/rientro e segni                                                         |
| M5A  | REQ-01                                          | richiesta con sole note, link stabile e ingressi deduplicati                                                       |
| M5B  | PREP-01..02, DEL-01, CAN-01..02                 | coda, assegnazioni, pronto ed esiti sincronizzati                                                                  |
| M6   | tutti, RUN-01, REG-01                           | regressione integrata, Docker, tablet, copia migrata e fresh finale                                                |

## Regole di aggiornamento

- Non usare “superato” senza comando/prova e revisione registrati.
- `test automatici superati` e `validato da Floriano` sono stati diversi.
- Un test obbligatorio non eseguibile resta `NE`/bloccato.
- Ogni regressione viene distinta da un difetto già presente in questa baseline.
- Le righe subordinate possono essere aggiunte, ma gli ID originari non vengono rinominati o rimossi.
