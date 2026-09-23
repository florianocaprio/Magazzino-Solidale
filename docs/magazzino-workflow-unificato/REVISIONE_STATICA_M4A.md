# M4A — Revisione statica del candidato locale

Data: 19 settembre 2026

Branch: `codex/magazzino-workflow-unificato`

Base locale/remota verificata:
`8df6b823bb14604af0123ea62ce7b237b32561c8`.

## Esito

**NO-GO.** Il delta M4A non è pubblicabile: la revisione ha individuato
finding bloccanti nei gate G2, G3 e G4. Le lacune non sono una singola
correzione locale, ma coinvolgono contratto dei comandi, autorizzazioni della
facciata, reporting contabile, compatibilità e copertura E2E. Per evitare di
produrre un candidato parzialmente corretto, il codice di sviluppo è stato
preservato e la fase si è fermata prima di creare il laboratorio PostgreSQL.

## Censimento del delta

Il working tree contiene modifiche M4A in:

- schema e migrazione 40 per `enti_destinatari`, destinatario tipizzato Bolla,
  snapshot, motivo annullamento e versione;
- API Enti, facciata di lettura `documenti-operativi`, Bolle, consegna Ente e
  adattamento del dettaglio Trasferimento;
- OpenAPI e output React/Zod generati;
- pagina Bolle/Consegne, riuso dei form Trasferimento, redirect del vecchio
  percorso, PDF e localizzazioni;
- test backend mirati e documentazione M4A.

Le prime 39 migrazioni tracciate non risultano modificate; il quarantesimo file
è nuovo e non tracciato. Non sono emerse modifiche estranee a M4A, ma il delta
include un ampio churn di formattazione su file legacy: 30 file tracciati,
`7.407` inserimenti e `2.654` rimozioni nel diff ordinario. Prima di una futura
pubblicazione il delta deve tornare piccolo e revisionabile oppure il churn deve
essere giustificato e riesaminato integralmente.

## Finding bloccanti

### F1 — `CONSEGNA_ENTE` ha segno contabile errato nei consumer comuni

**Controesempio.** Una consegna Ente da 4 pezzi riduce il residuo del lotto, ma
`accountingSign({ naturaContabile: "CONSEGNA_ENTE" })` restituisce `+1` perché
la nuova natura non è inclusa nelle nature negative. Anche
`signedMovementSql` la tratta come entrata. La riconciliazione la classifica
come generica modifica di giacenza.

**Impatto.** T06 non può dimostrare `30 - 4 = 26` nelle proiezioni fisiche e
negli export: ledger e reporting possono divergere pur mantenendo corretto il
residuo della partita.

**Evidenza.** `inventoryAccounting.ts` aggiunge la natura, mentre
`artifacts/api-server/src/lib/fseAccounting.ts` righe 4–50 e
`fseReconciliation.ts` righe 407–427 non la propagano.

**Correzione richiesta.** Definire esplicitamente segno, disposizione e
storno di `CONSEGNA_ENTE` in tutti i consumer contabili/reporting, quindi
aggiungere prove su pezzi, kg/litri, fondi e export senza trasformarla in
distribuzione finale a persona.

### F2 — la facciata Trasferimenti impone modulo e permesso Bolle

**Controesempio.** Il backend comune applica
`requireAllModuli(["MAGAZZINO_SOLIDALE", "BOLLE"])` prima di distinguere il
tipo documento. Il frontend `/bolle` richiede entrambi i moduli e
`bolle.view`; `/trasferimenti` reindirizza direttamente lì. Un ricevente con
`magazzino.view` e `magazzino.transfers.receive`, ma senza Bolle, perde il
percorso legittimo.

**Impatto.** Violazione diretta di T21 e T22. La regressione esistente lo
conferma: `navigation-permissions.test.ts` non trova più la voce
`trasferimenti` protetta da `magazzino.view`.

**Evidenza.** `documenti-operativi.ts` righe 15–18; `App.tsx` righe 105–110,
359–361 e 499–509; rimozione della voce da `components/layout.tsx`.

**Correzione richiesta.** La facciata deve essere accessibile con l'unione dei
moduli/permessi pertinenti e filtrare server-side ogni aggregato; UI e menu
devono usare guard `any` coerenti senza riabilitare funzioni spente. Mensa deve
restare separata.

### F3 — manca il contratto end-to-end di versione e idempotenza

**Controesempio.** POST/PATCH Enti non accettano versione, idempotency key o
hash. Creazione, PATCH, righe, conferma, consegna e annullamento Bolla non
espongono un contratto di replay. La colonna `bolle.versione` viene incrementata
solo in alcune transizioni ma non viene verificata nei payload. La creazione
Trasferimento non propaga l'`idempotencyKey` già supportata dal servizio; avvio
e ricezione usano la versione, ma un retry dopo risposta persa diventa un nuovo
comando stale invece di un replay riconoscibile.

**Impatto.** T15–T18 non sono implementabili con il contratto attuale. Un POST
Ente/Bolla ripetuto può creare duplicati; due PATCH possono perdere
aggiornamenti; una risposta persa non è distinguibile da una nuova intenzione.

**Evidenza.** `enti-destinatari.ts` righe 48–152;
`bolle.ts` righe 805–1052, 1110–1275, 1536–1648 e 2122–2258;
`trasferimenti.ts` righe 681–778. OpenAPI non dichiara key/hash/versione per i
nuovi comandi.

**Correzione richiesta.** Progettare un solo dominio di idempotenza per gli
adapter comuni e legacy, rileggere dopo lock, verificare versione e hash nella
stessa transazione e conservare key/payload nel browser dopo esito incerto.
Servono test PostgreSQL concorrenti deterministici ed E2E con risposta persa.

### F4 — gli snapshot Ente congelati non sono autorevoli in lettura/PDF

**Controesempio.** La conferma scrive nome e indirizzo snapshot, ma il dettaglio
e la lista preferiscono sempre i valori live dell'Ente con
`live ?? snapshot`. Dopo una modifica anagrafica, una ristampa di un documento
confermato mostra i dati nuovi.

**Impatto.** T26 e T27 falliscono; il documento emesso non è ristampabile in
modo coerente.

