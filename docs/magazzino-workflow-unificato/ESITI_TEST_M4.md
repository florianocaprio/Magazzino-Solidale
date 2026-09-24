# M4 — validazione automatica formale M4A + M4B.1 + M4B.2

Data: 24 settembre 2026. Base pubblicata, locale e remota all'ingresso:
`98835207ed047dd764633b234ba91f87738c296b`, branch
`codex/magazzino-workflow-unificato`, divergenza `0/0`, index vuoto.
Il working tree M4B.2 non committato è stato preservato e inventariato prima
delle prove. `main` locale/remota non sono stati modificati. Questo è un
verbale **automatico**, non la validazione manuale di Floriano: il massimo
stato conseguibile è `OK-TEST-M4/NE-MAN`.

Manifest finale del candidato: **61 file** Git tracked/untracked
(38 modificati, 23 nuovi), index ancora vuoto prima della pubblicazione.
Comprende 17 file API/test, 14 frontend/E2E, 7 documenti, 1 OpenAPI,
15 generated e 7 DB/runner. L'elenco completo dei percorsi è il risultato
ordinato di `git ls-files -m -o --exclude-standard` sul candidato, senza
configurazioni temporanee. SHA-256 aggregato delle righe
`shasum -a 256 <percorso>` dei 60 file **escluso questo verbale** (per
evitare un hash autoreferenziale):
`92bd9be80e9d13fcdb926ef37e64fbbc2b1d121ba9a42d3890902dd9b9b3f5aa`.
La migration 42 ha SHA-256
`d5714bc6c4f8c0699994a0b953f6ea47d57a22fae215cf90cdff069eda52994c`.

## Review del candidato e correzioni durante il test

La review del delta ha censito route/servizi Bolle, Consegne, Trasferimenti,
Scarichi, Giacenze, Movimenti, FSE, Logistica, as-of, PDF, OpenAPI e
generated. Non è introdotto un secondo motore inventariale: `lotti` resta
lo stock fisico, `prenotazioni_magazzino` gli impegni e `movimenti` il
ledger. `esito` ha effetto fisico zero; i segni fisici di scarico, rientro
e trasferimento sono proiettati da tipo/dettaglio, non dalla sola natura
contabile. La distribuzione finale è un fatto contabile distinto
dall'affidamento. La UI non offre un Magazzino alternativo per il rientro.

Finding riprodotti e chiusi nel solo perimetro autorizzato:

1. La migration 42 creava undici FK con nomi impliciti diversi da Drizzle.
   I nomi SQL sono ora espliciti; fresh e upgrade hanno parità catalogo.
   Le migration 1–41 sono byte-identiche alla base.
2. La regressione `CONC-TR-02` attendeva `400` per versione stale, mentre
   il contratto restituisce il preciso `409`; l'assert è stato corretto
   senza accettare errori generici.
3. FSE+ `distributedKgLt` usava il segno **fisico** dell'evento `esito` e
   quindi dava zero kg distribuiti dopo una consegna trasportata. Il test
   `REPORT-M4-B-KG` è stato prima osservato rosso (attesi 20, ottenuti 0),
   poi è passato con la proiezione contabile della distribuzione; la
   compatibilità `LEGACY` è conservata.
4. Due test storici direttamente bloccanti della suite API (Cassa Emporio
   e lock-order Logistica) hanno dato risultati intermittenti in un run
   completo. Gli assert intermedi e il cleanup sono stati resi espliciti;
   nessun controllo autorizzativo, skip o retry è stato indebolito. Dieci
   run consecutivi dei due file (57 test per run) e il successivo run API
   completo sono verdi. La causa ambientale precisa dell'intermittenza
   storica non è dimostrata e resta un rischio di osservazione.
5. L'E2E M4B.2 assumeva stock demo ancora disponibile dopo altri run. La
   fixture inserisce ora una partita dedicata nel solo DB disposable;
   nessuna quantità applicativa è stata modificata per ottenere il verde.

Ogni correzione ha aggiornato il candidato; i gate pertinenti sono stati
rieseguiti. La formattazione del file test Logistica tocca più righe del
solo cambio logico, ma rimane confinata a quel test storico.

## PostgreSQL, schema e upgrade

