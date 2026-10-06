# M5C2-A-R2 — Elenchi, Stati e Continuità

Data: 6 ottobre 2026. Fase: sviluppo e prove di sviluppo, non `##test` formale né validazione manuale.

## Base e confini

Repository `/Users/florianocaprio/Projects/Magazzino-Solidale`, origin `https://github.com/florianocaprio/Magazzino-Solidale.git`, branch `codex/magazzino-workflow-unificato`.
Base locale e remota verificata: `d211f41c691756ecc11bf746a7e4305d35cd8335` (`feat(m5c2): complete delivery handoff and request cancellation`).
All'ingresso: working tree e staging puliti, nessuna operazione Git incompiuta, nessun file non tracciato da incorporare.
`main` locale `8419dc7ff9d5177c39d90e66f04b19236021244d`, `origin/main` e main remoto `787d7c5436d5fa4c0edb24be373d055946d402ce`: differenza preesistente, nessun riallineamento.

Rapporti precedenti conservati. Nessuna migration, modifica schema, dipendenza/lockfile, Compose/Dockerfile, motore inventariale parallelo o modifica delle guardie autorizzative M5B. Nessun staging, commit, push, merge o deploy.

## Atteso, osservato e correzione

| Caso  | Causa verificata nel codice                                                                                                                                                   | Intervento                                                                                                                                                                                                                                            |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2-01 | Default `dataDocumento`; callback creazione non collegato al dettaglio; invalidazione lista Bolle diversa dalla lista usata; normalizzazione priva di stati trasporto/rientro | Default `dataCreazione DESC`, mantenendo tie-break tipo/ID SQL prima della paginazione e sort espliciti; unico filtro Stato in alto; callback sul vero ID creato; invalidazione Documenti operativi; Sheet aperto, pagina 1, URL e filtri riallineati |
| R2-02 | La chiusura normale esisteva, ma replay e già-consegnata ritornavano prima della chiusura Richiesta                                                                           | Helper transazionale unico di verifica e chiusura; chiamato anche nei rami terminali dopo le guardie correnti; vista Concluse sul filtro server `chiusa`; comando diagnostico separato                                                                |
| R2-03 | `prepareDocument()` e i link documento spostavano il pathname                                                                                                                 | Dettaglio canonico estratto, non duplicato; vista documento interna allo stesso Sheet; deep-link verificato contro documenti correnti/precedenti autorizzati della Richiesta; ritorno interno e protezione delle modifiche                            |

Il caso persistente `RM-00000004 → BOLLA-2026-0009` **non è stato diagnosticato né modificato**. L'origine storica resta un'ipotesi. I video non sono stati visionati: le riproduzioni derivano dalla specifica scritta e dalle fixture sintetiche.

### Elenco e scope

Il nuovo documento è individuato dall'ID restituito, non dal numero. L'Area del form è coerente con la vista e i magazzini inattivi restano esclusi dalle nuove operazioni. Dopo creazione si usa il magazzino effettivo; non si azzera l'Area a tutte. Ricerca/date incompatibili vengono rimossi con avviso, le date compatibili restano. L'Ente non ha un Centro destinatario: il filtro di lista specifico dei Beneficiari non viene applicato alla vista Ente; le guardie territoriali backend restano invariate e il Magazzino/Area della creazione restano espliciti.

API: stessi DTO e parametri, cambia solo il default `sortBy` in OpenAPI e nello Zod rigenerato ufficialmente. Nessun generato modificato a mano.

### Chiusura e prove storiche

L'helper richiede una sola relazione corrente Bolla, identità destinatario coerente, Bolla consegnata, Consegna effettuata dello stesso beneficiario/magazzino quando applicabile, righe coperte quantitativamente da movimenti finali con riferimenti audit e nessuna prenotazione attiva/storno/rientro incompatibile. Le letture diagnostiche selezionano solo identificativi, stati, versioni e campi della prova, non il dossier o le note personali.

Una Richiesta `presa_in_carico` eleggibile passa a `chiusa` con versione +1 e audit; se già coerente, nessuna scrittura. Il normale completamento resta nella stessa transazione M4. I rami terminali non risincronizzano Consegne/Interventi e non rieseguono lo scarico. Le ricevute pregresse non vengono riscritte. L'Intervento originale resta da concludere esplicitamente.

