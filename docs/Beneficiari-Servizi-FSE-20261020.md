# Beneficiari FSE+ — accettazione, territorio e servizi

Correttivo UAT del 20 ottobre 2026, dopo la registrazione di 42 secondi e le due schermate fornite. Codice installato sulla **8082: `9622c7d076966f461dcbc3e1d122161528c688ef`**, compilato da archivio Git. Prompt successivo non avviato; validazione di Floriano ancora da ricevere.

## Comportamento

- Le nuove anagrafiche importate da ElencoFascicoliSociali XLSX o Massivo XLSM sono già **complete**. Non occorre accettarle una seconda volta. I dati demografici assenti dal file restano assenti; il salvataggio di un import già completo non obbliga a inventare sesso, nascita o provenienza.
- In Modifica anagrafica è sempre presente Area Operativa prima del Centro. Il Centro elenca soltanto quelli attivi dell’Area; cambiare Area azzera il Centro precedente. Per operatori territoriali l’Area è quella autorizzata. Prima dei comandi di servizio bisogna salvare eventuali variazioni territoriali. Anche la finestra preesistente di completamento UDS presenta Area e relativi Centri; resta distinto il flusso UDS dedicato.
- La prima attivazione Emporio abilita anche il Credito Solidale, in stato attivo. Le sospensioni/revoche finanziarie già esplicite restano conservate. L’attivazione non carica un saldo e non cambia quote o movimenti.
- Nella configurazione Credito si può scegliere una politica attiva applicabile al Centro, all’Area o globale, oppure tornare alla selezione automatica. Applica politica aggiorna il calcolo e la quota non manuale; una quota manuale è conservata. Politiche inattive o di altri territori sono rifiutate anche dal server. La gestione resta soggetta ai permessi Credito; la politica è nascosta a chi non può leggere i dati finanziari.
- La pagina aperta dal nome mostra solo gli stati dei servizi Emporio, Mensa e Tessera, insieme a riepiloghi, storico e richiesta al Magazzino. Le abilitazioni, configurazioni, tessera, nucleo e Fascicolo si gestiscono da **Modifica anagrafica**. Gli operatori con soli permessi di servizio mantengono i propri comandi; i campi anagrafici restano non modificabili senza il relativo permesso.
- Gli stati nella consultazione vengono aggiornati dopo le variazioni. Corretto il reset vuoto del selettore Credito quando compare dopo l’attivazione; eliminato lo scorrimento laterale del nuovo gruppo su schermi piccoli con nomi lunghi.

## Schema, contratto e dati esistenti

Aggiunta una sola colonna facoltativa `beneficiari.politica_credito_solidale_id`, con FK denominata `beneficiari_politica_credito_fk`. NULL conserva la scelta territoriale precedente. OpenAPI estende i modelli e la configurazione Credito con il campo nullable, e aggiunge GET `/beneficiari/{id}/stati-servizi`, una risposta minima senza token tessera o dati finanziari/sociali. Client React/Zod e tipi rigenerati con `pnpm --filter @workspace/api-spec run codegen`: replay identico su 992 file. Nessun cambio a stack, dipendenze o lockfile.

La migrazione incrementale `20261020_z_beneficiari_servizi.sql`, provata anche sul backup reale, ha corretto **115 anagrafiche**:

- **109** import FSE+ già provvisori diventano completi, con Fascicolo importato e territorio attivo/coerente.
- **3** riferimenti Area mancanti vengono ricavati dal Centro attivo noto, senza indovinare territori incoerenti o Zone UDS.
- **3** Crediti mai abilitati vengono attivati per diritti Emporio già attivi.

I tre conteggi sono condizioni distinte, non un criterio generale per accettare provvisori manuali. Aggiornate versione e data delle sole righe interessate. Quote, saldo, movimenti, revoche e singoli componenti del nucleo restano conservati. Il riepilogo numerico FSE+ non inventa i nominativi dei componenti: il suo stato di dettaglio è distinto dall’accettazione dell’anagrafica. Replay della migrazione senza ulteriori modifiche.

Dopo l’installazione, controllo in sola lettura sulla 8082: **zero import FSE+ non UDS ancora provvisori** e zero Aree mancanti ricostruibili da un Centro attivo coerente.

## Validazione

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS sul codice definitivo.
- UI: **796 PASS**, 124 file; consultazione senza comandi, spostamento nella modifica e permessi dei servizi.
- API tramite runner ufficiale, equivalente a Vitest del pacchetto api-server: generale **1561 PASS / 2 SKIP**, 144 file; Emporio **231 PASS**, 4 file; Mensa **108 PASS**, 1 file. I due SKIP sono i campioni legacy AGEA non forniti. Incluse prove reali dei quattro file FSE+ disponibili, politica selezionata/territorio/quota manuale/saldo conservato, assenza di dati finanziari senza permesso, attivazione iniziale, revoche conservate, GET di stato senza scritture e migrazione ripetibile.
- Browser: **90 PASS Emporio** e **30 PASS FSE+**, nei cinque viewport. Nuova prova completa: XLSM → anagrafica completa → Area/Centro → Emporio e Credito attivi → politica globale scelta, politica Area disponibile e altra Area esclusa → quota 21 e saldo 0 → salvataggio e consultazione aggiornata. Verificata anche la modifica dell’import XLSX conservando i dati mancanti; overflow entro 1 px. Screenshot mobile della configurazione ispezionato.
- Le prove hanno individuato e fatto correggere prima del rilascio il reset vuoto dello stato e l’overflow del fieldset. Le esecuzioni finali sono passate; i tentativi precedenti restano nelle evidenze private.
- Tutti i test su database temporanei rimossi dal runner. Nessuna prova d’importazione sul database personale della 8082. Evidenze private: `/private/tmp/fse-services-api-verified`, `/private/tmp/fse-services-api-first` per Emporio/Mensa, `/private/tmp/fse-services-browser`, `/private/tmp/fse-services-browser-verified`, `/private/tmp/fse-services-ui-verified.log`, `/private/tmp/fse-services-typecheck-verified.log`.

