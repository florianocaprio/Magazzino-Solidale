# M0 — Ambiente di test isolato

Data: 9 settembre 2026
Base codice: `787d7c5436d5fa4c0edb24be373d055946d402ce`

## Risorse identificate

| Ruolo               | Container/database                                                              | Rete/volume                                                              | Esposizione        | Stato M0                                 |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------ | ---------------------------------------- |
| sorgente originale  | `magazzino-postgres` / `magazzino`                                              | `magazzino-solidale_default` / `magazzino-solidale_magazzino_pgdata`     | host `5434`        | solo lettura; intatto                    |
| copia popolata      | `magazzino-m0-copy-db` / `magazzino_m0_copy`                                    | `magazzino-m0-net` / `magazzino_m0_copy_pgdata`                          | nessuna porta host | replay e confronto superati              |
| fresh baseline/test | `magazzino-m0-fresh-db` / `magazzino_m0_fresh`, `magazzino_m0_fresh_validation` | `magazzino-m0-net`, `magazzino-m0-app-net` / `magazzino_m0_fresh_pgdata` | `127.0.0.1:55435`  | bootstrap, suite e avvio Docker superati |
| restore durevole    | `magazzino-m0-durable-restore-db` / `magazzino_m0_durable_restore`              | `magazzino-m0-net` / `magazzino_m0_durable_restore_pgdata`               | nessuna porta host | ripristino reale confrontato             |

La sorgente è stata avviata da un Compose nel checkout `/Users/florianocaprio/Documents/Magazzino-Solidale`. Il lavoro M0 si trova invece in `/Users/florianocaprio/Projects/Magazzino-Solidale`. Non usare `docker compose down`, `-v`, prune o comandi globali: il Compose corrente nomina esplicitamente container e volumi e potrebbe colpire la sorgente.

## Segreti e file temporanei

- Directory di lavoro esterna al repository: `/private/tmp/magazzino-m0`.
- Password PostgreSQL M0: file locale `postgres.password`, permessi 0600, mai versionato o stampato.
- Dump: `magazzino-m0-baseline-787d7c5.dump`, custom format, 728 KiB nella prova eseguita.
- SHA-256 del dump verificato: `a8735f915045b70e393d2a0a3590f270d26fc32ee40bb970886f55676a48e255`.

Il dump temporaneo è stato copiato il 9 settembre 2026 alle 22:15 CEST in:

```text
/Users/florianocaprio/.local/share/magazzino-solidale/backups/m0/2026-09-09/magazzino-m0-baseline-787d7c5.dump
```

La destinazione è locale, fuori dal repository e dal percorso iCloud, non è un symlink e usa directory 0700 e file 0600. Sorgente e destinazione misurano 745.717 byte e hanno lo stesso SHA-256 sopra riportato. Il database sorgente è `magazzino` nel container `magazzino-postgres`, PostgreSQL 16.14.

La persistenza locale e i permessi sono verificati; la presenza di cifratura del filesystem e l'inclusione/esclusione da eventuali backup personali restano verifiche del proprietario della macchina. Non inserire dump, password, `.env`, log o dati personali in Git.

## Preflight obbligatorio

Prima di ogni comando con effetti:

```sh
git status --short --branch
git rev-parse HEAD
docker ps -a --filter name=magazzino --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker volume ls --filter name=magazzino --format '{{.Name}}'
docker network ls --filter name=magazzino --format '{{.Name}}'
```

Controllare esplicitamente che i target siano quelli della tabella precedente. Un nome contenente `test` o `m0` non è sufficiente: verificare database corrente, volume, rete e porta.

## Backup sorgente e verifica catalogo

Procedura eseguita, con dump scritto prima nel filesystem temporaneo del container e poi copiato fuori dal repository:

```sh
docker exec magazzino-postgres pg_dump \
  -Fc --no-owner --no-acl \
  -U magazzino -d magazzino \
  -f /tmp/magazzino-m0-baseline-787d7c5.dump

docker exec magazzino-postgres pg_restore \
  --list /tmp/magazzino-m0-baseline-787d7c5.dump

docker cp \
  magazzino-postgres:/tmp/magazzino-m0-baseline-787d7c5.dump \
  /private/tmp/magazzino-m0/magazzino-m0-baseline-787d7c5.dump
```

Il successo di `pg_dump` non è stato considerato sufficiente: il catalogo è stato letto e il dump è stato ripristinato in una nuova destinazione.

## Prova del backup durevole

La copia durevole è stata montata in sola lettura come `/backup/baseline.dump` in un container PostgreSQL nuovo, senza porta host. Prima del restore, `magazzino_m0_durable_restore` aveva zero tabelle applicative. `pg_restore --exit-on-error --no-owner --no-acl` è terminato con codice 0.

