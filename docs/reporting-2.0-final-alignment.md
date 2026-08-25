# Reporting 2.0 — modello finale

## Scopo e contratto

Reporting 2.0 espone un contratto integrato versionato `REPORTING_2_0_V1`.
Dashboard, tabelle, grafici, drill-down ed export consumano il medesimo payload;
il dettaglio FSE di controllo viene caricato in pagine da 100 record dalla route
drill-down, senza ricostruire fatti inventariali nel browser.

Ogni risposta contiene filtri effettivi, KPI con `value` ed `exactValue`, unità,
disponibilità, serie, tabelle, qualità, definizioni, timestamp e timezone
`Europe/Rome`. `NULL` indica dato non disponibile e non viene trasformato in
zero. Pezzi, Kg/Lt, credito, documenti, eventi, nuclei, persone, pacchi e pasti
restano grandezze separate.

## Architettura e fonti autorevoli

- I fatti inventariali e FSE derivano da `movimenti`; il Fondo autorevole è
  esclusivamente `movimenti.fondo_origine`.
- Natura contabile, Movimento originale e Operazione di Distribuzione producono
  lordo, storni e netto. Le espressioni comuni sono in
  `reporting/fseCanonicalFacts.ts`.
- I canali canonici sono `PACCHI`, `RITIRO_SEDE`, `DOMICILIARE`, `EMPORIO`,
  `MENSA` e `UDS_STRADA`. Mensa e UDS non richiedono una Bolla.
- La giacenza corrente proviene dai Lotti; la giacenza as-of dai Movimenti
  firmati. Non vengono sommate le due fonti.
- Beneficiari FSE usa snapshot immutabili as-of; la proiezione
  `fse_fascicoli_sociali` resta operativa e non è una fonte storica.
- Territorio e dimensione del nucleo provengono dagli snapshot dell’evento. Il
  fallback all’anagrafica corrente è riservato ai record legacy ed è marcato
  come derivato.

## Matrice indicatori

| Sezione        | KPI                       | Fonte                                                    | Formula                                                                                 | Data evento                       | Scope                                    | Drill-down                                  | Qualità                                                    |
| -------------- | ------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| Generale       | Persone uniche            | Unione Bolle, Interventi, Spese, Pasti e UDS autorizzati | `COUNT(DISTINCT beneficiario_id)` sull’unione, senza sommare moduli                     | Data dell’evento concluso         | Area/Centro/Zona/Magazzino storici       | Non esposto                                 | Sorgenti non autorizzate escluse                           |
| Pacchi         | Pacchi distribuiti        | Bolle                                                    | Bolle `consegnato` escluse le Spese Emporio chiuse                                      | `data_bolla`                      | Snapshot Area/Centro e Magazzino         | Bolla                                       | Territorio legacy derivato                                 |
| Pacchi         | Nuclei serviti            | Bolle                                                    | Beneficiari distinti                                                                    | `data_bolla`                      | Snapshot evento                          | Nucleo                                      | Territorio legacy derivato                                 |
| Pacchi         | Persone raggiunte         | Bolle                                                    | Somma `numero_componenti_nucleo_snapshot` per nucleo distinto                           | `data_bolla`                      | Snapshot evento                          | Persona, se autorizzata                     | Nucleo legacy derivato; NULL preservato                    |
| Centro Ascolto | Interventi                | Interventi                                               | `ambito= social(e/legacy)` e `stato=concluso`                                           | conclusione/data intervento       | Snapshot Area/Centro                     | Intervento                                  | Classificazioni non inferite dalle note                    |
| Emporio        | Accessi                   | Consegne accesso Emporio                                 | Accesso effettivamente effettuato                                                       | data/ora effettiva                | Snapshot Area/Centro e Magazzino Emporio | Accesso                                     | Legacy derivato                                            |
| Emporio        | Spese                     | Spese Emporio                                            | `stato_spesa=chiusa`                                                                    | `data_chiusura` Europe/Rome       | Snapshot già presente sulla Spesa        | Spesa                                       | Credito separato dalle quantità                            |
| Mensa          | Pasti                     | Mensa pasti                                              | Eventi pasto registrati                                                                 | data/ora pasto                    | Mensa e relativo Magazzino               | Pasto                                       | Nessuna attribuzione di prodotti da trasferimenti generici |
| UDS            | Interventi/primi contatti | Interventi UDS                                           | Solo `ambito=uds`; primo contatto sull’intera storia                                    | data evento UDS                   | Snapshot Area/Zona                       | Intervento                                  | Legacy secondo compatibilità UDS                           |
| Magazzino      | Giacenza corrente         | Lotti                                                    | Somma residui per Prodotto e Magazzino                                                  | corrente                          | Magazzino autorizzato                    | Movimento/Lotto                             | Unità non convertibili separate                            |
| Magazzino      | Giacenza as-of            | Movimenti                                                | Somma firmata fino a data finale                                                        | `data_movimento`                  | Magazzino autorizzato                    | Movimento                                   | Pezzi e Kg/Lt separati                                     |
| FSE+           | Prodotti/quantità         | Movimenti                                                | Fondo Movimento FSE, distribuzione lorda meno storni                                    | `data_movimento`                  | Magazzino + canali autorizzati           | Movimento paginato                          | Operazione/canale/lotto mancanti espliciti                 |
| FSE+           | Pacchi/pasti              | Operazioni Distribuzione collegate a Movimenti FSE       | Conteggi evento solo se il netto non è zero                                             | data Movimento/operazione         | Canale e Magazzino autorizzati           | Movimento                                   | Storno parziale segnala conteggi non ripartibili           |
| FSE+           | Nuclei/persone/dimensioni | Movimenti FSE collegabili a Beneficiario + snapshot FSE  | Snapshot più recente con `data_riferimento <= filters.a`; a pari data versione più alta | data Movimento e data riferimento | Territorio evento + permessi             | Individuale solo con `beneficiari.fse.view` | Copertura, mancante, incompleto e derivato                 |

