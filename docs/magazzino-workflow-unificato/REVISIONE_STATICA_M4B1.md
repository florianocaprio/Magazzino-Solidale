# M4B.1 — revisione statica locale del candidato

Base pubblicata `be033bf565c82dccb8187d8cf72e2d1d1732a474`; branch
`codex/magazzino-workflow-unificato`. Questa è la revisione locale Codex del
working tree, **non** la futura code review indipendente ChatGPT. Il delta
preesistente è stato conservato; indice iniziale vuoto, divergenza iniziale
locale/remota `0/0`. `main` non è stato modificato.

## Contratto e schema

La sola migrazione nuova è
`20260923_m4b1_prenotazioni_trasferimenti.sql`, SHA-256
`2b04816cac86bdb82611880cf9c98f5f3b5fdba671c9d1344c3641e52a7409d2`.
Le migrazioni 1–40 non compaiono nel delta Git. Aggiunge owner Trasferimento
opzionale alle prenotazioni, motivo di annullamento, indici e FK composite
testata/riga per entrambi i proprietari. Il check impone una coppia completa
ed esclusiva: Bolla/Riga Bolla **oppure** Trasferimento/Riga Trasferimento.
Il check di quantità positiva rimane. Non riscrive stati legacy né dati
inventariali. L'OpenAPI aggiunge `prepara`, `annulla` e il motivo; i generated
provengono esclusivamente dal codegen ufficiale, risultato byte-identico in
due run. Nessuna API M4B.2 è stata introdotta.

`inventoryReservations.ts` è il solo percorso di allocazione/prelievo FEFO
per la prenotazione iniziale di Bolla e Trasferimento. Ordina e blocca lotti
con le business key globali, usa `InventoryDecimal`, sottrae gli impegni
`attiva` di entrambi gli owner e rispetta lotto esplicito, scadenza e
frazionabilità. `bolle.ts` richiama il servizio; `trasferimenti.ts` lo usa
solo in `prepara`, mentre `avvia` legge le prenotazioni proprie già congelate
e non riesegue FEFO. Modifica righe ammessa solo da `richiesto`; annullamento
ordinario solo prima dell'uscita, motivato e senza movimenti. Comandi con
versione, chiave, hash, audit e ricevuta nella stessa transazione.

## Censimento consumer di `prenotazioni_magazzino`

| Consumer                                                                                                                            | Esito review                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `disponibilitaMagazzino.ts`, `lotti.ts`, `preparazione-consegne.ts`, `scaricoInventory.ts`, `speseEmporio.ts`, `carico-pratiche.ts` | Aggregano `attiva` per lotto/prodotto/magazzino senza join obbligatoria alla Bolla: includono anche il Trasferimento. Gli stati rilasciati/convertiti sono esclusi.                                                                              |
| `bolle.ts`, `bollaDelivery.ts`                                                                                                      | Lettura/consegna/annullamento delle sole prenotazioni della Bolla corrente tramite `bollaId`; non consumano riserve Trasferimento. Dettaglio e PDF distinguono richiesto, prenotato e movimento.                                                 |
| `trasferimenti.ts`                                                                                                                  | Dettaglio mostra le partite proprie; `prepara` le crea atomicamente, `avvia` le converte e materializza i soli movimenti propri, `annulla` rilascia le sole proprie. Ricezione dei trasferimenti storici già partiti non richiede nuove riserve. |
| `magazzinoDeletion.ts`, `environmentData.ts`                                                                                        | Guardie/dati ambiente vedono ogni prenotazione, indipendentemente dall'owner. L'eventuale delete riguarda solo l'operazione esplicita già prevista nel laboratorio, non il workflow M4B.1.                                                       |
| Giacenze, Mensa, Emporio, scarico e selettori                                                                                       | Consumano le funzioni di disponibilità comuni o l'aggregato `attiva`; test di regressione API/frontend/E2E verificano che il disponibile non nasconda gli impegni Trasferimento.                                                                 |

Nessun join generale obbligatorio a `bolle` o assunzione globale di `bollaId`
non nullo è rimasta nei reader di disponibilità. Le join a Bolla sono confinate
al percorso Bolla. La query del dettaglio Trasferimento è distinta dal ledger
dei movimenti: una prenotazione non è dichiarata uscita fisica.

