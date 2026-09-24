# M4 — Documento operativo comune

## Base e confine

La ricognizione M4A parte dal branch `codex/magazzino-workflow-unificato` alla
SHA locale/remota `8df6b823bb14604af0123ea62ce7b237b32561c8`. M3A, M3B e M3
complessivamente risultano chiusi; `NE-MAN-CAMERA` e `NE-MAN-TABLET` restano
prove hardware non eseguite.

M4A introduce la facciata comune e il destinatario tipizzato. Non introduce il
ciclo di custodia, mancata consegna e rientro di M4B.

## Censimento dei workflow alla base

| Workflow                 | Ingresso e stato                                                                          | Effetti/servizio autorevole                                                  | Audit, scope e prove esistenti                                                                  | Scelta M4A                                         |
| ------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Bolla beneficiario       | `pages/bolle.tsx`, `/bolle`; bozza, confermato, consegnato, annullato                     | prenotazione in `routes/bolle.ts`; uscita atomica in `completeBollaDelivery` | `auditEvent`, scope Centro/Area/Zona, test `bolle-prenotazioni` e `bolle-ritiro-non-effettuato` | estendere senza duplicare                          |
| Trasferimento            | `pages/trasferimenti.tsx`, `/trasferimenti`; richiesto/preparato, in transito, completato | `createTransferRequest`/`transferWorkflow`, ledger e regole lotto logico M2  | permessi distinti create/dispatch/receive, scope magazzini, `trasferimenti.test.ts`             | adattare alla facciata comune; aggregato invariato |
| Scarico manuale          | `pages/scarichi.tsx`, `/scarichi`                                                         | `scaricoInventory`, ledger e causali amministrative                          | audit e permessi stock issue/adjust                                                             | resta distinto                                     |
| Consultazioni            | Giacenze e Movimenti                                                                      | `disponibilitaMagazzino`, `inventoryLedger`                                  | scope Area/Magazzino e test M1B/M1C                                                             | consumer invariati                                 |
| Pianificazione personale | Consegne e Preparazione Consegne                                                          | riconciliazione e sincronizzazione Bolla/Intervento                          | scope Centro, reporting e distribuzione                                                         | solo beneficiario; mai Ente                        |

Sono stati inoltre censiti `lottoPolicy`, `logicalLots`, `InventoryDecimal`,
`productQuantity`, `inventoryQuantityDimensions`, `distributionLedger`,
`documentCode`, reporting FSE+/territoriale, schema e migrazioni, OpenAPI,
client/validatori generati, PDF e test M1–M3. Il lotto scelto nella riga Bolla
è bloccato e prenotato esclusivamente; FEFO è usato solo senza `lottoId`.

## Contratto M4A

- Identità comune: `bolla:<id>` oppure `trasferimento:<id>`.
- La lista comune è una query SQL server-side realmente mista, filtrata,
  contata e paginata; non concatena prime pagine nel browser.
- Il dettaglio comune risolve sempre l'aggregato autorevole e applica permessi
  e scope prima di restituirlo.
- `bolle` conserva Beneficiario ed Ente; `trasferimenti` conserva Altro
  Magazzino. Non esiste una testata ombra né un secondo ledger.
- Il vecchio URL Trasferimenti confluisce nella pagina comune; le route API
  verticali restano compatibili per i consumer esistenti.

## Precisazioni definitive del contratto M4A

Le regole seguenti precisano il requisito M4A. Sono vincolanti per il
candidato, ma non attestano da sole che implementazione, test formali o
validazione umana siano conclusi.

### Contabilità della consegna Ente

`CONSEGNA_ENTE` è un'uscita fisica distinta da `DISTRIBUZIONE_FINALE`. Nel
ledger la quantità resta positiva secondo la convenzione comune; il segno
`-1` deriva dalla natura contabile sia nella proiezione TypeScript sia nelle
query/report SQL. Bozza e conferma non riducono il fisico; la consegna lo
riduce una sola volta. La natura non crea beneficiari, nuclei, interventi,
pacchi o altri fatti sociali e non amplia l'ammissibilità FSE+/AGEA.

### Autorizzazione della facciata comune

L'accesso comune è l'unione controllata dei rami autorizzati, non
l'intersezione dei permessi Bolle e Trasferimenti:

- il ramo Bolla richiede modulo, permesso e scope propri delle Bolle;
- il ramo Trasferimento richiede modulo, permesso e scope propri dei
  Trasferimenti;
- lista, totale, ricerca ed export eliminano i rami non autorizzati prima di
  paginare o contare;
- dettaglio, PDF e ogni comando rivalidano il tipo e lo scope autorevole;
- lettura, creazione/modifica, partenza e ricezione restano diritti distinti;
  Mensa conserva il proprio contratto.

