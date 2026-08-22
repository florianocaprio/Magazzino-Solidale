# Magazzino 2.0A — modello contabile

## Concetti e invarianti

- Il **Carico** è la testata del documento o dell'evento in entrata; la sua provenienza descrive il canale di acquisizione e non il finanziamento.
- La **Riga di carico** registra prodotto, quantità operativa, unità, Fondo e dati del lotto fisico. Tutte le righe vengono contabilizzate nella stessa transazione.
- La **Partita** è l'istanza contabile di stock rappresentata da `lotti`. Può non avere un lotto fisico: un codice `NULL` crea sempre una nuova Partita.
- Il **lotto fisico** è identificato conservativamente da magazzino, prodotto, Fondo e codice normalizzato. Lo stesso lotto può ricevere più carichi compatibili.
- Il **Fondo** (`FSE_PLUS`, `FONDO_NAZIONALE`, `FONDO_NAZIONALE_COFINANZIATO`, `NESSUN_FONDO`) appartiene alla Partita. `Prodotto != Fondo` e il flag storico del prodotto non trasforma una Partita libera in FSE+.
- `Prodotto != provenienza` e `Documento di carico != lotto`: provenienza e documento sono proprietà del Carico.
- Il **Movimento** è append-only, fotografa il Fondo della Partita e porta natura contabile e source lineage strutturata.
- La **natura contabile** distingue carico, distribuzione finale, trasferimenti, rettifiche, scarto, storno e record legacy.
- L'**Operazione distribuzione** raccoglie sorgente, magazzino, data, canale e statistiche dell'evento. Le statistiche appartengono all'evento e non sono duplicate su ogni movimento.
- Il **canale operativo** distingue `PACCHI`, `RITIRO_SEDE`, `DOMICILIARE`, `EMPORIO`, `MENSA`, `UDS_STRADA` e `ALTRO`.
- Il **source lineage** usa dominio, tipo entità, id entità e id riga; ogni distribuzione finale ha una sorgente strutturata.
- Lo **storno** non modifica il ledger storico: crea movimenti compensativi collegati alla sorgente e marca l'operazione come stornata.
- La **giacenza deriva dalle Partite** come somma delle quantità residue, non dalla somma dei movimenti.

## Precisione Pezzi/KgLt

Le quantità stock usano `numeric(14,6)` e sono serializzate dalle nuove API come stringhe decimali esatte. Pezzi e Kg/Lt possono coesistere; l'eventuale fattore usa `numeric(18,9)`. I calcoli server-side passano da un tipo fixed-point basato su interi, senza `number` JavaScript nel nucleo contabile.

## Carico e concorrenza

Il service multi-riga valida prima i riferimenti, acquisisce advisory lock in ordine deterministico per le chiavi di Partita, crea o incrementa le Partite compatibili, scrive righe e movimenti e infine l'audit. Qualsiasi errore provoca il rollback completo. Una idempotency key ripetuta restituisce il Carico esistente senza duplicazioni.

## Migrazione legacy

La migration è additiva e ripetibile. Esegue il backfill del Fondo dal flag storico FSE+, amplia la precisione e normalizza soltanto gruppi lotto univoci. Partite legacy duplicate non vengono fuse: il codice normalizzato resta `NULL` e il caso è classificato `DATA_MIGRATION_RISK`. I movimenti preesistenti ricevono natura `LEGACY`; i riferimenti storici mancanti restano una compatibilità esplicita, non vengono inventati.

## Compatibilità

Gli endpoint storici di Lotto restano disponibili e delegano al nuovo motore per i carichi singoli. Il `PATCH` del Lotto è solo anagrafico: quantità e Fondo non sono modificabili. I report FSE+ possono continuare a leggere il flag compatibile, che ora è vincolato al Fondo della Partita.

## Qualità dati nota

Il modello corrente non contiene una classificazione strutturata saltuario/continuativo per il destinatario UDS. I relativi conteggi dell'evento restano quindi `NULL` (`NON_DETERMINATO` concettuale): non vengono inferiti da nomi, note, frequenza degli accessi o stato anagrafico. La mappatura AGEA resta esplicitamente `EXTERNAL_FORMAT_UNVERIFIED` e fuori dal ciclo 2.0A.
