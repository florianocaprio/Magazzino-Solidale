# Magazzino 2.0B — Import AGEA/SIFEAD

## Hardening R1 (23 agosto 2026)

La revisione R1 usa SheetJS 0.20.3 dal CDN ufficiale, conserva i valori raw e
applica una normalizzazione conservativa NFC/case/whitespace soltanto alle
chiavi di confronto. Restano attivi i limiti di 10 MB, 10.000 righe e 100
colonne e le difese contro ZIP64, cifratura, path traversal, macro, oggetti
incorporati, ZIP bomb e formule prive di valore cached.

Ogni mutazione di una preview richiede `versione` intera positiva. Una versione
mancante/non valida produce `400 VERSIONE_RICHIESTA`; una versione superata
produce `409 VERSIONE_NON_CORRENTE`; una preview confermata o annullata produce
`409 IMPORTAZIONE_IMMUTABILE`. Il client deve ricaricare l'importazione e
ripetere consapevolmente l'azione. La conferma non ricalcola la preview: se una
mappatura è cambiata restituisce `409 MAPPING_MODIFICATO` e richiede un
ricalcolo esplicito. Anche il replay di una conferma richiede la versione
corrente dell'importazione confermata.

Le correzioni manuali sono dati di staging effective e non sovrascrivono mai i
raw acquisiti. Sono disponibili:

- `PATCH /agea/importazioni/{id}/righe/{rigaId}/data-carico`;
- `PATCH /agea/importazioni/{id}/righe/{rigaId}/lotto`;
- `PATCH /agea/importazioni/{id}/partite/{partitaId}` per la scadenza.

Ogni payload contiene valore (anche `null` per rimuovere), motivazione e
versione. La scrittura, l'audit, il rebuild e l'incremento singolo di versione
avvengono nella stessa transazione. Le date sono validate come date civili.

`GET /agea/importazioni/{id}/descrizioni-da-mappare` restituisce tutte le
descrizioni distinte dell'importazione, non solo la pagina visibile, con
frequenza, fondi e mapping corrente. La preview righe supporta formalmente
`page`, `pageSize`, `stato`, `fondo`, `tipo` e `q`.

Le partite mappate usano l'identità prodotto interno + fondo + lotto effective;
descrizioni esterne diverse dirette allo stesso prodotto confluiscono quindi in
una sola partita senza duplicare il saldo. Le descrizioni originali rimangono
nel dettaglio di audit. Scadenze manuali discordanti durante un merge molti-a-uno
producono `CORREZIONI_PARTITA_CONFLITTO`, senza scegliere silenziosamente un
valore. Saldi finali negativi o con segni misti sono bloccanti.

Nel flusso incrementale lotto, scadenza e fattore canonico provengono dalla
partita di preview. La chiave idempotente è un SHA-256 stabile, indipendente da
ID importazione e ordine righe, e non tronca il documento sorgente prima del
calcolo.

## Perimetro

La 2.0B importa localmente il registro informatico AGEA/SIFEAD nel tracciato osservato `SIFEAD_REGISTRO_XLSX_OSSERVATO_V1`. Non trasmette dati a SIFEAD, non esporta registri, non riconcilia gli scarichi locali e non aggiunge dashboard AGEA. Il file binario non viene conservato: restano nome sanitizzato, MIME, dimensione, SHA-256, foglio, data di riferimento, versione parser e valori raw di ogni riga.

## Tracciato e parser

Il parser accetta esclusivamente `.xlsx` con MIME OpenXML, firma ZIP, massimo 10 MB, 10.000 righe e 100 colonne. Preferisce il foglio `Table1` quando valido; in assenza accetta un solo foglio conforme. Le 19 colonne sono verificate esattamente, incluse le due intestazioni dinamiche `Giacenza al DD/MM/YYYY Pezzi` e `Giacenza al DD/MM/YYYY KgLt`, che devono riportare la stessa data.

I decimali vengono trasformati immediatamente in fixed-point a scala 6; non vengono usati `parseFloat` o somme IEEE-754 per decisioni contabili. Le date accettate sono `DD/MM/YYYY` o date Excel valide. Le formule non vengono valutate: è usato soltanto l'eventuale cached value. Il placeholder osservato `23` in data carico, note e statistiche è preservato nel raw audit e produce warning, ma non diventa data, nota o statistica.

Mapping Fondo:

- `FSE+` → `FSE_PLUS`;
- `Fondo Nazionale` → `FONDO_NAZIONALE`;
- `Fondo Nazionale cofinanziato` → `FONDO_NAZIONALE_COFINANZIATO`.

Le righe sono classificate come `CARICO`, `DISTRIBUZIONE`, `RESO`, movimento negativo non classificato, segno incoerente o riga senza movimento. Nessuna riga negativa modifica lo stock nella 2.0B.

## Staging e identità

Le tabelle additive sono:

- `importazioni_agea`: testata, conteggi, modalità, stato, versione e audit;
- `importazioni_agea_righe`: raw audit, valori normalizzati, snapshot mapping, identity/content hash e stato riga;
- `importazioni_agea_partite`: preview dei saldi per Fondo/prodotto/lotto;
- `mappature_prodotti_esterni`: mapping globale esplicito della descrizione AGEA al prodotto interno;
- `movimenti_esterni_agea`: indice canonico delle righe esterne già acquisite; non è una seconda giacenza.

L'identità usa una base SHA-256 dei campi stabili, un'occorrenza deterministica nel multinsieme e un content hash separato. Il saldo finale del registro non appartiene all'identità né al content hash. Una identity nota con contenuto diverso diventa `MODIFICATO_NEL_REGISTRO` e blocca la conferma; una identity e contenuto già noti è duplicata.

Il mapping normalizza soltanto Unicode NFC, case, trim e spazi multipli. Non usa fuzzy matching o AI e non crea prodotti. Le righe acquisiscono uno snapshot di mapping, prodotto, descrizione e unità; gli aggiornamenti futuri del mapping non riscrivono gli import storici.

## Modalità e contabilizzazione

### Prima acquisizione

`PRIMA_ACQUISIZIONE` richiede il mapping di tutte le descrizioni, saldi coerenti, scadenze richieste risolte e assenza di Partite locali equivalenti. Crea un solo Carico di sistema `SALDO_INIZIALE`, datato alla data del registro e con una riga per ciascuna Partita a saldo positivo. Tutti i carichi storici positivi vengono marcati `ASSORBITO_SALDO_INIZIALE`; distribuzioni e resi restano riferimenti esterni. Un indice univoco impedisce due bootstrap confermati sullo stesso Magazzino.

### Aggiornamento

`AGGIORNAMENTO` richiede un bootstrap precedente. Il registro completo viene confrontato con `movimenti_esterni_agea`; soltanto i nuovi carichi positivi sono raggruppati per documento/data/mittente e passati a `createWarehouseLoad()` con origine di sistema `AGEA_SIFEAD`. Duplicati, distribuzioni e resi non generano stock. Tutti i gruppi vengono creati nella stessa transazione esterna.

### Solo analisi

`SOLO_ANALISI` conserva staging e preview ma non crea Carichi, Partite, Movimenti stock né identità canoniche che impediscano un successivo import operativo.

La conferma acquisisce lock su importazione e Magazzino, ricontrolla versione, scope, mapping, saldi, date, scadenze, bootstrap e identity, poi aggiorna staging e audit nello stesso commit. Qualsiasi errore provoca rollback completo.

## API e permessi

Gli endpoint sono sotto `/api/agea`:

- importazioni: lista, analisi binaria, dettaglio, righe paginate/filtrabili, Partite, ricalcolo, conferma e annullamento;
- mapping: lista, associazione e aggiornamento esplicito;
- Partite preview: completamento manuale della scadenza quando richiesto.

Permessi:

- `magazzino.agea.view`;
- `magazzino.agea.import`;
- `magazzino.agea.mapping.manage`;
- `magazzino.agea.bootstrap`.

Ogni accesso a un'importazione è verificato sul Magazzino mediante gli scope Area Operativa e Centro. Il `magazzinoId` ricevuto dal client non è considerato autorevole.

## UI

La pagina “Carichi e Lotti” contiene la tab “Import AGEA/SIFEAD” con sette sezioni: selezione, analisi, mapping, Partite, righe, preflight e conferma. Il pulsante di conferma è disabilitato finché lo stato non è `PRONTA`. Orval 8 serializza come JSON i body non-form anche quando OpenAPI dichiara `format: binary`; il comando di codegen applica quindi un post-process deterministico e verificato che fa inviare il `Blob` raw dal client generato. Un piccolo adapter riusa lo stesso metodo e i tipi generati.

## Esecuzione migration

Applicare in ordine:

```sh
pnpm --filter @workspace/db run update
```

Le migration dedicate, applicate in ordine, sono:

- `lib/db/updates/20260822_magazzino_2_0b_agea_import.sql`;
- `lib/db/updates/20260823_magazzino_2_0b_r1_agea_hardening.sql`.

La seconda è additiva e idempotente, inizializza soltanto campi di staging,
aggiunge indici di identity/mapping/Partita e non altera i saldi business.

## Acceptance osservata

Il file reale resta esterno al repository. Il test può essere abilitato con:

```sh
AGEA_ACCEPTANCE_XLSX=/percorso/al/registro.xlsx \
pnpm --filter @workspace/api-server exec vitest run tests/agea-sifead-parser.test.ts
```

Aggregati attesi: data 20/08/2026, 239 righe, 80 carichi, 159 movimenti
negativi (158 distribuzioni e 1 reso), 53 descrizioni prodotto, 79 Partite
storiche, 3 Fondi, 19 gruppi documento/data positivi e 7 Partite a saldo
positivo. Il bootstrap atteso crea 1 `SALDO_INIZIALE`, 7 righe e 7 movimenti
positivi, senza movimenti negativi o scarichi locali. La seconda importazione
identica produce 239 identity duplicate, zero nuovi Carichi e zero variazioni di
stock.