## Snapshot FSE

`fse_fascicoli_sociali_snapshot` registra data di riferimento, origine, batch,
utente, versione, dimensioni strutturate, attendibilità, hash canonico,
metadati qualità e lineage. Un trigger rifiuta UPDATE e DELETE diretti. È
consentita soltanto la cancellazione cascata dell’intera anagrafica, distinta
dalla correzione del Fascicolo e necessaria ai workflow privacy/retention.

Import, aggiornamento manuale ed export creano snapshot in transazione. La data
di riferimento è esplicita nel frontend, inclusa in preview e audit. Gli
aggiornamenti manuali usano optimistic locking. Un advisory lock per
Beneficiario serializza anche la prima creazione concorrente; la proiezione
corrente viene riletta dentro la transazione prima di determinare esito e
versione. Il vincolo univoco `(beneficiario_id, versione_profilo)` impedisce
versioni duplicate. Hash e chiave idempotente rendono invariato il replay dello
stesso contenuto alla stessa data, mentre una correzione crea una versione
autorevole strettamente successiva.

Il report seleziona solo snapshot non futuri. A parità di data ordina per
origine autorevole (`aggiornamento_manuale`, `import_fse`, `export_fse`), quindi
per versione, creazione e id. Export ripetuti non superano una versione manuale
o importata della stessa data e non producono duplicati. Le somme delle
dimensioni sono accompagnate da nuclei coperti, nuclei totali e nuclei senza
dato. Assenza e incompletezza non valgono zero.

## Snapshot evento e legacy

- Bolla: Area, Centro e numero componenti diventano definitivi alla consegna.
- Consegna: Area e Centro diventano definitivi al completamento.
- Accesso Emporio: Area e Centro sono acquisiti all’ingresso/checkout effettivo.
- Intervento Sociale: Area e Centro sono acquisiti prima della conclusione.
- UDS: conserva la semantica Area/Zona esistente.

Le colonne sono nullable e la migration non esegue backfill. I record legacy
usano fallback compatibile e generano qualità `territorioStoricoDerivato` o
`nucleoStoricoDerivato`. Modificare in seguito Area, Centro o nucleo del
Beneficiario non riscrive eventi conclusi.

