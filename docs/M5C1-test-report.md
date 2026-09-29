# M5C1 — rapporto ##test formale

**Esito tecnico: M5C1 — ##test PASS TECNICO — IN ATTESA DI PUBBLICAZIONE E REVIEW.** Nessuna validazione manuale o pubblicazione è compresa in questo rapporto.

## Candidato e perimetro

- Repository `florianocaprio/Magazzino-Solidale`; branch `codex/magazzino-workflow-unificato`.
- HEAD locale/remota iniziale e finale attesa: `a0c614a1036f05786f423fa9daf4129d3e816acf`, divergenza `0/0`, staging vuoto. Candidato = HEAD + **tutto** il delta M5C1 locale, inclusi gli untracked.
- `origin/main` è rimasto `787d7c5436d5fa4c0edb24be373d055946d402ce`. Il `main` locale era già a `8419dc7ff9d5177c39d90e66f04b19236021244d` all'ingresso; non è stato modificato o riallineato.
- Nessun `.env`, dump, token, password, screenshot o log è nel delta pubblicabile. Lo schema e OpenAPI non cambiano.
- Hash del diff tracciato sotto `artifacts/api-server/src` e `artifacts/magazzino-solidale/src`: `de1032fe555363316e6319ba7d1f06c61ce0a7cb1b74f5d9d4d0efbe3f452610`, identico al preflight. Helper sorgente nuovo `m5c1-request-prefill.ts`: `402aab6339c7072aed28d73fe637d1368ce55ce29c512376edee1e48d630549f`. Migration 45: `a7dce4addda53491d71cb652654d683d73dff098eea6ed732c6db0805afcfe1f`. Nessun codice applicativo o migration è stato cambiato durante `##test`.
- Hash composito SHA-256 dei file di test/harness finali del delta, ordinati per path e combinati dai rispettivi SHA-256: `e6c5222dded1800fff672fdd235d8dd095b43a9987c7fc5320a187316a5def11`.

### Inventario del delta

Tracciati modificati in ingresso: `artifacts/api-server/src/lib/seedRoles.ts`, `src/routes/{bolle,interventi}.ts`, test `audit-centro-ascolto-hardening`, `bolle-prenotazioni`, `interventi-operativita-sociale`, `interventi-preparazione-materiali`, `richieste-magazzino-m5b`, `seed-roles-beneficiari`; frontend `src/components/{intervento-sociale-detail-sheet,intervento-sociale-operativita-editor}.tsx`, `src/components/intervento-sociale-detail-sheet.test.tsx`, `src/lib/{auth.tsx,auth-access.test.ts,magazzino-hardening-ui.test.ts}`, `src/lib/i18n/namespaces/richiesteMagazzino.ts`, `src/pages/{bolle,consegne,interventi,richieste-magazzino}.tsx`.

Untracked M5C1 in ingresso: `artifacts/magazzino-solidale/src/lib/m5c1-request-prefill.{ts,test.ts}`, `docs/M5C1-centro-richiesta-magazzino.md`, `lib/db/updates/20260929_m5c1_centro_handoff.sql`.

Solo test/harness aggiunti o corretti nel collaudo: `artifacts/api-server/tests/m5c1-formal-session.test.ts`, `artifacts/api-server/tests/m5c1-e2e-seed.mjs`, `artifacts/magazzino-solidale/e2e/m5c1-centro-richiesta.spec.ts`, `artifacts/magazzino-solidale/playwright.m5c1-isolated.config.ts`, `lib/db/scripts/m5c1-formal-fixture.sql`, `lib/db/scripts/m5c1-formal-migration.mjs`, `lib/db/scripts/migration-runner.test.mjs`, un'asserzione in `artifacts/api-server/tests/interventi-operativita-sociale.test.ts` e questo rapporto. I test non sono stati indeboliti, skippati o resi retry.

## Gate DB 44→45

