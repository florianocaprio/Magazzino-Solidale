# M5A — Richiesta Magazzino

Stato: sviluppo nel working tree, non distribuito. Il `##test` è stato eseguito parzialmente su PostgreSQL effimero; build WEB, budget ed E2E restano bloccati dall'ambiente, come documentato in [M5A-test-report.md](M5A-test-report.md). Validazione manuale non eseguita.

## Perimetro

`richiesta_magazzino` è rappresentata dalla tabella `richieste_magazzino`. È un messaggio operativo persistente dal Centro al Magazzino, non una Bolla incompleta né una prenotazione. Una richiesta contiene solo destinatario tipizzato, bisogno e informazioni operative minimizzate. La UX sociale espone il percorso Beneficiario dalla directory, dal dettaglio e dall'Intervento; gli endpoint accettano anche Ente e Magazzino per profili di Magazzino/amministrativi autorizzati. Nessun prodotto, quantità, lotto, magazzino di evasione, consegna o trasportatore è richiesto o scritto. Le richieste autonome allo stesso Beneficiario sono ammesse; per uno stesso Intervento può esistere al massimo una richiesta `inviata`/`presa_in_carico` (indice parziale concorrente).

M5A non crea bozze persistenti e non copia materiali, quantità, note o stato dell'Intervento. `inviata → presa_in_carico`, `inviata → annullata`, `presa_in_carico → annullata` sono le sole transizioni. `chiusa` è riservata a M5B e non ha comandi M5A. Identità, sorgente, Area e Centro restano immutabili. Una modifica Centro è consentita solo prima della presa in carico. La presa in carico conserva anche il codice operatore derivato dalla sessione, per renderlo riconoscibile nella coda, ma non implica disponibilità o impegno di stock.

## Modello e integrità

La migration append-only `20260925_m5a_richieste_magazzino.sql` segue l'ultima migration M4 (`20260924_m4b2_rientri_trasporto.sql`); è preparata e applicata **solo ai database effimeri di test**, non al persistente. Il backend preleva il progressivo da una sequenza PostgreSQL indipendente nella transazione e salva il codice `RM-...`, senza `MAX()+1`; eventuali buchi sono leciti. La sequenza è creata dal ledger, non dal default della tabella Drizzle, così il percorso fresh schema → ledger non la referenzia prematuramente. Lo schema Drizzle riproduce FK restrittive, CHECK di destinatario esclusivo/sorgente/stato/priorità/modalità/contenuto/versione/attori, indice univoco del codice e indice parziale Intervento attivo. Area non può essere nulla. La corrispondenza territoriale tra Beneficiario/Intervento/Area/Centro, non imponibile dai CHECK, è rivalidata nella transazione con lock condivisi sui record sorgente. La richiesta conserva solo codice/nome/numero componenti del destinatario, nomi Area/Centro e ID tecnico della Zona UDS come snapshot; nessun dossier, contatto o campo sanitario viene copiato.

## RBAC e territorio

| Profilo standard    | view             | create | update | take | cancel                         |
| ------------------- | ---------------- | ------ | ------ | ---- | ------------------------------ |
| Sociale             | sì               | sì     | sì     | no   | sì (solo `inviata` del Centro) |
| Magazzino           | sì               | no     | no     | sì   | sì (solo `presa_in_carico`)    |
| Sola lettura custom | sì, se assegnato | no     | no     | no   | no                             |

Le autorizzazioni effettive dipendono anche da Area applicativa `sociale`/`magazzino`, Area operativa e Centro correnti. Per la lettura sociale si applica inoltre la Zona UDS assegnata, se presente, senza considerare condivise le richieste con Zona nulla. Un amministratore territorialmente assegnato non bypassa Area/Centro; un utente con Centro assegnato non vede richieste di altri Centri né richieste operative senza Centro. Il Magazzino legge il DTO della richiesta, non il fascicolo sociale. Il link all'Intervento è oscurato senza `sociale.interventi.view`. La creazione sociale richiede `beneficiari.view` e, per sorgente Intervento, `sociale.interventi.view`; Ente e Magazzino richiedono i rispettivi grant di consultazione operativa. I ruoli standard ricevono i nuovi permessi con seed idempotente; ruoli custom, UDS, Emporio, Mensa e Trasporto non sono promossi. I permessi legacy `bolle.*` sociali restano invariati.

