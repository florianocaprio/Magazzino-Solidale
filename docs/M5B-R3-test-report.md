# M5B-R3 — ##test formale delle guardie post-preparazione

**Esito: PASS TECNICO — IN ATTESA DI PUBBLICAZIONE E REVIEW.** Il candidato non è committato, pubblicato, distribuito né validato manualmente. M5C non è stata avviata.

## Identità e perimetro

- Branch `codex/magazzino-workflow-unificato`; HEAD locale e remoto di partenza `ddd7a613234d2ae5c53c85d96bdc5ec53cc088aa`, divergenza 0/0 e staging vuoto. Candidato = HEAD + tutti gli otto file R3 iniziali, inclusi i due non tracciati. Il test ha aggiunto solo il presente rapporto e una correzione di harness al test storico Carichi; ha esteso il nuovo test R3. Nessun file applicativo è stato modificato durante il `##test`.
- Impronta SHA-256 aggregata dei cinque file applicativi R3, ottenuta da `shasum -a 256 <cinque file> | shasum -a 256`: `d6fc08702c038de488659c01b6b8ab6775fe28fffd98cfeed75bff1342cec01e`, invariata dall'ingresso al collaudo. Impronta aggregata dei due test toccati (`m5b-r3-guardie-post-preparazione.test.ts` e `carichi-magazzino-2-0a.test.ts`) sul candidato finale: `6cba55e7c7cf5a3f5004966df88746293b4e9168323cbdf0966daa620627d04b`.
- Migration 44 byte-identica a HEAD: SHA-256 `af324dcae7539e9c947b09a17fb3790eaa0813ed0263e8a5e758cdfcfe2d75a1`. Schema, OpenAPI, generated e lockfile non modificati. Nessuna migration 45. Su PostgreSQL effimero indipendente: bootstrap fresh, ledger 44/44, secondo run 44 skip/0 pending; non era richiesto un nuovo upgrade 43→44.
- Sono stati letti i rapporti R3, raccordo M5B, R2 e test post-R2 e riesaminato il diff delle cinque route/helper R3. Il documento di sviluppo e i rapporti precedenti restano evidenze storiche, non sono stati sovrascritti.

## Guardie Bolla, Trasferimento e Consegna

Il nuovo test R3 usa l'app reale con login/sessione, documenti M5B realmente collegati e stock sintetico; non simula la risposta delle route. Le chiamate senza scope sono provate nella sessione già aperta e, per gli endpoint di Bolla e Trasferimento preparati, dopo nuovo login. I dinieghi devono essere 403/404, mai un successo, e non esporre codice richiesta, nome destinatario, ID documento o partite nel payload.

| Superficie collegata                                                 | Diniego dopo revoca; percorso positivo dopo ripristino                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bolla `POST /api/bolle/:id/affida`                                   | Negato con stessa/nuova sessione; Affida, replay e mancata consegna positivi con scope valido.                                                                                                                                                        |
| Bolla `POST .../consegna`                                            | Negato dopo revoca; consegna diretta positiva e replay negato dopo ulteriore revoca.                                                                                                                                                                  |
| Bolla `POST .../mancata-consegna`                                    | Negato senza scope; positivo dopo Affida autorizzato.                                                                                                                                                                                                 |
| Bolla `GET/POST .../rientro`                                         | Lettura e contabilizzazione negate; rientro idoneo positivo dopo mancata consegna autorizzata.                                                                                                                                                        |
| Bolla `POST .../ritiro-non-effettuato`, `POST .../converti-consegna` | Negati senza scope; ritiro e conversione in nuova Consegna positivi con scope valido (HTTP 201 per nuova pianificazione).                                                                                                                             |
| Bolla `POST .../storno-amministrativo`                               | Negato su Bolla collegata; storno positivo dopo consegna autorizzata.                                                                                                                                                                                 |
| Trasferimento `POST .../avvia`, `POST .../conferma`                  | Negati nella stessa/nuova sessione; avvio, ricezione e replay autorizzato positivi dopo ripristino.                                                                                                                                                   |
| Trasferimento `POST .../mancato-arrivo`, `GET/POST .../rientro`      | Negati senza scope; mancato arrivo, preview e rientro positivi dopo ripristino; replay del rientro negato dopo revoca.                                                                                                                                |
| Consegne `POST .../associa-bolla`, `POST .../completa`, lista        | Associazione e completamento indiretto della Bolla collegata negati; lista priva dei campi Bolla fuori scope. Completamento positivo con scope valido; stesso comando ripetuto dopo revoca negato. Il percorso legacy è coperto dalle regressioni M4. |

