# Campagna dei 20 BUG di ottobre 2026

20 ottobre 2026, Europe/Rome. **Consegne 01–04 chiuse con OK di Floriano, compreso il correttivo tessera/codici beneficiari `6088327`; consegna 05 (blocco D) e correttivo UAT installati e verificati sulla 8082 (`ad1b190`, riapertura con sole aggiunte); UAT 05 da completare con Floriano.**

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

I BUG dei blocchi A–C, incluso 21 e regressione 17, sono **CHIUSI CON OK UAT DI FLORIANO**. Il 20/10 Floriano conferma che il punto 04 funziona sulla 8082 e autorizza lo sviluppo 05 e la successiva ricompilazione/installazione personale. Le UAT successive restano DA ESEGUIRE.
I test automatici non sostituiscono la UAT personale. D03 mantiene il comportamento delle pratiche Aperte: salvataggi espliciti, errori sul form e protezione dall’abbandono.

| BUG | Blocco | Prompt | Stato                     | Requisiti sospesi                                              | Commit           | Automatico                      | UAT         | Ultimo candidato verificato              |
| --- | ------ | ------ | ------------------------- | -------------------------------------------------------------- | ---------------- | ------------------------------- | ----------- | ---------------------------------------- |
| 01 | A | 01 | CHIUSO; UAT OK | Nessuno; D01 approvata | 7d70906 | PASS; 4 skip esterni dichiarati nel blocco precedente | OK Floriano 19/10 | 7d70906bdc130073a49ebc8760cc1c38fda8cbc6 |
| 02  | B      | 02     | CHIUSO; UAT OK | Nessuno; D01 approvata                                         | 3c882b610be185ef5f62867ac562e8e7b322b08d | PASS mirati; 4 skip esterni | OK Floriano 19/10 | 3c882b610be185ef5f62867ac562e8e7b322b08d |
| 03  | B      | 02     | CHIUSO; UAT OK | Nessuno                                                        | 3c882b610be185ef5f62867ac562e8e7b322b08d | PASS mirati; 4 skip esterni | OK Floriano 19/10 | 3c882b610be185ef5f62867ac562e8e7b322b08d |
| 04  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 05 | C | 04 | CHIUSO; UAT OK | Nessuno; D02 confermata per BUG 07 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 06 | C | 04 | CHIUSO; UAT OK | Nessuno; D02 confermata per BUG 07 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 07 | C | 04 | CHIUSO; UAT OK | Nessuno; D02 confermata per BUG 07 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 08 | C | 04 | CHIUSO; UAT OK | Nessuno; D02 confermata per BUG 07 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 09 | C | 04 | CHIUSO; UAT OK | Nessuno; D02 confermata per BUG 07 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 10  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 11  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 12  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno; precisazione D03 applicata | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 13  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 14  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 15  | B      | 02     | CHIUSO; UAT OK | Nessuno                                                        | 3c882b610be185ef5f62867ac562e8e7b322b08d | PASS mirati; 4 skip esterni | OK Floriano 19/10 | 3c882b610be185ef5f62867ac562e8e7b322b08d |
| 16  | D      | 05     | PRONTO PER UAT; INSTALLATO 8082 | Nessuno | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS mirati; 4 skip esterni | DA ESEGUIRE | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 |
| 17 | C | 03, 04 | CHIUSO; UAT OK | Nessuno; Enti e Fornitori locali/globali verificati | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; skip dichiarati nella ricevuta | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |
| 18  | E      | 06, 07 | DA SVILUPPARE             | Analisi tecnica del modello nel 06; UAT dopo 07                | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 19  | E      | 07     | DA SVILUPPARE             | Nessuno                                                        | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 20  | F      | 08     | DA SVILUPPARE             | Nessuno; conservare UX20-01–14                                 | —                | NON ESEGUITO                    | DA ESEGUIRE | —                                        |
| 21 | C | 04 + addendum 2.2 | CHIUSO; UAT OK | Un solo ID con stati, territorio, tessera e Zona UDS | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS mirati; evidenze sotto | OK Floriano 20/10 | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 |

## Otto consegne

Ogni consegna segue il relativo sviluppo e il distinto incarico `##test`.
Il prompt 00 non costituisce una nona consegna. I checkpoint 03 e 06 non
chiudono BUG 17 e BUG 18. Per le consegne funzionali serve l'OK UAT esplicito di
Floriano prima di avanzare; nessun OK precedente è trasferito a questa campagna.

| Consegna | Blocco e BUG                  | Tipo            | SHA                                      | Controlli e risultato reale                                                   | Versione 8082                 | Esito                                       |
| -------- | ----------------------------- | --------------- | ---------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| 01 | A: 01 | Funzionale | 7d70906bdc130073a49ebc8760cc1c38fda8cbc6 | PASS; ultimi controlli 737 UI e 76 API core | Installata e verificata | CHIUSA; OK UAT Floriano 19/10 |
| 02 | B: 02, 03, 15 | Funzionale | 3c882b610be185ef5f62867ac562e8e7b322b08d | PASS: 1.591 API + 4 skip esterni; 753 UI; 15 browser; build/budget | Installata, ledger 59/59 | CHIUSA; OK UAT Floriano 19/10 |
| 03 | C: 17, prima parte | Tecnica | ef65e5e4b5a2d5251f6ed550c0a6d7b23bff8084 | PASS: 1.521 API + 4 skip; 756 UI; 9 browser + 36 skip di matrice; build/budget | Installata, asset HTTP verificati; ledger 60/60 | CHIUSO; OK Floriano; regressione integrata nel 04 |
| 04 | C: 05–09, 21 e regressione 17 | Funzionale | 6088327aed83cf7e17f627e3c99b3cdf3917c6e2 | PASS; correttivo e ricevuta sotto | Installata; hash HTTP e ledger 61/61 verificati | OK UAT Floriano 20/10 |
| 05       | D: 04, 10–14, 16              | Funzionale      | ad1b1900d95c642adff6f7d25db0f79d4dfa5f40 | PASS; 1.530 API, 782 UI, 2 browser mirati; skip dichiarati | Installata; hash HTTP JS/CSS e ledger 61/61 | UAT DA ESEGUIRE |
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

## Rifinitura UAT: badge Disattivato in rosso tenue

Richiesta esplicita di Floriano: colorare lo stato Disattivato con un’etichetta
rossa tenue coerente con la pagina. Modificata una sola riga di
`artifacts/magazzino-solidale/src/pages/utenti.tsx`: classi
`bg-red-500/10 text-red-700`, mantenendo il badge esistente. Nessun cambiamento
a permessi, dati, API o schema. L’altro file aggiornato è questo registro.

Candidato WEB `2b15ed5f43ec8199628d98d6be42253beea0254e`. Verifiche effettive: installazione frozen lockfile,
`pnpm run typecheck`, **736 test UI PASS** in 115 file, gruppo canonico API
core **76 PASS** in 11 file (zero FAIL/SKIP). Gli altri gruppi API non sono
stati ripetuti per questa modifica esclusivamente grafica. Nessun nuovo test
aggiunto. Build Docker WEB PASS; budget entry **399,1/400 KiB gzip** invariato.
Evidenze private: `/private/tmp/utenti-status-ui.log`,
`/private/tmp/utenti-status-typecheck.log`, `/private/tmp/utenti-status-api-core`.

Aggiornato soltanto WEB sulla **8082**: `magazzino-bugfix-uat-web:sha-2b15ed5f43ec`,
image ID `sha256:758719f0d0d7b56433a63589155da192b10a08b24bbd7d0ad747c8b893029cd8`. API e PostgreSQL conservano
container e data di avvio, verificati contro il preflight; ledger **58/58**
senza discrepanze. HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: 200;
`/api/utenti` senza sessione: 401. Configurazione Compose confrontata: cambia
soltanto immagine/revisione WEB. Ricevuta e rollback privati in
`/Users/florianocaprio/Backups/Magazzino-Solidale/UTENTI-STATUS-WEB-2b15ed5f43ec-2026-10-19T13-17-38-287Z`. Nessun recreate API/DB o nuova migration.

File modificati: `artifacts/magazzino-solidale/src/pages/utenti.tsx` e
`docs/campagna-bug-2026-10.md`. I quattro documenti locali preesistenti restano
esclusi. Prova manuale: ricaricare Utenti sulla 8082 e verificare il badge
Disattivato rosso tenue; UAT visiva di Floriano ancora attesa. Prompt 02 non
avviato.

## Rifinitura UAT: mostra/nascondi password iniziale

Su richiesta di Floriano è aggiunta l’icona dell’occhio nel campo Password
iniziale di Nuovo utente. Il controllo segue lo stile già presente nel login:
un clic mostra il testo, il successivo lo nasconde. Il pulsante è di tipo
button, ha etichetta accessibile tradotta, aria-controls e aria-pressed.
Il testo digitato rimane invariato; ogni apertura del form ripristina la
password nascosta. Nessuna modifica al flusso di salvataggio o alle policy
della password.

File modificati:

- `artifacts/magazzino-solidale/src/pages/utenti.tsx`.
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/utentiActions.ts`:
  etichette Mostra/Nascondi nelle sei lingue esistenti, caricate con la pagina.
- `artifacts/magazzino-solidale/src/pages/utenti.test.tsx`:
  prova di mostra/nascondi, valore preservato, nessun submit del pulsante e
  ripristino del campo nascosto e vuoto alla nuova apertura.
- `docs/campagna-bug-2026-10.md`: questo registro.

Verifiche effettive: installazione con frozen lockfile PASS,
`pnpm run typecheck` PASS, **737 test UI PASS** in 115 file e gruppo canonico
API core **76 PASS** in 11 file (zero FAIL/SKIP). Gli altri gruppi API non
sono stati ripetuti per questo intervento sul solo frontend. Nessuna modifica
a schema, OpenAPI, generated o dipendenze. Evidenze private:
`/private/tmp/utenti-password-eye-ui.log`,
`/private/tmp/utenti-password-eye-typecheck.log`,
`/private/tmp/utenti-password-eye-api-core`.

Build Docker WEB PASS, entry **399,1/400 KiB gzip**, budget invariato.
Installato solo WEB sulla **8082**, candidato `7d70906bdc130073a49ebc8760cc1c38fda8cbc6`:
`magazzino-bugfix-uat-web:sha-7d70906bdc13`,
image ID `sha256:b3eeacf8afbe0b969b64024a72ae8d78e311a208b17e6f0ed8e20f1873970677`.
API e PostgreSQL conservano container e data di avvio, verificati contro il
preflight. Ledger **58/58** senza discrepanze. HTTP `/`, `/config.js`,
`/api/healthz`, `/api/readyz`: 200; `/api/utenti` senza sessione: 401.
Configurazione Compose confrontata: cambia soltanto immagine/revisione WEB.
Ricevuta e rollback privati: `/Users/florianocaprio/Backups/Magazzino-Solidale/UTENTI-PASSWORD-EYE-WEB-7d70906bdc13-2026-10-19T13-25-42-063Z`.

I quattro documenti locali preesistenti sono invariati per SHA-256 ed esclusi
dai commit; nessun log, screenshot, credenziale o file locale aggiunto a Git.
Prova manuale: ricaricare la 8082, aprire Nuovo utente, digitare la password
iniziale e usare l’occhio per mostrarla/nasconderla. UAT visiva di Floriano
ancora attesa; prompt 02 non avviato.

## Avvio prompt 02 — blocco B

Floriano conferma «Il punto precedente è CHIUSO e funziona bene» e trasmette
`BUG 4/02_Volontari_Mezzi_Turni.txt`: attivati soltanto BUG 02/03/15.
Si riusano branch della campagna e D01 approvata; nessuna nuova domanda
funzionale necessaria. Il prompt 01, comprese le rifiniture del form Utenti,
ha OK UAT esplicito. ##test della consegna 02 non è ancora attivato.
La ricompilazione sulla 8082 resta autorizzata dall’istruzione precedente
di Floriano di aggiornare sempre l’ambiente per la sua prova personale.

Analisi: i file Volontari/Mezzi/Turni e API del blocco non differivano dalla
baseline f668b7e; solo i form Beneficiari contenevano gli adeguamenti minimi
ai filtri dei servizi per Area della consegna precedente. L’account ora è
autorizzato per Area, come richiesto successivamente da Floriano: il Centro
del turno è un contesto operativo selezionato, non un nuovo vincolo account.

Implementati: rimozione D01, badge approvazione desktop/mobile, nascite
manuali/import con giorno civile Europe/Rome, invalidazioni mirate e 409,
contesto Area/Centro e finestra di pianificazione civile di sette giorni.
Schema DB invariato; API DELETE Volontari estesa con un flag opzionale,
con compatibilità del vecchio comportamento in assenza del flag.

## Consegna 02 — sviluppo BUG 02, 03 e 15

**BUG 02 sviluppato.** Elimina distinta da Sospendi, secondo D01.
Sotto lock e controllo versione, cancellazione fisica solo senza audit e senza
alcuna dipendenza FK (incluse SET NULL/CASCADE). Altrimenti cessazione operativa
con identità, storico, relazioni e registro conservati, nessuna cascata.
Una registrazione nel ledger è già una dipendenza protetta. Un pending cessato
esce dalla coda e non è approvabile, senza falsificare il suo stato in rifiuto.
Il vecchio DELETE senza flag resta compatibile. Badge Da approvare desktop/mobile,
link solo con grant di lettura Approvazioni e Area Logistica; gestione volontari
non autorizza approvazioni. Nascita reale/non futura in UI/API, modifica,
preview e commit import con correzioni. Calendari beneficiari/nucleo allineati;
oggi valido, giorni civili Europe/Rome, nessuna nuova policy di età.

**BUG 03 sviluppato.** Invalidazione mirata con chiavi canoniche di coda,
liste filtrate, dettagli/dossier, mezzi, selettori Turni e carico; applicata
anche a import/eventi. Nessun polling, invalidazione globale o staleTime ridotto.
Il 409 ricarica il dato autorevole e mostra errore, senza esito positivo fittizio
né disponibilità ottimistica di risorse ancora pending.

**BUG 15 sviluppato.** Area → Centro, valori del profilo bloccati e Centri
attivi coerenti. Il Centro è contesto del turno, non vincolo dell’account.
Cambio contesto: reset di modali/selezioni e risposte tardive ignorate.
Disponibilità alla data e nel Centro selezionati, risorse trasversali conservate;
giornate dei temporanei specifiche del Centro. Approvazione, assicurazione,
sospensioni, conflitti anche fra Centri e carico restano vincolanti.
Pianificazione/riassegnazione da oggi−7 incluso, UI/API, giorni civili anche
su cambio anno e ora legale; futuro consentito. Storico leggibile, no-op
senza cambio versione, annullamento secondo policy esistenti; conferma/chiusura
non ristrette dal nuovo limite. Completati e vincoli delle consegne protetti.
Nuove etichette in italiano, inglese, spagnolo, francese, tedesco e arabo.

### Verifiche della consegna 02

- `pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS su tutti i workspace previsti.
- UI completa: **751 PASS**, 118 file, zero skip. Nuove prove comportamentali
  su cache fresca, quattro azioni approva/rifiuta e 409, badge e grant,
  Area/Centro, reset/callback tardive, storico annullabile e date civili.
- Runner `api general`: **1.502 PASS, 4 SKIP**, 138 file. Include le suite
  richieste e D01 unused/storico/versione, nascita oggi/domani/impossibile,
  import e correzioni, temporanei per Centro, oggi−7/−8/futuro in quattro clock
  con cambio anno e ora legale. I quattro skip preesistenti richiedono gli
  originali esterni AGEA/FSE: acceptance originali **NON ESEGUITE**.
- Runner `api reporting`: **83 PASS**, 6 file, zero skip, regressione storico.
- Runner PostgreSQL: **24 PASS**; fresh/replay e ledger temporanei **58/58**.
- Runner `browser volontari-workflows.spec.ts`: **15 PASS**, cinque viewport
  390–1440 px. Primo tentativo fermo prima dei test per moduli macOS esclusi
  dagli override del workspace; ripresa con versioni native corrispondenti
  solo in `/private/tmp/prompt02-native`, mediante `NODE_PATH`. Dipendenze,
  lockfile, override, runner, attestazioni e lock di sicurezza invariati.
- Runner API/browser in sequenza su PostgreSQL temporanei attestati, nessuna
  suite mutativa sul DB personale 8082. Cleanup container/reti completato,
  nessun volume creato. Quattro documenti preesistenti invariati per SHA-256.

