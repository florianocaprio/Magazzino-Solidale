# M4B.1 — esiti della validazione automatica formale

Base `be033bf565c82dccb8187d8cf72e2d1d1732a474`; branch
`codex/magazzino-workflow-unificato`; candidato: working tree M4B.1 con
correzioni locali descritte in `REVISIONE_STATICA_M4B1.md`. Non è una
validazione manuale di Floriano, né la code review ChatGPT. M4B.2 e il Docker
persistente sono fuori perimetro.

## Prove PREP-TR e REG-M4A

| ID         | Esito automatico | Evidenza principale                                                                                                                                                                                                                                  |
| ---------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PREP-TR-01 | PASS             | `trasferimenti-pronto-m4b1.test.ts`: richiesta senza riserve/movimenti e campi conservati; smoke UI/API/DB.                                                                                                                                          |
| PREP-TR-02 | PASS             | Pronto alloca tutte le righe o rollback totale; fisico invariato, impegnato/disponibile corretti; righe ripetute, fixed-point e unità/frazionabilità coperte dai test Trasferimenti/Bolle.                                                           |
| PREP-TR-03 | PASS             | FEFO multi-partita e fondi/lineage nei test Trasferimenti, Bolle, M4A PDF ed E2E; lotti espliciti e non espliciti distinti.                                                                                                                          |
| PREP-TR-04 | PASS             | LOT-EX API ed E2E: lotto richiesto prevale su A che scade prima, B insufficiente non usa fallback, prodotto/deposito/scadenza/requisito fisico controllati.                                                                                          |
| PREP-TR-05 | PASS             | PostgreSQL reale: Bolla vs Trasferimento sull'ultima unità con blocco e connessioni indipendenti; secondo caso multi-prodotto/righe inverse, uno solo vince senza sovraprenotare né deadlock. Quantità grezze attive/fisiche verificate.             |
| PREP-TR-06 | PASS             | Stessa chiave concorrente → replay/unica riserva; nuova intenzione stale → 409; mismatch/hash/versione/ricevuta e audit nei test comandi.                                                                                                            |
| PREP-TR-07 | PASS             | Richiesto non parte; Pronto consuma le partite prenotate, non il nuovo FEFO; fisico 10 con riserve 6 Trasferimento + 4 Bolla → fisico 4 e impegno Bolla 4; riserva parziale/scaduta rifiutata, doppio avvio/retry singolo scarico.                   |
| PREP-TR-08 | PASS             | Annullamento richiesto/pronto motivato senza movimento, sole riserve proprie rilasciate; righe pronto immutabili; annulla/avvia concorrenti producono un unico esito.                                                                                |
| PREP-TR-09 | PASS             | Chiave/versione/hash/attore backend, revoca permesso/scope prima di replay, mutazione scope durante lock, audit failure con rollback di stato/riserve/ricevuta.                                                                                      |
| PREP-TR-10 | PASS             | Matrice permessi Magazzino/Mensa/Bolle e seed senza escalation implicita; Mensa richiede/riceve ma non spedisce senza diritto origine, ricezione same/cross Area e storico pre-M4B.1 coperti da API; E2E a due sessioni reali Mensa/Magazzino verde. |
| REG-M4A    | PASS             | Suite API/frontend intere; E2E Bolle Beneficiario/Ente, FEFO/PDF, Consegne, Mensa, Emporio, UDS, redirect/deep link; upgrade preserva dati/ledger/ricevute M4A.                                                                                      |

## PostgreSQL, migrazioni e upgrade

- SQL diretto con `BEGIN`/savepoint: 0 owner, due owner, coppie incomplete,
  testata/riga inesistenti o incoerenti per entrambi gli owner, quantità
  zero/negative rifiutati con `23514`/`23503`; coppia Trasferimento corretta
  accettata e poi rollbackata. Controlli di dominio API verificano prodotto,
  lotto e magazzino; nessun vincolo nuovo inventato per relazioni non coperte
  dalla migrazione.
- Fresh ufficiale in DB isolato: schema, 41/41 migrazioni, seed, CRUD,
  replay/status/verify; zero pending, mismatch e fuori ordine. Ripetuto su DB
  API finale e DB E2E. Runner: 24/24, incluse 14 sottoprove PostgreSQL.
- Upgrade **autentico**: `git archive` della base M4A, schema/runner M4A,
  applicate prima 40/40 migrazioni; popolati Bolle confermata FEFO, consegnata,
  annullata, storno, Ente e ricevute/audit, Trasferimenti richiesto,
  in transito con uscite, completato same/cross Area e Mensa, lotti/fondi,
  pz/cf/kg. Snapshot ordinati delle vecchie colonne di nove tabelle e stock
  per magazzino/prodotto/unità/fondo. Runner candidato: **solo 41 applicata**,
  `applied=1 skipped=40`; hash di tutte le vecchie colonne e stock aggregato
  invariati, owner Trasferimento null per le vecchie riserve Bolla, nessun
  movimento/audit/receipt inventato. Replay `applied=0 skipped=41`, verify e
  status 41/41. Dopo il confronto: consegna Bolla storica, Pronto→Avvia del
  richiesto e ricezione del già partito riusciti. In M4A uno stato legale
  `preparato` non esisteva; sul candidato un pronto senza riserve è rifiutato
  da Avvia, senza ricostruzione FEFO.
- Migrazioni 1–40 immutate nel diff Git; SQL 41 SHA-256
  `2b04816cac86bdb82611880cf9c98f5f3b5fdba671c9d1344c3641e52a7409d2`.

