# BUG 6.0 — Ruoli, permessi e moduli

## Mandato e base

Sviluppo sul solo branch `codex/bug6-rbac-ruoli-moduli`, base remota verificata `a80e8c0a21a1e7d2a2cdc43a0f190647cfb76a41`; conservata la ricevuta documentale successiva `267500e`. Cinque documenti locali estranei non inclusi. Fonte prioritaria: richiesta incollata da Floriano, integrata dal prompt BUG6 sul Desktop. Nessun merge/main/deploy autorizzato. La validazione integrata `##test` resta distinta; i risultati di sviluppo non la sostituiscono.

Decisione diretta di Floriano sul Volontario: «deve vedere, non poter modificare la pianificazione turni, la lista delle consegne della sua area, la mappa operativa». Non concede dossier volontari, fornitori, mezzi, anagrafica beneficiari, modifica turni/consegne o uscita merce. Scope Area obbligatorio, nessuna vecchia assegnazione Centro/Zona/Mensa come limite personale.

## Matrice operativa (aspettative indipendenti dai gate preesistenti)

Tutte le righe includono accesso diretto, chiamate accessorie, moduli spenti e diniego altra Area. L'operatore dei test deve essere `isAdmin=false`, `isSuperAdmin=false`, con login e middleware reali. Stato iniziale: difetti riconfermati staticamente, collaudo integrato NON ESEGUITO.