Il confronto successivo tra sorgente, prima copia e restore durevole ha verificato:

- identici conteggi delle dieci entità principali e 33 migrazioni;
- identici hash completi di lotti, movimenti, prenotazioni, bolle, trasferimenti, scarichi e carichi;
- inventario `cf=388`, `pz=1079` e 2 prenotazioni attive per 1,01;
- zero orfani nei quattro collegamenti controllati;
- 35/37 movimenti senza autore in tutte le copie, senza attribuzioni artificiali.

## Ripristino copia popolata

La destinazione è stata creata con PostgreSQL 16, credenziale letta da file, rete e volume dedicati. Il ripristino è stato eseguito esclusivamente su `magazzino_m0_copy`:

```sh
docker cp \
  /private/tmp/magazzino-m0/magazzino-m0-baseline-787d7c5.dump \
  magazzino-m0-copy-db:/tmp/baseline.dump

docker exec magazzino-m0-copy-db pg_restore \
  --exit-on-error --no-owner --no-acl \
  -U magazzino_m0 -d magazzino_m0_copy \
  /tmp/baseline.dump
```

Verifiche eseguite su sorgente e copia, sempre con query aggregate:

- 102 tabelle public e 33 migrazioni registrate;
- stessi conteggi per Aree, magazzini, prodotti, lotti, movimenti, prenotazioni, bolle, trasferimenti, scarichi e carichi;
- stesso hash dei dettagli inventariali e stesso hash dei movimenti;
- stessi totali per unità (`cf=388`, `pz=1079`);
- 2 prenotazioni attive, quantità aggregata 1,01;
- zero orfani nei controlli lotto→prodotto, lotto→magazzino, prenotazione→lotto e movimento→prodotto;
- stessa copertura autori: 35 movimenti senza autore, nessuna bolla/trasferimento/scarico senza autore.

Questa verifica certifica la fedeltà del ripristino osservato, non la migrabilità verso lo schema futuro.

## Fresh DB e bootstrap baseline

Prima dell'esecuzione il database `magazzino_m0_fresh` aveva zero tabelle non di sistema. È stato eseguito il comando reale del repository:

```sh
pnpm --filter @workspace/db run test:fresh
```

Il gate ha svolto:

1. rifiuto preventivo di un DB non vuoto;
2. `drizzle-kit push` sul solo DB verificato vuoto;
3. applicazione e registrazione di 33 migrazioni baseline;
4. seed base e SuperAdmin temporaneo;
5. avvio API su porta locale 18080;
6. login, cambio password e CRUD sintetico Area operativa;
7. replay migrazioni, verifica checksum e stato ledger.

Esito: superato, 33 applicate al primo giro, 33 saltate con checksum verificato al replay, zero pendenti/mismatch/out-of-order.

In `##test M0` il percorso è stato ripetuto su `magazzino_m0_fresh_validation`, creato ex novo nello stesso container fresh e verificato con zero tabelle. Con `NODE_ENV=test`, email rimosse e `MAPS_PUBLIC_GEOCODING_ALLOWED=false`, il gate ha nuovamente superato schema push, 33 migrazioni, seed, login, cambio password, CRUD Area, replay, checksum e stato. La modalità Maps registrata in questa esecuzione era `disabled`.

Il `fresh-db-gate` è distinto dall'entrypoint Docker ordinario: il primo rifiuta un database non vuoto, esegue `drizzle-kit push`, update, seed completo e smoke API; l'entrypoint API esegue soltanto gli aggiornamenti incrementali e avvia il server. Sul database già inizializzato, due avvii Docker consecutivi hanno saltato tutte le 33 migrazioni e mantenuto invariati i conteggi seed (`ruoli=9`, `utenti=1`, `ruoli_volontari=4`, `tipi_intervento=8`, `tipologie_fornitore=5`, `politiche_credito_solidale=1`).

### Protezione dagli effetti esterni

Il gate avvia `src/index.ts`, che registra il job giornaliero `schedulePriorityDowngrade` e, per default non-test, consente il geocoding Nominatim pubblico. Nella prova M0 il database era fresh e non sono state invocate route email o geocoding; non risultano chiamate esterne. La modalità Maps esposta nei log era tuttavia `public`.

Per le esecuzioni successive usare un ambiente ripulito esplicitamente:

```sh
env \
  -u MAIL_PROVIDER -u MAIL_HOST -u MAIL_PORT -u MAIL_SECURE \
  -u MAIL_USER -u MAIL_PASSWORD -u MAIL_FROM -u MAIL_REPLY_TO \
  MAPS_PUBLIC_GEOCODING_ALLOWED=false \
  NODE_ENV=test \
  DATABASE_URL="$M0_DATABASE_URL" \
  FRESH_DB_INITIAL_PASSWORD="$M0_INITIAL_PASSWORD" \
  pnpm --filter @workspace/db run test:fresh
```

