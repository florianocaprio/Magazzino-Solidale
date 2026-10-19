# Campagna dei 20 BUG di ottobre 2026

19 ottobre 2026, Europe/Rome. **Consegna 01: BUG 01 Utenti, PRONTO PER UAT sulla 8082.**

Preparazione prompt 00 conclusa e pubblicata al checkpoint `cf0704b`.
Mandato di Floriano: analizzare il piano ed eseguire soltanto `00_Prompt_Generale.txt`.
Le correzioni iniziano dopo un distinto incarico per il prompt 01; `##test` e
`##merge` sono fasi successive, attivate espressamente.

## Riferimenti e baseline

- Piano operativo v2.1 del 19 ottobre 2026, letto integralmente tramite
  `SPECIFICA_20_BUG.txt` e confrontato con il Word: 394 paragrafi, 10 tabelle;
  contenuti equivalenti, con sole differenze negli a capo di titolo e celle.
- Repository: `florianocaprio/Magazzino-Solidale`, checkout
  `/Users/florianocaprio/Projects/Magazzino-Solidale`.
- Branch unico: `codex/bugfix-uat-ottobre-2026`, creato dalla main verificata.
- SHA base: `f668b7e0563af9004ef793947b45bc7ede94de1b`.
  HEAD iniziale, main locale, origin/main e main remoto letta direttamente
  coincidono; nessuna differenza rispetto alla baseline del piano.
- Nessun `AGENTS.md` nella checkout o nelle directory antenate pertinenti.
  Si applicano le istruzioni AGENTS fornite da Floriano in questa chat.
  Skill Documents utilizzata per la lettura del Word; nessuna modifica al Word.
- Stack confermato: React 19/Vite 7/TypeScript, Express 5, PostgreSQL 16/Drizzle,
  OpenAPI/Orval, Node 24 e pnpm 10.34.5. Node predefinito della shell: 22.23.2;
  per i controlli si usa Node 24.19.0 da `/opt/homebrew/opt/node@24/bin`.

Quattro documenti locali preesistenti, non tracciati, restano esclusi dal commit
e preservati con confronto SHA-256: `docs/M6.2-A-Rilascio-Ufficiale-20261009.md`,
`docs/M6.2-C-Pubblicazione-Preview.md`,
`docs/M6.6-BC-Rilascio-Ufficiale-Chiusura.md`,
`docs/M6.7/M6.7-Merge-Finale.md`. Nessun registro equivalente della campagna trovato.

## Ambienti identificati in sola lettura

Rilievo del 19 ottobre 2026, circa 08:53 Europe/Rome. Nessun recreate,
aggiornamento dello schema, accesso ai dati dei beneficiari o scrittura sugli
ambienti persistenti eseguiti.

| Ambiente             | Identificazione ed evidenza                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Personale 8082       | Progetto Compose `magazzino-solidale`; WEB `magazzino-web`, API `magazzino-api`, DB `magazzino-postgres`; rete `magazzino-solidale_default`. WEB su 8082, DB su 5434, API solo interna su 8080.                                                                                                                                                                                                                                                                                                                                   |
| Versione 8082        | API `magazzino-m67-uat-api:sha-f668b7e0563a`, image ID `sha256:3367e780e91b3682ab7b85d7179d1be6cbc55af1947f0205cd0c2c1688bd4556`; WEB `magazzino-m67-uat-web:sha-f668b7e0563a`, image ID `sha256:c0d49a7cc72cfd2ecb361a8f7c672623ad5750fde535442345d37b55651096a5`. Label immagine e container attestano la SHA base completa.                                                                                                                                                                                                    |
| DB e uploads 8082    | PostgreSQL `postgres:16-alpine`, database `magazzino`; volume `magazzino-solidale_magazzino_pgdata` su `/var/lib/postgresql/data`; volume `magazzino-solidale_magazzino_uploads` su `/app/uploads`. Nessun bind mount dei sorgenti API/WEB.                                                                                                                                                                                                                                                                                       |
| Ledger 8082          | `getMigrationStatus` dal container API: inizializzato, 58/58, zero pending, checksum difformi, file mancanti o fuori ordine. È una lettura, non `migrations:verify` o `update`.                                                                                                                                                                                                                                                                                                                                                   |
| Produzione Hetzner   | Accesso SSH in sola lettura al server indicato in `docs/bug-prod-01-debug.md`; progetto `magazzino-m67-prod`, container `magazzino-m67-prod-api`, `magazzino-m67-prod-web`, `magazzino-m67-prod-postgres`. Percorso stack `m67-safe-deploy/production-final/stack`, distinto dalla 8082 personale.                                                                                                                                                                                                                                |
| Immagini produzione  | API image ID `sha256:b84e5b7e2bf562639b8a2c329be41ed92284f20b35e872d7a667610e72982165`; WEB image ID `sha256:5254dad25b0623c7bee75e90681fb4e3d013135561f492532c32befb9da5bfb1`. Label Git assenti. Nessuna attestazione della versione WEB ricavata dal solo nome dell'immagine.                                                                                                                                                                                                                                                  |
| Allineamento backend | Confrontati 1.289 file di `artifacts/api-server/src`, `lib/db/src`, `lib/api-zod/src` e `lib/db/updates`: zero differenze tra baseline Git, API 8082 e API produzione. Anche gli artefatti API `dist/index.mjs` di 8082 e produzione hanno lo stesso SHA-256: `ec0dd1bcf93b7a0d50ff9b681cb1610da297fdecd2fcb7974fbc831823dbd7bd`. Il contenuto backend è allineato; la provenienza Git della build produzione non è registrata nelle label. Prima del rilascio finale ripetere l'identificazione del candidato e degli artefatti. |

API e DB risultano healthy; il WEB non definisce un healthcheck Docker.
Health non viene usata come prova di versione. In produzione si sono letti
metadati e file del container API, senza interrogare o modificare il DB.

Anche i 142 file statici WEB della 8082 e della produzione coincidono per
SHA-256. Escluso il solo `config.js`, che rappresenta la configurazione runtime
dell'ambiente. Hash del manifest ordinato dei file statici:
`f7bb59797535f0bb40ae8b97d6e73c79efd3d4c036769667d16b1ae06b0c7c3b`.
L'assenza delle label Git di produzione resta un limite di provenienza,
distinto dall'allineamento verificato dei contenuti distribuiti.