| Ruolo/profilo | Workflow → menu/pagina/sottovista | Azioni ordinarie e API | Capacità e moduli | Perimetro/esito atteso e difetto iniziale | Prova da preparare |
| --- | --- | --- | --- | --- | --- |
| Operatore UDS | UDS → anagrafica, scheda, interventi | directory, collegamento, creazione/rettifica/note/bisogni, tipi e zone | area uds; 10 grant ordinari; UDS | intera Area; nessun dossier sensibile/credito implicito | login UDS, CRUD e dinieghi |
| Operatore UDS | UDS → report giornaliero; filtri/dettagli/PDF/export | `/report/uds/*`, filter-options, drilldown, prepare | uds.reports.view; UDS + REPORT | niente Analisi necessaria; gate Analisi incoerenti riconfermati in UI/server | report completo, sezione contraffatta e revoca |
| Operatore | Centro di Ascolto → beneficiari/schede/FSE | directory, anagrafica, import/export, duplicati | sociale, beneficiari.*, FSE esplicito; CENTRO_ASCOLTO/BENEFICIARI | Area; servizi sensibili solo con grant, nessuna uscita merce | CRUD/FSE e dossier negati agli altri ruoli |
| Operatore | Centro → interventi/bisogni/report | azioni sociali, tipi, report operativo | sociale.interventi.*; CENTRO_ASCOLTO/INTERVENTI/REPORT | Area, report del servizio; sorgenti estranee escluse | ciclo intervento/report |
| Operatore | Centro → enti esterni/richieste/documenti | richieste/create/update/cancel; bolle.view; enti view/manage | MAGAZZINO_SOLIDALE/CENTRO_ASCOLTO/BOLLE | richiedere/consultare; niente conferma/storno/uscita stock | richiesta→pianificazione, POST bolle negato |
| Operatore | Centro → consegne/turni | pianificare/completare/annullare; selezioni magazzini, mezzi, volontari, ruoli e carico | consegne.*, logistica.turni.*; CONSEGNE + CENTRO_ASCOLTO | Area; letture minime, nessun potere sugli archivi di supporto; 403 accessori riconfermati | flussi con risorse sintetiche di due Aree |
| Operatore Magazzino | Magazzino → prodotti/carichi/pratiche/FSE/lotti/raccolte | prodotti, fornitori di selezione, pratiche/righe/chiusura/aggiunte; import/mapping | magazzino.view/products/stock.receive/agea; PRODOTTI/CARICHI/LOTTI | Area + fornitori locali/globali; nessuna gestione Fornitori implicita | manuale/FSE, sola selezione e divieto dossier |
| Operatore Magazzino | Magazzino → giacenze/movimenti/preparazione/bolle/trasferimenti/scarichi | presa/preparazione richieste, documenti e stock, report | grant magazzino/richieste/bolle; motore + moduli specifici | Area; storno amministrativo escluso | stock/documenti/concorrenza nel test isolato |
| Operatore Logistica | Logistica → volontari/mezzi/approvazioni | CRUD operativo e approvazioni, disponibilità e export | logistica.*; LOGISTICA/VOLONTARI/MEZZI | Area; niente amministrazione globale cataloghi | archivi e approvazione con ruoli veri |
| Operatore Logistica | Logistica → fornitori/ordini/ricezione/report | gestione fornitori locali, ordini e ricezione; selezioni prodotti/magazzini | fornitori.view/manage + approvvigionamenti.*; FORNITORI/APPROVVIGIONAMENTI/REPORT | Area e globali in lettura; nessuna intera area Magazzino concessa | ordine→ricezione, mutazioni stock dirette negate |
| Operatore Logistica | Pianificazione turni | leggere/gestire turni e selezioni minime | logistica.turni.*; CENTRO_ASCOLTO | Area; incoerenza area Sociale rispetto al seed riconfermata | turni senza area Sociale |
| Emporio | Emporio → accessi/saldo/cassa/spese/documenti | letture operative dedicate; sospendi/riprendi/chiudi; stampa | emporio.access/cassa/sales + credito.view; EMPORIO_SOLIDALE/CREDITO_SOLIDALE | Area; niente dossier Magazzino/beneficiari; impostazioni stampa amministrative non accessibili | cassa completa, config minima, force/reverse/adjust negati |
| Operatore Mensa | Mensa → postazione/pasti/abilitazioni | tessere, ricerca minima, pasti e stato | grant Mensa ordinari; MENSA | Area intera; unicità pasto, niente secondo pasto/riapertura impliciti | sette sottoviste e dinieghi |
| Operatore Mensa | Mensa → rifornimenti/consumi/eccezioni/report | richieste/ricezione, consumi, eccezioni Area, report | grant dedicati; MENSA e dipendenze effettive | niente preparazione/spedizione del Magazzino | documenti/rifornimenti, altra Area negata |
| Volontario | Pianificazione turni/consegne/MAPS | sola lettura, filtro Area; nomi operativi dai record/selettori minimi | logistica + turni.view/consegne.view/maps.operational/route | solo propria Area; nessun CRUD né dossier; fornitore area-only eccessivo | account vero, GET riusciti; tutti i metodi mutativi negati |
| Amministratore globale | Amministrazione e servizi | gestione ordinaria condivisa, utenti/ruoli | isAdmin; moduli attivi | globale; configurazioni SuperAdmin e originali riservati separati | account admin non SuperAdmin, ultimo admin |
| Amministratore territoriale | Amministrazione e servizi | gestione solo Area | isAdmin + Area assegnata | niente modifica ruoli/config condivisa/risorse globali | attraversamenti Area/NULL e ultimi admin |
| SuperAdmin | Super Admin → ambiente/moduli/audit/log | configurazione dedicata | isSuperAdmin + policy esplicite | rispetto scope territoriali delle policy specialistiche | account separato e dati minimizzati |
| Custom sola lettura | Servizio assegnato, viste di lettura | solo grant di consultazione scelti | aree e grant indipendenti | nessun salvataggio implicito; revoche efficaci | normal login, azioni dirette negate |
| Custom multi-area | Unione dei soli workflow concessi | dipendenze condivise senza cancellazioni | unione esplicita, moduli sorgenti | Area territoriale unica; nessun dato sorgente non concesso | rimozione gruppo, salvataggio invariato |
| Tutti / ingresso | Generale o prima destinazione autorizzata | dashboard, indicatori/alert/movimenti | area e grant sorgenti + moduli | nessuna fuga di payload per avere Generale | payload API, login, cambio utente |
| Tutti / sessione | grant/revoca da altra sessione | auth/me e cache dipendenti | ricaricamento identità DB già presente | revoca dalla successiva richiesta; riallineamento UI automatico, risposte obsolete scartate | focus/navigazione/cambio utente e richieste in volo |
| Tutti / persistenza | seed nuovo, ruoli esistenti, riavvio | bootstrap create-only + riallineamento esplicito | ID e grant custom conservati | nessun reset per nome; dry-run/backup/CAS/restore della bonifica | due esecuzioni, revoca persistente |

## Inventario iniziale moduli e difetti

- Servizi: MAGAZZINO_SOLIDALE, CENTRO_ASCOLTO, EMPORIO_SOLIDALE, MENSA, UDS. Motori condivisi core: MAGAZZINO, PRODOTTI, GIACENZE, BENEFICIARI, INTERVENTI. Core amministrativi: DASHBOARD, AMMINISTRAZIONE.
- CARICHI è presente ma il flusso pratiche/carichi/FSE usa solo LOTTI: interruttore inizialmente fuorviante. Raccolte e FSE sono componenti del carico, non nuovi interruttori per ogni schermata.
- Documenti/trasferimenti/richieste/enti sono componenti e risorse condivise: non spegnere il motore necessario a un altro servizio.
- FORNITORI, APPROVVIGIONAMENTI, LOGISTICA, VOLONTARI, MEZZI: verificare confine tra archivi e selezione operativa. LOGISTICA inizialmente senza enforcement autonomo coerente.
- REPORT è condiviso anche dai report operativi; Analisi non è un prerequisito del report UDS. REPORT_AVANZATI e PREDITTIVO vanno distinti da capacità disponibili; PREDITTIVO inizialmente futuro ma default attivo.
- MAPS non necessita di un nuovo interruttore: ogni layer deriva da servizio, grant sorgente e territorio; aggiungere sola lettura consegne per Volontario, senza layer sociali estranei.
- `use-moduli.ts` inizialmente fail-open su configurazione sconosciuta; da chiudere e distinguere caricamento/errore da disattivazione intenzionale.

