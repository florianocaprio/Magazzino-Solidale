# Ambienti cliente Magazzino Solidale

Questa guida chiude la Fase 5 - Super Admin, Feature Flags e Configurazione
Ambienti. Descrive come predisporre nuovi ambienti cliente senza introdurre
multitenant applicativo.

## Scelta architetturale

Il modello adottato e': un cliente = un ambiente isolato.

- Il codice sorgente resta unico.
- Ogni cliente ha uno stack/container dedicato.
- Ogni cliente ha database, file, moduli, logo e configurazioni proprie.
- Ogni cliente puo' essere aggiornato, salvato e ripristinato in modo indipendente.
- L'applicazione resta single-tenant dentro ogni istanza.

Non viene introdotto `tenantId` nel codice applicativo perche' l'isolamento e'
realizzato a livello di stack, database, filesystem e dominio. Questo riduce il
rischio di leakage dati tra clienti e mantiene piu' semplici query, permessi,
backup, export e cancellazione dati.

## Struttura consigliata

Configurazioni stack:

```text
/opt/magazzino-clienti/
├── angeli-in-moto/
│   ├── docker-compose.prod.yml
│   ├── .env.docker
│   └── README.md
├── cliente-x/
│   ├── docker-compose.prod.yml
│   ├── .env.docker
│   └── README.md
└── cliente-y/
    ├── docker-compose.prod.yml
    ├── .env.docker
    └── README.md
```

Dati persistenti:

```text
/data/magazzino-clienti/
├── angeli-in-moto/
│   ├── postgres/
│   ├── uploads/
│   ├── exports/
│   └── backups/
├── cliente-x/
│   ├── postgres/
│   ├── uploads/
│   ├── exports/
│   └── backups/
└── cliente-y/
    ├── postgres/
    ├── uploads/
    ├── exports/
    └── backups/
```

Il repository sorgente puo' stare in una directory separata, ad esempio:

```text
/opt/magazzino-sorgente/Magazzino-Solidale
```

Ogni `.env.docker` cliente deve indicare questo percorso con `SOURCE_REPO_DIR`.

## Dominio, Caddy e porta locale

Ogni ambiente espone solo il servizio web su `127.0.0.1:${WEB_HOST_PORT}`. Caddy
riceve traffico HTTPS pubblico e inoltra verso quella porta locale.

Esempio:

```text
magazzino.angeliinmoto.it      -> 127.0.0.1:8082
cliente-x.magazzinosolidale.it -> 127.0.0.1:8083
cliente-y.magazzinosolidale.it -> 127.0.0.1:8084
```

Il database non deve essere esposto pubblicamente. Se serve una porta DB per
manutenzione straordinaria, esporla solo su `127.0.0.1` e solo per il tempo
necessario.

Esempio Caddy:

```caddyfile
cliente-x.magazzinosolidale.it {
    reverse_proxy 127.0.0.1:8083
}
```

Controlli Caddy:

- record DNS A del dominio verso l'IP del server;
- porte 80 e 443 aperte;
- Caddy in esecuzione come servizio;
- reload dopo modifica: `sudo caddy reload --config /etc/caddy/Caddyfile`;
- log: `sudo journalctl -u caddy -f`;
- test: `curl -I https://cliente-x.magazzinosolidale.it`.

Se il certificato HTTPS non viene emesso, controllare DNS, firewall, rate limit
Let's Encrypt e presenza di proxy intermedi.

## Creare un nuovo ambiente cliente

Dal repository:

```bash
scripts/client-env/create-client-env.sh \
  --slug cliente-x \
  --domain cliente-x.magazzinosolidale.it \
  --port 8083
```

Lo script crea:

- `/opt/magazzino-clienti/${CLIENT_SLUG}`;
- `/data/magazzino-clienti/${CLIENT_SLUG}/postgres`;
- `/data/magazzino-clienti/${CLIENT_SLUG}/uploads`;
- `/data/magazzino-clienti/${CLIENT_SLUG}/exports`;
- `/data/magazzino-clienti/${CLIENT_SLUG}/backups`;
- `docker-compose.prod.yml` copiato dal template;
- `.env.docker` copiato dal template e parametrizzato;
- `README.md` cliente.