Catena Compose effettiva della 8082: file base `docker-compose.yml` più i
seguenti 12 override, in ordine. I percorsi sono relativi a
`/Users/florianocaprio/Backups/Magazzino-Solidale/`; il DB conserva il solo file
base nelle proprie label. Letti esclusivamente i campi tecnici necessari.

1. `M6.3-Ufficiale-eb5c3a7-20261011-t02kmt/release-images.json`
2. `Mensa-Magazzino-535e5a403fd7-2026-10-12T215233-897Z/release-images.json`
3. `Mensa-Preferenza55-535e5a403fd7-2026-10-13T075258-126Z/release-images.json`
4. `Mensa-Inviata-WEB-2026-10-13T082641-500Z/web-image.json`
5. `Mensa-Inviata-WEB-2026-10-13T083035-785Z/web-image.json`
6. `M66-Review-8082-2026-10-14T095628-971Z/rebuild-images.json`
7. `M66-Ufficiale-879d96c-2026-10-15T062300-707Z/rebuild-images.json`
8. `M67-UAT-3073ada-2026-10-16T112114-582Z/rebuild-images.json`
9. `M67-UAT-3073ada-2026-10-16T112114-582Z/web-permissions-image.json`
10. `M67-P3-20261016-DNZ3us/release-images.json`
11. `M67-Docs-4ac37c3-20261017-IM6Hlw/release-images.json`
12. `M67-Main-f668b7e-20261018-qlg04X/release-images.json`

L'ultimo override fissa API/WEB alla SHA base e
`DB_MIGRATION_SOURCE_VERSION` alla stessa SHA. L'entrypoint API esegue `update`
prima dello start: un futuro recreate richiede la fase autorizzata e il
preflight sul percorso incrementale, con backup dei persistenti.

## Decisioni funzionali

Risposte esplicite di Floriano nella chat del prompt 00, 19 ottobre 2026.
Non estendono il mandato a correzioni o rilascio.

| ID  | BUG    | Decisione e stato                                                                                                                                                                                                                                                                                                                                  | Riferimento alla risposta                                                                                      |
| --- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| D01 | 01, 02 | **APPROVATA.** Elimina definitivamente soltanto record mai utilizzati e senza dipendenze. Per quelli con storico, rimozione operativa preservando relazioni e tracciabilità; stessa regola per i dimostrativi già utilizzati.                                                                                                                      | «Confermo, inclusi i dimostrativi già usati».                                                                  |
| D02 | 07     | **APPROVATA.** Ritorno all'elenco Richieste al Magazzino, contesto conservato, senza annullare la richiesta.                                                                                                                                                                                                                                       | «Confermo la proposta».                                                                                        |
| D03 | 12     | **APPROVATA CON PRECISAZIONE.** Sospendi deve comportarsi come le attuali pratiche Aperte; se il salvataggio fallisce si resta sul form. Nel prompt 05 raccordare testata e righe al comportamento esistente senza introdurre una diversa politica di salvataggio implicita. Restano pratica Aperta, ripresa e assenza di contabilizzazione stock. | «Si deve comportare come avviene adesso con le pratiche Aperte. Se il salvataggio fallisce si resta sul form». |
| D04 | 17     | **APPROVATA.** Gestione degli Enti globali riservata agli amministratori globali, utilizzo alle Aree autorizzate; filtro Area con locali e globali utilizzabili, filtro dedicato ai soli globali.                                                                                                                                                  | «Confermo la proposta».                                                                                        |

Per D03 il riferimento nella baseline è `carico-merce.tsx`: `saveHeader` e
`saveRow` salvano esplicitamente, gli errori mantengono il form;
`leaveDetail` usa `useUnsavedChangesGuard`. La risposta di Floriano resta
autorevole: il dettaglio della nuova azione Sospendi si verifica nel prompt 05.
Nessuna decisione residua blocca l'avvio del prompt 01.

## Registro dei BUG

Il BUG 01 è **SVILUPPATO E VERIFICATO AUTOMATICAMENTE, IN ATTESA UAT**; gli altri BUG sono **DA SVILUPPARE**. Le UAT sono **DA ESEGUIRE** e non derivano
dai test automatici. Il candidato iniziale non è un candidato verificato della
campagna. Il punto D03 è un raccordo da verificare nel blocco D.

| BUG | Blocco | Prompt | Stato                     | Requisiti sospesi                                              | Commit           | Automatico                      | UAT         | Ultimo candidato verificato              |
| --- | ------ | ------ | ------------------------- | -------------------------------------------------------------- | ---------------- | ------------------------------- | ----------- | ---------------------------------------- |
| 01  | A      | 01     | SVILUPPATO; IN ATTESA UAT | Nessuno; D01 approvata                                         | 50d55b2, 9d58529 | PASS; 4 skip esterni dichiarati | DA ESEGUIRE | 9d5852991a6aa81426ab7688998175303f4ab8e8 |
| 02  | B      | 02     | DA SVILUPPARE             | Nessuno; D01 approvata                                         | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 03  | B      | 02     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 04  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 05  | C      | 04     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 06  | C      | 04     | DA SVILUPPARE             | Nessuno; requisito sostitutivo Area/Centro prima della ricerca | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 07  | C      | 04     | DA SVILUPPARE             | Nessuno; D02 approvata                                         | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 08  | C      | 04     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 09  | C      | 04     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 10  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 11  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 12  | D      | 05     | DA SVILUPPARE             | Raccordo D03 con le attuali pratiche Aperte                    | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 13  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 14  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 15  | B      | 02     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 16  | D      | 05     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 17  | C      | 03, 04 | DA SVILUPPARE             | Nessuno; D04 approvata; UAT dopo 04                            | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 18  | E      | 06, 07 | DA SVILUPPARE             | Analisi tecnica del modello nel 06; UAT dopo 07                | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 19  | E      | 07     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 20  | F      | 08     | DA SVILUPPARE             | Nessuno; conservare UX20-01–14                                 | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |

## Otto consegne

Ogni consegna segue il relativo sviluppo e il distinto incarico `##test`.
Il prompt 00 non costituisce una nona consegna. I checkpoint 03 e 06 non
chiudono BUG 17 e BUG 18. Per le consegne funzionali serve l'OK UAT esplicito di
Floriano prima di avanzare; nessun OK precedente è trasferito a questa campagna.