Il gate non è rieseguibile sullo stesso database ormai inizializzato: deve ricevere una nuova destinazione verificata vuota. Non usare `push` sulla copia popolata.

## Test API sulla destinazione isolata

La suite Vitest API usa direttamente `DATABASE_URL` e non allestisce un DB autonomo. Usare solo un URL composto localmente dalla password temporanea, senza stamparlo:

```sh
M0_DB_PASSWORD="$(tr -d '\n' < /private/tmp/magazzino-m0/postgres.password)"
M0_DATABASE_URL="postgresql://magazzino_m0:${M0_DB_PASSWORD}@127.0.0.1:55435/magazzino_m0_fresh"

DATABASE_URL="$M0_DATABASE_URL" \
  SESSION_SECRET=m0-local-test-only \
  COOKIE_SECURE=false COOKIE_SAMESITE=lax \
  MAPS_PUBLIC_GEOCODING_ALLOWED=false NODE_ENV=test \
  pnpm --filter @workspace/api-server run test
```

Non lanciare la suite senza l'assegnazione esplicita di `DATABASE_URL`. Le fixture usano marker e cleanup, ma ciò non sostituisce l'isolamento fisico del database.

## Isolamento applicativo e prova Docker

Il `docker-compose.yml` baseline contiene `container_name`, porte e volumi espliciti; un diverso nome progetto Compose non basta. In `##test M0` l'ambiente applicativo è stato avviato senza riusare il Compose originale, con risorse nominate esplicitamente:

| Ruolo | Immagine / ID                                                                                          | Container                  | Rete e destinazione                                      | Porta testata     |
| ----- | ------------------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------- | ----------------- |
| API   | `magazzino-m0-api:787d7c5` / `sha256:9fbae7b790898626b822798bd30a00fa3737f17f266294511d131eff75325a1d` | `magazzino-m0-api-787d7c5` | `magazzino-m0-app-net` → `magazzino_m0_fresh_validation` | `127.0.0.1:58080` |
| web   | `magazzino-m0-web:787d7c5` / `sha256:edd3831953faa71434089769902d694f230aa8c3a3ccd3b4abc2d09431e6cd39` | `magazzino-m0-web-787d7c5` | `magazzino-m0-app-net` → alias `api`                     | `127.0.0.1:58082` |

Entrambe le immagini riportano l'etichetta OCI `org.opencontainers.image.revision=787d7c5436d5fa4c0edb24be373d055946d402ce` e sono state costruite senza cache dallo stesso working tree, nel quale il solo contenuto diverso da HEAD erano documenti non usati dai build applicativi.

Configurazione senza segreti registrata: `PORT=8080`, upload sul volume `magazzino_m0_app_uploads`, cookie non secure/lax, nessuna variabile SMTP, geocoding pubblico disabilitato e tile web reindirizzate a un percorso locale inesistente. La password DB è stata letta da un file 0600 montato read-only e non stampata.

API e web sono diventati `healthy`; `/api/healthz` ha risposto 200 sia direttamente sia tramite Nginx, `/` ha risposto 200 e `config.js` ha esposto soltanto il percorso tile locale. Nel browser è comparsa la pagina “Magazzino Solidale AIM” con login renderizzato e nessun errore/warning console.

### Collisione con le porte effimere

Le porte 58080/58082 appartengono all'intervallo effimero del sistema e non devono restare pubblicate durante le suite Supertest. Due run API hanno mostrato rispettivamente un `socket hang up` e una risposta 405 proveniente dal Nginx M0 dentro test in-process; il secondo segnale ha dimostrato la collisione, non un difetto della route. Dopo aver fermato esclusivamente i due container applicativi e verificato le porte libere, lo stesso comando completo ha superato 105 file e 1.142 test, con 2 saltati.

Per prove successive scegliere porte loopback non effimere e comunque non coincidenti con 5434/8082, oppure fermare i container applicativi prima di eseguire Supertest. I due container M0 sono stati lasciati fermi a fine test; database, reti e volumi restano disponibili.

La configurazione di ogni ambiente futuro deve continuare a prevedere:

- nomi container distinti per db/api/web;
- rete e volumi DB/upload distinti;
- porte host legate a `127.0.0.1`, non coincidenti con 5434/8082 e fuori dall'intervallo effimero durante le suite;
- `DATABASE_URL` verso il solo DB M0;
- nessun `.env.docker` operativo ereditato;
- variabili email rimosse e `MAPS_PUBLIC_GEOCODING_ALLOWED=false`;
- immagini web e API costruite dalla stessa SHA;
- healthcheck e ledger verificati prima degli smoke test.