## Suite, skip e toolchain

| Prova                                   | Risultato                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API completa finale su DB nuovo seriale | **117/117 file, 1334 pass, 2 skip**, 0 fail.                                                                                                                                                                                                                                                                                   |
| Frontend completo                       | **75/75 file, 411 pass**, 0 fail.                                                                                                                                                                                                                                                                                              |
| E2E M4B.1 finale                        | **10 pass, 2 skip di progetto** in 3 viewport (desktop, tablet portrait/landscape). Gli skip sono soltanto il caso a due sessioni Mensa riservato al desktop; le altre tre prove M4B.1 per viewport sono eseguite sui tablet. UI reale per Pronto/Avvia/Annulla/Ricevi; API/SQL solo per fixture e assert quantitativi.        |
| E2E REG-M4A/consumer                    | Desktop: **12 pass, 2 skip** di test riservati ai tablet in Consegne/UDS. Sei prove i18n/accessibilità M4A+M4B.1 **6 pass** su tutti e tre i viewport; LOT-EX, PDF, Bolle, Consegne, Mensa, Emporio e UDS coperti.                                                                                                             |
| Frozen install Linux x64/glibc          | PASS, Node 24.21.0, pnpm 10.34.5, lockfile invariato. Copia sorgenti candidato verificata via manifest/hash.                                                                                                                                                                                                                   |
| Build Linux x64/glibc                   | Install, typecheck, build API, build frontend, build workspace e budget PASS: entry 1309,9 KiB / 363,5 KiB gzip (<400 KiB). Warning sourcemap/chunk non bloccanti. Il comando cumulativo termina però con exit 1 sul successivo test runtime; la catena complessiva non è dichiarata PASS.                                     |
| Runtime e rendering                     | Script ufficiale PASS su macOS Node 22; su Linux Node 24/Debian **FAIL** per escaping speciale. Difetto riprodotto nell'immagine runtime reale Nginx Alpine. Config ordinaria Alpine PASS; preview build produzione PASS: HTML/JS/CSS 200, MIME corretti, login renderizzato, nessun `pageerror`. Gate runtime completo NO-GO. |
| Codegen                                 | Due run ufficiali Orval + fix upload + typecheck libs, hash aggregato generated invariato `8346c84ace36091791d57e4dcb8ff2d3d01d06170d05a06e404e9421a29a8f54`.                                                                                                                                                                  |
| Typecheck workspace                     | PASS dopo le correzioni.                                                                                                                                                                                                                                                                                                       |
| Build macOS nativa                      | BLOCCATA dalla dipendenza nativa `lightningcss.darwin-arm64.node` mancante con override preesistente nel `pnpm-workspace.yaml`; nessuna modifica permanente a lockfile o policy. Non è dichiarata PASS.                                                                                                                        |

Il manifest dei file Git tracked+untracked della copia Linux finale aveva
hash aggregato `90c460c2e23553528b76067ea5a66b5adae0a3fe15b28e0233d58a50f64a6eef`,
identico tra sorgente e copia prima della build.

**Blocco G6 — runtime reale.** Il test ufficiale verifica anche un URL con
due caratteri letterali, backslash e `b`. Su Linux Node 24/Debian fallisce;
nel runtime WEB effettivo `nginx:1.27-alpine` il JS generato contiene
backspace (codice 8) invece dei codici 92 e 98. Il caso ordinario
OpenStreetMap in Alpine e il login della build servita passano, ma non
sanano l'escaping. `docker-entrypoint-web-runtime-config.sh` e
`scripts/test-web-runtime-config.sh` sono byte-identici alla base M4A
(`git diff --exit-code`): difetto infrastrutturale preesistente, fuori
dalle correzioni **strettamente M4B.1** autorizzate. Non è stato modificato
o aggirato indebolendo la prova. Serve mandato separato per correggerlo
e ripetere runtime e gate interessati: **G6 NO-GO, nessun commit/push**.

Quattro skip iniziali identificati prima del run finale:

| File e test                                                                   | Condizione, base M4A, decisione                                                                                                                                             |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agea-import.test.ts`: bootstrap registro AGEA reale come Carico, sette righe | `AGEA_ACCEPTANCE_XLSX` presente e file esistente; assente qui. Opzionale, già skipped in M4A; non copre PREP-TR. Resta skip.                                                |
| `agea-sifead-parser.test.ts`: acceptance aggregati registro AGEA reale        | Stessa condizione `AGEA_ACCEPTANCE_XLSX`; opzionale già skipped in M4A. Resta skip.                                                                                         |
| `fse-import-parser-m3b.test.ts`: T01/T04/T06 sui due originali                | Richiede `FSE_REGISTRY_ORIGINAL_PATH` e `FSE_STOCK_ORIGINAL_PATH` esistenti. Due XLSX originali hash-verificati sono stati forniti nel run finale: test eseguito e passato. |
| `fse-import-practice-m3b.test.ts`: T25, sette saldi/1177 pezzi/80 carichi     | Stessa condizione M3B; eseguito e passato con i due originali.                                                                                                              |

Il primo run API senza `SESSION_SECRET` è fallito in import di quattro
suite per configurazione del laboratorio; corretto l'ambiente. Un successivo
run parallelo su DB già usato da test precedenti ha prodotto due failure
intermittenti in test storici Interventi (`socket hang up`, 404/200). Non sono
state nascoste: DB nuovo, fresh ufficiale, rerun **integrale seriale** sul
candidato finale: 117 file verdi e 1334 pass. Nessun assert applicativo è
stato indebolito. Lo smoke produzione iniziale senza risposta auth API ha
mostrato una 404 dell'app; ripetuto con runtime config e auth controllata,
rendering reale PASS. Questi incidenti restano nella storia della prova.
Un controllo Prettier diagnostico esteso con glob all'intera cartella test API
ha segnalato 46 file non toccati dal candidato; non sono stati riformattati.
Il controllo finale limitato a tutti i file modificati/nuovi non generati è
PASS.
Il primo E2E LOT-EX ha cercato l'azione nella vecchia lista, mentre il
redirect M4A la colloca nel dettaglio: fixture corretta e test passato.
L'E2E Mensa ha inizialmente usato il prodotto demo con lotto fisico
obbligatorio e poi il dettaglio comune che esclude i documenti Mensa;
fixture indipendente e pagina Mensa effettiva hanno portato al test a due
sessioni verde, senza alterare quei contratti. Nessun output Playwright o
screenshot è incluso nel repository.

## Gate G1–G8

| Gate | Stato     | Motivazione                                                                                                                                                          |
| ---- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | GO        | Base/branch/indice/delta verificati; working tree preservato, `main` non toccata, nessun commit/push.                                                                |
| G2   | GO        | Review completa e finding locali chiusi; vedere `REVISIONE_STATICA_M4B1.md`.                                                                                         |
| G3   | GO        | PREP-TR-01…10 e REG-M4A, SQL diretto, concorrenza e sottocasi quantitativi provati.                                                                                  |
| G4   | GO        | Ultimo run API fresh seriale 117/117 file, 1334 pass/2 skip opzionali; frontend 411/411; E2E M4B.1 10 pass/2 skip di progetto, regressioni e i18n verdi.             |
| G5   | GO        | Fresh, upgrade popolato e runner verdi.                                                                                                                              |
| G6   | **NO-GO** | Escaping runtime speciale errato su Linux, anche nel vero Nginx Alpine. Build/budget/codegen/typecheck/rendering ordinario verdi non sostituiscono la prova fallita. |
| G7   | GO        | Rapporti e matrice distinguono prove funzionali, blocco G6, code review futura e validazione manuale non eseguita.                                                   |
| G8   | GO        | DB effimero auto-rimosso, nessuna rete/volume M4B.1; copie/log/cookie temporanei eliminati e tre container/volumi persistenti invariati.                             |

La fotocamera reale e il tablet **fisico** restano `NE-MAN-CAMERA` e
`NE-MAN-TABLET`, non bloccanti per l'automazione. Nessuna validazione umana
M4B.1/M4B è dichiarata.

**Esito: `NO-GO-M4B.1/G6`, candidato non pubblicabile.** Working tree
preservato senza staging, commit o push; M4B.2 non avviata, `main` e Docker
persistente non aggiornati. I risultati funzionali sono evidenza utile per
il prossimo run, non equivalgono a milestone chiusa.

## Ripresa G6 dopo WEB-RUNTIME-01 — 23 settembre 2026

Il NO-GO sopra è conservato come esito storico. Il mandato successivo ha
autorizzato la sola correzione infrastrutturale del runtime WEB. All'ingresso:
branch `codex/magazzino-workflow-unificato`, HEAD locale/tracking/remota
`be033bf565c82dccb8187d8cf72e2d1d1732a474`, divergenza `0/0`, index
vuoto, 38 file M4B.1 tracked/untracked nel working tree. `main` non è stata
checkoutata né modificata. Il manifest iniziale sanitizzato, fuori Git,
ha SHA-256 `75b5aaf9b5525f5c57f31c12637e0f6f31fff3739fbbc24addb646111c70f8a1`.

La base pubblicata usa `awk gsub`. Il test ufficiale originale è PASS su
macOS `/bin/sh` Bash 3.2/awk Apple, ma **FAIL** su Debian `node:24-slim`
Linux amd64 (`dash`, `mawk 1.3.4`) e nello stadio finale
`nginx:1.27-alpine` (`BusyBox 1.37.0` shell/awk): l'URL sintetico con
`a\b"c` restituisce U+0008 oppure JavaScript invalido, non il backslash
e la lettera `b`. Il digest del manifest Nginx usato è
`sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10`;
quello Node è
`sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`.
I due script erano identici byte per byte alla base prima dell'hotfix.

Il generatore ora serializza esplicitamente i byte con `od` e `awk` C,
senza `gsub` di dati non fidati né nuove dipendenze nello stadio Nginx.
Le prove confrontano il valore _originale_ con il valore dopo parsing ed
esecuzione JavaScript in una VM Node esterna; nessuna fixture problematica
è stata rimossa o normalizzata. Il manifest congelato dopo la fase A è
`eb21949d7c3fa06564203ff38145886fd95307aefe09750676e6da252e64cd03`:
solo i due script runtime differiscono dall'ingresso; sorgenti e test
business, schema, migrazione 41, OpenAPI/generated e dipendenze invariati.