Per non toccare i percorsi reali durante una verifica:

```bash
scripts/client-env/create-client-env.sh \
  --slug cliente-x \
  --domain cliente-x.magazzinosolidale.it \
  --port 8083 \
  --clients-root /tmp/magazzino-clienti \
  --data-root /tmp/data-magazzino-clienti \
  --dry-run
```

## Configurare `.env.docker`

Partire dal template `deploy/client-template/.env.client.example`. Ogni cliente
deve avere valori propri:

```dotenv
CLIENT_SLUG=cliente-x
CLIENT_DOMAIN=cliente-x.magazzinosolidale.it
WEB_HOST_PORT=8083

POSTGRES_DB=magazzino_cliente_x
POSTGRES_USER=magazzino_cliente_x
POSTGRES_PASSWORD=CHANGE_ME_STRONG_PASSWORD

DATABASE_URL=postgresql://magazzino_cliente_x:CHANGE_ME_STRONG_PASSWORD@db:5432/magazzino_cliente_x
SESSION_SECRET=CHANGE_ME_LONG_RANDOM_SECRET
COOKIE_SECURE=true
COOKIE_SAMESITE=lax
APP_ORIGINS=https://cliente-x.magazzinosolidale.it
APP_BASE_URL=https://cliente-x.magazzinosolidale.it
PUBLIC_APP_URL=https://cliente-x.magazzinosolidale.it
NODE_ENV=production
```

Generare segreti forti, ad esempio:

```bash
openssl rand -base64 48
```

Non usare valori AIM o password deboli per nuovi clienti.

## Primo avvio

Entrare nella directory cliente:

```bash
cd /opt/magazzino-clienti/cliente-x
```

Avviare il database:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml up -d db
```

Applicare lo schema DB:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml run --rm api pnpm --filter @workspace/db run push-force
```

Avviare lo stack:

```bash
docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --remove-orphans
docker compose --env-file .env.docker -f docker-compose.prod.yml ps
```

Il container API applica comunque lo schema all'avvio tramite
`docker-entrypoint-api.sh`; il comando esplicito sopra rende visibile il passaggio
operativo.

## Super Admin, ambiente e moduli

Per ogni piattaforma il primo utente operativo deve essere un Super Admin. La
Fase 5 prevede bootstrap e seed Super Admin per istanza; dopo il primo accesso
trattare le credenziali iniziali come temporanee, conservarle in luogo sicuro e
cambiarle secondo la policy operativa.

Passaggi iniziali:

1. Accedere come Super Admin.
2. Aprire il menu Super Admin.
3. Configurare `Configurazione ambiente` con nome associazione, ambiente,
   contatti, footer documenti e loghi.
4. Aprire `Moduli funzionali`.
5. Attivare o disattivare i moduli opzionali del cliente.
6. Verificare `Audit configurazioni`.

Un amministratore normale puo' gestire l'operativita' applicativa, ma non deve
vedere il menu Super Admin.

## Logo documentale

I campi `logoDocumentiUrl` e `logoTessereUrl` si configurano da Super Admin. Se
non sono valorizzati, l'app usa il fallback `/logo-aim.png`.

Per un nuovo cliente:

1. caricare il logo in una posizione servita dall'app o usare URL HTTPS stabile;
2. inserire il path/URL in `Configurazione ambiente`;
3. generare una bolla PDF di test;
4. generare una tessera di test, se il modulo viene usato;
5. verificare footer, nome associazione e leggibilita' del documento.

## Deploy singolo cliente

Aggiornare un cliente:

```bash
scripts/client-env/deploy-client.sh --slug cliente-x
```

Lo script:

- entra in `/opt/magazzino-clienti/${CLIENT_SLUG}`;
- verifica `docker-compose.prod.yml` e `.env.docker`;
- esegue backup DB preventivo salvo `--skip-backup`;
- aggiorna il repository indicato da `SOURCE_REPO_DIR`, se disponibile;
- ricostruisce le immagini;
- avvia `db`;
- applica `db push`;
- riavvia lo stack con `--remove-orphans`;
- mostra `docker compose ps` e controlli post-deploy.

