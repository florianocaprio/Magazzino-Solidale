# Correttivo import FSE+ e Fascicolo — 20 ottobre 2026

Richiesta di Floriano: rendere operativi e coerenti gli import Magazzino e Beneficiari usando i tre Excel del 20 ottobre; Area prima del Centro; Fascicolo facoltativo nell’anagrafica e sulle Bolle; ricompilazione e installazione personale 8082. È una correzione della UAT 06–07, con raccordo all’anagrafica del punto 04. Nessun prompt successivo avviato.

## Risultato funzionale

### Magazzino

- Eliminati dal wizard i campi Codice interno, Descrizione e Crea sorgente. Il registro tecnico viene individuato o configurato al primo import e riutilizzato nell’Area. La scelta esplicita resta quando esistono più registri.
- La configurazione automatica richiede il permesso di importazione e un Magazzino accessibile al profilo corrente. È serializzata; un registro disattivato non viene sostituito per aggirare claim o coperture precedenti. La configurazione manuale arbitraria rimane amministrativa.
- “Carica e analizza” non dipende più dalla compilazione di metadati tecnici. Restano obbligatori Registro e, per il saldo iniziale, Giacenze, data e conferma della copertura storica.
- Spiegata la differenza fra nuovi carichi e giacenza iniziale. Il Registro documenta lo storico; nel saldo iniziale le quantità fisiche provengono dalle Giacenze.
- Se viene scelto il file Giacenze al posto del Registro, o viceversa, il server restituisce un’indicazione sul file corretto.
- Conservati ripresa delle sessioni, retry delle sole Giacenze, mapping espliciti, controlli su unità/fondi, claim, idempotenza e aggiornamento stock soltanto dopo la conferma del carico.

### Beneficiari

- Selezione Area obbligatoria prima del Centro; il Centro propone soltanto quelli attivi dell’Area. I vincoli del profilo restano applicati. Il server verifica anche l’Area dichiarata, così un Centro spostato non cambia silenziosamente la destinazione dell’import.
- Pulsante esplicito “Seleziona file Fascicoli FSE+”, nome file leggibile, limite XLSX 10 MB, istruzioni e azione “Carica e analizza” prima della conferma.
- Il video di 15,44 secondi è stato esaminato tramite fotogrammi temporanei. Mostra un Registro di magazzino selezionato nella finestra Beneficiari e l’errore generico “Workbook FSE+ non conforme”. Il messaggio ora indica di usare ElencoFascicoliSociali.
- Il file Fascicoli corretto ha 19 colonne: le due date aggiuntive intermedie non spostano più la lettura dei campi. Le 17 colonne canoniche sono riconosciute per nome, anche con ordine diverso, spazi esterni o maiuscole; colonne mancanti o duplicate restano bloccanti. Le due colonne extra sono segnalate come ignorate.
- Le date civili Excel sono interpretate dai seriali, senza conversioni al fuso orario del server; verificati sistemi 1900 e 1904. Nel file reale il 03/09/2024 rimane 03/09/2024. Nessuna correzione retroattiva automatica dei dati già presenti.
- Le somiglianze con beneficiari già presenti continuano a richiedere una scelta. I fascicoli distinti creati dallo stesso workbook non diventano nuovi duplicati interattivi a metà import, dopo un’anteprima positiva. I candidati sono rivalidati sullo stato precedente alle scritture del batch.
- Cambio Area/Centro/data invalida l’anteprima. Lettura e richieste pendenti non lasciano conferme utilizzabili in un contesto diverso.

### Fascicolo e Bolle

- Campo facoltativo Fascicolo nei form di creazione e modifica, visibile anche nella scheda. Usa il codice già conservato in `fse_fascicoli_sociali`, senza duplicarlo in un’altra colonna.
- Creazione e modifica sono transazionali insieme all’anagrafica; unicità senza distinzione maiuscole/minuscole, controllo della versione del Fascicolo, rollback su conflitto, audit e snapshot delle modifiche. Verificato anche il ritorno a un codice precedente nello stesso giorno.
- Il codice importato è immediatamente disponibile all’anagrafica e alla stampa Bolla. Supportati i tre modelli PDF e la stampa dall’Emporio; campo vuoto omesso, nessun Fascicolo personale sulla Bolla a Ente esterno.
- La stampa segue l’identità anagrafica corrente, come già avviene per i recapiti del beneficiario. Non è stato introdotto un congelamento retroattivo dei Fascicoli sulle Bolle storiche.