| Prova                                                     | macOS, script ufficiale | Debian `dash`/`mawk` | Nginx Alpine reale, oracolo Node esterno |
| --------------------------------------------------------- | ----------------------- | -------------------- | ---------------------------------------- |
| RT-01 default assenti/vuoti indipendenti                  | PASS                    | PASS                 | PASS                                     |
| RT-02 standard/personalizzati e chiavi                    | PASS                    | PASS                 | PASS                                     |
| RT-03 backslash + `b` letterali                           | PASS                    | PASS                 | PASS                                     |
| RT-04 URL originale con backslash/virgolette              | PASS                    | PASS                 | PASS                                     |
| RT-05 sequenze letterali e backslash finali               | PASS                    | PASS                 | PASS                                     |
| RT-06 controlli veri, CRLF, newline finale                | PASS                    | PASS                 | PASS                                     |
| RT-07 virgolette, `%`, `$`, backtick, sentinella          | PASS                    | PASS                 | PASS                                     |
| RT-08 Unicode e U+2028/U+2029                             | PASS                    | PASS                 | PASS                                     |
| RT-09 `WEB_ROOT` con spazi                                | PASS                    | PASS                 | PASS                                     |
| RT-10 seconda esecuzione, nessuna doppia codifica         | PASS                    | PASS                 | PASS                                     |
| RT-11 errore di scrittura/pubblicazione, precedente salvo | PASS                    | PASS                 | PASS                                     |
| RT-12 immagine WEB e HTTP/browser reale                   | n/a                     | n/a                  | PASS                                     |

Per RT-12 è stata costruita l'immagine candidata reale da `Dockerfile.web`.
`nginx -t` è PASS; SHA-256 del generatore nell'immagine uguale alla sorgente
`a189f1174cca6f20ab0cab910005a2cded75e3067fa4a52c68a03d45101e83e4`.
Su rete isolata, con uno stub API dichiarato **solo per il routing tecnico**,
`config.js`, `/login`, JS e CSS sono HTTP 200 con MIME corretti e header
`no-store` per la config. Il valore URL letto da `config.js` termina con i
code point sintetici `[97,92,98,34,99]`, non `[97,8,34,99]`. Chromium
nell'immagine Playwright ha renderizzato il login senza `pageerror`;
lo stub non è stato usato per gli E2E funzionali.

Toolchain G6 Linux amd64: `pnpm install --frozen-lockfile` con Node 24.21.0
e pnpm 10.34.5 PASS; due `pnpm --filter @workspace/api-spec run codegen`
PASS, generated byte-identici prima/dopo entrambi i passaggi; hash
aggregato nel laboratorio `36650ff7bf197aee6f3cf2d62df897febd25b6f960f3907c67cdd9d71b627e49`.
`pnpm run typecheck`, build API, frontend e workspace, bundle budget
(1309,9 KiB / 363,5 KiB gzip, limite 400 KiB) e runtime shell ufficiale
PASS. Il primo codegen offline aveva richiesto Corepack/registry, e il
primo build frontend senza `PORT` si era fermato per configurazione del
laboratorio: ripetuti con Corepack disponibile e `PORT=19176 BASE_PATH=/`,
sono passati; nessuna modifica di codice o policy. Warning sourcemap/chunk
già noti non bloccanti. La build nativa macOS resta separatamente bloccata
dal binario `lightningcss.darwin-arm64.node` escluso dalla policy
preesistente: **non è dichiarata PASS e non è stata corretta**.

La suite frontend completa è stata ripetuta: **75/75 file, 411/411 test
PASS**. La suite E2E M4B.1 è stata ripetuta su API/DB reali isolati:
**10 PASS, 2 skip di progetto** nei tre viewport desktop/tablet emulati.
Gli skip sono esclusivamente il caso Mensa a due sessioni eseguito sul
desktop, non un aggiramento del runtime. Il primo rerun ha avuto un
timeout di apertura del dettaglio durante la corsa concorrente del runner;
il secondo ha evidenziato una dipendenza nascosta da una Mensa preesistente
nel database fresco e un login iniziale in attesa. La fixture M4B.1 ora
crea magazzino Mensa e Mensa sintetici nello stesso DB disposable;
una prima prova mirata ha rivelato un codice oltre `varchar(20)`, ridotto
al limite previsto, e il test Mensa mirato è passato. L'intera suite
E2E successiva, senza runner concorrente, è verde con `--retries=0`.
Queste failure e correzioni restano nella cronologia, senza skip nuovi.

Il fresh gate ufficiale è stato ripetuto su **due database vuoti** della
stessa istanza disposable: schema, 41/41 migrazioni, seed, CRUD, replay
`0/41`, verify/status `41/41`, zero mismatch. Il runner è stato ripetuto:
**24/24 PASS**, incluse le sottoprove PostgreSQL. La prova di upgrade
popolato autentico **40→41** e i vincoli SQL diretti del rapporto precedente
sono evidenza precedente mantenuta, non spacciata per rerun: la base,
la migrazione 41 (SHA-256
`2b04816cac86bdb82611880cf9c98f5f3b5fdba671c9d1344c3641e52a7409d2`),
le migrazioni 1–40, schema, servizio prenotazioni e route business non
sono stati cambiati nell'hotfix. Il rapporto storico identifica sia il
candidato sia lo snapshot popolato; fresh e runner sono inoltre stati
ripetuti qui. PREP-TR-01…10 sono confermati dai test API pertinenti e
dagli E2E; la REG-M4A integrale è rivalutata sotto, senza inferire
validazione umana.

### Rerun API integrale e decisione finale

Per non attribuire automaticamente al candidato i numeri della run
precedente, è stata ripetuta la suite API completa seriale su un **secondo
database nuovo**, dopo il fresh ufficiale. I due XLSX originali FSE sono
stati montati singolarmente in sola lettura e i test FSE sono stati
eseguiti. Esito reale: **116/117 file verdi, 1332 pass, 2 fail, 2 skip
AGEA opzionali**. Entrambe le failure sono nello stesso test storico non
modificato `scarico-manuale-distribuzione-2-0a.test.ts`:

