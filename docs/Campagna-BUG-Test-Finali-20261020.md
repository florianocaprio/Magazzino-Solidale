# Campagna BUG — test finali e integrazione

20 ottobre 2026. Registro delle verifiche del candidato. **Stato CI, ricevuta 8082 e integrazione Git: [PR #28](https://github.com/florianocaprio/Magazzino-Solidale/pull/28).** Il merge è subordinato ai gate completi; questo rapporto non sostituisce il loro esito effettivo.

Floriano ha approvato esplicitamente tutti i punti 01–08 e ha richiesto i test finali 09, la ricompilazione personale 8082 e il merge diretto dopo esito positivo. Il mandato attuale copre l’integrazione Git; il rilascio Hetzner del distinto prompt 10 resta fuori da questa esecuzione.

- Branch: `codex/bugfix-uat-ottobre-2026`; base/main remoto `f668b7e0563af9004ef793947b45bc7ede94de1b`.
- Codice usato nell’ultima UAT sulla 8082: `fb2ba4b57c2ab01ea06b0546356cb824b6a8fb80`, ricevuta BUG20 collegata dal registro. HEAD iniziale `8b63c38307b163bf8431ddc5db118faebaf12971`: aggiunge soltanto documentazione.
- Main non avanzato; nessun conflitto rilevato o risolto. Workflow qualità su PR/main, nessun deploy; zero webhook, nessuna protezione classica o ruleset su main. Le protezioni non vengono alterate.
- Inventario: 170 file API, 8 gruppi; 49 suite browser. CI: job statico/Docker, API completo e quattro partizioni browser indipendenti. Localmente API e browser rispettano il lock condiviso.
- Cinque migration append-only della campagna: volontari Area, Enti globali, codici Beneficiari, anagrafica lotti produttore, servizi Beneficiari; tutte già presenti sulla 8082, ledger 63/63. Nessuna nuova migration prevista dai test o dal merge.
- Quattro documenti locali preesistenti non tracciati restano esclusi e preservati per SHA-256. File `.env`, credenziali, originali FSE, screenshot, log e backup non vengono committati.

## Gate

Install frozen e codegen canonico eseguiti; diff dei generated invariato. Risultati completi, eventuali correzioni, SHA/PR/run CI, equivalenza del candidato, ricevuta della nuova 8082 ed esito del merge verranno registrati al termine. Nessun gate futuro è presentato come PASS.

Evidenze locali private con prefisso `/private/tmp/bug09-`; CI pubblica soltanto log/JSON sanificati secondo il workflow, senza screenshot, trace o credenziali sintetiche.

## Evidenze del primo ciclo e adeguamenti dei test

- PR [#28](https://github.com/florianocaprio/Magazzino-Solidale/pull/28), primo run [39454881855](https://github.com/florianocaprio/Magazzino-Solidale/actions/runs/39454881855), candidato `5aadf4ee8fe5f55a91aeecc2427de832ae360eed`.
- Statico CI PASS: codegen senza drift, typecheck, 822 UI, build API/WEB e budget Linux amd64 **389,0/400 KiB**. Docker locale ricompilato: **387,9/400 KiB**, stessa entry `index-BJuG2oJ3.js`.
- API CI completo PASS: **2.098 PASS / 7 SKIP**, 170 file. Esecuzione locale completa dello stesso candidato con quattro originali FSE+: **2.103 PASS / 2 SKIP**; i cinque casi FSE non disponibili in CI sono PASS localmente. I due skip residui sono gli originali AGEA legacy non forniti. Fresh DB/replay PASS; runner PostgreSQL **24 PASS**, guardie del launcher **29 PASS**. Tutti gli ambienti temporanei rimossi, nessun volume creato.
- Browser locale aggiuntivo FSE: **12 PASS / 23 SKIP** di matrice, incluso il caso originale Registro+Giacenze (11 righe, 10 prodotti, 3.244 pezzi, reimport senza duplicazione). La stessa suite in CI senza originali ha 11 PASS/24 SKIP.
- Le partizioni browser del primo ciclo hanno avuto KO; non sono considerate verdi. `m4a-documenti-accessibilita` non selezionava Area/Centro né emetteva la tessera prima della scansione: aggiornato al flusso BUG04 già approvato. `m5c1-r2-formal` attendeva il vecchio testo di diniego anziché quello BUG01 per Area non assegnata: aggiornato il testo esatto, conservando 403, envelope e assenza dei dati protetti. Un token di sole due cifre esadecimali produceva una collisione fra fixture: usa l’intero suffisso, conservando il conteggio esatto di sei Enti.
- Ripetizione integrale locale dei due spec: **3 PASS / 2 SKIP M4A**, **10 PASS R2**, cinque progetti previsti. Nessuna asserzione di sicurezza, stock, persistenza o soglia rimossa. Un errore di percorso API nel primo adeguamento del test è stato corretto prima della ripetizione positiva.
- Modificati soltanto `artifacts/magazzino-solidale/e2e/m4a-documenti-accessibilita.spec.ts`, `artifacts/magazzino-solidale/e2e/m5c1-r2-formal.spec.ts` e documentazione. Nessun cambiamento al codice applicativo collaudato da Floriano, ai contratti, al DB o alle migration.

Evidenze private aggiuntive: `/private/tmp/bug09-api-full`, `/private/tmp/bug09-ci-api`, `/private/tmp/bug09-fse-browser`, `/private/tmp/bug09-browser-fix2`, `/private/tmp/bug09-equivalence.json`, `/private/tmp/bug09-optional-evidence.json`. Il primo candidato e l’UAT sono equivalenti su 2.242 file fuori dalla documentazione (fingerprint `a2d113599315d20cc1754f90977f22a73a0226c8b6fbad77cd95322ce907cbd9`). I due adeguamenti successivi riguardano solo i test browser; la CI completa sul nuovo checkpoint resta obbligatoria prima del merge.

### Contesto Interventi della fixture

La partizione 1 del primo ciclo ha poi segnalato due casi ripetuti su cinque viewport: il test costruiva `centro=null` dal Centro dell’attore, che nel modello BUG01 è correttamente nullo. La fixture ora legge il Centro del beneficiario, ne verifica l’Area uguale a quella dell’attore e lo usa come filtro esplicito della pagina. Gli assert sulla conservazione di Area/Centro restano esatti; aggiunto il controllo che l’utente non sia vincolato a un Centro. Ripetizione integrale `m5c1-centro-richiesta.spec.ts`: **20 PASS / 0 SKIP**, evidenze `/private/tmp/bug09-browser-fix3`. Codice applicativo invariato.

Il run intermedio [39457545664](https://github.com/florianocaprio/Magazzino-Solidale/actions/runs/39457545664), avviato su `e06c830`, è stato annullato perché nel frattempo era emerso questo ulteriore KO sul vecchio test: non è un PASS e verrà sostituito da un ciclo completo sul candidato aggiornato. Nessun controllo o protezione è stato disabilitato.


### Revoche, Mensa e Richieste

La partizione 3 del primo ciclo ha completato import Beneficiari FSE+, lotti, contesto Mensa, trasporti e workflow Mensa, poi ha segnalato il vecchio test M5B. Le correzioni dei soli test rispettano le decisioni già approvate:

- `m5b-r2-revoca.spec.ts`: revoca Area intercettata da BUG01 prima del lookup; richiede il preciso 403 e il relativo codice/envelope, mantenendo la verifica dell’assenza dei dati protetti dopo refresh e deep link. Suite completa locale: **5 PASS**, `/private/tmp/bug09-browser-fix4` (il runner complessivo si fermava sul successivo test Mensa, quindi non è un PASS di tutta quella esecuzione).
- `m67a-access.spec.ts`: scelta esplicita della Mensa fra quelle dell’Area; heading cercato nel contenuto principale dopo la Sidebar; rimozione dell’Area nella fixture per verificare la revoca reale. Il vecchio endpoint di assegnazione per Mensa deve restituire 410. Conservati ricezione esatta di 12 kg, un solo movimento, ritorno dal report e rimozione delle righe dalla sessione revocata. **30 PASS**, `/private/tmp/bug09-browser-fix6`.
- `richieste-magazzino-m5b.spec.ts`: pulsante «Ritorna alle Richieste» verso la coda, ricerca Beneficiari solo dopo Area/Centro e senza directory completa, chiusura della Sheet distinta dal ritorno operativo, visibilità di tutti i Centri della stessa Area e diniego fra Aree. Conservati PDF immutabili, replay e sostituzione D1/D2, grant e dinieghi di preparazione. **20 PASS**, stessa esecuzione locale completa `/private/tmp/bug09-browser-fix6`.

Le prime ripetizioni diagnostiche Mensa contenevano ancora un selettore ambiguo e il vecchio percorso della richiesta di contesto: sono KO conservati nelle evidenze private, sostituiti dalla ripetizione completa positiva senza aumentare timeout o retry. Nessuna logica applicativa modificata.

La verifica delle suite non raggiunte dal primo ciclo ha rilevato due ulteriori riferimenti precedenti alla UAT: etichette/pannello prodotti nel Carico (`magazzino-workflows.spec.ts`) e azioni Mensa attese nel riepilogo Beneficiario (`uds-workflows.spec.ts`). Adeguamenti limitati al flusso corrente. Ripetizione completa Magazzino **4 PASS / 16 SKIP** di matrice, `/private/tmp/bug09-browser-fix7`; UDS **4 PASS / 16 SKIP**, `/private/tmp/bug09-browser-fix8`. La stampa della tessera dal profilo Beneficiario viene verificata aprendo «Modifica anagrafica», mentre il riepilogo resta in sola lettura. Conservati codice configurato, progressivo, ristampa senza nuova tessera, PATCH minime, ritorno filtrato e controllo viewport. Volontari, senza modificare la suite: **15 PASS / 0 SKIP**, stessa esecuzione `fix8`.


### Provenienza e passaggi finali

Dal codice UAT `fb2ba4b` cambiano soltanto dieci test browser e tre documenti: applicazione, API, schema, migration, dipendenze e configurazione restano identici. Le evidenze API/originali FSE e la UAT personale sono quindi riutilizzabili per i rispettivi input invariati. Il nuovo checkpoint richiede comunque un ciclo CI completo su tutti i 49 spec; un KO o una suite non eseguita non costituiscono PASS.

Il riferimento stabile alla PR raccoglie la SHA verificata, il run finale, i conteggi complessivi, le immagini effettivamente installate e l’eventuale SHA di merge. La nuova build personale deve conservare PostgreSQL, uploads, ledger 63/63 e le impronte delle 45 tabelle applicative, dopo backup e ripristino di prova isolato. Nessuna suite mutativa va eseguita sulla 8082. Non è previsto alcun aggiornamento Hetzner in questo mandato.


### Secondo ciclo completo — selettore FSE e sincronizzazione replay

Sul checkpoint `04ea7fc` il run [39462914762](https://github.com/florianocaprio/Magazzino-Solidale/actions/runs/39462914762) ha statico/Docker e API completi PASS (2.098 PASS / 7 SKIP in CI). Le partizioni browser 0 e 2 hanno segnalato due ulteriori KO, quindi il run non costituisce un GO complessivo:

- `fse-import-practice-m3b.spec.ts`: «Da verificare» era cercato sull’intera pagina e poteva risolvere sia il contatore sia il badge. Ora viene cercato nella riga con «Correggi o conferma», conservando l’esatto stato atteso. Ripetizione completa: **11 PASS / 24 SKIP** di matrice/originali non forniti a questa ripetizione; i file originali restano coperti dalla precedente prova privata.
- `m4b1-prenotazioni.spec.ts`: in CI il bottone Avvia non risultava visibile dopo il replay POST riuscito. Il medesimo test non modificato è passato integralmente in locale (10 PASS / 10 SKIP), quindi la causa applicativa non è dimostrata. La sincronizzazione ora richiede sia lo stato della risposta replay sia la rilettura canonica del documento prima degli assert UI/stock. Nessuna soglia o timeout aumentato; restano identici intenzione, un solo movimento e quantità. Ripetizione completa dopo l’adeguamento: **10 PASS / 10 SKIP**.

Evidenze: `/private/tmp/bug09-browser-round2-diag`, `/private/tmp/bug09-browser-round2-sync`, `/private/tmp/bug09-ci-round2-api` e partizioni browser omonime. Applicazione, schema e dipendenze restano invariati; nuovo ciclo completo richiesto prima del merge. I risultati delle partizioni ancora attive del secondo ciclo restano separati dal candidato aggiornato.
