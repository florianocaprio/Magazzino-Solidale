# M5C2-A-R2 — ##test formale post-F1

Data: 6 ottobre 2026. Candidato: `d211f41c691756ecc11bf746a7e4305d35cd8335` più il working tree M5C2-A/R2/F1, inclusi i nuovi file. Questo rapporto non sostituisce il precedente [`M5C2-A-R2-test-report.md`](M5C2-A-R2-test-report.md), che conserva il FAIL storico G6.

## Preflight e perimetro

- Branch `codex/magazzino-workflow-unificato`, HEAD locale e tracking remoto alla SHA attesa, divergenza `0/0`, staging vuoto. Delta iniziale: 15 file tracciati modificati e 8 non tracciati. Nessuna migration/schema modificati. `main` non è stato modificato.
- Il finding precedente era una falsa candidatura della riconciliazione quando l'Area della Richiesta divergeva da quella della Bolla. Il fix F1 del working tree estende la validazione territoriale e viene ricertificato sotto.
- Durante questo `##test` è stato modificato soltanto `artifacts/magazzino-solidale/src/pages/richieste-magazzino.test.tsx`: fixture di lista fedele agli stati e nuova regressione sulle tre viste, conteggi, reset pagina e deep-link. Nessuna modifica applicativa, OpenAPI, migration o generated eseguita manualmente.
- Tutti i DB usati sono sintetici e ospitati in un PostgreSQL 16 temporaneo su loopback, container `magazzino-m5c2a-r2-postf1-db-20261006`, storage `tmpfs`, nessun volume dedicato. Nessuna lettura/scrittura del DB persistente.

## G6 — riconciliazione legacy

Suite mirata `m5c2a-handoff-bolla-pronta.test.ts`: **13/13 PASS** sul DB effimero. La seguente mappa collega i requisiti alle asserzioni del file:

| Caso                      | Esito e prova                                                                 |
| ------------------------- | ----------------------------------------------------------------------------- |
| G6.1 Area Richiesta/Bolla | Esclusione Area divergente; il finding storico non si riproduce.              |
| G6.2 Area magazzino       | `F1-T01`: esclusione quando cambia l'Area del magazzino origine.              |
| G6.3 Centro               | `F1-T03`: esclusione Centro non coerente con beneficiario/Bolla.              |
| G6.4 destinatario         | `F1-T04`: esclusione identità destinatario differente.                        |
| G6.5 link corrente        | `F1-T05`: esclusione link storico/non corrente.                               |
| G6.6 stati M4             | `F1-T06`: stati non terminali esclusi.                                        |
| G6.7 richiesta chiusa     | `F1-T07`: nessuna nuova chiusura.                                             |
| G6.8 TOCTOU               | `F1-T08`: piano invalidato al cambio territoriale anche con admin globale.    |
| G6.9 inventario           | Snapshot stock/movimenti/prenotazioni immutato in dry-run/apply request-only. |
| G6.10 idempotenza         | Conflitto di versione e replay senza secondo audit/effetto stock.             |

Nota metodologica: la prima esecuzione mirata usava un nome DB non ammesso dalla guardia dell'`apply`; la suite integrale successiva su target conforme ricertifica il ramo di applicazione reale. Nessuna riconciliazione è stata lanciata sul persistente.

## G7 — viste Richieste

Il nuovo test frontend verifica `chiusa` da deep-link pagina 3 con conteggio, passaggio ad `annullata` con pagina azzerata e lista vuota, refetch della Richiesta annullata e ritorno ad `aperte` senza falsi positivi. Il test Sheet esistente copre deep-link e continuità. Le API mirate `richieste-magazzino` e `m5c2a-r1-request-cancel` coprono scope, filtri, conteggi/paginazione, stati terminali e storico. Gli E2E R2 verificano la sparizione da Aperte e la presenza effettiva in Concluse dopo reload; gli E2E R1 esercitano l'annullamento da Sheet.

## G8 — annullamento R1

La suite mirata API `m5c2a-r1-request-cancel.test.ts` (nel gruppo API da **71/71 PASS**) copre Richiesta inviata e presa in carico senza documento; Bolla bozza/confermata; Trasferimento pronto; rilascio prenotazioni e stock invariato prima dell'uscita; motivo obbligatorio, nota opzionale, audit/storico; diniego dopo uscita; Intervento preservato; nuova Richiesta; race con conferma/partenza e replay idempotente. L'E2E R1 sulle cinque viewport verifica il percorso GUI reale e la contabilità. Nessun secondo effetto inventariale osservato.

## G2–G5 — regressione funzionale R2

Gli E2E R2 coprono nuova Bolla Beneficiario/Ente da pagina 3 con filtri incompatibili, apertura del nuovo ID, primato nell'elenco anche dopo retrodatazione e reload; Richiesta → Sheet → presa in carico → Bolla contestuale con due righe → ritorno alla Richiesta; consegna e comparsa in Concluse dopo reload. La verifica statica conferma che menu Bolle e Sheet Richiesta usano entrambi `DocumentoOperativoDettaglioComune`, non due editor divergenti. I test API `m5c2a-handoff-bolla-pronta.test.ts` coprono Latte in `l`, FEFO automatico e lotto obbligatorio, stessa conversione M4, pianificazione/concorrenza, decremento stock una sola volta, Richiesta chiusa, Intervento originale preservato e replay. I filtri Stato Bolla e la navigazione sono coperti da unit/E2E R2. Questi sono test tecnici, non UAT manuale.