Non è stato aggiunto un secondo Compose al repository: la prova M0 ha usato comandi `docker run` espliciti e risorse isolate. Un file Compose dedicato verrà aggiunto solo se una milestone successiva lo richiederà come artefatto revisionabile.

## Ripristino della coppia codice/database

Un checkout Git non effettua rollback dello schema. Per riprodurre la baseline:

1. verificare la SHA del codice e costruire web/API dalla stessa revisione;
2. creare un nuovo volume DB isolato;
3. ripristinare il dump riferito a quella SHA oppure eseguire il fresh gate della stessa SHA;
4. verificare ledger e checksum;
5. avviare l'API solo dopo aver controllato il suo `DATABASE_URL` e disabilitato effetti esterni;
6. registrare SHA codice, digest immagini, hash dump e revisione ledger.

Mai puntare un vecchio commit applicativo al database originale o a uno schema più nuovo confidando in un rollback automatico.

## Stato e limiti

- Backup logico: **eseguito**, copiato in destinazione durevole locale con permessi restrittivi; cifratura filesystem da verificare manualmente.
- Ripristino copia temporanea e copia durevole: **eseguiti e confrontati**.
- Fresh bootstrap baseline e ripetizione `##test M0`: **eseguiti e superati**.
- Migrazione al futuro schema unificato: **non eseguita**, correttamente fuori da M0.
- Rebuild e avvio Docker completo web/API della stessa SHA: **eseguiti e superati**; container applicativi fermati intenzionalmente dopo gli smoke.
- Prova tablet/fotocamera: **non eseguita**; fuori dalla validazione automatica M0.

## Evidenze post-bootstrap

Sulla destinazione fresh isolata, con email e geocoding pubblico disabilitati, sono stati eseguiti:

- suite API: 105 file, 1.142 test superati e 2 saltati;
- suite frontend: 60 file e 328 test superati;
- runner migrazioni: 10 test superati; suite PostgreSQL opzionale non attivata dal runner unitario;
- verifica finale ledger: 33 migrazioni applicate, nessuna pendente, mismatch o fuori ordine;
- controllo marker sintetici dopo la suite API: nessun prodotto, magazzino o utente di test residuo;
- typecheck monorepo, budget bundle frontend e test della configurazione runtime web: superati;
- build monorepo: fallita senza le variabili obbligatorie della baseline (`PORT`, poi `BASE_PATH`), quindi superata con `PORT=19176`, `BASE_PATH=/` e Maps pubbliche disabilitate.

Il riepilogo API sopra si riferisce al terzo run completo, eseguito dopo aver rimosso la collisione di porte. I due tentativi precedenti sono falliti con 1 test su 1.144, in file diversi; entrambi i casi sono poi passati isolatamente o nel run finale. Non vengono conteggiati come test superati, ma come diagnosi ambientale risolta.

Le suite hanno segnalato una deprecazione `pg` relativa a `client.query()` concorrenti, mentre Vite ha prodotto warning non bloccanti su sourcemap e dimensione chunk. Sono evidenze di baseline da sorvegliare, non errori introdotti da M0.

## M3B — ambiente disposable di sviluppo

Data: 18 settembre 2026
Base codice: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`

Per i soli gate di sviluppo M3B è stato creato un ambiente PostgreSQL isolato, privo di container web/API candidati:

| Risorsa              | Nome                                | Uso                                        | Stato finale |
| -------------------- | ----------------------------------- | ------------------------------------------ | ------------ |
| container PostgreSQL | `magazzino-m3b-dev-db-20260918`     | fresh gate, copia populated e scenario E2E | eliminato    |
| rete                 | `magazzino-m3b-dev-net-20260918`    | isolamento del database M3B                | eliminata    |
| volume PostgreSQL    | `magazzino_m3b_dev_pgdata_20260918` | dati temporanei dei gate M3B               | eliminato    |

Container, rete e volume avevano etichetta `magazzino.milestone=M3B`. Nel container sono esistiti esclusivamente i database temporanei `magazzino_m3b_dev`, `magazzino_m3b_populated_check` e `magazzino_m3b_e2e`.

Il fresh gate ha applicato e verificato 38/38 migrazioni. La copia populated è stata portata dallo stato 37 alla sola migrazione 38, conservando conteggi e hash di lotti e movimenti; il replay ha applicato zero migrazioni. Lo scenario Playwright M3B ha usato il terzo database con fixture sintetiche, senza file FSE+ reali.

Al termine dello sviluppo il container è stato rimosso per nome, quindi sono state rimosse nominativamente la rete e il volume. Il report Playwright temporaneo è stato eliminato dal working tree. Non sono stati usati comandi prune.

La verifica successiva con `docker ps -a`, `docker network ls` e `docker volume ls` non mostra risorse M3B residue. I container originali `magazzino-postgres`, `magazzino-api` e `magazzino-web` sono rimasti attivi e invariati; il volume persistente originale e tutte le risorse degli altri progetti non sono stati toccati.

Non è stato costruito né avviato un ambiente Docker candidato M3B: questa attività appartiene alla successiva fase autorizzata `##test M3B`.