1. Il test di cambio Area durante il lock riceve 403 con messaggio
   `Beneficiario non accessibile per il tuo profilo`, mentre si aspetta
   il 403 `Risorsa non accessibile per il tuo profilo` del controllo
   transazionale successivo. La route fa un controllo autorizzativo
   preliminare non bloccante: con questa temporizzazione legge il
   Beneficiario _dopo_ il commit del cambio Area e rifiuta già lì.
2. L'assert precedente interrompe il test prima del ripristino della
   fixture; il caso successivo di distribuzione PACCHI riceve quindi 403
   anziché 201. È una failure a cascata, non uno scarico creato male.

Il file test, la route Scarichi e `beneficiarioPolicy.ts` sono
byte-identici alla base pubblicata (`git diff --exit-code` sui tre
percorsi). Due rerun mirati sullo stesso DB disposable hanno riprodotto
esattamente le due failure (`1 pass, 2 fail` ciascuno). La run precedente
di questo stesso candidato aveva dato 1334 pass/2 skip; ciò documenta la
variabilità, ma **non** cancella il fallimento riprodotto ora. Non sono
stati cambiati assert, permessi o route estranei al mandato, né introdotti
skip per ottenere un verde artificiale. Il test richiede una barriera
deterministica della fase di lock e cleanup anche in caso di assert fallito
in un incarico separato; nessuna correzione funzionale M4B.1 è stata
dedotta dai due 403.

La sola modifica di test nella fase B è la fixture Mensa E2E; pertanto
il codice business, SQL, contratti e generated restano identici al
manifest della fase A. Dopo tale modifica, nuova build immagine WEB
`magazzino-m4b1-hotfix-web-final:20260923` PASS (manifest locale
`sha256:14a2e18f5f7d9f7f9ef6ed51fa1a07c551a725ac2d0cf7ede3d28189ac931f84`),
`nginx -t` PASS, Chromium su `/login` PASS con due asset e zero
`pageerror`, config valida e code point URL esatti; `pnpm run typecheck`
workspace e script runtime ufficiale ripetuti PASS. Il build bundle
finale usa gli stessi asset della build precedente (layer `COPY` cached);
il test E2E cambiato non è parte del bundle di produzione.

| Gate | Stato finale | Motivo                                                                                                                                                                                  |
| ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1   | GO           | Branch/base, inventario, index e main verificati; nessuna divergenza iniziale.                                                                                                          |
| G2   | GO           | Review locale M4B.1 e WEB-RUNTIME-01 senza finding applicativi nuovi; difetto test Scarico preesistente e fuori perimetro registrato.                                                   |
| G3   | **NO-GO**    | PREP-TR-01…10 restano verdi, ma REG-M4A non è integralmente verde nel nuovo rerun API: file Scarico storico fallito.                                                                    |
| G4   | **NO-GO**    | Frontend 411/411, E2E M4B.1 10 pass/2 skip e browser reale verdi; API completa 1332 pass/2 fail/2 skip.                                                                                 |
| G5   | GO           | Fresh 41/41 due volte e runner 24/24 ripetuti; SQL diretto e upgrade popolato 40→41 mantenuti da evidenza identificata e file immutati.                                                 |
| G6   | GO           | Install frozen, codegen doppio, typecheck, build API/frontend/workspace, budget, RT-01…12 e immagine finale/smoke verdi. Build macOS nativa ancora distinta e bloccata da LightningCSS. |
| G7   | GO           | NO-GO precedente, tentativi intermedi, failure API, limiti e prove mantenute/ripetute separati; nessuna review o validazione umana attribuita.                                          |
| G8   | GO           | Stop/rimozione nominativa dei quattro container, rete e due tag immagine; nessun volume disposable, persistente e altri progetti invariati.                                             |

Il laboratorio `/private/tmp/m4b1-hotfix-linux.Scmu6M` con build,
test-results e trace temporanee è stato rimosso dopo il resoconto
sanitizzato; i manifest di hash fuori Git sono conservati come evidenza.
I container originali `magazzino-postgres`, `magazzino-api`, `magazzino-web`
mantengono gli ID iniziali e i volumi originali sono presenti. Nessuna
risorsa disposable M4B.1 di questa run resta in `docker ps -a`,
`docker network ls`, `docker volume ls` o nei tag immagini. Nessun altro
progetto è stato toccato.

**Esito della ripresa: `NO-GO-M4B.1/G3-G4`**. G6/WEB-RUNTIME-01 è
corretto e verificato, ma il candidato completo non è pubblicabile con
il rerun API fallito. Working tree preservato, nessuno staging/commit/push;
M4B.2 non avviata, Docker persistente non aggiornato, M4B non chiusa,
validazione manuale M4B.1 e code review ChatGPT non eseguite.

## Ripresa G3/G4 — hardening test Scarico 2.0A

Questa è una **terza run**, successiva ai NO-GO G6 e G3/G4 sopra, che non
vengono riscritti. Ingresso: branch
`codex/magazzino-workflow-unificato`, HEAD locale/remota
`be033bf565c82dccb8187d8cf72e2d1d1732a474`, divergenza 0/0,
index vuoto, candidato M4B.1 e WEB-RUNTIME-01 preservati. Inventario
sanitizzato fuori Git:
`/private/tmp/m4b1-scarico-input-manifest-20260923.txt` (SHA-256
`f38772f6680cdc0ba74d00315277c7b1b21a113dd020ac98676f56508c86bba8`).