**Evidenza.** `bolle.ts` righe 277–280 e 769–771, a fronte del congelamento
alle righe 1588–1615. Il PDF consuma il dettaglio così costruito.

**Correzione richiesta.** Definire bozza versus documento emesso e usare lo
snapshot come fonte autorevole dopo il congelamento, lasciando il fallback
legacy esplicito e riconoscibile. Telefono/email e altri dati logistici devono
seguire un contratto documentato.

### F5 — lista comune incompleta rispetto al contratto M4A

**Controesempio.** La query server accetta solo destinatario, stato,
Magazzino, Centro, pagina e limite. Mancano tipo aggregato, Area, intervallo
date, ricerca, ordinamento selezionabile ed export dell'insieme filtrato. La UI
offre solo stati Bolla, quindi non permette di filtrare correttamente gli stati
Trasferimento.

**Impatto.** T24 non è coperto e l'esperienza comune non soddisfa il mandato.

**Evidenza.** `documenti-operativi.ts` righe 31–57 e 120–131; OpenAPI della
nuova GET; `pages/bolle.tsx` costruisce soltanto tre filtri e non espone export
comune.

**Correzione richiesta.** Completare contratto, query deterministica e export
server-side; provare più pagine, date uguali, collisione ID, filtri e scope.

### F6 — il percorso legacy e lo stato URL non identificano il documento

**Controesempio.** `/trasferimenti` copia solo la query string corrente su
`/bolle`; la selezione di una riga aggiorna stato React locale, non una URL
composta. Non esiste una prova di vecchio dettaglio →
`trasferimento:<id>` né di refresh/deep link del documento aperto.

**Impatto.** T23 e T25 restano non dimostrati e il redirect può portare alla
lista anziché al documento richiesto.

**Correzione richiesta.** Definire URL canonica composta, adapter per tutte le
vecchie URL realmente esistenti e query key/invalidation correlate al tipo.

### F7 — lo storno amministrativo Bolla non è più raggiungibile

**Controesempio.** L'endpoint ordinario `/annulla` ora respinge correttamente
una Bolla consegnata, ma il precedente test di storno append-only è stato
sostituito con l'attesa `409`; `stornoRigaTx` rimane soltanto un helper usato
direttamente dai test e non esiste una route amministrativa sostitutiva.

**Impatto.** T14 richiede che il normale Annulla non reintegri merce, ma anche
che gli storni legacy autorizzati restino tracciati e protetti. Il candidato
risolve il primo requisito rimuovendo il secondo.

**Evidenza.** `bolle.ts` righe 2161–2172; diff di
`bolle-prenotazioni.test.ts` nel caso rinominato “non usa il normale
annullamento…”. Nessun consumer runtime di `stornoRigaTx` resta nel codice.

**Correzione richiesta.** Conservare un comando amministrativo distinto,
motivato, autorizzato, idempotente e auditato, senza esporlo nel normale flusso
operativo.

### F8 — copertura formale insufficiente

Il solo nuovo file backend contiene due test. Copre un riferimento destinatario
combinato e un happy path Ente; non prova i vincoli SQL direttamente, Enti
CRUD/scope/revoca, lista multipagina, reporting, collisioni ID, replay,
concorrenza, audit failure, feature flag, URL, PDF reale o UI. Non esistono
nuovi test frontend di pagina/dialoghi/retry né E2E M4A.

Il primo run frontend pertinente ha prodotto `47 pass / 1 fail`; pertanto la
suite non può essere promossa a gate verde e T01–T32 non possono essere
certificati per inferenza dai test M1–M3.

## Finding secondari da affrontare nello stesso hardening

- POST Ente accetta un `areaOperativaId` intero ma non positivo e non traduce
  la FK inesistente in errore controllato; per un amministratore può emergere
  un errore DB 500 invece del rifiuto richiesto da T01.
- La disattivazione Ente e la creazione Bolla non sono serializzate: il check
  `attivo` avviene fuori dalla transazione che inserisce la Bolla.
- Il dettaglio comune è implementato, ma la UI usa direttamente i due endpoint
  legacy; occorre dimostrare che ciò non crea domini di cache/comando distinti.
- Il test helper `makeScopedApp` dichiara esplicitamente di bypassare
  sessioni/RBAC: non può certificare da solo T20–T22.

## Controlli realmente eseguiti

| Controllo                                                       | Esito                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------- |
| Git/remote/base/delta/untracked                                 | completato; HEAD locale=remota, divergenza `0/0`        |
| censimento Docker in sola lettura                               | completato; nessuna risorsa M4A creata                  |
| `pnpm run typecheck`                                            | superato per workspace, API, frontend, mockup e scripts |
| test frontend mirati a navigazione/moduli/PDF Emporio/hardening | **fallito**: 4 file, 47 pass, 1 fail                    |
| `git diff --check` prima della documentazione                   | superato                                                |

Fresh, upgrade 39→40, suite complete, E2E, build, budget, runtime e codegen
finali non sono stati avviati dopo il NO-GO statico e il test frontend fallito.

## Confine M4B

I finding non richiedono di anticipare affidamento, mancata consegna, rientro o
prenotazione Trasferimento. Queste funzioni restano M4B. L'hardening richiesto
serve esclusivamente a rendere completo e sicuro il perimetro M4A già
autorizzato.

## Appendice post-NO-GO — tracciamento dell'hardening

Questa appendice fotografa il lavoro eseguito dopo il NO-GO sopra riportato.
Non modifica, sostituisce o attenua l'esito storico, e non costituisce un nuovo
`##test M4A`, un GO, una validazione o una chiusura. Le prove indicate sono
evidenze mirate disponibili nel working tree; dovranno essere ripetute sullo
stesso candidato finale dopo la chiusura dei blocker ancora aperti.

Legenda dello stato:

- `correzione presente / prova mirata disponibile`: il delta e almeno una
  verifica pertinente sono disponibili, senza promozione a gate formale;
- `correzione in corso / prova pendente`: il secondo riesame ha trovato un
  caso ancora aperto oppure la patch è in corso di completamento;
- `prova formale pendente`: mancano ancora il nuovo ciclo `##test`, la matrice
  T01–T32 e gli E2E richiesti sul candidato finale.

