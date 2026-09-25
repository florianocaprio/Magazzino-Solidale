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

## M4A — aggiornamento ambiente locale persistente

Data: 23 settembre 2026. Candidato approvato
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e` su
`codex/magazzino-workflow-unificato`; HEAD locale/remoto coincidenti e
working tree pulito prima della build. `main` locale e remoto non modificati.

### Preflight e backup, prima dell'upgrade

Il progetto Compose effettivo è `magazzino-solidale`, rete
`magazzino-solidale_default`. Le label mostrano che `magazzino-postgres`
proviene storicamente da
`/Users/florianocaprio/Documents/Magazzino-Solidale/docker-compose.yml`,
mentre `magazzino-api` e `magazzino-web` usano
`/Users/florianocaprio/Projects/Magazzino-Solidale/docker-compose.yml`.
Il Compose risolto dal checkout di sviluppo conserva i servizi `db/api/web`,
il DB `db:5432/magazzino`, la porta web 8082, i nomi dei volumi e il
progetto. Nessun `.env.docker` o segreto è stato stampato.

| Risorsa    | Container iniziale | Immagine iniziale                                                         | Dato da preservare                                                          |
| ---------- | ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| PostgreSQL | `57e462be280a`     | `sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777` | `magazzino-solidale_magazzino_pgdata` montato su `/var/lib/postgresql/data` |
| API        | `fe52b85bc235`     | `sha256:ba0675f6be38f3b3dcd23657db1ee42e1f324adf128fc3e0c8dd376bccb51e49` | `magazzino-solidale_magazzino_uploads` montato su `/app/uploads`            |
| Web        | `64601804539f`     | `sha256:fc839965c1bfef3d4cd91cce44d9ea7c1763d7bb705a9090734c4a8ed2e1be23` | porta 8082 invariata                                                        |

PostgreSQL 16.14, database `magazzino` di 33.315.863 byte. Ledger ufficiale:
39/39 applicate, 0 pending/mismatch/out-of-order, ultima
`20260918_za_m3b_fse_identity_aliases.sql`. Conteggi iniziali:
prodotti 10, lotti 13, lotti logici 4, movimenti 37, prenotazioni 6,
Bolle 25, Trasferimenti 3, Scarichi 10, carichi Magazzino 2, pratiche
Carico 0, audit eventi 0, utenti 7. Residuo per unità: `cf` 388 su due
partite; `pz` 1079 su undici. Gli aggregati per codice prodotto × codice
magazzino sono stati rilevati senza dati personali per il confronto
post-migrazione. Upload: 0 file prima e dopo la copia.

Backup durevoli fuori Git, nella directory `0700`
`/Users/florianocaprio/.local/share/magazzino-solidale/backups/m4a/2026-09-23T0939-Rome/`:

| Backup                                                            | Dimensione   | SHA-256                                                            | Verifica                                                   |
| ----------------------------------------------------------------- | ------------ | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `magazzino-pre-m4a.dump` (`pg_dump -Fc`)                          | 859.192 byte | `df954392a3f6ce6d0d818c0b2f4ebac2ef8adc24c24987924e95d8e54f151272` | `pg_restore --list` riuscito, 1.555 voci                   |
| `magazzino-pre-m4a-frozen.dump` (`pg_dump -Fc` dopo stop API/web) | 859.192 byte | `75052267e9696eed2a608e1228f8e946ccbefe19024444399c06982b3ef26bd3` | `pg_restore --list` riuscito; backup canonico per rollback |
| `uploads-pre-m4a.tar`                                             | 10.240 byte  | `5821adbea2f96642570df9a33bed91da835d523c0a741e6d6b953c48a39784dc` | `tar -tf` riuscito, sola directory vuota                   |

I tre file sono `0600`. Nessun backup è in Git o in una directory
temporanea. Nessun volume è stato modificato dal processo di copia.
Con API/web fermati e PostgreSQL ancora attivo, il vettore pre-migrazione
definitivo (prodotti, lotti, lotti logici, movimenti, prenotazioni, Bolle,
Trasferimenti, Scarichi, carichi, pratiche, audit, utenti, somma residui) è
`10|13|4|37|6|25|3|10|2|0|0|7|1467.000000`; l'impronta MD5 degli
aggregati anonimi prodotto × magazzino è
`5b9daf369ae304c49a5fcc22ce4d1d76`.

### Piano di rollback definito prima della migrazione

Conservare le immagini API/web precedenti mediante tag di sicurezza prima
di sostituire i tag Compose. Se la migrazione o lo smoke falliscono:

1. fermare soltanto API/web nuovi; lasciare PostgreSQL e i volumi integri;
2. non tentare un downgrade automatico dello schema;
3. verificare dump, hash, identità del DB e stato del ledger; provare il
   ripristino su destinazione isolata/controllata prima di valutare un
   ripristino sul DB persistente;
4. se un ripristino persistente è indispensabile, confermare il bersaglio
   esatto e ripristinare il dump pre-M4A; ripristinare l'archivio upload
   soltanto se il volume fosse cambiato;
5. riavviare le immagini precedenti solo con database compatibile, quindi
   verificare health, ledger, conteggi e stock.

Nessuna vecchia immagine verrà cancellata prima della conclusione della
validazione manuale. Le due nuove immagini sono state costruite dal checkout
pulito alla SHA approvata e identificate dalla label OCI
`org.opencontainers.image.revision=329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e`:
API `sha256:cfa6c84dd0172c55c33e9e107b5ba59d13a8583f3a7e33767a5b29665ad60df1`,
web `sha256:7b9fe75ea2e20df4a77544641d92e5c040b01ec062697978363c804d24726a7e`.
La build non ha arrestato il DB né ricreato container o volumi.

### Esito dell'upgrade: NO-GO e rollback applicativo

Dopo avere fermato soltanto web e API, il DB è rimasto healthy con ID
`57e462be280a`. Il dump definitivo `magazzino-pre-m4a-frozen.dump` è
stato creato e verificato con le scritture applicative congelate. I tag
operativi Compose sono stati temporaneamente associati alle immagini M4A;
le immagini vecchie sono state conservate come
`magazzino-solidale-api:pre-m4a-20260923` e
`magazzino-solidale-web:pre-m4a-20260923`. Una simulazione Compose
`--dry-run --no-deps --no-build --force-recreate api` coinvolgeva solo API.

La ricreazione della sola nuova API ha avviato il runner incrementale:
39 file già applicati verificati, **solo migrazione 40 pendente**. La
migrazione `20260919_m4a_documenti_destinatari.sql` è fallita con SQLSTATE
`23505` nel creare l'indice univoco `bolle_consegna_attiva_unique`.
Controesempio reale, limitato a ID e stati: le Bolle `3093` e `3094`, entrambe
`consegnato`, condividono `consegna_id=3868`. Nessun record è stato
cancellato, modificato o riclassificato. Il restart automatico ha prodotto
cinque tentativi FAILED (run 60–64, 0 migrazioni applicate), poi l'API M4A
è stata fermata. **Il web M4A non è stato avviato.**

La migrazione è risultata transazionale: il ledger è rimasto a 39, non
esistono `enti_destinatari`, `comandi_operativi`, l'indice fallito o la
colonna `bolle.tipo_destinatario`. Il vettore di entità/stock dopo il
fallimento è identico al pre-upgrade:
`10|13|4|37|6|25|3|10|2|0|0|7|1467.000000`. L'impronta degli aggregati
prodotto × magazzino resta `5b9daf369ae304c49a5fcc22ce4d1d76`.
Solo il metadata di esecuzione del runner registra i tentativi falliti.
Non è stato necessario ripristinare il dump sul DB persistente; entrambi
i backup durevoli restano conservati.

Per rendere di nuovo disponibile l'ambiente, i tag Compose `latest` sono
stati riportati alle immagini precedenti e la sola API precedente è stata
ricreata (`1efee1d55dd0`, immagine
`sha256:ba0675f6be38f3b3dcd23657db1ee42e1f324adf128fc3e0c8dd376bccb51e49`).
Il runner precedente ha confermato 39/39, 0 pending/mismatch/out-of-order
(run 65 SUCCESS). È stato poi riavviato il **vecchio** container web
`64601804539f` con la sua immagine originale
`sha256:fc839965c1bfef3d4cd91cce44d9ea7c1763d7bb705a9090734c4a8ed2e1be23`.
PostgreSQL conserva ID e volume originali; l'API conserva il volume upload
originale, ancora con 0 file. I tre container sono attivi, API/DB healthy;
via porta persistente 8082, `/api/healthz`, `/api/readyz`, `/login` e
`/config.js` hanno risposto HTTP 200. Il vettore e l'impronta stock sono
stati confermati ancora identici dopo il rollback.

Sono state create due nuove **immagini**, conservate con tag
`m4a-329ae3a` per diagnosi futura, ma nessun container candidato M4A è
rimasto in esecuzione, nessuna nuova rete/volume/stack permanente è stata
creata e nessun altro progetto Docker è stato toccato. Le vecchie immagini
restano disponibili per rollback; nessun prune o comando globale.

**Stato:** M4A non installato sul Docker persistente; ambiente precedente
operativo e protetto. Il conflitto fra il nuovo vincolo e i dati legacy
richiede una decisione/correzione M4A separata e nuova validazione prima di
ritentare l'upgrade. Nessuna validazione manuale M4A è stata dichiarata.

### Retry `##db-cleanup + docker M4A`: NO-GO prima della cancellazione

