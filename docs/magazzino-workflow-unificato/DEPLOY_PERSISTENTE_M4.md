# M4 — deploy sul Docker persistente

Data: 25 settembre 2026, Europe/Rome. Branch `codex/magazzino-workflow-unificato`, SHA autorizzata/revisionata e HEAD locale/remota `d96680eeee82b2b5a4690602534168623826b544`, divergenza `0/0`, working tree/index puliti al preflight. `main` locale `8419dc7ff9d5177c39d90e66f04b19236021244d`, `origin/main` `787d7c5436d5fa4c0edb24be373d055946d402ce`, non toccati. Nessun merge, commit o push in questa fase.

## Preflight e backup

Docker Desktop era spento all'inizio della sessione ed è stato avviato. Il progetto Compose è `magazzino-solidale`, file `docker-compose.yml` del checkout, rete `magazzino-solidale_default`. I tre container avevano la label di progetto corretta. PostgreSQL era healthy con ID `57e462be280a` e volume `magazzino-solidale_magazzino_pgdata` su `/var/lib/postgresql/data`; API healthy con ID `2beebbad6c21` e volume `magazzino-solidale_magazzino_uploads` su `/app/uploads`; WEB attivo con ID `f344ed86a768`. Nessun volume è stato ricreato. Il DB era a **40/40** migrazioni, ultima `20260919_m4a_documenti_destinatari.sql`.

Backup nuovi fuori Git, directory `0700`:
`/Users/florianocaprio/.local/share/magazzino-solidale/backups/m4/2026-09-25T0701-Rome/`.
Tutti gli archivi sono `0600`. Il dump custom è stato verificato con `pg_restore --list`, il tar con `tar -tf`; entrambi esistono e non sono vuoti. La copia frozen del dump è stata anche **ripristinata realmente** in PostgreSQL effimero senza porta/volume persistente: lo snapshot ripristinato coincide byte per byte con quello del DB congelato. Il container di prova è stato rimosso.

| File                           |    Byte | SHA-256                                                            |
| ------------------------------ | ------: | ------------------------------------------------------------------ |
| `magazzino-pre-m4.dump`        | 858.794 | `dc25f66794d31a3829fc45ad83ef2731a6afcfca1215f55cedefbdaf14f9dc5c` |
| `uploads-pre-m4.tar`           |   1.536 | `bad90da512639fafa8a8ef157ded80623ce84ff7ba13138c6c8559be2bd3b710` |
| `magazzino-pre-m4-frozen.dump` | 858.794 | `a6b358ddd3c18bc300c3927be1d40753a3cb445c6323339b181f70fe809f4661` |
| `uploads-pre-m4-frozen.tar`    |   1.536 | `bad90da512639fafa8a8ef157ded80623ce84ff7ba13138c6c8559be2bd3b710` |

Lo snapshot iniziale e quello frozen sono identici. I vettori integrali di conteggio/impronta, senza dati personali in chiaro, sono `snapshot-pre-live.txt`, `snapshot-pre-frozen.txt`, `snapshot-restored.txt` e `snapshot-post-migration.txt` nella stessa directory protetta. Prima del deploy: 13 lotti, residuo `1467.000000` (`1079.000000` pz, `388.000000` cf), 16 movimenti, 3 Trasferimenti (`richiesto` 1, `completato` 2), 0 Bolle, 0 Consegne, 0 prenotazioni, 0 distribuzioni, 1 Scarico, 7 utenti, 13 ruoli e 0 file uploads. Nessun movimento `esito` o rientro.

## Build e migrazioni

Le immagini sono state costruite dal working tree pulito alla SHA esatta, su `linux/arm64` come le immagini preesistenti, con label OCI `org.opencontainers.image.revision=d96680eeee82b2b5a4690602534168623826b544`. L'immagine API `magazzino-solidale-api:m4-d96680e-20260925` ha ID `sha256:99ca226db006bf6c0bafe65189f162fcff762e844b993a32c2c211086114286e`; WEB `magazzino-solidale-web:m4-d96680e-20260925` ha ID `sha256:24979a2f333ef2fd5fdee18749c57a4cc859a34ef9ecc6dbe265e82368e042a9`. Le vecchie immagini sono conservate come `magazzino-solidale-api:pre-m4-20260925` e `magazzino-solidale-web:pre-m4-20260925`. La simulazione Compose con `--no-build --no-deps --force-recreate` coinvolgeva solo il servizio indicato, non DB/rete/volumi.