## Ambiente AIM e verifiche

La versione rilasciata dal precedente incarico era a80e8c0. Nessuna evidenza della presente campagna può dedurre i ruoli persistiti dai seed. Ricognizione AIM/utente `marcof`: NON ESEGUITA al momento della prima stesura. Non modificare account reali, password, moduli o dati produttivi. Risultati e comandi di sviluppo seguiranno nello stesso documento, con PASS/FAIL/NON ESEGUITO distinti.

## Implementazione e confini

**Blocco 1.** I report operativi usano area e grant del servizio anche su filtri, drilldown e `prepare`; le analisi trasversali mantengono i controlli sulle sorgenti. Dashboard e aggregati escludono le sorgenti non concesse prima delle query. Il Volontario può leggere soltanto turni, consegne territoriali e relativo layer MAPS; gli archivi non sono aperti per appartenenza a Logistica. Fornitori ha ora `fornitori.view/manage`, anche su dettaglio, bulk e metodi mutativi.

Gli otto GET `/api/operativita/{magazzini,fornitori,prodotti,volontari,mezzi,ruoli-volontari,stampa,carico-volontari}` richiedono un contesto operativo enumerato e verificato sul server. Le proiezioni escludono recapiti, note private, documenti e configurazioni amministrative; il carico volontari riusa l'aggregato territoriale esistente. Area e Centro richiesti devono essere coerenti con l'identità. Non esistono metodi di scrittura su queste URL. Prodotti/ruoli/catalogo stampa sono condivisi; persone e mezzi restano territoriali; fornitori includono i globali già utilizzabili.

Il server rileggeva già l'identità dal DB a ogni richiesta: conservato questo comportamento. La UI aggiorna `auth/me` ogni 30 secondi in pagina visibile, al focus, alla riconnessione e alla navigazione; il salvataggio Ruoli invalida subito la query. Identità, ruolo, grant, territorio e moduli effettivi compongono lo scope. Una variazione annulla le letture pendenti, elimina cache e mutation cache e rimonta la sottostruttura per scartare bozze e dettagli locali. Le risposte tardive non ripopolano la vecchia cache. Le protezioni password e sessione restano esistenti.

**Blocco 2.** Il catalogo Aree espone separatamente `permessiOrdinari` dal catalogo completo. Selezione parziale → completamento ordinario; secondo click quando completo → rimozione spiegata. Le capacità condivise necessarie a un altro gruppo e quelle aggiuntive esplicite restano conservate. Apertura/salvataggio senza modifiche non arricchisce il ruolo. Chiavi persistite sconosciute vengono mantenute e segnalate; nuove chiavi sconosciute sono rifiutate dal server. Gruppi nell'ordine dei servizi, capacità aggiuntive facoltative, clonazione in ruolo indipendente e avvisi non bloccanti per configurazioni incoerenti. Nessun privilegio aggiunto per correggere un avviso.

OpenAPI: aggiunta compatibile degli otto endpoint di selezione e DTO minimi; campi facoltativi nel catalogo Aree/Moduli. Client React e Zod rigenerati solo tramite `pnpm --filter @workspace/api-spec run codegen`. **Nessuna modifica a schema DB, migrazioni o credenziali.** I nuovi grant Fornitori richiedono un riallineamento esplicito dei ruoli esistenti; il bootstrap non lo esegue.

## Differenze dei profili standard

Confronto con gli esatti profili di creazione a80e8c0, non con ruoli AIM letti dal DB. L'ordine dei gruppi cambia solo per l'editor; il confronto della bonifica considera aree/grant come insiemi ordinati per confronto, senza cambiare ID.

| Profilo | Modifica proposta | Grant finali |
| --- | --- | --- |
| SuperAdmin | due nuovi grant Fornitori; capacità originali FSE ancora esplicite | 110 |
| Amministratore | due nuovi grant Fornitori; resta distinto da SuperAdmin | 110 |
| Operatore | aggiunti `maps.operational/route`; bolle di sola consultazione | 35 |
| Operatore Magazzino | dotazione invariata; Fornitori tramite selezione minima, non anagrafica completa | 24 |
| Operatore Logistica | aggiunti `fornitori.view/manage`; Turni funziona senza Sociale | 15 |
| Operatore UDS | dotazione invariata; corretto il percorso dei report senza Analisi | 10 |
| Emporio | rimossi Generale e Magazzino dal template; conservati i sette grant ordinari | 7 |
| Operatore Mensa | template invariato, preservate esclusioni per deroghe/riapertura/uscita merce | 14 |
| Volontario | solo area Logistica; quattro grant di lettura turni/consegne/MAPS concordati | 4 |

