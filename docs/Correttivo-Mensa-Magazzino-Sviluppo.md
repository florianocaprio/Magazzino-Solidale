# Correttivo integrato Mensa / Magazzino — sviluppo e verifiche

## Mandato e base

Branch `codex/magazzino-workflow-unificato`, base locale/remota `df9c9a943937ec1f86ef0071c6f5962e6f2ce6bb`.
Il successivo messaggio di Floriano autorizza push e aggiornamento della 8082 per UAT dopo sviluppo e controlli. Non equivale a UAT superata o al `##test` formale separato. Preview 8083 e documenti locali estranei da preservare. Nessuna operazione su main.

Stato: **SVILUPPO COMPLETATO — CONTROLLI TECNICI DI CONSEGNA PASS**. Pubblicazione e aggiornamento 8082 autorizzati dal messaggio diretto. Collaudo formale separato e UAT non dichiarati superati.

## Diagnosi e decisioni

- Postazione: mancava l'integrazione scanner; il componente comune avviava ZXing prima del montaggio asincrono del video nel portale. Avvio dipendente dal nodo video, rilascio stream e filtro callback ripetute; la scansione resta distinta dalla registrazione pasto.
- Area Operativa: contesto condiviso, fisso per utenti vincolati; scelta esplicita per amministratore multi-area, filtri server e cache contestuali. L'Area non sostituisce assegnazioni Mensa/limiti Centro.
- Rifornimenti: il vecchio POST creava direttamente un trasferimento e richiedeva stock/prodotto/lotto. Ritirato esplicitamente con 410; UI invia una richiesta canonica di fabbisogno. Non viene interpretato il vecchio payload come un nuovo comando.
- Richieste: estensione minima `richieste_magazzino.mensa_id`, FK, indice, vincolo di tipo e trigger d'immutabilità/coerenza destinazione. `sorgente=operativa` resta canonica; nessuna seconda coda o motore stock, nessun grant automatico. Migration append-only 54 dopo le 53 della base. Nessun backfill.
- Creazione trasferimento: risoluzione transazionale della Mensa dal magazzino destinatario nel servizio comune, anche dalla richiesta. Un riferimento esplicito incompatibile è errore, non correzione silenziosa.
- Storico senza `mensaId`: compatibilità solo per Mensa canonica `MEN-MAG-<id>` già esistente alla creazione del documento e mai aggiornata (`created_at=updated_at`). Gli altri casi restano non attribuiti e consultabili dal Magazzino. Non è una ricostruzione esaustiva dello storico: l'assenza di prova non viene trasformata in associazione.
- Trasferimenti: l'unità viene dal Catalogo e non da una lista statica (`cf` non viene convertito in `conf`). L'incompatibilità era riproducibile nel codice; non è dimostrato che fosse la causa del singolo tentativo utente non acquisito. Errori API contestuali.

## Matrice responsabilità

| Operazione                                      | Mensa ordinaria assegnata                           | Magazzino autorizzato            |
| ----------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| Lettura richiesta Mensa                         | request / receive / manage legacy + scope corrente  | richieste_magazzino.view + scope |
| Invio/modifica/annullamento fabbisogno          | request / manage legacy + scope, stati canonici     | grant canonici + scope           |
| Presa in carico/preparazione documento          | No                                                  | grant canonici + scope           |
| Creazione/preparazione/spedizione trasferimento | No, anche con grant origine legacy                  | grant Magazzino + scope origine  |
| Consultazione/ricezione                         | assegnazione destinataria + grant dedicati correnti | grant Magazzino + scope          |

Admin e ruoli misti mantengono le capacità autorizzate nel menu Magazzino; il menu Mensa non espone operazioni sull'origine. Revoche verificate anche prima dei replay, non solo nel menu.

## Completamento dei percorsi