Evidenze fuori Git: `/private/tmp/prompt02-install.log`,
`/private/tmp/prompt02-typecheck-final.log`, `/private/tmp/prompt02-ui-r6.log`,
`/private/tmp/prompt02-r2-api-general`, `/private/tmp/prompt02-r1-api-reporting`,
`/private/tmp/prompt02-browser-volontari-r2`.
Un primo test D01 leggeva come colonna un campo amministrativo derivato:
corretto verificandolo attraverso l’API; esiti sopra delle riprese riuscite.
Fixture logistiche con date fisse ora deterministiche tramite clock controllato,
nessun bypass della guardia nell’applicazione. Mock i18n dei test beneficiari
allineati alla registrazione lazy delle nuove traduzioni.

OpenAPI introduce `VolontarioRemoveInput`, con `removeIfUnused` boolean opzionale
(default false); generated rigenerati dal comando ufficiale.
**Nessuna migrazione o modifica dello schema DB.** Build/budget e ricevuta 8082
riportati sotto. Nessuna decisione funzionale pendente.
UAT personale **DA ESEGUIRE**, ##test non attivato dalla sola lettura del file.

### File modificati nel checkpoint 02

- `artifacts/api-server/src/lib/volontariValidation.ts`
- `artifacts/api-server/src/lib/volontariWorkbook.ts`
- `artifacts/api-server/src/lib/volontarioRemoval.ts`
- `artifacts/api-server/src/routes/approvazioni-logistica.ts`
- `artifacts/api-server/src/routes/turni.ts`
- `artifacts/api-server/src/routes/volontari-import.ts`
- `artifacts/api-server/src/routes/volontari.ts`
- `artifacts/api-server/tests/logistica-hardening.test.ts`
- `artifacts/api-server/tests/logistica-lock-order.test.ts`
- `artifacts/api-server/tests/logistica-reconciliation.test.ts`
- `artifacts/api-server/tests/turni-mezzo-conflitto.test.ts`
- `artifacts/api-server/tests/turni-window-bug15.test.ts`
- `artifacts/api-server/tests/volontari-2-api.test.ts`
- `artifacts/api-server/tests/volontari-save-validation-api.test.ts`
- `artifacts/magazzino-solidale/src/components/beneficiari-provvisori.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-tessera.test.tsx`
- `artifacts/magazzino-solidale/src/components/logistica-bug03.test.tsx`
- `artifacts/magazzino-solidale/src/components/volontari/volontari-import-dialog.tsx`
- `artifacts/magazzino-solidale/src/components/volontari/volontario-dossier-sheet.tsx`
- `artifacts/magazzino-solidale/src/components/volontari/volontario-operation-dialog.tsx`
- `artifacts/magazzino-solidale/src/components/volontari/volunteer-approval-badge.tsx`
- `artifacts/magazzino-solidale/src/lib/date-only.test.ts`
- `artifacts/magazzino-solidale/src/lib/date-only.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/logisticaCampaign.ts`
- `artifacts/magazzino-solidale/src/lib/logistica-cache.ts`
- `artifacts/magazzino-solidale/src/lib/logistica-hardening-ui.test.ts`
- `artifacts/magazzino-solidale/src/lib/volontari-2-ui.test.ts`
- `artifacts/magazzino-solidale/src/lib/volontari-form.ts`
- `artifacts/magazzino-solidale/src/pages/approvazioni-logistica.tsx`
- `artifacts/magazzino-solidale/src/pages/beneficiari.tsx`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `artifacts/magazzino-solidale/src/pages/mezzi.tsx`
- `artifacts/magazzino-solidale/src/pages/turni.test.tsx`
- `artifacts/magazzino-solidale/src/pages/turni.tsx`
- `artifacts/magazzino-solidale/src/pages/volontari.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/volontarioRemoveInput.ts`

### Unica sequenza UAT personale proposta

Creare volontario/mezzo → vedere Da approvare → approvare con profilo abilitato
→ tornare subito all’elenco → scegliere Area/Centro in Turni → pianificare
con la risorsa ammessa (approvata, assicurata e disponibile alla data).
Provare nascita oggi accettata, domani/impossibile respinte anche nell’import
e nel nucleo; oggi−7 ammesso, oggi−8 bloccato per nuovi turni/riassegnazioni,
storico leggibile e annullabile secondo le policy.
Al 19/10/2026: 12/10 incluso, 11/10 escluso dalla pianificazione.
Fermarsi: prossimo incarico **##test della consegna 02**; nessun avvio automatico
del prompt 03, nessuna chiusura UAT ricavata dai test automatici.

### Installazione personale 8082 — consegna 02

Checkpoint applicativo **`7adf403d8361d35a68de523a10c575f75ecbb03b`**, pubblicato e verificato
su `origin/codex/bugfix-uat-ottobre-2026`. La presente ricevuta è documentale:
API e WEB eseguono esattamente il checkpoint applicativo, senza codice successivo.

- Codegen ufficiale ripetuto: PASS, manifest SHA-256 dei generated identico
  prima/dopo, nessuna deriva (`/private/tmp/prompt02-codegen-final.log`).
- Typecheck finale sul checkpoint: PASS
  (`/private/tmp/prompt02-typecheck-final.log`).
- Build Docker API e WEB: PASS da archivio Git della SHA completa.
- Budget WEB: **399,2/400 KiB gzip**, entry `index-D0903Ymh.js`;
  soglia invariata. Verificato il bundle estratto dall’immagine installata.
- API `magazzino-bugfix-uat-api:sha-7adf403d8361`,
  image ID `sha256:28bd33fe97fde57f78b5b3e780db879a3a4d97e4df5d5d3273585ae66998395a`.
- WEB `magazzino-bugfix-uat-web:sha-7adf403d8361`,
  image ID `sha256:f79ec0e4dcd2e3534e0647547cc58d07a7ebe4e2431beb3c63e1d4008ca95e53`.
  Label Git di entrambe le immagini e dei container uguali alla SHA candidata.
- Backup database `pg_dump -Fc` e archivio uploads con SHA-256 e indici leggibili.
  **Non è stata eseguita una prova di restore**; nessuna migrazione presente.
  Directory privata backup/ricevute/override/rollback:
  `/Users/florianocaprio/Backups/Magazzino-Solidale/PROMPT02-7adf403d8361-2026-10-19T14-18-31-296Z`.
- Configurazione Compose effettiva confrontata: cambiano soltanto immagini,
  label di revisione e versione sorgente del runner migration. Catena presa
  dal WEB corrente, comprese le ultime rifiniture Utenti.
- Ricreati soltanto APIe WEB con `up -d --no-deps --no-build api web`.
  Container PostgreSQL `af6bd975d17d0fb187820b50a860a51075ac8c64656356e59c1c12b7ea402797`
  e avvio `2026-10-06T14:06:51.181962875Z` invariati;
  volumi DB/uploads preservati. Nessuna cancellazione o ripristino dati.
- API healthy, PostgreSQL healthy; WEB senza healthcheck Docker.
  Ledger **58/58**, zero pending/checksum difformi/file mancanti/fuori ordine.
  HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**;
  `/api/utenti` senza sessione: **401**.
- Evidenze: `/private/tmp/prompt02-build-result.json` e
  `/private/tmp/prompt02-release-result.json`, più ricevute nella directory
  privata indicata sopra. Nessun dato personale, backup, log o screenshot in Git.

Nessuna decisione pendente. BUG 02/03/15 **sviluppati e verificati automaticamente**,
**UAT DA ESEGUIRE** personalmente da Floriano. La 8082 è stata aggiornata per
l’autorizzazione persistente «ricompila sempre 8082». La fase distinta ##test
resta il prossimo incarico; nessun altro prompt avviato. Main e produzione
non modificati. Quattro documenti locali preesistenti preservati ed esclusi.

## Precisazione UAT consegna 02 — volontari assegnati per Area

Nuovo mandato esplicito di Floriano: il volontario è assegnato a un’Area e
può operare in tutti i suoi Centri, mense ed empori; il Centro di riferimento
è facoltativo e organizzativo. Questa decisione sostituisce il precedente
vincolo operativo per Centro nel blocco B. Nessuna assegnazione automatica di
ruoli o permessi: l’account continua a usare profilo e Area della consegna 01,
che resta chiusa. Lo screenshot locale indicato non era disponibile; la
richiesta testuale è sufficiente e autorevole.

Intervento incrementale:

- `volontari.area_operativa_id`, FK/indice e migrazione append-only
  `20261019_volontari_area_operativa.sql`. Backfill solo dall’Area certa del
  Centro esistente; nessuna Area inventata per i legacy senza associazione.
  I NULL storici rimangono riparabili dall’amministratore globale e non sono
  risorse condivise globalmente operative. Area richiesta dai writer API;
  colonna nullable solo per conservare i legacy non classificabili.
- Centro di riferimento facoltativo e coerente con l’Area; controllo DB
  aggiuntivo. Per client precedenti/seeding, un Centro con Area certa può
  valorizzare il nuovo campo, senza ampliare i permessi.
- Modulo, modifica, filtri, lista desktop/mobile e import: Area esplicita,
  Area del profilo preimpostata, Centri della stessa Area. Cambiare Area
  azzera il riferimento incompatibile. Matricole generabili anche senza
  Centro, dalla configurazione per Area, senza rinumerare quelle esistenti.
- Elenchi, dettagli, approvazione, dossier, operazioni e formazione autorizzati
  per Area. Turni/consegne/bolle propongono e accettano volontari dell’Area
  di servizio anche con un diverso Centro di riferimento. Un’Area diversa
  resta vietata; rimangono approvazione, assicurazione, sospensioni, conflitti
  fra Centri, carico e finestra di sette giorni.
- Giornata temporanea valida nella medesima Area e data, anche prestando
  servizio in un altro Centro; il Centro della giornata resta un fatto
  storico, non una limitazione al Centro di riferimento. Giorni annullati,
  assenti o di altre date non rendono operativo il volontario.
- Mezzo personale segue l’Area del proprietario anche senza Centro;
  visibilità, accesso diretto, modifica, approvazione e assegnazioni protetti.
  Politiche dei mezzi dell’associazione conservate.
- Registro/report/export includono i volontari senza Centro della propria
  Area. Nuovi snapshot includono Area; eventi, catene hash, iscrizioni,
  matricole ed emissioni preesistenti non riscritti.

Prima validazione completa: 1.508 API PASS e 4 skip preesistenti su originali
esterni; cinque nuovi test di appartenenza/operatività/migrazione e import
per Area senza Centro. UI 752 PASS; typecheck e codegen riproducibile PASS.
Dopo l’ultima pulizia delle guardie per Area sono in corso le esecuzioni
finali API/report/UI/browser: esiti e installazione nel successivo checkpoint
documentale. UAT personale DA ESEGUIRE; nessun avvio di altri prompt.

### File della precisazione per Area

- `artifacts/api-server/src/lib/logisticaPolicy.ts`
- `artifacts/api-server/src/lib/reporting/volunteers.ts`
- `artifacts/api-server/src/lib/volontariArea.ts`
- `artifacts/api-server/src/lib/volontariLedger.ts`
- `artifacts/api-server/src/lib/volontariMatricola.ts`
- `artifacts/api-server/src/lib/volontariOperational.ts`
- `artifacts/api-server/src/lib/volontariRegisterResolver.ts`
- `artifacts/api-server/src/lib/volontariScope.ts`
- `artifacts/api-server/src/lib/volontariValidation.ts`
- `artifacts/api-server/src/routes/approvazioni-logistica.ts`
- `artifacts/api-server/src/routes/bolle.ts`
- `artifacts/api-server/src/routes/consegne.ts`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/routes/mezzi.ts`
- `artifacts/api-server/src/routes/volontari-export.ts`
- `artifacts/api-server/src/routes/volontari-formazione.ts`
- `artifacts/api-server/src/routes/volontari-import.ts`
- `artifacts/api-server/src/routes/volontari-operazioni.ts`
- `artifacts/api-server/src/routes/volontari.ts`
- `artifacts/api-server/tests/logistica-hardening.test.ts`
- `artifacts/api-server/tests/logistica-reconciliation.test.ts`
- `artifacts/api-server/tests/scope-helpers.ts`
- `artifacts/api-server/tests/scoping-direct.test.ts`
- `artifacts/api-server/tests/volontari-2-api.test.ts`
- `artifacts/api-server/tests/volontari-area-api.test.ts`
- `artifacts/api-server/tests/volontari-save-validation-api.test.ts`
- `artifacts/magazzino-solidale/e2e/volontari-workflows.spec.ts`
- `artifacts/magazzino-solidale/src/components/volontari/volontari-import-dialog.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/logisticaCampaign.ts`
- `artifacts/magazzino-solidale/src/lib/volontari-form.test.ts`
- `artifacts/magazzino-solidale/src/lib/volontari-form.ts`
- `artifacts/magazzino-solidale/src/pages/turni.tsx`
- `artifacts/magazzino-solidale/src/pages/volontari.tsx`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/analyzeVolontariImportParams.ts`
- `lib/api-zod/src/generated/types/approvazioneVolontario.ts`
- `lib/api-zod/src/generated/types/listVolontariParams.ts`
- `lib/api-zod/src/generated/types/mezzo.ts`
- `lib/api-zod/src/generated/types/volontario.ts`
- `lib/api-zod/src/generated/types/volontarioFieldErrors.ts`
- `lib/api-zod/src/generated/types/volontarioInput.ts`
- `lib/api-zod/src/generated/types/volontarioUpdate.ts`
- `lib/db/src/schema/volontari.ts`
- `lib/db/updates/20261019_volontari_area_operativa.sql`

### Esito finale della precisazione per Area e ricevuta 8082

SHA installata **`0d05e6e0a78b04ed51671c399409409666e217fc`**. Codice applicativo nel
checkpoint `2ce34298ff48c9a9f532c1e80efbe7dd7fe59a7a`; l’unica differenza del
checkpoint finale è la fixture browser, che ora riusa la seconda Area fra
viewport invece di duplicarne il codice univoco. Confronto Git dei percorsi:
solo `artifacts/magazzino-solidale/e2e/volontari-workflows.spec.ts`.
API/UI automatiche riutilizzate sui contenuti applicativi identici;
browser, typecheck e build attestati anche sul checkpoint finale.

- `pnpm install --frozen-lockfile`: PASS, nessuna modifica al lockfile.
- Typecheck: PASS (`/private/tmp/vol-area-typecheck-candidate.log`).
- Codegen ufficiale ripetuto: PASS; manifest SHA-256 identico prima/dopo,
  nessuna deriva (`/private/tmp/vol-area-codegen-final.log`).
- UI: **752 PASS**, 118 file, zero skip (`/private/tmp/vol-area-ui-final.log`).
- Runner API finale: `api general reporting`, **1.508 + 83 PASS**, zero fail;
  quattro skip preesistenti sugli originali esterni, acceptance originali
  ancora NON ESEGUITE. Runner PostgreSQL **24 PASS**, fresh/replay e ledger
  temporanei **59/59**. Evidenze: `/private/tmp/vol-area-api-final`.
- Browser finale: **15 PASS**, cinque viewport 390–1440 px, incluse Area
  richiesta, Centro facoltativo/coerente, cambio Area e reset del riferimento.
  Evidenze: `/private/tmp/vol-area-browser-r2`. La prima esecuzione ha rilevato
  solo la fixture con codice Area duplicato fra viewport; corretto il test,
  nessuna policy o asserzione dell’applicazione allentata. Moduli nativi
  macOS temporanei via NODE_PATH, invariati workspace e runner.
- Tutte le suite funzionali mutative su dati sintetici e PostgreSQL temporanei
  attestati, API/browser in sequenza con lock condiviso. Nessuna suite
  funzionale eseguita sui dati personali 8082.
- Build Docker API/WEB: PASS da archivio Git del checkpoint finale.
  Budget WEB **399,2/400 KiB gzip**, entry `index-DYzo5Kt0.js`; soglia invariata.

**Preflight della migrazione reale, distinto dalle suite funzionali.**
Backup completo `pg_dump -Fc` e archivio uploads, SHA-256 e indici verificati.
Ripristino del backup in PostgreSQL temporaneo, senza porte esposte né avvio
dell’applicazione. Eseguito solo il runner migration del candidato: upgrade
58→59 PASS, nessuna differenza nell’impronta di tutti gli attributi precedenti
dei volontari e negli eventi/hash del registro. La nuova colonna è l’unica
variazione business. Copia e rete temporanee rimosse; nessun volume creato.
La prova è stata ripetuta con le immagini della SHA finale e l’ultimo backup.

Ricevute private, backup, clone preflight e configurazioni:
`/Users/florianocaprio/Backups/Magazzino-Solidale/VOLONTARI-AREA-0d05e6e0a78b-2026-10-19T15-16-12-160Z`.
`restoreTested=true`, `integrityUnchanged=true`; nessun valore personale
riportato in chat o Git, soltanto impronte e conteggi tecnici.