| Consegna | Blocco e BUG                  | Tipo            | SHA                                      | Controlli e risultato reale                                                   | Versione 8082                 | Esito                                       |
| -------- | ----------------------------- | --------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| 01       | A: 01                         | Funzionale      | 9d5852991a6aa81426ab7688998175303f4ab8e8 | API 1.564 PASS / 4 skip; UI 730 PASS; typecheck, codegen, build e budget PASS | API/WEB sha-9d5852991a6a      | PRONTO PER UAT; esito personale DA ESEGUIRE |
| 02       | B: 02, 03, 15                 | Funzionale      | —                                        | NON ESEGUITI                                                                  | Non installata                | UAT DA ESEGUIRE                             |
| 03       | C: 17, prima parte            | Tecnica isolata | —                                        | NON ESEGUITI                                                                  | Nessun aggiornamento previsto | UAT NON PREVISTA; BUG aperto                |
| 04       | C: 05–09 e regressione 17     | Funzionale      | —                                        | NON ESEGUITI                                                                  | Non installata                | UAT DA ESEGUIRE                             |
| 05       | D: 04, 10–14, 16              | Funzionale      | —                                        | NON ESEGUITI                                                                  | Non installata                | UAT DA ESEGUIRE                             |
| 06       | E: 18, modello e integrazioni | Tecnica isolata | —                                        | NON ESEGUITI                                                                  | Nessun aggiornamento previsto | UAT NON PREVISTA; BUG aperto                |
| 07       | E: 18 UI, 19                  | Funzionale      | —                                        | NON ESEGUITI                                                                  | Non installata                | UAT DA ESEGUIRE                             |
| 08       | F: 20 e gate finali           | Funzionale      | —                                        | NON ESEGUITI                                                                  | Non installata                | UAT DA ESEGUIRE                             |

## Verifiche iniziali e pubblicazione documentale

L'unico workflow è `.github/workflows/quality-gates.yml`: controlli su PR e
push a main, senza deploy. API GitHub: zero webhook del repository e zero
environments. Il push del solo branch documentale non avvia il workflow di
push a main; un'eventuale PR avvia i normali gate, che restano obbligatori.

La memoria `.agents/memory/api-test-harness.md` è superata dove suggerisce il DB
reale. Il riferimento attuale è `scripts/quality-gates-run.mjs` con il piano e
il workflow: PostgreSQL temporanei in tmpfs, identità attestata dopo creazione,
rete dedicata, porte localhost e lock comune
`/private/tmp/magazzino-m63-test-ports.lock`. API e browser vanno eseguiti in
sequenza sullo stesso host; nessun override manuale delle attestazioni.

| Controllo preparatorio                                                                                           | Esito del prompt 00                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Piano e confini                                                                                                  | Letti; attivo soltanto prompt 00                                                                                                                                                                                |
| Git remoto e baseline                                                                                            | PASS, SHA coincidenti                                                                                                                                                                                           |
| Contenuti API/WEB 8082 e produzione                                                                              | PASS sui contenuti e artefatti; limiti di provenienza delle immagini sopra                                                                                                                                      |
| Ledger 8082 in lettura                                                                                           | PASS, 58/58                                                                                                                                                                                                     |
| Runner e guardie: `node --test scripts/quality-gates-plan.test.mjs scripts/m63-test-guards.test.mjs` con Node 24 | 29 PASS, 0 FAIL, 0 SKIP                                                                                                                                                                                         |
| `pnpm install --frozen-lockfile` con Node 24                                                                     | PASS, lockfile invariato. Primo tentativo sandbox interrotto per DNS negato; ripresa riuscita con rete autorizzata. Warning preesistente: build script core-js non autorizzato; nessuna modifica all'allowlist. |
| `pnpm run typecheck` con Node 24                                                                                 | PASS su librerie, API, frontend, mockup e scripts                                                                                                                                                               |
| Suite API completa tramite `node scripts/quality-gates-run.mjs api` con Node 24                                  | 162 file, 8 gruppi: 2.016 PASS, 0 FAIL, 4 SKIP su acceptance di originali esterni. Il runner esegue `vitest run`, lo stesso comando dello script `test` API, su DB temporanei attestati.                        |
| Runner migration PostgreSQL, incluso nel runner API                                                              | 24 PASS, 0 FAIL, 0 SKIP; bootstrap fresh e replay PASS; ledger temporanei 58/58, zero discrepanze                                                                                                               |
| Cleanup automatico runner                                                                                        | Tutti i 9 PostgreSQL temporanei e la rete dedicata rimossi; nessun volume creato                                                                                                                                |
| Formattazione, diff e preservazione documenti locali                                                             | Prettier e controlli Git; quattro documenti preesistenti invariati per SHA-256                                                                                                                                  |
| Checkpoint documentale                                                                                           | Commit di introduzione di questo registro sul solo branch dedicato; SHA e verifica della pubblicazione riportate nella consegna in chat                                                                         |

Evidenze della nuova esecuzione: `/private/tmp/magazzino-bug00-api-YnGPnR`,
51 passaggi riusciti, nessuno fallito. I quattro skip sono in `agea-import`,
`agea-sifead-parser`, `fse-import-parser-m3b`, `fse-import-practice-m3b`:
le rispettive acceptance sugli originali esterni restano NON ESEGUITE.
Nessuno skip o requisito è stato modificato. Frontend, browser, build e budget
non rieseguiti in questa preparazione documentale; non sono dichiarati PASS.
Il codice verificato è quello della SHA base; il checkpoint aggiunge soltanto
questo registro. Nessun risultato storico è conteggiato come nuova esecuzione.

Queste verifiche preparatorie non chiudono BUG, non attestano UAT e non avviano
una consegna funzionale. Nessuna modifica a codice, schema, OpenAPI o generated.
Le evidenze operative temporanee rimangono fuori repository.

## Autorizzazioni e prossima attività

Autorizzato da questo incarico: preparazione, registro, checkpoint documentale
e pubblicazione del solo branch dedicato dopo verifica del workflow.
**Merge su main e rilascio in produzione: NON AUTORIZZATI.**
Nessun deploy 8082/Hetzner o modifica al database persistente in prompt 00.
La futura certificazione finale richiede il candidato 08, tutte le decisioni e
UAT risolte, i gate pertinenti e un distinto mandato `##merge` di Floriano.