Se il codice sorgente sta altrove:

```bash
scripts/client-env/deploy-client.sh --slug cliente-x --code-dir /opt/magazzino-sorgente/Magazzino-Solidale
```

## Backup

Backup DB cliente:

```bash
scripts/client-env/backup-client.sh --slug cliente-x
```

Il dump viene scritto in:

```text
/data/magazzino-clienti/cliente-x/backups/backup_cliente-x_YYYYMMDD_HHMMSS.dump
```

Il formato e' `pg_dump -Fc`, quindi adatto a `pg_restore`.

## Restore

Restore DB cliente:

```bash
scripts/client-env/restore-client.sh \
  --slug cliente-x \
  --backup /data/magazzino-clienti/cliente-x/backups/backup.dump
```

Il restore sovrascrive il database cliente. Lo script richiede conferma forte:

```text
RESTORE cliente-x
```

Non procedere mai senza backup recente verificato e autorizzazione esplicita.

## Elenco clienti

```bash
scripts/client-env/list-clients.sh
```

Mostra slug, dominio, porta, stato container se Docker e' disponibile e ultimo
backup rilevato.

## Aggiornare tutti i clienti in futuro

La strategia consigliata e' mantenere l'aggiornamento massivo come orchestrazione
esterna che chiama `deploy-client.sh` per ogni slug, con finestre di manutenzione
e rollback per singolo cliente. Non eseguire update massivi ciechi senza:

- elenco clienti approvato;
- backup riuscito per ogni cliente;
- controllo post-deploy per ogni dominio;
- piano di rollback cliente per cliente.

## Checklist sicurezza

- Non committare `.env.docker`.
- Non committare backup, dump, log o screenshot.
- Usare password DB forti e diverse per cliente.
- Usare `SESSION_SECRET` forte e diverso per cliente.
- Non esporre PostgreSQL pubblicamente.
- Esporre il web solo su `127.0.0.1:${WEB_HOST_PORT}`.
- Usare HTTPS Caddy.
- Aprire sul firewall solo 80, 443 e 22.
- Usare accesso SSH con chiavi.
- Proteggere backup e limitarne i permessi.
- Eseguire restore solo da persone autorizzate.
- Separare DB e storage per GDPR, export e cancellazione cliente.
- Documentare credenziali in un vault, non nel repository.
- Conservare log con attenzione ai dati personali.

## Checklist pre-produzione

- Slug cliente scelto e validato.
- Dominio deciso.
- Porta locale libera.
- DNS creato.
- Ambiente creato con script.
- Segreti generati.
- `.env.docker` controllato.
- Caddy configurato.
- Stack avviato.
- Schema DB applicato.
- Super Admin creato/verificato.
- Accesso Super Admin riuscito.
- Configurazione ambiente completata.
- Moduli funzionali configurati.
- Logo documenti e tessere configurati oppure fallback accettato.
- Bolla PDF di test generata.
- Backup iniziale eseguito.
- Credenziali documentate in luogo sicuro.

## Checklist post-deploy

- `docker compose ps` mostra container sani.
- `curl -I https://CLIENT_DOMAIN` restituisce risposta HTTPS.
- Login Super Admin riuscito.
- Admin normale non vede il menu Super Admin.
- Menu applicativo rispetta i moduli attivi.
- PDF di test usa configurazione ambiente corretta.
- Backup post-deploy presente.
- Eventuali errori Caddy/API verificati nei log.

## File del repository

- Template cliente: `deploy/client-template/`
- Script operativi: `scripts/client-env/`
- Compose locale esistente: `docker-compose.yml`
- Entrypoint API: `docker-entrypoint-api.sh`
- Dockerfile API/Web: `Dockerfile.api`, `Dockerfile.web`

In questa fase non si modifica il compose reale di produzione e non si eseguono
script contro `/opt/magazzino-clienti` o `/data/magazzino-clienti`.
