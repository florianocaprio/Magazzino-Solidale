# Ambiente cliente cliente-x

Questo template descrive un ambiente cliente isolato per Magazzino Solidale.
Ogni cliente deve avere stack Docker, database, dati persistenti, dominio,
configurazione ambiente, moduli, loghi e backup separati.

## File attesi

- `docker-compose.prod.yml`: compose cliente copiato da `docker-compose.client.yml`.
- `.env.docker`: variabili cliente copiate da `.env.client.example`.
- `README.md`: note operative specifiche del cliente.

## Percorsi consigliati

- Configurazione stack: `/opt/magazzino-clienti/cliente-x`
- Dati persistenti: `/data/magazzino-clienti/cliente-x`
- Database: `/data/magazzino-clienti/cliente-x/postgres`
- Upload: `/data/magazzino-clienti/cliente-x/uploads`
- Export: `/data/magazzino-clienti/cliente-x/exports`
- Backup: `/data/magazzino-clienti/cliente-x/backups`

## Primo controllo manuale

1. Compilare `.env.docker` con password forti e `SESSION_SECRET` casuale.
2. Verificare `SOURCE_REPO_DIR`, `CLIENT_DOMAIN` e `WEB_HOST_PORT`.
3. Configurare Caddy con il dominio cliente.
4. Avviare il database:

   ```bash
   docker compose --env-file .env.docker -f docker-compose.prod.yml up -d db
   ```

5. Applicare lo schema:

   ```bash
   docker compose --env-file .env.docker -f docker-compose.prod.yml run --rm api pnpm --filter @workspace/db run push-force
   ```

6. Avviare lo stack:

   ```bash
   docker compose --env-file .env.docker -f docker-compose.prod.yml up -d --remove-orphans
   ```

7. Verificare:

   ```bash
   docker compose --env-file .env.docker -f docker-compose.prod.yml ps
   curl -I https://cliente-x.magazzinosolidale.it
   ```

## Sicurezza

Non committare `.env.docker`, backup, dump o log. Conservare le credenziali in
un password manager o vault aziendale. Dopo il primo accesso Super Admin,
configurare ambiente, moduli funzionali e loghi documentali dal menu Super Admin.