Il 23 settembre 2026 Floriano ha autorizzato la cancellazione **mirata** dei
documenti legacy incompatibili, mantenendo però invariati `movimenti`, audit
append-only e stock. HEAD locale/remoto: `329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e`.
Il backup frozen è stato riletto e verificato: 859.192 byte, SHA-256
`75052267e9696eed2a608e1228f8e946ccbefe19024444399c06982b3ef26bd3`,
`pg_restore --list` riuscito. Il backup upload conserva SHA-256
`5821adbea2f96642570df9a33bed91da835d523c0a741e6d6b953c48a39784dc`.
Nessuno dei due è stato sovrascritto.

Il dump è stato ripristinato in un unico PostgreSQL disposable
`magazzino-m4a-legacy-cleanup-test-20260923`, con storage `tmpfs`, nessun
volume e porta `127.0.0.1:15434`. Il censimento sul clone ha trovato una sola
collisione: `consegna_id=3868 → {3093,3094}`. Entrambe le Bolle sono
`consegnato` e hanno movimenti fisici: la 3093 ha righe 1929/1930 e movimenti
2294/2295 (1 cf + 1 pz); la 3094 ha riga 1931 e movimento 2296 (4 cf).
Non ci sono prenotazioni né interventi collegati alle due Bolle; `spese_emporio`
43/44 e `spese_emporio_righe` 29/30/31 le referenziano rispettivamente.