Il seed crea solo ruoli mancanti. `ensureSuperAdminRole` e l'utente tecnico esistente non vengono riscritti al riavvio. I test modificano una revoca su un ruolo standard vero nel DB temporaneo e la ritrovano dopo due esecuzioni del seed.

## Bonifica versionata: solo manutenzione esplicita

`src/lib/legacyRoleProfiles.ts` contiene i template statici esatti a80e8c0; **non contiene account reali**. Versione `BUG6_RBAC_1`. La CLI propone soltanto una corrispondenza completa nome+isAdmin+aree+grant; personalizzazioni e chiavi sconosciute restano da verificare. ID, descrizioni e assegnazioni vengono conservati.

Comandi da usare soltanto dopo la fase `##test` e una revisione del dry-run sull'ambiente autorizzato (qui provati esclusivamente sul DB temporaneo):

```sh
pnpm --filter @workspace/api-server exec tsx src/cli/rbac-roles.ts dry-run --host HOST --database DATABASE --file /percorso/privato/bug6-plan.json
pnpm --filter @workspace/api-server exec tsx src/cli/rbac-roles.ts apply --host HOST --database DATABASE --file /percorso/privato/bug6-plan.json
pnpm --filter @workspace/api-server exec tsx src/cli/rbac-roles.ts restore --host HOST --database DATABASE --file /percorso/privato/bug6-plan.json
```

`DATABASE_URL` va fornita dall'ambiente autorizzato, mai scritta nel repository o nella ricevuta. Host/database espliciti devono coincidere con la connessione; ricevuta vincolata anche alla porta e alla versione. File privati `0600`, creazione esclusiva senza sovrascrittura; backup mirato prima delle modifiche. Applicazione/ripristino in transazione, lock e confronto del valore corrente prima di scrivere, audit configurazioni; ripetizione già applicata/ripristinata senza effetti aggiuntivi. Se il ruolo è cambiato dopo il piano, nessuna modifica della transazione viene applicata: produrre un nuovo dry-run e revisionarlo. Nessuna esecuzione automatica all'avvio.

**Passaggio manuale futuro:** i ruoli preesistenti non vengono modificati dallo sviluppo. Un Volontario legacy senza grant e una Logistica senza i nuovi grant Fornitori richiederanno la bonifica controllata o una modifica esplicita nell'editor. Non aggirare questa scelta modificando utenti reali.

## Mappatura finale dei moduli

Il modulo non sostituisce il permesso o il territorio. Gli archivi e le proiezioni minime di un diverso servizio sono capacità distinte: spegnere un archivio non deve interrompere Turni/Consegne/Carichi già autorizzati. Le proiezioni restano governate dai moduli del loro workflow, senza riaprire i dossier o la gestione.