## Revoche, digest e replay

La matrice R3-G/R3-ADMIN verifica **sia Affida Bolla sia Avvia Trasferimento** con lo stesso attore ordinario: Area+Centro rimossi, Centro senza Area, Area incoerente con Centro, Area inattiva, Centro inattivo, utente inattivo, ruolo mancante, `richieste_magazzino.view` revocato e grant M4 specifici revocati → diniego. Area valida senza Centro → scope di Area, non globale, e comandi positivi. Tolto soltanto `richieste_magazzino.prepare`, entrambi i comandi post-preparazione rimangono autorizzati dai propri grant M4. Admin assegnato ad altra Area resta scoped; admin esplicitamente globale senza assegnazione opera. La guardia rilegge attore, ruolo e territorio nel DB transazionale.

Il digest MD5 calcolato dal test comprende richiesta, relazione, documento Bolla/Trasferimento, lotto e quantità residua, prenotazioni, movimenti, audit M4 e ricevute operative. Per ogni gruppo di dinieghi Bolla, Trasferimento, Consegna e revoche granulari si asserisce **digest pre = digest post**. I valori esadecimali delle singole fixture, variabili per ID/timestamp sintetici, non sono stati persistiti: l'evidenza è l'uguaglianza assertita e il test 9/9 verde, non un hash inventato nel rapporto. Il replay di Affida, Ricezione e rientro con chiave K1 è negato dopo revoca senza nuovi effetti. Dopo ripristino dell'autorità, i replay di Affida e Ricezione restituiscono l'esito M4 originale senza secondo movimento o audit.

## Concorrenza PostgreSQL

Il caso R3-RACE usa due connessioni separate e una barriera su `pg_stat_activity.wait_event_type='Lock'`, senza sleep presunto:

1. UPDATE Area/Centro committato prima della `FOR SHARE` sull'attore: Affida negato, digest invariato.
2. Comando con lock `FOR SHARE` acquisito, poi fermato dall'advisory della richiesta; revoca in attesa del lock: Affida precedente valido, revoca successiva effettiva, replay K1 negato; ripristino e replay K1 senza nuovo effetto.
3. UPDATE di revoca rollbackato mentre il comando attende: Affida sbloccato e autorizzato sullo stato realmente persistito.

I tre ordini sono PASS nel nuovo test R3 9/9.

## Regressione M4 non collegata e suite

- R3 completo: **9/9 PASS**. Gruppo mirato R3/R2/M5B/M4 single-worker: **7 file, 106/106 PASS**. Comprende i test legacy `transport-return-m4b2`, `trasferimenti-pronto-m4b1`, `bolle-ritiro-non-effettuato`, `consegne-pagination-rbac`: Bolla non collegata (conferma, Affida, consegna, mancata consegna, rientro/storno), Trasferimento non collegato (prepara, avvia, ricevi, mancato arrivo/rientro) e Consegna legacy continuano a funzionare. La nuova guardia è no-op senza relazione M5B.
- Gate API completo sull'esatta impronta finale, PostgreSQL effimero appena ricreato e `--maxWorkers=1`: **128 file, 1.463 PASS, 4 skip storici, exit 0**. Ultimo run avviato alle 11:43:06, durata 203,48 s. Typecheck workspace exit 0; Prettier dei file R3 e test/harness exit 0; `git diff --check` exit 0.
- I quattro skip FSE+/AGEA preesistenti non sono contati come PASS R3. Frontend/E2E, build Linux e nuovo upgrade popolato non sono gate di questo prompt mirato e non sono stati rieseguiti; nessuna validazione manuale è inferita.