## M3B — ambiente disposable di test e review

Data: 18 settembre 2026

Base codice: `ad76175a360794ceeb36a7024b1933ba5e6b2bba`

La fase `##test M3B` ha usato un solo PostgreSQL temporaneo, senza costruire
container web/API candidati:

| Risorsa              | Nome                                 | Uso                                | Stato finale |
| -------------------- | ------------------------------------ | ---------------------------------- | ------------ |
| container PostgreSQL | `magazzino-m3b-test-db-20260918`     | fresh, populated, suite API ed E2E | eliminato    |
| rete                 | `magazzino-m3b-test-net-20260918`    | isolamento del database            | eliminata    |
| volume               | `magazzino_m3b_test_pgdata_20260918` | dati temporanei                    | eliminato    |

Nel container sono esistiti `magazzino_m3b_test`,
`magazzino_m3b_e2e_test` e `magazzino_m3b_populated_test`. La porta host era
limitata a loopback (`127.0.0.1:55438`). Le risorse riportavano etichette di
milestone/scopo M3B.

Il fresh gate ha usato lo schema push esclusivamente come bootstrap del DB
vuoto, seguito dal runner ufficiale e dalla verifica dei trigger/vincoli; non è
stato considerato un sostituto del runner. La copia populated è stata costruita
con lo schema esatto della base 37 e aggiornata dal runner 37→38 senza schema
push. Conteggi e hash semantici ordinati sono rimasti identici.

I due Excel originali sono rimasti fuori dal repository e sono stati aperti in
sola lettura. Nessuna credenziale, cookie, screenshot, report browser o fixture
temporanea è stata committata.

A fine fase sono stati eliminati nominativamente container, rete e volume,
oltre ai soli script/fixture/report temporanei M3B. Non è stato eseguito alcun
comando prune. Le verifiche finali `docker ps -a`, `docker network ls` e
`docker volume ls` non mostrano risorse disposable M3B residue.

I container protetti `magazzino-postgres`, `magazzino-api` e `magazzino-web`
sono rimasti attivi e invariati; il relativo volume persistente e tutte le
risorse Docker di altri progetti non sono stati arrestati, modificati o
rimossi.

## M4A — separazione sviluppo, test e aggiornamento persistente

Durante `##sviluppo M4A` non viene ricostruito, riavviato o migrato l'ambiente
locale persistente. Eventuali prove DB di sviluppo devono usare un PostgreSQL
temporaneo con nomi/etichette M4A e cleanup nominativo; mai il `DATABASE_URL`
operativo e mai comandi prune.

La futura fase `##test M4A` dovrà registrare container, rete, volume, database,
porta e cleanup, eseguendo fresh/replay e upgrade populated con il runner
ufficiale. Soltanto dopo test, commit/push e code review positiva sarà
autorizzato l'aggiornamento protetto dell'ambiente locale: identificazione del
vero progetto Compose e dei mount, backup verificato di DB/upload, stessa SHA
per web/API, stop delle scritture, rebuild dei soli servizi applicativi e
verifica post-migrazione. Il volume persistente esistente non deve essere
sostituito da un volume vuoto derivato dal nome del checkout.

Per i controlli mirati di sviluppo è stato creato esclusivamente il container
effimero `magazzino-m4a-dev-db-20260919`, immagine `postgres:16`, database
`magazzino_m4a_dev`, porta loopback `55440` ed etichette
`magazzino.milestone=M4A`/`magazzino.scope=development`. Non sono stati creati
rete o volume nominativi, né container web/API. Il container è stato avviato
con `--rm` e rimosso nominativamente al termine; i dati temporanei sono quindi
eliminati con il container. L'ambiente locale persistente e gli altri progetti
Docker non sono stati modificati.

## M4A — fase formale arrestata prima del laboratorio

Data: 19 settembre 2026

Il preflight ha censito in sola lettura i container protetti attivi:

| ID breve       | Nome                 | Immagine                 | Stato osservato                   |
| -------------- | -------------------- | ------------------------ | --------------------------------- |
| `64601804539f` | `magazzino-web`      | `magazzino-solidale-web` | attivo, porta host 8082           |
| `fe52b85bc235` | `magazzino-api`      | `magazzino-solidale-api` | attivo e healthy                  |
| `57e462be280a` | `magazzino-postgres` | `postgres:16-alpine`     | attivo e healthy, porta host 5434 |