| Prova                  | Esito                                                                                                                                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh                  | PostgreSQL disposable vuoto, schema, seed/smoke, 42/42 migration, verify 42/42, replay senza nuova applicazione.                                                                                                                                               |
| Upgrade autentico      | Archivio Git della base 41: database popolato e verificato a 41/41, poi il runner candidato applica **solo 42** (`applied=1 skipped=41`).                                                                                                                      |
| Popolazione conservata | Bolle bozza/confermata/consegnata/Ente, prenotazioni, trasferimenti richiesto/preparato/in transito/completato/Mensa, movimenti, distribuzione, lotti FSE e non-FSE; hash delle otto tabelle storiche confrontate invariati. Nessun rientro o esito inventato. |
| Lettura/continuità     | Quattro Bolle e cinque Trasferimenti legacy letti via API; ricezione di un trasferimento già in transito riuscita dopo la predisposizione del `Generale` richiesto nella destinazione.                                                                         |
| Parità                 | Fresh/upgrade identici per 105 colonne, 62 constraint e 32 indici del perimetro M4B.2; owner esclusivo, FK composte, uscite reali, quantità positive e unicità riconciliazione testate anche in PostgreSQL.                                                    |
| Runner                 | 24/24 sottoprove superate, incluse quelle PostgreSQL.                                                                                                                                                                                                          |

Non è stato usato `drizzle push` sul popolato. Non è stata creata la
migration 43.

## Funzionale, concorrenza e reporting

I test PostgreSQL reali M4A/M4B.1/M4B.2 coprono: diretto
`confermato → consegnato` con un solo scarico; `Affida` con consumo esatto
delle prenotazioni FEFO/multi-lotto o lotto esplicito; attore autenticato
distinto dall'incaricato; consegna trasportata Beneficiario o Ente senza
secondo scarico; replay della risposta persa; mancata consegna senza
reintegro; rientro idoneo, deteriorato, scaduto, mancante e rubato nel solo
Magazzino origine; classificazione `altro`, quantità zero/negative,
over/under-return e doppio rientro respinti; terminalità `rientrato`;
Trasferimento richiesto/pronto/avviato/ricevuto o ritornato all'origine,
same/cross Area e nessuna entrata al destino sul ramo rientro. Gli Scarichi
automatici di deteriorata/scaduta sono reali e transazionali; le anomalie
mancante/rubata non producono un secondo movimento fisico. Lo storno di
`esito` resta fisicamente neutro, mentre i documenti con merce fuori
scaffale non usano uno storno che la reintegri indebitamente.

Barriere PostgreSQL osservabili (`pg_blocking_pids`) coprono due Affida,
Affida/Annulla/Storno, due conferme, conferma/mancata, due mancate, due
rientri, operatori/over-return concorrenti, rientro/conferma,
ricezione/mancato arrivo/rientro Trasferimento, revoca di permesso o scope
durante lock, audit/receipt failure, chiave uguale con payload uguale o
diverso e versione stale. Le prove richiedono un solo effetto fisico e un
solo esito terminale, senza timeout usato come prova di acquisizione lock.

| Caso quantitativo                                      |       Fisico | Distribuzione | Altra evidenza                                    |
| ------------------------------------------------------ | -----------: | ------------: | ------------------------------------------------- |
| A: 100, diretto 20                                     |           80 |            20 | Una sola uscita M4A.                              |
| B: 100, Affida 20, consegna 20                         |           80 |            20 | `esito` neutro, anche 20 kg FSE+ distribuiti.     |
| C: 100, Affida 20, rientro 18/1 deteriorato/1 mancante |           98 |             0 | Scarto reale 1; anomalia 1 senza secondo scarico. |
| D: Ente trasportato                                    | -Q una volta |     0 sociale | `CONSEGNA_ENTE` una volta.                        |

Giacenze, disponibilità, as-of, FSE accounting/canonical/reconciliation,
FSE+, Distribution Ledger, Beneficiari, Ente, export e Logistica sono stati
riesaminati sui consumer del ledger; il test kg aggiunto impedisce di
confondere effetto fisico e fatto finale di distribuzione.

## Suite, browser e toolchain