- La coda Magazzino conserva il fabbisogno originale e apre il medesimo documento operativo nello Sheet. Il Magazzino può assegnare il trasportatore usando il controllo esistente, preparare e spedire. La Mensa consulta il dettaglio/PDF e riceve; non dispone di azioni sull'origine.
- Rimossa l'esclusione indiscriminata dei trasferimenti con `mensa_id` dall'elenco/dettaglio unificato Magazzino. Restano scope territoriale, grant e guardie M5B. Il profilo solo Mensa non usa il grant legacy `magazzino.view` per accedere a questa vista.
- Il ruolo misto conserva le capacità Magazzino ma la scrittura tramite grant Mensa richiede la propria assegnazione corrente, anche sul replay. Lettura Magazzino e scrittura Mensa non vengono confuse.
- Il form comune trasferimenti allinea anche l'abilitazione del pulsante al limite della partita selezionata, già mostrato nel messaggio inline. Non cambia il controllo autoritativo M4 della disponibilità né il motore FEFO.
- Errori delle azioni trasferimento mostrati con l'helper esistente. PDF/refetch non innescano una seconda creazione. Le intenzioni dei comandi restano stabili per doppio clic e risposta persa.
- Provider Area/Mensa e query indicizzati per identità e autorizzazioni correnti; cambio contesto con conferma draft, risposta negata che nasconde i dati cached, nessuna preferenza che ampli lo scope.

## Evoluzione delle prove e correzioni

Evidenze private: `/private/tmp/magazzino-mensa-fix-SHSMf3yo`. Log, credenziali sintetiche e trace non fanno parte del commit.

1. Primo API Mensa: 107 PASS, 8 FAIL. Sei casi usavano il POST legacy ora ritirato; un setup usava una porta non ammessa dalla guardia; un difetto nella verifica `req.path` del middleware Mensa negava anche le letture canoniche dopo revoca. Riconciliati i test con un autentico operatore Magazzino distinto, senza promuovere l'operatore Mensa; corretta la verifica del mount. Gruppo successivo: **115 PASS**.
2. Prima API completa: una failure nel test sorgente M5A che pretendeva letteralmente `[sociale, magazzino]`. Ora verifica semanticamente l'esatto insieme `[sociale, magazzino, mensa]`, secondo il nuovo raccordo. Nessun assert di scope eliminato.
3. Aggiunte regressioni ruolo misto/revoca/replay e annullamento pre-uscita con rilascio delle prenotazioni. Gruppo correttivo + contratto M5A: **11 PASS**.
4. Primo browser: **7 PASS, 6 FAIL, 12 SKIP storici**. Cinque failure riproducevano il filtro della vista unificata che nascondeva il trasferimento Mensa; la sesta l'incoerenza del pulsante rispetto alla disponibilità del lotto. Corrette entrambe nell'applicazione, senza indebolire gli assert.
5. Secondo browser: **7 PASS, 6 FAIL, 12 SKIP storici**. Il percorso arrivava alla ricezione: la nuova fixture Area SQL non aveva il `Generale` creato normalmente dal servizio canonico. Aggiunto solo alla fixture, senza backfill dello stock. Il test FEFO storico usava la vecchia etichetta Mensa invece di quella del form Magazzino; aggiornato il testo, preservando gli assert su lotto e quantità.
6. Terzo browser: **13 PASS, 0 FAIL, 12 SKIP storici**. Percorso nuovo eseguito interamente nelle cinque viewport, con due sessioni reali e distinte. Gli skip sono le tre prove storiche mutanti eseguite una volta desktop e non replicate sulle quattro viewport touch; nessun nuovo skip nel percorso correttivo.

## Verifiche di sviluppo

| Verifica                         | Esito / evidenza                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Upgrade autentico popolato 53→54 | PASS, schema dalla SHA base estratta, dati sintetici preesistenti invariati, riferimenti Mensa legacy nulli; `upgrade-result.json` |
| Fresh / replay / parità          | PASS 54/54, seconda esecuzione zero pending, schema semanticamente equivalente                                                     |
| API completa finale              | **1850 PASS, 0 FAIL, 0 SKIP**, 145 file, single worker; `campaign2/formal-api.json` e `.log`                                       |
| Runner migration                 | **24 PASS, 0 FAIL, 0 SKIP**; `campaign2/runner-final.log`                                                                          |
| E2E Mensa finale                 | **13 PASS, 0 FAIL, 12 SKIP storici**; `campaign2/formal-browser-mensa.log`; nuovo percorso completo nelle cinque viewport          |
| E2E continuità Richiesta/Bolla   | **10 PASS, 0 FAIL, 0 SKIP**, cinque viewport; `campaign2/formal-browser-m5.log`                                                    |
| E2E M4 trasporto/rientro         | **8 PASS, 0 FAIL, 32 SKIP storici**; `campaign2/formal-browser-m4.log`, casi mutanti desktop-only preesistenti                     |
| Frontend completo finale         | **614 PASS**, 105 file; `frontend-final.log`                                                                                       |
| Contesto Area/Mensa e lotto      | 4 PASS, inclusi cambio Area con draft, scope fisso, errore con cache e lotto oltre disponibilità                                   |
| Codegen                          | Pipeline canonica eseguita due volte, output deterministico; nessun generated modificato a mano                                    |
| Typecheck                        | PASS, workspace completo                                                                                                           |
| Build API/WEB Linux              | PASS, `pnpm install --frozen-lockfile` nei Dockerfile esistenti, nessuna variazione di dipendenze/policy                           |
| Budget WEB                       | PASS: entry 1400,1 KiB / 387,7 KiB gzip                                                                                            |
| Runtime WEB                      | PASS: script canonico, caratteri speciali inclusi                                                                                  |
| Formatting / diff check          | PASS dopo Prettier sui soli file coinvolti; due file nuovi hanno richiesto il secondo passaggio prima della verifica finale        |