Le FK degli snapshot territoriali usano `ON DELETE RESTRICT`: Area e Centro già
referenziati da fatti storici non possono essere cancellati. Trigger dedicati
consentono la prima valorizzazione server-side e impediscono riscrittura,
azzeramento o cancellazione diretta degli snapshot consolidati. Gli schemi
pubblici non accettano i campi server-managed.

## Hardening finale RPT-R1–R10

### Concorrenza import FSE (RPT-R1)

L’import acquisisce un advisory lock per Beneficiario anche quando il Fascicolo
non esiste ancora, rilegge lo stato nella transazione e assegna versioni
monotone. Il vincolo database sulla coppia Beneficiario/versione resta l’ultima
barriera. I test coprono prima creazione identica concorrente, due aggiornamenti
diversi concorrenti e replay invariato.

### Versionamento autorevole e precedenza snapshot (RPT-R7)

La selezione as-of usa un ordinamento centrale e deterministico: data di
riferimento, priorità della sorgente autorevole, versione, data creazione e id.
Manuale e import prevalgono sugli snapshot tecnici di export della stessa data;
un export ripetuto è idempotente.

### Storni canonici Pacchi ed Emporio (RPT-R2)

Originale e storno condividono Operazione, Bolla e Bolla Riga effettive tramite
fallback al Movimento originale. Quantità e Fondo provengono dal ledger
Movimenti: distribuzione lorda meno storni, senza riclassificare uno storno FSE
come non FSE. KPI, tabelle e drill-down eliminano i gruppi a netto zero e
mantengono separate le unità Pezzi e Kg/Lt.

### Copertura parziale FSE (RPT-R4)

Numero componenti, sesso ed età sono dimensioni indipendenti. Ogni aggregato
espone valore noto, nuclei coperti, totale e mancanti; uno snapshot parziale è
valido se i valori presenti sono non negativi e le somme vengono verificate
solo quando la dimensione è completa. `NULL` non diventa zero.

### Immutabilità snapshot evento (RPT-R3)

Bolle, Consegne, Interventi e Operazioni di distribuzione congelano Area,
Centro e, dove previsto, dimensione del nucleo. La prima valorizzazione è
consentita; modifica, clear e SQL diretto successivi sono bloccati. Le FK
storiche sono `RESTRICT` e la migration non effettua backfill.

### Magazzini condivisi e isolamento territoriale (RPT-R5)

L’Area del Magazzino non è usata come sostituto del territorio evento. In un
Magazzino condiviso, gli aggregati, i grafici, le tabelle e i drill-down
includono solo Operazioni con snapshot Area/Centro compatibile con il chiamante.
Gli ID diretti restano soggetti alla stessa validazione server-side.

### Eventi universali e legacy sconosciuti (RPT-R5)

La classificazione esplicita distingue `attribuito`, `universale` e
`legacy_sconosciuto`. Universali e legacy sono esclusi dai report di una singola
Area e restano visibili solo in scope globale autorizzato. Tre indicatori
separati segnalano territorio legacy mancante, evento universale ed evento
escluso per assenza di attribuzione.

### Adapter legacy e sunset (RPT-R6)

`GET /report/fse-plus` delega allo stesso builder integrato e applica le stesse
guard di area funzionale, modulo, permesso, sorgente e territorio senza
dipendere dal modulo Centro Ascolto. Gli header `Deprecation`, `Link` e `Sunset`
fissano il ritiro al 1 dicembre 2026.

### Qualità Pacchi (RPT-R8)

Le anomalie demografiche sono contate per nucleo/Beneficiario distinto; le
anomalie territoriali restano invece conteggi evento. Più Bolle dello stesso
nucleo non moltiplicano una singola mancanza anagrafica.

### Filtri frontend (RPT-R9)

Query string, opzioni autorizzate e scope bloccati vengono riconciliati anche
con cache React Query già calda. Date invertite, ID negativi, figli non più
compatibili e navigazione back/forward non producono chiamate con filtri
obsoleti.

### I18n e accessibilità (RPT-R10)

