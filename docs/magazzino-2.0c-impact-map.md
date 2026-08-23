# MAGAZZINO 2.0C — IMPACT MAP

## Perimetro e fonti autorevoli

La 2.0C aggiunge rendicontazione FSE+, pacchetti di controllo, riconciliazione
AGEA/SIFEAD e reporting coerente senza introdurre una seconda contabilità. Le
fonti tecniche restano:

- `lotti.quantita_residua` per la giacenza operativa corrente;
- `movimenti` per saldi e flussi as-of, con Fondo e natura contabile congelati;
- `operazioni_distribuzione_magazzino` per le statistiche dell'evento;
- `importazioni_agea*` e `movimenti_esterni_agea` per la storia esterna;
- snapshot 2.0C immutabili soltanto per audit, export e riconciliazione.

Il formato esterno osservato nella 2.0B è utilizzabile solo come proiezione di
controllo. In assenza di una specifica ufficiale verificata resta classificato
`EXTERNAL_FORMAT_UNVERIFIED` e non è un formato di upload SIFEAD.

## Mappa degli impatti

| Area                        | Fonte/integrazione                                | Impatto 2.0C                                                     | Rischio principale           | Presidio                                                             |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------- |
| Ledger locale               | `movimenti`                                       | lettura as-of con cutoff ID/data; nessun saldo parallelo         | `ARCHITECTURAL_CONFLICT`     | query canonica unica, quantità Pezzi e Kg/Lt separate                |
| Partite e giacenze          | `lotti`, ledger                                   | residui solo per corrente; ledger per storico                    | `DATA_QUALITY_RISK`          | confronto as-of, nessun uso del residuo corrente per periodi storici |
| Operazioni di distribuzione | `operazioni_distribuzione_magazzino`              | un evento e statistiche non replicate sulle righe                | `BLOCKER`                    | chiavi deterministiche evento/riga e test eventi multi-riga          |
| Storni                      | `movimenti.movimento_origine_id`, natura `STORNO` | lordo, storno e netto distinti                                   | `DATA_QUALITY_RISK`          | coda manuale per storni parziali/statistiche non ripartibili         |
| Carichi                     | `carichi_magazzino*`, movimenti                   | inclusi per tracciabilità; AGEA già derivati da AdC non riemessi | `LEGACY_COMPATIBILITY`       | matrice di rendicontabilità esplicita                                |
| Resi                        | natura `RESO`                                     | rendicontati separatamente verso OpC                             | `REGRESSION_RISK`            | lineage e storno dedicati; nessuna correzione automatica stock       |
| Rettifiche                  | nature `RETTIFICA_*`                              | modifiche giacenza separate e motivate                           | `DATA_QUALITY_RISK`          | quality code su motivazione mancante                                 |
| Trasferimenti               | nature entrata/uscita                             | audit logistico, saldo organizzazione nullo                      | `ARCHITECTURAL_CONFLICT`     | mai conteggiati come distribuzione finale                            |
| Pacchi                      | canali `PACCHI`, `RITIRO_SEDE`                    | attività ufficiale Pacchi; canale interno preservato             | `DATA_QUALITY_RISK`          | pacchi e persone espliciti, null distinto da zero                    |
| Ritiro sede                 | `RITIRO_SEDE`                                     | aggregabile a Pacchi ma distinguibile                            | `REGRESSION_RISK`            | snapshot di entrambi i canali                                        |
| Domiciliare                 | `DOMICILIARE`                                     | attività ufficiale Domiciliare                                   | `DATA_QUALITY_RISK`          | persone esplicite; pacchi non inventati                              |
| Emporio                     | `EMPORIO`                                         | quantità dai movimenti, persone dall'evento                      | `ARCHITECTURAL_CONFLICT`     | nessuna conversione automatica spesa→pacco o credito→quantità        |
| Mensa                       | `MENSA`                                           | pasti/persone dall'evento, quantità dai movimenti                | `DATA_QUALITY_RISK`          | completezza DdC verificata per evento                                |
| UDS                         | `UDS_STRADA`                                      | attività ufficiale Strada                                        | `PRIVACY_RISK`               | aggregati strutturati, anonimi non deduplicati come persone          |
| Beneficiari/nuclei          | `beneficiari`, `nucleo_familiare`                 | indicatori strutturati alla data evento                          | `PRIVACY_RISK`               | export senza PII; nessuna euristica su attributi mancanti            |
| Importazioni AGEA           | `importazioni_agea*`                              | baseline confermata per riconciliazione                          | `DATA_MIGRATION_RISK`        | stesso Magazzino/scope, snapshot immutabili                          |
| Movimenti esterni AGEA      | `movimenti_esterni_agea`                          | delta cumulativo per identity/content hash                       | `DATA_QUALITY_RISK`          | occurrence/multinsieme, nessun numero riga come identità             |
| Export FSE+                 | nuove tabelle snapshot                            | formato canonico e formato osservato di controllo                | `EXTERNAL_FORMAT_UNVERIFIED` | avvertenza esplicita, hash canonico, cutoff, copertura attiva unica  |
| Riconciliazione             | nuove tabelle snapshot                            | confronto non mutante locale/esterno                             | `BLOCKER`                    | matching deterministico, ambiguità manuale, nessuna rettifica stock  |
| Report integrato            | builder reporting                                 | modello `MAGAZZINO_2_0C_V1`                                      | `ARCHITECTURAL_CONFLICT`     | un payload per UI, drill-down ed export generici                     |
| Dashboard iniziale          | dashboard e landing                               | delega ai builder integrati                                      | `REGRESSION_RISK`            | nessun KPI duplicato con formula divergente                          |
| Drill-down                  | reporting integrato                               | paginato, exact values, stesso scope                             | `PRIVACY_RISK`               | colonne operative senza PII                                          |
| Export XLSX/PDF generico    | payload reporting                                 | riuso del modello integrato                                      | `REGRESSION_RISK`            | nessuna query contabile alternativa; sicurezza formula Excel         |
| OpenAPI                     | `lib/api-spec/openapi.yaml`                       | nuovi contratti `/fse` e versione reporting                      | `REGRESSION_RISK`            | codegen deterministico e contract test                               |
| Client Orval/Zod            | output generato                                   | tipi/API React aggiornati solo via codegen                       | `LEGACY_COMPATIBILITY`       | non modificare manualmente file generati                             |
| Permission                  | seed ruoli e middleware                           | sei permessi `magazzino.fse.*`                                   | `PRIVACY_RISK`               | view non implica mutazioni; test RBAC                                |
| Scope                       | Area Operativa/Centro/Magazzino/Mensa/Zona        | ogni operazione amministrativa limitata a un Magazzino           | `BLOCKER`                    | controllo server-side e test IDOR                                    |
| Audit                       | testate/versioni/utenti e log sistema             | mutazioni e risoluzioni tracciate                                | `DATA_QUALITY_RISK`          | optimistic lock, motivazioni, nessuna cancellazione fisica           |
| Privacy                     | export, API, drill-down                           | solo aggregati e riferimenti operativi                           | `PRIVACY_RISK`               | esclusione nomi, CF, contatti, indirizzi e note sociali              |
| Performance                 | ledger/export/reconciliation                      | 100k+ movimenti, 10k+ eventi                                     | `REGRESSION_RISK`            | query set-based, batch, paginazione e indici mirati                  |
| Migration ledger            | nuova migration append-only                       | prima applicazione `NORMAL`, poi skipped                         | `DATA_MIGRATION_RISK`        | nessuna modifica al manifest/checksum storico                        |
| Docker                      | API/web e startup migration                       | verifica pending zero e restart                                  | `REGRESSION_RISK`            | build, first-start, health e restart smoke test                      |

## Conflitti da evitare

- Nessuna tabella di saldo operativo o residuo parallela.
- Nessuna classificazione FSE derivata da `lotti.fse_plus` quando il Movimento
  contiene già `fondo_origine`: il Movimento è lo snapshot autorevole.
- Nessuna somma tra Pezzi e Kg/Lt e nessuna conversione di `null` in zero.
- Nessuna duplicazione delle statistiche evento per riga prodotto-lotto.
- Nessun fuzzy auto-match e nessuna correzione automatica della contabilità.
- Nessuna dichiarazione di compatibilità upload per il formato osservato.
- Nessun backfill interpretativo di indicatori, canali o lineage storici.

## Sequenza di consegna

1. C1: modello canonico, qualità, monitoraggio ed export con snapshot.
2. C2: riconciliazione AGEA/SIFEAD non mutante.
3. C3: reporting `MAGAZZINO_2_0C_V1`, frontend e contratti generati.
4. Migration ledger, acceptance reale AGEA, regressione completa e smoke Docker.