### Mappa F1–F8 → C1–C7

| Finding storico                                   | Gruppi di hardening          | Causa confermata                                                                                                                                                                                                                                                                                                                             | Patch e file interessati                                                                                                                                                                                                                                                                                                                                                                                                                                               | Prove mirate disponibili e limite                                                                                                                                                                                                                                                                                                                                                       | Stato post-NO-GO                                                                                                                              |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — segno `CONSEGNA_ENTE`                        | C1, C7                       | La natura non era compresa nell'elenco comune delle uscite: il calcolo TypeScript e il `CASE` SQL ricadevano sul segno positivo, mentre la riconciliazione la classificava come variazione generica.                                                                                                                                         | `artifacts/api-server/src/lib/fseAccounting.ts`; `artifacts/api-server/src/lib/fseReconciliation.ts`; `artifacts/api-server/tests/fse-r1-accounting.test.ts`; nuovo `artifacts/api-server/tests/m4a-consegna-ente-reconciliation.test.ts`. La quantità persistita resta positiva e il segno deriva dalla natura.                                                                                                                                                       | Test puri contabili mirati verdi; il run PostgreSQL coordinato precedente al secondo riesame includeva entrambi i file nella batteria di 6 file/116 test verdi. L'evidenza va ripetuta dopo le patch ancora in corso.                                                                                                                                                                   | Correzione presente / prova mirata disponibile; prova formale pendente.                                                                       |
| F2 — facciata Trasferimenti subordinata a Bolle   | C2, C5, C7                   | Backend, route e redirect applicavano un gate Bolle unico prima di separare i rami documentali; il consumer con sola lettura Magazzino perdeva lista e dettaglio Trasferimenti.                                                                                                                                                              | `artifacts/api-server/src/routes/documenti-operativi.ts`; `artifacts/magazzino-solidale/src/App.tsx`; `artifacts/magazzino-solidale/src/pages/bolle.tsx`; `artifacts/magazzino-solidale/src/lib/navigation-permissions.test.ts`; `artifacts/magazzino-solidale/src/lib/moduli-servizi.test.ts`. Il ramo comune ora deriva separatamente l'accesso Bolle e Trasferimenti prima di lista, conteggio ed export.                                                           | La regressione frontend che aveva prodotto 47 pass/1 fail è coperta nella suite frontend successiva, risultata verde con 74 file/408 test; `documenti-operativi-m4a.test.ts` era verde nel run DB 6 file/116. Profili reali, revoca e combinazioni complete di moduli restano da provare nel nuovo ciclo formale.                                                                       | Correzione presente / prova mirata disponibile; T20–T22 ed E2E restano pendenti.                                                              |
| F3 — versione e idempotenza incomplete            | C3, C7                       | I comandi non condividevano una ricevuta transazionale con chiave, hash semantico, versione attesa e replay; il frontend generava una nuova intenzione sui retry incerti. Il secondo riesame ha inoltre evidenziato che alcuni replay di creazione e alcuni adapter devono rivalidare l'autorizzazione corrente prima di restituire l'esito. | Nuovi `lib/db/src/schema/comandiOperativi.ts` e `artifacts/api-server/src/lib/documentCommand.ts`; migrazione 40; adattamenti in `routes/enti-destinatari.ts`, `routes/bolle.ts`, `routes/trasferimenti.ts`, `lib/bollaDelivery.ts` e `lib/transferWorkflow.ts`; contratto OpenAPI e tipi generati; nuovo registry frontend `artifacts/magazzino-solidale/src/lib/command-intent.ts` con consumer in `pages/bolle.tsx`, `pages/trasferimenti.tsx` e `pages/mensa.tsx`. | Il run DB pre-secondo-riesame comprendeva replay, mismatch, stale version e concorrenza in `documenti-operativi-m4a.test.ts`, `bolle-prenotazioni.test.ts` e `trasferimenti.test.ts`; i test puri del registry frontend sono verdi nella suite 74/408. Non sono ancora prove finali: i tre blocker elencati sotto richiedono patch e rerun.                                             | **Correzione in corso / prova pendente** per replay di creazione autorizzato, completamento Consegna atomico e associazione Bolla; nessun GO. |
| F4 — snapshot Ente non autorevole                 | C4, C7                       | Dopo il congelamento, le letture preferivano ancora i valori live dell'Ente e non distinguevano snapshot intenzionalmente nullo da snapshot legacy assente.                                                                                                                                                                                  | `lib/db/src/schema/bolle.ts`; migrazione 40; `artifacts/api-server/src/routes/bolle.ts`; `artifacts/magazzino-solidale/src/lib/bolla-pdf.ts`; tipi OpenAPI/generati; casi in `artifacts/api-server/tests/bolle-prenotazioni.test.ts`. Sono esplicitati snapshot congelato e fonte fallback legacy.                                                                                                                                                                     | Il caso DB “snapshot A, contatti null, modifica/disattivazione e fallback legacy” era verde nel run coordinato 6 file/116. Il nuovo `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts` copre il percorso verticale previsto, ma è stato soltanto formattato: Playwright e PostgreSQL disposable non sono stati avviati. PDF reali e verifica visiva restano pendenti. | Correzione presente / prova DB mirata disponibile; E2E/PDF e prova formale pendenti.                                                          |
| F5 — lista comune incompleta                      | C5, C7                       | Contratto e UI non esponevano tipo aggregato, intervallo date, Area, ricerca, ordinamento e un export server-side dell'intero insieme; gli stati disponibili erano soltanto quelli Bolla.                                                                                                                                                    | Nuovi `artifacts/api-server/src/routes/documenti-operativi.ts` e `artifacts/api-server/src/lib/documentiOperativiWorkbook.ts`; registrazione route, OpenAPI e generated; `artifacts/magazzino-solidale/src/pages/bolle.tsx`; nuovi helper/test `documenti-operativi-url.*`. Lista, totale ed export condividono i filtri backend; l'export non usa la sola pagina visibile.                                                                                            | `documenti-operativi-m4a.test.ts`, incluso nel run DB 6 file/116, copre filtri, scope, ordinamento stabile, conteggio ed export; helper URL e pagina rientrano nella suite frontend 74 file/408. Dataset ed export dovranno essere riconfrontati nel `##test` finale.                                                                                                                   | Correzione presente / prova mirata disponibile; prova formale pendente.                                                                       |
| F6 — URL e selezione non identificano l'aggregato | C5, C7                       | La selezione viveva solo nello stato React e il redirect legacy preservava una query non tipizzata; Bolla N e Trasferimento N potevano essere ambigui tra refresh, cache e navigazione.                                                                                                                                                      | Nuovi `artifacts/magazzino-solidale/src/lib/documenti-operativi-location.ts` e `documenti-operativi-url.ts` con relativi test; `App.tsx`, `pages/bolle.tsx` e `pages/maps.tsx`. L'identità canonica è `documento=bolla:<id>` oppure `documento=trasferimento:<id>`; un solo dettaglio è aperto, con query key tipizzata e protezione del draft/cambio scope.                                                                                                           | Test puri URL/deep-link, collisione ID, filtri e dirty draft sono verdi nella suite frontend 74/408; typecheck frontend verde. Il nuovo E2E verticale esiste ma non è stato eseguito, quindi refresh, back/forward e risposta tardiva devono essere riprovati nel browser reale.                                                                                                        | Correzione presente / prova mirata disponibile; E2E e prova formale pendenti.                                                                 |
| F7 — storno amministrativo irraggiungibile        | C3, C6, C7                   | L'annullamento ordinario bloccava correttamente il post-uscita, ma non esistevano route, permesso e ingresso UI distinti per lo storno legacy ammesso; il solo helper non era raggiungibile dal prodotto.                                                                                                                                    | Nuovo permesso `bolle.reverse.admin` in `artifacts/api-server/src/lib/permissions.ts` e `seedRoles.ts`; route dedicata in `routes/bolle.ts`; contratto OpenAPI/generated; azione separata in `pages/bolle.tsx`; helper/test frontend `bolla-admin-reversal.*`; prove DB in `bolle-prenotazioni.test.ts`.                                                                                                                                                               | Nel run DB 6 file/116 erano verdi permesso, motivo/righe, reintegro singolo, replay/concorrenza e rollback su audit; helper e gate UI sono inclusi nella suite frontend 74/408. Il normale annullamento resta distinto. La batteria deve essere ripetuta dopo il completamento dei blocker C3.                                                                                          | Correzione presente / prova mirata disponibile; prova formale pendente.                                                                       |
| F8 — copertura formale insufficiente              | C7 e, trasversalmente, C1–C6 | Il candidato NO-GO aveva due soli test backend nuovi, nessun test pagina/retry e nessun E2E M4A; i risultati M1–M3 non potevano certificare le nuove invarianti.                                                                                                                                                                             | Ampliati `documenti-operativi-m4a.test.ts`, `bolle-prenotazioni.test.ts`, `trasferimenti.test.ts`, `scoping-beneficiario.test.ts` e `fse-r1-accounting.test.ts`; aggiunto `m4a-consegna-ente-reconciliation.test.ts`; aggiunti test frontend per permessi, moduli, intenti, URL, storno e draft; predisposto `e2e/m4a-documenti-destinatari.spec.ts`.                                                                                                                  | Prima del secondo riesame: DB coordinato 6 file/116 verde; frontend 74 file/408 verde; fresh DB vuoto 40/40 con replay/checksum/seed/smoke API; codegen doppio byte-identico; workspace typecheck e build API/frontend verdi; budget 1306,8 KiB / 361,3 KiB gzip. L'E2E nuovo non è stato eseguito e queste evidenze precedono i blocker aperti: non sono un gate finale.               | Copertura aumentata, ma **prova formale pendente** e NO-GO non revocato.                                                                      |