Sono esclusi: destinatari incoerenti, link assenti/cessati, richiesta annullata/inviata, documento non consegnato, prova contabile incompleta o reversali, Consegna incompatibile. I Trasferimenti sono censiti fuori perimetro della chiusura storica, non riparati da questo comando.

### Comando diagnostico

Entrypoint: `artifacts/api-server/src/cli/reconcile-delivered-requests.ts`.

Esempio **da eseguire solo dopo identificazione/autorizzazione del target**:

```bash
pnpm --filter @workspace/api-server exec tsx src/cli/reconcile-delivered-requests.ts --target=NOME_DB --ids=ID1,ID2
```

La connessione deve essere fornita esplicitamente tramite `DATABASE_URL`, mai copiata alla cieca da un altro ambiente. Default: transazione `REPEATABLE READ, READ ONLY`, timeout 15s, allowlist fino a 100 ID, report minimizzato e fingerprint ripetibile; zero audit scritti.

Il modo `--apply --plan=PERCORSO_JSON --actor=ID` è sviluppato esclusivamente per target effimeri `m5c2a_r2`/`m5c2a_r2_*` con `M5C2A_R2_DISPOSABLE_DB=verified`. Richiede target confermato, allowlist `--ids`, piano candidato, attore con autorizzazione corrente e nuova verifica sotto lock canonico. Versione/prova cambiata: conflitto atomico; secondo apply sul risultato coerente: no-op. Non abilita la riparazione del persistente: serviranno review del piano, backup e mandato separato.

### Navigazione

Vista, pagina, `richiestaId` e `documento=tipo:id` sono URL contestuali. Il parametro documento viene confrontato con i soli link autorizzati restituiti per quella Richiesta prima di caricare il dettaglio. Nessuna directory globale per risolvere un ID. Il componente condiviso mantiene i comandi M4 e le capacità originali; refetch in focus e gestione dei dinieghi evitano di continuare a mostrare un dettaglio revocato. Restano validi gli accessi diretti Bolle e il flusso Intervento → Richiesta → Intervento.

## R2-F1 — coerenza territoriale riconciliazione

Il `##test` separato R2 ha rilevato il FAIL bloccante G6: una Richiesta `presa_in_carico` spostata in un'Area diversa da quella del magazzino della Bolla consegnata risultava ancora `candidata`. Il rapporto storico `M5C2-A-R2-test-report.md` conserva quel FAIL senza modifiche. Root cause: `inspectRequestClosure()` verificava identità destinatario, stato terminale e prova contabile, ma non la coerenza territoriale della relazione M5/M4.

F1 aggiunge alla **stessa prova read-only** già usata per piano, apply e chiusura M4/M5 il confronto conservativo fra Area Richiesta e Area reale del magazzino origine; verifica inoltre Area del destinatario e gli snapshot Area presenti. Per il Beneficiario verifica il Centro della Richiesta contro anagrafica e snapshot presenti, la sua appartenenza all'Area e la compatibilità del magazzino condiviso/assegnato tramite `canAccessCentro()` già usato dal workflow M5B. Un Centro legacy assente non viene inventato; un dato territoriale obbligatorio assente o incompatibile viene escluso, non corretto. Gli esiti hanno motivi stabili `area_incoerente` / `centro_incoerente`. Il fingerprint include anche questi dati autorevoli, così l'apply effimero rivalida la prova sotto la transazione e respinge un piano divenuto incoerente. Nessuna nuova policy autorizzativa, migration, API o saldo.