### Fase A — `##hardening-test SCARICO-TEST-01`

Il test precedente usava 50 ms di attesa, che non osservavano il lock:
COMMIT anticipato permetteva il 403 preliminare, con testo diverso dal
403 transazionale. L'assert interrompeva il ripristino della fixture
condivisa e causava il secondo 403 sul caso PACCHI. Il test corretto
separa le due vie, con Beneficiari propri. In SCAR-02 il PID della
connessione A e il backend HTTP B sono correlati attraverso
`pg_stat_activity` e `pg_blocking_pids` nello stesso DB: la query B attiva
attende un lock mentre esegue `FOR UPDATE` su `beneficiari`. Solo allora
A esegue COMMIT. La deadline di 8 s è un limite diagnostico, non la
prova del blocco. La risposta attesa è esattamente 403
`Risorsa non accessibile per il tuo profilo`; SCAR-01 attende invece
`Beneficiario non accessibile per il tuo profilo`.

| Prova   | Esito fase A        | Evidenza                                                                                                                                |
| ------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| SCAR-01 | PASS                | Diniego preliminare già fuori scope, body sanitizzato, snapshot business invariato.                                                     |
| SCAR-02 | PASS                | Barriera PostgreSQL osservata prima del COMMIT, diniego transazionale esatto, zero effetti.                                             |
| SCAR-03 | PASS                | Errori controllati prima della richiesta/COMMIT e dopo COMMIT: rollback/cleanup, nessuna contaminazione.                                |
| SCAR-04 | PASS                | PACCHI isolato 1/1 e nel file completo 5/5, 201 e movimento 0,334957.                                                                   |
| SCAR-05 | PASS                | Dieci run completi consecutivi 10/10 senza retry, ognuno 5/5.                                                                           |
| SCAR-06 | PASS di sensibilità | Copia diagnostica isolata con sola rivalidazione transazionale disabilitata: il test fallisce sull'assert `201` anziché `403` (exit 1). |

La prima versione locale dell'iniezione `beforeCommit` interrompeva
una richiesta HTTP già avviata: un 201 poteva completarsi e produrre
anche errori di cleanup. È stata corretta spostando l'iniezione prima
dell'avvio HTTP; il file è stato rieseguito su DB fresco e poi dieci
volte consecutive. Il mutante SCAR-06 ha anche errori di teardown nel
**solo** DB mutante, perché il 201 ha scritto effetti immutabili: il
segnale di sensibilità è l'assert 201≠403, non il teardown. Nessuna
variante mutata è nel candidato.

Fase A terminata senza staging/commit/push. Manifest congelato dopo la
correzione: `/private/tmp/m4b1-scarico-frozen-manifest-20260923.txt`
(SHA-256 `98147a827d63825ee5cfc2e4e661f5107b5bdc66f82acceac49f93a8bc6b2abd`): soltanto il test Scarico differiva dall'ingresso.

### Fase B — `##test M4B.1`, rerun formale

Il file Scarico completo e le suite Scarichi/scope/Bolle/Trasferimenti
M4B.1 e documenti M4A mirate sono **PASS 165/165** su PostgreSQL
disposable con 41/41 migrazioni. PREP-TR-01…10 sono esercitate dai test
mirati e dalla suite API completa, oltre alle evidenze frontend/E2E
precedenti rimaste applicabili; REG-M4A è verificata nel run API intero.

Tre run API integrali preliminari sono state fatte dopo il correttivo Scarico, senza
selezionare solo una sottosuite:

1. macOS nativo, DB fresh: 117 file, 1335 pass/1 fail/2 skip, exit 1;
   failure nel test FSE import di `detail.body.rows[0]` non determinata.
   Il file FSE isolato è poi PASS, senza modifica.
2. macOS nativo, altro DB fresh: 117 file, 1335 pass/1 fail/2 skip,
   exit 1; `socket hang up` nel test storico Cassa-Emporio. Nessuna
   aspettativa o fixture di quel test è stata modificata e non si
   attribuisce una causa non provata.
3. Linux amd64 compatibile, copia hash-identica installata frozen e DB
   fresh: 117 file, 1335 pass/1 fail/2 skip, exit 1. Il solo test
   FSE-R2 che elabora 5.000 movimenti ha superato il limite Vitest
   generale di 30 s nel laboratorio x64 emulato.

Per il terzo caso la prova mirata su macOS con deadline 90 s è PASS in
24,87 s; su Linux emulato è PASS in 34,155 s. Una correzione minima,
autorizzata per i test adiacenti, imposta **60 s solo su quel caso** in
`fse-r2-acceptance.test.ts`, senza cambiare assert, dati, parallelismo
o comportamento di prodotto. Il file FSE-R2 completo è PASS 2/2 senza
override CLI su Linux (caso pesante 35,376 s). Dopo quest'ultima
modifica, sul **nuovo** DB fresh `m4b1_scarico_linux_final` (41/41)
il comando ufficiale `pnpm --filter @workspace/api-server run test`
termina con **exit 0: 117/117 file, 1336 pass, 0 fail, 2 skip AGEA
opzionali (1338 totali)**. Gli XLSX FSE originali sono montati in sola
lettura; i relativi test sono stati eseguiti. Nessuno skip/retry nuovo.