Il catalogo PostgreSQL ha rilevato otto FK verso `bolle`/`bolla_righe`:
da `bolla_righe`, `interventi`, `prenotazioni_magazzino`, `spese_emporio`,
`spese_emporio_righe` e, decisivamente, **due da `movimenti`**. Le FK
`movimenti.bolla_id → bolle.id` e
`movimenti.bolla_riga_id → bolla_righe.id` sono entrambe `ON DELETE RESTRICT`.
Anche applicando la regola di keeper 3093, l'eliminazione della 3094 e della
sua riga 1931 richiederebbe cancellare o aggiornare il movimento 2296. Ciò
viola il vincolo esplicito di conservare il ledger fisico. Inoltre la 3094
non è una copia senza effetti: registra uno scarico reale di 4 cf. La regola
del prompt impone in questo caso di **fermarsi prima del DB reale**.

Nessuna `DELETE`, migrazione 40 o ricreazione API/web è stata eseguita, neppure
sul clone. Il clone `8eda34614904` è stato rimosso nominativamente; il suo
`tmpfs` è sparito con il container. Nessuna rete o volume Docker è stato
creato. Il DB persistente resta a 25 Bolle, 37 movimenti, 1.467 unità di
residuo e due Bolle attive per la Consegna 3868; DB/API/web e i volumi
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono rimasti in funzione e invariati.
Le immagini M4A costruite dalla SHA approvata restano non operative.

**Stato:** NO-GO per il cleanup prescritto e per l'upgrade M4A; serve una
nuova decisione esplicita che concili eliminazione del duplicato e integrità
referenziale/storica del movimento 2296. M4A non è `READY-MANUAL` né validato
manualmente; M4B non è iniziata.

### Reset autorizzato dello storico Bolle/Consegne e installazione M4A