Card, import/export Beneficiari FSE e strumenti Reporting usano chiavi presenti
nelle sei lingue supportate. Label, placeholder e `aria-label` restano
localizzati; l’arabo conserva il rendering RTL senza mostrare chiavi raw.

## RBAC, scope e privacy

Tutte le route Reporting richiedono Area `analisi`, modulo `REPORT`, area della
sorgente e gli eventuali permessi dedicati. Gli ID di Centro, Magazzino, Mensa e
Zona vengono risolti lato server e confrontati con lo scope; un ID fuori
perimetro produce 403 generico senza rivelare il nome della risorsa. Lo scope
storico non usa automaticamente la semantica `OR NULL`.

`magazzino.fse.view` autorizza soltanto aggregati anonimi e controllo
inventariale. `beneficiari.fse.view` è inoltre necessario per i drill-down di
nuclei/persone e non amplia Area o Centro. Il dettaglio prodotti FSE non espone
codice Beneficiario. Nomi, cognomi, codice fiscale, contatti, indirizzi e note
non entrano nei payload aggregati o negli export Reporting.

## Filtri e usabilità

I filtri seguono Area → Centro → Magazzino/Mensa/Zona. Cambiare un genitore
azzera i figli, salvo i valori imposti dal ruolo. URL obsolete vengono
riconciliate con le opzioni autorizzate; caricamento opzioni fallito, assenza di
opzioni e filtri bloccati hanno messaggi espliciti. Back/forward ripristinano lo
stato dalla URL.

Per FSE l’anno corrente termina alla data civile odierna Europe/Rome; un anno
passato termina al 31 dicembre. Il periodo effettivo è sempre visibile. KPI
mancanti e derivati non sono presentati come zero e risultano cliccabili solo se
il backend pubblica una metrica drill-down.

## Export e flussi amministrativi

PDF/XLSX usano il payload integrato e `exactValue`. Il controllo FSE pagina il
medesimo drill-down prodotti; mantiene Fondo, natura, canale, operazione,
Movimento originale e codici qualità. Reporting analitico, export
amministrativo, import AGEA, import Beneficiari FSE e riconciliazione restano
flussi separati.

Nessuna trasmissione FSE è automatica. Il file prodotto è un file di controllo,
non una trasmissione ufficiale.

## Endpoint legacy

`GET /report/fse-plus` è un adattatore verso `buildFsePlusReport` e restituisce
`Deprecation`, `Link` e `Sunset` (1 dicembre 2026). Non contiene una formula FSE
autonoma. Gli endpoint specialistici non duplicati restano disponibili; la
sottoscorta legacy aggrega quantità per Prodotto/Magazzino e non conta i Lotti.

## Migration e indici

Le migration `20260828_reporting_2_0_final_alignment.sql` e
`20260829_reporting_2_0_hardening.sql` sono additive, idempotenti e senza
backfill. Aggiungono storia FSE, metadati della proiezione corrente, snapshot
evento, classificazione territoriale, FK/constraint, trigger e indici
as-of/reporting. Il runner riconosce 27 migration e verifica checksum, ordine e
replay.

## Limiti dichiarati

- I prodotti trasferiti a una Mensa non provano il consumo nel singolo Pasto.
- Le misure di accompagnamento non sono inferite da tipologie o note libere.
- Uno storno parziale rende nette le quantità, ma i conteggi evento non sono
  ripartibili senza una nuova fonte: il report mostra un warning.
- Un Movimento storico senza operazione, canale o Lotto resta visibile al
  responsabile Magazzino nel proprio scope e porta codici qualità.
- Gli eventi legacy territorialmente sconosciuti non possono essere attribuiti
  retroattivamente senza una fonte storica attendibile e restano esclusi dagli
  scope di singola Area.
- Un export FSE è un file di controllo: la trasmissione ufficiale a SIFEAD resta
  manuale e fuori dal perimetro applicativo.

## Verifica

La verifica comprende migration update/verify/replay, typecheck, test backend
mirati e completi, test frontend mirati e completi, codegen OpenAPI, build e
`git diff --check`. I comandi e gli esiti effettivi sono riportati nella Draft
PR e nel resoconto della task.