Installazione personale autorizzata dall’istruzione «ricompila sempre 8082»:
confronto della configurazione Compose effettiva, cambiano immagini,
label Git e versione sorgente migration. Ricreati soltanto API e WEB.

- API `magazzino-bugfix-uat-api:sha-0d05e6e0a78b`,
  image ID `sha256:4bc413a799c5ef16d25cd2e6c6bf17193ada86f69b21e962a0f09bd29883654f`.
- WEB `magazzino-bugfix-uat-web:sha-0d05e6e0a78b`,
  image ID `sha256:37b77bb3dcf292daffe959ac79bd5ba5cca83a79f1a5826829d10301a8e34fc3`.
- Label Git immagini/container uguali alla SHA finale; API healthy.
- PostgreSQL con container e avvio invariati
  (`2026-10-06T14:06:51.181962875Z`), volumi DB/uploads preservati.
- Ledger **59/59**, zero pending/checksum difformi/mancanti/fuori ordine.
- HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**;
  `/api/utenti` senza sessione: **401**.
- Confronto dopo l’installazione: attributi precedenti, identità e registro
  invariati rispetto al backup; **10 volontari con Area ricavata e 2 legacy senza Area**,
  stessi conteggi del preflight. Nessuna Area attribuita arbitrariamente.

**Passaggio manuale necessario:** con profilo globale, in Volontari cercare
«Area da assegnare», aprire Modifica e completare i due record con l’Area
corretta; Centro di riferimento facoltativo della stessa Area. Non sono
operativi né condivisi tra tutte le Aree finché manca l’appartenenza.
Mantenuti tutti gli altri requisiti anagrafici e assicurativi già previsti.

Impatto rollback: schema additivo, backup/restore verificato. Un vecchio
container API con sole 58 migration non può essere ripristinato usando
soltanto l’override immagine: occorre un runner compatibile con la 59 oppure
un ripristino autorizzato del backup. Nessun rollback eseguito.

Per la UAT: creare/modificare volontario con Area e senza Centro, poi con
Centro di riferimento; approvare/assicurare se necessario e pianificare in
un altro Centro della stessa Area. Deve comparire ed essere assegnabile;
un’Area diversa deve restare esclusa. L’operatività nei servizi dell’Area
resta soggetta ai permessi del profilo, senza grant automatici per mensa o emporio.
**UAT personale DA ESEGUIRE**. Consegna 01 resta chiusa; nessun altro prompt,
##test, merge, main o produzione avviato. Quattro documenti locali preesistenti
invariati ed esclusi dai commit.


## Precisazione successiva UAT — Centro facoltativo come limite di visibilità

Il 19/10 Floriano specifica: Area obbligatoria, Centro di ascolto facoltativo;
se assente il volontario è visibile in tutti i Centri della propria Area,
se presente soltanto nel Centro di riferimento. Questa decisione sostituisce
la precedente indicazione di operatività senza limiti del Centro di riferimento.

- Confermati Area obbligatoria, Centro della stessa Area facoltativo e
  generazione matricola dall’Area anche senza Centro.
- Nei contesti di servizio/filtri Centro: volontari condivisi oppure del
  riferimento selezionato, sempre entro la propria Area. Controllo server
  anche per assegnazioni dirette a turni, consegne, mezzi personali e giornate.
- Picker Bolla e assegnazione diretta applicano lo stesso limite: nessun
  volontario di altro Centro della stessa Area. Senza Centro del beneficiario,
  solo volontari condivisi della sua Area, senza attribuire contesti arbitrari.
- L’anagrafica amministrativa dell’Area resta accessibile ai profili abilitati;
  il filtro Centro applica il perimetro sopra descritto. Nessuna nuova
  assegnazione Centro agli account e nessuna modifica ai ruoli di Utenti.
- Coperture, approvazione, sospensioni, date, conflitti/carico e storico restano
  invariati; nessuna nuova migration, modifica OpenAPI o rigenerazione tipi.

File modificati in questa precisazione:

- `artifacts/api-server/src/lib/volontariArea.ts`
- `artifacts/api-server/src/routes/bolle.ts`
- `artifacts/api-server/tests/volontari-area-api.test.ts`
- `artifacts/api-server/tests/logistica-hardening.test.ts`
- `artifacts/api-server/tests/documenti-operativi-m4a.test.ts`
- `artifacts/magazzino-solidale/src/pages/turni.tsx`
- `artifacts/magazzino-solidale/src/pages/turni.test.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/logisticaCampaign.ts`
- `artifacts/magazzino-solidale/e2e/volontari-workflows.spec.ts`
- questo registro.

Fixture dei test di concorrenza rese esplicitamente condivise nell’Area;
le asserzioni su doppie assegnazioni e serializzazione restano vincolanti.
Matrice API su permanenti/temporanei condivisi e con riferimento, esclusione
fuori Area, giornata e assegnazione diretta; Bolla verifica picker e rifiuto
del riferimento diverso; UI Turni verifica il filtro anche su risposta mista.
Verifiche e ricevuta della nuova 8082 seguono dopo l’esecuzione effettiva.

### Ricevuta — Centro facoltativo e 8082 aggiornata

Checkpoint applicativo `3c882b610be185ef5f62867ac562e8e7b322b08d` (API e WEB).

- `pnpm install --frozen-lockfile`: PASS con Node 24 e CI=true dopo la prima
  invocazione senza TTY; lockfile invariato.
- `pnpm run typecheck`: PASS, compresa l’ultima versione dei test.
- `pnpm --filter @workspace/magazzino-solidale run test`: **753 PASS**, 118 file.
  Prima esecuzione: fixture del nuovo test priva del flag operativo, corretta
  per rappresentare volontari selezionabili; nessuna asserzione rimossa.
- `node scripts/quality-gates-run.mjs api general reporting`: **1.508 PASS +
  4 SKIP** in general (139 file), **83 PASS** reporting (6 file), **24 PASS**
  runner PostgreSQL. Totale API **1.591 PASS**, quattro acceptance di originali
  esterni non eseguite. PostgreSQL temporanei attestati, fresh/replay e ledger
  **59/59**, cleanup completato. Evidenze `/private/tmp/vol-centro-api`.
- `node scripts/quality-gates-run.mjs browser volontari-workflows.spec.ts`:
  **15 PASS**, cinque viewport 390–1440 px, in sequenza dopo API e con lock
  condiviso, solo dati sintetici temporanei. Evidenze
  `/private/tmp/vol-centro-browser`. NODE_PATH ai moduli nativi macOS temporanei,
  invariati dipendenze e runner canonico. Nessuna suite funzionale sui dati 8082.
- Build Docker da archivio del checkpoint: API e WEB PASS;
  **399,2/400 KiB gzip**, entry `index-DDEq_xxN.js`, soglia invariata.

Backup completo DB (`pg_dump -Fc`) e uploads, SHA-256 e indici archivi verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/VOLONTARI-CENTRO-3c882b610be1-2026-10-19T15-26-24-508Z`.
Per questo backup `restoreTested=false`: nessuna nuova migration, nessuna
nuova prova di ripristino dichiarata. La verifica precedente 58→59 rimane
registrata nella ricevuta antecedente.

Ricreati soltanto API/WEB, dopo confronto Compose con variazioni limitate a
immagini e revisione. PostgreSQL con stesso container e avvio del 06/10,
volumi DB/uploads invariati. Ledger **59/59**, zero pending/checksum difformi,
mancanti o fuori ordine. Tutti gli attributi dei volontari, compresa Area,
e gli eventi/hash del registro invariati rispetto al backup.

- API `magazzino-bugfix-uat-api:sha-3c882b610be1`, image ID
  `sha256:bf16c19170d59c55d15be396236e1655f008db3cd66c8c4c85bce8cc94fc340e`.
- WEB `magazzino-bugfix-uat-web:sha-3c882b610be1`, image ID
  `sha256:df1b7db568bb6dcc739ce629b617c5dda25900cebe4887cb5b6eb7ea16d05ccb`.
- Label Git immagini/container: checkpoint sopra; API healthy.
- HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**;
  `/api/utenti` senza sessione: **401**.

UAT: ricaricare la 8082. Con Area assegnata e nessun Centro, verificare la
presenza in entrambi i Centri dell’Area; assegnando Centro A, verificare la
presenza soltanto in A e l’assenza dalle selezioni di B. Un’altra Area rimane
esclusa in entrambi i casi. Approvazione/assicurazione ancora necessarie per
l’assegnazione operativa. Matricola generabile senza Centro.
Restano i due legacy senza Area da completare manualmente con profilo globale,
senza attribuzioni arbitrarie; nuovi salvataggi richiedono un’Area valida.
**UAT DA ESEGUIRE**, consegna 01 chiusa, nessuna fase successiva avviata.
I quattro documenti locali preesistenti restano invariati ed esclusi dai commit.


## Avvio prompt 03 — BUG 17 Enti territoriali e globali

Il 19/10 Floriano conferma «Ho provato sulla 8082, ora funziona tutto. Il punto
02 è chiuso», attiva espressamente il prompt 03 e ribadisce «ricompila sempre
la 8082 per le prove». Conseguentemente consegna 02 e BUG 02/03/15 sono chiusi
con OK UAT; per il checkpoint 03 la richiesta diretta più recente prevale sul
divieto di installazione intermedia del file: preparare anche la 8082 dopo
verifiche e preflight. Non è attivato il prompt 04 né il distinto ##test/##merge.
D04 è già APPROVATA, nessuna nuova conferma necessaria.

Rappresentazione unica: `enti_destinatari.area_operativa_id` nullable:
ID reale = territoriale; NULL esplicito = globale. Campo obbligatorio nel payload
di creazione, nullable solo per amministrazione globale. Area e ambito restano
immutabili in modifica; nessun trasferimento o conversione degli Enti esistenti.
Migration incrementale `20261019_z_enti_destinatari_globali.sql`, dopo la 59:
rimuove soltanto NOT NULL. Nessun UPDATE dei dati, nessuna modifica degli ID/FK,
dei documenti o dei grant. Schema, OpenAPI e client/Zod rigenerati con codegen
ufficiale. L’API deve essere distribuita con la nuova migration prima del nuovo
form globale; rollback con vecchie immagini richiede runner compatibile col
ledger aggiornato, senza conversioni o cancellazioni dei globali creati.

Policy specifica `entiScope.ts`, senza cambiare `centroScope`: l’amministratore
locale non può amministrare globali anche se isAdmin=true. Lettura/uso conservano
grant e moduli esistenti. Filtro Area include territoriali dell’Area + globali,
con intersezione dello scope prima di ricerca/ordinamento/paginazione;
`ambito=globali` seleziona soltanto globali. Area estranea al profilo rifiutata.

Le operazioni richiedono sempre un’Area concreta. La stessa coerenza
territoriale/globale è verificata nelle transazioni di creazione/modifica e
conferma Bolla, richiesta/preparazione e prova di chiusura M5. Le Bolle mantengono
snapshot Area del magazzino, mai quello NULL dell’Ente. Storico leggibile anche
con Ente inattivo; nuova selezione/operazione richiede Ente attivo. Restano
idempotenza, versioni, lock, scoping dei documenti e contabilità esistenti.

Raccordo per il prompt 04: in `documento-operativo.tsx` preservare il tipo Area
nullable del selezionato, la query Enti filtrata dall’Area del contesto/magazzino,
il reset di un territoriale incompatibile e l’esenzione dei globali dai soli
confronti Ente/Area. Un globale non cancella il magazzino scelto e non rimuove
filtri territoriali del profilo/contesto. Preservare etichette di ambito nel
combobox, policy server e regressioni del ciclo M5.

Verifiche e checkpoint finale saranno registrati dopo l’esecuzione effettiva.

File modificati per BUG 17 (inclusi contratti generati):

- `artifacts/api-server/src/lib/m5RequestClosure.ts`
- `artifacts/api-server/src/routes/bolle.ts`
- `artifacts/api-server/src/routes/enti-destinatari.ts`
- `artifacts/api-server/src/routes/richieste-magazzino.ts`
- `artifacts/api-server/tests/documenti-operativi-m4a.test.ts`
- `artifacts/api-server/tests/richieste-magazzino-m5a.test.ts`
- `artifacts/api-server/tests/richieste-magazzino-m5b.test.ts`
- `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`
- `artifacts/magazzino-solidale/src/components/documento-operativo.tsx`
- `artifacts/magazzino-solidale/src/components/ente-destinatario-combobox.tsx`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/entiEsterni.ts`
- `artifacts/magazzino-solidale/src/pages/enti-esterni.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/enteDestinatario.ts`
- `lib/api-zod/src/generated/types/enteDestinatarioInput.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/listEntiDestinatariParams.ts`
- `lib/db/src/schema/entiDestinatari.ts`
- `artifacts/api-server/src/lib/entiScope.ts`
- `artifacts/magazzino-solidale/src/pages/enti-esterni.test.tsx`
- `lib/api-zod/src/generated/types/listEntiDestinatariAmbito.ts`
- `lib/db/updates/20261019_z_enti_destinatari_globali.sql`


### Ricevuta finale 03 — checkpoint tecnico pronto per ##test

Checkpoint applicativo `baecd89c4b5c079a5e43c9526c2aae77c441eedc`;
checkpoint finale **`e8dbbfd65ff79b630b3f18ad2dea703d073b8b27`**, che aggiunge soltanto la correzione di un selettore
nel test browser. API, schema, UI applicativa e migration identici fra i due:
riusate le evidenze pertinenti; typecheck e build ripetuti anche sulla SHA finale.
**D04 approvata, nessuna parte sospesa. BUG 17 non chiuso**: UAT del blocco C
integrato dopo prompt 04; nessun prompt 04 avviato automaticamente.

Verifiche realmente eseguite con Node 24 e pnpm del workspace:

- `pnpm install --frozen-lockfile`: PASS (CI=true), lockfile invariato.
- `pnpm --filter @workspace/api-spec run codegen`: PASS, eseguito tramite
  comando ufficiale; schema/client/Zod aggiornati. Seconda generazione coerente.
- `pnpm run typecheck`: PASS, anche sul checkpoint finale.
- `pnpm --filter @workspace/magazzino-solidale run test`: **756 PASS**, 119 file,
  incluse le nuove verifiche di filtro/pagina e amministrazione degli Enti.
- `node scripts/quality-gates-run.mjs api general reporting`: prima esecuzione
  PASS. Esecuzione finale `api general` dopo il completamento delle nuove prove:
  **1.513 PASS + 4 SKIP**, 139 file; reporting **83 PASS**, 6 file, sul medesimo
  codice applicativo. Totale selezionato **1.596 API PASS**, quattro acceptance
  di originali esterni non eseguite. Runner PostgreSQL **24 PASS**, fresh/replay
  e ledger temporanei **60/60**, zero differenze. Evidenze
  `/private/tmp/enti03-api-final` e `/private/tmp/enti03-api` (reporting).
- Browser via runner canonico, API terminate e lock condiviso rispettato:
  `m4a-documenti-destinatari.spec.ts` **8 PASS**, **32 SKIP** previsti sulle
  quattro repliche non desktop dei lifecycle mutativi;
  `m4a-documenti-accessibilita.spec.ts` **3 PASS**, **2 SKIP** previsti dalla
  matrice desktop/tablet, sei lingue e RTL. Totale **11 PASS + 34 SKIP**.
  Prima prova: nuovo selettore filtro Area ambiguo col selettore Lingua;
  corretto soltanto il locator, nessuna asserzione o policy ridotta. Ripetuta
  integralmente la suite documentale, incluse creazione globale da UI, scelta
  Ente che preserva magazzino/Area, replay, PDF, snapshot e Trasferimento.
  Evidenze `/private/tmp/enti03-browser-r2` e `/private/tmp/enti03-browser`
  (accessibilità). NODE_PATH ai moduli nativi macOS temporanei già predisposti;
  invariati dipendenze, isolamento, attestazioni e runner.
- Tutte le prove funzionali su dati sintetici/PostgreSQL temporanei attestati;
  nessuna suite funzionale sui dati della 8082.
- Build API/WEB da archivio Git della SHA finale: PASS. Budget entry
  **399,4/400 KiB gzip**, `index-Lc3iSvcQ.js`, soglia invariata.