Il 23 settembre 2026 Floriano ha autorizzato un **nuovo perimetro distruttivo**
del solo database locale: eliminare tutto lo storico Bolle/Consegne e le
dipendenze documentali, inclusi i movimenti inventariali delle Bolle, ma
preservare integralmente lotti, stock corrente e domini indipendenti. Questa
decisione supera il NO-GO del cleanup puntuale sopra; non lo cancella dalla
storia. Branch/HEAD locale e remoto restano
`codex/magazzino-workflow-unificato` /
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e`.

Il backup frozen DB originale è stato verificato nuovamente: 859.192 byte,
SHA-256 `75052267e9696eed2a608e1228f8e946ccbefe19024444399c06982b3ef26bd3`
e `pg_restore --list` riuscito. Il backup upload mantiene SHA-256
`5821adbea2f96642570df9a33bed91da835d523c0a741e6d6b953c48a39784dc`.
Con API/web fermati è stato aggiunto, senza sovrascrivere i precedenti, il
backup supplementare `magazzino-pre-domain-reset-frozen.dump` (865.906 byte,
SHA-256 `eadcc7cd0449eaf6df6ce01eb4dfc3fb266108d7247d37ef3a1b33ebe579f421`,
permessi `0600`, `pg_restore --list` riuscito) nella stessa directory durevole.

#### Grafo e classificazione

Il catalogo PostgreSQL mostra FK da `movimenti`, `prenotazioni_magazzino`,
`interventi`, `spese_emporio` e `spese_emporio_righe` verso Bolle/righe; da
`sessioni_cassa_emporio`, `spese_emporio` e `turni_consegne` verso Consegne;
ulteriori FK da righe e storni verso sessioni/spese/Scarichi e da FSE/Carico
verso `movimenti`. I riferimenti effettivi FSE/Carico/Mensa ai record da
eliminare erano zero. Non sono stati disabilitati FK o trigger.

- **DELETE:** 25 Bolle, 24 righe, 391 Consegne, 6 prenotazioni, 11 Interventi
  `pacco_alimentare` legati solo a Bolle, 9 Spese Emporio e 12 righe, 15
  sessioni cassa Emporio e 15 righe, 9 Scarichi Emporio e 12 righe, 21
  movimenti inventariali Bolla, 9 movimenti credito solidale con
  `riferimento_tipo=spesa_emporio`; turni e storni dipendenti erano zero.
- **KEEP:** 16 movimenti inventariali indipendenti, lo Scarico `deteriorata`,
  prodotti, magazzini, lotti fisici/logici, Carichi, pratiche, import
  AGEA/FSE, Trasferimenti, utenti, beneficiari (inclusi i saldi correnti),
  audit append-only (zero eventi preesistenti).
- **REVIEW risolti sul clone:** Scarichi/sessioni/credito Emporio avevano
  riferimenti anche non-FK alle Spese; sono stati classificati nel dominio
  storico cancellato. La rimozione dei 9 movimenti di credito **non** ha
  ricalcolato né cambiato i saldi correnti dei beneficiari; lo storico del
  credito relativo a quelle Spese non è più consultabile. Nessuna dipendenza
  ancora ambigua verso stock, Carichi, FSE o Trasferimenti è rimasta.

#### Prova sul clone

Unico PostgreSQL disposable `magazzino-m4a-domain-reset-test-20260923` su
`tmpfs`, porta `127.0.0.1:15435`, senza volume: dump frozen ripristinato,
39 migrazioni, 25 Bolle, 391 Consegne, 37 movimenti, collisione 3868 e
stock 1.079 pz / 388 cf confermati. Un unico script SQL esplicito,
transazionale e con pre/post-assert ha cancellato esattamente i record
elencati sopra. Digest delle righe complete nelle tabelle KEEP, dei
movimenti/Interventi/Scarichi indipendenti e di ogni aggregato
Magazzino × Prodotto × unità/lotto sono rimasti identici. Dopo il commit:
0 Bolle, 0 righe, 0 Consegne, 16 movimenti, 13 lotti, stock invariato.

Il runner ufficiale ha applicato solo
`20260919_m4a_documenti_destinatari.sql` (39→40); verify e status: 40/40,
0 pending/mismatch/out-of-order; replay: 0 migrazioni. L'indice
`bolle_consegna_attiva_unique` esiste. L'API M4A temporanea sul clone ha
risposto 200 a `/api/healthz` e `/api/readyz`. I tre file di test mirati
M4A/documenti, ritiro Bolla e Trasferimenti hanno dato **53/53 test verdi**;
al termine le fixture sono state rimosse (0 Bolle/Consegne, stock invariato).
Un'ulteriore prova SQL in transazione, poi rollbackata, ha confermato il
rifiuto della seconda Bolla attiva per una Consegna e la nuova preparazione
dopo l'annullamento della prima.

Un primo comando con separatore `--` ha avviato erroneamente la suite API
completa; è stato interrotto dopo un failure non pertinente ai tre file
mirati. Il clone, contaminato dalle fixture della suite interrotta, è stato
riportato **nello stesso container** al dump frozen e ha ripetuto con esito
verde reset, migrazione e test filtrati correttamente. Nessun dato del DB
reale è stato coinvolto da quel run. API temporanea e clone sono stati
rimossi nominativamente; nessun nuovo volume o rete permanente.

#### Applicazione persistente

Pre-reset, con `magazzino-web` e `magazzino-api` fermati e
`magazzino-postgres` (`57e462be280a`) attivo, conteggi, IDs 3093/3094,
movimento 2296 e stock coincidevano con il clone. Ledger ancora 39/40.
Lo **stesso script SQL** validato sul clone è stato eseguito e committato
senza errori sul database persistente. Numeri cancellati per tabella sono
quelli della lista DELETE; 0 Bolle/righe/Consegne, 16 movimenti e 13 lotti
subito dopo il reset, con stock ancora 1.079 pz / 388 cf. Gli assert
interni hanno verificato digest invariati di lotti, Catalogo, Magazzini,
Carichi, pratiche, import, Trasferimenti, utenti, beneficiari, audit e
record indipendenti.

L'immagine API `m4a-329ae3a`
(`sha256:cfa6c84dd0172c55c33e9e107b5ba59d13a8583f3a7e33767a5b29665ad60df1`)
e l'immagine web `m4a-329ae3a`
(`sha256:7b9fe75ea2e20df4a77544641d92e5c040b01ec062697978363c804d24726a7e`)
portano entrambe la label OCI della SHA approvata. È stata ricreata prima
solo l'API (`2beebbad6c21`, healthy): applicata soltanto migrazione 40,
status/verify 40/40, 0 pending/mismatch/out-of-order, indice univoco
presente. Poi è stato ricreato solo il web (`f344ed86a768`). PostgreSQL,
rete Compose, volumi `magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` non sono stati ricreati.

Via porta persistente 8082, `/api/healthz`, `/api/readyz`, `/login`,
`/config.js`, `/bolle`, `/consegne`, `/giacenze`, `/carico-merce` e
`/trasferimenti` hanno risposto HTTP 200. Il controllo di login con utente
esistente e dei dati nelle viste autenticate resta **non eseguito**: nessuna
credenziale è stata usata; la prova visiva browser era impedita dal Mac
bloccato. Sono quindi confermati upgrade, API e reachability web, ma non
ancora il dry run manuale. Nessuna operazione inventariale reale è stata
finalizzata per prova.

### M4A — validazione manuale e chiusura dell'ambiente

Floriano ha poi comunicato esito **PASS** («validazione manuale PERFETTA»)
della validazione funzionale sull'applicazione locale installata alla SHA
`329ae3ad4f367f8d1a1a70c1bd90970c7ce7e80e`. L'ambiente è operativo e
utilizzabile, senza blocker M4A residui segnalati. Questo supera
cronologicamente il precedente stato `NE-MAN` senza cancellare le diagnosi,
i NO-GO o i limiti di smoke registrati sopra. Non sono attribuite a Floriano
prove puntuali non documentate.

Nel post-installazione è stata segnalata una schermata bianca su
`http://localhost:8082/`: container web/API e `index.html` erano serviti
correttamente, il bundle corrente era disponibile, mentre il browser
`localhost` richiedeva un vecchio bundle JS cacheato. L'accesso tramite
`127.0.0.1` funzionava; la pulizia dei dati/cache del sito `localhost` ha
risolto completamente. Classificazione: **cache browser locale post-deploy**,
risolta senza patch software, modifica a `nginx.conf` o hotfix.

DB persistente a 40/40 migrazioni, Bolle/Consegne legacy zero, stock
1.079 pz e 388 cf, volumi originali e backup frozen/supplementare
conservati. L'installazione e la validazione manuale M4A sono completate:
**`OK-M4A/OK-MAN-M4A` — M4A CHIUSA**. Fotocamera reale e tablet fisico
restano `NE-MAN-CAMERA` e `NE-MAN-TABLET`, opzionali e non bloccanti; M4B
non è iniziata.

### M4B.1 — laboratorio isolato di sviluppo (non validazione formale)

Il solo Docker creato per lo sviluppo M4B.1 è stato il container
`magazzino-m4b1-test-db-20260923` (PostgreSQL 16 Alpine, ID
`8f4e52c59859`, porta locale `127.0.0.1:55441`, dati su `tmpfs`,
`--rm`). Nessuna rete o volume Docker M4B.1 dedicato è stato creato.
Nel container sono stati usati database temporanei `m4b1lab`,
`m4b1gate`, `m4b1gate2`, `m4b1suite` e `m4b1final`; sono scomparsi
insieme al container. Il bootstrap su database vuoto con schema corrente,
runner ufficiale 1–41 e verify è passato (41 applicate, 0 pending).