Il solo accesso Trasferimenti non espone Bolle o dati dei loro destinatari; il
solo accesso Bolle non concede azioni su Trasferimenti.

### Protocollo dei comandi

Ogni nuova intenzione mutante porta una `idempotencyKey` stabile e un hash del
payload semantico. Le mutazioni di un aggregato esistente portano anche la
versione attesa; una creazione non inventa una versione precedente. Il
backend acquisisce i lock, rilegge lo stato autorevole e applica nella stessa
transazione effetto, versione, audit obbligatorio e ricevuta del comando.

- stessa chiave e stesso payload restituiscono lo stesso esito senza un nuovo
  effetto;
- stessa chiave e payload diverso producono conflitto;
- una nuova intenzione con versione superata produce conflitto;
- prima di restituire un replay vengono rivalidati sessione, permessi, moduli
  e scope correnti;
- dopo una risposta incerta il client conserva chiave, payload e versione
  originari; una nuova chiave nasce soltanto da una nuova intenzione esplicita.

Adapter comuni, route verticali e consumer Mensa devono convergere sullo
stesso comando di dominio; non sono ammesse ricevute o transazioni parallele
che possano duplicare l'effetto.

### Snapshot documentale Ente

Alla conferma il backend legge l'anagrafica Ente autorevole e congela
denominazione, indirizzo e contatti previsti dal contratto. Da quel momento
dettaglio e ristampa usano lo snapshot, anche quando un campo congelato è
intenzionalmente nullo; i valori live successivi non lo riempiono né lo
sovrascrivono. La disattivazione dell'Ente non cancella la leggibilità dello
storico e impedisce soltanto nuove operazioni non ammesse.

Un documento legacy privo dell'indicatore di snapshot può usare un fallback
live esplicito e riconoscibile. Il fallback non viene presentato come
fotografia storica, non congela dati durante la lettura e non autorizza un
backfill indiscriminato.

### Annullamento e storno amministrativo

L'annullamento ordinario è motivato, opera prima dell'uscita fisica, libera
gli impegni e non crea movimenti inventariali di reintegro. Dopo una consegna
non viene riabilitato per rappresentare una mancata consegna o un rientro.

Lo storno amministrativo è un comando distinto, riservato al permesso
dedicato, con motivo, selezione delle righe, versione, idempotenza e audit.
Produce eventi compensativi collegati ai movimenti originari senza cancellare
o riscrivere la storia. Non sostituisce affidamento, `rientro_atteso` o
ricezione fisica del rientro, che restano M4B.

### Identità URL, lista ed export

La selezione canonica usa `documento=bolla:<id>` oppure
`documento=trasferimento:<id>`; tipo e ID partecipano a URL, stato UI, query
key, invalidazioni, comandi e PDF. Gli URL legacy realmente supportati sono
adattati alla forma canonica preservando i filtri e senza aggirare i controlli
di accesso. È aperto al massimo un dettaglio.

Lista, totale ed export derivano dallo stesso insieme misto server-side e
dagli stessi filtri autorizzati: tipo aggregato/destinatario, stato, date,
Area, Magazzino, Centro quando pertinente, ricerca e ordinamento. L'ordine è
deterministico anche a parità di data; l'export comprende l'intero insieme
filtrato, non soltanto la pagina visibile. Un cambio di scope separa le query,
impedisce risultati tardivi e conserva il draft oppure ne richiede
l'abbandono esplicito.

**Stato documentale.** Le decisioni sopra sono definitive per M4A. Il working
tree contiene un'implementazione candidata e prove mirate, ma il NO-GO della
revisione statica non è revocato: correzioni post-review e nuovo `##test M4A`
restano necessari prima di dichiarare implementato, validato o chiuso il
milestone.

## Destinatari

`enti_destinatari` è un'anagrafica minima distinta dai fornitori: denominazione,
indirizzo, contatti facoltativi, Area, attivo e timestamp. Creazione/modifica
sono protette dai nuovi permessi `enti-destinatari.view/manage`.

La Bolla usa un discriminatore immutabile e riferimenti esclusivi, protetti
anche da vincolo DB. Il legacy è classificato deterministicamente come
Beneficiario. Per l'Ente, nome e indirizzo sono congelati alla conferma; non si
creano beneficiari, interventi, pianificazioni o operazioni di distribuzione.
L'uscita inventariale usa la natura distinta `CONSEGNA_ENTE` e mantiene fondo,
provenienza, quantità e lineage.

## Stato corrente e obiettivo M4B

M4A conserva le macchine a stati esistenti e offre azioni veritiere. Una
richiesta Trasferimento non prenotata non viene presentata come disponibilità
garantita. La Bolla in bozza non muove né prenota stock; la conferma prenota;
la consegna converte una volta gli impegni in uscita. L'annullamento ordinario
è motivato e consentito solo prima dell'uscita fisica.