## Finding locali e chiusure

| ID        | Requisito, controesempio e impatto                                                                                                                                                                                                                            | Correzione e regressione                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R-M4B1-01 | PREP-TR-10: in `seedRoles.ts`, l'aggiunta di `mensa.transfers.prepare/cancel` a `MENSA_PERMISSIONS` avrebbe ampliato implicitamente il ruolo Mensa standard al prossimo seed.                                                                                 | Inserite nella deny-list del ruolo standard; test `seed-roles-beneficiari.test.ts` verifica l'assenza. I permessi restano assegnabili esplicitamente.        |
| R-M4B1-02 | G5: `migration-runner.test.mjs` attendeva ancora 40 migrazioni; il runner reale a 41 avrebbe fallito il gate.                                                                                                                                                 | Aggiornata l'attesa a 41 e al nome dell'ultima migrazione; runner completo 24/24 verde, comprese 14 sottoprove PostgreSQL.                                   |
| R-M4B1-03 | REG-M4A: il vecchio E2E Trasferimento chiamava `Avvia` direttamente da `richiesto`, ora bypass vietato.                                                                                                                                                       | L'E2E prepara prima; il test API conserva il rifiuto del bypass. LOT-EX E2E usa il dettaglio comune reale dopo il redirect legacy `/trasferimenti`→`/bolle`. |
| R-M4B1-04 | PREP-TR-02/05/06/07/08/09 e G4: mancavano prove dedicate per righe ripetute, competizione cross-owner con ordine inverso, retry concorrente, lotto FEFO sopraggiunto, riserva parziale, scadenza, lock+scope, annulla/avvia concorrenti, UX e risposta persa. | Aggiunte regressioni API e `m4b1-prenotazioni.spec.ts`; nessun contratto applicativo cambiato per far passare i test.                                        |

Il tentativo E2E Mensa sul prodotto demo con `lottoFisicoObbligatorio=true`
ha restituito 400 perché la richiesta Mensa preesistente non acquisisce il
lotto esplicito. La prova M4B.1 usa quindi una fixture indipendente con
prodotto senza tale requisito, coerente con il percorso Mensa già previsto.
Questa limitazione del form Mensa è antecedente a M4B.1 e non è stata
aggirata cambiando il requisito del prodotto demo; non si dichiara qui
copertura Mensa per prodotti che richiedono codice fisico obbligatorio.
Il dettaglio comune `documenti-operativi` M4A esclude intenzionalmente i
Trasferimenti associati a Mensa: il consumer reale per richiedere, preparare,
spedire e ricevere questi rifornimenti è `/mensa/trasferimenti`, usato nel
test a due sessioni. Il primo tentativo E2E sul dettaglio comune ha quindi
ricevuto il corretto 404 e la fixture è stata riallineata al percorso Mensa,
senza allargare il contratto M4A.

Non risultano finding bloccanti M4B.1 aperti nella review locale. La
validazione automatica e la futura review ChatGPT restano eventi distinti.
Il gate formale complessivo rimane tuttavia **NO-GO/G6** per l'escaping
preesistente del runtime WEB Linux/Alpine, descritto in
`ESITI_TEST_M4B1.md`: non è una correzione autorizzata in M4B.1 e non è
stata introdotta nel delta.

## Ripresa autorizzata — WEB-RUNTIME-01

Il paragrafo NO-GO precedente descrive l'esito storico, non quello del
successivo mandato di hotfix. Gli script runtime erano byte-identici alla
base M4A `be033bf565c82dccb8187d8cf72e2d1d1732a474`. Il difetto è quindi
preesistente a M4B.1 e distinto dalla cache del browser osservata dopo il
deploy M4A. La riproduzione sulla base ha mostrato che `awk gsub` non
serializzava in modo portabile il backslash seguito da `b`: nel runtime
Nginx Alpine veniva letto come U+0008, anziché come i byte `5c 62`.

