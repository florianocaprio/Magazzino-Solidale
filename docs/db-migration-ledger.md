# DB Migration Ledger 1.0-R1

## Obiettivo e perimetro

Il ledger sostituisce il replay completo a ogni avvio con un motore append-only
dotato di checksum, doppio lock compatibile e audit. Non modifica lo schema
Drizzle o la semantica delle migration business esistenti.

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
2. acquisisce in ordine i lock di sessione legacy e globale;
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

L'ultimo filename ordinato del manifest è il confine legacy immutabile. Ogni
file SQL non censito che ordina prima o allo stesso livello di quel confine
viene rifiutato con `MIGRATION_LEGACY_BOUNDARY_VIOLATION`, anche quando il ledger
non è ancora inizializzato. Il controllo avviene durante il caricamento del
piano, prima di aprire la connessione PostgreSQL, per `update`, `verify` e
`status`. Soltanto file con filename strettamente successivo al confine possono
essere aggiunti in coda.

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
MIGRATION_LEGACY_BOUNDARY_VIOLATION
MIGRATION_CHECKSUM_MISMATCH
MIGRATION_APPLIED_FILE_MISSING
MIGRATION_OUT_OF_ORDER
```

Non sono disponibili `repair`, `accept-current-checksum` o auto-rebaseline.
Il manifest non deve essere esteso con nuove migration: resta la fotografia
immutabile dei 21 file legacy e ogni modifica richiede review esplicita.

## Ordine append-only

I filename devono rispettare la convenzione:

```text
YYYYMMDD_descrizione.sql
```

Il confronto usa l'ordine code-unit, equivalente al precedente `.sort()` del
runner. La regola append-only vale già prima della prima adozione rispetto al
confine del manifest; dopo la registrazione vale anche rispetto all'ultima
migration applicata. Un file fuori ordine viene quindi respinto prima
dell'adozione dal confine legacy o, a ledger inizializzato, dal controllo
`MIGRATION_OUT_OF_ORDER`. Rename e rimozione di file applicati sono bloccanti.

## Lock e concorrenza

Per interoperare con il runner storico e con quello nuovo, il runner acquisisce
due advisory lock di sessione in ordine deterministico:

```text
1. pg_try_advisory_lock(hashtext('magazzino-solidale:db-updates'))
2. pg_try_advisory_lock(hashtextextended('magazzino-solidale:schema-migrations', 0))
```

Il primo collide con il precedente
`pg_advisory_xact_lock(hashtext('magazzino-solidale:db-updates'))`: un vecchio
runner già attivo fa attendere il nuovo e un nuovo runner impedisce al vecchio
di entrare. Entrambi i lock coprono preflight DB, tutte le migration e audit
finale. Condividono un unico budget configurato da
`DB_MIGRATION_LOCK_TIMEOUT_MS` (default 120.000 ms), con polling limitato e
senza busy loop. Vengono rilasciati in ordine inverso, globale poi legacy, nel
blocco `finally`, prima della chiusura della connessione.

In caso di timeout il comando termina non-zero con `MIGRATION_LOCK_TIMEOUT` e
indica nell'errore sanitizzato se è scaduto il lock `legacy` o `global`; se le
metadata esistono, registra un run `LOCK_TIMEOUT`.

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
riporta il ledger come non inizializzato, tutti i file come pendenti e termina
con exit code 0 se il piano filesystem è coerente. Questo exit code 0 non
significa che il database sia stato adottato. Un gate rigoroso deve verificare
entrambe le condizioni `initialized=true` e `pending=0`. Su un database adottato
acquisisce i due lock, verifica ledger/checksum/ordine e registra un run
`VERIFY_ONLY`.

## Gate PRE-2.0C

Prima di qualsiasi review di 2.0C eseguire esplicitamente:

```bash
pnpm --filter @workspace/db run test:migrations
pnpm --filter @workspace/db run migrations:verify
pnpm --filter @workspace/db run migrations:status
```

Il gate è superato soltanto se i test del runner sono verdi, `verify` conferma
un ledger inizializzato e `status` riporta zero pending, zero checksum mismatch,
zero file applicati mancanti e zero out-of-order. Un `verify` verde con ledger
non inizializzato non è sufficiente.

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
| Concorrenza        | Lock sessione legacy + globale per tutti i file         |
| Rollback           | Per-file; le migration precedenti restano registrate    |
| Checksum           | SHA-256 byte-esatto, storico protetto dal manifest      |
| Ordinamento        | Code-unit, boundary legacy e append-only                |
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
9. eseguire `pnpm --filter @workspace/db run test:migrations`;
10. provare start e restart Docker.

Se il clone fallisce la verifica del manifest legacy, fermarsi: non modificare
file storici, checksum o manifest e non usare repair automatici. Ripartire da
un clone controllato e pulito del backup oppure sottoporre a un DBA una decisione
documentata e reviewata. Nessuna correzione va improvvisata sul database fonte.

## Procedura futura Hetzner

1. backup verificato del database Hetzner;
2. restore su clone/staging separato;
3. `migrations:verify` sul clone, ricordando che prima dell'adozione un exit 0
   con `initialized=false` non supera il gate rigoroso;
4. `pnpm --filter @workspace/db run test:migrations` con Node.js 24;
5. prima adozione `REPLAY_AND_REGISTER` sul clone, solo dopo review dei
   preflight;
6. secondo `update` con zero applicate e tutti i file skipped;
7. nuovo `migrations:verify` e conferma esplicita del gate rigoroso con
   `initialized=true` e `pending=0`;
8. suite applicative e smoke Docker sul clone;
9. review umana dei run audit, del backup e delle cardinalità business;
10. soltanto dopo, rollout controllato in finestra separatamente approvata.

Qualsiasi failure legacy sul clone Hetzner impone stop e review: non correggere
SQL storici, checksum o manifest e non eseguire repair automatici. Conservare
il backup verificato, ricreare eventualmente il clone in modo controllato e
richiedere una decisione DBA reviewata prima di procedere.

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
