# Magazzino 2.0C — rendicontazione FSE+

## Scopo e confine esterno

La 2.0C produce un modello canonico interno, pacchetti XLSX auditabili e una
proiezione del registro AGEA/SIFEAD già osservato. Non trasmette dati a SIFEAD.
La proiezione osservata è un file di controllo, non un formato ufficiale di
upload. Fino alla disponibilità di specifica, esempio ufficiale, prova sul
portale e autorizzazione esplicita, il confine resta:

```text
EXTERNAL_FORMAT_UNVERIFIED
```

Non esiste né deve essere introdotto un formato `SIFEAD_UPLOAD_*` sulla base di
inferenze. I riferimenti funzionali verificati sono le [Istruzioni Operative
n. 99/2025](https://pninclusione21-27.lavoro.gov.it/sites/default/files/2025-11/Istruzioni_Operative_n._99_2025.pdf)
e le [Istruzioni Operative n. 22/2026](https://pninclusione21-27.lavoro.gov.it/sites/default/files/2026-03/Istruzioni_Operative_n.22.2026_0.pdf).

## Unica contabilità e modello canonico

`MAGAZZINO_2_0C_R1_V2` non introduce saldi operativi paralleli:

- corrente: residui delle Partite in `lotti`;
- storico/as-of: ledger append-only `movimenti`;
- Fondo: snapshot `movimenti.fondo_origine`, mai il flag legacy del lotto;
- statistiche DdC: `operazioni_distribuzione_magazzino`, una volta per evento;
- Pezzi e Kg/Lt: due dimensioni distinte, decimali fixed-point a scala 6;
- cutoff: coppia immutabile `maxMovimentoId` e
  `maxOperazioneDistribuzioneId`, oltre alla data as-of Europe/Rome.

Un evento canonico identifica sorgente, Magazzino, data, canale interno e
attività ufficiale. Una riga canonica identifica esattamente un Movimento,
prodotto, Partita/lotto, Fondo, natura, lineage e quantità con segno. Chiavi e
SHA-256 derivano da JSON canonico ordinato. Pacchi, pasti, saltuari e
continuativi appartengono all'evento e non vengono moltiplicati per le righe.

### Canali

| Canale interno | Attività ufficiale | Regola                                           |
| -------------- | ------------------ | ------------------------------------------------ |
| `PACCHI`       | Pacchi             | diretto                                          |
| `RITIRO_SEDE`  | Pacchi             | aggregabile, ma il canale interno resta visibile |
| `DOMICILIARE`  | Domiciliare        | pacchi solo se rilevati esplicitamente           |
| `EMPORIO`      | Emporio            | credito non è quantità di magazzino              |
| `MENSA`        | Mensa              | pasti da evento, quantità dai Movimenti          |
| `UDS_STRADA`   | Strada             | anonimi non deduplicati come persone             |
| `ALTRO`/null   | non classificata   | blocco qualità                                   |

Un evento con Fondi misti include soltanto le righe FSE+ e riceve
`EVENTO_FONDI_MISTI`; le statistiche evento restano indivisibili e contate una
sola volta.

## Matrice di rendicontabilità

| Natura                       | Disposizione canonica           | Effetto                                 |
| ---------------------------- | ------------------------------- | --------------------------------------- |
| `DISTRIBUZIONE_FINALE`       | `DA_RENDICONTARE_DDC`           | uscita FSE+ e statistiche evento        |
| `CARICO` AGEA/SIFEAD         | `GIA_PRESENTE_REGISTRO_ESTERNO` | audit, non riemesso come nuovo carico   |
| `CARICO` locale              | controllo amministrativo        | non inventare compatibilità portale     |
| `SALDO_INIZIALE`             | audit baseline                  | apertura locale alla data registro      |
| `RESO`                       | `RESO_OPC`                      | separato dalle distribuzioni            |
| `RETTIFICA_*`/`SCARTO`       | `MODIFICA_GIACENZA`             | motivazione obbligatoria/quality        |
| `STORNO`                     | storno separato                 | compensazione con lineage all'originale |
| trasferimento entrata/uscita | `SOLO_AUDIT_TRASFERIMENTO`      | mai distribuzione finale                |
| Fondo diverso da `FSE_PLUS`  | escluso dal pacchetto FSE+      | resta nel ledger generale               |

Gli storni parziali non ripartiscono statistiche indivisibili: il record resta
auditabile e viene segnalato per la gestione manuale. Originale e storno non
ancora inseriti possono convivere nel nuovo pacchetto; se l'originale è già
marcato inserito, lo storno resta una nuova voce di rettifica manuale.

## Qualità DdC e monitoraggio

I blocchi minimi comprendono Fondo legacy non determinato, operazione o canale
mancante, statistiche DdC mancanti, evento misto, lotto/fattore/mapping
mancante, storno parziale non ripartibile, motivazione rettifica mancante e
snapshot indicatori storico mancante. Un dato mancante resta `null`, mai zero.

Le rilevazioni mensili Pacchi/Mensa/Strada sono snapshot versionati e auditati.
Contengono fasce 0–17, 18–29, 30–64, 65+, non determinata, donne, dati mancanti
e saltuari dichiarati. L'età si valuta alla data dell'evento/rilevazione; note,
frequenza, domicilio e anonimi UDS non generano inferenze.

## Export e workflow manuale

Periodo di competenza e copertura amministrativa sono assi distinti. La coda
include gli eventi del periodo e, con `includeArretrati=true`, gli eventi
precedenti non ancora coperti; esclude invece gli eventi con copertura attiva
in un export amministrativo pronto o già inserito. Eventi, righe e qualità
sono filtrati e paginati in SQL (`page`, `pageSize`, `total`, `rows`,
`summary`) per stato, canale, Fondo, prodotto e quality code.

Stati evento: `DA_RENDICONTARE`, `ARRETRATO_NON_RENDICONTATO`,
`IN_ESPORTAZIONE`, `INSERITO_MANUALMENTE`, `BLOCCATO`, `ANNULLATO` e
`CORREZIONE_DA_GESTIRE_MANUALMENTE`. Stati pacchetto:
`GENERATA_CON_BLOCCHI` o `PRONTA_PER_INSERIMENTO_MANUALE`, quindi
`INSERITA_MANUALMENTE`; solo un pacchetto non inserito può essere annullato.
Un pacchetto con blocchi è `AUDIT_ONLY` e non crea copertura amministrativa.
Gli export pre-R1 non dimostrabili sono
`LEGACY_2_0C_REVIEW_REQUIRED`, senza promozione automatica.

Formati disponibili:

- `FSE_CANONICAL_AUDIT_XLSX_V1`: pacchetto interno autorevole;
- `SIFEAD_REGISTRO_OSSERVATO_CONTROLLO_V1`: proiezione di controllo con
  avvertenza esplicita.

Il pacchetto canonico contiene Metadati, Eventi, Righe prodotto-lotto, Carichi,
Distribuzioni, Storni, Resi, Modifiche giacenza, Trasferimenti audit, Saldi
as-of, Indicatori e Qualità. I saldi sono raggruppati per Magazzino, Fondo,
prodotto e lotto, con Pezzi e Kg/Lt separati. I testi che iniziano con `=`, `+`,
`-` o `@` sono neutralizzati contro formula injection; non vengono generate
macro. Nomi, codice fiscale, contatti, indirizzi, note sociali e altre PII non
sono esportati.

Eventi, righe, indicatori, saldi, lineage e metadati sono materializzati nello
snapshot alla creazione. Entrambi i download sono proiezioni dello stesso
snapshot e non interrogano Movimenti, Partite o rilevazioni live: modifiche
successive non cambiano hash o contenuto del file già creato.

Creazione e replay usano advisory lock, idempotency key, cutoff e hash canonico.
La copertura attiva di evento/riga è unica. L'annullamento disattiva la
copertura ma conserva lo snapshot. La marcatura `INSERITA_MANUALMENTE` richiede
data e riferimento esterno: è una dichiarazione auditata dell'operatore, non
una trasmissione automatica.

## Resi verso OpC

Il flusso dedicato usa `POST /fse/resi-opc` e
`POST /fse/resi-opc/{id}/storno`, protetti da `magazzino.fse.return`. Il reso
accetta selezione FEFO o Partita esatta, ma preleva esclusivamente Fondo
`FSE_PLUS`. Destinazione OpC, motivazione e chiave di idempotenza
sono obbligatorie. Lo scarico conserva Fondo e Lotto nel Movimento con natura
`RESO`; lo storno ripristina il Lotto esclusivamente tramite un Movimento
compensativo `STORNO`. La versione passa da 1 a 2 e una versione stale produce
`409`; non esistono aggiornamenti diretti dello stock né saldi paralleli.

## API, permessi e scope

Gli endpoint `/api/fse/rendicontazione`, `/api/fse/exportazioni` e
`/api/fse/monitoraggio`, inclusi i resi OpC, riapplicano lo scope
Magazzino/Area Operativa/Centro.
Le liste e i dettagli voluminosi sono paginati, massimo 200 record. Un export
amministrativo appartiene a un solo Magazzino.

Permessi: `magazzino.fse.view`, `magazzino.fse.export`,
`magazzino.fse.monitoring.manage` e `magazzino.fse.return`; la sola view non
abilita mutazioni. Tutte le mutazioni versionate rifiutano versione
assente/malformata con 400 e stale con 409.

## Chiusura 2.0C-R2

`scopeRequestHash` identifica Magazzino, periodo, arretrati, cutoff e scopo
amministrativo prima che la copertura influenzi la query. Uno scope attivo
identico è replay; dopo annullamento è una nuova generazione auditata. Se non
restano elementi amministrativi scoperti e non esistono blocker, la creazione
termina con `409 NESSUN_DATO_DA_RENDICONTARE` senza testata vuota.

La coverage confronta `eventKey/contentHash` e `lineKey/contentHash`. Una linea
tardiva sotto un evento inserito non ripropone le precedenti: produce
`CORREZIONE_DA_GESTIRE_MANUALMENTE`. Le statistiche di un'operazione con
Movimenti collegati sono immutabili. Il registro osservato usa saldi
progressivi snapshot fixed-point per Magazzino/Fondo/prodotto/lotto, con Pezzi
e Kg/Lt separati e senza `Number`, `parseFloat` o `toFixed` contabili.