| Modulo/capacità | Componenti e gate effettivi |
| --- | --- |
| DASHBOARD (core) | ingresso Generale; payload subordinati a grant e moduli delle singole sorgenti; REPORT per la pagina |
| AMMINISTRAZIONE (core) | utenti/ruoli/configurazioni, confini admin globale/territoriale e SuperAdmin invariati |
| MAGAZZINO (core) | motore inventario e selezione minima magazzini; nessun archivio completo implicito |
| PRODOTTI (core) | catalogo e selezione minima prodotti; mutazioni richiedono grant dedicati |
| GIACENZE (core) | inventario disponibile condiviso dai servizi attivi |
| BENEFICIARI (core) | motore anagrafico condiviso, proiezioni UDS/Mensa/Emporio con policy specialistiche |
| INTERVENTI (core) | motore comune; Sociale usa CENTRO_ASCOLTO, UDS usa UDS |
| MAGAZZINO_SOLIDALE | preparazione, richieste, distribuzione e documenti; componenti non trasformati in nuovi interruttori |
| CENTRO_ASCOLTO | beneficiari completi/import FSE, interventi sociali, Enti esterni, pianificazione Turni/Consegne e report del Centro |
| LOTTI | letture lotti fisici/logici, scadenze e FEFO; non equivale a CARICHI |
| CARICHI → LOTTI | pratiche, righe, raccolte, aggiunte/chiusura, FSE+/AGEA e modifiche raccolte/lotti logici; dipendenza effettiva anche su API |
| SCARICHI | uscita manuale merce; non conferisce le capacità di Bolla o rettifica |
| TRASFERIMENTI | documenti operativi/trasporto; i rifornimenti Mensa mantengono le policy specialistiche |
| BOLLE | documenti di consegna con MAGAZZINO_SOLIDALE, grant ordinari e territorio |
| CONSEGNE | con CENTRO_ASCOLTO: pianificazione/elenco/esiti; grant separati per lettura e comandi |
| LOGISTICA | gestione archivi Volontari/Mezzi/Fornitori, approvazioni e ordini; anche sorgenti corrispondenti dei report |
| VOLONTARI | archivio/dossier/ruoli e relativa sorgente report, insieme a LOGISTICA; proiezioni minime della pianificazione nei servizi attivi |
| MEZZI | archivio/dossier/approvazioni e sorgente report, insieme a LOGISTICA; selezioni minime Turni/Documenti indipendenti dall'archivio |
| FORNITORI | anagrafica e tipologie, insieme a LOGISTICA; selezioni minime locali/globali di Carichi e Ordini nei rispettivi servizi |
| APPROVVIGIONAMENTI | ordini/ricezione insieme a LOGISTICA; selezioni prodotti/magazzini senza concedere l'area Magazzino |
| UDS | directory, interventi, bisogni, zone e report operativo; report anche con REPORT |
| EMPORIO_SOLIDALE | accessi, cassa, spese e stampe operative; cassa e movimenti conservano i controlli specifici |
| CREDITO_SOLIDALE | saldi/storico/politiche; letture storiche restano disponibili se Emporio è spento, nuove operazioni richiedono anche il servizio |
| MENSA | tutte le sette viste, tessere, ricerca minima, rifornimenti e report; nessuna vecchia assegnazione personale a singola Mensa |
| REPORT | dashboard/report operativi e trasversali, filtri/dettagli/prepare/export; sorgenti e Area controllate anche nello snapshot |
| MAPS (componente, nessun nuovo modulo) | layer derivati da servizi e grant sorgenti; Volontario solo `pacchi.consegne`, niente sorgenti sociali estranee |
| BARCODE | fotocamera condivisa e PDF etichette prodotti; disattivazione non elimina codici o tessere né l'inserimento manuale |
| REPORT_AVANZATI, PREDITTIVO | componenti futuri senza consumatori implementati: indisponibili, switch non attivabile; scelta persistita conservata separatamente dallo stato effettivo |

La configurazione pubblica distingue stato configurato, stato effettivo, disponibilità e dipendenze. Core sempre attivi. Il seed aggiorna i metadati del catalogo senza riattivare le scelte dell'ambiente. Caricamento/errore configurazione è fail-closed nella UI, con stato esplicito e riprova. Nessun modulo MAPS inventato e nessun interruttore aggiunto per ciascuna sottoscheda.

## Verifiche di sviluppo — 22 ottobre 2026

Runtime: Node 24.19.0, pnpm 10.34.5. Installazione con lockfile congelato, nessuna modifica delle dipendenze. API esclusivamente tramite runner canonico `scripts/quality-gates-run.mjs`: ispezione del nuovo container, attestazione DB locale usa e getta, dati sintetici, lock esclusivo, chiusura container/rete e nessun volume persistente. Nessuna chiamata alla 8082 o al DB AIM nei test.

| Verifica/comando | Esito realmente ottenuto |
| --- | --- |
| `CI=true pnpm install --frozen-lockfile` | PASS; primo tentativo senza TTY respinto prima dell'installazione, ripetuto correttamente con CI |
| `pnpm --filter @workspace/api-spec run codegen` | PASS; React/Zod rigenerati, successivo typecheck librerie |
| `pnpm run typecheck` | PASS intero workspace |
| `pnpm --filter @workspace/magazzino-solidale run test` | PASS, 131 file / **854 test** nella revisione finale |
| `pnpm --filter @workspace/api-server run build` | PASS |
| build frontend nativa macOS | NON COMPLETATA: lockfile preesistente esclude lightningcss/oxide Darwin; nessun override del lockfile per aggirarlo |
| `docker build --target build -f Dockerfile.web -t magazzino-bug6-web-check .` | PASS nello stage Linux previsto dal repository, nessun avvio dell'applicazione |
| `docker run --rm --network none magazzino-bug6-web-check pnpm --filter @workspace/magazzino-solidale run build:budget` | PASS, **394,0 KiB gzip / limite 400 KiB** |
| compilazione statica `e2e/bug6-rbac.spec.ts` con `tsc --noEmit --target ES2022 --module ESNext --moduleResolution bundler --skipLibCheck --types node` | PASS; non equivale a esecuzione browser |
| bootstrap fresh DB + replay migrazioni nel runner | PASS |
| API Core | PASS, 79 test (11 file) |
| API Reporting | PASS, 83 test (6 file), ripetuti sulla revisione finale |
| API Interventi | PASS, 21 test (3 file) |
| API Mensa | PASS, 118 test (3 file) |
| API Emporio | PASS, 258 test (11 file) |
| API MAPS | PASS, 18 test (2 file) |
| API FSE snapshot | PASS, 2 test (2 file); gli altri test FSE sono nel gruppo generale |
| API General | PASS, **1.579 test / 147 file**, 7 condizionali non eseguiti |
| `git diff --check` | PASS |
| Browser integrato / UAT completo della matrice | **NON ESEGUITO**: fase `##test` separata |
| AIM: ruoli persistiti, ID/assegnazioni, `marcof`, versione effettiva | **NON ESEGUITO**: il tentativo SSH in sola lettura è stato resettato prima dell'autenticazione; nessun dato acquisito |
| merge, push main, deploy, aggiornamento 8082/Hetzner | **NON ESEGUITI**, come richiesto dal mandato BUG6 |

