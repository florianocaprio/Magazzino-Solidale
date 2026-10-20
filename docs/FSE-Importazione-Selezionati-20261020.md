# FSE+ — importazione dei soli Beneficiari selezionati

Richiesta UAT del 20 ottobre 2026. Aggiunto **Importa solo selezionati**, con schermata di conferma prima dell’invio. **Importazione completa** sostituisce “Conferma importazione” e conserva i blocchi precedenti per decisioni su duplicati/aggiornamenti e conflitti non gestiti.

## Comportamento

- Sono selezionate per l’importazione parziale soltanto le righe valide con una scelta esplicita Crea nuovo, Collega e aggiorna anagrafica o Aggiorna anagrafica. Il pulsante è disabilitato senza almeno una scelta di importazione; Salta questa riga non è una selezione da importare.
- Anche le nuove anagrafiche hanno una scheda compatta con Crea nuovo/Salta. L’importazione completa continua a includere automaticamente le nuove anagrafiche non saltate, come prima; la descrizione chiarisce la differenza con la selezione parziale.
- Al primo clic si vedono **anagrafiche da importare**, **righe che restano da gestire** e **righe già allineate**, queste ultime escluse dal residuo. Nessuna scrittura prima della conferma; Torna alla selezione conserva le scelte.
- Nell’invio parziale ogni riga non selezionata riceve esplicitamente la risoluzione esistente `salta`: incluse nuove righe, possibili duplicati, aggiornamenti, conflitti, errori e record già allineati. Questo evita che l’importatore applichi le sue elaborazioni automatiche alle righe non scelte. Restano autorizzazioni, perimetro e versioni attese delle scelte esplicite.
- Dopo l’importazione, il riepilogo conta gli esiti effettivamente riusciti; errori/conflitti delle righe selezionate restano nel residuo. La selezione non viene contata come importazione riuscita. Le vecchie schede non rimangono modificabili sul risultato.
- Ricaricando lo stesso file si possono gestire le righe restanti: quelle già allineate non producono schede da decidere. Il salto non è un’esclusione permanente. I conteggi del residuo comprendono anche le righe saltate esplicitamente o non valide e da correggere; le righe già allineate sono indicate separatamente.
- Riepilogo e testi disponibili nelle sei lingue esistenti. Nessun cambio a DB, schema, API/OpenAPI, client generati, dipendenze o lockfile. Riutilizzate le risoluzioni e l’audit `righeSaltate` già presenti; non esiste una nuova migrazione.

## Validazione

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS.
- Interfaccia: **796 PASS**, 124 file. Nuove prove su scelte esplicite, esclusione di tutti i non selezionati, conteggi distinti, ritorno senza invio, conservazione delle scelte, errore di rete e conteggio da esiti effettivi.
- Browser: **25 PASS**, cinque viewport. Importazione selettiva dopo conferma, nessuna anagrafica prima dell’invio, risultato parziale, ricaricamento dello stesso file, completamento delle righe rimanenti e versioni dell’anagrafica precedente invariate. Screenshot del riepilogo mobile ispezionato, overflow entro 1 px. Conservate le verifiche Massivo XLSM e importazione completa.
- API: **1.559 PASS / 2 SKIP**, 143 file, runner ufficiale `node scripts/quality-gates-run.mjs api general` su PostgreSQL temporaneo. I 19 casi Beneficiari FSE+ comprendono selezione di aggiornamento/creazione, esclusione della riga non scelta, nuova anteprima e import delle restanti senza modificare anagrafiche, profili o snapshot già allineati. Quattro file reali FSE+ inclusi nei controlli pertinenti. I due SKIP riguardano i campioni legacy AGEA non forniti.
- Tutte le prove su database temporanei del runner ufficiale, rimossi al termine. Nessuna prova d’importazione sul database personale della 8082.

Evidenze private: `/private/tmp/fse-selected-browser`, `/private/tmp/fse-selected-api`, `/private/tmp/fse-selected-ui-focused.log` (l’esecuzione ha coperto l’intera suite UI), `/private/tmp/fse-selected-typecheck-final.log`.

## Ricevuta della 8082

Codice realmente installato **`ce6d9a80207215a56884589bfc39c113b3951609`**, compilato da archivio Git. API e WEB ricreati; PostgreSQL conserva container, istante di avvio e volumi.

- /magazzino-api: `magazzino-bugfix-uat-api:sha-ce6d9a802072`, image ID `sha256:e63229be0fccc5fac56b26a2cd1a166945793b15aff5cb560b00ea92e02424e0`.

- /magazzino-web: `magazzino-bugfix-uat-web:sha-ce6d9a802072`, image ID `sha256:7913b1c877d04b68ce76ccc0e97b809a1860410641130485bf6a28a4abdd2280`.

- Backup privato DB/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-SELECTED-ce6d9a802072-2026-10-20T12-24-49-766Z`; ripristino effettivo provato su PostgreSQL temporaneo isolato, migrazioni ripetute 62 → 62. Override di rilascio e rollback conservati nel backup.

- **43 tabelle controllate: hash di tutte le colonne invariati** dopo l’installazione. Ledger **62/62**, zero pending/checksum difformi/file mancanti o fuori ordine.

- HTTP root/config/health/ready 200, Utenti anonimo 401. Entry servita `/assets/index-jbqbuqGj.js`; asset JS/CSS confrontati per SHA-256 con l’immagine. Verificata la presenza di importazione selettiva, completa e conteggi; conservati colori delle differenze/proposte e limite effettivo Nginx `client_max_body_size 10m;`.

- Build e budget PASS: Initial entry index-jbqbuqGj.js: 1392.5 KiB, 386.9 KiB gzip.

## File modificati

- `artifacts/magazzino-solidale/src/components/fse-beneficiari-actions.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco07.ts`
- `artifacts/magazzino-solidale/src/components/beneficiari-fse-ui.test.tsx`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `docs/FSE-Importazione-Selezionati-20261020.md`
- `docs/campagna-bug-2026-10.md`

Per la prova manuale: ricaricare la 8082, analizzare il file, scegliere solo alcune righe con Crea nuovo/Collega/Aggiorna e premere Importa solo selezionati. Controllare i tre conteggi e confermare. Dopo la chiusura, ricaricare lo stesso file per verificare le differenze restanti. Importazione completa conserva i controlli precedenti. UAT da confermare con Floriano; nessun prompt successivo avviato.
