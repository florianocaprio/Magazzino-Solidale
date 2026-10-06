# M5C2-A — Handoff Bolla pronta e hotfix R2.1

Stato: implementazione nel working tree, in attesa di `##test` formale e validazione manuale. Base: `3a520f3665f7cdb44770f65de4ef6f25f58cf49c`. Nessun deploy, commit o migration.

## Problemi UAT e correzioni

- Lotto opzionale: il placeholder «Automatico» non era selezionabile dopo la scelta di un lotto. Il dialog offre ora una vera opzione `Automatico (FEFO)` e non invia `lottoId` quando è selezionata. Per i prodotti con lotto fisico obbligatorio l'opzione non compare, la UI richiede la scelta e l'API rifiuta l'assenza del lotto. La conferma continua a usare la prenotazione FEFO M4.
- Latte: la Bolla inizializzava `pz` e proponeva un elenco di unità con `lt`, mentre il Catalogo usa `l`. L'unità è ora letta dal prodotto, mostrata in sola lettura e inviata invariata; l'API conserva il controllo di corrispondenza. L'aggiunta della riga visualizza il messaggio d'errore effettivo restituito dal client/backend.
- Bolla pronta invisibile: la pagina Consegne elencava solo pianificazioni già create. La nuova `GET /consegne/da-pianificare` ricava, senza tabella o stato duplicato, le Bolle correnti confermate e non associate di Richieste beneficiario `presa_in_carico` nello scope sociale corrente. La lista Interventi riceve un raccordo batch, non una query per riga.

## Responsabilità e transazioni

Il Magazzino prepara e conferma la Bolla. Il Centro vede la coda «Da pianificare», apre il form logistico Consegne con Beneficiario, Bolla, Richiesta e Magazzino bloccati, quindi sceglie data, fascia, modalità, volontario e mezzo. La data privilegia l'Intervento pianificato, poi quella desiderata nella Richiesta; senza entrambe va scelta dall'operatore. Il volontario della Bolla è solo un suggerimento e viene preselezionato soltanto se operativo alla data.

`POST /consegne/da-bolla/:bollaId` verifica sessione/grant/scope correnti e versione, serializza la pianificazione sulla Richiesta e Bolla, crea la Consegna e associa la Bolla nella stessa transazione. Registra audit e ricevuta idempotente. Due comandi concorrenti non creano due Consegne; il replay non ne crea una seconda. Se una pianificazione viene annullata tramite il flusso Consegne esistente, la Bolla confermata torna nella coda; una vecchia chiave di replay restituisce conflitto e una nuova pianificazione richiede chiave e versione correnti.

La Bolla M5 sociale mostra al Magazzino lo stato della pianificazione, senza chiedergli di associarla. Il dettaglio Bolla espone data, fascia e incaricato minimi anche all'Operatore Magazzino, che normalmente non possiede `consegne.view`; il link al dettaglio Consegna richiede invece quel permesso. I comandi diretti `Affida`, `Segna come consegnata` e la conversione logistica M4 non possono anticipare il percorso del Centro. Le Bolle dirette o legacy non collegate conservano il workflow precedente.

La lista dei documenti espone un indicatore derivato `centroHandoff`: serve esclusivamente a non mostrare l'azione rapida di consegna per la Bolla M5; per i documenti diretti/legacy resta falso. La validazione lato server resta comunque obbligatoria.

`POST /consegne/:id/completa` riusa `completeBollaDelivery()`: prenotazioni, scarico fisico, stato Bolla e Consegna restano sotto il motore M4 e la sua idempotenza. Nella stessa transazione la Richiesta collegata passa a `chiusa`, incrementa versione e produce audit. Quando la Richiesta punta a un Intervento sociale originale, la sincronizzazione legacy non ne crea un secondo; il dettaglio dell'originale mostra l'esito della Consegna e offre l'azione esplicita «Concludi intervento». La conclusione non è automatica.

## Contratti e verifiche

OpenAPI e client generati sono aggiornati per i due endpoint Consegne, il raccordo Interventi, il riepilogo Bolla e l'indicatore della lista documenti. Nessuna migration: Bolla, Richiesta, link e Consegna esistenti contengono già i dati necessari.

Verifiche di sviluppo eseguite: typecheck, suite frontend (460 test), build API, codegen deterministico e `git diff --check`. Il tentativo di build WEB locale non parte perché manca il binario opzionale `lightningcss.darwin-arm64.node`; quindi il budget del nuovo bundle non è verificabile su questa macchina. Il daemon Docker non risponde e non è stato avviato per non coinvolgere lo stack persistente: test API su PostgreSQL effimero, suite API completa, E2E e build Linux restano **non eseguiti**. Queste verifiche e il dry run umano sono obbligatori nel successivo `##test`; i test di regressione scritti non equivalgono a test superati.
