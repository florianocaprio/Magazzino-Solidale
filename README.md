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

Il comando `update` usa il DB Migration Ledger 1.0-R1 in `app_meta`: verifica il
manifest SHA-256 e il confine immutabile della storia legacy, quindi acquisisce
in ordine il lock compatibile con il runner storico e il lock globale nuovo.
Applica soltanto i file pendenti, registrando SQL e ledger nella stessa
transazione. Alla prima adozione su un database esistente esegue un ultimo
replay sicuro della storia censita e la registra; i run successivi verificano i
checksum e saltano le migration già applicate.

Comandi diagnostici non distruttivi:

```bash
pnpm --filter @workspace/db run migrations:status
pnpm --filter @workspace/db run migrations:verify
```

`migrations:verify` su un ledger non inizializzato riporta tutti i file come
pending e può terminare con exit code 0: questo conferma soltanto la coerenza
del piano locale, non l'adozione. Un gate di rilascio richiede sia ledger
inizializzato sia zero pending.

Prima del gate PRE-2.0C e prima di qualunque futura prova su clone Hetzner
eseguire esplicitamente con Node.js 24:

```bash
pnpm --filter @workspace/db run test:migrations
```

Una migration applicata non deve essere modificata, rimossa o rinominata. Le
nuove migration devono essere append-only e avere un filename strettamente
successivo al confine legacy, anche prima dell'adozione. Non esistono comandi
automatici di repair o rebaseline. Se un clone fallisce la verifica legacy,
fermarsi e ricreare il clone dal backup oppure ottenere una decisione DBA
reviewata, senza modificare SQL storici, checksum o manifest. La procedura
completa è in
[`docs/db-migration-ledger.md`](docs/db-migration-ledger.md).

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

### Aggiornamento hardening Beneficiari

L'update `20260819_audit_beneficiari_hardening.sql` aggiunge soltanto
`beneficiari.versione integer NOT NULL DEFAULT 1`, usata per l'optimistic
locking. È idempotente e non modifica i dati anagrafici esistenti. Su database
esistenti applicarlo con il normale comando `update`, mai con `push-force`.
Prima dell'avvio verificare il backup; dopo l'update controllare almeno:

```sql
SELECT count(*) FROM beneficiari;
SELECT data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'beneficiari' AND column_name = 'versione';
SELECT count(*) AS beneficiari_senza_area FROM beneficiari WHERE area_operativa_id IS NULL;
SELECT count(*) AS membri_nucleo_orfani
FROM nucleo_familiare nf
LEFT JOIN beneficiari b ON b.id = nf.beneficiario_id
WHERE b.id IS NULL;
```

I Beneficiari legacy senza Area restano leggibili secondo lo scope storico, ma
non possono essere creati nuovamente senza Area. La FK del nucleo non viene
aggiunta automaticamente: eventuali record orfani devono essere bonificati con
una decisione funzionale prima di una futura migration dedicata.

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
export XLSX/PDF consumano lo stesso payload `MAGAZZINO_2_0C_V1`. I KPI
contabili espongono `exactValue` decimale per decisioni/export e una proiezione
numerica separata per i grafici; `null` non viene trasformato in zero. Area Operativa, Centro e Zona UDS
sono sempre riapplicati dal backend; per Mensa resta necessario anche il
permesso `mensa.reports.view`.

Le route storiche `/report-uds`, `/mensa/report` e i componenti legacy delegano
ai builder integrati. La dashboard iniziale usa lo stesso builder generale e
non conserva KPI paralleli. Le limitazioni del modello SIFEAD sono mostrate
come dati mancanti, mai convertite in zeri o inferenze da note libere.

### Magazzino 2.0C — FSE+

La route `/report/fse-plus` aggiunge la sezione operativa Rendicontazione FSE+
con tab di coda, esportazioni, riconciliazioni, indicatori e anomalie. Il
sistema genera snapshot auditabili ma non trasmette automaticamente dati a
SIFEAD. `SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1` è soltanto un file di
controllo: il formato upload resta `EXTERNAL_FORMAT_UNVERIFIED`.

L'update append-only `20260824_magazzino_2_0c_fse_reporting.sql` aggiunge
soltanto snapshot di monitoraggio, export e riconciliazione. Non aggiunge una
tabella di saldo e non modifica la contabilità 2.0A/2.0B. Applicarlo tramite il
Migration Ledger dopo backup e preflight; verificare poi zero pending e
riavviare soltanto la nuova versione applicativa. Dettagli:

Il correttivo append-only R1 è
`20260825_magazzino_2_0c_r1_reporting_hardening.sql`: completa snapshot di
indicatori/saldi, copertura amministrativa, request hash/idempotenza, saldi di
riconciliazione e audit delle risoluzioni. La migration 2.0C precedente e il
manifest storico restano immutati. Gli export pre-R1 sono classificati
conservativamente `LEGACY_2_0C_REVIEW_REQUIRED`. La coda distingue competenza,
arretrati e copertura; i download canonico e osservato derivano dal medesimo
snapshot immutabile. Il formato esterno resta `EXTERNAL_FORMAT_UNVERIFIED`.

- [rendicontazione ed export FSE+](docs/magazzino-2.0c-fse-reporting.md);
- [riconciliazione AGEA/SIFEAD](docs/magazzino-2.0c-reconciliation.md);
- [modello reporting](docs/magazzino-2.0c-reporting-model.md);
- [impact map](docs/magazzino-2.0c-impact-map.md).

## MAPS operativo

MAPS è un adapter tecnico trasversale: non è un'area di business e non amplia
la visibilità dei dati. L'API restituisce solo i layer consentiti da aree,
moduli, permission e scope Centro/Area Operativa/Zona del chiamante. I ruoli operativi
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
Gli indirizzi sono dati personali: vengono trasmessi a Google soltanto quelli
strettamente necessari al geocoding o alla navigazione. I DTO MAPS sono
minimizzati e non includono nomi, telefoni, codici beneficiario, note o contenuti
sociali; questi dati non fanno parte neppure degli URL. Un errore Google degrada
la sola visualizzazione embedded e non blocca Bolle, Consegne, stock o Interventi.

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

### Magazzino 2.0C-R2

R2 usa `scopeRequestHash` prima del calcolo della coda e rifiuta con
`NESSUN_DATO_DA_RENDICONTARE` i pacchetti amministrativi vuoti. La copertura
confronta chiave e contenuto; le righe tardive diventano correzioni
deterministiche. Operazioni già collegate a Movimenti sono immutabili, i saldi
progressivi fixed-point sono congelati nello snapshot e il lifecycle delle
righe di riconciliazione garantisce target attivi univoci. Resta valido
`EXTERNAL_FORMAT_UNVERIFIED`.
