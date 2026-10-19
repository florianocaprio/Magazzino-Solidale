# Campagna dei 20 BUG di ottobre 2026

19 ottobre 2026, Europe/Rome. **Prompt 00: preparazione della campagna.**
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

Tutti i BUG sono **DA SVILUPPARE**. Le UAT sono **DA ESEGUIRE** e non derivano
dai test automatici. Il candidato iniziale non è un candidato verificato della
campagna. Il punto D03 è un raccordo da verificare nel blocco D.

| BUG | Blocco | Prompt | Stato         | Requisiti sospesi                                              | Commit | Automatico   | UAT         | Ultimo candidato verificato |
| --- | ------ | ------ | ------------- | -------------------------------------------------------------- | ------ | ------------ | ----------- | --------------------------- |
| 01  | A      | 01     | DA SVILUPPARE | Nessuno; D01 approvata                                         | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 02  | B      | 02     | DA SVILUPPARE | Nessuno; D01 approvata                                         | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 03  | B      | 02     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 04  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 05  | C      | 04     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 06  | C      | 04     | DA SVILUPPARE | Nessuno; requisito sostitutivo Area/Centro prima della ricerca | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 07  | C      | 04     | DA SVILUPPARE | Nessuno; D02 approvata                                         | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 08  | C      | 04     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 09  | C      | 04     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 10  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 11  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 12  | D      | 05     | DA SVILUPPARE | Raccordo D03 con le attuali pratiche Aperte                    | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 13  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 14  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 15  | B      | 02     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 16  | D      | 05     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 17  | C      | 03, 04 | DA SVILUPPARE | Nessuno; D04 approvata; UAT dopo 04                            | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 18  | E      | 06, 07 | DA SVILUPPARE | Analisi tecnica del modello nel 06; UAT dopo 07                | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 19  | E      | 07     | DA SVILUPPARE | Nessuno                                                        | —      | NON ESEGUITO | DA ESEGUIRE | —                           |
| 20  | F      | 08     | DA SVILUPPARE | Nessuno; conservare UX20-01–14                                 | —      | NON ESEGUITO | DA ESEGUIRE | —                           |

## Otto consegne

Ogni consegna segue il relativo sviluppo e il distinto incarico `##test`.
Il prompt 00 non costituisce una nona consegna. I checkpoint 03 e 06 non
chiudono BUG 17 e BUG 18. Per le consegne funzionali serve l'OK UAT esplicito di
Floriano prima di avanzare; nessun OK precedente è trasferito a questa campagna.

| Consegna | Blocco e BUG                  | Tipo            | SHA | Controlli e risultato reale | Versione 8082                 | Esito                        |
| -------- | ----------------------------- | --------------- | --- | --------------------------- | ----------------------------- | ---------------------------- |
| 01       | A: 01                         | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |
| 02       | B: 02, 03, 15                 | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |
| 03       | C: 17, prima parte            | Tecnica isolata | —   | NON ESEGUITI                | Nessun aggiornamento previsto | UAT NON PREVISTA; BUG aperto |
| 04       | C: 05–09 e regressione 17     | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |
| 05       | D: 04, 10–14, 16              | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |
| 06       | E: 18, modello e integrazioni | Tecnica isolata | —   | NON ESEGUITI                | Nessun aggiornamento previsto | UAT NON PREVISTA; BUG aperto |
| 07       | E: 18 UI, 19                  | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |
| 08       | F: 20 e gate finali           | Funzionale      | —   | NON ESEGUITI                | Non installata                | UAT DA ESEGUIRE              |

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

**PRONTO PER IL PROMPT 01**. Nessun impedimento concreto per il suo avvio;
attendere il distinto incarico di Floriano.
