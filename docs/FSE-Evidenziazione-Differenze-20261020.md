# FSE+ — evidenziazione dei dati differenti

Correttivo grafico UAT del 20 ottobre 2026. Nella colonna “Dati nel file FSE+”, i valori differenti da quelli registrati hanno una cornice ambra e uno sfondo chiaro; testo scuro leggibile e colori dedicati al tema scuro. Valori registrati, indicazioni sull’aggiornamento e azioni mantengono il comportamento esistente. La modifica interessa una sola stringa di classi CSS in `FseBeneficiariComparison`; nessun cambiamento al confronto, all’importazione, al DB o alle API.

Codice `7b35b65739b540c021dd30dea51a436fb7318e7a`. `pnpm run typecheck`: PASS. Suite di test non ripetute per questa sola modifica di colore, coerentemente con l’indicazione di Floriano per le correzioni grafiche. Entrambe le immagini compilate con i Dockerfile esistenti e installazione dipendenze congelata. I controlli del rilascio non sostituiscono la prova grafica dell’utente. Nessuna nuova migrazione e nessuna modifica a dipendenze, lockfile o file generati.

## Ricevuta della 8082

- API e WEB realmente ricompilati da archivio Git del commit e ricreati; PostgreSQL conserva container, avvio e volumi.
- /magazzino-api: `magazzino-bugfix-uat-api:sha-7b35b65739b5`, image ID `sha256:61e9c45b20818c1f3f43a063ce54cedc2afd1eeb6234d0e02b6fe476dd39a2eb`.
- /magazzino-web: `magazzino-bugfix-uat-web:sha-7b35b65739b5`, image ID `sha256:b0da1273f14d4a88169aa38c3b9c4b270896f71d353e3074506adfcffa0e8f58`.
- Backup DB/uploads: `/Users/florianocaprio/Backups/Magazzino-Solidale/FSE-HIGHLIGHT-7b35b65739b5-2026-10-20T12-03-35-238Z`, ripristino effettivo provato su PostgreSQL isolato; migrazioni ripetute 62 → 62. Hash di tutte le colonne delle **43 tabelle controllate invariati** dopo l’installazione.
- Ledger **62/62**, zero pending/checksum difformi/file mancanti o fuori ordine. Root/config/health/ready HTTP 200; Utenti anonimo HTTP 401.
- Entry servita `/assets/index-BtKtCUpg.js`. Asset JS/CSS confrontati per SHA-256 con la compilazione; verificata la presenza delle nuove classi ambra nel componente Beneficiari. Limite Nginx `client_max_body_size 10m;` confermato nella configurazione effettiva, come documentato per il rilascio Hetzner in [FSE-Upload-Nginx-20261020.md](FSE-Upload-Nginx-20261020.md).
- Build e budget PASS: Initial entry index-BtKtCUpg.js: 1392.5 KiB, 386.9 KiB gzip.

## File modificati

- `artifacts/magazzino-solidale/src/components/fse-beneficiari-comparison.tsx`: sole classi di evidenziazione.
- `docs/FSE-Evidenziazione-Differenze-20261020.md`: questo resoconto.
- `docs/campagna-bug-2026-10.md`: versione corrente della 8082.

Ricaricare la pagina sulla 8082, aprire l’anteprima Beneficiari e controllare i valori della colonna FSE+ nelle righe con differenze. UAT da confermare con Floriano; nessun prompt successivo avviato.