Obiettivo M4B, non implementato: `Pronta → In consegna → Consegnata`, oppure
`Pronta → In transito → Ricevuta`; dopo uscita fallita,
`Rientro atteso → ricezione fisica del rientro`. M4B dovrà completare
prenotazioni dei trasferimenti, affidamento, rientri e riconciliazione
complessiva senza ledger paralleli.

## Rischi e validazione successiva

La fase `##test M4A` deve esercitare su PostgreSQL isolato upgrade/fresh,
concorrenza, replay/idempotenza, scope e revoca, collisione degli ID, PDF,
lista mista, flussi Ente e regressioni complete M1–M3. La validazione manuale
deve restare distinta. L'ambiente Docker persistente non viene aggiornato in
sviluppo.

## Incremento M4B.1 nel working tree

Il primo incremento M4B realizza la prenotazione comune per Bolla e
Trasferimento. Il trasferimento segue `richiesto → preparato (Pronto) →
in_transito → completato`, con ramo di annullamento motivato solo prima
dell'uscita. `preparato` corrisponde a impegni attivi persistiti, non a un
badge informativo; `Avvia` converte esclusivamente tali impegni nel ledger.
La migrazione 41 è additiva, mantiene i dati legacy e aggiunge owner
esclusivo, FK coerenti e indici. La facciata comune, la pagina Trasferimenti
e Mensa espongono la sequenza e le partite prenotate.

Questo paragrafo aggiorna lo stato di sviluppo rispetto all'«Obiettivo M4B,
non implementato» storico sopra: il solo slice M4B.1 è presente nel working
tree. Mancano ancora `##test M4B.1` e validazione manuale; affidamento e
rientro M4B.2 non sono iniziati. Il Docker persistente rimane M4A.

## Incremento M4B.2 nel working tree (24 settembre 2026)

La base approvata M4B.1 è `98835207ed047dd764633b234ba91f87738c296b`.
M4B.2 aggiunge, senza alterare i dati storici, l'affidamento Bolla che
converte le prenotazioni in uscite fisiche, e la successiva consegna che
registra un evento `esito` a effetto fisico zero. La consegna diretta M4A
mantiene invece il proprio scarico fisico. Un servizio di finalizzazione
condiviso serve sia la Bolla sia la pagina Consegne.

Dopo mancata consegna o mancato arrivo, il documento passa a
`rientro_atteso`, senza alterare la giacenza. La riconciliazione prende le
partite dal ledger di uscita, esige quantità esatte per ciascun movimento e
registra un'unica testata con righe/classi collegate al movimento originario.
Il Magazzino di rientro è vincolato all'origine. Un vincolo owner esclusivo,
unicità per documento, FK composte e trigger PostgreSQL impediscono la
commistione tra documento, uscita, prodotto e lotto.

Idonea produce rientro `+Q` sul lotto originario; deteriorata/scaduta
producono rientro `+Q` e Scarico automatico `-Q` nello stesso commit;
mancante/rubata producono soltanto esito/documento di anomalia a effetto
fisico zero. Il documento di riconciliazione è stampabile come PDF derivato,
mentre gli scarti usano il documento Scarichi esistente. La classificazione
`altro` non esiste. Il ledger `movimenti` rimane unico: la proiezione del
segno fisico usa tipo/dettaglio del movimento, quella contabile distingue
distribuzione finale e custodia. Il reporting as-of è stato adattato per non
sottrarre due volte l'esito successivo all'affidamento.

La migrazione additiva è la 42. API, tipi generati, UI, test e documentazione
nel working tree costituiscono **solo sviluppo candidato**:
`DEV-M4B.2/NE-TEST/NE-MAN`. Il successivo `##test M4` deve ancora verificare
formalmente regressioni, upgrade popolato, build compatibile, review e
validazione manuale; il Docker persistente resta invariato.

## Verifica formale integrata M4

Il separato `##test M4`, registrato in `ESITI_TEST_M4.md`, ha verificato
insieme M4A diretto, le prenotazioni comuni M4B.1 e il ciclo fisico M4B.2.
La stessa quantità non è scaricata alla consegna dopo l'affidamento: il
ledger distingue uscita fisica, esito, distribuzione e rientro. Sono stati
testati anche il ramo Ente senza fatto sociale, il rientro Trasferimento
senza entrata al destino, scarto reale di merce deteriorata/scaduta e
anomalia non fisica di merce mancante/rubata. L'upgrade popolato 41→42 non
riclassifica i documenti storici e la migration 42 è in parità con Drizzle.

L'evidenza automatica non modifica il contratto approvato e non sostituisce
la prova manuale. Il Docker locale persistente rimane alla sua versione
precedente finché un mandato separato non ne autorizzerà l'aggiornamento.