La correzione è limitata a `docker-entrypoint-web-runtime-config.sh` e
`scripts/test-web-runtime-config.sh`. Il generatore passa i valori tramite
`printf '%s'` a file temporanei privati, enumera i byte con `od` e produce
esplicitamente gli escape JavaScript con `awk` in locale C. In questo modo
il dato non diventa formato di `printf`, programma awk o comando shell;
backslash, virgolette, controlli e UTF-8 hanno un percorso verificabile.
Restano invariati chiavi, default, `WEB_ROOT`, file esterno e pubblicazione
atomica nella directory di destinazione. Il file precedente resta valido
quando scrittura/pubblicazione falliscono; i temporanei sono rimossi per
nome. `od` e `awk` sono già nello stadio finale `nginx:1.27-alpine`: nessuna
dipendenza runtime, modifica Nginx/cache, lockfile o policy di piattaforma.

La review statica finale non ha trovato nuovi blocker nel delta applicativo
M4B.1, schema, migrazione, OpenAPI o generated. La fase B ha inoltre reso
autonoma la fixture del test E2E Mensa: il seed demo ufficiale non crea
una Mensa; `m4b1-prenotazioni.spec.ts` crea ora una Mensa sintetica e il
relativo magazzino sul DB disposable, senza dipendere dall'ordine di altri
test. Nessun comportamento applicativo è stato modificato per tale fixture.
Gli esiti dinamici e la decisione G1–G8 finale sono nel rapporto
`ESITI_TEST_M4B1.md`; la review ChatGPT rimane successiva e distinta.

## Ripresa autorizzata G3/G4 — SCARICO-TEST-01

Il NO-GO G3/G4 della sezione precedente resta un fatto storico. La causa
verificata nel test Scarico 2.0A era doppia: `Promise.race` con 50 ms
dimostrava solo che la risposta HTTP non era conclusa, non che la richiesta
avesse superato il controllo preliminare e raggiunto il lock; il ripristino
del Beneficiario era fuori dal `finally`, quindi l'assert 403 fallito
contaminava il caso PACCHI successivo. I due messaggi 403 appartengono a
controlli diversi e restano verificati separatamente.

La modifica è limitata a
`artifacts/api-server/tests/scarico-manuale-distribuzione-2-0a.test.ts`:
fixture dedicata ai due dinieghi, snapshot di scarichi/righe/operazioni,
movimenti, prenotazioni, audit business e residuo; connessione bloccante A
con PID noto; osservazione `pg_stat_activity`/`pg_blocking_pids` del backend
HTTP B nel database corrente, attivo e in attesa di `FOR UPDATE` su
`beneficiari`; COMMIT solo dopo l'osservazione. Timeout limitati e cleanup
in `finally` coprono rollback, richiesta pendente, fixture e setup parziale;
eventuali errori di cleanup sono riportati insieme all'errore originario.
Il flag `SCARICHI` è ripristinato. Nessuna route, policy o autorizzazione
applicativa è cambiata.

| Caso    | Prova                                                                                         |
| ------- | --------------------------------------------------------------------------------------------- |
| SCAR-01 | 403 preliminare esatto, risposta sanitizzata, zero effetti.                                   |
| SCAR-02 | 403 transazionale esatto dopo blocco PostgreSQL osservato, zero effetti.                      |
| SCAR-03 | Errori controllati prima e dopo COMMIT, fixture e snapshot ripristinati.                      |
| SCAR-04 | PACCHI 201 con quantità canonica 0,334957, isolato e dopo i negativi.                         |
| SCAR-05 | Dieci run completi consecutivi, senza retry.                                                  |
| SCAR-06 | Copia diagnostica isolata senza sola rivalidazione transazionale: assert 403 fallisce su 201. |

La prova SCAR-06 produce anche un errore di teardown nel database mutante:
il 201 non autorizzato ha creato effetti immutabili. Non è un pass del
mutante né un difetto del checkout candidato; la sensibilità è dimostrata
dall'assert 201≠403. La copia diagnostica non entra nel commit.

Nel rerun API completo, il test storico FSE-R2 dei 5.000 movimenti ha
superato il timeout Vitest generale di 30 s nel Linux x64 emulato (34,155 s
in prova mirata con deadline 90 s; 24,87 s su macOS). La sola correzione
adiacente autorizzata è un timeout locale di 60 s a quel caso in
`artifacts/api-server/tests/fse-r2-acceptance.test.ts`: assert, dati,
fixture e parallelismo invariati. Il file completo è passato senza override
CLI e la suite API completa finale è stata rieseguita dopo il cambio.