| Evidenza                                                         | Stato sul candidato finale              | Fondamento                                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SCAR-01…06, Scarico/Scope, PREP-TR e REG-M4A/API completa        | RIESEGUITA                              | Fase A, 165 mirati e run API finale 1336/0/2 dopo l'ultima modifica.                                                                                                    |
| Typecheck workspace, Prettier file coinvolti, `git diff --check` | RIESEGUITA                              | Controlli finali sul checkout, inclusi entrambi i test modificati e i documenti.                                                                                        |
| Frontend 411/411, E2E M4B.1 10 pass/2 skip                       | MANTENUTA CON VERIFICA DI APPLICABILITÀ | Pagine, test E2E, helper condivisi, dipendenze, contratti e generated invariati rispetto al manifest della ripresa G6; i nuovi delta sono test API isolati e documenti. |
| Fresh 41/41 e runner 24/24                                       | MANTENUTA; fresh RIESEGUITO             | Migrazioni 1–41, schema, runner e lockfile invariati; fresh 41/41 ripetuto sui DB della run API finale.                                                                 |
| Upgrade popolato 40→41, vincoli SQL e concorrenza                | MANTENUTA CON VERIFICA DI APPLICABILITÀ | Migrazione 41 SHA `2b04816c…`, schema, servizio prenotazioni, route Bolle/Trasferimenti, test e helper di quelle prove invariati.                                       |
| G6: RT-01…12, build Linux, codegen doppio, budget/browser        | MANTENUTA CON VERIFICA DI APPLICABILITÀ | Runtime, Dockerfile, Nginx, lockfile, generated, frontend e script G6 invariati; manifest congelato verificato.                                                         |

La seconda correzione di test FSE-R2 è successiva al manifest congelato
di fase A: il suo SHA-256 finale è
`6beb79431cd27974c8d7298b764a5d0d283cdfe157c84a5b05d8b35e550fff36`.
Tutti i percorsi non documentali del manifest congelato hanno mantenuto
gli stessi hash. Route Scarichi, policy Beneficiario, reporting, schema,
migrazioni, OpenAPI/generated, WEB-RUNTIME-01, dipendenze e policy
LightningCSS sono invariati in questa ripresa. La build nativa macOS
resta limitata dal binario LightningCSS escluso: non è dichiarata PASS.

| Gate | Esito finale | Motivazione                                                                                                    |
| ---- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| G1   | GO           | Branch/base/index iniziale e delta verificati; `main` non toccata.                                             |
| G2   | GO           | Review locale di SCARICO-TEST-01 e timeout FSE-R2; nessun finding applicativo nuovo.                           |
| G3   | GO           | SCAR-01…06, PREP-TR-01…10, REG-M4A e suite mirate verdi; controllo preliminare e transazionale distinti.       |
| G4   | GO           | API finale autonoma 1336/0/2, frontend/E2E mantenuti tramite hash e input invariati.                           |
| G5   | GO           | Fresh finale 41/41; upgrade, runner e SQL pertinenti invariati/mantenuti.                                      |
| G6   | GO           | WEB-RUNTIME-01 e input RT/build/codegen/budget invariati; typecheck/hygiene ripetuti, limite macOS dichiarato. |
| G7   | GO           | NO-GO precedenti, failure intermedie e risultati finali cronologici; nessuna validazione manuale attribuita.   |
| G8   | GO           | Laboratorio temporaneo rimosso nominativamente; ambiente persistente protetto invariato.                       |

**Esito automatico: G1–G8 GO.** M4B.1 è candidata alla code review
ChatGPT, non validata manualmente; M4B non è chiusa e M4B.2 non è
iniziata. La pubblicazione, se effettuata, avviene solo sul branch
dedicato e non su `main`; lo stato Git definitivo è registrato nel
resoconto della run.

## Hardening post-code-review — CR-M4B1-01 (24 settembre 2026)

Base locale/remota verificata:
`9e4d9dd6c40b69d96a47f251920d716d5f990ccb`, branch
`codex/magazzino-workflow-unificato`, working tree iniziale pulito,
divergenza 0/0. La migrazione 41 è invariata (SHA-256
`2b04816cac86bdb82611880cf9c98f5f3b5fdba671c9d1344c3641e52a7409d2`);
41 file migration, nessuna 42. Il delta riguarda solo tre modelli Drizzle,
un test DB strutturale e i rapporti CR.

### Causa e parità

Il modello `prenotazioniMagazzino.ts` ometteva le due FK owner composte
già create dalla migrazione. Ora le dichiara con `foreignKey` e
`onDelete("restrict")`. Il primo tentativo fresh ha trovato un secondo
vincolo d'ordine del tool: Drizzle Kit emette le FK prima dei
`uniqueIndex` parent, causando PostgreSQL `42830`. Le due chiavi
`(id,bolla_id)` e `(id,trasferimento_id)` sono state rese `unique`
inline nei rispettivi modelli, mantenendo i nomi e l'unicità. Il
fresh-db-gate ufficiale successivo è verde. Le FK singole e il CHECK
owner restano inalterati.

| Catalogo `pg_constraint`                             | Colonne locali → tabella/colonne referenziate                                           | Delete   |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- | -------- |
| `prenotazioni_magazzino_bolla_riga_owner_fk`         | `(riga_bolla_id,bolla_id)` → `bolla_righe(id,bolla_id)`                                 | RESTRICT |
| `prenotazioni_magazzino_trasferimento_riga_owner_fk` | `(riga_trasferimento_id,trasferimento_id)` → `trasferimento_righe(id,trasferimento_id)` | RESTRICT |