| Controllo sul candidato finale        | Esito                                                                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API completa, singolo run su DB fresh | **119/119 file, 1373 pass, 2 skip, 0 fail**. I due XLSX FSE originali forniti sono stati verificati tramite hash ed eseguiti.                                                                                    |
| Skip API                              | Soltanto le due acceptance AGEA preesistenti, condizionate a `AGEA_ACCEPTANCE_XLSX` non disponibile; nessuno skip M4 nuovo.                                                                                      |
| Frontend completa Linux               | **77/77 file, 415/415 pass**, 0 fail.                                                                                                                                                                            |
| E2E pertinenti                        | **24 prove uniche passate**: M4A 8, Consegne 2, M4B.1 4, M4B.2 5, Magazzino 4, Mensa 1. UI/API/ledger reali, deep-link, PDF, retry, i18n, tablet simulato e permessi.                                            |
| Codegen                               | Due run ufficiali; hash aggregato generated invariato `41fc0f32bd6292cc2452b392e3ed087959d5dd8530723e6fd901b7a7b6237b45`.                                                                                        |
| Install/build                         | Frozen install con pnpm 10.34.5/Node 24 in immagine Linux compatibile; typecheck workspace, build API/frontend/workspace, bundle budget e runtime WEB PASS. Budget entry 1322,2 KiB / 366,4 KiB gzip (<400 KiB). |
| Browser finale                        | Login e pagina Bolle renderizzati; 40 risposte asset JS/CSS, nessuna >=400 e zero `pageerror`.                                                                                                                   |
| Hygiene                               | Prettier dei file candidati non generati e `git diff --check` verificati nel controllo finale.                                                                                                                   |

Il run E2E **aggregato** non è stato nascosto: 13 pass, 2 fail, 1 skip,
3 non eseguiti. Un file chiudeva il pool PostgreSQL singleton condiviso
con il successivo; una fixture storica cercava `LOT-DEMO-001` ormai
consumato da run precedenti. Non è una prova verde. Le spec pertinenti
sono state completate/ripetute con processi isolati e copia fresh del DB:
M4B.1 4/4, Magazzino 4/4, Mensa 1/1; M4B.2 5/5 su DB separato,
M4A/Consegne già passate sul candidato finale prima della collisione.
Nessuno skip o retry automatico è stato aggiunto. Rimane debito storico
di composabilità del runner E2E multi-spec, distinto dagli esiti delle
singole spec.

Il modulo nativo `lightningcss.darwin-arm64.node` manca nell'ambiente
macOS locale: la build nativa non è stata dichiarata verde. Il gate
compatibile Linux x64/glibc è PASS senza alterare lockfile, LightningCSS
o policy multipiattaforma. Il runtime WEB nel vero container candidato e
lo script di escaping ufficiale sono PASS.

## Gate e confine finale

| Gate                   | Esito | Evidenza                                                                                        |
| ---------------------- | ----- | ----------------------------------------------------------------------------------------------- |
| G1 — base/candidato    | GO    | SHA/branch/index/manifest iniziali verificati, `main` invariato.                                |
| G2 — review statica    | GO    | Ledger unico, segni fisici, auth/scope, lineage, storno e PDF riesaminati; finding M4 chiusi.   |
| G3 — schema/migrazione | GO    | Fresh 42/42, populated 41→42, parità e runner 24/24.                                            |
| G4 — funzionale        | GO    | Percorsi diretti, custodia/consegna, rientri, anomalie, Trasferimenti e documenti testati.      |
| G5 — concorrenza       | GO    | Lock PostgreSQL osservabili, idempotenza, versioni, revoca, audit/receipt.                      |
| G6 — reporting         | GO    | Casi A–D e kg FSE+, as-of/FSE/Logistica senza doppio effetto.                                   |
| G7 — suite/UI/E2E      | GO    | API 1373/2 skip ammessi, frontend 415, 24 E2E unici verdi; run aggregato fallito documentato.   |
| G8 — toolchain/runtime | GO    | Codegen doppio, Linux build/budget/runtime, browser, typecheck e hygiene finale.                |
| G9 — documentazione    | GO    | Questo verbale e la matrice separano automatico, storico e manuale.                             |
| G10 — cleanup          | GO    | Container/rete/immagini/DB e file temporanei M4 eliminati nominativamente; originali invariati. |

Il Docker persistente (`magazzino-postgres`, `magazzino-api`,
`magazzino-web` e i relativi volumi) è rimasto fuori dal laboratorio.
Le prove su fotocamera reale e tablet fisico restano `NE-MAN-CAMERA` e
`NE-MAN-TABLET`; non diventano skip applicativi. Nessun dry run manuale
M4B o dell'intera M4 è stato eseguito. Commit/push restano condizionati
ai controlli Git e hygiene finali e a una nuova verifica della SHA remota.

## Hardening CR-M4-01 — incaricato esclusivo in `Affida`

Base della code review `a64db9307008238cdc4265b5398fe2f0aa83b0fe`.
Il finding era reale: il form chiedeva sempre un nome libero e la route lo
salvava anche se la Bolla aveva già `volontarioConsegnaId`, violando lo XOR
M4A. La review locale del delta e della correzione è in
`REVISIONE_STATICA_M4.md`. Il backend conserva l'incaricato già assegnato,
rifiuta la combinazione o la sostituzione durante `Affida`, richiede un
nome solo quando manca; la UI segue gli stessi tre rami. Nessun secondo
scarico, nessuna nuova semantica di cambio incaricato.

