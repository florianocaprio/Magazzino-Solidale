# Magazzino 2.0A — Impact Map

Baseline verificata: `main` / `7466afa04d5fedafe7ee35fbf35ab64e34a471b0`.
Branch di lavoro: `feature/magazzino-2-0`.

## Architettura e fonte contabile

- Workspace `pnpm`, TypeScript, Express, Drizzle/PostgreSQL, OpenAPI/Orval,
  React/Vite e Vitest.
- La giacenza è derivata da `SUM(lotti.quantita_residua)`; `movimenti` è il
  ledger/audit e non costituisce una seconda tabella saldi.
- I servizi condivisi esistenti sono `inventoryLedger.ts` per carichi e
  rettifiche e `scaricoInventory.ts` per scarichi FEFO/storni.
- Emporio, bolle e trasferimenti hanno mutazioni FEFO specializzate che vanno
  integrate nel ledger 2.0 senza introdurre motori paralleli.
- UDS/interventi possiede già righe materiali strutturate
  (`interventi_materiali`) e chiama lo scarico condiviso; non serve un secondo
  modello prodotti UDS.

## Tabelle e campi coinvolti

Direttamente coinvolte:

- `prodotti`: anagrafica globale; `fse_plus` resta solo compatibilità/default UI.
- `lotti`: partita di stock; quantità, Fondo, lotto normalizzato, prima/ultima
  data di carico e fattore Pezzi/KgLt.
- `movimenti`: quantità, Fondo snapshot, natura contabile, doppia quantità e
  source lineage.
- `magazzini`, `fornitori`: scope e riferimenti di testata carico.
- nuove `carichi_magazzino` e `carichi_magazzino_righe`.
- nuova `operazioni_distribuzione_magazzino`.

Consumatori e collegamenti:

- `bolle`, `bolla_righe`, `prenotazioni_magazzino`, `consegne`;
- `scarichi`, `scarico_righe`;
- `trasferimenti`, `trasferimento_righe`;
- `spese_emporio`, `spese_emporio_righe`;
- `mensa_giornate_servizio`, `mensa_pasti`, `mensa_consumi` e storni;
- `interventi`, `interventi_materiali`, `beneficiari` per UDS;
- `system_logs` per l'audit applicativo privo di PII superflue.

## Punti reali di mutazione stock

- `inventoryLedger.ts`: crea lotto+movimento e rettifica residuo.
- `lotti.ts`: POST legacy e PATCH metadata-only/rettifica dedicata.
- `approvvigionamenti.ts`: ricezione tramite carico inventariale.
- `scaricoInventory.ts`: scarico FEFO e storno compensativo.
- `scarichi.ts`: scarico manuale/scarto.
- `interventi.ts`: materiali strutturati e scarico UDS/sociale.
- `mensa.ts`: consumo/scarto e storno tramite scarico condiviso.
- `speseEmporio.ts`: checkout FEFO e storno Emporio.
- `bollaDelivery.ts`: conversione prenotazioni in scarico e storno bolla.
- `trasferimenti.ts`: uscita FEFO, creazione partita destinazione e ingresso.
- `environmentData.ts`: seed/demo, da mantenere compatibile col nuovo schema.

## Precisione

I percorsi contabili usano oggi `numeric(10,2)`, `Number`, `parseFloat` e
`toFixed(2)`. La migration deve ampliare almeno `lotti`, `movimenti`, righe di
carico, prenotazioni, bolle/trasferimenti/scarichi e righe operative collegate a
`numeric(14,6)`. I fattori usano `numeric(18,9)`. I nuovi contratti espongono i
decimali come stringhe; i DTO legacy numerici restano compatibili dove non è
possibile cambiarli senza rotture.

## Fondo e provenienza

- Fonte autorevole del Fondo: riga di carico e partita; snapshot sul movimento.
- `lotti.fse_plus` diventa derivato da `fondo_origine = 'FSE_PLUS'`.
- Provenienza e documento sono autorevoli sulla testata/riga di carico.
- I campi legacy `lotti.fornitore_id` e `documento_carico` restano leggibili ma
  non vengono più sovrascritti quando una partita riceve un nuovo carico.
- Duplicati legacy sulla futura chiave partita non vengono fusi: restano
  marcati/ambigui e la chiave normalizzata viene applicata solo ai gruppi certi.

## API, OpenAPI e frontend

- Nuovi endpoint: `GET/POST /carichi`, `GET /carichi/{id}` e
  `GET /carichi/{id}/righe`.
- `POST /lotti` resta compatibility layer e usa il service multi-riga.
- `PATCH /lotti/{id}` resta metadata-only; quantità e Fondo non sono ammessi.
- `GET /lotti`, `GET /movimenti` e `GET /giacenze` ricevono filtri Fondo e
  provenienza; `fsePlusOnly=true` equivale a `FSE_PLUS`.
- `openapi.yaml` è la fonte dei client Orval; i file generati non saranno
  modificati manualmente.
- `lotti.tsx` evolve in “Carichi e Lotti” con viste Carichi, Partite/Lotti e In
  scadenza e dialog multi-riga; route legacy `/lotti` preservata.
- Query da invalidare: carichi, lotti, giacenze e movimenti.

## Scope e permission

- Lettura: `magazzino.view` con `visibleMagazzinoIds`/filtro via magazzino.
- Carico: `magazzino.stock.receive` e `canAccessMagazzino` server-side.
- Scarico/rettifica/trasferimenti: permessi esistenti invariati.
- Area Operativa è boundary hard; Centro è boundary additivo. Ogni FK
  `magazzinoId` ricevuta dal client viene verificata lato server.

## Test coinvolti

- `audit-magazzino-hardening`, migration progressive Magazzino, lotto policy,
  scarichi, giacenze/prenotazioni, bolle/prenotazioni, trasferimenti,
  cassa-emporio, Mensa, UDS hardening, reporting integrato, scoping magazzino e
  lock order.
- Nuovi test: migration 2.0A, carico multi-riga/rollback/idempotenza/matching,
  precisione, Fondo, source lineage e operazioni di distribuzione.

## Rischi e mitigazioni

- `DATA_MIGRATION_RISK`: duplicati legacy di partita; nessuna fusione automatica,
  indice parziale solo sui record non ambigui e preflight diagnostico.
- `REGRESSION_RISK`: API legacy espongono quantità come number; compatibilità
  preservata e nuove quantità precise come stringhe.
- `REGRESSION_RISK`: Emporio/bolle/trasferimenti hanno FEFO specializzato;
  modifiche limitate a decimalità e metadati condivisi, con test dedicati.
- `REGRESSION_RISK`: statistiche evento duplicate; persistite una volta sulla
  testata distribuzione, mai replicate come fonte di aggregazione sui movimenti.
- `ARCHITECTURAL_CONFLICT`: il vecchio vincolo FSE+ XOR fornitore è incompatibile
  con raccolte/donazioni senza fornitore; il nuovo service usa provenienza e Fondo
  separati e il POST legacy viene adattato.
- `LEGACY_COMPATIBILITY`: righe storiche ambigue possono avere lineage nullo e
  natura `LEGACY`; nessun dato storico viene inventato.
- `EXTERNAL_FORMAT_UNVERIFIED`: nessun parser/export/mapping AGEA viene
  implementato nel ciclo 2.0A.