API: 2.158 test passati complessivamente nei risultati finali dei gruppi; 7 condizionali saltati per file reali esterni non forniti al runner (AGEA/SIFEAD originali, Elenco/Massivo beneficiari e originali FSE Registro/Giacenze). I dati sintetici equivalenti sono coperti; i file reali non sono stati copiati nel repository. Non dichiarare passate queste sette prove.

Tracciabilità locale ignorata da Git: `test-results/quality-gates/api/bug6-development-r2` per Core/Interventi/Mensa/Emporio/MAPS/FSE/fresh; `bug6-development-r4` per General/Reporting finali. L'esecuzione completa r2 si era fermata su una fixture nuova incompleta; r4 mirata è passata dopo correzione. **Non è una singola campagna FULL finale verde**, che resta da eseguire in `##test`. Prima esecuzione generale r1: FAIL (nuovi gate richiedevano fixture autorizzate esplicite, catalogo additivo, storico credito da preservare e prove nuove incomplete); seconda r2: sola fixture prodotto nuova incompleta; r3: due aspettative nuove corrette (Area obbligatoria del carico e report Mensa filtrato senza fuga dati). Queste esecuzioni non sono riportate come PASS. Le suite preesistenti mantengono le verifiche territoriali e mutative; sono state aggiornate solo fixture/grant e aspettative funzionali richieste dal nuovo mandato.

Nuove prove: `bug6-rbac-contract` (6 contratti), `bug6-rbac-persistence` (2 prove DB/CLI), `bug6-rbac-session` (13 prove con login normale e catena middleware completa, 9 standard e custom), `auth-session` (provider reale, revoca/Area/utente/moduli e cache), `bug6-rbac` (editor, risposte tardive, MAPS, sorgenti report), salvataggio invariato e clonazione nel test della pagina Ruoli, disattivazione fotocamera nel test Barcode. Per i sette ruoli operatori i login nuovi verificano esplicitamente `isAdmin=false/isSuperAdmin=false`.

## Materiale per la fase separata `##test`

Preparata `artifacts/magazzino-solidale/e2e/bug6-rbac.spec.ts`: account sintetici standard/custom, login UI normale, prima password cambiata, pagine di ciascun servizio, sette viste Mensa, assenza di 403 nelle letture ordinarie, negativi Volontario e cleanup. Destinazione vincolata al runner locale attestato. Esecuzione browser ancora NON ESEGUITA; il compilatore statico non certifica DOM, selettori o workflow.

Comandi per la campagna separata, su checkout di questa revisione:

```sh
pnpm run typecheck
pnpm --filter @workspace/magazzino-solidale run test
CI_RESULTS_DIR=test-results/quality-gates/api/bug6-final node scripts/quality-gates-run.mjs api
CI_RESULTS_DIR=test-results/quality-gates/browser/bug6-final node scripts/quality-gates-run.mjs browser bug6-rbac.spec.ts
```

Il runner deve essere usato anche per le suite browser preesistenti pertinenti (UDS/Reporting, Centro/Richieste/Consegne, Magazzino/FSE/Documenti, Logistica, Emporio e Mensa), senza puntare alla 8082 o a produzione. Sul Mac corrente la UI deve essere avviata nel runtime Linux coerente con il lockfile, senza introdurre aggiornamenti di dipendenze nel solo intento di eseguire il collaudo.

Per ogni riga della matrice registrare PASS/FAIL/NON ESEGUITO: login e destinazione iniziale; menu e deep link; compilazione/salvataggio del workflow completo e selezioni; dettaglio/stampa/export; divieti di tutte le azioni fuori ruolo e seconda Area. Coprire amministratori globali/territoriali, ruoli custom e sola lettura. Eseguire grant/revoca da seconda sessione, nuovo login, focus/poll senza SHIFT+R, cambio Area e cambio utente nello stesso browser, risposta pendente; moduli e dipendenze spenti, configurazione indisponibile; DB nuovo e riavvio, bonifica ripetuta, conflitto dopo dry-run e ripristino. I test API di sviluppo già passati non sostituiscono questi workflow browser completi.