Preflight personale separato dai test funzionali: backup completo DB
(`pg_dump -Fc`) e uploads, SHA-256 e indici archivi verificati. Ripristino su
PostgreSQL temporaneo senza porte esposte e senza avvio dell’applicazione;
runner update canonico **59→60 PASS**, ledger senza pending/checksum difformi,
mancanti o fuori ordine. Confrontate impronte integrali di Enti, Bolle,
Richieste, lotti, movimenti, prenotazioni e audit: **tutte invariate**.
I **2 Enti preesistenti rimangono territoriali**, nessun globale creato dalla
migrazione. Copia e rete temporanee rimosse, nessun volume temporaneo creato.
La prova è stata ripetuta con backup e immagini della SHA finale.

Backup e ricevute private:
`/Users/florianocaprio/Backups/Magazzino-Solidale/ENTI-GLOBALI-e8dbbfd65ff7-2026-10-19T15-52-12-785Z`.
`restoreTested=true`, `integrityUnchanged=true`; nessun dato personale,
credenziale o connection string riportato in Git o in chat.

Installazione 8082 autorizzata dalla richiesta diretta successiva al file 03:
ricreati soltanto API e WEB dopo confronto Compose (sole immagini, revisione
Git e versione sorgente migration). Database non ricreato, stesso avvio del
06/10 e stessi volumi DB/uploads; update canonico applicato dall’entrypoint.

- API `magazzino-bugfix-uat-api:sha-e8dbbfd65ff7`, image ID `sha256:d9e32b119ffa725d06ee8ff3761a2320c0ba0cb50ecd78837a893c80926afc88`.
- WEB `magazzino-bugfix-uat-web:sha-e8dbbfd65ff7`, image ID `sha256:5b9e59a55bc0be3d0429185db7ad5094a9c7f0719616cf375ac7028608298942`.
- Revisione immagini e container uguale alla SHA finale; API **healthy**.
- Ledger personale **60/60**, zero pending/checksum difformi/mancanti/fuori ordine.
- HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**;
  `/api/utenti` senza sessione: **401**.
- Impronte dei dati dopo installazione uguali al backup; **2 Enti territoriali,
  0 globali**, senza conversioni automatiche o alterazioni contabili.

Prove disponibili sulla 8082, ricaricando la pagina: amministratore globale
crea un Ente scegliendo Area oppure Globale prima dell’anagrafica; il filtro
Area comprende i locali più i globali e Solo globali esclude i territoriali.
Un profilo di Area vede/usa i globali ma non li può amministrare. Nella Bolla
un globale mantiene magazzino e Area scelti; i documenti restano territoriali.
Nessuna modifica manuale ai dati richiesta per completare questa migrazione.
Il BUG 17 resta aperto per la UAT integrata dopo 04. Nessun merge/main/produzione.
I quattro documenti locali preesistenti conservati ed esclusi dai commit.


## Raccordo UAT 03 — filtro globale visibile dopo il riavvio

Floriano segnala che in Enti Esterni non trova il filtro globale e chiede
espressamente verifica e ricompilazione Docker 8082. Ricognizione successiva
al riavvio: API e WEB servono già `e8dbbfd65ff79b630b3f18ad2dea703d073b8b27`,
image ID coerenti con la ricevuta precedente, entry `index-Lc3iSvcQ.js`,
ledger 60/60 senza pending/checksum difformi. Nessun ritorno a immagini vecchie
rilevato. La causa della differenza percepita non è attestata come cache.

Floriano conferma la pagina `/enti-esterni`. La scelta Solo globali era nel
menu Area / ambito: aggiunto anche un pulsante sempre visibile accanto al
menu, con disposizione verticale sui piccoli schermi. Riusa il medesimo stato,
azzera la pagina e invia `ambito=globali`; non interpreta Tutte le Aree come
Solo globali. Nessuna modifica a schema, API, permessi, D04 o documenti.

File modificati:

- `artifacts/magazzino-solidale/src/pages/enti-esterni.tsx`
- `artifacts/magazzino-solidale/src/pages/enti-esterni.test.tsx`
- `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`
- questo registro.

Prova aggiornata: pulsante visibile senza aprire il menu, risposta API con
`areaOperativaId` NULL su tutti i risultati; controllo della pagina azzerata.
Restano valide la scelta nel menu e tutte le policy precedenti.
Nuova compilazione API/WEB e verifica 8082 da registrare dopo esecuzione.


### Ricevuta — pulsante globale visibile e nuova ricompilazione Docker 8082

Checkpoint applicativo `02b0345a1087df83c0b6a3b42ed3dd9760559ecb`. Modifica limitata al pulsante sempre visibile
in Enti Esterni e ai due test correlati, oltre al registro sopra elencato.

- `pnpm install --frozen-lockfile` (CI=true): PASS, lockfile invariato.
- `pnpm run typecheck`: PASS.
- `pnpm --filter @workspace/magazzino-solidale run test`: **756 PASS**, 119 file.
- Runner canonico `api general`: **1.513 PASS + 4 SKIP esterni**, 139 file;
  runner PostgreSQL **24 PASS**, fresh/replay a ledger **60/60**. Evidenze
  `/private/tmp/enti03-visible-api`. Backend e contratti invariati.
- Runner canonico `browser m4a-documenti-destinatari.spec.ts`: **8 PASS**,
  **32 SKIP** previsti sulle repliche non desktop dei lifecycle mutativi.
  Il nuovo test fa clic sul pulsante sempre visibile e verifica la chiamata
  `ambito=globali` e Area NULL in tutti i risultati restituiti. Passano anche
  le regressioni documentali preesistenti. Evidenze
  `/private/tmp/enti03-visible-browser`. API/browser in sequenza con lock;
  tutte le prove funzionali su PostgreSQL temporanei attestati e dati sintetici.
  Moduli nativi macOS ripristinati solo in cartella temporanea dopo il riavvio,
  senza modificare dipendenze o attestazioni.
- **API e WEB entrambe ricompilate** da archivio Git del checkpoint;
  budget **399,5/400 KiB gzip**, entry `index-BDdmi8Da.js`, soglia invariata.

Backup completo DB/uploads, SHA-256 e indici archivi verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/ENTI-GLOBALI-VISIBILI-02b0345a1087-2026-10-19T16-57-53-248Z`.
Nessuna nuova migration; ledger prima/dopo **60/60** senza difformità.
Per questo backup `restoreTested=false`; nessuna nuova prova di ripristino
necessaria o dichiarata. Il preflight 59→60 precedente resta documentato.

Ricreati esclusivamente APIe WEB con confronto Compose (sole immagini,
revisione e versione sorgente migration). PostgreSQL con stesso container e
stesso avvio della ricognizione dopo il riavvio; volumi DB/uploads preservati.
Impronte integrali di Enti, Bolle, Richieste, lotti, movimenti, prenotazioni e
audit invariate rispetto al backup. Nessuna modifica ai dati personali.

- API `magazzino-bugfix-uat-api:sha-02b0345a1087`; image ID `sha256:183a1ccd294c73f50a56c847685be66a3d9f3d6cfe2e7da99f4fdbbd0ebe9cf6`.
- WEB `magazzino-bugfix-uat-web:sha-02b0345a1087`; image ID `sha256:53ce783a872f5e4c66c0596e7939cceeb174211c755cec353356104ad03ba56b`.
- Label revision immagini/container uguali al checkpoint; API healthy.
- HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz`: **200**;
  `/api/utenti` senza sessione: **401**.
- Verificati `/enti-esterni`, entry e chunk di pagina `enti-esterni-Ckmf7UGz.js`:
  SHA-256 del contenuto realmente servito sulla 8082 uguale al file della nuova
  build, incluso il pulsante che controlla `enti-results`. Non una verifica
  basata soltanto sul tag immagine o sul codice locale.

Nuova prova: ricaricare `/enti-esterni` (anche con ⌘⇧R) e cliccare il pulsante
**Solo globali** accanto al menu Area; solo i record globali devono comparire.
Tutte le Aree conserva il significato di insieme completo accessibile.
BUG 17 resta in attesa di UAT integrata dopo 04; nessun prompt successivo,
merge/main o produzione attivato. Quattro documenti locali preesistenti
conservati ed esclusi dai commit.


## Precisazione UAT 03 — globali anche in Bolle / Nuovo documento

Floriano precisa che il filtro è richiesto sia in Enti Esterni sia nel
selettore Ente della Bolla. Conservato il pulsante della pagina anagrafica;
aggiunto al componente condiviso `CreaiBollaDialog` un pulsante Solo globali
attivabile/disattivabile, visibile quando il destinatario è Ente esterno.
La query usa `ambito=globali` mantenendo l’Area del contesto/magazzino. Non
modifica Area o magazzino dell’operazione né amplia permessi o visibilità.
Attivando il filtro, un territoriale selezionato viene azzerato insieme alla
sua ricerca; un globale già scelto resta selezionato. Il filtro si azzera
alla chiusura del form. Alla disattivazione tornano territoriali + globali
utilizzabili. Risposta precedente/mista filtrata anche lato picker durante
il cambio query, oltre alla policy server già presente.

File modificati:

- `artifacts/magazzino-solidale/src/components/documento-operativo.tsx`
- `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`
- questo registro.

Il test browser parte da un territoriale scelto e verifica reset della
selezione/ricerca, risposta con soli NULL, Area del magazzino nella query,
toggle del filtro, magazzino preservato e Bolla globale ancora territoriale.
Per il prompt 04 preservare anche questi stati e reset del ramo Ente.
Nessuna modifica schema, OpenAPI o API; ledger ancora 60/60. Nessun avvio 04.
Ricompilazione API/WEB e nuova ricevuta 8082 seguono le verifiche effettive.


### Ricevuta — Solo globali in anagrafica e Nuova Bolla, 8082 ricompilata

Checkpoint **`fa96bc4fa8c900c72e8ed5451526e9e8cf2a72c9`**. Percorsi disponibili: Enti Esterni, con pulsante
sempre visibile; Bolle → Nuovo → Nuova Bolla → Ente esterno, con pulsante
attivabile/disattivabile nel selettore. Le modifiche del componente comune
valgono per tutti i chiamanti del form, conservando il ramo Beneficiario.

- Installazione frozen lockfile e `pnpm run typecheck`: PASS, lockfile invariato.
- Suite UI: **756 PASS**, 119 file, anche dopo gli ultimi reset della ricerca.
- Runner canonico `api general`: **1.513 PASS + 4 SKIP esterni**, 139 file;
  runner PostgreSQL **24 PASS**, fresh/replay e ledger **60/60**.
  Evidenze `/private/tmp/enti03-bolle-api`.
- Runner canonico `browser m4a-documenti-destinatari.spec.ts`: **8 PASS**,
  **32 SKIP** previsti sulle repliche non desktop dei lifecycle mutativi.
  Il caso BUG17 verifica entrambi i pulsanti, cambio da territoriale a soli
  globali, ricerca azzerata, query con ambito e Area corretti, toggle, magazzino
  mantenuto e Bolla con snapshot territoriale. Nessuna asserzione rimossa.
  Evidenze `/private/tmp/enti03-bolle-browser`. API/browser in sequenza con lock,
  PostgreSQL temporanei attestati, soli dati sintetici e cleanup completato.
- API e WEB ricompilate entrambe da archivio del checkpoint. Budget entry
  **399,4/400 KiB gzip**, `index-m5w0eH1i.js`, soglia invariata.

Backup completo DB/uploads con SHA-256 e indici archivi verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/ENTI-GLOBALI-BOLLE-fa96bc4fa8c9-2026-10-19T17-08-11-269Z`.
Nessuna nuova migration o modifica API/OpenAPI; ledger personale prima/dopo
**60/60**, zero pending/checksum difformi/mancanti/fuori ordine.
`restoreTested=false` per questo backup; nessun ripristino nuovo dichiarato.
Ricreati soltanto API/WEB dopo confronto Compose delle sole immagini/revisioni;
PostgreSQL, avvio e volumi DB/uploads invariati. Impronte di Enti, Bolle,
Richieste, lotti, movimenti, prenotazioni e audit uguali al backup.

- API `magazzino-bugfix-uat-api:sha-fa96bc4fa8c9`, image ID `sha256:80075ac5d7c5397f37c8da628bbe19178fd251ae30f12a64984f2713392cdc73`.
- WEB `magazzino-bugfix-uat-web:sha-fa96bc4fa8c9`, image ID `sha256:a825b4752371e1d4d9fdc63ebe0bbdbdf68a2249ec89d08313585b3dfd29aabc`.
- Revision immagini/container uguale al checkpoint; API healthy.
- HTTP root/config/healthz/readyz **200**, Utenti senza sessione **401**.
- Confronto SHA-256 dei contenuti HTTP con i file della nuova build: PASS per
  `enti-esterni-DX1m-Mab.js` e `documento-operativo-C_HAZiOi.js`. Entry HTML aggiornata; verificata quindi
  anche la versione realmente servita dei componenti Enti e documento comune.

Ricaricare la 8082 con ⌘⇧R per la nuova prova. Nessun dato personale modificato
dalle verifiche funzionali, nessuna fase 04/merge/main/produzione avviata.
Consegna 02 resta chiusa; BUG17 attende la UAT integrata del blocco C dopo 04.
Quattro documenti locali preesistenti esclusi dai commit.


### Correzione BUG17 — ambito esplicito e tag degli Enti Esterni

Chiarimento di Floriano: i destinatari sono Enti Esterni (case famiglia e altri
enti assistiti). L'anagrafica Fornitori deve rimanere invariata. Le modifiche
preparate su Fornitori, relativi test/API/OpenAPI/generati e traduzioni sono
state interamente ripristinate, senza commit né installazione. Il controllo
automatico ha respinto il tentativo di commit alla ricezione del chiarimento;
nessun successivo tentativo di includere tali file.

- `/enti-esterni` → Nuovo Ente: controllo **Globale** esplicito, oltre alla
  scelta esistente nel selettore Area. Una spiegazione chiarisce che l'Ente
  destinatario è utilizzabile in tutte le Aree. Creazione riservata all'Admin
  globale secondo le autorizzazioni già presenti.
- L'Ente con Area NULL ha il tag **Globale** accanto alla denominazione.
  Apertura in modifica e salvataggio mantengono l'ambito globale.
- Conservati nell'anagrafica Enti i filtri **Solo globali**, **Tutte le Aree e
  globali** e singola **Area incl. globali**. Il controllo appartiene a questa
  pagina; viene rimosso dal form condiviso Nuova Bolla.
- Nella Bolla il selettore continua a proporre Enti destinatari dell'Area del
  magazzino e globali, con indicazione Globale già presente; nessuna fusione
  tra Enti e Fornitori. Le indicazioni precedenti sul toggle Solo globali
  dentro il documento operativo sono sostituite da questo chiarimento.

File modificati: `artifacts/magazzino-solidale/src/pages/enti-esterni.tsx`,
`artifacts/magazzino-solidale/src/lib/i18n/namespaces/entiEsterni.ts`,
`artifacts/magazzino-solidale/src/components/documento-operativo.tsx`,
`artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`,
`artifacts/magazzino-solidale/src/pages/enti-esterni.test.tsx` e questo
registro. Il test unitario verifica ora l’Area prima della denominazione,
il controllo Globale e la sua assenza per il profilo territoriale, senza
dipendere dall’essere il primo elemento DOM del form. Nessuna modifica al database, alle API, a OpenAPI o ai generati.
Le verifiche e la ricompilazione API/WEB 8082 effettive sono riportate nella
ricevuta successiva. Nessun avvio della fase 04.


### Ricevuta — Enti destinatari globali, 8082 aggiornata dopo il chiarimento

Checkpoint applicativo **`451a21b86ca2b67e0ea8b61a6fc14a78dd093ced`**. Il form Ente espone il controllo Globale;
il tag resta dopo modifica e salvataggio. Filtri anagrafici tutti / globali /
Area incl. globali. Nessun pulsante Solo globali nelle Bolle: il selettore
propone automaticamente Enti dell'Area e globali. Il codice dell'anagrafica Fornitori
e i suoi tipi/client/API/OpenAPI sono invariati rispetto
al checkpoint precedente `4b94c12d9f625d7ac637858ad2e67b5dc043887b`.

- `pnpm install --frozen-lockfile` con `CI=true`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS. Suite UI finale **756 PASS / 119 file**;
  aggiornato il test che assumeva l'etichetta Area come primo nodo del form,
  ora verifica l'ordine rispetto alla denominazione e il nuovo controllo.
- Runner canonico sullo stato finale `api general`: **1.513 PASS + 4 SKIP**,
  139 file; PostgreSQL runner **24 PASS**, fresh/replay/finale **60/60**.
  Evidenze `/private/tmp/enti03-definitivo-api`. Questa esecuzione segue il
  ripristino completo dei file Fornitori e la fine del browser precedente.
- Runner canonico `browser m4a-documenti-destinatari.spec.ts`: **8 PASS +
  32 SKIP** intenzionali delle repliche non desktop dei lifecycle mutativi.
  Nuova prova reale: controllo Globale, persistenza NULL, tag, modifica senza
  perdere l'ambito, solo globali esclude i locali, Area e tutti includono
  l'Ente globale, Bolla senza pulsante, scelta prima locale poi globale e
  magazzino/snapshot territoriale preservati. Regressioni Beneficiario,
  idempotenza, prenotazioni, PDF, snapshot e Trasferimenti eseguite.
  Evidenze `/private/tmp/enti03-definitivo-browser`. Il checkpoint browser
  `c5c172fc322f0f1ecc9d154b6d8adb368371074a` contiene gli stessi file applicativi
  del candidato installato; il successivo commit aggiunge solo test UI/registro.
- API/browser eseguiti in sequenza con lock e database temporanei attestati,
  soli dati sintetici, cleanup completato. Nessun test funzionale sui dati 8082.
- API e WEB ricostruite da `git archive` del checkpoint installato, label SHA
  complete controllate; budget entry **399,6/400 KiB gzip**, soglia invariata.

Backup DB completo/uploads, SHA-256 e indici degli archivi verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/ENTI-DESTINATARI-GLOBALI-451a21b86ca2-2026-10-19T17-24-19-670Z`.
Nessuna nuova migrazione: ledger personale prima/dopo **60/60**, zero pending,
checksum difformi, file mancanti o fuori ordine. `restoreTested=false` per questo
backup; non viene dichiarato un nuovo ripristino. PostgreSQL stesso container,
stesso avvio e stessi volumi DB/uploads. Ricreati solo API e WEB dopo confronto
Compose delle sole immagini/revisioni. Impronte identiche al backup per
Fornitori, Enti, Bolle, Richieste, lotti, movimenti, prenotazioni e audit.

