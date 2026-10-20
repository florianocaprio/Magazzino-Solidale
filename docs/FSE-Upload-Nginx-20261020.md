# FSE+ — correzione HTTP 413 nel caricamento Beneficiari

Il Massivo XLSM veniva respinto da Nginx prima di raggiungere l’importatore. Riprodotto sulla precedente 8082 con un upload sintetico da 2 MiB: HTTP 413 e pagina HTML Nginx. Nella configurazione effettiva mancava un limite esplicito per gli upload API. I precedenti test dell’importatore non attraversavano questo proxy.

Correzione minima in `nginx.conf`: `client_max_body_size 10m;` nella sola location `/api/`. Il limite riguarda la richiesta completa, compreso il multipart. Rimangono i controlli applicativi esistenti di dimensione, autorizzazione, formato e perimetro. Nessun cambio a parser, DB, OpenAPI, dipendenze, lockfile o file generati. Restano presenti i colori verdi delle associazioni suggerite.

## Verifiche

- `CI=true pnpm install --frozen-lockfile`: PASS; lockfile invariato.
- `pnpm run typecheck`: PASS.
- API tramite runner ufficiale `node scripts/quality-gates-run.mjs api general`: **1.558 PASS / 2 SKIP**, 143 file. Il runner esegue Vitest del pacchetto API con elenco del gruppo e database temporaneo. I due SKIP sono i campioni legacy AGEA non forniti. Inclusi i quattro file reali già forniti per FSE+, compreso il Massivo del 20/10 ore 11:41. Nessun import di prova nella 8082 personale.
- **Cinque prove di upload attraverso l’immagine Nginx compilata**, su rete Docker interna con backend temporaneo senza database: 2 MiB accettati; Massivo reale multipart da 5.020.313 byte inoltrato senza alterazioni sia a preview sia a import; richiesta esattamente da 10 MiB accettata; 10 MiB + 1 byte respinti con 413. Per ogni richiesta ammessa, lunghezza e SHA-256 ricevuti dal backend coincidono con l’inviato. Sintassi Nginx valida. Container e rete temporanei rimossi.
- **8082 effettiva dopo installazione**: lo stesso file reale (5.020.137 byte, più multipart) raggiunge entrambe le route. Le prove anonime ricevono il JSON API **401**, invece del precedente HTML **413** Nginx. Non essendo autenticate, non avviano alcun import; la corretta importazione autenticata è verificata separatamente dai test API isolati.
- API e WEB compilati con i Dockerfile esistenti. Budget PASS: Initial entry index-D_9_UXgT.js: 1392.5 KiB, 386.9 KiB gzip.

Evidenze private: `/private/tmp/fse-upload-api`, `/private/tmp/fse-upload-proxy-result.json`, `/private/tmp/fse-upload-live-result.json`, `/private/tmp/fse-upload-typecheck.log`.

## Ricevuta della 8082

Codice realmente installato **`448ab5d4df75b9307f871b8ea1cb63f9a8485c3b`**, compilato da archivio Git. API e WEB ricreati, PostgreSQL conserva container, istante di avvio e volumi.

- /magazzino-api: `magazzino-bugfix-uat-api:sha-448ab5d4df75`, image ID `sha256:648185e2d33f465740f7e48c9e59ea5c4b424e17285b19d1587de5f484d08cfe`.
- /magazzino-web: `magazzino-bugfix-uat-web:sha-448ab5d4df75`, image ID `sha256:f9f66e1b4e2f455be63548537edb4614c9cae442863c2ab508d93bf6680a6e67`.

- Backup privato DB/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-UPLOAD-448ab5d4df75-2026-10-20T11-52-27-221Z`; ripristino realmente provato in PostgreSQL temporaneo isolato, migrazioni ripetute 62 → 62. Override di rilascio e rollback conservati nel backup.
- Ledger **62/62**, zero pending/checksum difformi/file mancanti o fuori ordine; hash di tutte le colonne delle **43 tabelle controllate invariati** dopo il rilascio.
- Configurazione Nginx effettiva con `client_max_body_size 10m;`. HTTP root/config/health/ready 200, Utenti anonimo 401. Asset serviti confrontati per SHA-256 con l’immagine; entry `/assets/index-D_9_UXgT.js`.

## File modificati e prova manuale

### Propagazione al rilascio Hetzner

La configurazione è **versionata**, non una modifica manuale del container: commit tecnico `448ab5d4df75b9307f871b8ea1cb63f9a8485c3b`, pubblicato sul branch `codex/bugfix-uat-ottobre-2026`. `Dockerfile.web` copia `nginx.conf` in `/etc/nginx/conf.d/default.conf` nell’immagine finale.

Al rilascio Hetzner, includere questo commit nel candidato approvato e distribuire l’immagine WEB costruita da quel candidato. Il solo aggiornamento dei sorgenti o il riavvio di una vecchia immagine non aggiorna Nginx. Non serve ricreare a mano la correzione sul server.

Verificare nel container WEB la configurazione effettiva con `nginx -T`: nella location `/api/` deve comparire `client_max_body_size 10m;`. Completare il controllo del rilascio con l’anteprima di un Massivo da circa 5 MB dal dominio pubblico, senza confermare l’importazione. Questa prova comprende eventuali proxy esterni al container, non verificati dall’installazione locale sulla 8082. Le evidenze già registrate si riferiscono al candidato locale; il presente aggiornamento documentale non richiede di ripetere le suite applicative né attesta un rilascio su Hetzner.

### Inventario e prova sulla 8082

- `nginx.conf`: due righe per il limite upload API.
- `docs/FSE-Upload-Nginx-20261020.md`: questo resoconto.
- `docs/campagna-bug-2026-10.md`: versione corrente e collegamento alla ricevuta.

Ricaricare localhost:8082, selezionare Area/Centro, allegare nuovamente il Massivo e scegliere “Carica e analizza”. Il file ora deve raggiungere l’anteprima con le differenze dell’anagrafica. UAT ancora da confermare con Floriano; nessun prompt successivo avviato.
