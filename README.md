# Magazzino Solidale AIM

Gestionale per un magazzino solidale: tracciamento prodotti/lotti (FEFO), CRM
beneficiari, consegne, trasferimenti, volontari e report — più il modulo **Unità
di Strada (UDS)** e lo scoping per **Città / Zona**.

Stack: pnpm workspaces · Node.js 24 · TypeScript · React + Vite · Express 5 ·
PostgreSQL + Drizzle ORM · contratti API in OpenAPI (codegen Orval). Interfaccia
multilingua (it/es/en/fr/de/ar).

---

## Requisiti

- **Node.js 24+**
- **pnpm** (`npm install -g pnpm`)
- Un database **PostgreSQL** raggiungibile

## Configurazione

1. Installa le dipendenze:

   ```bash
   pnpm install
   ```

2. Crea il file `.env` partendo dall'esempio e compila i valori:

   ```bash
   cp .env.example .env
   ```

   Variabili richieste:

   - `DATABASE_URL` — stringa di connessione PostgreSQL
   - `SESSION_SECRET` — segreto per la firma delle sessioni (usa una stringa
     lunga e casuale, es. `openssl rand -hex 32`)

3. Applica lo schema al database:

   ```bash
   pnpm --filter @workspace/db run push
   ```

## Avvio (sviluppo)

Avvia i due servizi (in due terminali, oppure tramite i workflow di Replit):

```bash
# API server (Express)
pnpm --filter @workspace/api-server run dev

# Frontend (Vite)
pnpm --filter @workspace/magazzino-solidale run dev
```

## Primo avvio — creazione utenze

Al **primo avvio**, quando nel database non esiste ancora nessun
**Amministratore**, l'app mostra una schermata di **Configurazione iniziale**
accessibile **senza login**. Da qui si possono creare **solo** le utenze del
sistema — almeno una deve avere un ruolo di **Amministratore**.

Appena viene creato il primo Amministratore, la configurazione si chiude
automaticamente e l'app passa alla normale schermata di **accesso**: da quel
momento la gestione delle utenze avviene solo dopo l'autenticazione.

> Non esiste alcun utente predefinito: le credenziali iniziali le scegli tu in
> questa fase.

## Comandi utili

- `pnpm run typecheck` — typecheck completo di tutti i package
- `pnpm run build` — typecheck + build
- `pnpm --filter @workspace/api-server run test` — test d'integrazione API
  (richiede `DATABASE_URL`)
- `pnpm --filter @workspace/api-spec run codegen` — rigenera hook API + schemi
  Zod dall'OpenAPI

## Note

- I segreti vanno **solo** nel file `.env`, che è escluso dal versionamento.
  Non committare mai credenziali.
- Per i dettagli su architettura, moduli e convenzioni vedi `replit.md`.