## Impatto tecnico

Nessuna migrazione e nessuna nuova tabella/colonna. Contratto OpenAPI esteso con risoluzione automatica del registro, identità/versione Fascicolo, verifica Area degli upload e campo di stampa. Client React e tipi/Zod generati soltanto con il comando ufficiale. Stack e struttura applicativa conservati.

I dati reali sono stati letti esclusivamente dai percorsi forniti e importati nei database temporanei del runner. Workbook, video, fotogrammi, log, credenziali e backup non fanno parte dei commit.

## Prove con i file reali

- Registro: `Table1!A1:U257`, 256 movimenti, data export 20/10/2026.
- Giacenze: `Table1!A1:O12`, 11 partite per 3.244 pezzi, 10 descrizioni prodotto. Verificati pezzi, peso, fattore, lotto, scadenza e fondo contro il workbook.
- Saldo iniziale: 11 righe prima nella pratica senza stock; dopo conferma 3.244 pezzi e 89 carichi storici coperti. Reimport dello stesso Registro senza nuovi movimenti.
- Fascicoli: `Table1!A1:S118`, 117 righe acquisite senza errori. Verificate tutte le date di presa in carico e il trimming del codice Fascicolo. Ripetizione: 117 invariati, nessun nuovo beneficiario.
- Verificato anche il rifiuto del Registro reale nel flusso Beneficiari, con messaggio dedicato.

## Validazione e installazione

Controlli sul candidato sorgente conclusi:

| Controllo | Esito |
| --- | --- |
| Node 24, `CI=true pnpm install --frozen-lockfile` | PASS, lockfile invariato |
| `pnpm run typecheck` | PASS |
| Runner canonico API `general`, con i tre percorsi Excel reali | **1.551 PASS, 2 SKIP**, 142 file |
| Runner canonico API `emporio` | **230 PASS**, 4 file |
| Unit interfaccia, compresi i tre PDF reali | **792 PASS**, 123 file |
| Browser Beneficiari, incluso pulsante nativo file chooser | **10 PASS**, tutti i cinque viewport |
| Browser M3B, inclusi i due Excel originali di ottobre | **11 PASS, 19 SKIP** preesistenti per matrice desktop/tablet |
| Codegen ufficiale ripetuto | **987 file identici byte per byte** |
| Build web e budget | PASS, immagine Docker finale: entry iniziale 386,8/400 KiB gzip |
| Quattro documenti locali preesistenti | SHA-256 invariati, esclusi dai commit |

I due SKIP API riguardano campioni originali del vecchio import AGEA non forniti a questa campagna. I tre Excel della richiesta sono stati effettivamente acquisiti e verificati. I 19 SKIP browser rispettano le limitazioni di viewport dei casi preesistenti; i nuovi flussi Beneficiari e Saldo sintetico sono eseguiti su tutti i cinque schermi.

La maggiore quantità di dati di prova ha evidenziato una collisione nella fixture Carichi 2.0A: l’ID riservato considerava le tabelle dei documenti ma non tutti i namespace del ledger. La fixture ora considera anche questi ultimi, mantenendo integralmente le verifiche sulle due origini e sul filtro del Carico; nessuna modifica al codice produttivo dei Carichi.

Evidenze private: `/private/tmp/fse-fix-api-approved`, `/private/tmp/fse-fix-api-final` (gruppo Emporio), `/private/tmp/fse-fix-browser-final`, `/private/tmp/fse-ui-tests-final-pass.log`, `/private/tmp/fse-typecheck-approved.log`, `/private/tmp/fse-codegen-replay.log`. Tutti i database temporanei dei runner sono stati rimossi.

### Ricevuta della 8082

Codice installato **`fc377e3865ee1958b3d753a3b32db0901cd9d396`**, compilato da `git archive` del commit verificato. API e WEB ricreati il 20/10/2026; PostgreSQL, volume database, uploads, rete, porte e configurazione conservati. Nessuna importazione dei campioni reali eseguita sul database personale.