## Consegna 01 — BUG 01 Utenti

SHA iniziale `cf0704b9871da5cf081c3bce3ce82e0506d3c5c1`. Il prompt 02 inviato in precedenza è stato interrotto senza interventi; resta in attesa.

Il 19 ottobre Floriano ha attivato il prompt 01 e chiesto espressamente di ricompilare sempre la 8082 per la propria prova, dando poi OK prima della fase successiva. Questa istruzione autorizza la preparazione della 8082 dopo i controlli in questo incarico, senza attendere un ulteriore messaggio `##test`. Restano esclusi main e produzione Hetzner.

Interventi: azioni nella prima colonna fissa con etichetta accessibile; modifica e riattivazione/disattivazione; Elimina con D01; password temporanea separata dal link email; cambio obbligatorio, revoca atomica di sessioni/token e versione delle credenziali nelle sessioni. Il reset e la rimozione rifiutano un profilo cambiato durante l’operazione; il cambio password rifiuta sessioni superate da un reset concorrente.

OpenAPI estesa in modo additivo: `POST /utenti/{id}/temporary-password`, parametro opzionale `removeIfUnused` sul DELETE ed evento `USER_DELETED`. Il DELETE senza parametro conserva la disattivazione esistente. Client rigenerati con il comando ufficiale; export esplicito nel barrel Zod per la collisione Orval tra validatore del path e tipo query. Nessuna migration: schema e 58 update storici invariati.

D01 applicata senza eccezioni implicite: ultimo accesso, sessioni, token e ogni FK, anche di audit o SET NULL/CASCADE, impediscono la cancellazione fisica. I record collegati, compresi i dimostrativi, vengono disattivati e rimangono riattivabili. La sola creazione via API produce un audit e costituisce già una dipendenza da conservare.

Le sessioni precedenti prive della versione delle credenziali richiedono un nuovo login dopo l’aggiornamento. I segreti non sono restituiti o registrati in audit; anche gli errori dei nuovi writer delle credenziali non espongono i parametri SQL.

Candidato locale congelato per i controlli finali API/UI e build API/WEB con budget 400 KiB invariato. Aggiornamento 8082 e pubblicazione solo dopo esito positivo; backup e metadati operativi resteranno fuori repository. La UAT non è ancora eseguita.

Controlli sul backend congelato `50d55b2426f590d1afc3a91c44b8f476bc663259`: gruppi API core/general, 148 file, **1.564 PASS, 0 FAIL, 4 SKIP** sugli originali esterni; **24 test migration PASS**, ledger effimeri 58/58 e cleanup completato. Evidenze nuove `/private/tmp/magazzino-bug01-certified-api-AqF5ne`; gli 11 casi BUG 01 sono inclusi, senza conteggiare i giri precedenti.

Installazione con lockfile invariato, codegen ufficiale e typecheck Node 24 PASS. Il primo giro UI aveva rilevato una conferma Elimina etichettata come disattivazione: corretta e verificata. Il primo build API/WEB era riuscito, ma il budget WEB era **KO, 400,5/400 KiB gzip**: quel candidato non è stato installato. Le sole nuove traduzioni delle azioni Utenti sono ora caricate con la pagina, già lazy, tramite `utentiActions.ts`; caricamento delle altre pagine e soglia invariati. Typecheck e frontend completa dopo questo adeguamento: **730 PASS, 0 FAIL, 0 SKIP**. Il backend, i contratti e gli input delle sue suite restano invariati rispetto a `50d55b2`, quindi le evidenze API sopra restano applicabili. Nuovo build e budget conclusi con esito positivo; dettagli della 8082 sotto.

File del BUG 01 (sorgenti, test, contratto, generati ufficiali e registro):

- `artifacts/api-server/src/lib/removeUser.ts`
- `artifacts/api-server/src/lib/systemLog.ts`
- `artifacts/api-server/src/lib/userAccess.ts`
- `artifacts/api-server/src/middlewares/auth.ts`
- `artifacts/api-server/src/routes/auth.ts`
- `artifacts/api-server/src/routes/utenti.ts`
- `artifacts/api-server/tests/change-password.test.ts`
- `artifacts/api-server/tests/fase5-super-admin.test.ts`
- `artifacts/api-server/tests/helpers/session-stub.ts`
- `artifacts/api-server/tests/password-recovery.test.ts`
- `artifacts/api-server/tests/scope-helpers.ts`
- `artifacts/api-server/tests/utenti-bug01.test.ts`
- `artifacts/api-server/tests/utenti-matricola.test.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/utentiActions.ts`
- `artifacts/magazzino-solidale/src/pages/utenti.test.tsx`
- `artifacts/magazzino-solidale/src/pages/utenti.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/deleteUtenteParams.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/systemLogEventType.ts`
- `lib/api-zod/src/generated/types/temporaryPasswordInput.ts`
- `lib/api-zod/src/index.ts`

### Installazione 8082 verificata

Candidato pubblicato sul branch: `9d5852991a6aa81426ab7688998175303f4ab8e8`. Build Docker API e WEB PASS dai Dockerfile correnti, su snapshot Git del candidato. Budget WEB: **399,2/400 KiB gzip**, soglia invariata. Codegen ripetuto sul candidato con `git diff --exit-code` PASS; nessuna variazione generata residua. Il successivo commit del registro è soltanto documentale e non cambia il codice installato.

- magazzino-api: `magazzino-bugfix-uat-api:sha-9d5852991a6a`, image ID `sha256:dbdd8cbc98010dc0a01151b8944573839f3e92179f80caf09aeae00a58fee566`, label revisione `9d5852991a6aa81426ab7688998175303f4ab8e8`.
- magazzino-web: `magazzino-bugfix-uat-web:sha-9d5852991a6a`, image ID `sha256:bef4edcb82132c675ae9a4bec20e5f7ef9886499287cf3dbd105f25857848f31`, label revisione `9d5852991a6aa81426ab7688998175303f4ab8e8`.

