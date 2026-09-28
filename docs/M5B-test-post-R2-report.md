# M5B — ##test completo post-R2

**Esito: PASS TECNICO — in attesa di review e autorizzazione alla pubblicazione.** Il collaudo manuale M5A+M5B di Floriano non è stato eseguito in questa fase. Nessun commit, staging, push, merge o deploy; M5C non avviata.

## 1. Impronta del candidato

- Branch `codex/magazzino-workflow-unificato`; HEAD locale e `origin/codex/magazzino-workflow-unificato` `cfb53127ecc3a31756aedf8db1e5aefc62a7f346`, divergenza 0/0. `main` è rimasto a `8419dc7ff9d5177c39d90e66f04b19236021244d`.
- Candidato = HEAD + delta M5B/R1/R2 completo, inclusi file non tracciati. Prima di questo rapporto: 28 file tracked modificati e 38 non tracciati. Il rapporto porta i non tracciati a 39. Staging vuoto. La copia sorgente congelata in `/private/tmp/m5b-post-r2-candidate-6LJDHiyW` è stata confrontata con il working tree finale: 66/66 impronte sorgente coincidenti. SHA-256 del manifest sorgenti: `9574e5933601c1072304c2b128d4a3b337e9f1b4b510faf1e3728975720b9bbc` (precedente all'aggiunta di questo rapporto).
- Impronte rappresentative: migration 44 `af324dcae7539e9c947b09a17fb3790eaa0813ed0263e8a5e758cdfcfe2d75a1`; schema index `fad3cb76f22c1ca10f9dedfba3a0b8d8a4ba31aea35fdfe8dcab40df2f06d013`; schema relazione `7082b3b3fcbe92e407939daa2849c633f2ff55493570787a8b25c4b5e5db56e6`; OpenAPI `aa2d90d438b413112fb9b991eee3786e367ac20dea61d1a1507166b26001ebd8`; lockfile `69fe806d6aceafbd6b3e463453ad0e25ea87d92d81982fed471607d15ddad005`; configurazione E2E `e6bef21c23d02c657722bc7fb2904b0d39a66eba5fa477aeab463ec35ee2748d`.
- Le 43 migration storiche e il manifest legacy sono identici alla SHA base. SQL 44 e sorgenti applicativi non sono stati modificati da questo `##test`.

## 2. Inventario e modifiche del collaudo

L'inventario nominativo e l'hash di ciascuno dei 66 file pre-rapporto sono in `candidate-files.lst` e `candidate-final.sha256` nelle evidenze. Le categorie sono: route/lib API e test M5B/R2; pagine/i18n/test frontend ed E2E; OpenAPI e generati; schema/migration/script DB; documentazione M5B/R1/R2. Non sono stati eliminati file del repository.

Questo `##test` ha cambiato **solo test/harness**: `artifacts/api-server/tests/richieste-magazzino-m5b.test.ts`, `artifacts/api-server/tests/m5b-r2-autorizzazioni.test.ts`, `artifacts/api-server/tests/carichi-magazzino-2-0a.test.ts`, `artifacts/api-server/tests/consegne-pagination-rbac.test.ts`, oltre al presente rapporto. Le prove aggiunte coprono ruolo custom/misto, ledger di Bolla Beneficiario/Ente, affidamento-rientro, Trasferimento fino a ricezione, storno storico a saldo netto zero, nuova richiesta dopo delega e concorrenza di due operatori. Due test storici sono stati isolati senza indebolire gli assert: Carichi qualifica tipo/origine/magazzino del movimento; Consegne pagina il Centro creato dalla propria fixture, evitando righe concorrenti di altri file.

## 3. Migration, fresh, upgrade e parità — GO

- Base M5A estratta dalla SHA pubblicata: schema e ledger 43/43 verificati, fixture sintetica M4/M5A popolata, snapshot pre-upgrade acquisito.
- Upgrade autentico: runner ufficiale con **43 skipped + 1 applicata**, ledger 44/44 e zero pending. Il confronto pre/post dei dati preesistenti restituisce `preserved=true`, `differences=[]`; le nuove tabelle relazione/delega sono inizialmente vuote. Secondo run: **44 skipped, zero riapplicazioni**.
- Fresh indipendente: procedura canonica, 44/44, seed/readiness/CRUD, secondo run con zero applicazioni e zero pending.
- Parità fresh/upgrade: `M5B_SCHEMA_PARITY_OK` su tabelle/colonne, tipi, nullability, default, FK/on-delete, CHECK, indici parziali, sequenze e unicità. Runner unitario 10/10.
- Negativo: una tabella omonima ma incompatibile causa il fallimento atteso della 44; ledger resta a 43 e la tabella deleghe non viene creata. Vincoli SQL transazionali: secondo corrente, riuso documento, incoerenza tipo/FK, storico e FK RESTRICT, unicità delega: tutti i casi negativi attesi verificati; transazione di prova rollbackata.

## 4. Matrice R2, RBAC e revoche — GO

`m5b-r2-autorizzazioni.test.ts` 8/8 e `RBAC-FULL` sono passati con sessioni reali. R2-01…06 riproduce la rimozione di Area e Centro dell'operatore ordinario, nella stessa sessione e dopo nuovo login: lista, dettaglio, storico, creazione, replay, Bolla/Trasferimento collegati, ingressi M4 diretti e documenti operativi non ottengono accesso globale implicito e non mutano il dominio. R2-07/16 copre Ente, Trasferimento e risorsa operativa con Centro nullo. R2-08…13 confronta solo Area, Centro+Area, altro Centro, altra Area, amministratore scoped, amministratore davvero globale e Centro senza Area. R2-14 e R2-CUSTOM coprono lettura, prepare, grant M4, ruolo custom/misto, area applicativa, cambio ruolo, utente inattivo e assegnazioni inattive. R2-15 osserva l'ordine PostgreSQL tra comando, revoca e rollback. R2-18 nega il replay del vecchio D1 dopo revoca senza alterare D2. La decisione critica rilegge l'attore dal DB; il solo stato UI non è la barriera autorizzativa.

## 5. Anti-doppio-scarico e race legacy — GO

Le prove `LEG-*` coprono erogazione legacy precedente, anche rilevata nel ledger senza riga materiale; il nuovo `LEG-STORNO` dimostra diniego con due movimenti storici opposti e saldo netto zero. L'Intervento nato da Bolla non viene delegato di nuovo. Dopo delega, `salva-operativita` e `concludi` con merce catalogata sono negati anche dopo annullamento Bolla, annullamento richiesta e creazione di una nuova richiesta sullo stesso Intervento; materiali liberi non inventariali, conclusione sociale e UDS non delegata restano possibili. `LEG-RACE` usa connessioni PostgreSQL separate e waiter advisory osservabili nei tre ordini: legacy prima, delega prima e rollback del primo; nessun doppio effetto. Le operazioni di distribuzione M4 generate legittimamente non sono scambiate per un secondo scarico.

## 6. Fault injection e rollback — GO

`ATOM-CREATE`, `ATOM-TRANSFER`, `ATOM-CANCEL` e `ATOM-COMMIT` iniettano errori su testata/righe, relazione, delega, audit, ricevuta, annullamento dopo rilascio riserve e trigger differito al commit. I digest di dominio prima/dopo i tentativi falliti coincidono; retry e replay successivi producono un solo documento/effetto. Nessuna relazione, delega, prenotazione o documento orfano. I trigger di prova sono rimossi nel `finally`; il DB dei vincoli è rollbackato.

## 7. Relazione, idempotenza e replay — GO

Un solo documento corrente è garantito da vincolo e da prove API; Bolla bozza vuota ammessa, Trasferimento senza righe rifiutato senza persistenza. Doppio click/same-key, chiavi diverse, mismatch, versione obsoleta e concorrenza di **due operatori distinti** sono coperti; l'identità di destinatario/Area/Magazzino non è forzabile dal client. `CAN-REPLAY` e `CAN-REPLAY-TR` eseguono D1 pronto → annulla K1 → D2 pronto → replay K1: D2, riserve, audit, ricevute e versioni restano stabili; K1 con intenzione diversa è 409. R2-18 aggiunge la revoca dei diritti prima del replay.

## 8. Contabilità M4, ledger e reporting — GO

| Percorso                     | Evidenza quantitativa                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 20 pz, D1 da 6               | fisica/prenotata/disponibile: `20/0/20` → bozza `20/0/20` → pronta `20/6/14`; richiesta concorrente da 15 negata |
| Annullamento e D2 da 12      | `20/0/20` → `20/12/8`, FEFO 10+2; annullamento `20/0/20`                                                         |
| Decimali                     | 3,000 kg fisici − 0,250 prenotati = 2,750 disponibili                                                            |
| Bolla Beneficiario collegata | consegna 6: lotto `20→14`, un movimento; replay senza nuovo scarico, richiesta non chiusa automaticamente        |
| Bolla Ente collegata         | consegna 4: lotto `10→6`, un movimento; replay invariato                                                         |
| Affida e rientro             | 4 da 10: fisica 6; mancata consegna, 3 idonee + 1 mancante: fisica finale 9                                      |
| Trasferimento collegato      | origine 5, riserva 3, destinazione 0; Avvia `2/0`, ricezione `2/3`; una uscita/una entrata, replay invariato     |

La gara sull'ultima unità fra Bolla e Trasferimento, lotto scaduto/di altro Magazzino, frazionabilità, storno e suite reporting M4 sono verdi. Richiesta, bozza e pronta non generano erogazione; la relazione M5B non è un saldo o movimento parallelo. Le prove integrate contano una sola uscita fisica per documento; la suite reporting esistente è stata rieseguita nella suite API completa.

## 9. UI, rete, privacy e PDF — GO

E2E M5A+M5B+R2: **35/35 PASS**, sette scenari su ciascuna delle cinque viewport `390×844`, `768×1024`, `1024×768`, `820×1180`, `1440×900`. Coperti richiesta, presa, Bolla contestualizzata, deep link, reload, composizione, annullamento, ritorno e storico; la Bolla legacy libera conserva il selettore Beneficiario. Nel percorso contestualizzato la raccolta rete assertisce zero GET superflue a `/api/beneficiari` e zero accessi al dossier. R2 browser verifica revoca con pagina aperta, refresh e deep link.

Dieci PDF scaricati (cinque Bolle, cinque Trasferimenti) sono di una pagina, contengono prodotto/quantità e destinatario o origine/destinazione, e **non** il marcatore sintetico del bisogno sociale. Un campione per tipo è stato renderizzato e ispezionato visivamente; impaginazione e leggibilità senza anomalie. GET del documento prima/dopo stampa coincide. Smoke runtime autenticato sul WEB compilato: login/sessione, `/api/healthz` e `/api/readyz` HTTP 200, readiness 44/44; WEB `/` e `/config.js` HTTP 200, route anonima protetta 401.

## 10. Suite finali, build e hygiene — GO

- **API completa finale dopo l'ultima modifica test/harness:** `api-full-final-r7.log`, 127 file, **1454 PASS, 4 skip storici**, exit 0 su DB temporaneo fresco 44/44. Non è stato riusato il precedente 1448 PASS. Frontend completo: 83 file, **442/442 PASS**.
- Typecheck workspace finale exit 0. Build API e WEB nel container Linux Node 24/pnpm 10 dal lockfile congelato: exit 0. Bundle entry WEB 1361,1 KiB raw / **376,8 KiB gzip**, sotto la soglia originale di 400 KiB. Codegen: 896 file, manifest SHA identici prima/dopo la prima e la seconda generazione. `git diff --check` e Prettier sui test M5B modificati: exit 0.
- Cronologia non occultata: il primo run API non aveva i flag DB disposable M5A e non era un gate valido; un successivo run completo ha trovato due collisioni di fixture storiche, corrette **solo nei test**; i run completi seguenti sono verdi. Il primo E2E usava il timeout Playwright predefinito di 30 s, insufficiente per i flussi integrati; il rerun senza skip/retry, con timeout esplicito 120 s, è 35/35. Un tentativo aggiuntivo di build immagine API ha incontrato indisponibilità del registry durante `corepack prepare`; la build Linux API/WEB e il budget dal lockfile sono invece riusciti nel container temporaneo. Nessuna policy o Dockerfile è stata cambiata.

## 11. Skip, limiti e manuale

I quattro skip esterni FSE+/AGEA sono in `fse-import-practice-m3b`, `agea-import`, `fse-import-parser-m3b`, `agea-sifead-parser`: non sono conteggiati come PASS e non coprono requisiti M5B. Le viewport sono simulate; tablet fisico e fotocamera reale non sono provati. Le prove TM del Word sono **NE-MAN** in questa fase: nessuna approvazione manuale viene inferita dal PASS tecnico. Il build Dockerfile immagine API non è stato attestato dal tentativo con registry indisponibile; è attestata la compilazione Linux del candidato dal lockfile e il runtime WEB/API effimero. Non vi sono modifiche al Docker/database persistenti.

## 12. Mappa UAT e passaggio a Floriano

Il piano `Test_Manuali_M5A_M5B_Magazzino_Solidale.docx` resta il riferimento di accettazione. Primo giro indicato dal piano: **TM-02, 04, 07, 08, 11–16, 21, 22**; poi tutti gli altri, inclusi regressioni M4 **TM-28/29**, quantità, storno/rientro e ruoli. I test automatici qui associati sono: M5A E2E per invio/presa/coda; R2 API/E2E per scope/revoche; `CAN-*` per sostituzione/replay; `LEG-*` per delega e scarico legacy; `LEDGER-*` e suite M4 per quantità e post-uscita. Floriano deve registrare codici, stock e risultato osservato su un ambiente candidato separatamente autorizzato: questo `##test` non lo ha creato sul persistente.

## 13. Patch ed evidenze

Evidenze private: `/Users/florianocaprio/Documents/M5B-test-post-R2-evidence-ZpPlxKdD/`, con log, snapshot, manifest sorgenti, due PDF/layout sintetici, `M5B-complete-post-R2.patch`, `M5B-test-only-post-R2.patch` e `SHA256SUMS`. La patch completa è HEAD→working tree, includendo tutti i non tracciati; quella test-only seleziona test/harness. Entrambe sono prodotte senza staging e verificate con `git apply --reverse --check`. Nessun `.env`, cookie, credenziale, trace browser o volume Docker è parte della patch. I file `.env` R2 precedenti non risultano nel repository, nello staging o nei patch: erano già rimossi. L'unico `.env` visto durante questo run contiene solo credenziali sintetiche dell'istanza tmpfs M5B ed è eliminato al cleanup; nessuna credenziale operativa ancora valida è stata trovata.

## 14. Cleanup e stato Git finale

Ambiente effimero identificato da `codex.run=6LJDHiyW`: PostgreSQL 16 su tmpfs, Node 24, API, WEB, browser Playwright `--rm`, rete dedicata, database sintetici separati. **Nessun volume Docker creato.** Dopo la raccolta delle evidenze: rimozione nominativa dei soli quattro container residui e della rete; il browser è già auto-rimosso. Le immagini condivise non vengono eliminate né potate. Copie, fixture e secret temporanei di questo run sono rimossi dopo il salvataggio delle evidenze; nessun accesso allo stack persistente.

Verifica finale richiesta: branch/HEAD/remoto invariati, staging vuoto, working tree M5B/R1/R2 ancora intenzionalmente dirty con questo nuovo rapporto; `main` invariato. STOP per review, senza pubblicazione.
