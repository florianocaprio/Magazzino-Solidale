# M5C1 — Centro → Richiesta Magazzino

Stato: sviluppo nel working tree, non committato né distribuito. La validazione formale `##test` e quella manuale non sono state eseguite.

## AS-IS verificato

L'Intervento sociale esponeva nel dettaglio un editor di `interventi_materiali` con prodotto, magazzino, quantità prevista/consegnata e stato di preparazione. La pagina Interventi mostrava anche l'aggregato **Materiale da preparare**; `PATCH /interventi/:id/materiali/:materialeId` marcava `pronto/da_preparare`. `salva-operativita` e `concludi` potevano incrementare la quantità catalogata consegnata e creare uno scarico. La delega permanente M5B impediva già il doppio scarico dopo la creazione documentale, ma prima di tale delega esisteva ancora il percorso legacy. `bisogni_pianificati` è un oggetto sociale separato e non è una riga inventariale M5.

Il dettaglio Intervento aveva già un link a una richiesta contestualizzata, senza però evidenziare codice/stato/documento né precompilare priorità e data civile. La richiesta M5A resta l'unico oggetto di handoff; l'indice parziale impedisce una seconda richiesta aperta per lo stesso Intervento. La pagina Consegne e la pagina Bolle potevano aprire il dialog di nuova Bolla con i vecchi grant sociali. `POST /bolle` accettava `bolle.manage` anche dal solo Sociale. L'unico altro creatore di Bolla operativa censito è `POST /richieste-magazzino/:id/documento` (M5B); la Bolla Emporio è un percorso contabile dedicato, non l'ingresso ordinario del Centro. Scarichi diretti, Mensa e FSE+/AGEA hanno route e autorità proprie.

## Nuovo confine operativo

Il Centro pianifica l'Intervento ed esplicitamente apre **Invia richiesta al Magazzino** se serve materiale. La schermata M5A riceve da `GET /interventi/:id` Beneficiario, priorità e data civile Europe/Rome di `dataOraPianificata`; la modalità iniziale è `da_definire`. L'operatore inserisce il bisogno obbligatorio e può correggere priorità, data, modalità e note. Non si copiano prodotti, quantità, magazzino, lotti, stato di preparazione o dati del dossier non previsti dal DTO. Un Intervento senza richiesta prosegue normalmente. La richiesta autonoma dal Beneficiario resta disponibile.

La sezione nel dettaglio Intervento mostra, se presente, codice, stato, avanzamento e codice del documento operativo minimizzato, con **Apri richiesta**; non offre un secondo invio mentre esiste una richiesta aperta. Il Magazzino prende in carico la richiesta e crea la Bolla attraverso M5B. M4 resta l'unico motore di stock, prenotazioni, FEFO e movimenti.

## Legacy e autorità

L'editor sociale non invia più il campo `materiali`, nemmeno nella conclusione o nell'Intervento successivo. I materiali precedenti sono visibili nel dettaglio come **storico in sola lettura**. Il pulsante/aggregato Materiale da preparare è tolto dalla normale pagina Centro, ma l'endpoint GET storico non è cancellato. Il solo Sociale non può marcare la preparazione né creare/modificare righe catalogate tramite `salva-operativita` o `concludi`; materiali liberi non catalogati e attività/documenti sociali restano nel percorso legacy. Un ruolo misto con Area Magazzino conserva il percorso storico, soggetto alla delega M5B anti-doppio-scarico. UDS è esplicitamente preservata nel proprio ambito. Nessun record viene cancellato o trasformato, nessun backfill e nessun saldo parallelo.

Il ruolo standard canonico `Operatore` conserva `bolle.view` e perde `bolle.manage`, `bolle.deliver`, `bolle.cancel`; non risultano altri grant Bolla di scrittura nel suo set standard. Il seed applica la stessa sottrazione anche a ruoli standard già esistenti. La migration dati append-only **45** (`20260929_m5c1_centro_handoff.sql`) rimuove questi tre grant solo dal ruolo chiamato `Operatore` con `is_admin=false`, senza toccare ruoli custom, Admin, Operatore Magazzino, utenti, Bolle o ledger. La migration non viene applicata al DB persistente in sviluppo.

