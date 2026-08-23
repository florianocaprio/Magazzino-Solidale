# DB Migration Ledger 1.0

## Obiettivo e perimetro

Il ledger sostituisce il replay completo a ogni avvio con un motore append-only
dotato di checksum, lock globale e audit. Non modifica lo schema Drizzle o la
semantica delle migration business esistenti.

Il comando operativo resta:

```bash
pnpm --filter @workspace/db run update
```

`docker-entrypoint-api.sh` continua a eseguirlo prima dello start dell'API.

## Componenti

- `scripts/migration-runner.mjs`: motore testabile;
- `scripts/apply-updates.mjs`: CLI sottile per `update`, `status` e `verify`;
- `legacy-migrations-baseline.json`: manifest immutabile della storia
  pre-ledger;
- `updates/*.sql`: directory canonica, ordinata per filename con confronto
  code-unit deterministico;
- schema PostgreSQL `app_meta`: ledger e audit.

Il ruolo Docker `magazzino` dispone del privilegio `CREATE` sul database e può
creare `app_meta`. Non viene usato un fallback silenzioso nel `public`.

## Metadata model

### `app_meta.schema_migrations`

Source of truth delle migration concluse:

- `filename` PK;
- `checksum_sha256` a 64 caratteri esadecimali;
- `applied_at`;
- `duration_ms` non negativo;
- `runner_version`;
- `source_version` opzionale;
- `adoption_mode`: `REPLAY_AND_REGISTER` oppure `NORMAL`.

Una riga viene inserita soltanto nella stessa transazione della migration.

### `app_meta.schema_migration_runs`

Audit per invocazione con orari, stato, versione runner/sorgente, host, PID,
contatori, file fallito e errore sanitizzato. Stati:

```text
RUNNING SUCCESS FAILED LOCK_TIMEOUT VERIFY_ONLY ABORTED
```

Dopo l'acquisizione del lock, eventuali run `RUNNING` precedenti sono marcati
`ABORTED`: il ledger, non il run audit, resta l'unica prova di applicazione.

### `app_meta.schema_migration_run_items`

Audit per file con checksum, tempi, durata ed esito:

```text
PENDING APPLIED SKIPPED FAILED
```

La coppia `run_id + filename` è univoca. Le metadata non memorizzano SQL,
connection string, segreti o dati personali; gli errori sono limitati a 1.000
caratteri e conservano SQLSTATE quando disponibile.

## Prima adozione

Se mancano righe per una migration inclusa nel manifest legacy, il runner entra
in modalità `REPLAY_AND_REGISTER`:

1. verifica directory e manifest;
2. acquisisce il lock di sessione globale;
3. crea e verifica le tabelle `app_meta`;
4. considera la storia non registrata come pendente;
5. esegue un ultimo replay in ordine;
6. registra ogni file nella stessa transazione del relativo SQL;
7. chiude il run `SUCCESS`.

Se un file fallisce, viene eseguito il rollback della sola transazione corrente.
I file precedenti restano registrati; il file fallito e quelli successivi
restano pendenti. Dopo una correzione reviewata di un file mai applicato, il run
successivo riparte dal primo pending. Una migration già registrata non può
essere corretta in-place.

## Manifest legacy e checksum

`legacy-migrations-baseline.json` contiene tutti i 21 file presenti
all'introduzione del ledger, incluso il replay guard Logistica. Usa SHA-256 sui
byte esatti e viene protetto dalla normalizzazione LF in `.gitattributes`.

Prima di accedere al database il runner verifica:

- formato e algoritmo supportati;
- ordine e assenza di duplicati;
- presenza di ogni file storico;
- corrispondenza di ogni checksum.

Errori bloccanti:

```text
LEGACY_BASELINE_CHECKSUM_MISMATCH
LEGACY_BASELINE_FILE_MISSING
LEGACY_BASELINE_INVALID
MIGRATION_CHECKSUM_MISMATCH
MIGRATION_APPLIED_FILE_MISSING
MIGRATION_OUT_OF_ORDER
```

Non sono disponibili `repair`, `accept-current-checksum` o auto-rebaseline.
Ogni modifica al manifest richiede review esplicita.

## Ordine append-only

I filename devono rispettare la convenzione:

```text
YYYYMMDD_descrizione.sql
```

Il confronto usa l'ordine code-unit, equivalente al precedente `.sort()` del
runner. Dopo la prima registrazione, un nuovo file che ordina prima dell'ultima
migration applicata viene rifiutato. Rename e rimozione di file applicati sono
bloccanti.

