# Magazzino 2.0B-R1 — Impact map

## Addendum R2

R2 parte dall'HEAD `0bb134c6721ef07db62c286477a3aa14ee91592f` dello
stesso branch e chiude soltanto sei residui, senza migration e senza ampliare il
perimetro 2.0B:

| Residuo R2 | Correzione | Verifica |
| --- | --- | --- |
| Race bootstrap/Partita locale | helper business key, candidate lookup e party lock condivisi con `createWarehouseLoad()`; revalidation sotto lock e `409 PREVIEW_DA_RICALCOLARE` | Partita manuale creata dopo preview: zero `SALDO_INIZIALE`, stock invariato e zero identity parziali; due bootstrap: un vincitore |
| Lotto ledger | limite unico 80 in parser, correzione API, preflight, OpenAPI e UI, senza troncamento del raw | 80 accettato; 81 da API rifiutato; 81 da file bloccante e correggibile |
| Conteggi | `IDENTITA_AMBIGUA` esclusa da `righeNuove` e conteggiata in `righeAmbigue`; stati specifici preservati | dataset con una nuova, duplicata, modificata e ambigua |
| Preview mapping dirty | stato frontend per importazione selezionata; conferma disabilitata fino al ricalcolo riuscito | mapping → dirty/disabled; ricalcolo `PRONTA` → clean/enabled |
| Error responses | `AgeaErrorResponse` e response comuni `400/403/404/409/413/415`, client Orval e Zod rigenerati | contract test per tutti i path AGEA R2 e fixer binario a cardinalità esatta |
| Data gruppo documento | chiave gruppo senza data carico effective; preflight dinamico e guardia in conferma | data uniforme: un Carico multi-riga; date divergenti: `DATA_CARICO_GRUPPO_INCOERENTE` e zero Carichi |

Restano invariati il fixed-point, i raw AGEA, il mapping umano, la conferma
atomica, `createWarehouseLoad()` come unico motore e l'esclusione dei movimenti
negativi dallo stock.

## Obiettivo e confini

R1 consolida l'import locale AGEA/SIFEAD introdotto dalla 2.0B. L'intervento resta
nel branch `feature/magazzino-2-0`, non modifica i flussi 2.0C, Logistica o
`zone_uds`, non ricostruisce gli scarichi storici e non rende la PR pronta al merge.

Baseline verificata prima delle modifiche: HEAD
`41f72a97ced424819f4f36ab58b237f38a10331b`, branch
`feature/magazzino-2-0`, PR #24 aperta e draft, working tree pulito e branch
allineato a `origin/feature/magazzino-2-0` (`0/0`).

I finding bloccanti della review erano: dipendenza XLSX vulnerabile; rebuild che
non sostituiva mapping A→B; identità Partita legata alla descrizione esterna;
assenza di correzioni operative; versione non vincolante; conferma mutante;
scadenza/fattore incompleti nell'incrementale; saldi negativi trasformabili in
valori assoluti; chiave idempotente troncata; query/insert non compatibili con il
limite dichiarato; contratto e wizard incompleti.

## Aree coinvolte