### Blocker emersi nel secondo riesame

I seguenti casi non sono assorbiti dai risultati verdi precedenti. Per tutti e
tre lo stato autorizzato è `correzione in corso / prova pendente`; finché non
sono chiusi e rieseguiti sullo stesso working tree non è possibile aggiornare
l'esito M4A.

| Blocker                                            | Finding/gruppi collegati | Evidenza del problema e perimetro della correzione                                                                                                                                                                                                                                                                                    | Stato                                                                                                                                                                        |
| -------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Replay di creazione e autorizzazione corrente      | F3, F8 / C3, C7          | Una ricevuta di creazione non deve restituire un risultato protetto prima di rivalidare sessione, permessi e scope correnti. Il riesame comprende i create Bolla/Ente/Trasferimento e gli adapter pertinenti, incluso Mensa, senza trasformare la ricevuta in un canale di lettura fuori scope.                                       | **Correzione in corso / prova pendente.** Servono replay autorizzato e revocato, hash semantico e rerun DB/API/frontend.                                                     |
| `POST /consegne/:id/completa` atomico con la Bolla | F3, F8 / C3, C7          | Consegna, finalizzazione fisica della Bolla, audit obbligatorio e ricevuta idempotente devono condividere la stessa transazione e lo stesso ordine di lock; anche il ramo legacy già consegnato deve registrare un esito coerente senza doppio scarico. I file interessati comprendono `routes/consegne.ts` e `lib/bollaDelivery.ts`. | **Correzione in corso / prova pendente.** Le prove verdi precedenti non certificano la nuova patch; occorrono successo, replay/mismatch/stale, concorrenza e rollback audit. |
| Associazione Consegna–Bolla                        | F3, F8 / C3, C7          | L'operazione di associazione deve verificare versione, scope e compatibilità, serializzare gli aggregati coinvolti e rendere atomici associazione, audit e ricevuta. Il consumer `pages/consegne.tsx`, il backend Consegne e il contratto generato sono in adeguamento.                                                               | **Correzione in corso / prova pendente.** Servono test su due ingressi, conflitto/stale, replay e fallimento audit prima del nuovo `##test`.                                 |

### Confine delle evidenze post-NO-GO

Il fresh 40/40, i 116 test DB, i 408 test frontend, codegen, typecheck, build e
budget sopra elencati descrivono una run intermedia precedente al secondo
riesame. Non vanno sommati o riutilizzati per dichiarare verde un candidato che
sta ancora cambiando. Dopo la chiusura dei tre blocker sono necessari almeno:

1. rerun mirato dei casi corretti e dei consumer coinvolti;
2. PostgreSQL fresh e upgrade popolato 39→40 sul candidato finale;
3. suite complete API/frontend, E2E verticale e matrice M4A-T01–T32;
4. codegen deterministico, typecheck, build, budget, runtime e hygiene finali;
5. una nuova fase `##test M4A` separata che rivaluti G1–G8.

Fino ad allora restano validi il NO-GO storico, l'assenza di commit/push e il
divieto di iniziare M4B.

### Seconda rilettura conclusiva del delta corretto

La rilettura indipendente conclusiva non ha individuato blocker residui nel
perimetro M4A corretto. Questo esito non modifica retroattivamente il **NO-GO**
della precedente fase formale e non costituisce un nuovo `##test M4A`.

Stato corrente del solo sviluppo correttivo:
**`DEV-M4A-CORRETTO/NE-TEST-M4A/NE-MAN`**. Non è uno stato `GO`, non equivale a
un requisito validato o chiuso e non autorizza commit, push, aggiornamento del
Docker persistente o avvio di M4B.

| Finding/blocker riesaminato              | Correzione riletta                                                                                                                                                                                                                                                                                      | Evidenza mirata sul delta corretto                                                                                                                                            | Stato corrente                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| F1 — segno `CONSEGNA_ENTE`               | Segno fisico, classificazione e riconciliazione usano la natura contabile comune senza quantità negative persistite né conteggi sociali fittizi.                                                                                                                                                        | Suite backend coordinata `11 file / 273 test` PASS; test Mensa isolati `72/72` PASS; test Bolle isolati `2 file / 57 test` PASS.                                              | Corretto con prova mirata; da ripetere nel nuovo `##test`.                |
| F2 — permessi/moduli della facciata      | Bolle e Trasferimenti sono autorizzati e filtrati per ramo prima di conteggio, paginazione ed export; `magazzino.view` non acquisisce mutazioni Bolle e Mensa conserva il proprio contratto.                                                                                                            | Frontend completo `74 file / 408 test` PASS e backend coordinato PASS.                                                                                                        | Corretto con prova mirata; profili e gate saranno rivalutati formalmente. |
| F3 — versione, idempotenza e concorrenza | Ricevuta transazionale, hash semantico, versione, replay dopo controllo dello scope corrente, audit atomico e lock/rilettura sono condivisi dai comandi adattati. L'ordine globale dei lock documentali e inventariali è deterministico e i deadlock PostgreSQL sono tradotti in conflitto controllato. | Backend coordinato, Mensa isolata e Bolle isolate PASS; migration runner `10/10` PASS.                                                                                        | Corretto con prova mirata; nessuna promozione dei gate G1–G8.             |
| F4 — snapshot Ente                       | Lo snapshot congelato è autorevole, distingue il nullo intenzionale dal legacy senza snapshot e alimenta dettaglio e PDF.                                                                                                                                                                               | E2E Ente PASS dopo la correzione del locator; PDF reale A4 di una pagina, `3,2 MiB`, contiene i dati snapshot A, esclude i dati live B ed è leggibile senza tagli nel render. | Corretto con prova mirata; validazione manuale ancora non eseguita.       |
| F5 — lista/export comune                 | Lista, totale ed export condividono filtri, scope e ordinamento deterministico server-side sull'insieme autorizzato.                                                                                                                                                                                    | Backend coordinato PASS; frontend completo PASS.                                                                                                                              | Corretto con prova mirata; da ripetere formalmente.                       |
| F6 — URL, identità e draft               | Deep link canonico tipizzato, redirect legacy, query key e draft distinguono Bolla e Trasferimento anche con ID uguale.                                                                                                                                                                                 | Primo Playwright FAIL per locator ambiguo; dopo la correzione puntuale il rerun desktop è `3/3` PASS, compreso il percorso Trasferimento con draft.                           | Corretto con prova mirata; il primo FAIL resta registrato.                |
| F7 — storno amministrativo               | Il comando amministrativo è distinto dall'annullamento ordinario, autorizzato, motivato, idempotente, auditato e atomico per riga/movimento.                                                                                                                                                            | Suite Bolle isolata `2 file / 57 test` PASS e backend coordinato PASS.                                                                                                        | Corretto con prova mirata; non anticipa rientri M4B.                      |
| F8 — copertura                           | Sono presenti prove backend, frontend ed E2E verticali sui tre percorsi destinatario e sugli hardening successivi al secondo riesame.                                                                                                                                                                   | Fresh finale 40/40 con seed/smoke/replay/verify; backend, frontend, E2E, PDF, runner, codegen, typecheck e build sotto riportati PASS.                                        | Copertura correttiva disponibile; la fase formale resta `NE-TEST-M4A`.    |

I tre blocker del secondo riesame — replay di creazione con autorizzazione
corrente, completamento atomico Consegna–Bolla e associazione/dissociazione
Consegna–Bolla — sono stati riletti insieme al successivo hardening dell'ordine
dei lock. Le vie create/associa/completa/consegna diretta/sync non presentano
più inversioni note tra Bolla, Consegna, Beneficiario, Magazzino, planning e
lotti. I consumer inventariali adattati seguono lo stesso pre-lock globale.

### Prove conclusive della fase correttiva

