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
- Lo **storno** non modifica il ledger storico: crea movimenti compensativi collegati alla sorgente e riconcilia l'operazione come `confermata`, `parzialmente_stornata` o `stornata` in base alle quantità nette. La stessa riconciliazione avviene dopo l'inserimento completo di nuovi movimenti `DISTRIBUZIONE_FINALE`, così lo stato rappresenta sempre l'intero ledger dell'operazione.
- La **giacenza deriva dalle Partite** come somma delle quantità residue, non dalla somma dei movimenti.

## Precisione Pezzi/KgLt

Le quantità stock, le prenotazioni, le scorte minime e i limiti quantitativi usano `numeric(14,6)` e sono serializzati dalle API contabili come stringhe decimali esatte. Pezzi e Kg/Lt possono coesistere; l'eventuale fattore usa `numeric(18,9)` ed è salvato anche come snapshot sul Movimento. Il helper centrale usa interi `BigInt`, quantità a scala 6, fattori a scala 9 e arrotondamento `HALF_UP` a scala 6. Un numero con più di sei decimali o in notazione scientifica non rappresentabile viene rifiutato, mai arrotondato implicitamente.

## Carico e concorrenza

Il service multi-riga valida prima i riferimenti, acquisisce advisory lock per idempotency key e in ordine deterministico per le chiavi di Partita, crea o incrementa le Partite compatibili, scrive righe e movimenti e infine l'audit. Qualsiasi errore provoca il rollback completo. La key è associata a magazzino e SHA-256 del payload normalizzato (testata e righe ordinate): stesso scope e stesso hash producono replay, contenuto o magazzino diverso producono conflitto. L'hash non è esposto dalle API; i carichi precedenti a R1 con hash nullo non vengono reinterpretati automaticamente.

## Origini e provenienza

Le origini manuali ammesse sono `RACCOLTA_ALIMENTARE`, `DONAZIONE`, `ACQUISTO`, `FORNITORE` e `ALTRO`. `AGEA_SIFEAD`, `RETTIFICA_INVENTARIO`, `SALDO_INIZIALE` e `LEGACY` sono riservate ai flussi di sistema e vengono rifiutate dal Carico manuale. Il filtro `origineCaricoPresente` sui Lotti significa “esiste almeno un Carico collegato con questa origine” e usa `EXISTS`, quindi non duplica la Partita. La Giacenza non espone un filtro di provenienza: una Partita può derivare da più Carichi, mentre il Fondo resta una proprietà univoca della Partita.

## Migrazione legacy

La migration è additiva e ripetibile. Esegue il backfill del Fondo dal flag storico FSE+, amplia la precisione e normalizza soltanto gruppi lotto univoci. Durante un nuovo Carico una sola Partita legacy compatibile può essere adottata aggiornandone la chiave normalizzata; due o più candidate producono `PARTITA_LEGACY_AMBIGUA` e nessuna fusione o nuova Partita. I movimenti preesistenti ricevono natura `LEGACY`; i riferimenti storici mancanti restano una compatibilità esplicita, non vengono inventati.

## Compatibilità

Gli endpoint storici di Lotto restano disponibili e delegano al nuovo motore per i carichi singoli. Il `PATCH /lotti/{id}` consente soltanto le note: identità, quantità, Fondo, fattore, magazzino, prodotto e date non sono modificabili. Le variazioni di stock passano dalla rettifica append-only. Il flag FSE+ della Partita resta soltanto compatibilità legacy. Dalla 2.0C la rendicontazione e il reporting autorevole leggono lo snapshot `movimenti.fondo_origine`; non riclassificano retroattivamente il Fondo dal lotto. Gli alias numerici restano solo per compatibilità di visualizzazione; le decisioni contabili e gli export usano i campi decimali precisi.

## Qualità dati nota

Il modello corrente non contiene una classificazione strutturata saltuario/continuativo per il destinatario UDS. I relativi conteggi dell'evento restano quindi `NULL` (`NON_DETERMINATO` concettuale): non vengono inferiti da nomi, note, frequenza degli accessi o stato anagrafico.

La fase 2.0B aggiunge il solo import del tracciato AGEA/SIFEAD osservato. Staging, mapping e indice canonico esterno sono separati dalla giacenza; il bootstrap e i nuovi carichi positivi delegano sempre al motore `createWarehouseLoad()` della 2.0A. I movimenti negativi del registro non generano scarichi locali. Dettagli e limiti sono in [Magazzino 2.0B — Import AGEA/SIFEAD](./magazzino-2.0b-agea-import.md).

La fase 2.0C aggiunge snapshot non operativi di export, monitoraggio e riconciliazione. La giacenza corrente resta nei residui delle Partite e lo storico nel ledger. Vedere [Rendicontazione FSE+ 2.0C](./magazzino-2.0c-fse-reporting.md).