Le prove mirate M4B.1/Bolle hanno dato 58/58 e la suite API seriale sul
database nuovo `m4b1final` 117 file verdi, 1323 test superati e 4 skipped.
Una corsa precedente su database già riutilizzato ha avuto un fallimento
404/409 in un test Interventi storico; quel file è poi passato isolato
(24/24) e nell'intera suite su `m4b1final`. Frontend 411/411, typecheck
e build API verdi. La build workspace su macOS non è completabile con la
configurazione preesistente: il lockfile esclude il pacchetto nativo
`lightningcss-darwin-arm64` necessario al mockup sandbox. Questo limite
non è stato aggirato modificando le dipendenze fuori dal perimetro M4B.1.

Il container effimero è stato fermato nominativamente e rimosso da
`--rm`; la verifica `docker ps -a` non mostra risorse M4B.1 residue. I
container persistenti `magazzino-postgres` (`57e462be280a`),
`magazzino-api` (`2beebbad6c21`) e `magazzino-web` (`f344ed86a768`)
sono rimasti attivi con gli stessi ID; i volumi persistenti
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono rimasti presenti. Nessun
Docker persistente è stato aggiornato e nessuna risorsa di altri progetti
è stata toccata. Restano alla fase `##test M4B.1` la prova populated
40→41, il gate formale e le verifiche manuali.

### M4B.1 — laboratorio della validazione formale (separato dallo sviluppo)

Il target è stato verificato prima di seed, migrazioni e test: PostgreSQL
16 Alpine effimero `magazzino-m4b1-formal-db-20260923`, porta locale
`127.0.0.1:55449`, dati su `tmpfs`, `--rm`, etichetta
`magazzino.milestone=M4B1-formal`. Database distinti `m4b1_api`,
`m4b1_api_final`, `m4b1_api_publish`, `m4b1_e2e`, `m4b1_fresh` e
`m4b1_upgrade`; il runner
crea/distrugge i propri DB. La password e le credenziali di test sono
sintetiche e non appartengono all'ambiente originale. Nessuna rete Docker
o volume nominato è stata creata.

La base M4A è stata estratta con `git archive` in
`/private/tmp/m4b1-baseline-sxJNXZ`, con dipendenze indipendenti: lo schema
e il runner della base hanno generato il popolato 40/40 prima dell'upgrade
reale alla migrazione 41. Il candidato Linux è una copia in
`/private/tmp/m4b1-linux-Jt7evk/candidate` da manifest Git tracked e
untracked, esclusi `.env`, segreti, `node_modules` macOS e artefatti; hash
aggregato sorgente/copia verificato prima della build. Su quella copia sono
stati usati container `node:24-slim` e Playwright
`mcr.microsoft.com/playwright:v1.62.1-noble`, sempre `--platform linux/amd64`
e `--rm`, con nomi `magazzino-m4b1-*` specifici. Nessuna immagine/tag del
persistente è stata ricostruita, sostituita o usata per i test. Il browser
di produzione ha servito la build candidata in container temporaneo con la
runtime config prevista; non ha esposto l'applicazione reale.

Durante la validazione i container persistenti sono rimasti
`magazzino-postgres` (`57e462be280a`), `magazzino-api` (`2beebbad6c21`)
e `magazzino-web` (`f344ed86a768`): nessun comando di test/migrazione è
stato puntato verso di essi o i loro volumi. L'eventuale variazione dei dati
live per attività umana esterna non è attribuita a questa run. La pulizia
nominativa finale è stata eseguita: `docker stop` del solo
`magazzino-m4b1-formal-db-20260923` (rimozione automatica `--rm`), tutti
gli altri container di build/browser/runtime `magazzino-m4b1-*` erano già
auto-rimossi. Sono stati creati esclusivamente per questa run i container
effimeri `magazzino-m4b1-build-final-20260923`,
`magazzino-m4b1-build-publish-20260923`,
`magazzino-m4b1-e2e-new-20260923`,
`magazzino-m4b1-e2e-tablets-20260923`,
`magazzino-m4b1-e2e-reg-20260923`,
`magazzino-m4b1-e2e-mensa-20260923`,
`magazzino-m4b1-e2e-mensa-rerun-20260923`,
`magazzino-m4b1-e2e-mensa-final-20260923`,
`magazzino-m4b1-e2e-mensa-check-20260923`,
`magazzino-m4b1-e2e-mensa-ui-20260923`,
`magazzino-m4b1-e2e-i18n-20260923`,
`magazzino-m4b1-e2e-final-20260923`,
`magazzino-m4b1-prod-smoke-20260923`,
`magazzino-m4b1-prod-smoke-diagnostic-20260923`,
`magazzino-m4b1-prod-smoke-final-20260923`,
`magazzino-m4b1-prod-render-final-20260923`,
`magazzino-m4b1-runtime-alpine-20260923` e
`magazzino-m4b1-runtime-alpine-default-20260923`; nessuno resta in
`docker ps -a`. Nessuna rete/volume M4B.1 è stata creata o resta in
`docker network ls`/`docker volume ls`. Le copie M4A/candidato, cookie,
fixture, screenshot/trace e log di questa run in `/private/tmp/m4b1-*`
sono stati eliminati dopo gli esiti sanitizzati; `find` non restituisce
residui. Nessun prune o cleanup globale.