Il sesto caso strutturale confronta questi nomi, colonne e azioni in
metadata Drizzle, migrazione 41 e catalogo PostgreSQL. Verifica anche
le due chiavi univoche parent per nome/colonne. I casi OWNER-FK-01…05
eseguono `INSERT` diretti, ogni fixture in transazione con `ROLLBACK`:

| Caso        | Esito                                                                                |
| ----------- | ------------------------------------------------------------------------------------ |
| OWNER-FK-01 | Bolla A con riga di Bolla B → `23503` sul FK composto Bolla.                         |
| OWNER-FK-02 | Trasferimento A con riga di Trasferimento B → `23503` sul FK composto Trasferimento. |
| OWNER-FK-03 | Bolla e propria riga → INSERT valido.                                                |
| OWNER-FK-04 | Trasferimento e propria riga → INSERT valido.                                        |
| OWNER-FK-05 | Owner incompleto o misto → `23514` su `owner_exclusive`.                             |

Esito finale del nuovo file: **6/6 PASS** su DB fresh 41/41 e **6/6
PASS** su copia disposable con le chiavi parent nella forma di indici
univoci della migrazione 41. Il primo run del sesto caso era fallito
soltanto perché `pg` restituiva l'array SQL di tipo `name[]` come testo;
la query di test usa ora `to_json` e confronta gli array effettivi. Non
è stata cambiata un'aspettativa funzionale per ottenere il verde.

### Regressione e limite di tool

La suite mirata finale (OWNER-FK, Pronto M4B.1, Trasferimenti, Bolle
prenotazioni e Giacenze prenotazioni) su un secondo DB fresh è **5/5
file, 117/117 test PASS**, exit 0. Una run intermedia sul primo DB aveva
116 PASS/1 FAIL: un test storico Trasferimenti ha ricevuto 404 in
`/conferma` dopo `Avvia`. Isolato è PASS; il gruppo completo è poi
PASS sul primo DB e su un secondo DB fresh. Il corpo del 404 non è
stato acquisito, quindi non gli si attribuisce una causa dimostrata;
nessuna route o fixture di quel test è stata alterata. La diagnostica
temporanea dell'assert è stata rimossa dal working tree. Resta una
cautela se il 404 dovesse ricomparire, non un PASS inventato della run
fallita.

Il **fresh-db-gate ufficiale** su DB vuoto è PASS: bootstrap Drizzle,
41/41 migrazioni, seed, login/cambio password, CRUD Area, replay 0/41,
verify/status 41/41 senza mismatch. Runner migrazioni **24/24 PASS**;
verify del catalogo copia-indice **41/41 PASS**. Typecheck workspace
PASS. Codegen, FSE completo, E2E browser, build WEB e upgrade popolato
40→41 non sono stati ripetuti: schema dei contratti API, codice business,
migrazione 41, runtime e lockfile sono byte-identici alla base; le loro
evidenze precedenti restano applicabili. Prettier e `git diff --check`
sono stati eseguiti sui file finali.

Un tentativo di `pnpm install --frozen-lockfile --offline` sulla
postazione si è fermato **prima di modificare `node_modules`** perché
pnpm chiedeva conferma interattiva di purge (`NO_TTY`); typecheck e
test hanno usato le dipendenze già installate, mentre lockfile e
toolchain non sono stati modificati.

Prova diagnostica aggiuntiva, **non** gate di upgrade: sulla copia
disposable con i soli indici parent della migrazione 41,
`drizzle-kit push` ha tentato di aggiungere constraint `UNIQUE` con
nomi già occupati dagli indici e ha stampato PostgreSQL `42P07`. Non
si dichiara quella prova verde. Il progetto usa `push` solo nel
bootstrap **vuoto**, passato, e il runner migration sui DB esistenti,
anch'esso passato. La differenza fisica constraint/indice parent è
documentata in `REVISIONE_STATICA_M4B1.md`; la semantica e il catalogo
dei due FK owner coincidono in entrambe le forme. Nessuna migrazione
è stata riscritta o aggiunta per mascherare il limite del tool.

Il laboratorio ha creato soltanto
`magazzino-m4b1-owner-fk-db-20260924` (PostgreSQL 16 `--rm`, dati
`tmpfs`, porta `127.0.0.1:55453`) e cinque database interni
disposable: `m4b1_owner_fk`, `m4b1_owner_fk_fresh`,
`m4b1_owner_fk_target`, `m4b1_owner_fk_index`,
`m4b1_owner_fk_gate`. Il container è stato arrestato e auto-rimosso
per nome dopo le prove; nessuna rete o volume disposable è stata
creata. Il controllo finale non mostra risorse con prefisso
`magazzino-m4b1-owner-fk-`. I container persistenti
`magazzino-postgres` (`57e462be280a`), `magazzino-api`
(`2beebbad6c21`) e `magazzino-web` (`f344ed86a768`) conservano gli
ID iniziali e sono attivi; i due volumi persistenti originali sono
presenti. Nessun altro progetto Docker è stato interessato.

**CR-M4B1-01 corretto e verificato nel perimetro richiesto; M4B.1
rimane `OK-TEST-M4B.1/NE-MAN`, pronta per chiusura della code review.**
La validazione manuale non è stata eseguita; M4B non è chiusa e M4B.2
non è iniziata. Docker persistente e `main` non sono stati modificati.