Le route di mutazione `/bolle` negano il solo Sociale anche se conserva per errore vecchi grant; le GET storiche rimangono leggibili con `bolle.view`. Per `POST /bolle` l'autorità Magazzino/Admin e `bolle.manage` sono ricontrollati sul ruolo corrente dentro la transazione **prima** della ricevuta idempotente e della scrittura. UI Bolle e i due layout Consegne nascondono la creazione diretta al solo Sociale; il dettaglio Bolla resta consultabile ma senza azioni M4 di scrittura. Area Magazzino con grant e Admin autorizzati conservano il comportamento operativo. Associazione/completamento di Consegne esistenti non viene razionalizzato qui.

## Invarianti e rinvii

Rimangono invariati schema M5A/M5B, documenti storici, relazione richiesta-documento, scope Area/Centro R2/R3, revoche, delega permanente, audit, idempotenza e privacy. Nessun endpoint M5A/OpenAPI o tipo generato cambia. `bisogni_pianificati` non alimenta Richiesta o prenotazioni. Chiusura positiva della richiesta, tentativi successivi, rientro e raccordo automatico con Pianificazione Consegne sono rinviati a M5C2.

## Prove di sviluppo

- Typecheck workspace: eseguito, verde.
- Frontend completo: primo run 446 PASS, 1 FAIL su un test statico che cercava il vecchio `hasPermission` letterale nella pagina Bolle. L'assert è stato aggiornato per verificare il nuovo helper con Area Magazzino e grant, insieme al suo test comportamentale; secondo run **84 file, 447 PASS, 0 FAIL**. Coperti prefill data civile, link contestuale, stato/documento minimizzato, storico read-only e helper UI Bolla.
- PostgreSQL effimero fresh con ledger 45/45; prova dati SQL del ruolo canonico/custom e seconda esecuzione `UPDATE 0` verdi. Non è un upgrade popolato autentico 44→45, che resta per il `##test`.
- API mirate su DB effimero: 4 file, 74 test verdi. Comprendono diniego Sociale materiali/nuova Bolla, ruolo misto, regressioni M5B di delega/race e ruolo standard. Il primo run ha evidenziato assenza del flag disposable e il secondo assenza del segreto sintetico di sessione più l'aspettativa storica di scarico da parte del solo Sociale; l'harness M5B ora usa esplicitamente il ruolo misto per quella prova, senza indebolire gli assert di serializzazione.
- Suite API completa single-worker: primo run sul DB effimero con 1.463 PASS, 5 FAIL e 4 skip. Quattro failure erano aspettative storiche di scrittura inventariale/Bolla da attore solo Sociale: le prove legacy sono state conservate per l'attore misto autorizzato e il diniego Sociale è verificato esplicitamente. Il quinto 404 di trasporto su un replay è passato senza modifiche nel run mirato. Secondo run su DB effimero nuovo con ledger 45/45: **128 file, 1.468 PASS, 4 skip preesistenti, 0 FAIL**.
- `pnpm install --frozen-lockfile --offline` tentato, ma pnpm ha rifiutato la rimozione di `node_modules` senza TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); nessun lockfile è stato modificato.
- Build WEB locale tentata, bloccata prima del caricamento della configurazione Vite perché nell'installazione macOS corrente manca il binario nativo `lightningcss.darwin-arm64.node`. Non è una failure del codice M5C1; la build riproducibile in ambiente Linux compatibile rimane da eseguire nel `##test`.

Nessun Docker/database persistente, deploy, staging, commit, push o merge è stato eseguito in M5C1. L'unico container creato, `magazzino-m5c1-test-pg-20260929` (`postgres:16-alpine`, tmpfs, nessun volume), è stato fermato e auto-rimosso con i database sintetici; nessuna risorsa M5C1 resta attiva. Il collaudo formale dovrà includere upgrade popolato 44→45, build Linux, test browser/manuali e verifica quantitativa completa.
