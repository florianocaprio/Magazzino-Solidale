# FSE+ — Massivo XLSM e aggiornamento dell’anagrafica

Correttivo UAT del 20 ottobre 2026. L’import Beneficiari accetta, a scelta, il Massivo XLSM oppure l’ElencoFascicoliSociali XLSX. La pagina spiega che il Massivo contiene più dati. Il confronto mostra soltanto le differenze e richiede una scelta esplicita; i record identici non producono schede da esaminare. Codice installato sulla 8082: `2e70fd3db29d33b05e922cae5606cb6a4e60b4db`. UAT di Floriano ancora da confermare; nessun prompt successivo avviato.

## Comportamento e limiti

- Pulsanti rinominati **Aggiorna anagrafica** e **Collega e aggiorna anagrafica**. Le indicazioni descrivono le modifiche proposte, prima della conferma dell’importazione.
- Identità del candidato e nascita registrata restano visibili. La tabella confronta soltanto i valori differenti; nome, cognome, nascita, codice fiscale, sesso, presa in carico, nucleo, consegna e stato vengono aggiornati con la scelta esplicita prevista. I dati personali facoltativi assenti nel file non cancellano quelli locali.
- Per un possibile duplicato sono disponibili collegamento/aggiornamento, salto della riga o creazione. Per un Fascicolo già identificato univocamente si aggiorna oppure si salta: non si crea una seconda anagrafica con lo stesso Fascicolo. Restano i controlli territoriali e la riservatezza dei candidati fuori dal Centro.
- Conteggi del nucleo per sesso e quattro fasce di età aggiornati nell’anagrafica/profilo locale. Non vengono inventati componenti individuali né cancellati quelli nominativi esistenti. Un successivo import identico non ripropone differenze e non cambia le versioni dei record.
- L’importazione verifica le versioni dell’anagrafica e del profilo viste in anteprima. Una modifica concorrente viene segnalata, senza sovrascrivere silenziosamente dati più recenti. Le chiamate precedenti, prive della nuova scelta esplicita, conservano il comportamento conservativo esistente.
- Il Massivo viene riconosciuto dai dati del foglio `Configuratore file csv`, con intestazione effettiva alla riga 8 e righe Excel originali conservate per le risoluzioni. I campi riconosciuti includono anagrafica del referente, Fascicolo, presa in carico, supporto, stato e conteggi del nucleo. Le righe vuote del modello non diventano beneficiari; nessuna macro viene eseguita.
- Paese/Comune di nascita, condizioni della presa in carico e colonne tecniche di esportazione senza campo locale equivalente non vengono attribuiti arbitrariamente a residenza, cittadinanza o note. Non si tratta dell’importazione indiscriminata di tutte le 33 colonne.
- Il formato Elenco esistente e il suo export a 17 colonne restano supportati. Area prima del Centro; allegato unico XLSX/XLSM, massimo 10 MB. Migliorato lo scorrimento dei menu Area/Centro con elenchi lunghi.
- Magazzino: all’apertura si ricaricano catalogo e dettaglio della sessione. Anche una sessione già salvata riceve le proposte calcolate sul catalogo aggiornato; le associazioni confermate restano conservate. Quando non esiste una somiglianza sufficiente viene mostrata una spiegazione, con selezione manuale e creazione sempre disponibili. Nessuna associazione automatica e nessun cambiamento alla contabilizzazione dello stock.

## File reali e impatto tecnico

Massivo fornito: `Elenco_Fascicoli_Sociali_Massivo_20-10-2026_11-41.xlsm`, letto in sola lettura. SHA-256 `d6389c7ff92fcf69b22aaeb268bad2480850186907a8284b097a9062cc57c58c`.

Riconosciuti **117 Fascicoli**, righe 9–125: 117 date di nascita, 115 codici fiscali presenti, 289 componenti complessivi. Totali per età: **74 / 20 / 174 / 21**, rispettivamente <18, 18–29, 30–64 e ≥65. I 117 Fascicoli coincidono con quelli dell’Elenco semplice fornito: verificato il passaggio fra formati tramite aggiornamento senza nuove anagrafiche duplicate. Nessun contenuto personale dei workbook è incluso in questo documento o nei commit.

**Nessuna modifica allo schema del database e nessuna nuova migrazione.** I dati aggiuntivi utilizzano i campi e i metadati JSON già esistenti. OpenAPI estesa con formato riconosciuto, indicazione delle differenze, scelta di aggiornamento e versioni attese. Tipi React/Zod rigenerati con `pnpm --filter @workspace/api-spec run codegen`; replay identico su 990 file. Nessuna modifica a stack, dipendenze o lockfile.

## Validazione realmente eseguita

Controlli con Node 24 e pnpm 10; database di prova isolati, rimossi al termine. Nessun import di prova nel database personale della 8082.

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS.
- Test interfaccia: **794 PASS**, 124 file.
- API, runner ufficiale `node scripts/quality-gates-run.mjs api general`: **1.558 PASS / 2 SKIP**, 143 file. Il runner esegue Vitest di `@workspace/api-server` con database isolato e l’elenco del gruppo. I due SKIP riguardano campioni legacy AGEA non forniti.
- API Emporio, stesso runner gruppo `emporio`: **230 PASS**, 4 file. Tutti e quattro i file reali forniti per questo intervento (Massivo, Elenco semplice, Registro e Giacenze) sono stati utilizzati nei controlli pertinenti.
- Browser Beneficiari: **20 PASS** sui cinque viewport. Include differenze Massivo, aggiornamento locale, reimport identico senza schede né variazione delle versioni, assenza di overflow oltre 1 px.
- Browser Magazzino: **12 PASS / 23 SKIP**. Include sessione salvata, aggiunta di un prodotto al catalogo dopo il salvataggio, riapertura della sessione e conferma della nuova proposta. Verificati anche i due file originali e il replay senza doppio stock. I 23 SKIP sono esclusioni della matrice viewport: 19 preesistenti e 4 per il nuovo caso riservato al desktop.
- Build API/WEB e budget iniziale: PASS, **386,9 / 400 KiB gzip**.