| Controllo                                 | Esito mirato                                                                                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| review statica indipendente conclusiva    | PASS; nessun blocker residuo rilevato nel perimetro M4A                                                                                                    |
| fresh DB `magazzino_m4a_correction_final` | PASS; 40/40 migrazioni, seed, smoke, replay e verify                                                                                                       |
| upgrade autentico populated 39→40         | PASS nella fase correttiva; evidenza distinta dal fresh finale                                                                                             |
| suite backend coordinata                  | PASS; 11 file, 273 test                                                                                                                                    |
| suite Mensa isolata                       | PASS; 72/72 test                                                                                                                                           |
| suite Bolle isolata                       | PASS; 2 file, 57 test                                                                                                                                      |
| suite frontend completa                   | PASS; 74 file, 408 test                                                                                                                                    |
| E2E Playwright desktop                    | primo run FAIL per locator ambiguo; correzione puntuale; rerun 3/3 PASS: Beneficiario con risposta persa, Ente snapshot/fallback e Trasferimento con draft |
| PDF reale                                 | PASS; A4, una pagina, 3,2 MiB; snapshot A presente, live B assente; render leggibile e non tagliato                                                        |
| codegen deterministico                    | PASS; due generazioni, 842 file byte-identici                                                                                                              |
| workspace typecheck                       | PASS                                                                                                                                                       |
| migration runner                          | PASS; 10/10 test                                                                                                                                           |
| build API                                 | PASS                                                                                                                                                       |
| build frontend                            | PASS; warning sourcemap e chunk registrati come non bloccanti                                                                                              |
| budget frontend                           | PASS; 1306,8 KiB / 361,4 KiB gzip                                                                                                                          |
| Prettier pertinente                       | PASS sul delta non generato; output generated conservato come prodotto del codegen ufficiale                                                               |
| `git diff --check`                        | PASS                                                                                                                                                       |
| processi temporanei                       | porte 18181 e 4173 chiuse                                                                                                                                  |

Queste prove appartengono alla fase di **correzione e sviluppo**. Non
sostituiscono il nuovo ciclo formale che dovrà rieseguire e rivalutare T01–T32
e G1–G8 sul candidato immutato. Il cleanup finale nominativo del laboratorio e
degli output temporanei è completato e censito in `AMBIENTE_TEST.md`; nessuna
risorsa persistente è stata modificata.

### Inventario completo del delta finale

Inventario ricavato rispetto alla base pubblicata
`8df6b823bb14604af0123ea62ce7b237b32561c8`, includendo esplicitamente gli
untracked: **57 file tracciati modificati, 52 file nuovi, 109 file totali**.
L'indice è vuoto: **0 file staged**.

```text
M  artifacts/api-server/src/lib/bollaDelivery.ts
M  artifacts/api-server/src/lib/fseAccounting.ts
M  artifacts/api-server/src/lib/fseReconciliation.ts
M  artifacts/api-server/src/lib/permissions.ts
M  artifacts/api-server/src/lib/scaricoInventory.ts
M  artifacts/api-server/src/lib/seedRoles.ts
M  artifacts/api-server/src/lib/speseEmporio.ts
M  artifacts/api-server/src/lib/transferWorkflow.ts
M  artifacts/api-server/src/routes/bolle.ts
M  artifacts/api-server/src/routes/consegne.ts
M  artifacts/api-server/src/routes/index.ts
M  artifacts/api-server/src/routes/mensa.ts
M  artifacts/api-server/src/routes/trasferimenti.ts
M  artifacts/api-server/tests/bolle-prenotazioni.test.ts
M  artifacts/api-server/tests/bolle-ritiro-non-effettuato.test.ts
M  artifacts/api-server/tests/fse-r1-accounting.test.ts
M  artifacts/api-server/tests/mensa.test.ts
M  artifacts/api-server/tests/scope-helpers.ts
M  artifacts/api-server/tests/scoping-beneficiario.test.ts
M  artifacts/api-server/tests/trasferimenti.test.ts
M  artifacts/magazzino-solidale/src/App.tsx
M  artifacts/magazzino-solidale/src/components/maps/maps-operativa.test.tsx
M  artifacts/magazzino-solidale/src/lib/bolla-pdf.ts
M  artifacts/magazzino-solidale/src/lib/emporio-bolla-stampa.ts
M  artifacts/magazzino-solidale/src/lib/i18n/namespaces/bolle.ts
M  artifacts/magazzino-solidale/src/lib/moduli-servizi.test.ts
M  artifacts/magazzino-solidale/src/lib/navigation-permissions.test.ts
M  artifacts/magazzino-solidale/src/pages/bolle.tsx
M  artifacts/magazzino-solidale/src/pages/consegne.tsx
M  artifacts/magazzino-solidale/src/pages/maps.tsx
M  artifacts/magazzino-solidale/src/pages/mensa.tsx
M  artifacts/magazzino-solidale/src/pages/trasferimenti.tsx
M  docs/magazzino-workflow-unificato/AMBIENTE_TEST.md
M  docs/magazzino-workflow-unificato/AVANZAMENTO.md
M  docs/magazzino-workflow-unificato/DECISIONI.md
M  docs/magazzino-workflow-unificato/MATRICE_VALIDAZIONE.md
M  lib/api-client-react/src/generated/api.schemas.ts
M  lib/api-client-react/src/generated/api.ts
M  lib/api-spec/openapi.yaml
M  lib/api-zod/src/generated/api.ts
M  lib/api-zod/src/generated/types/associaBollaInput.ts
M  lib/api-zod/src/generated/types/bolla.ts
M  lib/api-zod/src/generated/types/bollaDettaglio.ts
M  lib/api-zod/src/generated/types/bollaInput.ts
M  lib/api-zod/src/generated/types/bollaRiga.ts
M  lib/api-zod/src/generated/types/bollaRigaInput.ts
M  lib/api-zod/src/generated/types/bollaUpdate.ts
M  lib/api-zod/src/generated/types/confermaRicezione.ts
M  lib/api-zod/src/generated/types/consegna.ts
M  lib/api-zod/src/generated/types/consegnaRicezioneInput.ts
M  lib/api-zod/src/generated/types/index.ts
M  lib/api-zod/src/generated/types/trasferimentoInput.ts
M  lib/api-zod/src/generated/types/trasferimentoUpdate.ts
M  lib/db/scripts/migration-runner.test.mjs
M  lib/db/src/schema/bolle.ts
M  lib/db/src/schema/index.ts
M  lib/db/src/schema/inventoryAccounting.ts
?? artifacts/api-server/src/lib/documentCommand.ts
?? artifacts/api-server/src/lib/documentiOperativiWorkbook.ts
?? artifacts/api-server/src/lib/inventoryLocks.ts
?? artifacts/api-server/src/routes/documenti-operativi.ts
?? artifacts/api-server/src/routes/enti-destinatari.ts
?? artifacts/api-server/tests/documenti-operativi-m4a.test.ts
?? artifacts/api-server/tests/m4a-consegna-ente-reconciliation.test.ts
?? artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts
?? artifacts/magazzino-solidale/src/lib/bolla-admin-reversal.test.ts
?? artifacts/magazzino-solidale/src/lib/bolla-admin-reversal.ts
?? artifacts/magazzino-solidale/src/lib/command-intent.test.ts
?? artifacts/magazzino-solidale/src/lib/command-intent.ts
?? artifacts/magazzino-solidale/src/lib/documenti-operativi-location.test.ts
?? artifacts/magazzino-solidale/src/lib/documenti-operativi-location.ts
?? artifacts/magazzino-solidale/src/lib/documenti-operativi-url.test.ts
?? artifacts/magazzino-solidale/src/lib/documenti-operativi-url.ts
?? artifacts/magazzino-solidale/src/lib/trasferimento-draft.test.ts
?? artifacts/magazzino-solidale/src/lib/trasferimento-draft.ts
?? docs/magazzino-workflow-unificato/ESITI_TEST_M4A.md
?? docs/magazzino-workflow-unificato/PROGETTO_M4.md
?? docs/magazzino-workflow-unificato/REVISIONE_STATICA_M4A.md
?? lib/api-zod/src/generated/types/bollaAnnullamentoInput.ts
?? lib/api-zod/src/generated/types/bollaDestinatarioSnapshotFonte.ts
?? lib/api-zod/src/generated/types/bollaDettaglioDestinatarioSnapshotFonte.ts
?? lib/api-zod/src/generated/types/bollaDettaglioTipoDestinatario.ts
?? lib/api-zod/src/generated/types/bollaInputTipoDestinatario.ts
?? lib/api-zod/src/generated/types/bollaStornoAmministrativoInput.ts
?? lib/api-zod/src/generated/types/bollaTipoDestinatario.ts
?? lib/api-zod/src/generated/types/comandoVersionatoInput.ts
?? lib/api-zod/src/generated/types/documentoOperativo.ts
?? lib/api-zod/src/generated/types/documentoOperativoDettaglio.ts
?? lib/api-zod/src/generated/types/documentoOperativoDettaglioTipoAggregato.ts
?? lib/api-zod/src/generated/types/documentoOperativoPage.ts
?? lib/api-zod/src/generated/types/documentoOperativoTipoAggregato.ts
?? lib/api-zod/src/generated/types/documentoOperativoTipoDestinatario.ts
?? lib/api-zod/src/generated/types/enteDestinatario.ts
?? lib/api-zod/src/generated/types/enteDestinatarioInput.ts
?? lib/api-zod/src/generated/types/enteDestinatarioUpdate.ts
?? lib/api-zod/src/generated/types/exportDocumentiOperativiDestinatario.ts
?? lib/api-zod/src/generated/types/exportDocumentiOperativiParams.ts
?? lib/api-zod/src/generated/types/exportDocumentiOperativiSortBy.ts
?? lib/api-zod/src/generated/types/exportDocumentiOperativiSortDirection.ts
?? lib/api-zod/src/generated/types/exportDocumentiOperativiTipoAggregato.ts
?? lib/api-zod/src/generated/types/listDocumentiOperativiDestinatario.ts
?? lib/api-zod/src/generated/types/listDocumentiOperativiParams.ts
?? lib/api-zod/src/generated/types/listDocumentiOperativiSortBy.ts
?? lib/api-zod/src/generated/types/listDocumentiOperativiSortDirection.ts
?? lib/api-zod/src/generated/types/listDocumentiOperativiTipoAggregato.ts
?? lib/api-zod/src/generated/types/listEntiDestinatariParams.ts
?? lib/db/src/schema/comandiOperativi.ts
?? lib/db/src/schema/entiDestinatari.ts
?? lib/db/updates/20260919_m4a_documenti_destinatari.sql
```