I tre container persistenti conservano gli ID sopra e sono in esecuzione;
i volumi `magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono presenti. Le due immagini/cache
Linux x64 `node:24-slim` e Playwright scaricate restano come cache Docker
condivisa: non sono container/reti/volumi candidati, e rimuoverle per tag
potrebbe interessare altri progetti. L'immagine Nginx Alpine era già
presente. Nessun'altra risorsa Docker è stata fermata o cancellata.

Il test runtime nel vero Nginx Alpine ha confermato il caso ordinario e
ha riprodotto il difetto di escaping speciale della base M4A. Perciò G8
è GO ma G6 resta NO-GO; il Docker persistente non è stato aggiornato.

### M4B.1 — laboratorio della ripresa G6 dopo WEB-RUNTIME-01

Questa sezione registra una **run successiva** al NO-GO storico sopra;
non lo cancella. Ingresso: 38 file M4B.1 tracked/untracked, branch
`codex/magazzino-workflow-unificato`, base/remota
`be033bf565c82dccb8187d8cf72e2d1d1732a474`, index vuoto.
Manifest SHA-256 sanitizzati fuori Git:
`/private/tmp/m4b1-hotfix-input-manifest-20260923.txt`
(`75b5aaf9b5525f5c57f31c12637e0f6f31fff3739fbbc24addb646111c70f8a1`)
e `/private/tmp/m4b1-hotfix-frozen-manifest-20260923.txt`
(`eb21949d7c3fa06564203ff38145886fd95307aefe09750676e6da252e64cd03`).
La sola modifica successiva alla fase A, oltre ai documenti di esito,
è la fixture E2E Mensa M4B.1 autonoma. Nessun segreto o XLSX è nel Git.

Il laboratorio Linux amd64 è
`/private/tmp/m4b1-hotfix-linux.Scmu6M/candidate`, copia dei file Git
tracked/untracked del candidato con `pnpm install --frozen-lockfile`;
nessun `.env` né `node_modules` macOS copiato. Immagini usate:
`node:24-slim` (manifest
`sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`),
`nginx:1.27-alpine` (manifest
`sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`),
`postgres:16-alpine`, Playwright `v1.62.1-noble`. I soli tag WEB costruiti
qui sono `magazzino-m4b1-hotfix-web:20260923` e, dopo la fixture E2E,
`magazzino-m4b1-hotfix-web-final:20260923`, mai il tag del persistente.

Risorse nominative create per questa run: rete isolata
`magazzino-m4b1-hotfix-net-20260923`; container WEB
`magazzino-m4b1-hotfix-web-candidate-20260923` (solo porta loopback
`127.0.0.1:18683`) e `magazzino-m4b1-hotfix-web-final-20260923` (solo
`127.0.0.1:18684`), stub API tecnico
`magazzino-m4b1-hotfix-api-stub-20260923`, PostgreSQL
`magazzino-m4b1-hotfix-db-20260923` (dati `tmpfs`, nessun volume e nessuna
porta host), database distinti `m4b1_hotfix_e2e` e `m4b1_hotfix_api`.
Container one-shot `--rm` della matrice runtime RT-01…11, build, smoke
browser, fresh/seed/runner/API/E2E hanno nomi con prefisso
`magazzino-m4b1-hotfix-`; i test E2E funzionali avviano API e Vite propri
sulla rete isolata, **non** lo stub. I due XLSX originali FSE sono montati
singolarmente `:ro` soltanto nel container API; le loro impronte sono
`4e4b8ba724a35cb048d42070299c34b3ecfe673206390c8fde2d67c20488c901`
e `e1b4ab9c0b647adb0f3fb48bb4f0f76b493aee005933cb0a223a3218cba554de`.

I container persistenti protetti erano e restano
`magazzino-postgres` (`57e462be280a`), `magazzino-api`
(`2beebbad6c21`) e `magazzino-web` (`f344ed86a768`); i volumi
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` non sono stati montati nei test.
Nessun `prune`, reset, seed o migrazione è stato diretto al database
persistente. La pulizia nominativa e il controllo conclusivo di container,
rete, volumi e immagine candidata sono registrati nell'esito finale della
run, dopo l'ultima prova.

La pulizia finale ha fermato nominativamente i quattro container
`magazzino-m4b1-hotfix-web-final-20260923`,
`magazzino-m4b1-hotfix-web-candidate-20260923`,
`magazzino-m4b1-hotfix-api-stub-20260923` e
`magazzino-m4b1-hotfix-db-20260923` (tutti `--rm`). La rete è stata
verificata vuota e rimossa per nome; rimossi per tag soltanto
`magazzino-m4b1-hotfix-web:20260923` e
`magazzino-m4b1-hotfix-web-final:20260923`. Tutti i container one-shot
erano già auto-rimossi. Non è stato creato alcun volume Docker M4B.1.
La directory di laboratorio, verificata come percorso esatto
`/private/tmp/m4b1-hotfix-linux.Scmu6M`, è stata rimossa con i suoi
output temporanei; i manifest sanitizzati fuori Git sono conservati.
Le immagini base/cache condivise non sono state cancellate.

Il controllo successivo con `docker ps -a`, `docker network ls` e
`docker volume ls` non mostra risorse disposable con prefisso
`magazzino-m4b1-hotfix-`. I tre container persistenti conservano gli ID
iniziali e sono attivi; i due volumi persistenti restano presenti. Le
risorse degli altri progetti presenti nell'inventario non sono state
fermate, eliminate o modificate. G8 è GO, indipendentemente dal blocco
API G3/G4 riportato in `ESITI_TEST_M4B1.md`.

### M4B.1 — laboratorio della ripresa G3/G4 / SCARICO-TEST-01