Le prove iniziali hanno rilevato un metadato tecnico che alterava l’export semplice a 17 colonne e un menu Area che usciva dal viewport con molti elementi. Corrette entrambe le cause e ripetute le verifiche complete pertinenti; mantenuta l’asserzione originale sulle 17 colonne. Aggiornate due asserzioni UI/browser per riflettere la richiesta di non mostrare valori uguali e per distinguere due etichette omonime. Il primo build Docker si era interrotto per DNS/timeout npm; il secondo, sul medesimo commit e con gli stessi Dockerfile, è terminato dopo il ripristino della connessione.

Evidenze private: `/private/tmp/fse-massivo-api-approved`, `/private/tmp/fse-massivo-api`, `/private/tmp/fse-massivo-browser-final`, `/private/tmp/fse-massivo-browser-magazzino`, `/private/tmp/fse-massivo-ui-approved.log`, `/private/tmp/fse-massivo-typecheck-approved.log`, `/private/tmp/fse-massivo-codegen-replay.log`.

## Ricevuta effettiva della 8082

API e WEB compilati da `git archive` del commit `2e70fd3db29d33b05e922cae5606cb6a4e60b4db` e realmente ricreati. PostgreSQL conserva container, istante di avvio e volume.

| Servizio | Immagine | Image ID |
| --- | --- | --- |
| API | `magazzino-bugfix-uat-api:sha-2e70fd3db29d` | `sha256:853cb72abfd0ec38ad06ce65c72094ec9ceb132c95e0400225e4718f525b6610` |
| WEB | `magazzino-bugfix-uat-web:sha-2e70fd3db29d` | `sha256:a4371324b7209039e962c025772e8bbee5dbf71e1b06f12008476ab146e52684` |

- Backup DB/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-MASSIVO-2e70fd3db29d-2026-10-20T10-54-45-472Z`, directory 0700 e archivi 0600. Ripristino effettivo provato su PostgreSQL temporaneo isolato, senza porte pubblicate né volumi personali; migrazioni ripetute **62 → 62**. Override di rilascio e rollback conservati nel backup.
- Hash su tutte le colonne di **43 tabelle invariati** nel ripristino e dopo l’installazione. Ledger effettivo **62/62**, zero pending, checksum difformi, file mancanti o fuori ordine.
- HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**; `/api/utenti` anonimo: **401**.
- Entry servita `/assets/index-BOG240_-.js`. Asset serviti confrontati per SHA-256 con quelli dell’immagine compilata; verificati accettazione XLSM, confronto Beneficiari, proposte Magazzino e controlli già consegnati per Enti/Fornitori globali e Carichi.

Per la prova manuale: ricaricare la pagina della 8082; selezionare Area/Centro e uno dei due file Beneficiari; verificare che compaiano solo le differenze e che il pulsante sia “Aggiorna anagrafica”; scegliere aggiornamento, salto o creazione dove consentito e confermare. Reimportando gli stessi dati non devono riapparire schede identiche. Nel Magazzino riaprire una sessione salvata e controllare le proposte: una proposta richiede sempre una conferma, e non è garantita quando non esiste un prodotto sufficientemente simile.

## File modificati

- `artifacts/api-server/src/lib/fseBeneficiari.ts`
- `artifacts/api-server/src/lib/fseBeneficiariImportPlan.ts`
- `artifacts/api-server/src/lib/fseBeneficiariMassivo.ts`
- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `artifacts/api-server/tests/fse-beneficiari-massivo.test.ts`
- `artifacts/api-server/tests/helpers/fse-massivo-workbook.ts`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `artifacts/magazzino-solidale/e2e/fse-import-practice-m3b.spec.ts`
- `artifacts/magazzino-solidale/src/components/beneficiari-fse-ui.test.tsx`
- `artifacts/magazzino-solidale/src/components/fse-beneficiari-actions.tsx`
- `artifacts/magazzino-solidale/src/components/fse-beneficiari-comparison.tsx`
- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard-interactions.test.tsx`
- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco07.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/reporting.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/beneficiariFseComparisonField.ts`
- `lib/api-zod/src/generated/types/beneficiariFseDuplicateCandidate.ts`
- `lib/api-zod/src/generated/types/beneficiariFseImportResolution.ts`
- `lib/api-zod/src/generated/types/beneficiariFseImportResolutionAzione.ts`
- `lib/api-zod/src/generated/types/beneficiariFsePreviewResult.ts`
- `lib/api-zod/src/generated/types/beneficiariFsePreviewResultFormatoFile.ts`
- `lib/api-zod/src/generated/types/beneficiariFsePreviewRow.ts`
- `lib/api-zod/src/generated/types/beneficiariFseWorkbookImportUpload.ts`
- `lib/api-zod/src/generated/types/beneficiariFseWorkbookUpload.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `docs/FSE-Massivo-Anagrafica-20261020.md`
- `docs/campagna-bug-2026-10.md`