Dopo avere fermato soltanto WEB e API e verificato zero sessioni DB concorrenti, il backup/snapshot frozen è stato acquisito. La sola API è stata ricreata tramite il Compose esistente; PostgreSQL è rimasto lo stesso container/volume. Il runner ufficiale startup, run 71, ha verificato le prime 40 e applicato **solo** `20260923_m4b1_prenotazioni_trasferimenti.sql` e `20260924_m4b2_rientri_trasporto.sql`: `applied=2 skipped=40 pending=0`. `readyz` segnala `SUCCESS`, 42/42, nessun checksum mismatch né file mancante/out-of-order. Nessun `drizzle push` o intervento SQL manuale sullo schema.

## Confronto dati e pausa di sicurezza

Lo snapshot post-migrazione conferma invariati per conteggio e impronta: prodotti, magazzini, lotti logici, lotti/quantità, movimenti, Bolle/righe, Consegne, Trasferimenti/righe, prenotazioni, operazioni di distribuzione, Scarichi/righe e utenti. I nuovi `rientri_trasporto` e `rientro_trasporto_righe` hanno 0 righe; i movimenti `esito` restano 0. Uploads 0 file, come nell'archivio pre-deploy. API `/api/healthz` e `/api/readyz` rispondono `ok`.

**Pausa prima di WEB e smoke finale:** l'unica impronta diversa è `ruoli`. Il seed del codice M4B.1 ha aggiunto, senza rimuovere permessi, `magazzino.transfers.prepare/cancel` al ruolo `Operatore Magazzino` (ID 4902) e questi due più `mensa.transfers.prepare/cancel` a `SuperAdmin` (ID 974). Tutti gli altri campi/ruoli e gli utenti sono invariati. Il delta coincide esattamente con `permissions.ts` e `seedRoles.ts` della SHA autorizzata; tuttavia il mandato richiede espressamente che i ruoli restino invariati. Non si sono alterati manualmente i permessi. È stata richiesta a Floriano una decisione esplicita prima di riaprire WEB e completare lo smoke.

Stato alla pausa: API M4 ID `82a4c3d6a82b` healthy; PostgreSQL originale ID `57e462be280a` healthy, 42/42, volumi originali; WEB pre-M4 ID `f344ed86a768` ancora fermo. Il container PostgreSQL effimero usato per backup e quello per il confronto ruoli sono stati rimossi; i container one-shot tar sono auto-rimossi. Nessuna risorsa di altri progetti è stata modificata. Smoke WEB/browser, autenticazione e pagine applicative non ancora eseguiti. **Non dichiarare `DEPLOYED-PERSISTENT` né `OK-MAN-M4` a questo punto.** M5 non avviata.

## Ripresa successiva del WEB per UX-CARICO-01

Successivamente Floriano ha richiesto espressamente di ricompilare il Docker
locale per provare il correttivo UX-CARICO-01, ancora nel working tree non
pubblicato. La build Compose ha ricostruito **solo** l'immagine WEB; con
`up -d --no-deps --no-build --force-recreate web` è stato sostituito
esclusivamente `magazzino-web`. Il nuovo WEB ha immagine
`sha256:9f1d9afac8590e9f859d2dd02dfb3265455ec6f4cb7b415cebec7b2b8607ae47`
e container `53d1749ac465d8b57ab75c4b2cee5b3dd7e7a0e14fd69ca0ff1ea4d0abd753cc`;
la vecchia immagine `pre-m4-20260925` è stata conservata per rollback. API
`82a4c3d6a82b` e PostgreSQL `57e462be280a` hanno mantenuto gli stessi ID;
nessun volume o rete è stato ricreato. `/carico-merce`, `/api/readyz` e
`/config.js` hanno risposto HTTP 200, e il bundle WEB conteneva la nuova
etichetta di conferma. Nessun documento di prova è stato creato
automaticamente sul persistente.

Floriano ha poi dichiarato **PASS** del dry run manuale UX-CARICO-01,
registrato in `ESITI_TEST_UX_CARICO_01.md`. La differenza dei permessi di
ruolo annotata sopra non è stata corretta né occultata. Questa ripresa WEB
proveniva dal working tree UX non ancora revisionato al momento del rebuild:
non costituisce deploy formale di una nuova SHA revisionata e non autorizza
`OK-MAN-M4` per l'intera milestone.