- API `magazzino-bugfix-uat-api:sha-451a21b86ca2`, image ID `sha256:5539ca8c194ba9c5ccb38d23e3721f2277ff90d4b2fbcce766a7b569b22d685e`.
- WEB `magazzino-bugfix-uat-web:sha-451a21b86ca2`, image ID `sha256:9d6490f8f59f70aa7f0ec79855fd76f96a3375ff3d41a66dbec3eada5e2765df`.
- Revisioni container e immagini uguali al checkpoint; API healthy.
- HTTP root/config/healthz/readyz **200**, Utenti senza sessione **401**.
- Entry `/assets/index-BC1oj0d6.js`. SHA-256 HTTP uguali ai file della nuova
  immagine per `enti-esterni-BtVaBoN7.js` e `documento-operativo-CEHMz4vX.js`; nel primo verificati
  `ente-global` e la spiegazione, nel secondo assenza del riferimento al
  pulsante `entiEsterni.onlyGlobal`.

Percorso di prova: `http://localhost:8082/enti-esterni`, ricaricare con ⌘⇧R.
Admin globale → Nuovo Ente → Globale; verificare tag, filtri e disponibilità
in Nuova Bolla dell'Area. Consegna 02 resta chiusa. Nessuna fase 04, merge,
main o produzione avviata; quattro documenti locali preesistenti esclusi.


### Estensione autorizzata BUG17 — Fornitori locali e globali

Floriano richiede ora esplicitamente di ripristinare le modifiche ai Fornitori,
con impostazione coerente agli Enti Esterni, chiarendo che il Fornitore non è
il destinatario di una Bolla. Questa richiesta sostituisce il precedente
vincolo di lasciare invariata l'anagrafica Fornitori; i comportamenti degli
Enti Esterni e delle Bolle già installati restano conservati.

- Fornitori e Donatori: controllo **Globale**, scelta dell'Area per i locali,
  indicazione di utilizzo in tutte le Aree e tag **Globale** accanto al nome.
  Il form richiede di scegliere esplicitamente un'Area o Globale. Modifica
  e salvataggio conservano l'ambito assegnato.
- Stessi filtri degli Enti: **Solo globali**, **Tutte le Aree e globali**,
  **singola Area incl. globali**. Anche il profilo territoriale può filtrare
  i globali, restando limitato alla propria Area quando sceglie i locali.
- I carichi propongono automaticamente i fornitori locali dell'Area e quelli
  globali, ora riconoscibili nel selettore. Nessun collegamento inventato tra
  Fornitori ed Enti destinatari, nessun nuovo pulsante nelle Bolle.
- Nessuna migrazione: Area NULL identifica già un Fornitore globale. Permessi
  esistenti conservati: profili territoriali leggono i globali ma non li
  modificano/disattivano; la loro creazione resta assegnata alla propria Area.
- API GET `/fornitori`: nuovo parametro facoltativo `ambito=tutti|globali`,
  filtro applicato nel database insieme al perimetro autorizzato e con
  validazione dei parametri. Nessun cambiamento ai payload di scrittura.
  OpenAPI aggiornato, client e validatori rigenerati con il comando ufficiale
  `pnpm --filter @workspace/api-spec run codegen`; lockfile invariato.

File coinvolti:
`artifacts/api-server/src/routes/fornitori.ts`,
`artifacts/api-server/tests/scoping-direct.test.ts`,
`artifacts/magazzino-solidale/src/pages/fornitori.tsx`,
`artifacts/magazzino-solidale/src/pages/carico-merce.tsx`,
`artifacts/magazzino-solidale/src/lib/i18n/namespaces/fornitori.ts`,
`artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`,
`lib/api-spec/openapi.yaml`,
`lib/api-client-react/src/generated/api.schemas.ts`,
`lib/api-zod/src/generated/api.ts`,
`lib/api-zod/src/generated/types/{index,listFornitoriParams,listFornitoriAmbito}.ts`
e questo registro. Test e ricompilazione 8082 effettivi sono registrati nella
ricevuta seguente dopo completamento. Prosegue solo il checkpoint 03;
nessun avvio del prompt 04 e nessuna riapertura della consegna 02.


La prova browser Fornitori prepara esplicitamente una seconda Area sintetica,
crea un locale dalla UI e un globale dalla UI, verifica la validazione dell'Area,
la persistenza del tag dopo modifica, i filtri tutti/globali/Area e la selezione
nei carichi di due Aree. Usa il messaggio standard `common.requiredField` del
progetto. Le prime due esecuzioni si sono fermate sulla preparazione della
seconda Area assente nel demo e sull'aspettativa di un messaggio diverso dal
validatore comune; corrette le precondizioni e l'asserzione, senza rimuovere
le verifiche di isolamento. Lo stato finale è verificato dalla nuova esecuzione.


### Ricevuta — Fornitori locali/globali ripristinati e 8082 ricompilata

Checkpoint installato **`ef65e5e4b5a2d5251f6ed550c0a6d7b23bff8084`**. Fornitori e Donatori ora espongono una scelta
Globale esplicita nel form; in alternativa occorre un'Area locale. Il tag
Globale rimane in modifica e salvataggio. Stessi filtri degli Enti: tutti /
solo globali / Area inclusi globali. Nei carichi sono disponibili automaticamente
fornitori attivi dell'Area e globali, con indicazione Globale nel selettore.
Il Fornitore resta distinto dall'Ente destinatario; nessun intervento al form
Bolla né all'anagrafica Enti Esterni di questo checkpoint.

- Installazione `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- Codegen ufficiale `pnpm --filter @workspace/api-spec run codegen`: PASS.
  Nuovo parametro facoltativo `ambito` per GET `/fornitori`; payload di
  scrittura invariati, nessuna nuova migrazione.
- `pnpm run typecheck`: PASS sullo stato finale.
- Suite UI **756 PASS / 119 file**, ripetuta dopo l'ultimo riuso della validazione
  comune. Evidenze `/private/tmp/fornitori04-typecheck.log` e
  `/private/tmp/fornitori04-ui.log`.
- Runner canonico `api general`: **1.521 PASS + 4 SKIP**, 139 file; otto nuove
  prove su filtri, scoping, query malformate, lettura/gestione globale e creazione
  territoriale. Runner PostgreSQL **24 PASS**, fresh/replay/finale **60/60**.
  Evidenze `/private/tmp/fornitori04-api`. I file API, OpenAPI e generati non
  cambiano dopo questa esecuzione; le ultime modifiche sono soltanto UI/test.
- Runner canonico `browser m4a-documenti-destinatari.spec.ts`: **9 PASS +
  36 SKIP** intenzionali delle repliche non desktop dei lifecycle mutativi.
  Evidenze finali `/private/tmp/fornitori04-browser-r3`. Primo caso: due Aree
  sintetiche, validazione Area, creazione UI locale e globale, persistenza NULL,
  tag mantenuto dopo modifica, filtro globali senza locali, Area con globali,
  tutti con locali di entrambe le Aree, selezione globale nei carichi di due
  Aree con esclusione dei locali dell'altra. Altri otto casi: Enti globali e
  Bolle, Beneficiario, retry/idempotenza, prenotazioni, PDF, snapshot,
  Trasferimenti e scelta lotto fisico. Nessuna asserzione di isolamento saltata.
- API/browser eseguiti in sequenza con lock su DB temporanei attestati e soli
  dati sintetici; cleanup completato. I suffissi temporanei `fornitori04-*`
  identificano queste evidenze e non un avvio del prompt 04.
- API e WEB ricostruite dall'archivio Git della SHA installata. Budget entry
  **399,8/400 KiB gzip**, soglia invariata; `index-BLMZBofc.js`.

Backup DB completo/uploads con SHA-256 e indici degli archivi verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/FORNITORI-GLOBALI-ef65e5e4b5a2-2026-10-19T17-40-38-213Z`.
`restoreTested=false` per questo backup senza modifiche di schema; nessun nuovo
ripristino dichiarato. Ledger personale prima/dopo **60/60**, zero pending,
checksum difformi, file mancanti o fuori ordine. Ricreati solo API e WEB dopo
confronto Compose; PostgreSQL mantiene container, avvio e volumi DB/uploads.
Impronte identiche al backup per Fornitori, Enti, Bolle, Richieste, lotti,
movimenti, prenotazioni e audit. Nessuna verifica funzionale sui dati personali.

- API `magazzino-bugfix-uat-api:sha-ef65e5e4b5a2`, image ID `sha256:0913fafd43ec12f622e797eb01a73dd8e6ca88dbec5a4697ff1dbd30cc28a5b2`.
- WEB `magazzino-bugfix-uat-web:sha-ef65e5e4b5a2`, image ID `sha256:77e878b40a08148503706952ba30940372eecb88d6defc1b39f99ede757a3a73`.
- Revisioni immagini/container uguali al checkpoint; API healthy.
- HTTP root/config/healthz/readyz **200**, Utenti senza sessione **401**.
- SHA-256 dei contenuti HTTP uguali ai file della build per:
  `fornitori-0ADIYtwT.js`, `carico-merce-D2M4wRY5.js`,
  `enti-esterni-Bea6E33H.js` e `documento-operativo-C9JzQpMC.js`. Nei Fornitori verificati anche
  controllo `fornitore-global` e filtro `fornitori.onlyGlobal`; nei carichi
  etichetta Globale; nel documento operativo assenza del pulsante Solo globali.

Prova personale: `http://localhost:8082/fornitori`, ricaricare con ⌘⇧R.
Admin globale → Nuovo Fornitore → scegliere Area locale oppure Globale.
Verificare tag, modifica, tre filtri e disponibilità nei carichi. Nessuna fase
04, merge, main o produzione avviata. Consegna 02 resta chiusa; quattro
file documentali locali preesistenti esclusi dai commit.


### Avvio prompt 04 e addendum BUG 21

Floriano ha provato la 8082, approvato il punto 03 e incaricato lo sviluppo
del prompt 04 con addendum BUG 21, chiedendo espressamente ricompilazione
della 8082 per le prove. D02 e D04 sono già approvate; nessuna richiesta di
conferma ripetuta. Perimetro: BUG 05–09 e 21, regressione 17, conservazione
dei controlli sulle date del 02 e dei Fornitori locali/globali del 03.
Nessun avvio 05, merge/main/produzione. Esito UAT 04 ancora da eseguire.

### Implementazione del blocco 04 — BUG 05–09 e 21

- BUG 05: Area prima del Centro e scelte attive coerenti; reset dei dati
  dipendenti e dei suggerimenti al cambio Area. Abilitazione Emporio con motivo
  e permessi esistenti, indipendente da credito, preferenza e tessera. Esiti
  parziali Mensa/Emporio recuperabili sullo stesso ID, invio protetto dal doppio
  click; lettura del diritto prima del retry per recuperare una risposta persa.
- BUG 06: Area/Centro prima della ricerca o scansione. Nuovo lookup minimo
  riservato al comando Bolla, paginato sul server, usabile da Magazzino senza
  accesso al dossier. Tessera trasversale registrata, esatta e valida, senza
  fallback al codice anagrafico. Selezionato conservato fuori pagina, query
  contestualizzate, reset e rifiuto delle risposte tardive. Consegna già
  contestualizzata conservata. Contesto atteso ricontrollato in transazione;
  hash dei vecchi comandi invariato se il campo opzionale non è presente.
- BUG 07: D02 applicata alla lista Richieste, sia dal documento integrato sia
  dal collegamento diretto. Filtri e guardia sulle modifiche conservati;
  nessun annullamento o altra scrittura dal comando Ritorna.
- BUG 08: Pronta riusa il badge blu del documento confermato. Gli avanzamenti
  non vengono confusi con gli stati della richiesta; valore sconosciuto o
  non disponibile non viene tradotto come Bozza.
- BUG 09: scarico manuale Area → Magazzino attivo della stessa Area. Nessuna
  lettura stock prima del contesto e reset di magazzino/righe al cambio Area.
  Rimosso soltanto il Centro manuale e il campo inviato; derivazione server,
  storico, FEFO e controlli sulle quantità conservati.
- BUG 21: route esplicita `/uds/anagrafica/:id` con ritorno filtrato persistente.
  Stati Emporio/Mensa compatti, senza comandi o query delle Richieste/accessi
  nella vista UDS e nella Modifica, anche per profili amministrativi/misti.
  La vista ordinaria CdA conserva le funzioni autorizzate della stessa persona.
  Centro/Zona modificabili con PATCH minime e versione, valori imposti dal
  profilo rispettati, Zona corrente inattiva conservata e directory invalidate.
  Sezione Tessera sempre riconoscibile: prima emissione soltanto su comando
  esplicito, anche per provvisori senza Centro; recupero serializzato sulla
  persona, token/data/ID stabili, nessuna riattivazione o sostituzione implicita.
  PDF CR80 con token reale e giorno di emissione registrato in Europe/Rome.

Impatto del contratto: cinque endpoint circoscritti e un campo opzionale
`contestoBeneficiarioAtteso` in BollaInput. OpenAPI e client/Zod rigenerati con
`pnpm --filter @workspace/api-spec run codegen`; rimozione della collisione
tra tipo query e validatore nel postprocessore ufficiale. Nessuna nuova
colonna, migration o modifica ai dati preesistenti prevista. Le capacità UDS
non conferiscono la gestione generale Mensa o sostituzione/revoca tessere.

Verifiche automatiche e ricevuta 8082 vengono completate sotto dopo l'esito
reale. Un timeout del browser e quattro timeout di avvio worker UI durante
un'esecuzione concorrente sono esclusi dagli esiti validi; le suite vengono
ripetute separate. Nessuna modifica ai tempi limite o ai gate per nasconderli.

Prova personale prevista sulla nuova 8082:

1. Beneficiari → Nuovo: Area prima del Centro; cambiando Area si svuotano le
   scelte dipendenti. Provare abilitazione Emporio con motivo, anche insieme
   a Mensa se autorizzata; l'esito parziale deve mantenere la stessa persona.
2. Bolle → Nuovo documento → Beneficiario: selezionare Area e Centro, poi
   ricercare una persona o scansionarne la tessera. Una tessera di altro
   Centro, scaduta/sospesa/revocata o un semplice codice anagrafico non registrato
   come tessera viene rifiutato senza cambiare i selettori.
3. Richieste → documento: verificare Pronta blu e Ritorna alle Richieste,
   mantenimento dei filtri e nessun annullamento della pratica.
4. Scarico manuale: Area → Magazzino, senza Centro manuale. Cambiando Area
   magazzino e righe si azzerano; conferma e quantità restano protette.
5. UDS → Anagrafica → Nuova persona provvisoria: aprire la scheda UDS,
   scaricare e ristampare la tessera, assegnare Centro e poi Zona; cambiare o
   rimuovere Zona. Controllare nome/tag nell'elenco e dopo riapertura/refresh.
6. Nella scheda UDS e Modifica vedere soltanto gli stati dei servizi e nessun
   comando Emporio/Mensa/Richieste. Entrando dalla scheda CdA della stessa
   persona, verificare le normali funzioni autorizzate.