Ricreati soltanto API/WEB con `--no-deps --no-build`. Configurazione Compose confrontata prima/dopo: differenze limitate a immagini, label revisione e `DB_MIGRATION_SOURCE_VERSION`; aggiunto un override dopo i 13 file precedenti. PostgreSQL mantiene container `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797` e avvio del 6 ottobre. Conservati rete, porte e volumi `magazzino-solidale_magazzino_pgdata` e `magazzino-solidale_magazzino_uploads`.

Backup privato: `/Users/florianocaprio/Backups/Magazzino-Solidale/BUG01-9d5852991a6a-2026-10-19T08-28-33-604Z`. Dump e archivio uploads creati con permessi privati, SHA-256 registrati nei metadati locali; indice dump e archivio tar leggibili. **Restore effettivo non eseguito in questo incarico**: nessuna migration nuova o aggiornamento di schema da provare. Nella stessa directory sono conservati `preflight.json`, `release-images.json`, `rollback-images.json`, `release-result.json`; nessuno di questi file privati è committato. Le vecchie immagini restano disponibili.

Entry point canonico eseguito: ledger initialized=true, 58/58, zero pending, mismatch, file mancanti o fuori ordine. Smoke di lettura: `/`, `/config.js`, `/api/healthz`, `/api/readyz` HTTP 200; `/api/utenti` senza sessione HTTP 401. API e PostgreSQL healthy; WEB running senza healthcheck Docker definito. Nessun login o test mutativo automatico sulla 8082. Nessun accesso o deploy Hetzner in questo prompt; main invariato.

### Prova UAT di Floriano

1. Ricaricare `http://127.0.0.1:8082/` e rifare login. Aprire Utenti su desktop/tablet, anche con nomi/email lunghi: Azioni è nella prima colonna e deve restare raggiungibile.
2. Su un account di prova con ruolo valido, aprire Modifica, cambiare ruolo/stato nel proprio ambito e provare disattivazione/riattivazione. Il proprio account e gli amministratori protetti devono restare tutelati.
3. Tenere aperta la sessione dell’account di prova in una finestra privata; dall’amministratore assegnare una password temporanea. La sessione precedente deve perdere accesso. Accedere con la temporanea: cambio obbligatorio prima delle funzioni protette, poi accesso consentito secondo ruolo. La temporanea precedente non deve più funzionare dopo il cambio.
4. Distinguere Assegna password temporanea da Invia link reset password. Provare Elimina su un record di prova collegato: lo storico deve restare e l’account risultare disattivato; solo record mai usati e privi di qualsiasi dipendenza sono cancellabili fisicamente.

**UAT DA ESEGUIRE: BUG 01 non chiuso.** Attendere l’OK/KO reale di Floriano prima del prompt 02.


## Chiarimento UAT 01 — accesso ai servizi per ruolo e Area

Il 19 ottobre Floriano ha confermato positivamente la prova Utenti e chiarito:
«Un operatore deve poter operare su tutte le mense dell'area, o i centri dell'area se abilitato, o empori dell'area se abilitato dal profilo».
Questa istruzione sostituisce il precedente requisito di assegnazione individuale
Utente–Mensa. Il prompt 02 resta in attesa dell'OK dopo la nuova prova su 8082.

Intervento incrementale sullo stesso branch di campagna, da
`d015622c29cfad2bd84869cb430564a794b27e9f`:

- Eliminato il pannello di assegnazione Mensa dalla modifica Utenti e il relativo
  componente. Il ruolo resta modificabile, con le protezioni già presenti.
- Le autorizzazioni Mensa correnti sono derivate dal ruolo e da tutte le mense
  dell'Area; valgono anche per richieste, rifornimenti, report e preparazione PDF.
  Le vecchie assegnazioni attive/revocate non influenzano più gli accessi.
- Nei servizi dei Centri, nelle anagrafiche e nelle abilitazioni Emporio, il Centro
  anagrafico dell'operatore non limita più l'accesso agli altri Centri della stessa
  Area. Interfaccia e report usano lo stesso confine. Conservati i permessi,
  la validità territoriale e i controlli separati UDS e logistici.
- Emporio operativo già delimitato per Area; adeguati anche il riepilogo della
  directory Sociale e la gestione dell'abilitazione del beneficiario.
- Nessuna migration o cancellazione dati: le tabelle di assegnazione e gli audit
  restano conservati. Non cambiano le abilitazioni **dei beneficiari** ai servizi.
- Impatto OpenAPI: GET delle assegnazioni marcato deprecato e mantenuto per lo
  storico; PUT di assegnazione/revoca deprecato e dismesso con HTTP 410, senza
  scritture. Client/Zod aggiornati esclusivamente con il codegen ufficiale.

Verifiche e nuova installazione 8082: in corso; nessun esito UAT presunto sulla
correzione. Gli eventuali errori dei primi giri di test sono conservati nelle
evidenze private; i risultati finali saranno registrati separatamente.

### File coinvolti nel chiarimento