L'inventario include codice applicativo, test, E2E, documentazione, schema,
migrazione candidata, OpenAPI e tutti gli output generati. Non include PDF,
render, output Playwright, hash o log temporanei, rimossi nel cleanup e mai
destinati al repository.

## Riesame formale finale F1–F8

Data: 22 settembre 2026. Il NO-GO iniziale e i controesempi restano validi
come storia del candidato precedente. Il riesame seguente riguarda il
working tree post-correzione sottoposto all'intera fase `##test M4A` descritta
in `ESITI_TEST_M4A.md`; non equivale alla futura code review ChatGPT.

| Finding                              | Esito finale                  | Evidenza sul candidato finale                                                                                                                                                 |
| ------------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1 — segno `CONSEGNA_ENTE`           | Chiuso                        | Natura di uscita nei consumer TypeScript/SQL e riconciliazione; test contabili/API completi verdi.                                                                            |
| F2 — permessi facciata Trasferimenti | Chiuso                        | Filtri server per ramo prima di conteggio/export; menu/route con `magazzino.view` indipendente da Bolle; regressioni permessi e E2E verdi.                                    |
| F3 — versione/idempotenza            | Chiuso                        | Ricevute transazionali, hash semantico, versione e replay autorizzato per comandi comuni/adapter; concorrenza PostgreSQL ed E2E risposta persa di creazione e conferma verdi. |
| F4 — snapshot Ente                   | Chiuso                        | Dopo conferma prevale lo snapshot A anche se l'Ente live diventa B/disattivo; fallback legacy esplicito; API/E2E/PDF reale verificati.                                        |
| F5 — lista comune                    | Chiuso                        | Filtri, ordinamento stabile, totale, paginazione ed export condividono scope/contratto; API/frontend verdi.                                                                   |
| F6 — identità URL                    | Chiuso                        | `bolla:<id>`/`trasferimento:<id>`, deep link, redirect e draft/race protetti; test unitari ed E2E verdi.                                                                      |
| F7 — storno amministrativo           | Chiuso                        | Comando distinto e motivato, permesso dedicato, audit/idempotenza/rollback; l'annullamento normale post-uscita resta bloccato.                                                |
| F8 — copertura                       | Chiuso per la fase automatica | API 1308 pass, frontend 408 pass, E2E 66 pass su cinque viewport, fresh/upgrade/runner/codegen/build/PDF/budget/runtime/hygiene; limiti manuali separati.                     |