`MAGAZZINO_SOLIDALE` governa il segmento. `CENTRO_ASCOLTO` governa gli ingressi e le scritture sociali; `BOLLE` e `CONSEGNE` non sono prerequisiti della richiesta. Beneficiari con Area/Centro nulli legacy non diventano automaticamente condivisi: la creazione viene bloccata con indicazione di correggere l'anagrafica. Il trasferimento/disattivazione del destinatario non riscrive lo snapshot: blocca modifica/presa in carico, ma l'annullamento nello scope originario resta consentito.

## API, idempotenza e lock

`GET/POST /richieste-magazzino`, `GET/PATCH /richieste-magazzino/:id`, `POST /:id/presa-in-carico`, `POST /:id/annulla`, `GET /:id/storico` sono nel contratto OpenAPI. La lista conta dopo il filtro territoriale, pagina sul server e ordina stabilmente per creazione e ID; la ricerca limitata usa codice e nome snapshot. I comandi richiedono `idempotencyKey`; modifica, presa e annullamento richiedono `versione` numerica intera positiva, senza coercizione. `400` input, `401` sessione, `403` grant/modulo, `404` record inesistente o fuori scope, `409` versione/chiave/unicità/contesto mutato. Gli errori di dominio includono `code` e `correlationId`.

Per ogni comando: advisory lock su `(tipoComando, idempotencyKey)` → attore/ruolo corrente `FOR SHARE` → destinatario `FOR SHARE` (Beneficiario prima dell'Intervento; Area/Centro dopo), quando necessario → richiesta `FOR UPDATE` → scrittura → audit comune → ricevuta `comandi_operativi`, nella stessa transazione. Per replay la ricevuta viene letta dopo il lock, ma permessi/scope correnti sono ricontrollati prima di validare/restituire lo snapshot originale. La ricevuta conserva solo ID, codice, stato e versione dell'esito originale, non bisogno/note. L'audit registra versione/stato/campi modificati e motivo di annullamento, non testo del bisogno o note. La UI ricarica il dettaglio dopo il comando e conserva in memoria i testi dopo `409`.

## Invarianti e verifica successiva

Le sole scritture funzionali M5A sono `richieste_magazzino`, `audit_eventi` e `comandi_operativi`. Nessuna route M5A importa funzioni di stock o muta Bolle, Consegne, Trasferimenti, lotti, prenotazioni, movimenti, Interventi o materiali. La prova `lib/db/scripts/m5a-migration.test.mjs` richiede `M5A_MIGRATION_TEST_ADMIN_URL` esplicito e crea/elimina un DB isolato: verifica ledger, secondo run e vincoli su una baseline minima, senza leggere `DATABASE_URL`. Non sostituisce l'upgrade autentico popolato 42→43. Il `##test` su DB temporaneo ha completato l'upgrade autentico, fresh, parità schema, vincoli, concorrenza, rollback audit/ricevuta e suite API/frontend; build WEB, budget ed E2E restano da completare. Vedere [M5A-test-report.md](M5A-test-report.md) per evidenze e limiti. Non ereditare un `DATABASE_URL` di provenienza ignota. Il Docker persistente rimane invariato.

## Compatibilità e gate M5B

M5A non migra materiali sociali né crea richieste retroattive da Bolle/Consegne. `interventi_materiali`, `bisogni_pianificati`, preparazioni legacy, reporting, FSE+, Emporio, Mensa e UDS restano invariati. M5B dovrà realizzare 0..1 documento operativo attivo e 0..1 pianificazione/consegna attiva per richiesta, conservando i precedenti annullati; Beneficiario/Ente useranno Bolla, Magazzino userà Trasferimento, con prenotazioni solo attraverso M4. L'Intervento origine non è il fatto di distribuzione e l'esito/rientro non equivale automaticamente a bisogno soddisfatto.

**Gate bloccante M5B:** prima di introdurre effetti inventariali M5, definire e testare l'esclusione reciproca tra scarico legacy dei materiali sociali e documento M4 per la stessa erogazione. M5C non può essere usato per sanare duplicazioni già prodotte.