## Diagnosi dei run paralleli e modifica test-only

Comando diagnostico: `pnpm --filter @workspace/api-server run test` con `DATABASE_URL` esplicita del solo PostgreSQL temporaneo, flag disposable e configurazione Vitest parallela di default. Durante lo sviluppo erano emersi: Carichi (`entitaOrigineId` numerico non qualificato, movimenti multipli), Giacenze (`socket hang up`) e Affida M4 (`404 page not found`). Nel presente collaudo:

- Carichi, test `lega la idempotency key al contenuto normalizzato`: **3/3 FAIL isolati** sul DB temporaneo già popolato, con 4–5 movimenti invece di 1. Query diagnostica mostra lo stesso ID origine usato da `bolla`, `trasferimento` e `rientro_trasporto`. L'assert storico ora filtra anche `entitaOrigineTipo='carico_magazzino'`, come già fanno tre altri assert nello stesso file, e continua a richiedere **esattamente un** movimento del Carico. **3/3 PASS isolati** dopo la correzione; nessun codice applicativo toccato.
- Giacenze `non amplia lo scope Area o Centro del caller`, Affida M4 `CR-M4-01-D` e UDS `ritorna solo le persone con uds=true`: **3/3 PASS ciascuno isolato**. I file UDS, Giacenze e la relativa route non sono stati modificati da R3.
- Primo run completo parallelo post-correzione Carichi: **1.462 PASS, 1 FAIL UDS** (GET `/beneficiari` 404 invece di 200), 4 skip. Secondo run con identica configurazione: **1.463 PASS, 4 skip**, exit 0. Un run mirato single-worker sul DB condiviso ha visto `404 page not found` perfino su `POST /api/auth/login` del test R3 (105 PASS, 1 FAIL); ripetuto senza modifiche applicative è **106/106 PASS**. La stringa `page not found` non è presente nel sorgente applicativo. I 404 intermittenti attraversano login e UDS, non i soli comandi R3, e non si riproducono isolatamente; sono classificati come anomalia di trasporto/harness sotto carico, **non** come regressione delle guardie R3. Il responder preciso del 404 non è stato identificato: se ricompare in CI, acquisire header/indirizzo della risposta prima di modificare test o prodotto. Nessuno skip/retry è stato introdotto per forzare il verde.

## Ambiente, evidenze e chiusura

Sono stati creati in sequenza **quattro** container con il solo nome `m5b-r3-test-pg-20260929` (`postgres:16-alpine`, `--rm`, dati su `tmpfs`, porte casuali legate a `127.0.0.1`). Ognuno è stato fermato nominativamente e auto-rimosso prima del successivo o al termine. Nessun volume/rete R3 creato; i filtri finali `docker ps -a`, `docker volume ls`, `docker network ls` non mostrano residui R3. Nessun container, database o volume persistente è stato interrogato o modificato; nessun prune/down/reset. L'uso di `push` è stato limitato al bootstrap fresh delle istanze **vuote ed effimere**, mai al DB persistente.

Evidenze e manifest checksum: `/Users/florianocaprio/Documents/M5B-R3-test-evidence-20260929-formal/`. Il rapporto e il test R3 ne costituiscono i file verificabili; nessuna credenziale, `.env`, cookie o dato reale è incluso. Git finale: branch e HEAD locale/remota invariati, staging vuoto, working tree R3 intenzionalmente modificato con due file test/harness toccati e questo rapporto; `main` invariato. Nessun commit, push, merge o deploy.

**M5B-R3 — ##test PASS TECNICO — IN ATTESA DI PUBBLICAZIONE E REVIEW.**