## G9 — suite e ambiente

- PostgreSQL fresh: schema applicato esclusivamente sul DB effimero, ledger **46/46**; secondo run `applicate=0, skipped=46, pending=0`. Nessuna nuova migration R2/F1.
- Frontend completo dopo il test G7: **89 file, 482/482 PASS**. Typecheck workspace: PASS.
- E2E R2: **10/10 PASS**, due scenari nelle cinque viewport. E2E R1: **5/5 PASS**, uno scenario nelle cinque viewport. Bundle WEB della build Linux usato per il browser test.
- Build Linux API e WEB: PASS. Budget WEB: entry `381.0 KiB gzip` su massimo `400 KiB`.
- API completa finale single-worker su terzo DB fresh: **338/338 file, 1506 PASS, 0 FAIL, 4 SKIP**. Il secondo run con una failure socket resta registrato sotto; non è l'evidenza di chiusura.
- Codegen Orval eseguito due volte: hash aggregato dei 905 file generated `2315e68561a17a0abc791af471cbc87ff6a72cccb449ccbb2775523e7771db1d` prima, dopo il primo e dopo il secondo run. Nessun generated drift aggiuntivo.
- `pnpm install --frozen-lockfile --offline` tentato ma non completato: pnpm rifiuta la rimozione della directory `node_modules` in assenza di TTY (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`). Non è stato forzato un purge; gli `install --frozen-lockfile` delle due build Docker Linux sono riusciti.
- Prettier: PASS per tutti i file sorgente/test/documenti del delta, tranne `lib/api-zod/src/generated/api.ts`, emesso da Orval e non conforme a Prettier anche dopo codegen deterministico; nessuna formattazione manuale del file generato. `git diff --check`: PASS.

### Failure intermedie riconciliate

1. La configurazione Playwright standard non avvia Vite su macOS per il binario nativo LightningCSS. Nessun cambiamento al prodotto: è stato servito il bundle WEB Linux con un harness temporaneo fuori repo.
2. Il seed dell'utente sintetico E2E impone il cambio password; il primo tentativo browser non poteva aprire i flussi. La fixture è stata corretta solo nei DB temporanei, poi E2E R2/R1 sono passati.
3. Primo run API integrale: il nome DB di prova non corrispondeva all'allowlist dell'`apply` e mancava il flag `M5C1_TEST_DISPOSABLE_DB`; non rappresenta un difetto applicativo. Secondo run con guardie corrette: **1505 PASS, 1 FAIL (`socket hang up` nel report allocazione mezzi), 4 SKIP**. Il caso isolato passa **1/1** e l'intero file passa **6/6**. Il terzo run integrale su nuovo DB fresh, senza build/browser concorrenti, passa **1506/1506** con i quattro skip storici. Il FAIL del secondo run resta documentato come intermittente ambientale/harness, non viene cancellato retroattivamente.

I quattro skip storici riguardano il registro AGEA/SIFEAD originale esterno al repository: due test import/parser AGEA e due test FSE+/M3B. Non sono trasformati in PASS.

## Esito, Git e cleanup

La copertura tecnica richiesta è verde. Restano fuori perimetro la validazione manuale/UAT e la pubblicazione: **M5C2-A-R2 — ##test PASS TECNICO POST-F1 — IN ATTESA DI PUBBLICAZIONE E UAT.** Il fallimento `socket hang up` non è stato ignorato: è isolato nel secondo run, passa singolo/gruppo e non si riproduce nella suite finale fresh senza carico concorrente.

Risorse create e ripulite nominativamente: PostgreSQL temporaneo `magazzino-m5c2a-r2-postf1-db-20261006` con DB sintetici, container fermo `magazzino-postf1-web-extract`, tre immagini di prova `magazzino-postf1-api-test:local`, `magazzino-postf1-web-test:local` e `magazzino-postf1-web-builder:local`; processi API/static WEB E2E terminati. Nessun volume o network dedicato creato. Verifica finale Docker: nessuna risorsa `postf1` residua; `magazzino-web`, `magazzino-api` e `magazzino-postgres` ancora attivi, volumi `magazzino-solidale_magazzino_pgdata` e `magazzino-solidale_magazzino_uploads` e rete `magazzino-solidale_default` presenti. Nessun altro progetto toccato. Le evidenze di test restano solo in `/private/tmp/magazzino-postf1-evidence-4hI6hp`, fuori dal repository.

Git finale: branch e HEAD invariati, HEAD locale/remoto `d211f41c691756ecc11bf746a7e4305d35cd8335`, divergenza `0/0`; staging vuoto. Working tree intenzionalmente non pulito (15 file tracciati modificati e 9 nuovi, incluso questo rapporto). `main` locale `8419dc7ff9d5177c39d90e66f04b19236021244d` e tracking `787d7c5436d5fa4c0edb24be373d055946d402ce` invariati. Nessun commit, staging, push, merge o deploy; M5C2-B e M6 non avviati.