Copertura di sviluppo: F1-T01/T02 mismatch e match Area, inclusa la modifica dell'Area del magazzino origine; T03 Centro; T04 destinatario; T05 link storico; T06 stati Bolla non terminali; T07 richiesta già chiusa; T08 piano candidato diventato territorialmente incoerente prima dell'apply, provato anche con admin globale; T09 fingerprint inventariale invariato dopo apply valido; T10 apply/replay idempotenti senza nuovo audit funzionale. Il test G6 originale è stato conservato nella sua aspettativa e ora passa. Gruppo mirato **13/13**; regressioni M5B link/scope/territorio **71/71**; typecheck workspace PASS. Primo tentativo delle regressioni M5B non era valutabile per `SESSION_SECRET` sintetico mancante: rerun con harness completo verde. Primo ampliamento del test F1 aveva tre errori di fixture (audit atteso in eccesso, link storico incompleto rispetto al CHECK SQL, disponibilità sintetica esaurita), corretti nel solo test prima del rerun verde. `pnpm install --frozen-lockfile --ignore-scripts --offline` ha abortito senza TTY prima di rimuovere `node_modules`; non è stato forzato. Prettier e `git diff --check` verificati separatamente.

La riconciliazione valida continua a modificare solo stato/versione/audit M5; lotto, movimenti, prenotazioni, Bolla e Consegna non vengono riscritti. Il nuovo `##test` formale completo R2 e la validazione manuale restano da eseguire. Nessun database persistente interrogato o riparato in F1.

Il PostgreSQL F1 effimero su `tmpfs` è stato arrestato/rimosso nominativamente; nessun container, volume o rete F1 residuo. I tre container persistenti sono rimasti attivi e invariati. Git: stesso branch, HEAD locale/remota `d211f41c691756ecc11bf746a7e4305d35cd8335`, staging vuoto, working tree R2/F1 preservato (15 file tracciati modificati, 8 non tracciati includendo il rapporto FAIL storico), `main` invariato. Nessun commit, push, merge o deploy.

## File interessati

