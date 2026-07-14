# Ambiente isolato BUG-PROD-01

Questo stack usa il progetto Compose `magazzino-bug-prod-01`, un database
dedicato e bind mount separati dalla produzione. Non usare mai i comandi di
reset contro il database di produzione.

## Preparazione una tantum

Creare sul server le directory seguenti, di proprietà dell'utente che esegue
Docker:

```text
/data/magazzino-debug/Bug-Prod-01/postgres
/data/magazzino-debug/Bug-Prod-01/uploads
/data/magazzino-debug/Bug-Prod-01/backups
```

Copiare `.env.debug.example` in `.env.debug`, sostituire tutti i placeholder
con segreti casuali distinti e impostare permessi `0600`. `.env.debug` è
ignorato da Git.

## Avvio e seed

Eseguire dalla root del worktree `/opt/Magazzino-Solidale-Bug-Prod-01`:

```sh
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug up -d --build
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data seed-demo --super-admin=sadmin
```

Il frontend è pubblicato soltanto su `127.0.0.1:8083`; PostgreSQL soltanto su
`127.0.0.1:5435`. L'API non espone porte sull'host.

## Accesso tramite tunnel SSH

Dal computer locale:

```sh
ssh -N -L 8083:127.0.0.1:8083 root@195.201.18.77
```

Aprire `http://127.0.0.1:8083`. La password iniziale di `sadmin` è quella
configurata in `SUPER_ADMIN_INITIAL_PASSWORD`; quella dell'operatore sintetico
`operatore.demo` è in `DEMO_USER_INITIAL_PASSWORD`. Non trasmettere questi
valori in log, commit o ticket.

## Anteprima e reset sintetici

L'anteprima non modifica dati:

```sh
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data preview-reset-demo --super-admin=sadmin
```

I reset demo richiedono Super Admin e una conferma letterale:

```sh
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data reset-demo-emporio --super-admin=sadmin '--confirm=RESET EMPORIO DEMO'
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data reset-demo-uds --super-admin=sadmin '--confirm=RESET UDS DEMO'
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data reset-demo-beneficiari --super-admin=sadmin '--confirm=RESET BENEFICIARI DEMO'
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug exec -T api pnpm --filter @workspace/api-server environment:data reset-demo --super-admin=sadmin '--confirm=RESET DATI DEMO'
```

Il reset completo demo elimina solo record con codici e marcatori sintetici.
Se trova sessioni o spese di cassa collegate, si interrompe senza cancellarle.
I reset operativi preesistenti restano separati, richiedono conferma forte e
`--backup-confirmed`, e conservano account, ruoli, configurazione, moduli e
audit.

## Arresto

```sh
docker compose -p magazzino-bug-prod-01 -f docker-compose.debug.yml --env-file .env.debug down
```

Non aggiungere `-v`: il database debug è un bind mount e la sua eliminazione
deve essere un'operazione manuale, esplicita e successiva a verifica.