| Area                               | File principali                                                                                    | Modifica R1                                                                                                               | Rischio                                             | Verifica                                                                            |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Dipendenze XLSX                    | `artifacts/api-server/package.json`, `artifacts/magazzino-solidale/package.json`, `pnpm-lock.yaml` | sostituzione di `xlsx@0.18.5` con SheetJS 0.20.3 distribuito dal CDN ufficiale                                            | regressioni di lettura/scrittura workbook           | dependency tree, audit, parser sintetico e file reale                               |
| Parser e normalizzazione           | `artifacts/api-server/src/lib/ageaSifeadParser.ts`                                                 | normalizzazione NFC/case/whitespace uniforme; difese ZIP, macro, embed e formule cached; identity completa e non troncata | falsi equivalenti o righe non riconosciute          | test header dinamici/statici, NFD, firme/ZIP, prototype pollution, documenti lunghi |
| Staging e preview                  | `lib/db/src/schema/ageaImports.ts`, nuova migration R1, `ageaImportService.ts`                     | campi raw/effective, snapshot mapping/versione, identità partita definitiva, rebuild completo e batch                     | perdita correzioni manuali o duplicazione quantità  | mapping A→B, disable/enable, many-to-one, dataset grande                            |
| Correzioni manuali                 | route AGEA, service, OpenAPI, wizard                                                               | correzioni versionate di data carico, lotto e scadenza con motivazione e rimozione                                        | scritture stale o modifica dello storico confermato | 400/409, audit old/new, data civile, rebuild atomico                                |
| Concorrenza                        | `ageaImportService.ts`, `routes/agea.ts`                                                           | versione obbligatoria, lock pessimista, preflight puro in conferma, replay validato                                       | doppio bootstrap o conferma su preview obsoleta     | race mapping/recalc/correzione/cancel/conferma e doppia conferma                    |
| Contabilità bootstrap/incrementale | `ageaImportService.ts`, `inventoryLedger.ts`, `routes/carichi.ts`                                  | partite aggregate per prodotto/fondo/lotto; propagazione scadenza/fattore/lotto; saldo finale con segno coerente          | stock duplicato, lotto/scadenza incoerenti          | many-to-one, scadenza obbligatoria, riuso lotto, secondo import identico            |
| API e client generato              | `lib/api-spec/openapi.yaml`, output Orval, fixer binario                                           | filtri formali, endpoint descrizioni da mappare, payload versione/motivazione e risposte errore                           | divergenza runtime/contratto                        | codegen deterministico e contract test                                              |
| Wizard                             | `artifacts/magazzino-solidale/src/components/agea-import-wizard.tsx`                               | paginazione/filtri reali, gestione mapping e correzioni, annullamento e conferma permission-aware                         | azioni ambigue o dati di preview incompleti         | test UI e typecheck/build frontend                                                  |
| Audit                              | `system_logs` tramite route/service AGEA                                                           | eventi per mapping, rebuild, correzioni, conflitti, conferma/replay/annullamento                                          | traccia incompleta o dati binari nei log            | asserzioni evento/dettaglio e assenza blob                                          |
| Migrazione                         | `lib/db/updates/20260823_magazzino_2_0b_r1_agea_hardening.sql`                                     | migrazione additiva e idempotente, indici e vincoli R1                                                                    | impatto involontario sui dati business              | applicazione doppia su clone e invarianti conteggi                                  |

## Invarianti contabili

- Il bootstrap crea un solo carico `SALDO_INIZIALE`; le righe negative restano
  esclusivamente movimenti esterni di riferimento.
- `RESO` resta `RESO_RIFERIMENTO`; distribuzioni e negativi ignoti restano
  scarichi esterni, mai stock locale nella 2.0B-R1.
- Due descrizioni esterne mappate allo stesso prodotto, fondo e lotto producono
  una sola partita e una sola riga di bootstrap, senza sommare due volte il saldo.
- Se due Partite confluiscono con scadenze manuali discordanti, il rebuild
  produce `CORREZIONI_PARTITA_CONFLITTO` e richiede una risoluzione esplicita.
- Una conferma usa esclusivamente la versione `PRONTA` già revisionata; non
  ricalcola né muta la preview implicitamente.
- Importazioni `CONFERMATA` e `ANNULLATA` sono immutabili. Il replay è
  idempotente ma richiede comunque una versione valida e corrente.

## Compatibilità e rollback

La migration R1 è solo additiva: nessun `DROP`, `DELETE` o `TRUNCATE`. I campi
raw esistenti restano immutati e i nuovi campi effective vengono inizializzati
dai valori già presenti. Il rollback applicativo consiste nel tornare alla
versione precedente del codice; le colonne e gli indici additivi possono restare
nel database senza alterare i flussi preesistenti.

La struttura resta compatibile con gli invarianti 2.0A/R1/R2: usa soltanto
`createWarehouseLoad()`, le dimensioni fixed-point e il ledger locale esistente.
Staging e ledger esterno lavorano in chunk deterministici (500 righe per insert e
update preview, 1.000 identity per lookup); il test PostgreSQL genera 2.200 righe,
oltre la soglia di un insert ingenuo, mentre parser e API conservano il limite di
10.000 righe senza introdurre cache applicative non transazionali.

## Gate di revisione

La consegna richiede installazione e audit dipendenze, codegen, typecheck/build,
test mirati e completi API/frontend, migration applicata due volte con invarianti,
acceptance sul registro reale esterno al repository e smoke Docker API/web. Il
file reale, database temporanei, log e altri asset locali non entrano nel commit.