- `artifacts/api-server/src/lib/beneficiarioPolicy.ts`
- `artifacts/api-server/src/lib/interventiSocialAccess.ts`
- `artifacts/api-server/src/lib/mensaScope.ts`
- `artifacts/api-server/src/lib/reporting/filterOptions.ts`
- `artifacts/api-server/src/lib/reporting/filters.ts`
- `artifacts/api-server/src/lib/reporting/prepare.ts`
- `artifacts/api-server/src/lib/serviceScope.ts`
- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/src/routes/beneficiari.ts`
- `artifacts/api-server/src/routes/emporio-servizio.ts`
- `artifacts/api-server/src/routes/interventi.ts`
- `artifacts/api-server/src/routes/mensa.ts`
- `artifacts/api-server/src/routes/report-integrato.ts`
- `artifacts/api-server/src/routes/richieste-magazzino.ts`
- `artifacts/api-server/src/routes/utenti-mense.ts`
- `artifacts/api-server/tests/beneficiari-fse-api.test.ts`
- `artifacts/api-server/tests/emporio-uat-f1.test.ts`
- `artifacts/api-server/tests/helpers/m67a-mensa-fixture.ts`
- `artifacts/api-server/tests/interventi-operativita-sociale.test.ts`
- `artifacts/api-server/tests/interventi-viste-sociali.test.ts`
- `artifacts/api-server/tests/interventi-workflow.test.ts`
- `artifacts/api-server/tests/m67a-mensa-access.test.ts`
- `artifacts/api-server/tests/mensa-magazzino-correttivo.test.ts`
- `artifacts/api-server/tests/mensa.test.ts`
- `artifacts/api-server/tests/reporting-m66-security.test.ts`
- `artifacts/api-server/tests/scoping-beneficiario.test.ts`
- `artifacts/api-server/tests/scoping-direct.test.ts`
- `artifacts/magazzino-solidale/src/components/beneficiario-emporio-card.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-emporio-card.tsx`
- `artifacts/magazzino-solidale/src/components/reporting/report-filters.tsx`
- `artifacts/magazzino-solidale/src/components/utente-mense.tsx`
- `artifacts/magazzino-solidale/src/lib/auth-access.test.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/mensa.ts`
- `artifacts/magazzino-solidale/src/lib/service-scope.ts`
- `artifacts/magazzino-solidale/src/pages/beneficiari.tsx`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `artifacts/magazzino-solidale/src/pages/interventi.tsx`
- `artifacts/magazzino-solidale/src/pages/reporting-dashboard.tsx`
- `artifacts/magazzino-solidale/src/pages/utenti.test.tsx`
- `artifacts/magazzino-solidale/src/pages/utenti.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/richiestaMagazzinoCreate.ts`
- `lib/api-zod/src/generated/types/setUtenteMensa410.ts`

I file generated derivano dal comando ufficiale `pnpm --filter @workspace/api-spec run codegen`. Il componente `utente-mense.tsx` è rimosso. I quattro documenti locali preesistenti sono esclusi e verificati per SHA-256.


### Verifica conclusiva e 8082 aggiornata dopo il chiarimento

Candidato codice `e897fd5389c5848e7e1eab9d24f4dc77d9743d5d` (commit principale
`bd4b758db83783a47d1e28f69340695af498aa1a`, seguito dalla separazione del nuovo
controllo dei servizi rispetto al flusso UDS). Sono state verificate anche le
schede FSE e l'import/export per i Centri della propria Area, senza estendere
lo scoping dei moduli logistici.

| Controllo | Esito effettivo |
| --- | --- |
| Installazione Node 24, `CI=true pnpm install --frozen-lockfile` | PASS; lockfile invariato. Ripresa con rete autorizzata dopo il blocco DNS sandbox. Warning core-js preesistente, allowlist invariata. |
| `pnpm run typecheck` | PASS su tutte le librerie e applicazioni dopo l'ultima correzione. |
| `pnpm --filter @workspace/api-spec run codegen` | PASS; rigenerazione ripetuta e nessuna differenza rispetto al candidato nei generated. |
| API, 6 gruppi pertinenti | **2.009 PASS, 0 FAIL, 4 SKIP**, 161 file. Nessun test saltato o requisito indebolito per ottenere il verde. |
| Runner migrazioni PostgreSQL | 24 PASS; bootstrap fresh/replay e ledger temporanei 58/58 senza discrepanze. |
| `pnpm --filter @workspace/magazzino-solidale run test` | **736 PASS**, 115 file, zero FAIL/SKIP. |
| Build Docker API e WEB dal candidato | PASS; entry WEB **399,1/400 KiB gzip**, budget invariato. |
| Diff, generated e documenti locali | PASS; quattro documenti preesistenti invariati per SHA-256, esclusi dai commit. |

Comando API canonico: `node scripts/quality-gates-run.mjs api core general` sul
candidato e897fd5. Gli altri quattro gruppi erano già PASS e i relativi percorsi
autorizzativi non sono cambiati nella correzione successiva: questa aggiunge un
filtro separato per le anagrafiche dei servizi e preserva il collegamento UDS.
Le nuove prove coprono il CRUD su altro Centro della stessa Area, il rifiuto
nel payload di un Centro esterno, gli ID legacy senza Area e le schede FSE,
oltre a tutte le Mense senza assegnazione e alle revoche concorrenti di ruolo/Area.

Evidenze per gruppo (solo risultati conclusivi, senza sommare le riesecuzioni):
- `api-core`: 76 PASS, 0 SKIP, 11 file; `/private/tmp/bug01-area-certified-api-e897fd5`.
- `api-general`: 1491 PASS, 4 SKIP, 137 file; `/private/tmp/bug01-area-certified-api-e897fd5`.
- `api-reporting`: 83 PASS, 0 SKIP, 6 file; `/private/tmp/bug01-area-final-api-reporting`.
- `api-interventi`: 21 PASS, 0 SKIP, 2 file; `/private/tmp/bug01-area-final-api-interventi`.
- `api-mensa`: 108 PASS, 0 SKIP, 1 file; `/private/tmp/bug01-area-final-api-mensa`.
- `api-emporio`: 230 PASS, 0 SKIP, 4 file; `/private/tmp/bug01-area-final-api-emporio`.

I quattro SKIP sono le acceptance sugli originali esterni già non disponibili
nel prompt 00 (agea-import, agea-sifead-parser, fse-import-parser-m3b,
fse-import-practice-m3b); nessun nuovo skip. Maps e snapshot FSE R2 non sono
stati rieseguiti: non sono coinvolti nel cambiamento. Suite browser non eseguita;
la nuova prova UAT di Floriano rimane da fare.

La build WEB nativa macOS è stata tentata ma non disponibile per il binario
opzionale mancante `lightningcss.darwin-arm64.node`. La build Docker effettivamente
installata passa e non richiede interventi manuali per la 8082. Per una futura
build nativa, ripristinare la dipendenza opzionale e usare Node 24 con
`PORT=8082 BASE_PATH=/ pnpm --filter @workspace/magazzino-solidale run build`.

Installate soltanto API e WEB su `http://127.0.0.1:8082/`, revisione `e897fd5389c5848e7e1eab9d24f4dc77d9743d5d`:

- `/magazzino-api`: `magazzino-bugfix-uat-api:sha-e897fd5389c5`, image ID `sha256:809833c7128d06d545cab80f1c0471ed343da22b388d43a46a21fefed3b7b156`, stato `healthy`.
- `/magazzino-web`: `magazzino-bugfix-uat-web:sha-e897fd5389c5`, image ID `sha256:8d9ed0f7791140223f9213c0665f7a54990cb69a2ae235df3907817826358f9e`, stato `not-defined`.