Il delta resta ampio perché il documento operativo attraversa schema,
contratto, API, pagine, PDF e test già esistenti. È stato riesaminato senza
scartare il working tree corretto: prime 39 migrazioni intatte, generated
rigenerati con il comando ufficiale e hash identico in due run, nessuna
modifica di stack o struttura. Il churn di formattazione dei grandi file
legacy rimane un costo di review esplicito, non una prova funzionale; la
code review ChatGPT resta il prossimo controllo indipendente. Non sono stati
introdotti requisiti M4B.

## Code review ChatGPT post-pubblicazione — CR-M4A-01 / CR-M4A-02

Data: 23 settembre 2026. Base pubblicata `18765925706ff4d1bcd6c8f57e0371d78a492136`.
Il GO automatico del 22 settembre resta evidenza storica di quel commit; la
review successiva ha riaperto M4A. Questa sezione registra il solo hardening
di sviluppo, non un nuovo GO G1–G8 né validazione umana.

### CR-M4A-01 — Lotto esplicito nel Trasferimento

**Controesempio e causa.** La riga poteva conservare `lottoId=B`, ma
`POST /trasferimenti/:id/avvia` chiamava `trasferimentoUscitaFEFO` senza quel
valore: con A in scadenza prima di B il ledger scaricava A. Il form non
permetteva la scelta e perdeva il campo nel draft/payload.

**Correzione.** `routes/trasferimenti.ts` passa il lotto alla stessa uscita
inventariale. Il pre-lock globale resta per prodotto/partita; la query
transazionale blocca e rivalida prodotto, magazzino, scadenza e disponibilità
netta degli impegni. Con scelta esplicita non c'è fallback FEFO e il conflitto
409 annulla anche stato, audit e movimenti. Senza scelta resta FEFO
multi-partita. `transferWorkflow.ts` richiede il lotto se il prodotto ha
`lottoFisicoObbligatorio`. La pagina Trasferimenti conserva il campo nella
creazione, modifica, ripresa e dirty guard; il selettore mostra solo lotti
compatibili e l'opzione FEFO solo se consentita. `GET /lotti` aggiunge la
disponibilità netta di sola lettura, con OpenAPI e client rigenerati; nessuno
schema o migrazione è stato modificato.

**Regressioni.** `LOT-EX-01/02/03/05`, FEFO multi-lotto già presente e prova
di impegno attivo in `trasferimenti.test.ts` e
`documenti-operativi-m4a.test.ts`; selettore e draft/payload in
`trasferimenti-lotti.test.tsx` e `trasferimento-draft.test.ts`. Test API M4A
mirati 44/44 e frontend 411/411 verdi. **Stato:** corretto con prove mirate;
T09/T10 da rivalutare nel successivo `##test M4A`.

### CR-M4A-02 — Scope UDS Bolla Ente

**Controesempio e causa.** Una sessione Area A/Zona A1 apriva il dettaglio
Ente dell'Area A, ma `GET /bolle`, lista ed export comuni lo eliminavano
applicando `zonaUdsId` alla join Beneficiario nulla. Il dettaglio Ente aveva
inoltre una condizione UDS/Area non pertinente.

**Correzione.** `routes/bolle.ts` e `routes/documenti-operativi.ts`
applicano Zona UDS soltanto al ramo Beneficiario. Il ramo Ente mantiene Area,
magazzino visibile, permesso e modulo; le varianti di accesso dettaglio e
transazionale usano la medesima semantica. Nessuna FK o Zona fittizia è stata
aggiunta. La lista Bolle usa anche il filtro sui magazzini visibili.

**Regressioni.** `UDS-ENTE-01/02` e `UDS-BEN-REG-01` verificano con due Aree
e due Zone lista Bolle, lista comune, dettagli/deep link, comando
transazionale di modifica ed export XLSX: Ente
Area A visibile, Ente Area B escluso, Beneficiario Zona A2 escluso. Test API
M4A mirati 44/44 verdi. **Stato:** corretto con prove mirate; la coerenza
complessiva sarà rivalutata nel successivo `##test M4A`.

**Boundary senza Area.** Per una sessione con Zona UDS ma senza Area
assegnata resta il rifiuto preesistente sul dettaglio Ente; liste e facciata
comune ora applicano lo stesso fail-closed. Non viene inferita una Zona
fittizia sull'Ente né concessa visibilità globale ai magazzini.

## Rilettura statica finale post-hardening — 23 settembre 2026

La rilettura del delta rispetto a `18765925706ff4d1bcd6c8f57e0371d78a492136`
conferma che **CR-M4A-01** è chiuso: il lotto fisico selezionato arriva dal
form al draft, al payload e alla riga persistente; all'avvio la query sotto
lock prende solo quella partita, rivalida prodotto/deposito/scadenza e
disponibilità al netto delle prenotazioni, senza fallback FEFO. Il ramo senza
lotto mantiene FEFO multi-partita e il prodotto che richiede il lotto fisico
non può creare una riga senza selezione. Le regressioni LOT-EX-01..05 e la
prova UI coprono il controesempio originale.

**CR-M4A-02** è chiuso: lista Bolle, lista/export comuni, dettaglio e
modifiche transazionali distinguono Ente da Beneficiario. L'Ente segue Area,
magazzino visibile, permesso e modulo, non una Zona UDS inesistente;
Beneficiario continua a rispettare la propria Zona. La sessione UDS senza
Area resta fail-closed. I casi UDS-ENTE-01..03 e UDS-BEN-REG-01 coprono la
coerenza dei percorsi.

La rilettura del contratto ha inoltre individuato un difetto collaterale
circoscritto: lo schema `Lotto` richiede la nuova disponibilità netta anche
nelle risposte singole, mentre solo `GET /lotti` la serializzava. La stessa
funzione di calcolo ora serve lista, dettaglio, creazione, modifica e
rettifica; un'asserzione regressiva verifica `GET /lotti/:id` con prenotazione
attiva. Nessuna colonna o migrazione è stata introdotta. Il test M2 che
presupponeva l'ordine cronologico dell'audit ora dichiara esplicitamente
`ORDER BY id`, coerente con l'ID append-only, senza modificare il ledger.

Nessun finding bloccante resta aperto nella review statica del perimetro M4A;
il GO complessivo dipende comunque dai gate formali G1–G8 del rapporto test.
