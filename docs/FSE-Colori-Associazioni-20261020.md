# FSE+ — colore delle associazioni suggerite

Correttivo grafico UAT del 20 ottobre 2026, richiesto da Floriano. Le corrispondenze proposte nell’import Magazzino hanno riquadro verde tenue e pulsanti “Associa a…” verdi, con stato hover più evidente e colori per il tema scuro. Il verde compare quando sono presenti proposte; il messaggio senza corrispondenze resta neutro. Clic e logica di associazione restano quelli esistenti.

Codice: `2e3ffd38e19d405e5fead0fac18326272c64fccb`. Nessuna modifica a dati, schema DB, API, dipendenze o file generati. Come espressamente richiesto, non sono stati eseguiti test né typecheck separati per questa modifica di sole classi CSS. La compilazione Docker esegue l’installazione congelata delle dipendenze e i build previsti dai Dockerfile. Il controllo del rilascio verifica immagini, salute e asset effettivamente serviti; non equivale a una UAT grafica, che resta a Floriano.

## Ricevuta della 8082

- API e WEB realmente ricompilati da archivio Git del commit e ricreati sulla 8082. PostgreSQL conserva container, istante di avvio e volumi.
- /magazzino-api: `magazzino-bugfix-uat-api:sha-2e3ffd38e19d`, image ID `sha256:f3fe2662488fed2678b8f07e36d0af5de1be801d4ba11b853404beca12fae06f`.
- /magazzino-web: `magazzino-bugfix-uat-web:sha-2e3ffd38e19d`, image ID `sha256:ba5943f127b00e86d247ed0daff991625010736dadb082df1378f8421d791e0a`.
- Backup privato database/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-GREEN-2e3ffd38e19d-2026-10-20T11-47-03-842Z`; ripristino provato in PostgreSQL isolato. Ledger **62/62**; hash di tutte le colonne delle **43 tabelle controllate invariati** prima/dopo rilascio.
- `/`, `/config.js`, `/api/healthz`, `/api/readyz`: HTTP 200; `/api/utenti` anonimo: HTTP 401.
- Entry servita `/assets/index-D_9_UXgT.js`. Asset JS/CSS confrontati con gli artefatti compilati tramite SHA-256; confermata la presenza delle nuove classi verdi nei suggerimenti del Magazzino.
- Compilazione e budget: PASS. Initial entry index-D_9_UXgT.js: 1392.5 KiB, 386.9 KiB gzip. Nessuna suite di test eseguita per questo correttivo, su richiesta esplicita.

## File modificati

- `artifacts/magazzino-solidale/src/components/fse-import-practice-wizard.tsx`: sole classi di colore e bordo delle proposte.
- `docs/FSE-Colori-Associazioni-20261020.md`: questo resoconto.
- `docs/campagna-bug-2026-10.md`: versione corrente della 8082.

Per la prova: ricaricare la pagina su localhost:8082, riaprire l’import e controllare il passaggio “Controlla e associa”. I pulsanti verdi confermano con un clic la singola associazione suggerita. Nessun prompt successivo avviato.