PostgreSQL conserva container `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797` e avvio del
6 ottobre. Nessuna migration nuova; ledger initialized=true, **58/58**, nessun
pending, mismatch o file fuori ordine. Configurazione Compose confrontata:
solo immagini, label revisione e DB_MIGRATION_SOURCE_VERSION differiscono.
Conservati porte, rete, volumi e dati. `/`, `/config.js`, `/api/healthz` e
`/api/readyz` restituiscono 200; `/api/utenti` senza sessione restituisce 401.
Nessun login o test mutativo automatico sulla 8082.

Backup privato precedente all'installazione: `/Users/florianocaprio/Backups/Magazzino-Solidale/BUG01-AREA-e897fd5389c5-2026-10-19T12-31-21-694Z`.
Dump e uploads verificati per indice e SHA-256, con permessi privati; restore
non eseguito, non essendoci variazioni di schema. Ricevuta e rollback immagini
restano nella stessa directory privata, fuori Git. Nessun accesso Hetzner o
modifica di main in questo chiarimento.

Prova richiesta: ricaricare la 8082; in modifica Utenti verificare che il ruolo
sia selezionabile e che il pannello di assegnazione Mensa sia assente. Con un
operatore abilitato e Area assegnata, verificare tutte le Mense/Centri/Empori
della propria Area anche se il Centro anagrafico è diverso. Dopo un cambio
ruolo, ricaricare la sessione dell'operatore e controllare le funzioni abilitate.
Ruolo e Area rimangono necessari; le abilitazioni dei beneficiari e le regole
UDS/logistiche restano distinte. I riferimenti territoriali incoerenti/inattivi
continuano a essere respinti.

**Correzione pronta su 8082; UAT di Floriano ancora attesa. Non avviare prompt 02
prima del suo OK.**


## Chiarimento successivo: account autorizzato soltanto per Area

Richiesta di Floriano del 19 ottobre 2026: «Un utente è abilitato per AREA non
per centro di ascolto», con rimozione di Centro di Ascolto e Zona UDS. Questa
istruzione sostituisce la precedente distinzione che conservava i vincoli
Centro/Zona per UDS e logistica: l’account usa ora **ruolo, permessi e Area**
in tutti i moduli. Prompt 02 resta in attesa dell’OK UAT.

Intervento incrementale:

- Rimossi Centro e Zona da creazione, modifica e tabella Utenti; rimangono
  Ruolo e Area Operativa. Gli operatori senza Area sono indicati come
  «Area non assegnata», senza suggerire un’autorizzazione globale.
- La sessione e gli attori riletti nei comandi restituiscono Centro/Zona null,
  anche per account con riferimenti legacy inattivi o differenti. Le restrizioni
  fra Aree, i ruoli correnti, i moduli abilitati e le revoche restano applicati.
- Le API di creazione ignorano i parametri legacy Centro/Zona. In modifica non
  si assegnano questi campi; un cambio di Area li azzera sul singolo account
  modificato, evitando conflitti con la FK composta Zona/Area. Nessuna modifica
  massiva ai dati personali esistenti.
- Gli operatori senza Area non accedono alle funzioni operative. Identità e
  cambio password restano disponibili; un vecchio vincolo senza Area non viene
  trasformato automaticamente in privilegio globale. L’accesso amministrativo
  globale esplicito rimane previsto.
- I Centri/Zona delle strutture, dei beneficiari e delle attività rimangono
  dati operativi utilizzabili nei filtri. Non sono più assegnazioni dell’account.

Impatto API: proprietà legacy deprecate in OpenAPI, conservate nullable per
compatibilità; in output valgono null e in input sono ignorate. Generated
rigenerati con il comando ufficiale. **Nessuna modifica schema o migration**:
le colonne legacy restano presenti; lo storico operativo è conservato.

I test che imponevano restrizioni per Centro/Zona all’account sono aggiornati
alla regola Area; restano prove negative per altre Aree, privilegi insufficienti,
account disattivati, revoca Area e concorrenza. Le fixture di sessioni valide
assegnano esplicitamente l’Area; le prove di scope non configurato continuano
a verificarne il diniego.

Rilievo aggregato in sola lettura sulla 8082: due account attivi senza Area
richiedono configurazione da parte dell’amministratore prima dell’uso operativo.
Nessuna Area scelta o assegnata automaticamente.

File modificati in questo chiarimento (oltre al presente registro):