## Ricevuta della 8082

- API: `magazzino-bugfix-uat-api:sha-9622c7d07696`, ID `sha256:f53d7908caf2b67a47a42e68fb2222c982505b16ca89559140244c1f8c051428`.
- WEB: `magazzino-bugfix-uat-web:sha-9622c7d07696`, ID `sha256:88e2919051d4281afffdbe9ba9dfc28d01bc52e0a246ed7d66e155bf26f80393`.
- Backup DB/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-SERVICES-9622c7d07696-2026-10-20T14-49-14-513Z`. Ripristino effettivo su PostgreSQL isolato e migrazione **62 → 63**, poi replay, prima dell’installazione. Il controllo privato interpreta in UTC i timestamp PostgreSQL senza fuso; sono confrontati tutti gli altri campi.
- PostgreSQL conserva container, avvio e volumi. Ricreati soltanto API e WEB. Ledger **63/63**, zero pending, checksum difformi, file mancanti o fuori ordine.
- **44 altre tabelle** confrontate su tutte le colonne: hash invariati, incluse politiche e movimenti Credito. Per Beneficiari il confronto di tutti i campi conferma esattamente le sole correzioni attese e la colonna nullable; saldi e quote invariati. Nessuna ulteriore riduzione automatica preesistente delle priorità era in attesa.
- HTTP root/config/health/ready 200, Utenti anonimo 401. Entry `/assets/index-CoHdKnXl.js`; asset JS/CSS confrontati per SHA-256 con l’immagine. Verificati nuovi controlli servizi/politica e funzioni già consegnate: Enti/Fornitori globali, carichi, import selettivo, colori, accettazione XLSM e Nginx `client_max_body_size 10m;`.
- Build/budget PASS: Initial entry index-CoHdKnXl.js: 1393.4 KiB, 387.2 KiB gzip.

Il backup conserva override di rilascio e delle immagini precedenti. Tornare al codice con soli 62 file di migrazione richiederebbe anche il ripristino coerente del DB precedente: non basta sostituire le immagini dopo la migrazione 63. Nessun rollback eseguito. Nessun deploy Hetzner o merge su main; schema e codice sono versionati sul branch UAT.

## File modificati

- `artifacts/api-server/src/lib/beneficiarioValidation.ts`
- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/src/routes/beneficiari.ts`
- `artifacts/api-server/src/routes/credito-solidale.ts`
- `artifacts/api-server/src/routes/emporio-servizio.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `artifacts/api-server/tests/beneficiari-hardening.test.ts`
- `artifacts/api-server/tests/credito-solidale.test.ts`
- `artifacts/api-server/tests/emporio-uat-f1.test.ts`
- `artifacts/magazzino-solidale/e2e/emporio-uat-f1.spec.ts`
- `artifacts/magazzino-solidale/e2e/fse-beneficiari-import.spec.ts`
- `artifacts/magazzino-solidale/src/components/beneficiario-emporio-card.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-mensa-card.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-tessera.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-uds-tools.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/creditoSolidale.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/emporioServizio.ts`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/beneficiario.ts`
- `lib/api-zod/src/generated/types/beneficiarioDettaglio.ts`
- `lib/api-zod/src/generated/types/creditoSolidaleConfigurazione.ts`
- `lib/api-zod/src/generated/types/creditoSolidaleConfigurazioneInput.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/db/src/schema/beneficiari.ts`
- `artifacts/api-server/src/lib/creditoPolicyScope.ts`
- `artifacts/api-server/tests/db-beneficiari-servizi-migration.test.ts`
- `artifacts/magazzino-solidale/src/components/beneficiario-credito-policy.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-servizi-riepilogo.tsx`
- `lib/api-zod/src/generated/types/beneficiarioServiziRiepilogo.ts`
- `lib/api-zod/src/generated/types/beneficiarioServizioStato.ts`
- `lib/db/updates/20261020_z_beneficiari_servizi.sql`
- `docs/Beneficiari-Servizi-FSE-20261020.md`
- `docs/campagna-bug-2026-10.md`

Quattro documenti locali preesistenti preservati ed esclusi, con SHA-256 invariati; nessun file personale, credenziale, log, screenshot, video o foglio FSE+ committato.

## Prova manuale

Ricaricare la 8082. Verificare che gli import precedenti siano completi e che un nuovo XLSX/XLSM non richieda accettazione. Aprire Modifica anagrafica, verificare Area e Centri, salvare eventuali variazioni e attivare Emporio: Credito deve risultare attivo. Scegliere e applicare una politica utilizzabile, poi controllare quota e saldo. Tornando alla pagina dal nome devono comparire gli stati e i riepiloghi, con la richiesta al Magazzino ancora disponibile; i comandi restano nella modifica. UAT da confermare con Floriano.