7. Regressione 17: Enti locali/globali nei documenti e filtro/tag nell'anagrafica;
   Fornitori locali/globali disponibili soltanto nei carichi pertinenti.

Queste prove sono parte della consegna funzionale 04; non aggiungono una nona
consegna né una settima UAT. Nessun avvio del prompt 05 prima dell'OK di Floriano.

### Controlli del candidato 04

- `pnpm install --frozen-lockfile`: PASS; lockfile invariato.
- `pnpm --filter @workspace/api-spec run codegen`: PASS, postprocessore incluso.
- `pnpm run typecheck`: PASS.
- `pnpm --filter @workspace/magazzino-solidale run test --maxWorkers=2`:
  **764 PASS, 119 file**, compresi recupero del PDF, vista UDS anche in Modifica,
  Zona storica inattiva e PATCH minima, invio doppio/esiti parziali dei servizi,
  ritorno alla lista e badge Pronta/stato sconosciuto.
- API, runner canonico `scripts/quality-gates-run.mjs api`: **1.938 PASS +
  4 SKIP esterni**, gruppi core 79, general 1.521, mensa 108, emporio 230.
  Evidenze: `/private/tmp/blocco04-api-core-final` e
  `/private/tmp/blocco04-api-4`. Core ricreato e rieseguito dopo l'aggiunta del
  caso fuori Area. I quattro skip riguardano originali AGEA/SIFEAD/FSE+
  esterni al repository; nessun caso del blocco aggiunto è saltato.
- Browser canonici: 9 PASS Bolle/destinatari e regressione 17, 4 PASS Magazzino,
  10 PASS Richieste su cinque viewport, 2 PASS Sociale (compreso Emporio con
  risposta persa e doppio invio), 3 PASS UDS (compresa scheda provvisoria,
  doppio PDF, PATCH, refresh/ritorno ed esame della larghezza mobile).
  **28 PASS + 72 SKIP intenzionali della matrice**, senza retry passato come
  esito pulito. Evidenze in `/private/tmp/blocco04-browser-4` per Bolle e
  Magazzino, `/private/tmp/blocco04-browser-6` per Sociale e
  `/private/tmp/blocco04-browser-final` per Richieste/UDS dopo il controllo bundle.
- Build WEB locale PASS; budget di ingresso **399,9/400 KiB gzip**. Budget
  invariato: testi degli avanzamenti spostati nel registro caricato con il
  modulo documentale. I percorsi e i permessi distinti UDS restano espliciti.
- `git diff --check`: PASS. Nessuna modifica a package/lockfile, migrazioni,
  configurazione ambienti, credenziali o asset temporanei tracciata.

Le verifiche DB/browser usano soltanto stack temporanei attestati con lock,
checksum delle migrazioni e rimozione finale. Le suite non vengono eseguite
sulla 8082 personale. La ricevuta di installazione riporterà SHA delle immagini,
backup, ledger, stato dei container e confronto degli asset serviti via HTTP.

### File del blocco 04

Elenco completo dei sorgenti, test, contratto, derivati rigenerati e registro
inclusi nel candidato; esclusi i quattro documenti locali preesistenti.

- `artifacts/api-server/src/lib/bollaBeneficiariLookup.ts`
- `artifacts/api-server/src/lib/mensaEligibilitySummary.ts`
- `artifacts/api-server/src/lib/tesseraBeneficiarioService.ts`
- `artifacts/api-server/src/routes/beneficiari.ts`
- `artifacts/api-server/src/routes/bolle.ts`
- `artifacts/api-server/src/routes/mensa.ts`
- `artifacts/api-server/tests/m67-p4-uds-revocation.test.ts`
- `artifacts/api-server/tests/mensa.test.ts`
- `artifacts/magazzino-solidale/e2e/m4a-documenti-destinatari.spec.ts`
- `artifacts/magazzino-solidale/e2e/magazzino-workflows.spec.ts`
- `artifacts/magazzino-solidale/e2e/sociale-workflows.spec.ts`
- `artifacts/magazzino-solidale/e2e/uds-workflows.spec.ts`
- `artifacts/magazzino-solidale/src/App.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiari-provvisori.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-combobox.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-emporio-card.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-tessera.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-uds-tools.tsx`
- `artifacts/magazzino-solidale/src/components/documento-operativo-access.test.tsx`
- `artifacts/magazzino-solidale/src/components/documento-operativo.tsx`
- `artifacts/magazzino-solidale/src/components/uds-anagrafica-pagination.test.tsx`
- `artifacts/magazzino-solidale/src/components/uds-persona-sheet.test.tsx`
- `artifacts/magazzino-solidale/src/components/uds-persona-sheet.tsx`
- `artifacts/magazzino-solidale/src/lib/beneficiario-mensa-workflow.test.ts`
- `artifacts/magazzino-solidale/src/lib/beneficiario-mensa-workflow.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco04.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/richiesteMagazzino.ts`
- `artifacts/magazzino-solidale/src/lib/m5c2a-r2-navigation.test.ts`
- `artifacts/magazzino-solidale/src/lib/richiesta-documento-navigation.ts`
- `artifacts/magazzino-solidale/src/lib/tessera-pdf.ts`
- `artifacts/magazzino-solidale/src/lib/uds-persona-context.ts`
- `artifacts/magazzino-solidale/src/pages/beneficiari.tsx`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `artifacts/magazzino-solidale/src/pages/richieste-magazzino.test.tsx`
- `artifacts/magazzino-solidale/src/pages/richieste-magazzino.tsx`
- `artifacts/magazzino-solidale/src/pages/scarichi.tsx`
- `artifacts/magazzino-solidale/src/pages/uds-anagrafica.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/scripts/fix-binary-upload.mjs`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/beneficiarioServizioStatoUds.ts`
- `lib/api-zod/src/generated/types/beneficiarioStatiServiziUds.ts`
- `lib/api-zod/src/generated/types/bollaBeneficiarioCandidato.ts`
- `lib/api-zod/src/generated/types/bollaBeneficiarioContestoAtteso.ts`
- `lib/api-zod/src/generated/types/bollaInput.ts`
- `lib/api-zod/src/generated/types/bollaTesseraLookupInput.ts`
- `lib/api-zod/src/generated/types/getBollaBeneficiarioConsegnaParams.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/listBollaBeneficiariCandidatiParams.ts`

### Ricevuta di installazione 04 sulla 8082

Candidato applicativo **`5efbe5eeed7343cbe7f286821a3d6ffeaed57873`**, branch
`codex/bugfix-uat-ottobre-2026`. Il successivo commit della ricevuta modifica
soltanto questo registro e non cambia il contenuto delle immagini installate.

Le immagini sono state costruite da `git archive` della SHA esatta, escludendo
file locali e documenti preesistenti. Rigenerazione API dopo il commit:
nessuna differenza nei derivati tracciati. Workflow verificato: push di questo
branch non avvia deploy; nessun merge o push su main e nessun accesso mutativo
alla produzione. Il prompt 05 resta da attivare dopo l'OK UAT di Floriano.

- `/magazzino-api`: immagine `magazzino-bugfix-uat-api:sha-5efbe5eeed73`, ID `sha256:cc401246dc00f6a7bdb61bbddbfea749cabf5be7afe99988543ce250b9f6b3a3`; stato healthy.
- `/magazzino-web`: immagine `magazzino-bugfix-uat-web:sha-5efbe5eeed73`, ID `sha256:754fcf99416644082143d9f88d81274c4660c3f01d7ab3eb950ede076219fb24`; stato healthcheck non previsto.
- `/magazzino-postgres`: immagine `postgres:16-alpine`, ID `sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`; stato healthy.

API e WEB hanno la label di revisione uguale al candidato. PostgreSQL conserva
ID e ora di avvio precedenti; volumi pgdata e uploads conservati. Il preflight
e il controllo finale del ledger confermano **60/60**, zero pending, checksum
difformi, file mancanti o fuori ordine. Nessuna nuova migration per il blocco 04.

Backup privato precedente al recreate: `/Users/florianocaprio/Backups/Magazzino-Solidale/BLOCCO04-UDS-5efbe5eeed73-2026-10-19T21-08-21-045Z`.
Dump PostgreSQL custom e archivio uploads hanno indice verificato e SHA-256
registrati nel preflight privato. Non è stato eseguito un restore di prova
(`restoreTested=false`); non si effettua qui una modifica di schema. Catena
Compose effettiva letta dal WEB e riprodotta, cambiando soltanto immagini,
label di revisione e versione sorgente del runner API. Override di rollback
con immagini, label e versione sorgente precedenti conservato nel backup.

Confronto prima/dopo invariato per Beneficiari, nucleo, tessere, abilitazioni
Mensa/Emporio, interventi, Bolle, Richieste, Enti/Fornitori, Lotti, Movimenti,
Prenotazioni e audit. Nessun dato dimostrativo o test mutativo introdotto
nel database personale.

HTTP verificato: `/`, `/config.js`, `/api/healthz`, `/api/readyz` → 200;
`/api/utenti` senza sessione → 401. Entry `/assets/index-FUhdW7Up.js`.
**Initial entry index-FUhdW7Up.js: 1435.6 KiB, 399.9 KiB gzip**. Asset di Beneficiari, scheda UDS, directory UDS,
creazione UDS, Scarichi, Richieste, documento comune e testi Blocco04 confrontati
via SHA-256 tra immagine e HTTP. Conservati e verificati anche gli asset della
regressione Enti/Fornitori e dei Carichi; assenza di Solo globali nella Bolla.

Esito tecnico della consegna 04: **PASS mirati e INSTALLATA sulla 8082**.
**UAT personale ancora DA ESEGUIRE**: ricaricare `http://localhost:8082` con
⌘⇧R e svolgere la checklist sopra. Nessuna chiusura automatica dei BUG 05–09/21
e nessun trasferimento dell'OK del punto 03 alla nuova UAT integrata.

## Correttivo 04 — tessera e codici beneficiari configurabili, 19 ottobre 2026

Richiesta diretta di Floriano dopo la stampa delle 23:16: separare la data dagli
altri dati e configurare il codice automatico del beneficiario in Super Admin
con la stessa interfaccia delle matricole volontari. Il blocco 04 rimane in UAT;
nessuna attivazione del prompt 05.

- **Stampa:** codice anagrafico leggibile al posto del token casuale nella riga
  Codice. La data originale della tessera è a Y=36 mm, sotto a codice/CF; il logo
  occupa al massimo gli ultimi 10 mm verticali. Adattamento del testo allo spazio.
  QR e barcode continuano a contenere esattamente il token registrato, anche
  legacy: nessuna riemissione o sostituzione implicita. Il barcode non ripete più
  il token casuale come testo. Nome file derivato dal codice anagrafico.
- **Super Admin → Configurazione ambiente → Codici automatici beneficiari:**
  pannello accanto alle matricole permanenti, stessi controlli per prefisso,
  codice Area (con fallback alla sigla), segmento, separatore, cifre, partenza e
  ambito globale/per Area; anteprima durante la modifica e versione salvata.
  Stato di caricamento/errore e salvataggio disabilitato finché la regola non è
  disponibile. Accesso GET/PUT riservato ai Super Admin.
- **Generazione:** applicata ai nuovi beneficiari senza codice manuale, compresi
  creazione condivisa Sociale/UDS, bulk e import FSE. Default `BEN-000001`,
  progressivo globale a sei cifre. Contatore e persona sono nella stessa
  transazione; lock condiviso con il cambio regola, collisioni saltate e rollback
  senza consumo del numero. Esaurimento gestito come conflitto esplicito.
  Codici preesistenti, tessere e matricole volontari non vengono riscritti.
- **Schema:** migration append-only `20261019_zz_codici_beneficiari.sql`, due
  tabelle nuove (`configurazioni_codici_beneficiari` e
  `progressivi_codici_beneficiari`), una configurazione iniziale e nessun nuovo
  contatore fino alla prima creazione. Nessuna modifica alle colonne esistenti:
  il codice resta entro 20 caratteri, validazione preventiva che riserva fino a
  otto caratteri al codice Area. Upgrade ledger atteso 60→61.
- **Contratto:** GET/PUT `/super-admin/configurazione-codici-beneficiari`, DTO
  dedicati OpenAPI e client/Zod rigenerati soltanto dal comando ufficiale.
  Nessuna modifica ai contratti di scansione, ai token o alle autorizzazioni Bolle.

Verifiche eseguite:

- `pnpm install --frozen-lockfile`, codegen ufficiale e `pnpm run typecheck`: PASS.
- Runner API canonico, database Docker temporanei attestati e rimossi, gruppi
  core/general/mensa/emporio: **1.945 PASS**, quattro SKIP preesistenti per file
  originali AGEA/FSE non disponibili. Inclusi sette test nuovi per RBAC,
  versioni/audit, indipendenza volontari, concorrenza, perimetro Area, collisioni,
  lunghezza, rollback e progressivo esaurito. Evidenze private
  `/private/tmp/tessera-api-1`.
- UI: **768 PASS in 121 file**. Dopo il collegamento accessibile delle etichette,
  ripetuti i tre file coinvolti: **9 PASS**. Verificati codice umano/token
  distinti, data originale più in basso, compatibilità legacy, anteprima,
  payload della configurazione e gestione del caricamento fallito.
- Nessuna suite funzionale eseguita sul database personale 8082. Quattro file
  documentali locali preesistenti conservati, esclusi dai commit e confrontati
  per SHA-256.

Prova manuale sulla 8082:

1. In Super Admin → Configurazione ambiente, aprire **Codici automatici
   beneficiari**, configurare ad esempio prefisso `AIM`, codice Area attivo,
   segmento `B`, cinque cifre e progressivo per Area. Salvare la nuova versione.
2. Creare un nuovo beneficiario senza codice manuale: verificare la regola scelta
   e il progressivo successivo sulla seconda persona. I codici precedenti non
   cambiano quando si salva una regola.
3. Scaricare la tessera: verificare codice leggibile e data sotto ai dati, senza
   sovrapposizioni; ristampare e verificare stessa data e stessa tessera. Provare
   la scansione della tessera precedente: la regola anagrafica non la invalida.

### File del correttivo

- `artifacts/api-server/src/lib/beneficiariCodice.ts`
- `artifacts/api-server/src/routes/beneficiari-fse.ts`
- `artifacts/api-server/src/routes/beneficiari.ts`
- `artifacts/api-server/src/routes/super-admin.ts`
- `artifacts/api-server/tests/beneficiari-codici.test.ts`
- `artifacts/magazzino-solidale/e2e/uds-workflows.spec.ts`
- `artifacts/magazzino-solidale/src/components/beneficiario-tessera.test.tsx`
- `artifacts/magazzino-solidale/src/components/beneficiario-uds-tools.tsx`
- `artifacts/magazzino-solidale/src/components/configurazione-codici-beneficiari.test.tsx`
- `artifacts/magazzino-solidale/src/components/configurazione-codici-beneficiari.tsx`
- `artifacts/magazzino-solidale/src/lib/tessera-pdf.test.ts`
- `artifacts/magazzino-solidale/src/lib/tessera-pdf.ts`
- `artifacts/magazzino-solidale/src/pages/beneficiario-dettaglio.tsx`
- `artifacts/magazzino-solidale/src/pages/super-admin-configurazione-ambiente.tsx`
- `docs/campagna-bug-2026-10.md`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiari.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariAmbitoProgressivo.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariInput.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariInputAmbitoProgressivo.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariInputSeparatore.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariResponse.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariScopeTipo.ts`
- `lib/api-zod/src/generated/types/configurazioneCodiciBeneficiariSeparatore.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/db/src/schema/codiciBeneficiari.ts`
- `lib/db/src/schema/index.ts`
- `lib/db/updates/20261019_zz_codici_beneficiari.sql`

Browser canonico completato su stack sintetici temporanei: M4A destinatari
**9 PASS + 36 SKIP** e UDS **4 PASS + 16 SKIP** (repliche non previste dei
lifecycle mutanti). Verificati salvataggio e ricaricamento della regola da UI,
creazione `UAT-B-0042`, download reale e ristampa senza cambiare token/data o
configurazione volontari. PDF CR80 renderizzato con Poppler e ispezionato:
data, codice, barcode e logo separati. Caso CF coperto anche nel test del
layout, con codice a Y=32,5 e data a Y=36. Evidenze private
`/private/tmp/tessera-browser-3`; nessun PDF o screenshot di prova in Git.

Una prima invocazione browser ha rispettato il lock ancora posseduto dalle
API, senza avviare operazioni; una seconda prova è stata interrotta da un
reload Vite dopo una modifica al file E2E. Traccia: nuova connessione Vite
immediatamente dopo la risoluzione del controllo. Ripetute integralmente le
due suite a sorgenti fermi, nessun retry, timeout o asserzione indebolita.
Codegen ripetuto e confrontato per SHA-256: output byte per byte identico.

### Ricevuta 8082 del correttivo tessera/codici

Candidato installato: `6088327aed83cf7e17f627e3c99b3cdf3917c6e2`. Immagini costruite da archivio Git di
questa SHA; nessun file locale o documento preesistente nel contesto di build.

- /magazzino-api: `magazzino-bugfix-uat-api:sha-6088327aed83`, ID `sha256:918b93eb69261c92c0758e4eff265ca3f2feff195475aeced6869f76fd778964`.
- /magazzino-web: `magazzino-bugfix-uat-web:sha-6088327aed83`, ID `sha256:668d8517963af79a4a8cb5d34e9f1ada013891d86fe1fa09d1855228ffcb8ac2`.

Backup privato completo database/uploads, indici archivi e SHA-256 verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/TESSERA-CODICI-6088327aed83-2026-10-19T21-39-42-017Z`.
Ripristino effettivo su PostgreSQL temporaneo isolato, senza porte esposte né
applicazione, migration runner canonico **60→61 PASS** e replay PASS. Nuova
configurazione iniziale presente, contatori vuoti; impronte complete di 15
tabelle operative/anagrafiche/audit invariate. Archivio uploads estratto per
verificarne il ripristino. Copia del DB e rete temporanee rimosse.
`restoreTested=true`, `businessIntegrityUnchanged=true`.

