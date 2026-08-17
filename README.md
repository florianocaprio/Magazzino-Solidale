# Magazzino Solidale AIM

Il progetto consente di gestire Emporio Solidale, Centro di Ascolto, Distribuzione Pacchi alimentari, Mensa, Unità di strada.

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

3. Per un database nuovo, crea lo schema e applica gli aggiornamenti incrementali:

   ```bash
   pnpm --filter @workspace/db run push
   pnpm --filter @workspace/db run update
   ```

   Su un database esistente non usare `push` per un aggiornamento applicativo:
   crea prima un backup e usa soltanto `pnpm --filter @workspace/db run update`.

## Aggiornare un database Docker esistente

1. Creare un dump prima dell'aggiornamento:

   ```bash
   docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /tmp/magazzino_backup_pre_aggiornamento.dump
   ```

2. Applicare gli aggiornamenti idempotenti dall'immagine API aggiornata:

   ```bash
   docker compose build api
   docker compose up -d db
   docker compose run --rm api pnpm --filter @workspace/db run update
   ```

3. Verificare lo schema e avviare lo stack:

   ```bash
   docker compose exec -T db psql -U magazzino -d magazzino -c '\d+ public.beneficiari'
   docker compose up -d --remove-orphans
   ```

Il comando `update` esegue in ordine gli script SQL in `lib/db/updates`, ognuno
in una transazione e sotto lock advisory. Gli script devono essere idempotenti e
non devono riconciliare automaticamente altre differenze dello schema.

### Aggiornamento Fase 5-4 — Mensa

L'update `20260814_fase5_4_modulo_mensa.sql` è additivo e idempotente: aggiunge
Mense, abilitazioni, tessere beneficiario trasversali, accessi, eccezioni e
pasti; estende inoltre ruoli e trasferimenti senza creare un secondo sistema di
giacenze. Prima della produzione creare sempre un dump, eseguire `update` in una
finestra controllata e verificare:

```bash
pnpm --filter @workspace/db run update
psql "$DATABASE_URL" -c "select count(*) from beneficiari"
psql "$DATABASE_URL" -c "select table_name from information_schema.tables where table_schema='public' and table_name like 'mensa%'"
```

Per sola compatibilità legacy, i codici beneficiario già stampati vengono
registrati una volta come prima tessera trasversale attiva. Ogni nuova emissione
usa invece un token casuale opaco `MS-...`, mai `beneficiari.codice`, e il
QR/barcode non contiene nome, codice fiscale o altri dati personali. Per
collaudare la migrazione su dati reali, ripristinare il dump in un database
separato e lanciare due volte `update`: entrambe le esecuzioni devono concludersi
senza variazioni nelle cardinalità delle entità preesistenti.

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

## Report e Statistiche

Il modulo `REPORT` espone in `/report` la landing della reportistica integrata:
Dashboard generale, Pacchi Alimentari, Centro di Ascolto, Emporio, Mensa, UDS,
Magazzino/Logistica e rendicontazione trasversale FSE+. I calcoli sono eseguiti
dal reporting service server-side; grafici, tabelle, drill-down paginato ed
export XLSX/PDF consumano lo stesso payload aggregato. Città, Centro e Zona UDS
sono sempre riapplicati dal backend; per Mensa resta necessario anche il
permesso `mensa.reports.view`.

Le route storiche `/report-uds`, `/mensa/report` e gli endpoint legacy sotto
`/report` restano disponibili per compatibilità. La nuova fase non introduce
modifiche allo schema database. Le limitazioni del modello SIFEAD sono mostrate
come dati mancanti, mai convertite in zeri o inferenze da note libere.

## MAPS operativo

MAPS è un adapter tecnico trasversale: non è un'area di business e non amplia
la visibilità dei dati. L'API restituisce solo i layer consentiti da aree,
moduli, permission e scope Centro/Città/Zona del chiamante. I ruoli operativi
esistenti non ricevono automaticamente i permessi `maps.route` e
`maps.operational`: l'amministratore deve assegnarli esplicitamente.

> MAPS does not grant access to domain data. It only projects data already
> accessible to the caller.

`GET /maps/capabilities` elenca soltanto i provider effettivamente disponibili;
un provider non autorizzato o privo di localizzazione semantica non compare. I
provider iniziali sono interventi Sociali pianificati, consegne Pacchi, ritiri
non effettuati con domicilio utilizzabile e punti operativi. UDS resta separato:
non avendo oggi un luogo d'intervento semanticamente affidabile, non espone né
capability né marker. Le letture sono mantenute in endpoint distinti e
riapplicano server-side area, moduli e scope del dominio proprietario; non esiste
un archivio geografico generale interrogabile.

I percorsi esterni usano Google Maps URLs e non richiedono chiavi. Per la mappa
interattiva valorizzare `VITE_GOOGLE_MAPS_API_KEY` al momento della build web e
limitare la chiave in Google Cloud alle origini autorizzate e alla Maps
JavaScript API. Senza chiave restano disponibili lista operativa e percorsi.
La geocodifica avviene nel browser solo per i layer attivi; coordinate e
risultati Google non vengono persistiti né messi in cache dal server.
Vengono trasmessi a Google soltanto gli indirizzi necessari al geocoding o alla
navigazione: nomi, telefoni, codici beneficiario e contenuti sociali non fanno
parte dei DTO MAPS né degli URL. Un errore Google degrada la sola visualizzazione
embedded e non blocca Bolle, Consegne, stock o Interventi.

L'update idempotente `20260817_fase5_5_maps_ritiri.sql` aggiunge esclusivamente
i campi strutturati del ritiro non effettuato. Viene applicato dal normale
comando `pnpm --filter @workspace/db run update`; prima di aggiornare un database
esistente eseguire sempre il dump descritto nella sezione Docker.

Per verificare la fase eseguire codegen, typecheck, suite API e frontend e build
Docker `api web`. La Fase 5-5 non comprende ottimizzazione multi-tappa, tracking
GPS, analytics/heatmap, PostGIS o un layer UDS ricavato da dati non pertinenti;
queste estensioni restano candidate per la 5-5.2.

## Note

- I segreti vanno **solo** nel file `.env`, che è escluso dal versionamento.
  Non committare mai credenziali.
- Per i dettagli su architettura, moduli e convenzioni vedi `replit.md`.