Questa sezione riguarda solo la run **successiva** al NO-GO/G3-G4 sopra.
Il DB usato non è il persistente: URL di test con host loopback
`127.0.0.1:55452` per macOS e nome della rete disposable per i
container Linux; credenziali sintetiche non registrate. Nessun servizio
esterno necessario. Gli XLSX FSE originali sono stati montati nei
container API come singoli file `:ro`, mai copiati nel repository.

Risorse create per questa run:

- PostgreSQL `magazzino-m4b1-scarico-db-20260923` (ID
  `73fce5232224`, `--rm`, dati su `tmpfs`, porta solo loopback);
- rete `magazzino-m4b1-scarico-net-20260923` (ID `496855e8f141`),
  collegata soltanto al DB disposable;
- DB interni disposable `m4b1_scarico`, `m4b1_scarico_target`,
  `m4b1_scarico_target2`, `m4b1_scarico_mutation`,
  `m4b1_scarico_formal`, `m4b1_scarico_formal2`,
  `m4b1_scarico_linux`, `m4b1_scarico_perf` e
  `m4b1_scarico_linux_final`; ogni DB di prova formale è stato creato
  fresh con schema/migrazioni 41/41;
- container Linux one-shot `--rm` con prefisso
  `magazzino-m4b1-scarico-node-`: `check`, `install`, `install10`,
  `fresh`, `api`, `perf`, `fse-check`, `api-final` (suffisso data
  `20260923`); nessuno ha montato volumi persistenti;
- copie temporanee esatte `/private/tmp/m4b1-scarico-mutation.OR8kw6`
  e `/private/tmp/m4b1-scarico-linux.VFobWe`, rispettivamente per
  SCAR-06 e il run Linux compatibile.

Il primo install nel container one-shot ha selezionato pnpm 12 tramite
Corepack e ha fallito per la nuova policy degli script; l'install frozen
è poi passato con pnpm 10.34.5 e Node 24.21.0, senza cambiare
lockfile/policy del progetto. La suite API Linux iniziale ha trovato
il timeout del singolo test FSE-R2, misurato e corretto localmente come
descritto in `ESITI_TEST_M4B1.md`; la suite completa finale è verde.

Cleanup nominativo completato: `docker stop` del solo DB disposable
(`--rm`), poi `docker network rm` della sola rete sopra; tutti i
container one-shot erano già auto-rimossi. Non è stato creato alcun
volume Docker temporaneo. Le due copie diagnostiche esatte sono state
rimosse; restano fuori Git soltanto i manifest SHA-256 sanitizzati.
Il controllo finale `docker ps -a`, `docker network ls` e
`docker volume ls` non mostra risorse con prefisso
`magazzino-m4b1-scarico-`. I tre container protetti mantengono gli ID
`magazzino-postgres` `57e462be280a`, `magazzino-api` `2beebbad6c21`,
`magazzino-web` `f344ed86a768`; i volumi
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono ancora presenti. Le reti
storiche e le risorse di altri progetti non sono state modificate.
Nessun prune, Docker persistente invariato.

### M4B.2 — laboratorio disposable dello sviluppo

Lo sviluppo M4B.2 ha usato soltanto PostgreSQL nel container
`magazzino-m4b2-dev-db-20260924` (ID `eaa91acf7f1a`), immagine
`postgres:16-alpine`, porta `127.0.0.1:55442`, dati su tmpfs
`/var/lib/postgresql/data` da 1 GiB, senza mount o volume Docker.
Il database interno era dedicato alle prove e ai fresh 42/42; il runner
ha creato e rimosso propri database interni temporanei. Una prima
istanza con lo stesso nome, anch'essa `--rm`, era stata fermata dopo
la correzione della migrazione 42; la seconda è stata arrestata per nome
al termine delle verifiche ed eliminata automaticamente.