Ricreati soltanto API/WEB dopo confronto della catena Compose reale (sole
immagini, revisioni e versione sorgente migration). Stesso container/avvio di
PostgreSQL, stessi volumi persistenti. Runner applicato dall'entrypoint;
ledger reale **61/61**, zero pending/checksum difformi/mancanti/fuori ordine.
Impronte delle 15 tabelle preesistenti ancora identiche al backup.

Verifica HTTP: `/`, `/config.js`, `/api/healthz`, `/api/readyz` **200**;
`/api/utenti` anonimo **401**. Entry `/assets/index-SrNFwWT0.js` e tutti i chunk
coinvolti (configurazione, dettaglio beneficiario, UDS, Enti, Fornitori, carico,
Richieste) confrontati per SHA-256 fra immagine e HTTP. Pannello nuovo e modulo
PDF con codice/token distinti presenti. Il verificatore inizialmente aveva
selezionato l'helper `carico-merce-*` anziché la pagina omonima: ora verifica
entrambi i chunk e identifica la pagina per il contenuto atteso; codice
applicativo e immagini invariati. Budget entry **400,0/400 KiB gzip**,
limite invariato, PASS anche sull'immagine Docker.

Le immagini precedenti e l'override di rollback restano nel backup. Con il
ledger 61 non basta riavviare un vecchio runner con 60 file: per un rollback
completo occorre il ripristino coerente del backup verificato. Nessuna
rinumerazione massiva dei beneficiari preesistenti eseguita o richiesta.

Il successivo commit della ricevuta è solo documentale. Resta in attesa
l'OK UAT di Floriano per passare al prompt 05.

## Consegna 05 — blocco D, Carico Merce e dettagli Magazzino, 20 ottobre 2026

Floriano conferma sulla 8082 la chiusura della consegna 04, compreso il
correttivo tessera/codici `6088327`, e incarica il prompt 05 chiedendo
espressamente di ricompilare la 8082. Questa richiesta diretta autorizza la
preparazione personale dopo i controlli, anche se il file 05 la rinvia a un
successivo `##test`. UAT 05 ancora da eseguire da Floriano; nessuna attivazione
06, merge, main, produzione o ampliamento dei permessi.

- **BUG 04:** `formatMagazzinoQuantity` arrotonda il solo testo a due decimali
  esatti, in locale corrente e senza aritmetica floating point sulle stringhe
  decimali. Applicato ai quattro valori dei Lotti fisici, residui delle Raccolte,
  storico carichi, righe registrate/riepilogo della conferma e Giacenze. Mancanti
  e zero distinti; scorta minima assente conserva la cella vuota. Export numerici,
  input, quantità canoniche, precisione 6/9 e criteri di disponibilità invariati.
  Il caso positivo `0.000001` resta disponibile anche se mostrato `0,00`.
- **BUG 10:** soltanto la riga usa **Inserisci Prodotto** e **Rimuovi Prodotto**,
  con chiavi distinte nelle sei lingue. La testata mantiene **Salva bozza**.
  Conservati salvataggio incompleto, rifiuto di valori malformati/negativi,
  selezione delle sole righe complete e immutabilità delle righe registrate.
- **BUG 11/14:** un solo Sheet contiene il selettore esistente, ricerca per
  nome/codice/barcode, prodotti attivi, scanner e requisiti lotto. **Inserire
  altri prodotti**, accanto a Conferma, dipende da `canEditManual` e operazioni
  in corso, non da selezione o motivo del blocco inventariale. Funziona in Bozza,
  Aperta, dopo conferma e ripresa; restrizioni AGEA/SALDO e stati terminali
  conservate. Un solo handler per click/scansioni, guardia contro doppio invio,
  nuova riga identificata tramite `clientId` già nel contratto tipizzato.
  Il focus resta nel pannello/scanner; alla chiusura, dopo rendering e rilascio
  del focus modale, viene mostrata la quantità della nuova riga. Il riferimento
  viene consumato: i refetch non provocano nuovi salti. Draft, versioni e
  riconciliazione cache conservati. Chiusura del pannello esplicita e tradotta.
- **BUG 12 / D03:** **Chiudi Carico** verde e **Sospendi Carico** viola; eliminato
  il solo link Lotti dal footer, mantenuti tab e navigazione. Sospendi esiste
  soltanto per Aperta e richiama il ritorno protetto già usato dalle pratiche,
  senza comandi API né cambi di stato. Applicata la precisazione di Floriano
  «Si deve comportare come avviene adesso con le pratiche Aperte. Se il
  salvataggio fallisce si resta sul form»: salvataggi espliciti e dialogo per
  modifiche non salvate; nessun nuovo autosalvataggio o scarto implicito. Resta
  conserva i valori; lo scarto avviene solo con la scelta esplicita del dialogo.
  Un salvataggio fallito conserva il form e il draft. Chiudi resta il comando
  esistente, impedito con pendenti e senza un'ulteriore contabilizzazione.
- **BUG 13:** unica mappatura di presentazione per lista/intestazione: Bozza
  neutra, Aperta blu, Chiusa verde, Annullata rossa, con testo tradotto e colori
  per entrambi i temi. Stati DB e altri domini invariati.
- **BUG 16:** Prodotto/Quantità si adattano alla larghezza, Aggiungi occupa una
  riga intera e mantiene dimensioni utilizzabili. Menu prodotti confinato al
  trigger e allo spazio verticale disponibile, con nomi lunghi a capo.
  Conservati addRiga, validazione, esclusione dei prodotti presenti e bozza.

Adeguamento minimo dello scanner condiviso: riferimento al pulsante di apertura
per ripristinare il focus alla chiusura del dialogo, necessario quando lo scanner
è nel nuovo pannello. Decodifica, errori, stop della fotocamera e deduplicazione
conservati. Traduzioni `caricoPratiche` caricate assieme alla pagina (unico
consumatore di runtime con i suoi componenti), con registrazione preventiva
nelle sei lingue; nuove etichette nella risorsa lazy `blocco05`. Nessuna API,
OpenAPI, tipo generato, migration, dipendenza o lockfile modificati.

### Prove UAT 05 sulla 8082

1. Creare una pratica manuale su un prodotto di prova con stock iniziale zero.
   Aggiungere una riga dal pannello, quantità 80, **Inserisci Prodotto**: deve
   salvare la riga senza caricare stock. La testata mantiene **Salva bozza**.
2. **Conferma carico** una volta: stato **Aperta** blu, stock 80, righe registrate
   senza azioni di modifica/rimozione. Quantità consultive mostrate come `80,00`.
3. **Sospendi Carico**: ritorno all'elenco, pratica ancora Aperta e stock 80.
   Con valori locali non salvati, verificare il dialogo e **Resta e continua**;
   salvare esplicitamente prima di uscire. Se il salvataggio fallisce, restano
   form e valori digitati: non viene registrata merce.
4. Riprendere la pratica, usare **Inserire altri prodotti** accanto a Conferma,
   aggiungere 20 e salvare la riga: stock ancora 80. Confermare solo la nuova
   riga: stock finale 100, prima riga invariata e nessuna duplicazione degli 80.
5. Con righe pendenti, **Chiudi Carico** deve essere disabilitato. Senza pendenti,
   Chiudi verde porta a **Chiusa** verde, stock ancora 100. Nessuna aggiunta in
   Chiusa senza il comando distinto e motivato di riapertura.
6. Verificare due decimali in Lotti fisici, Raccolte e Giacenze; il tab Lotti
   rimane disponibile. In Approvvigionamenti, da pannello stretto/tablet,
   scegliere un nome prodotto lungo, quantità, Aggiungi e salvare la bozza:
   pulsante interamente visibile e prodotto non più nella lista dei disponibili.

### File modificati nella consegna 05

- `artifacts/magazzino-solidale/e2e/carico-lotti-formal.spec.ts`
- `artifacts/magazzino-solidale/e2e/carico-pratiche-m3a.spec.ts`
- `artifacts/magazzino-solidale/e2e/carico-ux-01.spec.ts`
- `artifacts/magazzino-solidale/src/components/barcode-scanner-button.tsx`
- `artifacts/magazzino-solidale/src/components/carico-merce-tabs.test.tsx`
- `artifacts/magazzino-solidale/src/components/carico-merce-tabs.tsx`
- `artifacts/magazzino-solidale/src/components/giacenze-m1b.test.tsx`
- `artifacts/magazzino-solidale/src/lib/carico-lotti.test.ts`
- `artifacts/magazzino-solidale/src/lib/carico-merce.test.ts`
- `artifacts/magazzino-solidale/src/lib/carico-merce.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/index.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/approvvigionamenti.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco05.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/caricoPratiche.ts`
- `artifacts/magazzino-solidale/src/lib/magazzino-quantity.ts`
- `artifacts/magazzino-solidale/src/pages/approvvigionamenti.tsx`
- `artifacts/magazzino-solidale/src/pages/carico-merce.tsx`
- `artifacts/magazzino-solidale/src/pages/giacenze.tsx`
- `docs/campagna-bug-2026-10.md`

### Verifiche tecniche 05

- `pnpm install --frozen-lockfile`: PASS. `pnpm run typecheck`: PASS sul codice
  finale. Nessun package/lockfile aggiornato.
- UI finale: **781 PASS / 121 file** (`/private/tmp/blocco05-ui-last.log`).
  Inclusi formatter, quattro valori renderizzati, mancanti/zero, residuo minimo
  positivo, locale, stati, draft dopo aggiunta/salvataggio e registrazione lazy
  delle traduzioni nelle sei lingue. Conservate le prove di precisione contabile.
- API via runner canonico, gruppo general ricavato da `plan`: **1.528 PASS +
  4 SKIP esterni**. Compresi `carico-pratiche-m3a` (11),
  `carichi-magazzino-2-0a` (22), `inventory-decimal-2-0a` (7) e
  Approvvigionamenti. Quattro SKIP per originali AGEA/SIFEAD/FSE esterni non
  disponibili, stessi casi già dichiarati nelle consegne precedenti. Evidenze
  `/private/tmp/blocco05-api-1`; backend e database schema non modificati.
- Browser: **22 PASS + 13 SKIP** intenzionali della matrice viewport. Lotti (10)
  e tab (5) in `/private/tmp/blocco05-browser-1`; ciclo M3A (2) ripetuto dopo la
  correzione del focus in `/private/tmp/blocco05-browser-2`; UX/pannello stretto
  (5) finale in `/private/tmp/blocco05-browser-3`. Nessun retry o test indebolito.
  Scenario sintetico 80+20, due sessioni/versione obsoleta, stato Aperta,
  sospensione senza POST/PATCH, guardia sui draft, salvataggio fallito con valore
  conservato, stock finale 100, prime righe intatte, chiusura senza nuovo stock.
  Testati errore/scambio focus scanner nel pannello, aggiunta fallita, ricerca
  conservata e A preservata mentre si salva B. Approvvigionamenti: pulsante
  entro i bordi e almeno 44 px, nome lungo selezionabile, esclusione già aggiunto
  e salvataggio bozza reale su mobile 390 e tablet 820.
- Le prove iniziali UX hanno rilevato focus non ripristinato dal dialogo scanner
  e menu prodotto fuori schermo. Corretti il riferimento al trigger e i limiti
  di larghezza/altezza del solo menu coinvolto: il vecchio valore CSS
  `max-height:--radix-select-content-available-height` non era valido; il limite
  contestuale usa `var(...)`. Ripetuta integralmente la suite UX fino al PASS.
- Build WEB e `build:budget`: PASS; entry `index-uBdnyoiF.js`, **386,5/400 KiB
  gzip**, limite invariato. Un primo budget 400,1 è stato risolto caricando le
  traduzioni del Carico con la pagina, senza eliminarle o aumentare soglie.
- Tutti i test API/browser su PostgreSQL temporanei attestati dal runner, lock
  condiviso rispettato e ambienti rimossi. Nessun test mutativo sulla 8082.
  Quattro documenti preesistenti confrontati per SHA-256 e preservati fuori Git.

### Ricevuta 8082 della consegna 05

Versione applicativa installata: `89e17afe1bf41154e9ed336a987adbbd6143a239`.
API e WEB compilate dai Dockerfile correnti su archivio Git di questa SHA.

- /magazzino-api: `magazzino-bugfix-uat-api:sha-89e17afe1bf4`, image ID `sha256:3fc6af64e8a97d53a22373991ea87044684922b795df96ce175f7ff08508a8db`.
- /magazzino-web: `magazzino-bugfix-uat-web:sha-89e17afe1bf4`, image ID `sha256:46d50fc02a43e33e83ee95d3b51c6d2fc98ecfecdf14c73ba892879a1baa8577`.

Backup privato DB completo (`pg_dump -Fc`) e uploads, SHA-256, indice dump e
archivio tar verificati:
`/Users/florianocaprio/Backups/Magazzino-Solidale/BLOCCO05-CARICO-89e17afe1bf4-2026-10-19T22-21-36-690Z`.
`restoreTested=false`: non è stato eseguito un nuovo restore per questo blocco
senza nuove migration. Il precedente upgrade 60→61 è già documentato nel
correttivo 04. Nessun backup, log, screenshot, PDF o segreto in Git.

Confrontata la catena Compose reale letta dalle label del WEB; sole differenze
consentite immagini, revisioni e versione sorgente migration. Ricreati solo API
e WEB con `--no-deps --no-build`; stesso ID/avvio di PostgreSQL e stessi volumi
DB/uploads. Runner all'avvio: tutte le 61 migration già applicate. Ledger reale
**61/61**, zero pending/checksum difformi/file mancanti/fuori ordine.

Verificate impronte integrali di **24 tabelle** prima/dopo: stock, movimenti,
prenotazioni, pratiche e righe/integrazioni/rettifiche, Approvvigionamenti e righe,
Enti/Fornitori, persone e tessere/servizi, regole codici/progressivi e audit:
**tutte invariate**. Nessuna suite funzionale ha usato il DB personale.

HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz` **200**;
`/api/utenti` anonimo **401**. Entry `index-uBdnyoiF.js`, chunk della pagina e
helper Carico, scanner, Giacenze, Approvvigionamenti e CSS collegati confrontati
per SHA-256 con l'immagine. Verificati anche gli asset Enti/Fornitori e la
presenza delle nuove azioni/etichette. Budget immagine **386,5/400 KiB gzip**,
limite invariato. Ricevuta privata `/private/tmp/blocco05-release-result.json`.

La ricevuta è un successivo commit solo documentale: non cambia il codice
installato. La consegna 05 resta aperta alla UAT di Floriano; prompt 06 non
avviato.

## Correttivo UAT 05 — azioni, apertura pratica e righe contabilizzate, 20 ottobre 2026

Floriano segnala pulsanti di riga fuori dal riquadro, salvataggio poco chiaro,
assenza di correzioni sulle righe già caricate e permanenza nel dettaglio dopo
Chiudi/Sospendi. La richiesta diretta aggiorna il vincolo del prompt 05 sulle
righe registrate: devono essere correggibili senza cancellare movimenti e storico.
La consegna 05 rimane **APERTA ALLA UAT**; nessun avvio del prompt 06.

- Azioni delle righe pendenti su una riga dedicata adattiva, con Rimuovi visibile
  e bordo rosso tenue. Dopo il salvataggio esplicito, o su una riga completa già
  salvata, **Prodotto salvato** grigio disabilitato; modificando un campo torna
  **Inserisci Prodotto**. Rimuovi resta abilitato secondo i permessi esistenti.
  Le bozze incomplete restano salvabili, accompagnate dai campi da completare.
- Prima creazione: **Apertura Pratica**. Dopo la risposta positiva la testata
  viene nascosta, lasciando il contesto Area/Magazzino e **Da caricare a magazzino**.
  **Dati pratica** permette di rivederla; il comando successivo è **Salva modifiche**.
  La sezione delle righe registrate compare solo quando contiene righe.
- **Inserimento prodotti** con icona + e verde tenue; **Annulla Pratica**.
- **Chiudi Carico**, dopo il successo, e **Sospendi Carico** riportano all'elenco
  con Area e Magazzino della pratica, ripulendo ricerca/date/stato che potrebbero
  nasconderla. La chiusura resta bloccata con righe pendenti o modifiche locali.
  Sospendi conserva la protezione esplicita delle modifiche non salvate (D03),
  non contabilizza né cambia lo stato. Un errore resta nel dettaglio.
- Nelle pratiche manuali Aperte, con permessi receive+adjust, le righe registrate
  espongono **Modifica prodotto** e **Rimuovi Prodotto**. Entrambi richiedono una
  motivazione e spiegano lo storno. Rimuovi storna la quantità non ancora stornata;
  Modifica storna e crea **nella stessa transazione** una copia modificabile tra
  le righe pendenti. I nuovi dati vanno salvati e confermati per ricontabilizzarli.
  L'originale resta nello storico con quantità netta e quantità stornata visibili.
  Una pratica Chiusa va prima riaperta con motivo. Nessuna modifica diretta ai
  movimenti, né PATCH/DELETE delle righe registrate.
- Restano i blocchi dell'endpoint esistente: merce già distribuita/prenotata,
  quantità eccedenti e lotti con più provenienze non attribuibili. Le pratiche
  FSE+/saldo iniziale restano nella procedura dedicata.

**Contratto API:** estensione additiva dell'endpoint rettifica esistente:
`ripristinaBozza?: boolean`, risposta `rigaSostitutivaId?: integer` e dettaglio
riga `quantitaRettificata`. Quantità/precisione, idempotenza, versioni, transazione,
audit e controllo disponibilità conservati. Il flag richiede anche receive e
pratica manuale in stato modificabile; il replay restituisce lo stesso ID della
copia. Nessuna migration o modifica allo schema DB. Client e Zod rigenerati
con il comando ufficiale; seconda generazione identica byte per byte.

### Prove manuali aggiornate del correttivo 05

**Superate per le pratiche già chiuse dalla precisazione finale seguente:**
la riapertura consente soltanto nuove aggiunte; non eseguire le prove di
Modifica/Rimuovi sulle righe contabilizzate dopo una chiusura.

1. **Nuova pratica → Apertura Pratica**: dopo il salvataggio deve comparire la
   sezione Da caricare, senza il form della testata e senza storico vuoto.
   Dati pratica riapre il form senza perdere i prodotti digitati.
2. **+ Inserimento prodotti**: aggiungere due prodotti, salvare il primo. Il
   suo pulsante diventa grigio Prodotto salvato, Rimuovi resta attivo e dentro
   il riquadro anche su tablet. Modificare la quantità riattiva Inserisci Prodotto.
3. Confermare 80, sospendere e verificare l'elenco filtrato sul Magazzino/Area
   corretti. Riprendere, aggiungere 20 e confermare: stock 100, nessun duplicato.
   Chiudi torna allo stesso elenco filtrato e conserva stock 100.
4. Riaprire con motivo, **Modifica prodotto** sulla riga 20 e indicare il motivo:
   stock 80, copia pendente 20. Correggerla a 15, salvare (stock sempre 80), poi
   confermare: stock 95. L'originale 20 rimane nello storico come stornato.
5. Provare **Rimuovi Prodotto** su una riga di prova già contabilizzata: dopo
   motivazione viene stornata, conservando lo storico. Provare una quantità già
   impegnata: messaggio di blocco e nessuna modifica parziale.
6. Confermare la permanenza sul form con valori preservati se un salvataggio
   fallisce e il dialogo sulle modifiche locali quando si sospende senza salvarle.

### File del correttivo 05

- `artifacts/magazzino-solidale/src/pages/carico-merce.tsx`
- `artifacts/magazzino-solidale/src/lib/carico-merce.ts`
- `artifacts/magazzino-solidale/src/lib/carico-merce.test.ts`
- `artifacts/magazzino-solidale/src/lib/i18n/namespaces/blocco05.ts` (sei lingue)
- `artifacts/magazzino-solidale/e2e/carico-pratiche-m3a.spec.ts`
- `artifacts/magazzino-solidale/e2e/carico-ux-01.spec.ts`
- `artifacts/api-server/src/routes/carico-pratiche.ts`
- `artifacts/api-server/tests/carico-pratiche-m3a.test.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/caricoPraticaRiga.ts`
- `lib/api-zod/src/generated/types/caricoPraticaRettificaInput.ts`
- `lib/api-zod/src/generated/types/caricoPraticaRettificaResult.ts`
- questo registro.

### Verifiche del correttivo 05

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato. Il primo
  tentativo senza CI era stato interrotto da `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`;
  l'esito positivo è confermato dall'esecuzione successiva non interattiva
  (`/private/tmp/blocco05fix-install-ci.log`), non dal primo tentativo.
- `pnpm run typecheck`: PASS (log finale `blocco05fix-typecheck-postinstall.log`).
- `pnpm --filter @workspace/magazzino-solidale run test --maxWorkers=2`:
  **782 PASS, 121 file**, confermati anche dopo installazione CI (log
  `/private/tmp/blocco05fix-ui-postinstall.log`).
- API, runner canonico `node scripts/quality-gates-run.mjs api general`:
  **1.529 PASS + 4 SKIP, 140 file**, evidenza privata
  `/private/tmp/blocco05fix-api-2`. Le 12 prove di carico passano, inclusi copia
  atomica, permessi, versione concorrente, replay con stesso ID, modifica e nuova
  conferma, storno finale, rollback in caso di audit fallito. Quattro skip per i
  file originali AGEA/FSE+ esterni non disponibili, come nella consegna precedente.
- Browser, runner canonico con le quattro spec già previste: **22 PASS + 13 SKIP**.
  Evidenze valide: `/private/tmp/blocco05fix-browser-1` per Lotti (10 PASS) e
  navigazione tab (5 PASS), `blocco05fix-browser-2` per M3A (2 PASS + 8 SKIP),
  `blocco05fix-browser-3` per UX (5 PASS + 5 SKIP). Skip dei viewport estranei alla
  matrice già prevista, invariati. Verificati bounds e clic Rimuovi, stato salvato,
  draft conservati, errori di salvataggio, testata nascosta/riapribile, filtri al
  ritorno e scenario 80+20=100 seguito da storno 20 → 80 e nuova riga 15 → 95.
- Un primo test API aveva atteso `10.000000` invece della rappresentazione originale
  `10.00`: corretto per confrontare il dato originale letto dall'API, senza
  modificarne precisione o contratto. Due selettori E2E avevano confuso menu e
  campo Approvvigionamenti “Magazzino” con il filtro “Magazzino destinazione”:
  ripristinati i nomi corretti e rieseguite le suite interessate. Nessun aumento
  dei timeout, retry aggiunto o indebolimento dei controlli contabili.
- Build di produzione e budget: **386,6/400 KiB gzip**, entry locale
  `index-DKsxEa49.js`. Contratti rigenerati due volte con impronte identiche.
- `git diff --check`: PASS. I quattro documenti locali preesistenti restano
  inalterati e fuori dai commit. Nessun file `.env`, segreto, log o screenshot
  aggiunto. Test API/browser esclusivamente su DB temporanei, rimossi dal runner.

Installazione 8082 completata nella ricevuta seguente. Nessuna UAT umana
attestata automaticamente.

### Ricevuta 8082 — correttivo UAT 05

Codice installato: `6bf78648b2d2ae733c2a77bd8d7bd0dfd2514a49`. Immagini costruite da `git archive`
del checkpoint, con revisioni OCI e tag immutabili:

- API: `magazzino-bugfix-uat-api:sha-6bf78648b2d2`,
  ID `sha256:bab4fa45bd208f177fc805df9a127fd4dcd18333d27276fde7597f70ecaf118b`.
- WEB: `magazzino-bugfix-uat-web:sha-6bf78648b2d2`,
  ID `sha256:9b1dca776511b299d81e5e2abf757978e077d146699e5840e4fd3d917604f8a3`.

Backup privato precedente all'aggiornamento:
`/Users/florianocaprio/Backups/Magazzino-Solidale/BLOCCO05-CORRETTIVO-6bf78648b2d2-2026-10-19T23-10-22-292Z`.
Dump PostgreSQL custom e archivio uploads verificati mediante indici e SHA-256;
permessi cartella 0700, file 0600. Nessun nuovo restore eseguito (`restoreTested=false`):
non ci sono nuove migration in questo correttivo. Metadati, backup e log restano
fuori Git. Conservato anche l'override di rollback alle immagini precedenti.

Applicata la catena Compose reale, con sole differenze consentite a immagini,
revisioni e versione sorgente migration. Ricreati API e WEB con
`--no-deps --no-build`. PostgreSQL conserva ID, avvio e volume; uploads conserva
il medesimo volume. Ledger **61/61**, nessuna migration pendente o difforme.
Impronte integrali delle **24 tabelle** già elencate nella ricevuta 05 precedenti
e successive **tutte identiche**, inclusi pratiche, righe, rettifiche, stock e audit.

HTTP `/`, `/config.js`, `/api/healthz` e `/api/readyz`: **200**;
`/api/utenti` anonimo: **401**. Entry `/assets/index-DKsxEa49.js`;
budget dell'immagine **386,6/400 KiB gzip**. Asset JS/CSS serviti confrontati per
SHA-256 con l'immagine, compresi Carico, scanner, Giacenze, Approvvigionamenti e
regressioni Enti/Fornitori. Verificata la presenza di Apertura Pratica, Prodotto
salvato, Inserimento prodotti e rettifica delle righe nel codice effettivamente
servito. Ricevuta privata `/private/tmp/blocco05fix-release-result.json`.

Questa ricevuta è solo documentale e non cambia il codice installato. Branch
`codex/bugfix-uat-ottobre-2026`, main e produzione esclusi. Workflow nuovamente
verificato: nessun deploy sul push del branch; zero hook e zero ambienti GitHub.
La consegna 05 resta in attesa dell'OK UAT di Floriano prima del prompt 06.

## Precisazione finale UAT 05 — riapertura con sole aggiunte

Floriano conferma che il resto delle funzionalità è perfetto e richiede un solo
vincolo aggiuntivo: una pratica chiusa, quando viene riaperta, permette di
aggiungere prodotti, senza modificare quantità o rimuovere righe già caricate.
Alla domanda sul seguito chiarisce: **«Completa questa correzione; ti invierò
il prossimo prompt»**. Il prompt 06 resta quindi in attesa del suo invio.

Intervento minimo: l'API ricava `soloAggiunte` dallo stato Chiusa o dagli eventi
storici `CARICO_PRATICA_CHIUDI` / `CARICO_PRATICA_RIAPRI`, già conservati nel DB.
Il vincolo non dipende dalla sessione o dalla memoria del browser. Dopo una
chiusura il comando rettifica rifiuta nuove rimozioni o copie sostitutive, anche
con chiamata diretta all'endpoint e permessi amministrativi. Il controllo è
eseguito nel lock/transazione della pratica; il replay di un comando già concluso
rimane una lettura idempotente e non crea altri movimenti.

L'interfaccia nasconde Modifica/Rimuovi sulle righe contabilizzate quando il
flag non è esplicitamente false. Aggiunta di nuove righe, compilazione/salvataggio
e rimozione delle nuove bozze non confermate, conferma di una nuova integrazione,
Sospendi e Chiudi mantengono il comportamento verificato. Le rettifiche prima
della prima chiusura restano disponibili. Nessun cambiamento a stati o schema DB;
solo il campo opzionale additivo `soloAggiunte` nel dettaglio OpenAPI, con tipi
rigenerati dal comando ufficiale e verifica di riproducibilità.

Copertura aggiunta: API chiude/riapre, rifiuta entrambi i tipi di rettifica,
verifica versione, righe e integrazioni invariate, poi aggiunge e conferma una
nuova riga mantenendo l'originale identica. Browser verifica il blocco anche dopo
reload, aggiunge 15 alle precedenti righe 80 e 20 e verifica 115 senza cambiare
le due quantità originali.

File modificati:

- `artifacts/api-server/src/routes/carico-pratiche.ts`
- `artifacts/api-server/tests/carico-pratiche-m3a.test.ts`
- `artifacts/magazzino-solidale/src/pages/carico-merce.tsx`
- `artifacts/magazzino-solidale/e2e/carico-pratiche-m3a.spec.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/caricoPraticaDettaglio.ts`
- questo registro.

Verifiche sul correttivo:

- `CI=true pnpm install --frozen-lockfile`: PASS, lockfile invariato.
- `pnpm run typecheck`: PASS.
- UI `pnpm --filter @workspace/magazzino-solidale run test --maxWorkers=2`:
  **782 PASS, 121 file**.
- Runner API canonico, gruppo general: **1.530 PASS + 4 SKIP esterni, 140 file**,
  incluse le **13 prove** della pratica di carico. Evidenza privata
  `/private/tmp/blocco05onlyadd-api`.
- Runner browser canonico, `carico-pratiche-m3a.spec.ts`: **2 PASS + 8 SKIP** dei
  viewport già esclusi dalla matrice mutativa. Il controllo del flusso inventariale
  gira su desktop come prima; nessuno skip, timeout o retry modificato.
  Evidenza privata `/private/tmp/blocco05onlyadd-browser`. Le altre spec di
  presentazione non sono state rieseguite: nessuna modifica al loro codice.
- Build produzione e budget: **386,6/400 KiB gzip**, entry `index-D77xZueP.js`.
- Codegen ufficiale eseguito due volte, file generati identici byte per byte.
- `git diff --check`: PASS. Quattro documenti preesistenti conservati e fuori Git.

Installazione 8082 completata nella ricevuta seguente. Nessun test funzionale
ha usato il DB personale.

### Ricevuta 8082 — riapertura con sole aggiunte

Codice installato e verificato: `ad1b1900d95c642adff6f7d25db0f79d4dfa5f40`.
Immagini compilate da `git archive` del checkpoint, con revisioni OCI coerenti:

- API `magazzino-bugfix-uat-api:sha-ad1b1900d95c`,
  ID `sha256:a57df2058dc71a4cd9d57b4e1be42049a29018120f5f2ed448c8140c4e2899e9`.
- WEB `magazzino-bugfix-uat-web:sha-ad1b1900d95c`,
  ID `sha256:6663702707515062a54094d1c62d94383645505253dafa8b6e34c8405861d454`.

Backup privato di DB/uploads e override di rollback:
`/Users/florianocaprio/Backups/Magazzino-Solidale/BLOCCO05-SOLE-AGGIUNTE-ad1b1900d95c-2026-10-20T04-50-45-836Z`.
Archivi verificati tramite indici e SHA-256, cartella 0700 e file 0600. Nessun
nuovo restore eseguito: `restoreTested=false`, nessuna nuova migration.

Ricreati solo API e WEB con la catena Compose reale e `--no-deps --no-build`.
PostgreSQL conserva ID e avvio; DB/uploads conservano i volumi. Ledger **61/61**
senza pending/checksum difformi/file mancanti/fuori ordine. Le impronte integrali
delle **24 tabelle** controllate sono tutte invariate prima/dopo l'installazione.

HTTP `/`, `/config.js`, `/api/healthz`, `/api/readyz` **200**; endpoint Utenti
anonimo **401**. Entry `/assets/index-D77xZueP.js`; budget **386,6/400 KiB gzip**.
JS/CSS serviti confrontati per SHA-256 con l'immagine; il chunk Carico contiene
il controllo `soloAggiunte`. Ricevuta privata
`/private/tmp/blocco05onlyadd-release-result.json`.

Il commit di questa ricevuta è solo documentale: il codice installato resta
quello indicato sopra. Pubblicazione limitata al branch della campagna, senza
main, merge o produzione. Prompt 06 non avviato, come richiesto da Floriano.