Sono stati inoltre osservati, senza modificarli, la rete
`magazzino-solidale_default` e i volumi persistenti
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads`, oltre alle risorse storiche e degli
altri progetti presenti sulla macchina.

La revisione statica e il primo test frontend pertinente hanno prodotto un
NO-GO prima della creazione del laboratorio PostgreSQL. Questa esecuzione non
ha quindi creato container, immagini, reti, volumi, database o processi M4A e
non ha richiesto cleanup Docker. Non sono stati eseguiti Compose, build,
restart, migrazioni o comandi contro il database persistente. Nessun prune o
comando globale è stato usato.

## M4A — laboratorio correttivo post-NO-GO

Data: 19 settembre 2026

Le verifiche mirate della correzione M4A hanno usato un solo PostgreSQL
effimero, separato dall'ambiente persistente. API e frontend E2E sono stati
avviati come processi temporanei contro il laboratorio, non come nuovo stack
Docker candidato.

### Risorse create

| Tipo                 | Nome/identificativo                                     | Immagine/porta                              | Scopo                                           | Stato finale                 |
| -------------------- | ------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| container PostgreSQL | `magazzino-m4a-correction-db-20260919` (`eb741856d882`) | `postgres:16-alpine`, loopback `55441`      | fresh, upgrade, suite DB/API e verifiche finali | rimosso nominativamente      |
| storage PostgreSQL   | `tmpfs` del container                                   | nessun volume nominativo o anonimo durevole | dati disposable della run                       | eliminato con il container   |
| rete                 | rete predefinita Docker, senza rete di progetto M4A     | nessuna rete M4A creata                     | connessione locale al laboratorio               | nessuna risorsa da rimuovere |
| API temporanea       | processo locale sulla porta `18181`                     | porta loopback                              | E2E UI/API/PostgreSQL reale                     | arrestato; porta chiusa      |
| frontend temporaneo  | processo locale sulla porta `4173`                      | porta loopback                              | E2E Playwright desktop                          | arrestato; porta chiusa      |

Nel container sono stati usati database distinti per fresh, upgrade populated,
fresh finale, unit final e correzione finale, inclusi
`magazzino_m4a_correction_final` e i database isolati Mensa/Bolle. I database
Mensa/Bolle sono stati eliminati al termine delle rispettive run; tutti i dati
residui del laboratorio sono stati eliminati con la rimozione del container.
Le connessioni hanno usato esclusivamente la porta loopback 55441 e database
di laboratorio; nessuna credenziale viene registrata in questo documento.

Il fresh conclusivo su `magazzino_m4a_correction_final` ha applicato 40/40
migrazioni e completato seed, smoke, replay e verify. L'upgrade autentico
populated 39→40 era già risultato verde nella fase correttiva ed è mantenuto
come evidenza distinta, senza promuovere G5 a GO formale.

### Protezione dell'ambiente persistente

Prima e dopo le prove sono rimasti attivi e invariati:

| Risorsa protetta     | ID breve osservato | Stato finale                         |
| -------------------- | ------------------ | ------------------------------------ |
| `magazzino-web`      | `64601804539f`     | attivo, non ricostruito né riavviato |
| `magazzino-api`      | `fe52b85bc235`     | attivo, non ricostruito né riavviato |
| `magazzino-postgres` | `57e462be280a`     | attivo, non migrato né modificato    |

I volumi persistenti dell'ambiente originale e le risorse degli altri progetti
non sono stati arrestati, modificati o rimossi. Non sono stati usati
`docker system prune`, `docker volume prune`, `docker network prune`, wildcard
di rimozione, `down -v` o altri comandi globali.

### Cleanup verificato

- il container `magazzino-m4a-correction-db-20260919` è stato rimosso
  nominativamente;
- il filtro dei container M4A non restituisce residui;
- non esistono reti o volumi con label M4A creati da questa run;
- le porte temporanee 18181 e 4173 risultano chiuse;
- PDF e render temporanei, i due file hash e
  `artifacts/magazzino-solidale/test-results/playwright` sono stati rimossi e
  la loro assenza è stata verificata;
- le tre risorse persistenti protette risultano ancora attive con gli stessi
  ID brevi.

La pulizia riguarda esclusivamente risorse disposable della correzione M4A.
Non è stato costruito o aggiornato alcun Docker candidato o persistente. Lo
stato applicativo resta
`DEV-M4A-CORRETTO/NE-TEST-M4A/NE-MAN`: questa pulizia non costituisce un gate
formale, una validazione manuale o la chiusura della milestone.

## M4A — laboratorio del rerun formale finale

Data: 22 settembre 2026. Tutte le prove PostgreSQL finali hanno usato solo
container disposable M4A, con storage `tmpfs`, porta bindata a
`127.0.0.1`, rete Docker `bridge` preesistente e nessun volume nominativo o
rete di progetto creata. API e frontend Playwright erano processi locali
temporanei sulle porte 18181/4173; una breve API di setup usava 18182.

| Risorsa creata durante M4A            | ID breve / porta                                                                                                                                  | Uso                                                         | Stato finale                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------- |
| `magazzino-m4a-finaltest-db-20260919` | `1d5248f43d33`, 55442                                                                                                                             | fresh, suite API, upgrade populated 39→40 e prime prove E2E | rimosso nominativamente       |
| `magazzino-m4a-rerun-db-20260922`     | `10ec42fae621`, 55443                                                                                                                             | riproduzioni E2E e tre run completi su database distinti    | rimosso nominativamente       |
| `magazzino-m4a-final-api-20260922`    | `8d5e80a58240`, 55444                                                                                                                             | fresh e suite API completa post-formattazione               | rimosso nominativamente       |
| Database del primo container          | `magazzino_m4a_final_fresh`, `magazzino_m4a_final_api`, `magazzino_m4a_final_e2e`, `magazzino_m4a_final_upgrade`, `magazzino_m4a_final_e2e_clean` | isolati per scopo                                           | eliminati con tmpfs/container |
| Database del secondo container        | `magazzino_m4a_rerun`, `magazzino_m4a_final_e2e_clean`, `magazzino_m4a_final_e2e_round2`, `magazzino_m4a_final_e2e_round3`                        | regressioni e candidate finali puliti                       | eliminati con tmpfs/container |
| Database del terzo container          | `magazzino_m4a_api_final`, `magazzino_m4a_api_final2`, `magazzino_m4a_api_final3`                                                                 | fresh e run API distinti                                    | eliminati con tmpfs/container |
| Reti/volumi M4A dedicati              | nessuno                                                                                                                                           | non creati                                                  | nessun cleanup richiesto      |

I tre nomi/ID erano gli unici container con label
`magazzino.milestone=M4A` nei rispettivi controlli pre-cleanup. Sono stati rimossi con
`docker rm -f` nominativo, non con `prune`; non sono stati toccati l'anonimo
volume di altri ambienti, le reti storiche o risorse di altri progetti.
Eliminati inoltre i soli output temporanei di questa prova: archive base 39,
fixture/digest SQL, sette PDF e render, cache Fontconfig di test, output
Playwright. Non sono stati eliminati file del repository, backup durevoli o i
due XLSX originali dell'utente.

La verifica finale `docker ps -a`, `docker network ls` e `docker volume ls`
mostra nessun container/rete/volume disposable M4A residuo. Le porte 18083,
18084, 18085, 18181, 18182, 4173, 55442, 55443 e 55444 non hanno listener.
L'ambiente originale è rimasto
attivo con gli stessi ID (`magazzino-web` `64601804539f`, `magazzino-api`
`fe52b85bc235`, `magazzino-postgres` `57e462be280a`) e con i volumi
persistenti `magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` invariati. Nessun rebuild, restart,
Compose, migrazione o push schema ha interessato l'ambiente persistente.

## M4A — laboratorio disposable dell'hardening post-code-review

Data: 23 settembre 2026. Sono stati creati esclusivamente tre container
PostgreSQL disposable, in sequenza. Il primo,
`magazzino-m4a-hardening-db-20260923` (ID
`42074bbb4463fbe70418c0e59908c48495778401728a5354c89aa661642ac3ce`,
label `magazzino.milestone=M4A-hardening`, immagine `postgres:16-alpine`),
era esposto solo su `127.0.0.1:55445`. I dati erano su `tmpfs`; l'ispezione
pre-cleanup mostrava `Mounts=[]`. Sono stati usati i due database temporanei
`magazzino_m4a_hardening` e `magazzino_m4a_hardening_rerun`: il primo per il
tentativo iniziale e il secondo per il rerun dopo la correzione delle fixture.
Il secondo, `magazzino-m4a-hardening-verify-db-20260923` (ID
`4f5990759515a8872bb0aa11304a7ec6520deab7d70d7d3fbb2b9386167965ae`,
stessa label/immagine, `tmpfs`, `Mounts=[]`), era esposto solo su
`127.0.0.1:55446` e ha ospitato il database
`magazzino_m4a_hardening_verify` per il test finale dello scope
transazionale. Il terzo, `magazzino-m4a-hardening-scope-db-20260923` (ID
`041503cd6bad2d3ba596b3aa203f0f4a889176ba534ee9620668d9f10279efaa`,
stessa label/immagine, `tmpfs`, `Mounts=[]`), era esposto solo su
`127.0.0.1:55447` e ha ospitato `magazzino_m4a_hardening_scope` per la
prova fail-closed UDS senza Area. Il bootstrap `drizzle push` è stato applicato **solo** a
questi database freschi e disposable, seguito dalle 40 migrazioni e dal seed
di test. Nessun database operativo o popolato è stato sottoposto a `push`.

I container sono stati rimossi nominativamente con `docker rm -f` sui tre
nomi esatti dopo verifica di nome/label; i `tmpfs` e i quattro database sono stati
eliminati con essi. Nessuna rete o volume Docker dedicato
è stato creato; è stata usata la rete `bridge` preesistente. La verifica
finale `docker ps -a`, `docker network ls`, `docker volume ls` non mostra
risorse disposable M4A residue. Nessun prune o comando globale è stato usato.

`magazzino-web` (`64601804539f`), `magazzino-api` (`fe52b85bc235`) e
`magazzino-postgres` (`57e462be280a`) sono rimasti attivi con gli stessi ID,
senza rebuild, restart, migrazioni o scritture sul loro database. I volumi
persistenti `magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads`, così come le risorse degli altri
progetti, sono rimasti invariati.

## M4A — rerun formale post-code-review hardening

Data: 23 settembre 2026. È stato creato **un solo** container PostgreSQL
disposable: `magazzino-m4a-formal-db-20260923`, ID
`e7148cc96597bada3d2f58939680a44eccc1e8e8ed32641a9559292fab9d75b4`,
immagine `postgres:16-alpine`, label
`magazzino.milestone=M4A-formal-postreview`, porta solo
`127.0.0.1:55448`, dati in `tmpfs`. L'ispezione prima della rimozione
confermava `Mounts=[]` e rete `bridge` preesistente. Non sono stati creati
volumi o reti Docker M4A.

| Database nel container         | Scopo                                               | Destino                          |
| ------------------------------ | --------------------------------------------------- | -------------------------------- |
| `magazzino_m4a_formal_fresh`   | schema vuoto, 40 migrazioni, seed/smoke/replay      | eliminato con il container/tmpfs |
| `magazzino_m4a_formal_api`     | copie pulite per la suite API completa              | eliminato con il container/tmpfs |
| `magazzino_m4a_formal_e2e`     | copie pulite con seed demo ufficiale per Playwright | eliminato con il container/tmpfs |
| `magazzino_m4a_formal_upgrade` | upgrade popolato autentico M3/39 → M4A/40 e replay  | eliminato con il container/tmpfs |

Il bootstrap `drizzle push` è stato usato soltanto sul database **vuoto**
fresh. L'upgrade popolato è passato esclusivamente dal runner ufficiale:
39 migrazioni preesistenti riconosciute, solo la 40 applicata; al controllo
finale 40 record nel ledger, 9 partite, 8 movimenti, 1 Bolla e 1
Trasferimento, come nelle fixture precedenti. Nessun `push` sul popolato.
API ed E2E avevano database separati; il runner migrazioni ha creato e
rimosso i propri database interni sullo stesso PostgreSQL temporaneo.

Gli output locali della fase, tutti eliminati nominativamente dopo le
prove, erano:

- `/private/tmp/magazzino-m4a-native-20260923` (binding macOS per
  Lightning CSS/Tailwind usati solo dalla toolchain locale);
- `/private/tmp/magazzino-m4a-upgrade.sBGv85` (archive read-only della base
  M3 per la prova 39→40);
- `/private/tmp/magazzino-m4a-pdf-20260923`,
  `/private/tmp/magazzino-m4a-pdf-render-20260923` e
  `/private/tmp/magazzino-m4a-fontcache-20260923` (sette PDF reali, render e
  cache di ispezione);
- `artifacts/magazzino-solidale/test-results/playwright/.last-run.json`
  (output ignorato e non tracciato, con directory vuote rimosse).

I processi temporanei API/Vite di Playwright sulle porte 18181/4173 sono
terminati; dopo un'interruzione diagnostica sono stati fermati
nominativamente i soli PID identificati sulle due porte. Il container è
stato rimosso con `docker rm -f magazzino-m4a-formal-db-20260923`; nessun
`prune`, `down -v` o comando globale è stato eseguito. `docker ps -a`,
`docker network ls`, `docker volume ls`, la ricerca dei tmp M4A e il
controllo delle porte 18181/4173/55448 non mostrano risorse residue di
questa run.

I container originali `magazzino-web` (`64601804539f`), `magazzino-api`
(`fe52b85bc235`) e `magazzino-postgres` (`57e462be280a`) sono ancora
attivi con gli stessi ID. I volumi persistenti
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono ancora presenti e invariati.
Nessun altro progetto Docker è stato modificato; nessun Docker locale
persistente è stato ricostruito o migrato.