Per le prove AIM mancanti occorre un collegamento in sola lettura funzionante. Nessun cambio a `marcof` o ad account reali per sbloccare un test. Un'eventuale pubblicazione/bonifica reale richiede la successiva fase autorizzata `##merge`; nessun automatismo in questa consegna. Stato: **sviluppo consegnato per `##test`, campagna integrata non chiusa**.

## File modificati o aggiunti

Radice: `/Users/florianocaprio/Projects/Magazzino-Solidale`. Il seguente manifest esclude documenti locali estranei, file ambientali, credenziali, screenshot, log, ricevute private e risultati ignorati. I file sotto `generated/` derivano esclusivamente dal comando OpenAPI indicato sopra.

```text
artifacts/api-server/src/cli/rbac-roles.ts
artifacts/api-server/src/lib/areas.ts
artifacts/api-server/src/lib/configurazioneAmbiente.ts
artifacts/api-server/src/lib/featureFlags.ts
artifacts/api-server/src/lib/legacyRoleProfiles.ts
artifacts/api-server/src/lib/modulePolicy.ts
artifacts/api-server/src/lib/operationalSelections.ts
artifacts/api-server/src/lib/permissions.ts
artifacts/api-server/src/lib/reporting/access.ts
artifacts/api-server/src/lib/reporting/filterOptions.ts
artifacts/api-server/src/lib/reporting/generale.ts
artifacts/api-server/src/lib/reporting/logisticsAccess.ts
artifacts/api-server/src/lib/reporting/queryContext.ts
artifacts/api-server/src/lib/reporting/requestSection.ts
artifacts/api-server/src/lib/roleReconciliation.ts
artifacts/api-server/src/lib/seedRoles.ts
artifacts/api-server/src/middlewares/auth.ts
artifacts/api-server/src/routes/agea.ts
artifacts/api-server/src/routes/aree.ts
artifacts/api-server/src/routes/carichi.ts
artifacts/api-server/src/routes/carico-pratiche.ts
artifacts/api-server/src/routes/dashboard.ts
artifacts/api-server/src/routes/fornitori.ts
artifacts/api-server/src/routes/fse-importazioni.ts
artifacts/api-server/src/routes/index.ts
artifacts/api-server/src/routes/lotti-logici.ts
artifacts/api-server/src/routes/magazzini.ts
artifacts/api-server/src/routes/maps.ts
artifacts/api-server/src/routes/operativita.ts
artifacts/api-server/src/routes/report-integrato.ts
artifacts/api-server/src/routes/report.ts
artifacts/api-server/src/routes/ruoli.ts
artifacts/api-server/src/routes/volontari.ts
artifacts/api-server/tests/area-permission-map.test.ts
artifacts/api-server/tests/bug-prod-01.test.ts
artifacts/api-server/tests/bug6-rbac-contract.test.ts
artifacts/api-server/tests/bug6-rbac-persistence.test.ts
artifacts/api-server/tests/bug6-rbac-session.test.ts
artifacts/api-server/tests/fase5-super-admin.test.ts
artifacts/api-server/tests/moduli-route-combinati.test.ts
artifacts/api-server/tests/report-allocazione-mezzi.test.ts
artifacts/api-server/tests/scoping-direct.test.ts
artifacts/api-server/tests/turni-seeded-rbac.test.ts
artifacts/api-server/tests/uds-hardening.test.ts
artifacts/magazzino-solidale/e2e/bug6-rbac.spec.ts
artifacts/magazzino-solidale/src/App.tsx
artifacts/magazzino-solidale/src/components/barcode-scanner-button.test.tsx
artifacts/magazzino-solidale/src/components/barcode-scanner-button.tsx
artifacts/magazzino-solidale/src/components/beneficiari-provvisori.test.tsx
artifacts/magazzino-solidale/src/components/beneficiario-tessera.test.tsx
artifacts/magazzino-solidale/src/components/carico-merce-tabs.test.tsx
artifacts/magazzino-solidale/src/components/carico-merce-tabs.tsx
artifacts/magazzino-solidale/src/components/documento-operativo.tsx
artifacts/magazzino-solidale/src/components/emporio-permission-parity.test.tsx
artifacts/magazzino-solidale/src/components/layout-maps-navigation.test.tsx
artifacts/magazzino-solidale/src/components/layout.tsx
artifacts/magazzino-solidale/src/components/mensa-postazione.test.tsx
artifacts/magazzino-solidale/src/components/prodotti-m1a.test.tsx
artifacts/magazzino-solidale/src/components/ruoli-area-permissions.test.tsx
artifacts/magazzino-solidale/src/hooks/use-consegna-scan.test.tsx
artifacts/magazzino-solidale/src/lib/area-permissions.ts
artifacts/magazzino-solidale/src/lib/auth-cache.ts
artifacts/magazzino-solidale/src/lib/auth-session.test.tsx
artifacts/magazzino-solidale/src/lib/auth.tsx
artifacts/magazzino-solidale/src/lib/bug6-rbac.test.ts
artifacts/magazzino-solidale/src/lib/logistica-cache.ts
artifacts/magazzino-solidale/src/lib/logistics-report-access.ts
artifacts/magazzino-solidale/src/lib/maps-access.ts
artifacts/magazzino-solidale/src/lib/moduli-servizi.test.ts
artifacts/magazzino-solidale/src/lib/navigation-permissions.test.ts
artifacts/magazzino-solidale/src/lib/use-moduli.ts
artifacts/magazzino-solidale/src/pages/approvvigionamenti.tsx
artifacts/magazzino-solidale/src/pages/beneficiari.tsx
artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx
artifacts/magazzino-solidale/src/pages/bolle.tsx
artifacts/magazzino-solidale/src/pages/carico-merce.tsx
artifacts/magazzino-solidale/src/pages/consegne.tsx
artifacts/magazzino-solidale/src/pages/emporio-cassa.tsx
artifacts/magazzino-solidale/src/pages/emporio-crediti-saldo.tsx
artifacts/magazzino-solidale/src/pages/emporio-spese.tsx
artifacts/magazzino-solidale/src/pages/fornitori.tsx
artifacts/magazzino-solidale/src/pages/prodotti.tsx
artifacts/magazzino-solidale/src/pages/richieste-magazzino.test.tsx
artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx
artifacts/magazzino-solidale/src/pages/ruoli.tsx
artifacts/magazzino-solidale/src/pages/super-admin-moduli.tsx
artifacts/magazzino-solidale/src/pages/turni.test.tsx
artifacts/magazzino-solidale/src/pages/turni.tsx
artifacts/magazzino-solidale/src/pages/uds-report-giornaliero.tsx
docs/bug6-rbac-ruoli-moduli.md
lib/api-client-react/src/generated/api.schemas.ts
lib/api-client-react/src/generated/api.ts
lib/api-spec/openapi.yaml
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/area.ts
lib/api-zod/src/generated/types/fornitoreOperativo.ts
lib/api-zod/src/generated/types/getCaricoVolontariOperativo200Item.ts
lib/api-zod/src/generated/types/getCaricoVolontariOperativoContesto.ts
lib/api-zod/src/generated/types/getCaricoVolontariOperativoFascia.ts
lib/api-zod/src/generated/types/getCaricoVolontariOperativoParams.ts
lib/api-zod/src/generated/types/getStampaOperativaContesto.ts
lib/api-zod/src/generated/types/getStampaOperativaParams.ts
lib/api-zod/src/generated/types/index.ts
lib/api-zod/src/generated/types/listFornitoriOperativiContesto.ts
lib/api-zod/src/generated/types/listFornitoriOperativiParams.ts
lib/api-zod/src/generated/types/listMagazziniOperativiContesto.ts
lib/api-zod/src/generated/types/listMagazziniOperativiParams.ts
lib/api-zod/src/generated/types/listMezziOperativiContesto.ts
lib/api-zod/src/generated/types/listMezziOperativiParams.ts
lib/api-zod/src/generated/types/listProdottiOperativiContesto.ts
lib/api-zod/src/generated/types/listProdottiOperativiParams.ts
lib/api-zod/src/generated/types/listRuoliVolontariOperativiContesto.ts
lib/api-zod/src/generated/types/listRuoliVolontariOperativiParams.ts
lib/api-zod/src/generated/types/listVolontariOperativiContesto.ts
lib/api-zod/src/generated/types/listVolontariOperativiParams.ts
lib/api-zod/src/generated/types/listVolontariOperativiStato.ts
lib/api-zod/src/generated/types/magazzinoOperativo.ts
lib/api-zod/src/generated/types/magazzinoOperativoTipoMagazzino.ts
lib/api-zod/src/generated/types/mezzoOperativo.ts
lib/api-zod/src/generated/types/mezzoOperativoStato.ts
lib/api-zod/src/generated/types/mezzoOperativoStatoApprovazione.ts
lib/api-zod/src/generated/types/moduloFunzionale.ts
lib/api-zod/src/generated/types/prodottoOperativo.ts
lib/api-zod/src/generated/types/ruoloVolontarioOperativo.ts
lib/api-zod/src/generated/types/volontarioOperativo.ts
lib/api-zod/src/generated/types/volontarioOperativoStatoApprovazione.ts
lib/api-zod/src/generated/types/volontarioOperativoTipoVolontario.ts
```