Non sono state create reti dedicate M4B.2, volumi temporanei o immagini
candidate. Il controllo finale `docker ps -a`, `docker network ls` e
`docker volume ls` non mostra risorse M4B.2 residue. I container protetti
restano attivi con gli ID iniziali: `magazzino-postgres` `57e462be280a`,
`magazzino-api` `2beebbad6c21`, `magazzino-web` `f344ed86a768`.
I volumi persistenti `magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono presenti e non sono stati
modificati. Reti storiche e risorse di altri progetti sono state solo
inventariate, mai toccate. Nessun prune o aggiornamento del Docker
persistente.

### M4 — laboratorio formale disposable e cleanup

La validazione formale M4 del 24 settembre ha usato soltanto risorse
nominative disposable, con rete isolata
`magazzino-m4-formal-net-20260924` e PostgreSQL
`magazzino-m4-formal-db-20260924` (`--rm`, dati su tmpfs, porta host
solo `127.0.0.1:55442`, nessun volume Docker). Database interni di prova:
`m4_fresh`, `m4_fresh2`, `m4_upgrade41`, `m4_upgrade41_fixed`,
`m4_api_final`…`m4_api_final5`, `m4_e2e`, `m4_e2e_final` e
`m4_e2e_final2`, oltre ai DB temporanei auto-gestiti dal runner.
L'upgrade autentico ha usato una copia `git archive` della base 41 in
`/private/tmp/m4-base41-dWZQqU`, non il repository corrente né il DB
persistente. I due XLSX FSE originali sono stati letti come file di input
del laboratorio, non copiati nel repository.

I container applicativi candidati erano
`magazzino-m4-formal-api-20260924` e
`magazzino-m4-formal-web-20260924`. Le immagini nominate erano
`magazzino-m4-formal-build:20260924`,
`magazzino-m4-formal-api:20260924`,
`magazzino-m4-formal-web:20260924` e
`magazzino-m4-formal-playwright:20260924`. I runner Playwright erano
container one-shot `--rm` con prefisso `magazzino-m4-formal-`, senza
volumi persistenti. Per gli E2E è stata usata una credenziale sintetica
solo nei DB disposable; nessun file di credenziali è nel repository.
L'API E2E è stata riavviata esclusivamente nel laboratorio per usare
una copia fresh e disabilitare il geocoding pubblico.

Cleanup nominativo completato: arrestati e auto-rimossi i tre container
M4; eliminata la sola rete M4 e le quattro immagini M4; eliminate le due
configurazioni temporanee Playwright nel repository, il Dockerfile
temporaneo `/private/tmp/m4-formal-playwright-20260924.Dockerfile` e
l'archivio temporaneo esatto della base 41. Non è stato creato alcun
volume Docker M4; i database temporanei sono spariti con il container
PostgreSQL su tmpfs. Nessun prune, `down -v` o cleanup globale.

L'inventario finale `docker ps -a`, `docker network ls` e
`docker volume ls` non mostra risorse M4-formal. Restano attivi e con gli
ID iniziali `magazzino-web` `f344ed86a768`, `magazzino-api`
`2beebbad6c21` e `magazzino-postgres` `57e462be280a`; i volumi
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono presenti e non toccati.
Reti/volumi storici e risorse di altri progetti sono rimasti invariati.

### UX-CARICO-LOTTI — laboratorio Fase A disposable

Il 25 settembre 2026 è stato usato solo il container PostgreSQL
`magazzino-ux-carico-lotti-test-20260925` (ID
`706e073abc0beefc929dd129c10dc8538bdf0179214db847de583ac95f85f17c`),
porta casuale legata a `127.0.0.1:57972`, database sintetico
`magazzino_ux_carico_lotti_test`, dati su `tmpfs` da 512 MiB.
`docker inspect` ha confermato `mounts=[]`: nessun volume Docker di test.
Bootstrap dello schema e 42/42 migrazioni ufficiali sono stati applicati
**solo** a questo database effimero. La prima invocazione del runner prima
del bootstrap ha fallito come previsto per tabella mancante; dopo il
bootstrap il runner ha completato 42/42. I test API non hanno usato il DB
persistente.

Le build WEB Linux hanno usato container `node:24-slim` one-shot con
`--rm --network none` e bind del repository; i primi tentativi hanno
evidenziato mismatch architettura/variabili Vite, poi la build Linux x64
è risultata verde. Nessuna immagine è stata costruita e nessuna rete o
volume candidato è stata creata.

Cleanup nominativo completato con `docker stop` sul solo container di test
`--rm`. Inventario finale `docker ps -a`, `docker network ls`,
`docker volume ls`: nessuna risorsa disposable UX-CARICO-LOTTI residua.
Restano attivi `magazzino-web` (`53d1749ac465`), `magazzino-api`
(`82a4c3d6a82b`) e `magazzino-postgres` (`57e462be280a`), senza
arresti o aggiornamenti durante questa fase. I volumi persistenti
`magazzino-solidale_magazzino_pgdata` e
`magazzino-solidale_magazzino_uploads` sono invariati; anche reti,
volumi storici e altri progetti sono stati lasciati intatti.

### UX-CARICO-LOTTI — laboratorio formale disposable

Il `##test` finale del 25 settembre 2026 ha usato il solo PostgreSQL
temporaneo `magazzino-ux-lotti-formal-db-20260925` (ID
`adf1a3d6c3a36fbafe5b83a7d9efff8408928be4f937a0a061247d67568cb155`),
immagine `postgres:16-alpine`, porta `127.0.0.1:55443`, dati su `tmpfs`
da 768 MiB, `Mounts=[]`, `--rm`. Al suo interno, database sintetici
isolati per fresh 42/42, API mirate/completa e E2E. Il runner ufficiale
ha verificato `applicate=42`, `pending=0` e 24/24 test con PostgreSQL.

Per E2E e build WEB Linux è stata usata una copia temporanea del working
tree in `/private/tmp/ux-lotti-formal-20260925.3wpzg8` con dipendenze
Linux installate tramite `pnpm install --frozen-lockfile`; i container
Playwright `mcr.microsoft.com/playwright:v1.62.1-noble` erano one-shot
con `--rm`. I due XLSX originali M3B sono stati montati in sola lettura.
Non sono stati creati stack persistenti, reti dedicate o volumi Docker
temporanei. Il Docker locale persistente `magazzino-postgres`,
`magazzino-api`, `magazzino-web`, la rete e i volumi pgdata/uploads non
sono stati aggiornati né usati come banco prova.

Cleanup nominativo completato: `docker stop` ha arrestato e auto-rimosso
soltanto `magazzino-ux-lotti-formal-db-20260925`; la copia esatta
`/private/tmp/ux-lotti-formal-20260925.3wpzg8` è stata rimossa dopo la
build finale. `docker ps -a` non mostra container UX-Lotti disposable;
`docker network ls` e `docker volume ls` non mostrano nuove risorse del
test. I container persistenti conservano gli ID iniziali:
`magazzino-postgres` `57e462be280a`, `magazzino-api` `935c8e07c2bf` e
`magazzino-web` `10eb0d43ceb1`. La rete
`magazzino-solidale_default` e i volumi
`magazzino-solidale_magazzino_pgdata` /
`magazzino-solidale_magazzino_uploads` sono presenti e invariati. Altre
risorse Docker della macchina non sono state toccate; nessun prune,
`down -v` o reset DB persistente.