| Servizio | Immagine | Image ID |
| --- | --- | --- |
| API | `magazzino-bugfix-uat-api:sha-fc377e3865ee` | `sha256:29fd7216d1040a44c56ec519217a1277a342a78d1adbd86b1f7e0da3d0126c47` |
| WEB | `magazzino-bugfix-uat-web:sha-fc377e3865ee` | `sha256:331d44ec0b08d6c2117b26fad494ebf62c36060e00904248f8ee065c6451470d` |

- Backup privato database e uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-IMPORT-FIX-fc377e3865ee-2026-10-20T09-10-16-805Z`. Directory 0700, file 0600.
- Backup elencato e ripristinato realmente su PostgreSQL isolato senza porte/volumi personali. Migrazioni e replay **62 → 62**, nessuna nuova migrazione.
- Hash di tutte le colonne di **43 tabelle** confrontati prima/dopo ripristino e installazione: invariati, compresi lotti produttore, beneficiari, fascicoli, import, claim e relativi storici.
- Ledger effettivo **62/62**, nessun pending, checksum difforme, file mancante o fuori ordine.
- `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**; `/api/utenti` anonimo: **401**.
- Entry servita `/assets/index-D4ha--7u.js`; confrontati SHA-256 degli asset effettivamente serviti con quelli estratti dall’immagine, inclusi Beneficiari, dettaglio, Carico Merce, testi FSE+ e Bolla PDF.
- Override immagini e `rollback-images.json` conservati nel backup. Nessun reset del database e nessuna modifica di ambiente principale/produzione.

Per ripetere anche i due test legacy saltati occorre il loro Registro AGEA storico (agosto/settembre, non il nuovo export di ottobre). Comando dalla checkout, con il percorso del campione valorizzato:

```sh
AGEA_ACCEPTANCE_XLSX='/percorso/al/Registro-AGEA-storico.xlsx' \
  PATH=/opt/homebrew/opt/node@24/bin:$PATH \
  CI_RESULTS_DIR=/private/tmp/fse-legacy-acceptance \
  node scripts/quality-gates-run.mjs api general
```

UAT personale ancora da confermare con Floriano; i test automatici e l’installazione non sostituiscono il suo OK.

## Prova personale

1. Ricaricare la 8082. In Carico Merce aprire una pratica dell’Area/Magazzino desiderati.
2. Per inizializzare dalle quantità realmente disponibili scegliere “Imposta giacenza iniziale”, allegare Registro al campo Registro e Giacenze al campo Giacenze, indicare 20/10/2026 e confermare la copertura. Non occorrono codici di sorgente. Associare i prodotti e controllare il riepilogo prima di aggiungere alla pratica e confermare il carico.
3. In Beneficiari → Importa FSE+, selezionare Area, Centro dell’Area, data e **ElencoFascicoliSociali**. Premere Carica e analizza, risolvere eventuali somiglianze con dati già presenti e confermare.
4. Aprire una scheda importata e controllare il Fascicolo. Verificarne inserimento/modifica anche su un’anagrafica manuale e presenza nella Bolla PDF.

## File della consegna

44 file, inclusi contratto, client generati, test e documentazione:

- `artifacts/api-server/src/lib/beneficiarioFascicolo.ts`
- `artifacts/api-server/src/lib/beneficiarioValidation.ts`
- `artifacts/api-server/src/lib/fseBeneficiari.ts`
- `artifacts/api-server/src/lib/fseImportParser.ts`
- `artifacts/api-server/src/lib/speseEmporio.ts`
- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/src/routes/beneficiari.ts`
- `artifacts/api-server/src/routes/bolle.ts`
- `artifacts/api-server/src/routes/fse-importazioni.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `artifacts/api-server/tests/carichi-magazzino-2-0a.test.ts`
- `artifacts/api-server/tests/fse-beneficiari.test.ts`
- `artifacts/api-server/tests/fse-import-parser-m3b.test.ts`
- `artifacts/api-server/tests/fse-import-practice-m3b.test.ts`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `artifacts/magazzino-solidale/e2e/fse-import-practice-m3b.spec.ts`
- `artifacts/magazzino-solidale/src/components/beneficiari-fse-ui.test.tsx`
- `artifacts/magazzino-solidale/src/components/fse-beneficiari-actions.tsx`
- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard-interactions.test.tsx`
- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard.tsx`
- `artifacts/magazzino-solidale/src/lib/bolla-fascicolo-pdf.test.ts`
- `artifacts/magazzino-solidale/src/lib/bolla-pdf.ts`
- `artifacts/magazzino-solidale/src/lib/emporio-bolla-stampa.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco07.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/reporting.ts`
- `artifacts/magazzino-solidale/src/pages/beneficiari.tsx`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `docs/FSE-Import-Correttivo-20261020.md`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/beneficiariFseExportInput.ts`
- `lib/api-zod/src/generated/types/beneficiariFseWorkbookImportUpload.ts`
- `lib/api-zod/src/generated/types/beneficiariFseWorkbookUpload.ts`
- `lib/api-zod/src/generated/types/beneficiario.ts`
- `lib/api-zod/src/generated/types/beneficiarioDettaglio.ts`
- `lib/api-zod/src/generated/types/beneficiarioInput.ts`
- `lib/api-zod/src/generated/types/beneficiarioUpdate.ts`
- `lib/api-zod/src/generated/types/bollaDettaglio.ts`
- `lib/api-zod/src/generated/types/bollaEmporioStampa.ts`
- `lib/api-zod/src/generated/types/fseAutomaticSourceInput.ts`
- `lib/api-zod/src/generated/types/index.ts`


## Aggiornamento UAT — nome proposto per il nuovo prodotto

Richiesta successiva di Floriano: nel mapping FSE+, “Crea prodotto” propone come nome la descrizione esterna del Banco Alimentare. Il testo resta modificabile e viene salvato il valore scelto dall’utente. Aprire un’altra descrizione prepara un nuovo form; premere nuovamente lo stesso pulsante non sovrascrive il nome già corretto. Nessuna modifica a database, API, OpenAPI o tipi generati.

File modificati per questo aggiornamento:

- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard.tsx`: inizializzazione del form dalla descrizione esterna.
- `artifacts/magazzino-solidale/e2e/fse-import-practice-m3b.spec.ts`: il flusso esistente verifica il nome proposto prima di correggerlo e controlla il nome effettivamente creato.
- `docs/FSE-Import-Correttivo-20261020.md`: questa ricevuta.
- `docs/campagna-bug-2026-10.md`: versione corrente della 8082.

Validazione ripetuta: `CI=true pnpm install --frozen-lockfile`, `pnpm run typecheck`, interfaccia **792 PASS**, API generale tramite runner isolato **1.548 PASS / 5 SKIP**, browser M3B **10 PASS / 20 SKIP**. Per questo ritocco non sono stati ripassati i percorsi dei campioni Excel opzionali: i tre casi API e il caso browser con file reali, già verificati nel correttivo precedente, risultano quindi SKIP insieme ai due casi API legacy e ai limiti di viewport preesistenti. Il caso browser di creazione/modifica del nome è effettivamente PASS. Nessun test sul database personale. Evidenze private sotto `/private/tmp/fse-product-name-*`.

Codice ora installato sulla **8082: `480959a1ed431ed05eed9fc5018e3496d7a065cd`**, da archivio Git immutabile. Immagini API `magazzino-bugfix-uat-api:sha-480959a1ed43`, WEB `magazzino-bugfix-uat-web:sha-480959a1ed43`. Entry servita `/assets/index-BNwe5BZA.js`, confrontata con l’immagine insieme agli asset FSE+. Build e budget PASS: Initial entry index-BNwe5BZA.js: 1392.3 KiB, 386.8 KiB gzip. Health/ready 200, endpoint Utenti anonimo 401; ledger 62/62. PostgreSQL e volumi conservati.

Backup database/uploads `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-PRODUCT-NAME-480959a1ed43-2026-10-20T09-26-19-739Z`, ripristino verificato su PostgreSQL isolato, migrazioni e replay 62 → 62. **Il confronto non è completamente invariato**: al riavvio la regola preesistente `schedulePriorityDowngrade` ha portato a `bassa` la priorità di 19 beneficiari con presa in carico da almeno due anni. Il confronto riga per riga con il backup conferma soltanto i campi `priorita` e `data_aggiornamento` cambiati, coerenti con il log dell’avvio; tutti gli altri campi dei Beneficiari e le altre 42 tabelle controllate sono identici. Non introdotto alcun cambiamento a tale regola. Override e rollback conservati nel backup; nessun dato ripristinato sul database personale.