## Lock e concorrenza

Il runner usa `pg_try_advisory_lock(hashtextextended(...))` con chiave:

```text
magazzino-solidale:schema-migrations
```

Il lock è di sessione e copre preflight DB, tutte le migration e audit finale.
`DB_MIGRATION_LOCK_TIMEOUT_MS` configura il timeout, con default 120.000 ms.
In caso di timeout il comando termina non-zero con
`MIGRATION_LOCK_TIMEOUT`; se le metadata esistono, registra un run
`LOCK_TIMEOUT`.

Due API concorrenti si serializzano: la prima applica, la seconda attende,
verifica gli stessi checksum e salta i file già registrati.

## Transazioni e failure

Ogni file usa una transazione indipendente:

```text
BEGIN
SQL migration
INSERT schema_migrations
UPDATE run item APPLIED
COMMIT
```

Su errore: `ROLLBACK`, item/run `FAILED`, exit non-zero. Un'interruzione brutale
non può lasciare SQL committato senza ledger, perché i due eventi condividono la
transazione.

## CLI

### Update

```bash
pnpm --filter @workspace/db run update
```

Verifica storia e checksum, poi applica solo i pending.

### Status

```bash
pnpm --filter @workspace/db run migrations:status
```

Read-only: mostra inizializzazione, file totali/applicati/pendenti, mismatch,
file mancanti, out-of-order e ultimo run.

### Verify

```bash
pnpm --filter @workspace/db run migrations:verify
```

Non applica SQL. Su un database non adottato verifica manifest e directory e
riporta il ledger come non inizializzato. Su un database adottato acquisisce il
lock, verifica ledger/checksum/ordine e registra un run `VERIFY_ONLY`.

## Impact map

| Area               | Impatto                                                 |
| ------------------ | ------------------------------------------------------- |
| Runner             | Da replay-all a checksum + pending-only                 |
| Docker entrypoint  | Comando invariato; restart con 0 pending                |
| Database esistenti | Ultimo replay sicuro e registrazione della storia       |
| Database nuovi     | `push`, poi adozione ledger; vedere limite `zone_uds`   |
| Clone/staging      | Ambiente obbligatorio per la prima adozione controllata |
| Hetzner futuro     | Nessun rollout in questa fase; procedura sotto          |
| Test API/migration | Stesso DB reale, più test sintetici isolati del runner  |
| Concorrenza        | Un lock di sessione per tutti i file                    |
| Rollback           | Per-file; le migration precedenti restano registrate    |
| Checksum           | SHA-256 byte-esatto, storico protetto dal manifest      |
| Ordinamento        | Code-unit, append-only dopo la prima riga ledger        |
| Audit              | Run e item persistenti, senza SQL o segreti             |
| Drizzle push       | Ignora `app_meta`; resta separato dal ledger            |

## Procedura clone/staging

1. creare un backup consistente;
2. ripristinarlo in un database isolato;
3. eseguire `migrations:verify` e controllare che il manifest sia valido;
4. registrare le cardinalità business rilevanti;
5. eseguire `update` una prima volta (`REPLAY_AND_REGISTER`);
6. verificare una riga ledger per ogni file e i conteggi business;
7. eseguire nuovamente `update`: 0 applicate, tutte skipped;
8. eseguire `migrations:verify`, `migrations:status` e i test applicativi;
9. provare start e restart Docker.

## Procedura futura Hetzner

1. backup verificato del database Hetzner;
2. restore su clone/staging separato;
3. `migrations:verify` sul clone;
4. prima adozione `REPLAY_AND_REGISTER` sul clone;
5. secondo `update` con zero pending;
6. suite applicative e smoke Docker sul clone;
7. review umana dei run audit;
8. soltanto dopo, rollout controllato in finestra approvata.

Questo incarico non autorizza alcun accesso o rollout Hetzner.

## Database nuovo e limite noto

La procedura documentata resta:

```bash
pnpm --filter @workspace/db run push
pnpm --filter @workspace/db run update
```

Sul database completamente vuoto corrente, `drizzle-kit push` può fermarsi con
SQLSTATE `42830` perché la FK composta verso `zone_uds` non trova ancora il
vincolo univoco richiesto. È un `ENVIRONMENTAL/LEGACY ISSUE` preesistente e non
viene corretto dal ledger. Il percorso clone/staging consolidato è stato
verificato; non usare `push-force` come aggiramento.