- Backend: `src/routes/documenti-operativi.ts`, `src/lib/bollaDelivery.ts`, nuovo `src/lib/m5RequestClosure.ts`, nuovo `src/cli/reconcile-delivered-requests.ts` sotto `artifacts/api-server`; regressioni in `tests/m5c2a-handoff-bolla-pronta.test.ts`.
- Frontend sotto `artifacts/magazzino-solidale`: `src/pages/bolle.tsx`, `richieste-magazzino.tsx`, `consegne.tsx`; nuovo `src/components/documento-operativo.tsx` (estrazione dell'implementazione esistente); `src/lib/documenti-operativi-url.ts`, `bolla-query-invalidation.ts`, nuovo `richiesta-documento-navigation.ts`; namespace i18n Bolle/Richieste nelle sei lingue.
- Test frontend: `documenti-operativi-url.test.ts`, `magazzino-hardening-ui.test.ts`, `richieste-magazzino.test.tsx`, nuovo `m5c2a-r2-navigation.test.ts`; nuovo E2E reale `e2e/m5c2a-r2-continuity-real.spec.ts`.
- Contratto: `lib/api-spec/openapi.yaml`, `lib/api-zod/src/generated/api.ts`.
- Questo rapporto; nessun rapporto storico riscritto.

## Prove e failure di sviluppo

Evidenze non versionate: `/private/tmp/magazzino-m5c2a-r2-38i89K`.

- API mirata M5C2-A/R1/Documenti: 31/31 prima del nuovo caso R2; gruppo handoff con il nuovo caso R2: 7/7.
- Primo run frontend: un'aspettativa sul vecchio default, due assert statici sul file prima dell'estrazione e un mock pagina incompleto. Aggiornati al contratto e alla nuova sede del medesimo componente, senza rimuovere controlli. Un ulteriore assert sul link esterno è stato sostituito da apertura contestuale, URL e ritorno verificati.
- Nuovo test API: iniziale errore harness sul nome della tabella distribuzioni, corretto al nome reale; rerun verde. Confronto quantitativo/fingerprint di lotti, movimenti, prenotazioni, distribuzioni, Bolle, Consegne e Interventi prima/dopo apply e replay.
- Primo E2E: attendeva la chiusura automatica del dialog aggiunta prodotto, che per contratto resta aperto. Corretto il test per attendere il reset dei campi e chiuderlo esplicitamente, senza cambiare quel comportamento applicativo.
- `pnpm install --frozen-lockfile --ignore-scripts --offline`: non eseguito fino in fondo, arresto `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Non forzato lo svuotamento delle dipendenze host. Le build Linux eseguono l'installazione ufficiale frozen-lockfile.

### Esiti finali

- Frontend completa: **481 PASS, 89 file**, contro 464 test della base; 17 nuove prove URL/stati/contesto, nessun test rimosso.
- E2E reale finale: **10/10**, due scenari nelle cinque viewport del progetto. Creazione diretta Beneficiario e Ente da pagina 3/filtri incompatibili su dataset con 60 Bolle, nuovo ID aperto, record primo dopo chiusura/reload/retrodatazione; presa in carico e composizione di due prodotti nello Sheet, ritorno, completamento e presenza effettiva in Concluse dopo reload. Login sintetico `sadmin`; nel secondo scenario pianificazione/completamento sono comandi HTTP autenticati reali, non click della UI Centro. Non equivale a una prova manuale o alla matrice browser dei ruoli ordinari.
- Ulteriori failure E2E di harness: ricerca del combobox Ente tramite nome accessibile non esposto dal controllo, e selettore ambiguo per i due pulsanti di ritorno (alto/fondo). Corretti i selettori aderendo al DOM, senza diminuire le asserzioni su ID, URL, righe, stock e stato. Run interrotto in modo mirato; relativi due server effimeri chiusi prima del rerun, senza riutilizzare server sconosciuti.
- API completa single-worker: primo run fresh **1500 PASS, 4 SKIP**; dopo la minimizzazione delle letture diagnostiche, run fresh **1499 PASS, 1 FAIL socket, 4 SKIP**. Caso: `scoping-direct.test.ts / Approvvigionamenti — scoping per centro / POST /:id/sottometti fuori centro → 403`, errore `socket hang up` prima dell'assert autorizzativo. Gruppo mirato rieseguito invariato **44/44**. La causa tecnica del socket non è dimostrata; nessun retry o skip aggiunto. **Conferma completa finale: 1500 PASS, 0 FAIL, 4 SKIP, 131 file, 212.96s**, su un ulteriore database fresh 46/46 `m5c2a_r2_last`, senza build concorrenti (`api-last.log`, `api-last.json`, `last-fresh.log`). Il rerun verde non cancella la failure intermittente documentata.
- Typecheck workspace: PASS (`typecheck-verified.log`).
- Codegen ufficiale in due run: deterministico per i generati; Zod SHA256 `0b19073ec51aec3a4f6a608e6ff747fd0f176ca2715051eb715c65f5ec8d88c1`, client React invariato SHA256 `3d8587cc1f4534617f2a25b7010f23ea258752c4b24e27b687994a684ca87df7`. Delta previsto soltanto nei due default Zod, nessuna API additiva o cambio DTO.
- Build Linux API e WEB: PASS con Dockerfile esistenti e install frozen-lockfile. Budget ufficiale eseguito in Linux sul bundle finale: **381.0 KiB gzip / 400 KiB**, PASS.
- Prettier file applicativi/test pertinenti e `git diff --check`: PASS. Documentazione/E2E formattati separatamente.
- Fingerprint dell'inventario SHA256 dei file modificati/nuovi esclusa documentazione: `e8c14aa975588ee56a694603ad93ead87a1d9ad705a3476664485f7acdca4a1f` (`candidate-files.sha256` nelle evidenze).

I PASS di sviluppo non sostituiscono il successivo `##test` formale. Nessuna validazione umana dichiarata.

Skip effettivi, tutti preesistenti e dipendenti dai file originali AGEA/FSE+ esterni non forniti all'ambiente effimero:

1. `agea-import.test.ts`: bootstrap registro reale, sette righe.
2. `agea-sifead-parser.test.ts`: aggregati registro reale.
3. `fse-import-parser-m3b.test.ts`: T01/T04/T06 originali e sette saldi.
4. `fse-import-practice-m3b.test.ts`: T25, sette saldi/1177 pezzi e 80 carichi storici.

### Copertura da ampliare nel test formale

La suite API completa copre le guardie e le regressioni M4/M5 precedenti. La nuova prova di riconciliazione è focalizzata sul caso Beneficiario con ricevuta, dry-run/apply, conflitto versione e no-op. Restano da aggiungere combinazioni mirate della nuova riconciliazione (Ente storico, link cessato/destinatario incoerente, corsa apply vs annullamento/revoca, conteggio audit dedicato) e una matrice browser R2 completa di ruoli/revoca, Trasferimenti contestuali e protezione Indietro con draft. Non sono dichiarate superate per sola analogia con test preesistenti.

## Matrice UAT per una futura preview autorizzata

| Percorso                                                             | Risultato da verificare manualmente                                                              |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bolla diretta Beneficiario/Ente da elenco filtrato/pagina successiva | Nuovo dettaglio aperto, pagina 1, record visibile, scope non allargato                           |
| Filtri trasporto/rientro e date retrodatate                          | Stato conservato su reload/Indietro; ultime inserite per creazione                               |
| Richiesta → Bolla → due prodotti → ritorno                           | Stesso menu/Sheet, righe persistite, richiesta e lista conservate                                |
| Completamento dal Centro                                             | Richiesta in Concluse, Bolla consegnata, stock una sola volta, Intervento originale non concluso |
| Consultazione Concluse e Trasferimento                               | Dettaglio contestuale autorizzato e storico leggibile                                            |
| Revoca e modifica non salvata                                        | Nessun dettaglio revocato visibile; protezione dei draft                                         |
| Caso storico UAT                                                     | Prima solo dry-run mirato; nessun apply senza mandato separato                                   |

## Risorse e arresto

Persistente non interrogato né modificato. Diagnostica locale in sola lettura: **non eseguita**.
Nessun apply UAT, nessun test su dati reali.

Risorse create e ripulite nominativamente:

| Risorsa                                                                          | Uso                                                                            | Esito                                                                                  |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `magazzino-m5c2a-r2-dev-db-20261006`                                             | PostgreSQL 16 con `--rm`, porta temporanea 58258, tmpfs, nessun volume montato | Arrestato e rimosso                                                                    |
| `m5c2a_r2`, `m5c2a_r2_final`, `m5c2a_r2_verify`, `m5c2a_r2_last`, `m5c2a_r2_e2e` | Cinque DB sintetici nello stesso container temporaneo                          | Eliminati con il tmpfs; riproducibili dalle fixture, non conservati come DB/backup     |
| `magazzino-m5c2a-r2-web-artifacts-20261006`                                      | Estrazione bundle, container mai avviato, ricreato per bundle finale           | Rimosso, nessun mount                                                                  |
| `magazzino-m5c2a-r2-budget-20261006`                                             | Budget ufficiale con bind read-only del solo bundle temporaneo                 | `--rm`, rimosso automaticamente                                                        |
| `magazzino-m5c2a-r2-api:dev`, `magazzino-m5c2a-r2-web:dev`                       | Build isolate, mai assegnate al persistente                                    | Immagini finali eliminate; manifest intermedi già non presenti al controllo nominativo |
| API/WEB browser 19481/19483                                                      | Processi locali temporanei                                                     | Chiusi; porte libere al controllo finale                                               |

Nessuna rete dedicata o volume Docker creato. Censimento finale filtrato per prefisso R2: nessun container, immagine, volume o rete residui. Conservate le immagini base e la cache di build condivisa, senza prune. Non è stata arrestata o modificata alcuna risorsa di altri ambienti/progetti.

Conservate fuori repository le evidenze nella directory temporanea protetta; piani temporanei dei test eliminati nei `finally`. Credenziali esclusivamente sintetiche del DB ormai rimosso; nessun `.env`, dump, screenshot, trace o log introdotto nel repository.

Git finale: branch dedicato invariato, HEAD e tracking remoto sempre `d211f41c691756ecc11bf746a7e4305d35cd8335`; staging vuoto; working tree con **15 file tracciati modificati e 7 nuovi file**, incluso questo rapporto. Ref main locale/remoto invariati. Nessuna pubblicazione.

**M5C2-A-R2 IMPLEMENTATA NEL WORKING TREE — IN ATTESA DI `##test` SEPARATO.**

La matrice di casi aggiuntivi sopra resta esplicitamente da completare nel test formale; nessuna validazione manuale o riparazione persistente è stata effettuata.