- `artifacts/api-server/src/lib/currentCommandActor.ts`
- `artifacts/api-server/src/lib/m5bRequestAccess.ts`
- `artifacts/api-server/src/lib/mensaScope.ts`
- `artifacts/api-server/src/lib/userAccess.ts`
- `artifacts/api-server/src/middlewares/auth.ts`
- `artifacts/api-server/src/routes/interventi.ts`
- `artifacts/api-server/src/routes/utenti.ts`
- `artifacts/api-server/tests/audit-admin-hardening.test.ts`
- `artifacts/api-server/tests/beneficiari-uds.test.ts`
- `artifacts/api-server/tests/bolle-prenotazioni.test.ts`
- `artifacts/api-server/tests/credito-solidale.test.ts`
- `artifacts/api-server/tests/emporio-security.test.ts`
- `artifacts/api-server/tests/fse-api-2-0c.test.ts`
- `artifacts/api-server/tests/m5b-r2-autorizzazioni.test.ts`
- `artifacts/api-server/tests/m5b-r3-guardie-post-preparazione.test.ts`
- `artifacts/api-server/tests/m5c2a-handoff-bolla-pronta.test.ts`
- `artifacts/api-server/tests/m5c2a-r1-request-cancel.test.ts`
- `artifacts/api-server/tests/m63-formal-certification.test.ts`
- `artifacts/api-server/tests/m63-interventi.test.ts`
- `artifacts/api-server/tests/m67a-authorization.test.ts`
- `artifacts/api-server/tests/reporting-m66-security.test.ts`
- `artifacts/api-server/tests/richieste-magazzino-m5a-session.test.ts`
- `artifacts/api-server/tests/richieste-magazzino-m5a.test.ts`
- `artifacts/api-server/tests/scope-helpers.ts`
- `artifacts/api-server/tests/scoping-beneficiario.test.ts`
- `artifacts/api-server/tests/scoping-direct.test.ts`
- `artifacts/api-server/tests/transport-return-m4b2.test.ts`
- `artifacts/api-server/tests/utenti-bug01.test.ts`
- `artifacts/api-server/tests/utenti-matricola.test.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/utentiActions.ts`
- `artifacts/magazzino-solidale/src/pages/utenti.test.tsx`
- `artifacts/magazzino-solidale/src/pages/utenti.tsx`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/authUser.ts`
- `lib/api-zod/src/generated/types/utente.ts`
- `lib/api-zod/src/generated/types/utenteInput.ts`
- `lib/api-zod/src/generated/types/utenteUpdate.ts`

### Verifica conclusiva e ricevuta 8082 — account per Area

Candidato codice `508dacfb6f0a9d428239e84de0a697af05b971c2`, branch
`codex/bugfix-uat-ottobre-2026`. Nessuna modifica a main o alla produzione.

| Controllo | Esito effettivo |
| --- | --- |
| `pnpm install --frozen-lockfile`, Node 24 | PASS; lockfile invariato. |
| `pnpm run typecheck` | PASS, ripetuto al termine della rigenerazione finale. |
| `pnpm --filter @workspace/api-spec run codegen` | PASS; esecuzione finale senza differenze nei generated rispetto al candidato. |
| API, otto gruppi canonici isolati | **2.032 PASS, 0 FAIL, 4 SKIP**, 163 file. |
| Runner PostgreSQL | 24 PASS; bootstrap fresh/replay e ledger 58/58 senza discrepanze. |
| `pnpm --filter @workspace/magazzino-solidale run test` | **736 PASS**, 115 file, zero FAIL/SKIP. |
| Docker API e WEB dal candidato | PASS; entry WEB **399,1/400 KiB gzip**, budget invariato. |
| Diff, generated e documenti locali | PASS; quattro documenti preesistenti invariati per SHA-256 ed esclusi dai commit. |

Comando canonico, eseguito per ciascun gruppo con il relativo
`CI_RESULTS_DIR` privato: `node scripts/quality-gates-run.mjs api <gruppo>`.
I gruppi core/interventi/mensa/fse/maps sono PASS nella seconda esecuzione;
reporting/emporio/general sono stati rieseguiti dopo le ultime correzioni alle
fixture e agli oracoli del nuovo perimetro Area. Non si sommano le riesecuzioni.
Dopo la seconda esecuzione non sono cambiate le regole autorizzative del codice;
le ulteriori modifiche ai sorgenti API erano soltanto di formattazione.

Evidenze conclusive:

- `core`: 76 PASS, 0 SKIP, 11 file; `/private/tmp/utenti-area-only-r2-api-core`.
- `reporting`: 83 PASS, 0 SKIP, 6 file; `/private/tmp/utenti-area-only-r3-api-reporting`.
- `interventi`: 21 PASS, 0 SKIP, 2 file; `/private/tmp/utenti-area-only-r2-api-interventi`.
- `mensa`: 108 PASS, 0 SKIP, 1 file; `/private/tmp/utenti-area-only-r2-api-mensa`.
- `emporio`: 230 PASS, 0 SKIP, 4 file; `/private/tmp/utenti-area-only-r3-api-emporio`.
- `general`: 1494 PASS, 4 SKIP, 137 file; `/private/tmp/utenti-area-only-r3-api-general`.
- `fse`: 2 PASS, 0 SKIP, 1 file; `/private/tmp/utenti-area-only-r2-api-fse`.
- `maps`: 18 PASS, 0 SKIP, 1 file; `/private/tmp/utenti-area-only-r2-api-maps`.

I quattro SKIP sono le acceptance sugli originali esterni già non disponibili
(agea-import, agea-sifead-parser, fse-import-parser-m3b, fse-import-practice-m3b).
Nessun nuovo skip. Browser UAT non automatizzata: la prova di Floriano resta
da eseguire. I test API usano esclusivamente database Docker temporanei
verificati dal runner; nessun test mutativo sul database personale della 8082.

Installati soltanto API e WEB su `http://127.0.0.1:8082/`:

- `/magazzino-api`: `magazzino-bugfix-uat-api:sha-508dacfb6f0a`, image ID `sha256:ca20041515eed85615570c0389d679cf0cde99afffcbc28e308ec4cf1c3591ce`, revisione `508dacfb6f0a9d428239e84de0a697af05b971c2`, health `healthy`.
- `/magazzino-web`: `magazzino-bugfix-uat-web:sha-508dacfb6f0a`, image ID `sha256:69859192e00a1f3f4d7e19c8f2db8ddc23cf8e35a06ffa17ea1b9e9db69c2485`, revisione `508dacfb6f0a9d428239e84de0a697af05b971c2`, health `not-defined`.

PostgreSQL conserva container `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797` e avvio
`2026-10-06T14:06:51.181962875Z`. Ledger **58/58**, zero pending/checksum
difformi/file mancanti/fuori ordine. Il confronto Compose consente soltanto
immagini, label revisione e DB_MIGRATION_SOURCE_VERSION; porte, rete, volumi e
configurazione applicativa restano invariati. `/`, `/config.js`, `/api/healthz`,
`/api/readyz` restituiscono 200; `/api/utenti` senza sessione restituisce 401.

Backup privato precedente al recreate: `/Users/florianocaprio/Backups/Magazzino-Solidale/UTENTI-AREA-508dacfb6f0a-2026-10-19T13-10-14-868Z`.
Dump e uploads verificati tramite indice archivio e SHA-256, con permessi
privati; restore non eseguito. Ricevuta tecnica e rollback immagini sono nella
stessa directory privata, fuori Git. Nessun file `.env`, credenziale, log o
screenshot incluso nei commit.

Prova UAT: ricaricare Utenti; in creazione/modifica deve comparire soltanto
Ruolo e Area come assegnazioni di accesso, e la tabella non deve mostrare
Centro/Zona. Un operatore abilitato deve operare sulle strutture della propria
Area, compresi Centri/Zone diversi da quelli eventualmente presenti nei vecchi
dati dell’account, con diniego sulle altre Aree. I due account attivi senza
Area richiedono ancora configurazione amministrativa; non è stata assegnata
un’Area automaticamente.

**8082 aggiornata e pronta per la nuova UAT. Prompt 02 non avviato: si attende
l’OK di Floriano.**