**GO.** PostgreSQL 16 reale, effimero, su tmpfs senza volumi. La base è stata estratta dalla SHA pubblicata e portata con runner ufficiale a ledger **44/44** prima del popolamento. Fixture sintetica 44 coerente: ruoli canonici/custom, sette utenti, Interventi/materiali, Bolla/Consegna, Richieste M5A/M5B, stock e movimenti. Snapshot su 19 tabelle: digest pre/post `d05449988f95af4aba01a8d7a47b39d0d51050f6bd787464445f13ad91a05e9b`, conteggi invariati. Solo la migration M5C1 è stata applicata: **1 applicata, 45/45**; secondo run **0 applicate, 45 skipped/verificate**, nessun mismatch.

`Operatore` mantiene `bolle.view` e i permessi extra, perde esattamente `bolle.manage`, `bolle.deliver`, `bolle.cancel`. Operatore Magazzino, ruolo custom, Admin e SuperAdmin restano invariati nel passaggio. L'esecuzione reale di `seedRoles()` dopo la migration non riaggiunge i tre grant. Su DB fresh: **45/45**, secondo run **0 applicate/45 skipped** e `seedRoles()` conferma lo stesso risultato. La migration è solo dati, senza DDL, backfill o mutazioni di utenti/documenti/movimenti.

Il test unitario del manifest migration aveva ancora totale 44 e la lista ordinata terminava a M5B: aggiornato **solo il test** a 45/M5C1. `pnpm --filter @workspace/db run test:migrations`: **10/10** per il manifest. La suite PostgreSQL opzionale di quel file è skip di default senza i suoi flag M5A; le prove PostgreSQL autentiche sopra sono state eseguite separatamente, non considerate coperte dallo skip.

## Gate workflow, autorizzazioni e privacy

**GO.** Test con sessioni HTTP reali e DB 45/45: un Intervento pianificato con data/priorità/sede non crea Richieste, documenti, movimenti o prenotazioni. L'invio esplicito crea una Richiesta `intervento_sociale` in stato `inviata` con beneficiario, priorità e data desiderata; nessun prodotto, quantità, magazzino, lotto o sede sociale è copiato. Seconda richiesta attiva per lo stesso Intervento respinta `409`; richiesta autonoma dal Beneficiario consentita. Il Magazzino legge la Richiesta ma riceve `interventoId=null` e non può leggere il dettaglio dell'Intervento (`403`).

La UI del Centro espone **Richiesta al Magazzino** e passa a **Apri richiesta** dopo l'invio; l'editor non mostra Materiale da preparare, prodotto, magazzino o quantità consegnata inventariale. I materiali legacy restano leggibili come storico. I tentativi API del solo Sociale di PATCH materiale, salvare operatività catalogata o concludere con quantità catalogata sono respinti senza effetti su stock, prenotazioni, Bolla, ricevute o audit di successo. Le regressioni dell'operatività sociale non inventariale, UDS e M5B sono incluse nella suite completa.

Il ruolo Sociale con `bolle.view/manage/deliver/cancel` forzati legge lo storico Bolla ma riceve `403` su creazione, modifica, righe, conferma, affida, consegna e annulla; conteggi di Bolla/righe/movimenti/prenotazioni/ricevute/audit invariati. Verificati anche grant legacy aggiunti **a sessione già aperta**, nuova sessione, revoca Area Magazzino nella stessa sessione e disattivazione utente. Ruolo misto Sociale+Magazzino, Operatore Magazzino, Admin scoped e Admin globale conservano le operazioni autorizzate; l'Admin scoped non attraversa l'Area. La suite M5B/R2/R3 completa preserva presa in carico, Bolla contestuale, delega/replay e scope. Pianificazione Consegne mostra una consegna sintetica ma non offre **Crea bolla** al solo Sociale; `/bolle` resta consultiva anche con vecchi grant.

## Suite e build