| Regressione | Esito sul candidato CR-M4-01                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A           | Volontario valido, payload senza nome: `200`, `in_trasporto`, ID conservato, nome nullo, stock −Q una volta, nessuna distribuzione; retry stessa chiave senza altro effetto. |
| B           | Nome esterno aggiunto a volontario: `400`, Bolla ancora `confermato`, zero movimenti, stock invariato.                                                                       |
| C           | Nome esterno preesistente: senza reinvio `200` e nome conservato; cambio nome tentato `400`.                                                                                 |
| D           | Nessun incaricato e nessun nome: `400`, zero effetti.                                                                                                                        |
| E           | Nome libero: 121 caratteri `400`; nome valido con trim `200`, unico incaricato e un solo scarico.                                                                            |
| F           | Browser reale: volontario e nome esterno già assegnati mostrati senza input e senza `trasportatoreNome` nel POST; senza incaricato input obbligatorio e nome inviato.        |

Test PostgreSQL/API mirati: CR-A…E **5/5**; sei file M4B.2/Bolle/
Consegne **108/108**. Suite API finale in un singolo run sul DB fresh
disposable: **119/119 file, 1378 pass, 2 skip AGEA preesistenti, 0 fail**.
I due XLSX FSE originali sono stati verificati con gli stessi SHA del
verbale M4 e realmente usati. Frontend completa Linux x64:
**77/77 file, 415/415 pass, 0 fail**. E2E su UI/API/DB candidati:
CR-F **1/1** mirato; spec M4B.2 completa **6/6** (Beneficiario, Ente,
mancata consegna, rientro, Trasferimento); Consegne condivise **1/1**
desktop e **1/1** viewport tablet simulato. La spec Consegne disattiva
intenzionalmente il caso dell'altro progetto in ciascun run: entrambe le
prove uniche sono state eseguite, non sono prove manuali su tablet fisico.

Fresh DB 42/42, seed/smoke, replay e verify 42/42 ripetuti nel laboratorio
disposable. L'upgrade autentico popolato 41→42, parità, runner 24/24,
reporting G6, runtime WEB e codegen doppio restano evidenze M4 applicabili:
nessuno dei relativi input cambia rispetto alla base. Verifica SHA-256:
migration 42 `d5714bc6c4f8c0699994a0b953f6ea47d57a22fae215cf90cdff069eda52994c`;
runtime `a189f1174cca6f20ab0cab910005a2cded75e3067fa4a52c68a03d45101e83e4`,
test runtime `7a2d3400c68dc8aae2a1105ed7fa54aa06c2f675970a068351e168c1ba5cb20b`,
OpenAPI `6bb6a07600a9399ebc90410a45cd2de8a465402dfac2c2d5c55d3b20467e5a91`;
generated invariato nel diff Git (hash M4
`41fc0f32bd6292cc2452b392e3ed087959d5dd8530723e6fd901b7a7b6237b45`).
Nessuna migration 43 o modifica a schema, OpenAPI, generated, reporting,
runtime, permessi o modello inventariale.

Frozen install pnpm 10/Node 24, build API e WEB Linux x64, typecheck
workspace e bundle budget superati; entry candidato **1322,5 KiB / 366,5
KiB gzip**, sotto il limite gzip 400 KiB. Prettier e `git diff --check`
sono controlli finali prima della pubblicazione.

Cronologia diagnostica: il primo fresh gate host ha incontrato `EPERM`
nel sandbox locale; il rerun autorizzato sul solo PostgreSQL disposable è
passato. Il primo frontend Linux usava `NODE_ENV=production` ereditato
dallo stadio di build, dove React non esporta `act`: il rerun con
`NODE_ENV=test` è interamente verde. Il tentativo E2E host non ha avviato
Vite per il modulo nativo macOS `lightningcss.darwin-arm64.node` assente;
le spec sono state eseguite senza cambi di policy/dependency nel runner
Playwright Linux temporaneo. Nessuna di queste failure è nascosta o
dichiarata un pass. L'E2E multi-spec del precedente M4 resta una
limitazione storica del pool singleton; qui le spec sono state eseguite
in processi isolati, senza skip/retry aggiunti al prodotto.

Il Docker persistente e `main` restano fuori dal perimetro. Le risorse
temporanee CR-M4-01 sono rimosse nominativamente al termine. Stato M4:
**`OK-TEST-M4/NE-MAN`**; `NE-MAN-CAMERA` e `NE-MAN-TABLET` non sono superati.