Sul Mac `pnpm install --frozen-lockfile --offline` non è stato completato (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`); non è stata forzata la rimozione delle dipendenze. I comandi nativi hanno usato l'esbuild Darwin già disponibile fuori repository. Entrambe le build Linux hanno invece eseguito l'installazione frozen canonica con successo. Warning di dimensione chunk e sourcemap preesistenti, non errori di build.

Le prove finali sono state sequenziali su PostgreSQL effimeri separati per API generale, Mensa ed Emporio; ogni gruppo browser ha usato un database fresh indipendente. Guardie canoniche del launcher e lock esclusivo impediscono sovrapposizioni mutanti API/browser. I nomi dei log `formal-*` appartengono all'harness riutilizzato: non sostituiscono l'autorizzazione del separato `##test`.

I tre container finali `magazzino-mensa-fix-campaign2-shsmf3yo-{58631,58461,58621}` sono stati rimossi nominativamente, insieme alle credenziali sintetiche. Anche le precedenti istanze di sviluppo/upgrade/campaign1 sono state eliminate. Nessun volume o network Docker temporaneo creato; database su tmpfs. Immagini di build conservate, nessun prune.

## Identità e inventario del candidato

Fingerprint SHA-256 dei 2079 file sorgente/test/helper/configurazione nel contesto di build:
`941a726c27f5a60aa8451fd641a8693e43aa48ea8e5e3bc992d89caa76a8e53f`.
Manifest privato `development-final-context-manifest.json`; confronto dopo API/browser/runner: **zero file divergenti**. Documentazione, segreti, log e output di build esclusi dal fingerprint. Nessuna modifica applicativa dopo il congelamento.

Inventario dei 49 percorsi del correttivo (incluse le rimozioni generated della route ritirata):

```text
artifacts/api-server/src/lib/areas.ts
artifacts/api-server/src/lib/m5bRequestAccess.ts
artifacts/api-server/src/lib/mensaScope.ts
artifacts/api-server/src/lib/mensaTransferDestination.ts
artifacts/api-server/src/lib/transferWorkflow.ts
artifacts/api-server/src/routes/documenti-operativi.ts
artifacts/api-server/src/routes/mensa.ts
artifacts/api-server/src/routes/richieste-magazzino.ts
artifacts/api-server/src/routes/trasferimenti.ts
artifacts/api-server/tests/m5a-contract-migration.test.ts
artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts
artifacts/api-server/tests/mensa.test.ts
artifacts/magazzino-solidale/e2e/mensa-magazzino-correttivo.spec.ts
artifacts/magazzino-solidale/e2e/mensa-workflows.spec.ts
artifacts/magazzino-solidale/src/components/barcode-scanner-button.test.tsx
artifacts/magazzino-solidale/src/components/barcode-scanner-button.tsx
artifacts/magazzino-solidale/src/components/documento-operativo.tsx
artifacts/magazzino-solidale/src/components/mensa-operational-context.test.tsx
artifacts/magazzino-solidale/src/components/mensa-operational-context.tsx
artifacts/magazzino-solidale/src/components/mensa-postazione.test.tsx
artifacts/magazzino-solidale/src/components/mensa-rifornimenti.test.tsx
artifacts/magazzino-solidale/src/components/mensa-rifornimenti.tsx
artifacts/magazzino-solidale/src/components/trasferimenti-lotti.test.tsx
artifacts/magazzino-solidale/src/lib/bolla-query-invalidation.ts
artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts
artifacts/magazzino-solidale/src/pages/mensa.tsx
artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx
artifacts/magazzino-solidale/src/pages/trasferimenti.tsx
docs/Correttivo-Mensa-Magazzino-Sviluppo.md
lib/api-client-react/src/generated/api.schemas.ts
lib/api-client-react/src/generated/api.ts
lib/api-spec/openapi.yaml
lib/api-zod/src/generated/api.ts
lib/api-zod/src/generated/types/createTrasferimentoMensa200.ts
lib/api-zod/src/generated/types/createTrasferimentoMensa201.ts
lib/api-zod/src/generated/types/createTrasferimentoMensa410.ts
lib/api-zod/src/generated/types/index.ts
lib/api-zod/src/generated/types/listMensaAbilitazioniParams.ts
lib/api-zod/src/generated/types/listRichiesteMagazzinoParams.ts
lib/api-zod/src/generated/types/listTrasferimentiMensa200.ts
lib/api-zod/src/generated/types/listTrasferimentiMensaParams.ts
lib/api-zod/src/generated/types/mensaTrasferimentiPage.ts
lib/api-zod/src/generated/types/mensaTrasferimentiPageItemsItem.ts
lib/api-zod/src/generated/types/mensaTrasferimentoSummary.ts
lib/api-zod/src/generated/types/richiestaMagazzino.ts
lib/api-zod/src/generated/types/richiestaMagazzinoCreate.ts
lib/api-zod/src/generated/types/searchMensaBeneficiariParams.ts
lib/db/src/schema/richiesteMagazzino.ts
lib/db/updates/20261013_mensa_richieste_magazzino.sql
```

## Copertura e limiti dichiarati

- AO/SEC: test UI del contesto, API con due Mense nella stessa Area, Area manomessa, nessuna assegnazione, revoca a sessione aperta, ruoli Mensa/Magazzino/misto e accessi diretti. Le regressioni territoriali storiche restano nella suite API.
- CAM: scanner comune con avvio a video montato, stop e callback tardive/ripetute; verifica tessera distinta dal pasto. **Fotocamera reale e lettore fisico: NE-MAN-CAMERA**, non surrogati da test simulati.
- ABI: beneficiario mai abilitato ricercabile nel perimetro; errori distinti da elenco vuoto; suite Mensa storica per tessere/eccezioni/pasti.
- RIC/TRA: nessun effetto inventariale all'invio, fabbisogno 20 e consegna 12 distinti, un solo collegamento, origine Magazzino, destinazione Mensa, ricezione e annullamento pre-uscita. Trasferimento diretto senza richiesta visibile con identità canonica. Compatibilità legacy conservativa e segnalazione dei casi non attribuiti.
- IDE/ERR: replay, collisione chiave/payload, doppio clic e risposta persa; nessuna nuova creazione per recuperare il PDF. Vincoli quantità e concorrenza restano demandati ai servizi M4 e alle relative regressioni.
- **Collaudo formale separato: PENDING. UAT Floriano: PENDING.** Non sono state create assegnazioni automatiche, né documenti di prova nel persistente.

## Consegna 8082

Autorizzata dal successivo messaggio diretto di Floriano, subordinata ai controlli di consegna. Aggiornamento solo dello stack ufficiale esistente, PostgreSQL/volumi/rete preservati e preview 8083 intatta. Nessuna operazione su main.

La precedente procedura M6.4 risultava ferma al restore del backup, per readiness del PostgreSQL temporaneo; non è stata assunta come riuscita. Il preflight di rilascio deve riconfermare il ledger effettivo (atteso 50), eseguire un nuovo backup verificato con readiness TCP, provare **50→54** e l'avvio API sulla copia ripristinata prima di applicare gli aggiornamenti ufficiali. Solo dopo: runner canonico, ricreazione API/WEB, confronto dati/upload, immagini e readiness.

Per la UAT: operatore Mensa assegnato esplicitamente, grant richiesta/ricezione secondo responsabilità, Area valida; operatore Magazzino distinto per presa in carico/preparazione/spedizione. Nessuna elevazione automatica dei profili legacy. Fotocamera su localhost o contesto sicuro e consenso del browser.