| Controllo                                               | Esito                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| API M5C1 sessione reale                                 | 5/5 PASS sul DB effimero finale                                                                                        |
| API completa single-worker dopo ultimo cambiamento test | 129 file, 1.473 PASS, 4 skip storici, 0 FAIL, exit 0                                                                   |
| Frontend completa                                       | 84 file, 447/447 PASS                                                                                                  |
| E2E M5C1 Linux browser                                  | 10/10 PASS, cinque viewport: mobile 390, tablet 768/1024/820, desktop 1440                                             |
| Typecheck workspace finale                              | PASS                                                                                                                   |
| Build Linux API                                         | PASS, immagine temporanea dal candidato                                                                                |
| Build Linux WEB e budget                                | PASS; entry 1360,9 KiB / 376,9 KiB gzip, script budget exit 0                                                          |
| Codegen Orval deterministico                            | PASS in container isolato; hash generati prima/dopo `57ef0fbbd95f24f3f992e532267cdd9e30c7366a2282101003f7e19a5d6560d5` |
| Prettier su tutti i file TS/TSX/MJS/MD del delta        | PASS                                                                                                                   |
| `git diff --check`                                      | PASS                                                                                                                   |

Quattro skip API preesistenti sono prove condizionali su workbook di accettazione esterni non disponibili nell'ambiente sintetico: `fse-import-parser-m3b`, `fse-import-practice-m3b`, `agea-sifead-parser`, `agea-import`. Non sono prove M5C1 trasformate in skip. Nessuna prova manuale è stata dichiarata eseguita. La build macOS non è stata usata per superare il gate Linux.

### Cronologia delle failure di harness

- Primo test di sessione: la POST Richiesta restituisce per contratto un riepilogo; il test ora legge il DTO completo tramite GET. Nessun sorgente prodotto modificato.
- Prima API completa: un'asserzione M5C1 cercava `movimenti.entitaOrigineId` senza tipo/dominio e collideva con altri ID di documento nel DB comune. Vincolata ai movimenti sociali `intervento_materiali_%`; il test mirato è passato e l'intera API è stata rieseguita con **129 file/1.472 PASS/4 skip** prima dell'ultima estensione del test sessione.
- Primo E2E: fixture priva di SuperAdmin mostrava il bootstrap; aggiunto un amministratore sintetico. Poi le chiamate HTTP dirette Playwright mancavano dell'header Origin, la Consegna era fuori dal filtro date predefinito e un locator testuale era ambiguo tra i due layout responsive. Corretti solo seed/config/locator; rerun finale **10/10 PASS** senza skip/retry.
- Dopo il rerun E2E, nel solo preflight dello script seed è stata sostituita una stringa di connessione sintetica hard-coded con controlli equivalenti sui componenti dell'URL, per evitare credenziali nel delta. Fixture, browser test e codice applicativo sono invariati; `node --check` e Prettier dello script finale PASS. L'E2E non è stato rieseguito dopo questa modifica non funzionale all'harness.
- Primo controllo budget in container non aveva `BASE_PATH`; ripetuto con ambiente WEB corretto e risultato PASS. Il manifest migration test attendeva 44; aggiornato solo harness e risultato 10/10.

## Evidenze, risorse e stato finale

Evidenze sintetiche senza credenziali in `/Users/florianocaprio/Documents/M5C1-test-evidence-20260929-N3YT3qbT/`; `SHA256SUMS` verificato. I log includono anche i run falliti per trasparenza. Nessun dato reale usato.

Primo ciclo effimero: `m5c1-formal-pg-20260929`, `m5c1-formal-api-20260929`, `m5c1-formal-web-20260929`, rete `m5c1-formal-net-20260929`, immagini `m5c1-formal-{api,web}:20260929`; più browser/preflight/codegen/budget usa-e-getta. Secondo ciclo API finale: `m5c1-formal-pg-rerun-20260929` su tmpfs. Tutti fermati o auto-rimossi, rete e immagini nominate eliminate, zero volumi creati; verifica finale per label e tag senza risorse M5C1 residue. La directory temporanea dedicata è stata eliminata dopo la copia delle evidenze. Lo stack persistente `magazzino-{postgres,api,web}` era ancora attivo con gli stessi container ID verificati prima/dopo la pulizia; i volumi `magazzino-solidale_magazzino_pgdata` e `magazzino-solidale_magazzino_uploads` sono presenti e non sono stati toccati. Nessun commit, staging, push, merge, deploy o M5C2.
